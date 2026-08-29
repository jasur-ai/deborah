/**
 * Deborah — Telegram OTP Auth Routes (AUTH A-16, P3)
 * --------------------------------------------------
 *   POST /api/auth/telegram/start   { phone }         → start-token + 6-kod
 *   POST /api/auth/telegram/verify  { telegram_id, code } → verify + login/link
 *   POST /api/auth/telegram/unlink  (authenticated)   → mapping'ni bekor qilish
 *   POST /webhooks/telegram         (bot callback, HMAC-signed)
 *
 * Bot token yo'q bo'lsa (TELEGRAM_BOT_TOKEN env'da) barcha endpoint'lar 404.
 * SECURITY:
 *   - Kod hech qachon log'ga chiqmaydi; plaintext saqlanmaydi.
 *   - Rate limit: start 5/15, verify 5/15 (per-IP + per-phone).
 *   - Bot callback signature HMAC-SHA256 (bot token bilan) tekshiriladi.
 *   - Single-use kod (consume) + hijack guard + session regenerate (§12).
 *   - Dev/test'da preview (kod + havola) qaytariladi; production'da SMS/email
 *     orqali yuboriladi (sender infra P2 — new-device deliverAlert pattern).
 */

import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { fb } from '../firebase/admin.js';
import { safeKey } from '../utils/helpers.js';
import { audit, AUDIT_ACTIONS, logAuthEvent } from '../src/modules/auth/audit.js';
import { recordSession } from '../src/modules/auth/session-manager.js';
import { parseDevice } from '../src/modules/auth/new-device.js';
import CONFIG from '../src/config/env.js';
import {
  isTelegramEnabled,
  getBotUsername,
  createStart,
  consumeByCode,
  attachTelegramId,
  linkTelegram,
  unlinkTelegram,
  checkStartLimit,
  checkVerifyLimit,
  verifyCallbackSignature,
} from '../src/modules/auth/telegram-otp.js';

const router = Router();

const render404 = (res) =>
  res.status(404).render('error', { title: '404', message: 'Sahifa topilmadi', status: 404 });

const tgAudit = (action, req, extra = {}) =>
  audit({
    action,
    userId: req.session?.user?.safeKey || null,
    ipAddress: req.ip,
    userAgent: req.headers['user-agent'],
    details: extra,
  }).catch(() => {});

const PHONE_RE = /^\+?[0-9]{7,15}$/;

// ── Start: { phone } → t.me havolasi + 6-kod ──
router.post('/api/auth/telegram/start', async (req, res) => {
  if (!isTelegramEnabled()) return res.status(404).json({ error: 'disabled' });

  const { phone } = req.body || {};
  const cleanPhone = typeof phone === 'string' ? phone.trim() : '';
  if (!PHONE_RE.test(cleanPhone)) {
    return res.status(400).json({ error: 'invalid_phone' });
  }

  const limit = checkStartLimit(req.ip || 'unknown', cleanPhone);
  if (!limit.allowed) {
    return res
      .status(429)
      .json({ error: 'too_many_attempts', retryAfterSeconds: limit.retryAfterSeconds });
  }

  const { code, previewLink } = await createStart({
    phone: cleanPhone,
    userKey: req.session?.user?.safeKey || null, // ulangan sessiyadan bo'lsa → link
  });
  await tgAudit(AUDIT_ACTIONS.TELEGRAM_START, req, {
    phonePrefix: `${cleanPhone.slice(0, 4)}***`,
  });

  // Kod/log qoidalari: code hech qachon log'ga chiqmaydi (audit'da yo'q).
  const isPreview = process.env.NODE_ENV !== 'production';
  res.json({
    ok: true,
    deliveredTo: 'phone',
    botUsername: getBotUsername() || null,
    ...(isPreview ? { previewLink, previewCode: code } : {}),
  });
});

// ── Verify: { telegram_id, code } → resolve user → login/link ──
router.post('/api/auth/telegram/verify', async (req, res) => {
  if (!isTelegramEnabled()) return res.status(404).json({ error: 'disabled' });

  const { telegram_id, code, phone } = req.body || {};
  if (typeof code !== 'string') return res.status(400).json({ error: 'invalid_code_format' });

  const limitKey = req.session?.user?.safeKey || String(telegram_id || '');
  const limit = checkVerifyLimit(req.ip || 'unknown', limitKey);
  if (!limit.allowed) {
    return res
      .status(429)
      .json({ error: 'too_many_attempts', retryAfterSeconds: limit.retryAfterSeconds });
  }

  const result = await consumeByCode({ code, telegramId: telegram_id, phone });
  if (!result.ok) {
    await tgAudit(AUDIT_ACTIONS.TELEGRAM_VERIFY, req, {
      outcome: 'fail',
      reason: result.error,
    });
    return res.status(result.httpStatus || 401).json({ error: result.error });
  }
  const record = result.record;
  const tgId = String(record.telegramId || telegram_id || '');

  // Resolve user:
  //  1) start authenticated sessiyadan bo'lsa → shu user
  //  2) record.userKey bo'lsa → o'sha user
  //  3) users_telegram_index → allaqachon ulangan user
  let userKey = record.userKey;
  if (!userKey && tgId) {
    const idx = await fb.get(`users_telegram_index/${safeKey(tgId)}`);
    if (idx.exists()) userKey = idx.val();
  }
  if (!userKey) {
    await tgAudit(AUDIT_ACTIONS.TELEGRAM_VERIFY, req, { outcome: 'no_user' });
    // Yangi account — invite flow (B-seriya) bilan yaratiladi; hozircha rad
    return res.status(401).json({ error: 'account_required' });
  }

  // UNIQUE mapping (hijack/IDOR guard)
  const linkRes = await linkTelegram(userKey, tgId);
  if (!linkRes.ok) {
    await tgAudit(AUDIT_ACTIONS.TELEGRAM_VERIFY, req, {
      outcome: 'fail',
      reason: linkRes.error,
    });
    return res.status(linkRes.httpStatus || 409).json({ error: linkRes.error });
  }

  const isSameSessionUser = req.session?.user?.safeKey === userKey;
  if (!isSameSessionUser) {
    // AUTH A-16 §12: session regenerate — Telegram orqali login
    return req.session.regenerate(async (err) => {
      if (err) return res.status(500).json({ error: 'session_error' });
      try {
        const userSnap = await fb.get(`users/${userKey}`);
        const ud = userSnap.exists() ? userSnap.val() : {};
        let isVip = false;
        try {
          const vipSnap = await fb.get(`users/${userKey}/isVip`);
          isVip = vipSnap.exists() && vipSnap.val() === true;
        } catch (_) {}
        const role =
          ud.role && ['student', 'teacher', 'proctor', 'marker', 'board'].includes(ud.role)
            ? ud.role
            : 'student';
        req.session.user = {
          username: ud.username || userKey,
          safeKey: userKey,
          isVip,
          role,
          passwordUpdatedAt: ud.password_updated_at || 0,
          roleVersion: typeof ud.role_version === 'number' ? ud.role_version : 0,
        };
        req.session.lastActiveAt = Date.now();

        await fb.set(`users/${userKey}/last_login`, Date.now()).catch(() => {});
        await logAuthEvent({
          action: AUDIT_ACTIONS.AUTH_LOGIN,
          outcome: 'success',
          method: 'telegram',
          actorId: userKey,
          ipAddress: req.ip,
          userAgent: req.headers['user-agent'],
        }).catch(() => {});
        const device = parseDevice(req.headers['user-agent']);
        await recordSession({
          userId: userKey,
          sessionId: req.sessionID,
          ipAddress: req.ip,
          userAgent: req.headers['user-agent'],
          authMethod: 'telegram',
          remember: true,
          role,
          isVip,
          ...device,
        }).catch(() => {});
        await tgAudit(AUDIT_ACTIONS.TELEGRAM_VERIFY, req, {
          outcome: 'success',
          telegramId: tgId,
          login: true,
        });
        res.json({ success: true, linked: true, login: true, role });
      } catch (e) {
        res.status(500).json({ error: 'internal' });
      }
    });
  }

  await tgAudit(AUDIT_ACTIONS.TELEGRAM_VERIFY, req, {
    outcome: 'success',
    telegramId: tgId,
    linked: true,
  });
  res.json({ success: true, linked: true, login: false });
});

// ── Unlink (authenticated) ──
router.post('/api/auth/telegram/unlink', requireAuth, async (req, res) => {
  if (!isTelegramEnabled()) return res.status(404).json({ error: 'disabled' });
  const userKey = req.session.user.safeKey;
  const r = await unlinkTelegram(userKey);
  if (r.removed) await tgAudit(AUDIT_ACTIONS.TELEGRAM_UNLINKED, req, { telegramId: r.telegramId });
  res.json({ success: true, removed: r.removed });
});

// ── Bot webhook (HMAC-signed callback) ──
// Telegram: payload { start_token, id, first_name, username, auth_date } —
// `signature` = HMAC-SHA256(bot_token, "start_token=..&id=..&auth_date=..")
router.post('/webhooks/telegram', async (req, res) => {
  if (!isTelegramEnabled()) return res.status(404).json({ error: 'disabled' });
  const { start_token, id, first_name, username, auth_date, signature } = req.body || {};
  const canonical = `start_token=${encodeURIComponent(String(start_token || ''))}&id=${encodeURIComponent(String(id || ''))}&auth_date=${encodeURIComponent(String(auth_date || ''))}`;
  if (!verifyCallbackSignature({ payload: canonical, signature, secret: CONFIG.TELEGRAM_BOT_TOKEN })) {
    await tgAudit(AUDIT_ACTIONS.TELEGRAM_WEBHOOK, req, { outcome: 'fail', reason: 'bad_signature' });
    return res.status(403).json({ error: 'bad_signature' });
  }
  const attached = await attachTelegramId({ token: start_token, telegramId: id });
  if (!attached.ok) {
    await tgAudit(AUDIT_ACTIONS.TELEGRAM_WEBHOOK, req, { outcome: 'fail', reason: attached.error });
    return res.status(attached.error === 'unknown_start_token' ? 404 : 410).json({ error: attached.error });
  }
  await tgAudit(AUDIT_ACTIONS.TELEGRAM_WEBHOOK, req, {
    outcome: 'success',
    telegramId: String(id),
    name: first_name ? `${first_name}${username ? ` (${username})` : ''}`.slice(0, 80) : '',
  });
  res.json({ ok: true });
});

export default router;
