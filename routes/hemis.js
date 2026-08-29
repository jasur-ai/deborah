/**
 * Deborah — HEMIS Identity Routes (AUTH A-15)
 * -------------------------------------------
 * REST-first account linking (A-14 da live tasdiqlangan yo'l):
 *   GET  /api/auth/hemis/status   — bog'langanmi (authenticated)
 *   POST /api/auth/hemis/link     — HEMIS login/parol bilan bog'lash (REST)
 *   POST /api/auth/hemis/unlink   — bog'lanishni bekor qilish
 *
 * OAuth2 (faqat OTM HEMIS panelida client yaratilganda — env-gated):
 *   GET  /auth/hemis              — authorize'ga yo'naltirish (state 32B)
 *   GET  /auth/hemis/callback     — code → token → user → link
 *
 * SECURITY:
 *   - HEMIS paroli HECH QACHON saqlanmaydi/log'ga chiqmaydi.
 *   - Rate limit 10/15 daqiqa per IP + per user (checkLinkLimit).
 *   - hemis_id unique — bitta HEMIS akkaunt bitta Deborah akkauntiga
 *     (users_hemis_index mapping; IDOR/account takeover guard).
 *   - CSRF: global validateCsrf (x-csrf-token yoki _csrf) barcha POST'da.
 *   - OAuth callback state — session'dagi qiymat bilan solishtiriladi.
 */

import crypto from 'crypto';
import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { safeKey } from '../utils/helpers.js';
import { logAuthEvent, AUDIT_ACTIONS } from '../src/modules/auth/audit.js';
import { fb } from '../firebase/admin.js';
import {
  isRestEnabled,
  isOAuthConfigured,
  linkAccount,
  checkLinkLimit,
  buildOAuthAuthorizeUrl,
  exchangeOAuthCode,
  fetchOAuthUser,
} from '../src/modules/auth/providers/hemis.js';

const router = Router();

// C-02 qarori: auth hodisalari `auth_audit`'ga yoziladi (A-03 kontrakti + C-09
// audit dashboard o'sha joyni o'qiydi) — `audit()` PG audit_log'ga yozadi, emas.
const hemisAudit = (action, req, extra = {}, outcome = 'failed') =>
  logAuthEvent({
    action,
    outcome,
    method: 'hemis',
    actorId: req.session?.user?.safeKey || null,
    ipAddress: req.ip,
    userAgent: req.headers['user-agent'],
    details: extra,
    channel: 'hemis',
  }).catch(() => {});

const render404 = (res) =>
  res.status(404).render('error', { title: '404', message: 'Sahifa topilmadi', status: 404 });

// ── Session rotation (C-10 §12): identity link'da sessiya ID yangilanadi ──
// (session fixation/hijack guard). Foydalanuvchi allaqachon tizimda —
// sessiya user'ini saqlab, faqat ID + CSRF token aylantiriladi.
async function rotateSession(req) {
  const userSnapshot = req.session.user ? { ...req.session.user } : null;
  await new Promise((resolve, reject) =>
    req.session.regenerate((err) => (err ? reject(err) : resolve()))
  );
  if (userSnapshot) req.session.user = userSnapshot;
  // Yangi bo'sh sessiya — CSRF token'ni qayta o'rnatamiz, aks holda keyingi
  // POST'lar 403 qaytaradi (client response'dan yangi token'ni oladi).
  req.session.csrfToken = crypto.randomBytes(32).toString('hex');
  req.session.lastActiveAt = Date.now();
  req.session.lastRotatedAt = Date.now();
  return req.session.csrfToken;
}

// ── TOCTOU guard: per-hemisId in-process lock ──
// Index check-write atomik emas (local-db'da transaction yo'q) — ikkita
// parallel link bir xil hemis_id ni bog'lamasligi uchun promise-chain lock.
// Postgres'da migration 050 UNIQUE constraint qo'shimcha himoya.
const hemisLocks = new Map(); // safeKey(hemisId) → promise
function withHemisLock(hemisId, fn) {
  const key = safeKey(String(hemisId));
  const prev = hemisLocks.get(key) || Promise.resolve();
  const next = prev.then(fn, fn);
  hemisLocks.set(key, next);
  const cleanup = () => {
    if (hemisLocks.get(key) === next) hemisLocks.delete(key);
  };
  next.then(cleanup, cleanup);
  return next;
}

// ── Status (authenticated) ──
router.get('/api/auth/hemis/status', requireAuth, async (req, res) => {
  try {
    const userKey = req.session.user.safeKey;
    const snap = await fb.get(`users/${userKey}/hemis`);
    const linked = snap.exists();
    const h = linked ? snap.val() : null;
    res.json({
      restEnabled: isRestEnabled(),
      oauthConfigured: isOAuthConfigured(),
      linked,
      profile: h
        ? {
            fullName: h.fullName,
            university: h.university,
            group: h.group,
            specialty: h.specialty,
            linkedAt: h.linkedAt,
            source: h.source,
          }
        : null,
    });
  } catch {
    res.status(500).json({ error: 'internal' });
  }
});

// ── Link (REST — HEMIS login/parol bilan) ──
router.post('/api/auth/hemis/link', requireAuth, async (req, res) => {
  if (!isRestEnabled()) return res.status(404).json({ error: 'disabled' });

  const { login, password } = req.body || {};
  if (typeof login !== 'string' || typeof password !== 'string' || !login.trim() || !password) {
    return res.status(400).json({ error: 'login_and_password_required' });
  }

  const userKey = req.session.user.safeKey;
  const limit = checkLinkLimit(req.ip || 'unknown', userKey);
  if (!limit.allowed) {
    await hemisAudit(AUDIT_ACTIONS.HEMIS_LINK_FAIL, req, {
      reason: 'rate_limited',
      retryAfterSeconds: limit.retryAfterSeconds,
    });
    return res
      .status(429)
      .json({ error: 'too_many_attempts', retryAfterSeconds: limit.retryAfterSeconds });
  }

  let profile;
  try {
    // Parol faqat bu chaqiruv ichida ishlatiladi — hech qayerda saqlanmaydi.
    profile = await linkAccount({ login: login.trim(), password });
  } catch (err) {
    const status =
      err.code === 'invalid_credentials' ? 401 : err.code === 'geofence' ? 451 : 502;
    await hemisAudit(AUDIT_ACTIONS.HEMIS_LINK_FAIL, req, { reason: err.code || 'unknown' });
    return res.status(status).json({ error: err.code || 'unreachable' });
  }

  // Unique hemis_id — IDOR/account takeover guard (TOCTOU xavfsiz: lock ichida)
  try {
    await withHemisLock(profile.hemisId, async () => {
      const idx = await fb.get(`users_hemis_index/${safeKey(profile.hemisId)}`);
      if (idx.exists() && idx.val() !== userKey) {
        await hemisAudit(AUDIT_ACTIONS.HEMIS_LINK_FAIL, req, { reason: 'hemis_id_already_linked' });
        const conflict = new Error('hemis already linked');
        conflict.httpStatus = 409;
        throw conflict;
      }
      await fb.update(`users/${userKey}/hemis`, {
      hemisId: profile.hemisId,
      fullName: profile.fullName,
      university: profile.university,
      universityId: profile.universityId || '',
      specialty: profile.specialty,
      faculty: profile.faculty,
      group: profile.group,
      semester: profile.semester,
      email: profile.email,
      phone: profile.phone,
      source: 'rest',
      linkedAt: Date.now(),
    });
    await fb.set(`users_hemis_index/${safeKey(profile.hemisId)}`, userKey);
    await hemisAudit(AUDIT_ACTIONS.HEMIS_LINKED, req, { hemisId: profile.hemisId }, 'success');
    });
    // C-10 §12: session rotation (identity link'dan keyin) + yangi CSRF token
    const newCsrf = await rotateSession(req);
    res.json({
      success: true,
      csrfToken: newCsrf,
      profile: {
        fullName: profile.fullName,
        university: profile.university,
        group: profile.group,
        specialty: profile.specialty,
      },
    });
  } catch (err) {
    if (err && err.httpStatus === 409) {
      return res.status(409).json({ error: 'hemis_already_linked' });
    }
    res.status(500).json({ error: 'internal' });
  }
});

// ── Unlink ──
router.post('/api/auth/hemis/unlink', requireAuth, async (req, res) => {
  const userKey = req.session.user.safeKey;
  const snap = await fb.get(`users/${userKey}/hemis`);
  if (snap.exists()) {
    await fb.remove(`users_hemis_index/${safeKey(snap.val().hemisId)}`);
    await fb.remove(`users/${userKey}/hemis`);
    await hemisAudit(AUDIT_ACTIONS.HEMIS_UNLINKED, req, {}, 'success');
  }
  res.json({ success: true });
});

// ── OAuth2 start (faqat OTM client bo'lganda) ──
router.get('/auth/hemis', (req, res) => {
  if (!isOAuthConfigured()) return render404(res);
  const limit = checkLinkLimit(req.ip || 'unknown', 'oauth-start');
  if (!limit.allowed) {
    return res.status(429).render('error', {
      title: '429',
      message: `Ko'p so'rov yuborildi — ${limit.retryAfterSeconds}s keyin qayta urinib ko'ring`,
      status: 429,
    });
  }
  const state = crypto.randomBytes(32).toString('hex');
  req.session.hemisOAuthState = state;
  res.redirect(buildOAuthAuthorizeUrl(state));
});

// ── OAuth2 callback (faqat OTM client bo'lganda) ──
router.get('/auth/hemis/callback', async (req, res) => {
  if (!isOAuthConfigured()) return render404(res);

  const { code, state, error } = req.query;
  if (error) return res.redirect('/user/login?error=hemis_denied');

  // State validation — CSRF analogi (auth code injection guard)
  if (!state || !req.session.hemisOAuthState || state !== req.session.hemisOAuthState) {
    await hemisAudit(AUDIT_ACTIONS.HEMIS_LINK_FAIL, req, { reason: 'state_mismatch' });
    return res.redirect('/user/login?error=hemis_state');
  }
  delete req.session.hemisOAuthState;

  try {
    const tokens = await exchangeOAuthCode(String(code || ''));
    const profile = await fetchOAuthUser(tokens.access_token);

    // Link uchun avval tizimga kirish kerak (account-creation UI bilan birga
    // OTM client ishga tushganda quriladi — hozircha xavfsiz yo'naltirish).
    if (!req.session.user) {
      return res.redirect('/user/login?next=/auth/hemis&error=hemis_need_login');
    }

    const userKey = req.session.user.safeKey;
    await withHemisLock(profile.hemisId, async () => {
      const idx = await fb.get(`users_hemis_index/${safeKey(profile.hemisId)}`);
      if (idx.exists() && idx.val() !== userKey) {
        await hemisAudit(AUDIT_ACTIONS.HEMIS_LINK_FAIL, req, { reason: 'hemis_id_already_linked' });
        throw new Error('hemis_linked_elsewhere');
      }
      await fb.update(`users/${userKey}/hemis`, {
        hemisId: profile.hemisId,
        fullName: profile.fullName,
        universityId: profile.universityId || '',
        email: profile.email,
        source: 'oauth',
        linkedAt: Date.now(),
      });
      await fb.set(`users_hemis_index/${safeKey(profile.hemisId)}`, userKey);
    });
    await hemisAudit(AUDIT_ACTIONS.HEMIS_LINKED, req, { hemisId: profile.hemisId, source: 'oauth' }, 'success');
    await rotateSession(req);
    res.redirect('/user/panel?hemis=linked');
  } catch (err) {
    if (err && err.message === 'hemis_linked_elsewhere') {
      await hemisAudit(AUDIT_ACTIONS.HEMIS_LINK_FAIL, req, { reason: 'hemis_id_already_linked' });
      return res.redirect('/user/panel?error=hemis_linked_elsewhere');
    }
    await hemisAudit(AUDIT_ACTIONS.HEMIS_LINK_FAIL, req, { reason: err.code || 'unknown' });
    res.redirect('/user/login?error=hemis_callback');
  }
});

export default router;
