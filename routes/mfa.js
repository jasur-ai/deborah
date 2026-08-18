/**
 * Deborah — MFA/TOTP Routes (AUTH A-26)
 *
 * Flow:
 *   1. User parol bilan login qiladi → server hasActiveMfa tekshiradi →
 *      ha bo'lsa session'da pendingMfa (userId + challengeId) → redirect /user/mfa
 *   2. POST /api/mfa/verify { code } → TOTP yoki backup → faqat shunda session.user
 *   3. Settings: setup → enable (backup codes) → status → rotate → disable
 *   4. MFA reset: backup code'lari yo'q bo'lsa → support ticket + 72 soat delay
 *
 * Security:
 *   - parol bosqichida session BERILMAYDI (session.user yo'q — 401 saqlanadi)
 *   - challenge single-use + 5 daqiqa TTL
 *   - 5 xato → 15 daqiqa lockout (per-user + per-IP)
 *   - CSRF barcha POST'larda (global middleware)
 *   - secret/backup codes DB'da plaintext emas
 */

import crypto from 'crypto';
import { Router } from 'express';
import qrcode from 'qrcode';
import CONFIG from '../src/config/env.js';
import { requireAuth, requireRecentAuth } from '../middleware/auth.js';
import { fb } from '../firebase/admin.js';
import { safeKey } from '../utils/helpers.js';
import { AUTH_COPY, resolveAuthLang } from '../data/auth-i18n.js';
import { audit, AUDIT_ACTIONS, logAuthEvent } from '../src/modules/auth/audit.js';
import { recordSession, revokeByUser } from '../src/modules/auth/session-manager.js';
import { sessionTtlMs, rememberCookieName } from '../src/modules/auth/session-store.js';
import { authSpanMiddleware } from '../src/telemetry/spans.js'; // AUTH D-05
import { ipHash } from '../src/modules/auth/new-device.js';
import {
  setupTotp,
  enableTotp,
  getMfaStatus,
  verifyMfaCode,
  createMfaChallenge,
  readMfaChallenge,
  consumeMfaChallenge,
  disableMfa,
  rotateBackupCodes,
  backupCodesRemaining,
  requestMfaReset,
  executeMfaReset,
  isMfaStepUpFresh,
} from '../src/modules/auth/mfa-totp.js';

const router = Router();

/**
 * GET /user/mfa — MFA challenge sahifasi (login'dan keyin).
 * session.user YO'Q bo'lishi mumkin — faqat pendingMfa bor bo'lsa ko'rsatiladi.
 */
router.get('/user/mfa', (req, res) => {
  const pending = req.session?.pendingMfa;
  if (!pending || !pending.challengeId || !pending.userId) {
    // Challenge yo'q — login sahifasiga qaytaramiz
    if (req.session?.user) return res.redirect('/user/panel');
    return res.redirect('/user/login');
  }
  // D-08 §15: i18n — lang query/cookie, mfaLogin bloki 4 til
  const l = resolveAuthLang(req.query.lang || req.cookies?.lang);
  res.render('user/mfa', {
    lang: l,
    title: AUTH_COPY[l].mfaLogin.title,
    challengeId: pending.challengeId,
    error: null,
    copy: AUTH_COPY[l],
    // csrfToken res.locals orqali server.js o'rnatadi (session'ga bog'langan)
  });
});

/** POST /api/mfa/verify — kod verify → shundagina session beriladi. */
// AUTH D-05 §08: auth.mfa span
router.post('/api/mfa/verify', authSpanMiddleware('auth.mfa'), async (req, res) => {
  try {
    const { code, challengeId } = req.body || {};
    const pending = req.session?.pendingMfa;

    // Challenge session'da bo'lishi shart (parol bosqichidan o'tilgan)
    if (!pending || !pending.challengeId) {
      return res.status(401).json({ ok: false, error: 'no_pending_challenge' });
    }
    if (typeof challengeId !== 'string' || challengeId !== pending.challengeId) {
      return res.status(400).json({ ok: false, error: 'challenge_mismatch' });
    }
    if (!code) return res.status(400).json({ ok: false, error: 'required' });

    // Challenge tekshiruvi (consume EMAS — xato kod urinishi challenge'ni
    // yo'qotmasligi kerak; A-26 §12: faqat muvaffaqiyatda consumed).
    const challenge = await readMfaChallenge(challengeId);
    if (!challenge || !challenge.valid || challenge.userId !== pending.userId) {
      delete req.session.pendingMfa;
      return res.status(401).json({ ok: false, error: 'challenge_invalid' });
    }
    const userId = challenge.userId;

    const result = await verifyMfaCode(userId, String(code).trim(), req.ip);
    if (!result.ok) {
      return res.status(result.error === 'locked' ? 429 : 403).json({
        ok: false,
        error: result.error,
        retryAfterSeconds: result.retryAfterSeconds,
      });
    }

    // FAQAT muvaffaqiyatda consume (single-use — replay yo'q)
    await consumeMfaChallenge(challengeId);

    // ── FAQAT shunda session beriladi ──
    const snap = await fb.get(`users/${safeKey(userId)}`);
    if (!snap.exists()) {
      delete req.session.pendingMfa;
      return res.status(401).json({ ok: false, error: 'user_not_found' });
    }
    const u = snap.val();

    req.session.regenerate(async (err) => {
      if (err) {
        return res.status(500).json({ ok: false, error: 'session_error' });
      }
      const isVip = u.isVip === true;
      const role = ['student', 'teacher', 'proctor', 'marker', 'board'].includes(u.role) ? u.role : 'student';
      req.session.user = {
        username: u.username || userId,
        safeKey: userId,
        isVip,
        role,
        passwordUpdatedAt: u.password_updated_at || 0,
        roleVersion: typeof u.role_version === 'number' ? u.role_version : 0,
        mfaAt: Date.now(), // step-up: bu login MFA bilan tasdiqlangan
        viaMfa: true,
      };
      req.session.csrfToken = crypto.randomBytes(32).toString('hex');
      req.session.remember = false;
      req.session.lastActiveAt = Date.now();
      req.session.startedAt = Date.now();
      req.session.lastRotatedAt = Date.now();
      delete req.session.pendingMfa;

      recordSession({
        userId,
        sessionId: req.sessionID,
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
        authMethod: 'mfa',
        remember: false,
        role,
        isVip,
      }).catch(() => {});

      logAuthEvent({
        action: AUDIT_ACTIONS.AUTH_LOGIN,
        outcome: 'success',
        method: 'mfa',
        actorId: userId,
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
        details: { factor: result.method },
      }).catch(() => {});

      return res.json({ ok: true, role });
    });
  } catch (err) {
    console.error('MFA verify error:', err.message);
    return res.status(500).json({ ok: false, error: 'server' });
  }
});

/** POST /api/mfa/resend — D-08 §08: yangi challenge (eski challenge consume qilinadi). */
// TOTP kodi autentifikatorda yangilanadi; "resend" = challenge TTL'ni yangilash
// (kod eskirgan/urinish tugagan bo'lsa foydalanuvchi qayta so'ray oladi).
router.post('/api/mfa/resend', authSpanMiddleware('auth.mfa'), async (req, res) => {
  try {
    const { challengeId } = req.body || {};
    const pending = req.session?.pendingMfa;
    if (!pending || !pending.challengeId || !pending.userId) {
      return res.status(401).json({ ok: false, error: 'no_pending_challenge' });
    }
    if (typeof challengeId !== 'string' || challengeId !== pending.challengeId) {
      return res.status(400).json({ ok: false, error: 'challenge_mismatch' });
    }
    const challenge = await readMfaChallenge(challengeId);
    if (!challenge || !challenge.valid || challenge.userId !== pending.userId) {
      delete req.session.pendingMfa;
      return res.status(401).json({ ok: false, error: 'challenge_invalid' });
    }
    // Eski challenge bekor + yangisini yaratamiz (5 daqiqa TTL yangilandi)
    await consumeMfaChallenge(challengeId);
    const newChallengeId = await createMfaChallenge(pending.userId);
    req.session.pendingMfa = { challengeId: newChallengeId, userId: pending.userId, createdAt: Date.now() };
    logAuthEvent({
      action: AUDIT_ACTIONS.MFA_CHALLENGE_RESENT,
      outcome: 'success',
      method: 'mfa',
      actorId: pending.userId,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    }).catch(() => {});
    return res.json({ ok: true, challengeId: newChallengeId });
  } catch (err) {
    console.error('MFA resend error:', err.message);
    return res.status(500).json({ ok: false, error: 'server' });
  }
});

/** GET /api/mfa/status — joriy MFA holati (settings uchun). */
router.get('/api/mfa/status', requireAuth, async (req, res) => {
  try {
    const userId = req.session.user.safeKey;
    const status = await getMfaStatus(userId);
    const remaining = status.status === 'active' ? await backupCodesRemaining(userId) : 0;
    return res.json({ ok: true, ...status, backupCodesRemaining: remaining });
  } catch (err) {
    return res.status(500).json({ ok: false, error: 'server' });
  }
});

/** POST /api/mfa/totp/setup — faza 1: secret + QR. */
router.post('/api/mfa/totp/setup', requireAuth, async (req, res) => {
  try {
    const userId = req.session.user.safeKey;
    const result = await setupTotp(userId, {
      accountName: req.session.user.username || userId,
    });
    if (!result.ok) return res.status(409).json({ ok: false, error: result.error });
    let qr = null;
    try {
      qr = await qrcode.toDataURL(result.otpauth, { width: 240, margin: 1 });
    } catch (_) { /* QR muhim emas — manual key yetarli */ }
    return res.json({ ok: true, secret: result.secret, otpauth: result.otpauth, qr });
  } catch (err) {
    console.error('MFA setup error:', err.message);
    return res.status(500).json({ ok: false, error: 'server' });
  }
});

/** POST /api/mfa/totp/enable — faza 2: birinchi kod → backup codes. */
router.post('/api/mfa/totp/enable', requireAuth, async (req, res) => {
  try {
    const userId = req.session.user.safeKey;
    const { token } = req.body || {};
    if (!token) return res.status(400).json({ ok: false, error: 'required' });
    const result = await enableTotp(userId, String(token).trim());
    if (!result.ok) return res.status(400).json({ ok: false, error: result.error });
    // AUTH D-06 §06: auth_mfa_enabled_total (Prometheus)
    try { recordMetric('auth_mfa_enabled_total', 1, { type: 'counter' }); } catch (_) {}
    // AUTH B-25 §06: MFA yoqilganda boshqa qurilmalardagi sessiyalar revoke
    // (MFA'siz ochiq sessiyalar xavfli) — joriy saqlanadi.
    try {
      await revokeByUser(userId, { exceptSessionId: req.sessionID, reason: 'mfa_enable' });
    } catch (_) { /* non-critical */ }
    return res.json({ ok: true, backupCodes: result.backupCodes });
  } catch (err) {
    return res.status(500).json({ ok: false, error: 'server' });
  }
});

/** POST /api/mfa/totp/disable — reauth talab (sensitive). */
router.post('/api/mfa/totp/disable', requireAuth, requireRecentAuth, async (req, res) => {
  try {
    const userId = req.session.user.safeKey;
    await disableMfa(userId);
    // AUTH B-25 §06/§27: MFA o'chirilganda boshqa qurilmalardagi sessiyalar
    // revoke; joriy sessiya saqlanadi (exceptSessionId — §27).
    try {
      await revokeByUser(userId, { exceptSessionId: req.sessionID, reason: 'mfa_disable' });
    } catch (_) { /* non-critical */ }
    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ ok: false, error: 'server' });
  }
});

/** POST /api/mfa/totp/backup/rotate — eski backup codes invalid. */
router.post('/api/mfa/totp/backup/rotate', requireAuth, requireRecentAuth, async (req, res) => {
  try {
    const userId = req.session.user.safeKey;
    const result = await rotateBackupCodes(userId);
    return res.json({ ok: true, backupCodes: result.backupCodes });
  } catch (err) {
    return res.status(500).json({ ok: false, error: 'server' });
  }
});

/** POST /api/mfa/reset/request — backup code'lar yo'q bo'lsa → 72 soat delay. */
router.post('/api/mfa/reset/request', requireAuth, requireRecentAuth, async (req, res) => {
  try {
    const userId = req.session.user.safeKey;
    const { reason } = req.body || {};
    const result = await requestMfaReset(userId, { reason });
    return res.json({ ok: true, releaseAt: result.releaseAt, delayHours: 72 });
  } catch (err) {
    return res.status(500).json({ ok: false, error: 'server' });
  }
});

// ═══════════════════════════════════════════════════════════════════
// AUTH A-30 §06 — Teacher forced MFA enrollment (privileged mandatory)
// Parol login'da MFA'siz teacher bloklandi → pendingMfaSetup → bu sahifa.
// Birinchi TOTP kod → enableTotp → backup codes → SHUNDAGINA session.
// ═══════════════════════════════════════════════════════════════════
router.get('/user/mfa/setup', async (req, res) => {
  const pending = req.session?.pendingMfaSetup;
  if (!pending?.secret || !pending?.userId) {
    if (req.session?.user) return res.redirect('/user/panel');
    return res.redirect('/user/login');
  }
  // Role — redirect maqsadi uchun (teacher → /teacher)
  let role = 'student';
  try {
    const snap = await fb.get(`users/${safeKey(pending.userId)}/role`);
    role = snap.exists() && snap.val() ? snap.val() : 'student';
  } catch (_) { /* fail-soft */ }
  res.render('user/mfa-setup', {
    title: 'Ikki bosqichli tekshiruv — majburiy',
    secret: pending.secret,
    otpauth: pending.otpauth,
    role,
    error: null,
  });
});

/** POST /api/mfa/setup/confirm — birinchi kod → enable → session beriladi. */
router.post('/api/mfa/setup/confirm', async (req, res) => {
  try {
    const pending = req.session?.pendingMfaSetup;
    if (!pending?.userId || !pending?.secret) {
      return res.status(409).json({ ok: false, error: 'no_pending_setup' });
    }
    const { token } = req.body || {};
    if (!token) return res.status(400).json({ ok: false, error: 'required' });
    const userId = pending.userId;
    const result = await enableTotp(userId, String(token).trim());
    if (!result.ok) {
      return res.status(400).json({ ok: false, error: result.error });
    }
    delete req.session.pendingMfaSetup;

    // ── FAQAT shunda session beriladi (verify flow bilan bir xil) ──
    const snap = await fb.get(`users/${safeKey(userId)}`);
    if (!snap.exists()) {
      return res.status(401).json({ ok: false, error: 'user_not_found' });
    }
    const u = snap.val();

    req.session.regenerate(async (err) => {
      if (err) return res.status(500).json({ ok: false, error: 'session_error' });
      const isVip = u.isVip === true;
      const role = ['student', 'teacher', 'proctor', 'marker', 'board'].includes(u.role) ? u.role : 'student';
      req.session.user = {
        username: u.username || userId,
        safeKey: userId,
        isVip,
        role,
        passwordUpdatedAt: u.password_updated_at || 0,
        roleVersion: typeof u.role_version === 'number' ? u.role_version : 0,
        mfaAt: Date.now(),
        viaMfa: true,
      };
      req.session.csrfToken = crypto.randomBytes(32).toString('hex');
      req.session.remember = false;
      req.session.lastActiveAt = Date.now();
      req.session.startedAt = Date.now();
      req.session.lastRotatedAt = Date.now();

      recordSession({
        userId,
        sessionId: req.sessionID,
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
        authMethod: 'mfa',
        remember: false,
        role,
        isVip,
      }).catch(() => {});
      logAuthEvent({
        action: AUDIT_ACTIONS.AUTH_LOGIN,
        outcome: 'success',
        method: 'mfa',
        actorId: userId,
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
        details: { factor: 'totp', forcedSetup: true },
      }).catch(() => {});
      return res.json({ ok: true, role });
    });
  } catch (err) {
    console.error('MFA setup confirm error:', err.message);
    return res.status(500).json({ ok: false, error: 'server' });
  }
});

export default router;
