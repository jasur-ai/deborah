/**
 * Edikit — Security Profile & Safe Exam Browser Boundary Routes
 *
 * Prompt 36 (Phase D) REST API:
 *   - GET  /api/admin/security/policy        — institution S0–S4 band + SEB
 *     key registration + managed-device/LAN flags (requireAdmin)
 *   - PUT  /api/admin/security/policy        — upsert institution policy
 *     (validated, idempotent, audited)
 *   - GET  /api/student/assignments/:id/security-profile — sanitized badge +
 *     unsupported-control blocker report for the preflight UI (requireAuth)
 *   - POST /api/student/assignments/:id/security/verify  — server-side SEB
 *     config/key boundary verification (requireAuth)
 *   - GET  /user/security-profile            — profile badge/instruction UI page
 *
 * Security:
 *   - Admin writes are tenant-scoped + audited (SECURITY_POLICY_UPDATE).
 *   - Student badge is whitelist-sanitized — the registered SEB key hash is
 *     never exposed (buildProfileBadge).
 *   - SEB boundary fails CLOSED when the institution has no registered key.
 */

import { Router } from 'express';
import { requireAdmin, requireAuth } from '../middleware/auth.js';
import {
  getInstitutionSecurityPolicy,
  upsertInstitutionSecurityPolicy,
  resolveProfileForAssignment,
  verifySebBoundary,
  getStudentSecurityProfile,
} from '../src/modules/security/index.js';

const router = Router();
// Admin policy API must be admin-gated. Scoped to /api/admin so the router
// (mounted at '/') never intercepts unrelated paths.
router.use('/api/admin', requireAdmin);

function actorId(req) {
  return req.session?.admin?.id || req.session?.user?.id || null;
}

/**
 * Safely parse an optional JSON query parameter. Malformed or non-string
 * values degrade to {} instead of throwing (raw parser errors never leak).
 */
function safeParseQuery(value) {
  if (typeof value !== 'string' || value.trim() === '') return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch (_) {
    return {};
  }
}

/** GET /api/admin/security/policy — current institution security policy. */
router.get('/api/admin/security/policy', async (req, res) => {
  try {
    const policy = await getInstitutionSecurityPolicy();
    res.json({ ok: true, policy });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/** PUT /api/admin/security/policy — upsert institution policy (audited). */
router.put('/api/admin/security/policy', async (req, res) => {
  try {
    const {
      minProfile,
      maxProfile,
      sebConfigKeyHash,
      requireManagedDevice,
      allowLanMode,
    } = req.body || {};
    const result = await upsertInstitutionSecurityPolicy({
      minProfile,
      maxProfile,
      sebConfigKeyHash,
      requireManagedDevice,
      allowLanMode,
      actorId: actorId(req),
    });
    if (result.ok === false) {
      return res.status(400).json({ error: result.errors?.join('; ') || 'Invalid policy' });
    }
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/** GET /api/student/assignments/:id/security-profile — sanitized badge + report. */
router.get('/api/student/assignments/:id/security-profile', async (req, res) => {
  try {
    if (!actorId(req)) return res.status(401).json({ error: 'Authentication required' });
    const result = await getStudentSecurityProfile(
      parseInt(req.params.id, 10),
      safeParseQuery(req.query.attestation),
      safeParseQuery(req.query.client),
    );
    if (!result.ok) {
      return res.status(404).json({ error: result.reason || 'Security profile unavailable' });
    }
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/** POST /api/student/assignments/:id/security/verify — SEB boundary verification. */
router.post('/api/student/assignments/:id/security/verify', async (req, res) => {
  try {
    if (!actorId(req)) return res.status(401).json({ error: 'Authentication required' });
    const { sebPresent, configKeyHash, userAgent, profile } = req.body || {};

    // Resolve the effective profile server-side (never trust the client).
    const resolution = await resolveProfileForAssignment(parseInt(req.params.id, 10));
    const effectiveProfile = resolution.ok ? resolution.effective_profile : (profile || 'S0');

    const verdict = await verifySebBoundary({
      sebPresent,
      configKeyHash,
      userAgent: userAgent || req.headers['user-agent'] || '',
      profile: effectiveProfile,
    });

    res.status(verdict.ok ? 200 : 400).json({
      ok: verdict.ok,
      code: verdict.code,
      reason: verdict.reason,
      profile: verdict.profile,
      seb_key_registered: verdict.seb_key_registered,
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/** GET /user/security-profile — profile badge/instruction UI page. */
router.get('/user/security-profile', (req, res) => {
  if (!req.session?.user) return res.redirect('/user/login');
  res.render('user/security-profile', {
    title: 'Xavfsizlik profili',
    user: req.session.user,
  });
});

export default router;
