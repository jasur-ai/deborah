/**
 * Edikit — Google OIDC Auth Routes
 *
 * Routes:
 *   GET  /auth/google          → Redirect to Google consent screen
 *   GET  /auth/google/callback → Handle Google redirect, exchange code, set session
 *   GET  /auth/status          → Return OIDC status (enabled/disabled)
 *
 * All routes gracefully return 404 when Google OIDC is not configured.
 */

import { Router } from 'express';
import {
  isOidcEnabled,
  getAuthUrl,
  completeOidcLogin,
  getOidcStatus,
} from '../src/modules/auth/oidc.js';
import { audit, AUDIT_ACTIONS } from '../src/modules/auth/audit.js';

const router = Router();

// ── OIDC Status Check ──
router.get('/auth/status', (req, res) => {
  res.json(getOidcStatus());
});

// ── Initiate Google Login ──
router.get('/auth/google', (req, res) => {
  if (!isOidcEnabled()) {
    return res.status(404).json({ error: 'Google login not configured' });
  }

  const authUrl = getAuthUrl(req.session);
  if (!authUrl) {
    return res.status(500).json({ error: 'Failed to build auth URL' });
  }

  res.redirect(authUrl);
});

// ── Google OAuth Callback ──
router.get('/auth/google/callback', async (req, res) => {
  if (!isOidcEnabled()) {
    return res.status(404).render('error', {
      title: '404',
      message: 'Sahifa topilmadi',
      status: 404,
    });
  }

  const { code, state, error: oauthError } = req.query;

  // Handle Google's own error response (user denied consent, etc.)
  if (oauthError) {
    console.warn('[OIDC] Google returned error:', oauthError);
    return res.redirect('/user/login?error=google_denied');
  }

  // Missing authorization code
  if (!code) {
    return res.redirect('/user/login?error=missing_code');
  }

  try {
    // Complete the OIDC login flow (state validation + token exchange + user lookup)
    const result = await completeOidcLogin(req.session, code, state);

    if (!result.success) {
      console.warn('[OIDC] Login failed:', result.error);

      // Audit failed OIDC login
      await audit({
        action: AUDIT_ACTIONS.USER_LOGIN_FAILED,
        details: { provider: 'google', reason: result.error },
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      });

      return res.redirect(`/user/login?error=${encodeURIComponent(result.error)}`);
    }

    const { user, googleUser } = result;

    // Regenerate session to prevent session fixation
    req.session.regenerate(async (err) => {
      if (err) {
        console.error('[OIDC] Session regenerate error:', err);
        return res.redirect('/user/login?error=session_error');
      }

      // Set user session
      req.session.user = {
        id: user.id,
        safeKey: user.safeKey,
        username: user.username,
        displayName: user.displayName,
        email: user.email,
        avatarUrl: user.avatarUrl,
        isVip: user.isVip,
        authProvider: 'google',
        tenant_id: 1, // Default tenant
      };

      // Audit successful OIDC login
      await audit({
        action: user.isNew ? AUDIT_ACTIONS.USER_REGISTER : AUDIT_ACTIONS.USER_LOGIN,
        userId: user.id,
        details: { provider: 'google', isNew: user.isNew, email: user.email },
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      });

      return res.redirect('/user/panel');
    });
  } catch (err) {
    console.error('[OIDC] Callback error:', err);
    return res.redirect('/user/login?error=server_error');
  }
});

export default router;
