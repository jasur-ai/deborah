/**
 * AUTH B-24 — Email change flow (reauth + double opt-in)
 * ------------------------------------------------------
 * GET  /user/email-change            — email change UI (banner + form)
 * POST /api/account/email/request    — reauth (requireRecentAuth) + newEmail
 *                                      validatsiya + rate 3/soat + ikkala verify
 * POST /api/account/email/confirm    — newCode + oldToken → commit
 * POST /api/account/email/cancel     — eski email tokeni bilan bekor qilish
 * GET  /api/account/email/status     — pending change holati (UI banner)
 *
 * Security: reauth shart (§06/§11), ikkala verify (§07), CSRF + audit (§29).
 */
import { Router } from 'express';
import { requireAuth, requireRecentAuth, requireMfaStepUp, requireLowRisk } from '../middleware/auth.js';
import { fb } from '../firebase/admin.js';
import { safeKey } from '../utils/helpers.js';
import { revokeByUser } from '../src/modules/auth/session-manager.js';
import { AUTH_COPY, resolveAuthLang } from '../data/auth-i18n.js';
import {
  requestEmailChange,
  confirmEmailChange,
  cancelEmailChange,
  getEmailChangeStatus,
} from '../src/modules/auth/email-change.js';

const router = Router();

// Auth himoyasi — faqat o'z yo'llari (B-21 pattern)
router.use((req, res, next) => {
  const p = req.path;
  if (
    p === '/user/email-change' ||
    p === '/api/account/email/request' ||
    p === '/api/account/email/confirm' ||
    p === '/api/account/email/cancel' ||
    p === '/api/account/email/status'
  ) {
    return requireAuth(req, res, next);
  }
  next();
});

// ── UI sahifasi ──
router.get('/user/email-change', async (req, res) => {
  try {
    // BUG-085 (S14): req OBYEKTI berilardi → doim 'uz'; endi query/cookie
    const lang = resolveAuthLang(req.query?.lang || req.cookies?.lang);
    const copy = AUTH_COPY[lang] || AUTH_COPY.uz;
    const user = req.session.user;
    const status = await getEmailChangeStatus(user.safeKey);
    return res.render('user/email-change', {
      layout: false,
      lang,
      user,
      emailCopy: copy.emailChange || {},
      copy, // S14 (BUG-087): sidebar/theme-control 4 til
      pending: status,
      __csrf: res.locals.csrfToken || null,
    });
  } catch (err) {
    console.error('[email-change] GET failed:', err?.message || err);
    return res.status(500).send('internal');
  }
});

// ── Status (banner uchun) ──
router.get('/api/account/email/status', async (req, res) => {
  try {
    const status = await getEmailChangeStatus(req.session.user.safeKey);
    return res.json({ ok: true, pending: status || null });
  } catch (err) {
    console.error('[email-change] status failed:', err?.message || err);
    return res.status(500).json({ ok: false, error: 'internal' });
  }
});

// ── Request: reauth + validatsiya + ikkala verify (§06) ──
router.post('/api/account/email/request', requireRecentAuth, requireLowRisk, requireMfaStepUp, async (req, res) => {
  try {
    const { newEmail } = req.body || {};
    const userKey = req.session.user?.safeKey;
    if (!userKey) return res.status(401).json({ ok: false, error: 'unauthorized' });
    const result = await requestEmailChange({ userKey, newEmail, lang: resolveAuthLang(req) });
    if (!result.ok) {
      return res.status(result.httpStatus || 400).json({ ok: false, error: result.error });
    }
    return res.json({
      ok: true,
      maskedNew: result.maskedNew,
      codePreview: result.codePreview || null,
      oldTokenPreview: result.oldTokenPreview || null,
    });
  } catch (err) {
    console.error('[email-change] request failed:', err?.message || err);
    return res.status(500).json({ ok: false, error: 'internal' });
  }
});

// ── Confirm: ikkala verify → commit (§08) ──
router.post('/api/account/email/confirm', async (req, res) => {
  try {
    const { newCode, oldToken } = req.body || {};
    const userKey = req.session.user?.safeKey;
    if (!userKey) return res.status(401).json({ ok: false, error: 'unauthorized' });
    const result = await confirmEmailChange({ userKey, newCode, oldToken });
    if (!result.ok) {
      return res.status(result.httpStatus || 400).json({ ok: false, error: result.error });
    }
    // AUTH B-25 §06: email o'zgarganda boshqa qurilmalardagi sessiyalar
    // revoke (joriy saqlanadi) — eski email bilan ochiq sessiyalar yopiladi.
    try {
      await revokeByUser(userKey, { exceptSessionId: req.sessionID, reason: 'email_change' });
    } catch (_) { /* non-critical */ }
    // Joriy sessiyadagi email yangilanadi (sessiya saqlanadi — §27 except)
    if (req.session.user) {
      req.session.user.email = result.email || req.session.user.email;
      req.session.user.emailVerified = true;
    }
    return res.json({ ok: true });
  } catch (err) {
    console.error('[email-change] confirm failed:', err?.message || err);
    return res.status(500).json({ ok: false, error: 'internal' });
  }
});

// ── Cancel: eski email tokeni bilan (§07 [Bekor qilish]) ──
router.post('/api/account/email/cancel', async (req, res) => {
  try {
    const { oldToken } = req.body || {};
    const userKey = req.session.user?.safeKey;
    if (!userKey) return res.status(401).json({ ok: false, error: 'unauthorized' });
    const result = await cancelEmailChange({ userKey, oldToken });
    if (!result.ok) {
      return res.status(result.httpStatus || 400).json({ ok: false, error: result.error });
    }
    return res.json({ ok: true });
  } catch (err) {
    console.error('[email-change] cancel failed:', err?.message || err);
    return res.status(500).json({ ok: false, error: 'internal' });
  }
});

export default router;
