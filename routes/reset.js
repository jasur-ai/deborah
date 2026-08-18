/**
 * Edikit — Parol tiklash (plan_login §5 — Ekran 2 & 3, AUTH A-06)
 * --------------------------------------------------------------
 * HTML:
 *   GET  /user/reset?token=... → token verify: valid → yangi parol formasi,
 *                                yaroqsiz/eskirgan → "Yangi havola oling".
 *   POST /user/reset            → yangi parol: token tekshir → Argon2 rehash →
 *                                 barcha tokenlar invalid → eski sessiyalar revoke →
 *                                 avtomatik login → role bo'yicha redirect.
 * JSON API (AUTH A-06 §7):
 *   POST /api/reset/request     → { account } → har doim bir xil javob (enumeration)
 *   POST /api/reset/verify      → { token }    → valid | expired | invalid
 *   POST /api/reset/complete    → { token, password } → avtomatik login
 *
 * Xavfsizlik (AUTH A-06):
 *   - Token hash'lab saqlanadi (resetTokens/{tokenHash} → { safeKey }) —
 *     DB kompromat bo'lsa ham havola ishlatib bo'lmaydi.
 *   - 15 daqiqa amal qiladi, bitta foydalanish.
 *   - Complete: BARCHA eski tokenlar invalid (resetTokensByUser index) —
 *     guide §14; eski sessiyalar revoke — guide §15.
 *   - Parol: min 8 + 1 harf + 1 raqam (Zod resetCompleteSchema, server authoritative).
 *   - Audit: auth.reset.request / auth.reset.complete; token/parol hech qachon logga.
 *   - CSRF: global validateCsrf POST'larda faol.
 */

import { Router } from 'express';
import crypto from 'crypto';
import { fb } from '../firebase/admin.js';
import { safeKey, hashPassword } from '../utils/helpers.js';
import { evaluatePassword } from '../src/modules/auth/password-policy.js';
import { isPasswordBreached } from '../src/modules/auth/hibp.js';
import { redirectIfAuth } from '../middleware/auth.js';
import { audit, AUDIT_ACTIONS, logAuthEvent } from '../src/modules/auth/audit.js';
import { revokeByUser } from '../src/modules/auth/session-manager.js';
import { AUTH_COPY, AUTH_LANGS, resolveAuthLang } from '../data/auth-i18n.js';
import { parseResetRequest, parseResetComplete } from '../src/modules/auth/validation.js';
// AUTH A-06: metrikalar — reset_start, reset_complete, sessions_revoked_after_reset
import { recordMetric } from '../src/telemetry/index.js';
import { authSpanMiddleware } from '../src/telemetry/spans.js'; // AUTH D-05

const router = Router();

const RESET_TTL_MS = 15 * 60 * 1000;
// Token yaratishda ikkala path'ga yozamiz:
//   resetTokens/{tokenHash}                    → { safeKey, expiresAt } (verify)
//   resetTokensByUser/{safeKey}/{tokenHash}    → true (user uchun barchasini topish — A-06 §14)
const RESET_TOKEN_PATH = 'resetTokens';
const RESET_TOKEN_USER_PATH = 'resetTokensByUser';

function tokenHash(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function renderReset(res, opts) {
  const {
    state = 'valid', // valid | invalid | expired | success
    lang = 'uz',
    error = null,
    token = null,
    redirectUrl = null,
  } = opts || {};
  const l = resolveAuthLang(lang);
  res.render('user/reset', {
    title: AUTH_COPY[l].meta.title,
    description: AUTH_COPY[l].meta.description,
    lang: l,
    AUTH_LANGS,
    copy: AUTH_COPY[l],
    state,
    error,
    token,
    redirectUrl,
  });
}

/** Token → { safeKey } | null (valid + 15 daqiqa ichida). */
async function findValidToken(token) {
  if (!token || typeof token !== 'string') return null;
  const hash = tokenHash(token);
  const snap = await fb.get(`${RESET_TOKEN_PATH}/${hash}`);
  if (!snap.exists()) return null;
  const rec = snap.val();
  if (!rec || typeof rec.safeKey !== 'string') return null;
  if (Date.now() > (rec.expiresAt || 0)) {
    // Eskirgan token'ni tozalaymiz (lazy cleanup) — index'dan ham
    await fb.remove(`${RESET_TOKEN_PATH}/${hash}`).catch(() => {});
    await fb.remove(`${RESET_TOKEN_USER_PATH}/${rec.safeKey}/${hash}`).catch(() => {});
    return { expired: true, safeKey: rec.safeKey };
  }
  return { expired: false, safeKey: rec.safeKey, hash };
}

/**
 * Yangi reset token yaratadi (AUTH A-06 §6/§9).
 * @returns {{ token: string }} — plain token (havolada), DB'da hash saqlanadi
 */
async function createResetToken(userKey) {
  const token = crypto.randomBytes(48).toString('hex'); // 96 belgi
  const hash = tokenHash(token);
  const expiresAt = Date.now() + RESET_TTL_MS;
  await fb.set(`${RESET_TOKEN_PATH}/${hash}`, {
    safeKey: userKey,
    expiresAt,
    createdAt: Date.now(),
  });
  // User index — complete'da BARCHA tokenlarni invalidatsiya qilish uchun (A-06 §14)
  await fb.set(`${RESET_TOKEN_USER_PATH}/${userKey}/${hash}`, true);
  return token;
}

/**
 * User'ning BARCHA reset tokenlarini invalidatsiya qiladi (A-06 §14).
 * Complete'da chaqiriladi — bitta token ishlatilgach qolganlari ham o'ladi.
 * Legacy/retro-compat: index'ga yozilmagan tokenlar ham (currentHash) o'chiriladi.
 * @param {string} currentHash — hozir ishlatilgan token hash (har doim o'chiriladi)
 * @returns {Promise<number>} invalid qilingan tokenlar soni
 */
async function invalidateAllUserTokens(userKey, currentHash) {
  let removed = 0;
  const userTokensPath = `${RESET_TOKEN_USER_PATH}/${userKey}`;
  const snap = await fb.get(userTokensPath);
  const hashes = snap.exists() ? Object.keys(snap.val() || {}) : [];
  // Joriy token index'da bo'lmasa ham o'chiriladi (eski testlar/indexsiz tokenlar)
  if (currentHash && !hashes.includes(currentHash)) hashes.push(currentHash);
  for (const h of hashes) {
    await fb.remove(`${RESET_TOKEN_PATH}/${h}`).catch(() => {});
    removed++;
  }
  await fb.remove(userTokensPath).catch(() => {});
  return removed;
}

// ── Ekran 2: link bilan kelganda ──
router.get('/user/reset', redirectIfAuth, async (req, res) => {
  const lang = resolveAuthLang(req.query.lang || req.cookies?.lang);
  const result = await findValidToken(req.query.token);

  if (!result) {
    return renderReset(res, { state: 'invalid', lang });
  }
  if (result.expired) {
    return renderReset(res, { state: 'expired', lang });
  }
  return renderReset(res, { state: 'valid', lang, token: req.query.token });
});

// ── Ekran 2 → 3: yangi parolni saqlash ──
router.post('/user/reset', redirectIfAuth, async (req, res) => {
  const { token, password } = req.body;
  const lang = resolveAuthLang(req.body.lang || req.query.lang || req.cookies?.lang);
  const copy = AUTH_COPY[lang];

  // AUTH A-06 §17: Zod — token + parol validatsiyasi (server authoritative)
  // Token yo'q / yaroqsiz → invalid holat (forma qayta ko'rsatilmaydi);
  // faqat parol xatosi → forma + inline error.
  if (!token || typeof token !== 'string' || token.length < 48) {
    return renderReset(res, { state: 'invalid', lang });
  }
  const parsed = parseResetComplete({ token, password });
  if (!parsed.ok) {
    return renderReset(res, {
      state: 'valid', lang,
      error: copy.errors[parsed.errorKey] || copy.errors.required,
      token,
    });
  }

  const result = await findValidToken(parsed.token);

  if (!result) {
    return renderReset(res, { state: 'invalid', lang });
  }
  if (result.expired) {
    return renderReset(res, { state: 'expired', lang });
  }

  try {
    const userKey = safeKey(result.safeKey);
    // AUTH A-22: NIST parol siyosati (dynamic min; teacher uchun zxcvbn >= 4)
    const preSnap22 = await fb.get(`users/${userKey}`);
    const preData22 = preSnap22.exists() ? preSnap22.val() : {};
    const pol = evaluatePassword(parsed.password, {
      mfa: !!preData22.twofa_enabled,
      requireStrong: ['teacher', 'admin'].includes(preData22.role),
    });
    if (!pol.ok) {
      await invalidateAllUserTokens(userKey, result.hash).catch(() => {});
      audit({
        action: AUDIT_ACTIONS.PASSWORD_POLICY_REJECT,
        outcome: 'blocked',
        userId: userKey,
        resourceType: 'user',
        details: { reason: pol.reason, score: pol.score, method: 'link' },
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      }).catch(() => {});
      return renderReset(res, { state: 'invalid', lang: req.query.lang });
    }
    const hibp22 = await isPasswordBreached(parsed.password);
    if (hibp22.breached) {
      await invalidateAllUserTokens(userKey, result.hash).catch(() => {});
      audit({
        action: AUDIT_ACTIONS.BREACH_PASSWORD_BLOCKED,
        outcome: 'blocked',
        userId: userKey,
        resourceType: 'user',
        details: { checked: hibp22.checked, method: 'link' },
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      }).catch(() => {});
      return renderReset(res, { state: 'invalid', lang: req.query.lang });
    }
    const newHash = await hashPassword(parsed.password);
    await fb.set(`users/${userKey}/password`, newHash);
    await fb.set(`users/${userKey}/password_updated_at`, Date.now());
    // AUTH A-06 §14: barcha tokenlar invalid — shu token ham (bitta foydalanish)
    const invalidated = await invalidateAllUserTokens(userKey, result.hash);

    // AUTH A-06 §24: metrikalar
    try {
      recordMetric('auth.reset.complete', 1, { type: 'counter' });
    } catch (_) { /* telemetry fail-soft */ }

    // Audit: parol tiklash muvaffaqiyatli
    await audit({
      action: AUDIT_ACTIONS.RESET_COMPLETE,
      userId: userKey,
      resourceType: 'user',
      details: { method: 'link', safeKey: userKey, invalidatedTokens: invalidated },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    }).catch(() => {});
    logAuthEvent({
      action: AUDIT_ACTIONS.AUTH_RESET_COMPLETE,
      outcome: 'success',
      method: 'link',
      actorId: userKey,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    }).catch(() => {});

    // ── Avtomatik login (Ekran 3: success) ──
    req.session.regenerate(async (err) => {
      if (err) {
        return renderReset(res, { state: 'valid', lang, error: copy.errors.session, token });
      }
      const userSnap = await fb.get(`users/${userKey}`);
      const userData = userSnap.exists() ? userSnap.val() : {};
      const role = userData.role && ['student', 'teacher', 'proctor', 'marker', 'board'].includes(userData.role)
        ? userData.role
        : 'student';

      req.session.user = {
        username: userData.username || userKey,
        safeKey: userKey,
        isVip: userData.isVip === true,
        role,
        passwordUpdatedAt: userData.password_updated_at || Date.now(),
      };
      // regenerate() yangi bo'sh sessiya — CSRF token'ni qayta o'rnatamiz
      req.session.csrfToken = crypto.randomBytes(32).toString('hex');

      // AUTH A-06 §15 + B-25: eski sessiyalar revoke (yangi session current —
      // qoladi) — server-side store destroy (Redis/Memory) + local DB tracking.
      try {
        const revoked = await revokeByUser(userKey, { exceptSessionId: req.sessionID, reason: 'password_reset' });
        if (revoked.count > 0) {
          recordMetric('auth.reset.sessions_revoked', revoked.count, { type: 'counter' })?.catch?.(() => {});
          audit({
            action: AUDIT_ACTIONS.RESET_COMPLETE,
            userId: userKey,
            resourceType: 'session',
            details: { revokedSessions: revoked.count, type: 'after_reset' },
            ipAddress: req.ip,
            userAgent: req.headers['user-agent'],
          }).catch(() => {});
        }
      } catch (_) { /* non-critical */ }

      // Ekran 3: muvaffaqiyat ekrani ko'rsatib, keyin role bo'yicha redirect
      // (reja §5 Ekran 3 — "Parol yangilandi ✓"). Auto-redirect 2.5s.
      return renderReset(res, {
        state: 'success',
        lang,
        redirectUrl: role === 'teacher' ? '/teacher' : '/user/panel',
      });
    });
  } catch (err) {
    console.error('Reset error:', err);
    return renderReset(res, { state: 'valid', lang, error: copy.errors.server, token });
  }
});

// ═══════════════════════════════════════════════════════════════
// AUTH A-06 §7: JSON API route'lar (forgot formasi AJAX'da ishlatadi)
// ═══════════════════════════════════════════════════════════════

/** Enumeration-safe javob — account mavjud bo'lmasa ham bir xil. */
function genericResetOk() {
  return { ok: true, message: 'reset.sent' };
}

// POST /api/reset/request — { account } → token yaratish (yoki generic javob)
// AUTH A-20: account username YOKI email bo'lishi mumkin; verified email shart.
router.post('/api/reset/request',
  authSpanMiddleware('auth.reset', (req) => ({ 'reset.step': 'request' })),
  redirectIfAuth, async (req, res) => {
  const parsed = parseResetRequest(req.body || {});
  if (!parsed.ok) {
    return res.status(400).json({ ok: false, code: parsed.errorKey });
  }

  try {
    // AUTH A-03: reset limit — 3/soat per account.
    // MUHIM: limit existence check'dan OLDIN tekshiriladi — mavjud va mavjud
    // bo'lmagan akkauntga bir xil (429) javob qaytadi. Aks holda attacker
    // candidate nomlarni urib, 429 kelganini topib enumeration qilardi.
    const { checkResetLimit, recordResetRequest } = await import('../src/modules/auth/lockout.js');
    const limit = checkResetLimit(parsed.account);
    if (!limit.allowed) {
      return res.status(429).json({
        ok: false, code: 'RATE_LIMITED', retryAfter: limit.retryAfterSeconds,
      });
    }
    recordResetRequest(parsed.account);

    // AUTH A-20 §07: username OR email lookup (users_email_index orqali)
    const { resolveAccountToUserKey } = await import('../src/modules/auth/email-verify.js');
    const { userKey } = await resolveAccountToUserKey(parsed.account);

    // AUTH A-06 §10: javob HAR DOIM bir xil (enumeration himoya)
    if (!userKey) {
      // Timing side-channel: mavjud user yo'li (token yozish + audit) taxminan
      // shuncha vaqt oladi — padding'ni kalibrlangan holda bir xil qilamiz.
      await new Promise((r) => setTimeout(r, 250));
      return res.json(genericResetOk());
    }

    const userSnap = await fb.get(`users/${userKey}`);
    const userData = userSnap.exists() ? userSnap.val() : {};

    // AUTH A-20 §08/§09: email_verified=true bo'lsagina reset token yuboriladi.
    // Verified bo'lmagan → token YO'Q (javob bir xil); user login'da
    // A-18 verify banner orqali emailni tasdiqlaydi. Legacy (email yo'q) →
    // ham generic javob (support yo'li login'da). Enumeration ochilmaydi.
    if (!(userData.email && userData.email_verified === true)) {
      logAuthEvent({
        action: AUDIT_ACTIONS.AUTH_RESET_REQUEST,
        outcome: 'blocked',
        method: 'link',
        actorId: userKey,
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
        details: { reason: 'email_not_verified' },
      }).catch(() => {});
      await new Promise((r) => setTimeout(r, 120));
      return res.json(genericResetOk());
    }

    const token = await createResetToken(userKey);

    // AUTH B-31: reset email navbatga (urgent) — send async, worker to'kadi.
    // PII: job'da plaintext email YO'Q — faqat userKey + resetUrl (single-use
    // 30 daqiqalik capability havola; token audit/log'ga chiqmaydi — A-17).
    // Idempotency: token hash asosi — bir xil token ikki marta enqueue emas.
    const lang = String(req.query.lang || req.body.lang || 'uz');
    const { enqueueEmail } = await import('../src/modules/email/queue.js');
    const resetUrl = `${req.protocol}://${req.get('host')}/user/reset?token=${token}`;
    const tHash = tokenHash(token);
    await enqueueEmail({
      template: 'reset',
      data: { userKey, lang, resetUrl },
      priority: 'urgent',
      idempotencyKey: `reset:${userKey}:${tHash.slice(0, 12)}`,
      tag: 'reset',
    }).catch((err) => console.warn('[email:reset] enqueue failed:', err?.message || err));
    // Timing: provider round-trip o'rniga kalibrlangan padding — mavjud user
    // yo'li mavjud bo'lmagan yo'ldan (250ms) hali ham sekinroq (enumeration yo'q).
    await new Promise((r) => setTimeout(r, 300));

    recordMetric('auth.reset.request', 1, { type: 'counter' })?.catch?.(() => {});
    logAuthEvent({
      action: AUDIT_ACTIONS.AUTH_RESET_REQUEST,
      outcome: 'success',
      method: 'link',
      actorId: userKey,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    }).catch(() => {});

    // Dev/test: token havolasi LOG'GA CHIQARILMAYDI (A-17 PII scan —
    // log/audit'da token bo'lmasligi shart). Preview response'da qaytariladi
    // (production'da hech qachon chiqmaydi).
    const devPreview =
      process.env.NODE_ENV !== 'production' ? `/user/reset?token=${token}` : undefined;
    return res.json({ ...genericResetOk(), devPreview });
  } catch (err) {
    console.error('Reset API error:', err);
    return res.status(500).json({ ok: false, code: 'server' });
  }
});

// POST /api/reset/verify — { token } → valid | expired | invalid
router.post('/api/reset/verify',
  authSpanMiddleware('auth.reset', (req) => ({ 'reset.step': 'verify' })),
  redirectIfAuth, async (req, res) => {
  const { token } = req.body || {};
  if (!token || typeof token !== 'string') {
    return res.status(400).json({ ok: false, code: 'tokenInvalid' });
  }
  const result = await findValidToken(token);
  if (!result) return res.json({ ok: false, code: 'invalid' });
  if (result.expired) return res.json({ ok: false, code: 'expired' });
  return res.json({ ok: true, code: 'valid' });
});

// POST /api/reset/complete — { token, password } → avtomatik login (session cookie)
router.post('/api/reset/complete',
  authSpanMiddleware('auth.reset', (req) => ({ 'reset.step': 'complete' })),
  redirectIfAuth, async (req, res) => {
  const parsed = parseResetComplete(req.body || {});
  if (!parsed.ok) {
    return res.status(400).json({ ok: false, code: parsed.errorKey });
  }

  const result = await findValidToken(parsed.token);
  if (!result) return res.status(410).json({ ok: false, code: 'RESET_TOKEN_INVALID' });
  if (result.expired) return res.status(410).json({ ok: false, code: 'RESET_TOKEN_EXPIRED' });

  try {
    const userKey = safeKey(result.safeKey);
    // AUTH A-20 defense-in-depth: token'lar faqat email_verified=true userlarga
    // beriladi; complete'da ham qayta tekshiramiz — legacy/edited record'da
    // token bo'lsa ham parol almashtirib bo'lmaydi. Token'ni ham o'ldiramiz.
    const preSnap = await fb.get(`users/${userKey}`);
    const preData = preSnap.exists() ? preSnap.val() : {};
    if (!(preData.email && preData.email_verified === true)) {
      await invalidateAllUserTokens(userKey, result.hash).catch(() => {});
      logAuthEvent({
        action: AUDIT_ACTIONS.AUTH_RESET_COMPLETE,
        outcome: 'blocked',
        method: 'link',
        actorId: userKey,
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
        details: { reason: 'email_not_verified' },
      }).catch(() => {});
      return res.status(403).json({ ok: false, code: 'RESET_EMAIL_NOT_VERIFIED' });
    }
    // AUTH A-22: NIST parol siyosati (dynamic min — user.twofa_enabled bo'lsa 8)
    const pol = evaluatePassword(parsed.password, {
      mfa: !!preData.twofa_enabled,
      requireStrong: ['teacher', 'admin'].includes(preData.role),
    });
    if (!pol.ok) {
      await invalidateAllUserTokens(userKey, result.hash).catch(() => {});
      audit({
        action: AUDIT_ACTIONS.PASSWORD_POLICY_REJECT,
        outcome: 'blocked',
        userId: userKey,
        resourceType: 'user',
        details: { reason: pol.reason, score: pol.score, method: 'api' },
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      }).catch(() => {});
      return res.status(400).json({ ok: false, code: 'RESET_PASSWORD_WEAK' });
    }
    // AUTH A-22: HIBP breach check (k-anonymity; test/offline → fail-open)
    const hibp = await isPasswordBreached(parsed.password);
    if (hibp.breached) {
      await invalidateAllUserTokens(userKey, result.hash).catch(() => {});
      audit({
        action: AUDIT_ACTIONS.BREACH_PASSWORD_BLOCKED,
        outcome: 'blocked',
        userId: userKey,
        resourceType: 'user',
        details: { checked: hibp.checked, method: 'api' },
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      }).catch(() => {});
      return res.status(400).json({ ok: false, code: 'RESET_PASSWORD_BREACHED' });
    }
    const newHash = await hashPassword(parsed.password);
    await fb.set(`users/${userKey}/password`, newHash);
    await fb.set(`users/${userKey}/password_updated_at`, Date.now());
    const invalidated = await invalidateAllUserTokens(userKey, result.hash);
    recordMetric('auth.reset.complete', 1, { type: 'counter' })?.catch?.(() => {});
    await audit({
      action: AUDIT_ACTIONS.RESET_COMPLETE,
      userId: userKey,
      resourceType: 'user',
      details: { method: 'api', safeKey: userKey, invalidatedTokens: invalidated },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    }).catch(() => {});
    logAuthEvent({
      action: AUDIT_ACTIONS.AUTH_RESET_COMPLETE,
      outcome: 'success',
      method: 'link',
      actorId: userKey,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    }).catch(() => {});

    // ── Avtomatik login (yangi sessiya — A-06 §15) ──
    req.session.regenerate(async (err) => {
      if (err) {
        return res.status(500).json({ ok: false, code: 'session' });
      }
      const userSnap = await fb.get(`users/${userKey}`);
      const userData = userSnap.exists() ? userSnap.val() : {};
      const role = userData.role && ['student', 'teacher', 'proctor', 'marker', 'board'].includes(userData.role)
        ? userData.role
        : 'student';

      req.session.user = {
        username: userData.username || userKey,
        safeKey: userKey,
        isVip: userData.isVip === true,
        role,
        passwordUpdatedAt: userData.password_updated_at || Date.now(),
      };
      req.session.csrfToken = crypto.randomBytes(32).toString('hex');

      // Eski sessiyalar revoke (yangi session current — qoladi) — B-25 server-side
      try {
        const revoked = await revokeByUser(userKey, { exceptSessionId: req.sessionID, reason: 'password_reset' });
        if (revoked.count > 0) {
          recordMetric('auth.reset.sessions_revoked', revoked.count, { type: 'counter' })?.catch?.(() => {});
        }
      } catch (_) { /* non-critical */ }

      return res.json({ ok: true, redirect: role === 'teacher' ? '/teacher' : '/user/panel' });
    });
  } catch (err) {
    console.error('Reset API complete error:', err);
    return res.status(500).json({ ok: false, code: 'server' });
  }
});

export default router;
