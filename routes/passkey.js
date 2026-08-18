/**
 * Edikit — Passkey (WebAuthn) Routes (AUTH A-27)
 *
 * Flow:
 *   Login (public):
 *     POST /api/passkey/login/options   → single-use challenge (discoverable)
 *     POST /api/passkey/login/verify    → assertion tekshiruvi → session
 *   Register (auth + reauth):
 *     POST /api/passkey/register/options
 *     POST /api/passkey/register/verify
 *   Settings (auth):
 *     GET  /api/passkey/status          → { count, max } (nudge + settings)
 *     POST /api/passkey/remove          → owner-only revoke (reauth)
 *
 * Security:
 *   - challenge single-use + 5 daqiqa TTL (session'da)
 *   - origin/rpID har assertion'da tekshiriladi
 *   - counter server-authoritative (regression/replay → reject)
 *   - /passkey/register + /passkey/verify: 10 so'rov / 15 daqiqa / IP+user
 *   - CSRF barcha POST'larda (global middleware)
 *   - Passkey login = phishing-resistant MFA (NIST AAL2+) → viaMfa marker
 *
 * @module routes/passkey
 */

import { Router } from 'express';
import crypto from 'crypto';
import { requireAuth, requireRecentAuth } from '../middleware/auth.js';
import { recordAuthTime } from '../middleware/recent-auth.js';
import { fb } from '../firebase/admin.js';
import { audit, AUDIT_ACTIONS, logAuthEvent } from '../src/modules/auth/audit.js';
import { recordSession, revokeByUser } from '../src/modules/auth/session-manager.js';
import { sessionTtlMs } from '../src/modules/auth/session-store.js';
import { ipHash } from '../src/modules/auth/new-device.js';
// AUTH D-06 §06: auth_passkey_total{op}
import { recordMetric } from '../src/telemetry/index.js';
import {
  rpFromRequest,
  generateRegistrationChallenge,
  verifyRegistrationResponseFlow,
  generateAuthenticationChallenge,
  verifyAuthenticationResponseFlow,
  removePasskey,
  renamePasskey,
  countPasskeys,
  listPasskeys,
} from '../src/modules/auth/webauthn.js';

const router = Router();

// ── Rate limit (A-27 §15): register + verify — 10/15 min / IP+user ──
const RATE_LIMIT = 10;
const RATE_WINDOW_MS = 15 * 60 * 1000;
const passkeyHits = new Map();

let passkeyHitsCalls = 0;

function passkeyRateLimited(key) {
  const now = Date.now();
  const rec = passkeyHits.get(key);
  if (!rec || rec.resetAt <= now) {
    passkeyHits.set(key, { count: 1, resetAt: now + RATE_WINDOW_MS });
    return false;
  }
  rec.count += 1;
  // Expired kalitlarni vaqti-vaqti bilan tozalash (xotira o'sishining oldini olish)
  if (++passkeyHitsCalls % 256 === 0) {
    for (const [k, v] of passkeyHits) {
      if (v.resetAt <= now) passkeyHits.delete(k);
    }
  }
  if (rec.count > RATE_LIMIT) return true;
  return false;
}

// ── Registration (auth + reauth) ──

router.post('/api/passkey/register/options', requireAuth, requireRecentAuth, async (req, res) => {
  const userKey = req.session.user.safeKey;
  if (passkeyRateLimited(`reg:${userKey}:${req.ip}`)) {
    return res.status(429).json({ ok: false, error: 'rate-limited' });
  }
  try {
    const userSnap = await fb.get(`users/${userKey}`);
    if (!userSnap.exists()) return res.status(404).json({ ok: false, error: 'not_found' });
    const userData = userSnap.val();
    const userName = userData.username || userData.email || userKey;
    const rp = rpFromRequest(req);
    const options = await generateRegistrationChallenge(
      req.session, { userId: userKey, userName }, rp,
    );
    if (!options) return res.status(400).json({ ok: false, error: 'bad_request' });
    // rpId/origin client'ga ham kerak (test + Conditional UI consistency)
    return res.json({ ok: true, options, rpId: rp.id, origin: rp.origin });
  } catch (err) {
    console.error('[passkey] register options:', err.message);
    return res.status(500).json({ ok: false, error: 'server' });
  }
});

router.post('/api/passkey/register/verify', requireAuth, requireRecentAuth, async (req, res) => {
  const userKey = req.session.user.safeKey;
  if (passkeyRateLimited(`reg:${userKey}:${req.ip}`)) {
    return res.status(429).json({ ok: false, error: 'rate-limited' });
  }
  try {
    const { response } = req.body || {};
    const result = await verifyRegistrationResponseFlow(req.session, response, rpFromRequest(req));
    if (!result.ok) return res.status(400).json(result);
    // AUTH D-06 §06: auth_passkey_total{op:'register'}
    try { recordMetric('auth_passkey_total', 1, { type: 'counter', labels: { op: 'register' } }); } catch (_) {}
    return res.json({ ok: true, credential: result.credential });
  } catch (err) {
    console.error('[passkey] register verify:', err.message);
    return res.status(500).json({ ok: false, error: 'server' });
  }
});

// ── Login (public — CSRF global middleware tomonidan himoyalanadi) ──

router.post('/api/passkey/login/options', (req, res) => {
  if (passkeyRateLimited(`auth:${req.ip}`)) {
    return res.status(429).json({ ok: false, error: 'rate-limited' });
  }
  const rp = rpFromRequest(req);
  generateAuthenticationChallenge(req.session, {}, rp)
    .then((options) => {
      if (!options) return res.status(400).json({ ok: false, error: 'bad_request' });
      return res.json({ ok: true, options, rpId: rp.id, origin: rp.origin });
    })
    .catch((err) => {
      console.error('[passkey] login options:', err.message);
      return res.status(500).json({ ok: false, error: 'server' });
    });
});

router.post('/api/passkey/login/verify', async (req, res) => {
  if (passkeyRateLimited(`auth:${req.ip}`)) {
    return res.status(429).json({ ok: false, error: 'rate-limited' });
  }
  const { response } = req.body || {};
  const result = await verifyAuthenticationResponseFlow(req.session, response, rpFromRequest(req));
  if (!result.ok) {
    logAuthEvent({
      action: AUDIT_ACTIONS.AUTH_LOGIN_FAIL,
      outcome: 'failed',
      method: 'passkey',
      actorId: result.userId || 'anon',
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
      details: { reason: result.error },
    }).catch(() => {});
    return res.status(401).json(result);
  }

  const userKey = result.userId;
  try {
    const userSnap = await fb.get(`users/${userKey}`);
    if (!userSnap.exists()) return res.status(401).json({ ok: false, error: 'unknown_credential' });
    const userData = userSnap.val();

    // Session yaratish — password login bilan bir xil shaklda (A-01/A-02/A-25)
    req.session.regenerate(async (err) => {
      if (err) return res.status(500).json({ ok: false, error: 'session_error' });
      try {
        let isVip = false;
        try {
          const vipSnap = await fb.get(`users/${userKey}/isVip`);
          isVip = vipSnap.exists() && vipSnap.val() === true;
        } catch (_) { /* non-critical */ }

        const role = userData.role && ['student', 'teacher', 'proctor', 'marker', 'board'].includes(userData.role)
          ? userData.role
          : 'student';

        req.session.user = {
          username: userData.username || userKey,
          safeKey: userKey,
          isVip,
          role,
          passwordUpdatedAt: userData.password_updated_at || 0,
          roleVersion: typeof userData.role_version === 'number' ? userData.role_version : 0,
          // Passkey = phishing-resistant MFA (NIST AAL2+) — MFA step-up uchun
          viaMfa: true,
          mfaAt: Date.now(),
          authMethod: 'passkey',
        };
        // AUTH D-06 §06: passkey login metric + login_total{method:'passkey',outcome:'success'}
        try {
          recordMetric('auth_passkey_total', 1, { type: 'counter', labels: { op: 'login' } });
          recordMetric('auth_login_total', 1, { type: 'counter', labels: { method: 'passkey', outcome: 'success' } });
        } catch (_) {}
        req.session.csrfToken = crypto.randomBytes(32).toString('hex');
        req.session.remember = false;
        req.session.cookie.maxAge = sessionTtlMs(false);
        req.session.lastActiveAt = Date.now();
        req.session.startedAt = Date.now();
        req.session.lastRotatedAt = Date.now();
        recordAuthTime(req, 'user');

        try { await fb.set(`users/${userKey}/last_login`, Date.now()); } catch (_) { /* non-critical */ }
        try { await fb.set(`users/${userKey}/last_login_ip_hash`, ipHash(req.ip)); } catch (_) { /* non-critical */ }

        recordSession({
          userId: userKey,
          sessionId: req.sessionID,
          ipAddress: req.ip,
          userAgent: req.headers['user-agent'],
          authMethod: 'passkey',
          remember: false,
          role,
          isVip,
        }).catch(() => {});

        await logAuthEvent({
          action: AUDIT_ACTIONS.AUTH_LOGIN,
          outcome: 'success',
          method: 'passkey',
          actorId: userKey,
          ipAddress: req.ip,
          userAgent: req.headers['user-agent'],
        }).catch(() => {});

        await audit({
          action: AUDIT_ACTIONS.PASSKEY_AUTH,
          userId: userKey,
          resourceType: 'passkey',
          details: { credentialId: `${result.credential.id.slice(0, 12)}…` },
        }).catch(() => {});

        return res.json({ ok: true, redirect: '/user/panel' });
      } catch (sessionErr) {
        console.error('[passkey] session create:', sessionErr.message);
        return res.status(500).json({ ok: false, error: 'server' });
      }
    });
  } catch (err) {
    console.error('[passkey] login verify:', err.message);
    return res.status(500).json({ ok: false, error: 'server' });
  }
});

// ── Settings (auth) ──

router.get('/api/passkey/status', requireAuth, async (req, res) => {
  try {
    const userId = req.session.user.safeKey;
    const passkeys = await listPasskeys(userId);
    return res.json({ ok: true, count: passkeys.length, max: 25, passkeys });
  } catch (err) {
    return res.status(500).json({ ok: false, error: 'server' });
  }
});

router.post('/api/passkey/rename', requireAuth, requireRecentAuth, async (req, res) => {
  const { credentialId, name } = req.body || {};
  if (!credentialId || typeof credentialId !== 'string' || credentialId.length > 200) {
    return res.status(400).json({ ok: false, error: 'bad_request' });
  }
  try {
    const result = await renamePasskey(credentialId, req.session.user.safeKey, name);
    if (result.error === 'invalid_name') return res.status(400).json(result);
    if (!result.ok) return res.status(404).json(result);
    return res.json({ ok: true, credential: result.credential });
  } catch (err) {
    console.error('[passkey] rename:', err.message);
    return res.status(500).json({ ok: false, error: 'server' });
  }
});

router.post('/api/passkey/remove', requireAuth, requireRecentAuth, async (req, res) => {
  const { credentialId } = req.body || {};
  if (!credentialId || typeof credentialId !== 'string' || credentialId.length > 200) {
    return res.status(400).json({ ok: false, error: 'bad_request' });
  }
  try {
    const result = await removePasskey(credentialId, req.session.user.safeKey);
    if (!result.ok) return res.status(404).json(result);
    // AUTH B-25 §06: passkey o'chirilganda boshqa sessiyalar revoke
    // (ushbu credential bilan kirilgan eski sessiyalar yopiladi).
    try {
      await revokeByUser(req.session.user.safeKey, { exceptSessionId: req.sessionID, reason: 'passkey_removed' });
    } catch (_) { /* non-critical */ }
    return res.json({ ok: true });
  } catch (err) {
    console.error('[passkey] remove:', err.message);
    return res.status(500).json({ ok: false, error: 'server' });
  }
});

export default router;
