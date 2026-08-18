/**
 * AUTH B-23 — Web Push (PWA) subscription + send
 * -------------------------------------------------
 * Subscription'lar `users.{id}.push_subs.{subKey}` da saqlanadi:
 *
 *   {
 *     endpoint: string,   // PII — preview/hech qayerda ko'rinmaydi
 *     keys: { p256dh, auth },
 *     created_at, user_agent (hash), last_used_at
 *   }
 *
 * Qoidalar:
 *   - VAPID juftligi env'dan (prod KMS). `VAPID_PUBLIC_KEY` bo'lmasa disabled.
 *   - Send: web-push (payload encrypt), prefs bo'yicha (B-21) + chastota cap
 *     (B-21 checkNotifRate) + quiet hours (22:00-08:00 default, §10).
 *   - 410 Gone → subscription o'chiriladi (unsubscribe, §11).
 *   - Payload minimal: title + body (preview sensitive YO'Q), §16.
 *   - iOS Safari push cheklangan — PWA install'dan keyin, fallback email/Telegram (§28).
 *   - `cleanupPushSubscriptions` — oylik tozalash job' (eski/aktiv bo'lmagan, §29).
 */

import webpush from 'web-push';
import { fb } from '../../../firebase/admin.js';
import { safeKey } from '../../../utils/helpers.js';
import { logAuthEvent, AUDIT_ACTIONS } from '../auth/audit.js';
import { checkNotifRate, recordNotifSent } from './notifications.js';

// ── Config ──
export function pushEnabled() {
  return (
    process.env.PUSH_ENABLED !== 'false' &&
    Boolean(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY)
  );
}

export function vapidPublicKey() {
  return process.env.VAPID_PUBLIC_KEY || null;
}

export function vapidSubject() {
  return process.env.VAPID_SUBJECT || 'mailto:no-reply@deborah.uz';
}

function quietHours() {
  const start = Number(process.env.PUSH_QUIET_START ?? 22);
  const end = Number(process.env.PUSH_QUIET_END ?? 8);
  return { start, end };
}

/** Quiet hours ichidamizmi? (22:00-08:00 default) — bu vaqtda push yuborilmaydi (§10). */
export function isQuietHours(ts = Date.now()) {
  if (!pushEnabled()) return false;
  const { start, end } = quietHours();
  const h = new Date(ts).getHours();
  if (start < end) return h >= start && h < end; // masalan 8-22 → yo'q
  return h >= start || h < end; // 22-08 → ha
}

// ── Subscription CRUD (§08) ──
function subKey(endpoint) {
  return safeKey(String(endpoint).slice(-64));
}

/** Yangi subscription saqlaydi (idempotent — takroriy POST xato emas, §17). */
export async function addPushSubscription({ userId, endpoint, keys, userAgent }) {
  if (!userId || !endpoint) return { ok: false, error: 'invalid_subscription' };
  const uKey = safeKey(userId);
  const key = subKey(endpoint);
  const existing = await fb.get(`users/${uKey}/push_subs/${key}`);
  const now = Date.now();
  const record = {
    endpoint,
    keys: { p256dh: keys?.p256dh || '', auth: keys?.auth || '' },
    created_at: existing.exists() ? existing.val().created_at : now,
    user_agent: userAgent ? safeKey(userAgent).slice(0, 40) : null,
    last_used_at: now,
  };
  await fb.set(`users/${uKey}/push_subs/${key}`, record);
  return { ok: true, key, created: !existing.exists() };
}

/** Subscription'ni o'chiradi (unlink). */
export async function removePushSubscription({ userId, endpoint }) {
  if (!userId || !endpoint) return { ok: false, error: 'invalid_subscription' };
  const uKey = safeKey(userId);
  const key = subKey(endpoint);
  await fb.remove(`users/${uKey}/push_subs/${key}`);
  return { ok: true };
}

/** Foydalanuvchining barcha subscription'larini qaytaradi (send uchun). */
export async function getUserPushSubscriptions(userId) {
  if (!userId) return [];
  const snap = await fb.get(`users/${safeKey(userId)}/push_subs`);
  if (!snap.exists()) return [];
  return Object.values(snap.val() || {});
}

/** 410 Gone → subscription'ni o'chiradi (§11). */
export async function removePushSubscriptionByEndpoint(userId, endpoint) {
  if (!userId || !endpoint) return;
  const uKey = safeKey(userId);
  const key = subKey(endpoint);
  await fb.remove(`users/${uKey}/push_subs/${key}`);
}

// ── Send (§09) ──
/**
 * Push yuboradi (har subscription uchun). Cap B-21 checkNotifRate orqali,
 * quiet hours tekshiruvi §10. Payload minimal (title/body/url) — preview yoki
 * sensitive ma'lumot yo'q (§16).
 * @returns {Promise<{ok:boolean, sent:number, failed:number, reason?:string}>}
 */
export async function sendPushNotification({ userId, type, title, body, url = '/' }) {
  if (!userId || !title) return { ok: false, sent: 0, failed: 0, error: 'no_user' };
  if (!pushEnabled()) return { ok: false, sent: 0, failed: 0, error: 'push_disabled' };
  if (isQuietHours()) return { ok: false, sent: 0, failed: 0, reason: 'quiet_hours' };

  // B-21 chastota cap (push kanal cap'i 2-3/kun) — security cap'ga kirmaydi (B-32 §10)
  if (type !== 'security') {
    const rate = await checkNotifRate({ userId, channel: 'push', type });
    if (!rate.allowed) return { ok: false, sent: 0, failed: 0, reason: rate.reason };
  }

  const subs = await getUserPushSubscriptions(userId);

  webpush.setVapidDetails(vapidSubject(), process.env.VAPID_PUBLIC_KEY, process.env.VAPID_PRIVATE_KEY);

  const payload = JSON.stringify({ title, body: body || '', url, tag: type || 'general' });
  let sent = 0;
  let failed = 0;

  // E-03: FCM mobile tokenlar — B-23 web subscription'lar bilan birga (push kanali)
  const { sendFcmNotification } = await import('./fcm.js');
  const fcmResult = await sendFcmNotification({ userId, type, title, body, url });
  sent += fcmResult.sent || 0;
  failed += fcmResult.failed || 0;

  for (const sub of subs) {
    if (!sub?.endpoint || !sub?.keys?.p256dh || !sub?.keys?.auth) {
      failed += 1;
      continue;
    }
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth } },
        payload
      );
      sent += 1;
    } catch (err) {
      failed += 1;
      if (err?.statusCode === 404 || err?.statusCode === 410) {
        // Subscription o'lik — o'chiramiz (§11)
        await removePushSubscriptionByEndpoint(userId, sub.endpoint).catch(() => {});
      }
    }
  }

  if (subs.length === 0 && sent === 0 && failed === 0) {
    return { ok: false, sent: 0, failed: 0, reason: 'no_subscription' };
  }

  if (sent > 0) await recordNotifSent({ userId, channel: 'push', type });

  // Audit (§12)
  if (sent > 0) {
    logAuthEvent({
      action: AUDIT_ACTIONS.PUSH_SENT,
      outcome: 'success',
      actorId: safeKey(userId),
      details: { count: sent, type: type || 'general' },
    }).catch(() => {});
  }
  if (failed > 0) {
    logAuthEvent({
      action: AUDIT_ACTIONS.PUSH_FAILED,
      outcome: 'failed',
      actorId: safeKey(userId),
      details: { failed, sent, reason: 'send_error' },
    }).catch(() => {});
  }

  return { ok: sent > 0, sent, failed };
}

// ── Cleanup job (§29) ──
/**
 * Eski subscription'larni tozalaydi: 180 kundan ortiq ishlatilmagan
 * subscription'lar o'chiriladi. Oylik cron'da ishlaydi.
 * @returns {Promise<{removed:number, scanned:number}>}
 */
export async function cleanupPushSubscriptions() {
  const MAX_IDLE_MS = 180 * 24 * 60 * 60 * 1000; // 180 kun
  const now = Date.now();
  let removed = 0;
  let scanned = 0;
  try {
    const usersSnap = await fb.get('users');
    if (!usersSnap.exists()) return { removed: 0, scanned: 0 };
    const users = usersSnap.val();
    for (const [uKey, u] of Object.entries(users || {})) {
      const subs = u?.push_subs;
      if (!subs || typeof subs !== 'object') continue;
      for (const [key, sub] of Object.entries(subs)) {
        scanned += 1;
        const last = sub?.last_used_at || sub?.created_at || 0;
        if (now - last > MAX_IDLE_MS) {
          await fb.remove(`users/${uKey}/push_subs/${key}`).catch(() => {});
          removed += 1;
        }
      }
    }
  } catch (_) { /* non-critical job */ }
  return { removed, scanned };
}

/** Testlar uchun. */
export function _pushConfig() {
  return { pushEnabled: pushEnabled(), quietHours: quietHours(), vapidSubject: vapidSubject() };
}
