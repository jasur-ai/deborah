/**
 * AUTH E-03 — FCM (Firebase Cloud Messaging) device-token push provider
 * ---------------------------------------------------------------------
 * B-23 Web Push (VAPID/PWA) allaqachon bor; E-03 native mobile qo'shadi.
 *
 * Provider tanlovi: **FCM** (APNs ustidan) — sabablar:
 *   - O'zbekiston bozori ~90% Android — bitta provider barcha qurilmalarga
 *     yetadi (FCM iOS'ga ham APNs bridge orqali yetkazadi).
 *   - Bitta API (server key), APNs Apple Developer account + cert talab qiladi.
 *   - Telefon raqami/IMEI kerak emas — faqat Firebase install token.
 *
 * Storage: `users.{id}.fcm_tokens.{tokenKey}` →
 *   { token, platform: 'android'|'ios'|'web', created_at, last_used_at,
 *     user_agent (hash) }
 *
 * Qoidalar:
 *   - `FCM_SERVER_KEY` bo'lmasa disabled (pushEnabled() bilan bir xil yondashuv).
 *   - Token = PII → DSAR export'ga kiradi, logout/DSAR delete'da revoke.
 *   - Har user'ga ≤5 token (qurilma almashish cheklovi, spam qarshi).
 *   - Send: FCM legacy HTTP API (fetch, yangi dep yo'q), prefs/rate cap/quiet
 *     hours B-21/B-23 bilan umumiy (checkNotifRate + isQuietHours).
 *   - `NotRegistered`/`InvalidRegistration` → token o'chiriladi.
 *   - Payload minimal: title + body + url (sensitive YO'Q).
 */

import crypto from 'crypto';
import { fb } from '../../../firebase/admin.js';
import { safeKey } from '../../../utils/helpers.js';
import { logAuthEvent, AUDIT_ACTIONS } from '../auth/audit.js';
import { checkNotifRate, recordNotifSent } from './notifications.js';
import { isQuietHours } from './push.js';

// ── Config ──
const FCM_API = 'https://fcm.googleapis.com/fcm/send';
const MAX_TOKENS_PER_USER = 5;
const FCM_TOKEN_MAX_IDLE_MS = 180 * 24 * 60 * 60 * 1000; // 180 kun (cleanup)
const FCM_TIMEOUT_MS = 10 * 1000;

export function fcmEnabled() {
  return (
    process.env.FCM_ENABLED !== 'false' &&
    Boolean(process.env.FCM_SERVER_KEY)
  );
}

function serverKey() {
  return process.env.FCM_SERVER_KEY || '';
}

// Token key — SHA-256 hash (safeKey EMAS: u lowercase + 60 belgiga qirqadi,
// FCM token'lar case-sensitive — ikki xil token collision'ga uchraydi).
// Hash deterministik va collision-resistant (case-sensitive input uchun ham).
function tokenKey(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex').slice(0, 40);
}

/** Token validatsiyasi: uzunlik + boshqaruv belgilari yo'q (FCM ~150-200 belgi). */
export function isValidFcmToken(token) {
  if (typeof token !== 'string') return false;
  if (token.length < 20 || token.length > 500) return false;
  // eslint-disable-next-line no-control-regex
  return !/[\u0000-\u001f\u007f]/.test(token) && !/\s/.test(token);
}

// ── CRUD ──

/** Token saqlaydi (idempotent — takroriy POST xato emas). */
export async function registerFcmToken({ userId, token, platform = 'android', userAgent = null }) {
  if (!userId || !isValidFcmToken(token)) return { ok: false, error: 'invalid_token' };
  const platformNorm = ['android', 'ios', 'web'].includes(platform) ? platform : 'android';
  const uKey = safeKey(userId);
  const key = tokenKey(token);

  const existing = await fb.get(`users/${uKey}/fcm_tokens/${key}`);
  if (existing.exists()) {
    // Idempotent — last_used_at yangilanadi
    await fb.set(`users/${uKey}/fcm_tokens/${key}`, {
      ...existing.val(),
      last_used_at: Date.now(),
    });
    return { ok: true, key, created: false };
  }

  // Per-user limit
  const listSnap = await fb.get(`users/${uKey}/fcm_tokens`);
  if (listSnap.exists()) {
    const count = Object.keys(listSnap.val() || {}).length;
    if (count >= MAX_TOKENS_PER_USER) return { ok: false, error: 'limit_reached' };
  }

  await fb.set(`users/${uKey}/fcm_tokens/${key}`, {
    token,
    platform: platformNorm,
    user_agent: userAgent ? safeKey(userAgent).slice(0, 40) : null,
    created_at: Date.now(),
    last_used_at: Date.now(),
  });
  return { ok: true, key, created: true };
}

/** Bitta token'ni o'chiradi (unlink). */
export async function removeFcmToken({ userId, token }) {
  if (!userId || !token) return { ok: false, error: 'invalid_token' };
  await fb.remove(`users/${safeKey(userId)}/fcm_tokens/${tokenKey(token)}`);
  return { ok: true };
}

/** User'ning barcha tokenlarini o'chiradi (logout revoke / DSAR delete / restrict). */
export async function removeAllFcmTokens(userId) {
  if (!userId) return { ok: false, error: 'no_user' };
  await fb.remove(`users/${safeKey(userId)}/fcm_tokens`);
  return { ok: true };
}

/** User'ning tokenlari (send uchun). */
export async function getUserFcmTokens(userId) {
  if (!userId) return [];
  const snap = await fb.get(`users/${safeKey(userId)}/fcm_tokens`);
  if (!snap.exists()) return [];
  return Object.values(snap.val() || {});
}

// ── Send ──

/**
 * FCM orqali push yuboradi (har token uchun). B-21 chastota cap + quiet hours
 * push.js bilan umumiy. `NotRegistered` → token o'chiriladi.
 * @returns {Promise<{ok: boolean, sent: number, failed: number, reason?: string}>}
 */
export async function sendFcmNotification({ userId, type, title, body, url = '/' }) {
  if (!userId || !title) return { ok: false, sent: 0, failed: 0, error: 'no_user' };
  if (!fcmEnabled()) return { ok: false, sent: 0, failed: 0, error: 'fcm_disabled' };
  if (isQuietHours()) return { ok: false, sent: 0, failed: 0, reason: 'quiet_hours' };

  if (type !== 'security') {
    const rate = await checkNotifRate({ userId, channel: 'push', type });
    if (!rate.allowed) return { ok: false, sent: 0, failed: 0, reason: rate.reason };
  }

  const tokens = await getUserFcmTokens(userId);
  if (tokens.length === 0) return { ok: false, sent: 0, failed: 0, reason: 'no_token' };

  const payload = JSON.stringify({
    notification: { title, body: body || '', click_action: url || '/' },
    data: { url: url || '/', tag: type || 'general' },
  });

  let sent = 0;
  let failed = 0;
  const removed = [];

  for (const t of tokens) {
    if (!t || !t.token) { failed += 1; continue; }
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), FCM_TIMEOUT_MS);
    try {
      const res = await fetch(FCM_API, {
        method: 'POST',
        headers: {
          'Authorization': `key=${serverKey()}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ to: t.token, priority: 'high', ...JSON.parse(payload) }),
        signal: ctrl.signal,
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.success === 1) {
        sent += 1;
      } else {
        failed += 1;
        // O'lik token — o'chiriladi (NotRegistered / InvalidRegistration / canonical_id)
        const err = data.results?.[0]?.error || data.error || '';
        if (/NotRegistered|InvalidRegistration/i.test(err)) {
          await removeFcmToken({ userId, token: t.token }).catch(() => {});
          removed.push(t.token.slice(0, 12));
        }
      }
    } catch (_) {
      failed += 1; // network/timeout — token'ni o'chirmaymiz (vaqtinchalik)
    } finally {
      clearTimeout(timer);
    }
  }

  if (sent > 0) await recordNotifSent({ userId, channel: 'push', type });

  if (sent > 0) {
    logAuthEvent({
      action: AUDIT_ACTIONS.PUSH_SENT,
      outcome: 'success',
      actorId: safeKey(userId),
      details: { count: sent, type: type || 'general', channel: 'fcm' },
    }).catch(() => {});
  }
  if (failed > 0) {
    logAuthEvent({
      action: AUDIT_ACTIONS.PUSH_FAILED,
      outcome: 'failed',
      actorId: safeKey(userId),
      details: { failed, sent, reason: 'send_error', channel: 'fcm', removedTokens: removed.length },
    }).catch(() => {});
  }

  return { ok: sent > 0, sent, failed };
}

// ── Cleanup job ──
/** 180 kundan ortiq ishlatilmagan tokenlarni tozalaydi (oylik cron). */
export async function cleanupFcmTokens() {
  const now = Date.now();
  let removed = 0;
  let scanned = 0;
  try {
    const usersSnap = await fb.get('users');
    if (!usersSnap.exists()) return { removed: 0, scanned: 0 };
    const users = usersSnap.val();
    for (const [uKey, u] of Object.entries(users || {})) {
      const tokens = u?.fcm_tokens;
      if (!tokens || typeof tokens !== 'object') continue;
      for (const [key, t] of Object.entries(tokens)) {
        scanned += 1;
        const last = t?.last_used_at || t?.created_at || 0;
        if (now - last > FCM_TOKEN_MAX_IDLE_MS) {
          await fb.remove(`users/${uKey}/fcm_tokens/${key}`).catch(() => {});
          removed += 1;
        }
      }
    }
  } catch (_) { /* non-critical job */ }
  return { removed, scanned };
}

/** Testlar uchun. */
export function _fcmConfig() {
  return { fcmEnabled: fcmEnabled(), maxTokensPerUser: MAX_TOKENS_PER_USER };
}
