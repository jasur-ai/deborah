/**
 * AUTH B-23 — Web Push (PWA) routes
 * ---------------------------------
 * GET  /user/push                  — push sozlamalari UI (subscription holati + opt-in)
 * POST /api/push/subscribe         — subscription saqlash (CSRF + auth, idempotent)
 * POST /api/push/unsubscribe       — subscription o'chirish (endpoint bo'yicha)
 * GET  /api/push/vapid-key         — VAPID public key (subscribe uchun)
 * GET  /api/push/optin-eligible    — kontekstual opt-in: 2-3 sessiyadan keyin so'raladi (§07)
 *
 * Security: barcha write path CSRF + audit; endpoint PII — preview'ga chiqmaydi (§16).
 */
import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { fb } from '../firebase/admin.js';
import { safeKey } from '../utils/helpers.js';
import { AUTH_COPY, resolveAuthLang } from '../data/auth-i18n.js';
import {
  addPushSubscription,
  removePushSubscription,
  getUserPushSubscriptions,
  pushEnabled,
  vapidPublicKey,
} from '../src/modules/student/push.js';
// AUTH E-03: FCM device-token (mobile push)
import {
  registerFcmToken,
  removeFcmToken,
  getUserFcmTokens,
  isValidFcmToken,
} from '../src/modules/student/fcm.js';
import { logAuthEvent, AUDIT_ACTIONS } from '../src/modules/auth/audit.js';

const router = Router();

// Auth himoyasi — faqat o'z yo'llari uchun (B-21 pattern)
router.use((req, res, next) => {
  const p = req.path;
  if (
    p === '/user/push' ||
    p === '/api/push/subscribe' ||
    p === '/api/push/unsubscribe' ||
    p === '/api/push/vapid-key' ||
    p === '/api/push/optin-eligible' ||
    // E-03: FCM device token
    p === '/api/push/device/status' ||
    p === '/api/push/device/register' ||
    p === '/api/push/device/unregister'
  ) {
    return requireAuth(req, res, next);
  }
  next();
});

// ── Sozlamalar sahifasi ──
router.get('/user/push', async (req, res) => {
  try {
    const lang = resolveAuthLang(req);
    const copy = AUTH_COPY[lang] || AUTH_COPY.uz;
    const user = req.session.user;
    const subs = await getUserPushSubscriptions(user.safeKey);
    const loginSnap = await fb.get(`users/${safeKey(user.safeKey)}/login_count`);
    return res.render('user/push', {
      layout: false,
      lang,
      user,
      notifCopy: copy.notif || {},
      pushCopy: copy.push || {},
      enabled: pushEnabled(),
      vapidKey: vapidPublicKey(),
      subscriptionCount: subs.length,
      loginCount: loginSnap.exists() ? loginSnap.val() : 0,
      optinAfter: Number(process.env.PUSH_OPTIN_AFTER_SESSIONS ?? 2),
      csrf: res.locals.csrfToken || null,
    });
  } catch (err) {
    console.error('[push] GET /user/push failed:', err?.message || err);
    return res.status(500).send('internal');
  }
});

// ── E-03: FCM device token (mobile push) ──
// Token = PII — logout/DSAR'da revoke qilinadi; faqat o'z user'iga yoziladi.

router.get('/api/push/device/status', async (req, res) => {
  try {
    const userKey = req.session.user.safeKey;
    const tokens = await getUserFcmTokens(userKey);
    return res.json({
      ok: true,
      count: tokens.length,
      // Raw token qaytmaydi (PII) — faqat metadata
      devices: tokens.map((t) => ({
        platform: t.platform || 'android',
        createdAt: t.created_at || null,
        lastUsedAt: t.last_used_at || null,
      })),
    });
  } catch (err) {
    console.error('[push] device status failed:', err?.message || err);
    return res.status(500).json({ ok: false, error: 'internal' });
  }
});

router.post('/api/push/device/register', async (req, res) => {
  try {
    const { token, platform } = req.body || {};
    if (!isValidFcmToken(token)) {
      return res.status(400).json({ ok: false, error: 'invalid_token' });
    }
    const userKey = req.session.user.safeKey;
    const result = await registerFcmToken({
      userId: userKey,
      token,
      platform,
      userAgent: req.headers['user-agent'],
    });
    if (!result.ok) {
      return res.status(result.error === 'limit_reached' ? 429 : 400).json({ ok: false, error: result.error });
    }
    if (result.created) {
      logAuthEvent({
        action: AUDIT_ACTIONS.PUSH_SUBSCRIBED,
        outcome: 'success',
        actorId: safeKey(userKey),
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
        details: { channel: 'fcm', platform: platform || 'android' },
      }).catch(() => {});
    }
    return res.json({ ok: true, created: result.created });
  } catch (err) {
    console.error('[push] device register failed:', err?.message || err);
    return res.status(500).json({ ok: false, error: 'internal' });
  }
});

router.post('/api/push/device/unregister', async (req, res) => {
  try {
    const { token } = req.body || {};
    const userKey = req.session.user.safeKey;
    await removeFcmToken({ userId: userKey, token });
    logAuthEvent({
      action: AUDIT_ACTIONS.PUSH_UNSUBSCRIBED,
      outcome: 'success',
      actorId: safeKey(userKey),
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
      details: { channel: 'fcm' },
    }).catch(() => {});
    return res.json({ ok: true });
  } catch (err) {
    console.error('[push] device unregister failed:', err?.message || err);
    return res.status(500).json({ ok: false, error: 'internal' });
  }
});

// ── VAPID public key (subscribe uchun) ──
router.get('/api/push/vapid-key', async (req, res) => {
  if (!pushEnabled()) return res.status(400).json({ ok: false, error: 'push_disabled' });
  return res.json({ ok: true, key: vapidPublicKey() });
});

// ── Opt-in eligible? (§07: 2-3 sessiyadan keyin so'raladi) ──
router.get('/api/push/optin-eligible', async (req, res) => {
  try {
    const userKey = req.session.user.safeKey;
    const snap = await fb.get(`users/${safeKey(userKey)}/login_count`);
    const count = snap.exists() ? snap.val() : 0;
    const threshold = Number(process.env.PUSH_OPTIN_AFTER_SESSIONS ?? 2);
    // Allaqachon subscription bor bo'lsa so'ralmaydi
    const subs = await getUserPushSubscriptions(userKey);
    return res.json({
      ok: true,
      eligible: pushEnabled() && subs.length === 0 && count >= threshold,
      loginCount: count,
      threshold,
    });
  } catch (err) {
    console.error('[push] optin-eligible failed:', err?.message || err);
    return res.status(500).json({ ok: false, error: 'internal' });
  }
});

// ── Subscribe (idempotent, §17) ──
router.post('/api/push/subscribe', async (req, res) => {
  try {
    const { endpoint, keys } = req.body || {};
    if (!endpoint || !keys?.p256dh || !keys?.auth) {
      return res.status(400).json({ ok: false, error: 'invalid_subscription' });
    }
    const userKey = req.session.user.safeKey;
    const result = await addPushSubscription({
      userId: userKey,
      endpoint,
      keys,
      userAgent: req.headers['user-agent'],
    });
    if (!result.ok) return res.status(400).json({ ok: false, error: result.error });
    if (result.created) {
      logAuthEvent({
        action: AUDIT_ACTIONS.PUSH_SUBSCRIBED,
        outcome: 'success',
        actorId: safeKey(userKey),
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
        details: { count: 1 },
      }).catch(() => {});
    }
    return res.json({ ok: true, created: result.created });
  } catch (err) {
    console.error('[push] subscribe failed:', err?.message || err);
    return res.status(500).json({ ok: false, error: 'internal' });
  }
});

// ── Unsubscribe ──
router.post('/api/push/unsubscribe', async (req, res) => {
  try {
    const { endpoint } = req.body || {};
    const userKey = req.session.user.safeKey;
    await removePushSubscription({ userId: userKey, endpoint });
    logAuthEvent({
      action: AUDIT_ACTIONS.PUSH_UNSUBSCRIBED,
      outcome: 'success',
      actorId: safeKey(userKey),
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    }).catch(() => {});
    return res.json({ ok: true });
  } catch (err) {
    console.error('[push] unsubscribe failed:', err?.message || err);
    return res.status(500).json({ ok: false, error: 'internal' });
  }
});

export default router;
