/**
 * Edikit — Portfolio & Verifiable Credential Routes
 *
 * Prompt 61 REST API (credentials only — portfolio moved to routes/portfolio.js, AUTH A-12):
 *   - GET    /api/user/credentials          — my credentials
 *   - POST   /api/user/credentials/:id/appeal — appeal revocation
 *   - GET    /verify/:digest                — public credential verifier
 *   - GET    /admin/credentials             — admin UI
 *   - GET    /api/admin/credential-definitions — list definitions
 *   - POST   /api/admin/credential-definitions — create definition
 *   - POST   /api/admin/credential-definitions/:id/publish — publish
 *   - POST   /api/admin/credentials/issue   — issue (guarded, idempotent)
 *   - POST   /api/admin/credentials/:id/revoke — revoke
 *   - POST   /api/admin/credentials/:id/renew — renew
 *
 * Security (Prompt 61 §15): student routes requireAuth + owner checks;
 * admin routes requireAdmin; LLM never issues; raw sensitive submission
 * never in public payload; privileged actions audited.
 */

import { Router } from 'express';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import {
  createCredentialDefinition,
  publishCredentialDefinition,
  listCredentialDefinitions,
  issueCredential,
  revokeCredential,
  renewCredential,
  appealCredential,
  verifyCredential,
  listCredentials,
} from '../src/modules/credential/index.js';

const router = Router();

function actorId(req) {
  return req.session?.admin?.username || req.session?.admin?.id || req.session?.user?.username || req.session?.user?.id || null;
}

// ─────────────────────────────────────────────────────────────────────
// STUDENT — portfolio UI + API (AUTH A-12 → routes/portfolio.js)
// ─────────────────────────────────────────────────────────────────────

/** GET /api/user/credentials — my credentials. */
router.get('/api/user/credentials', requireAuth, async (req, res) => {
  try {
    const userId = req.session.user.id || 0;
    const credentials = await listCredentials({ userId });
    res.json({ credentials });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

/** POST /api/user/credentials/:id/appeal — appeal revocation. */
router.post('/api/user/credentials/:id/appeal', requireAuth, async (req, res) => {
  try {
    const userId = req.session.user.id || 0;
    const r = await appealCredential({
      credentialId: Number(req.params.id),
      userId,
      reason: req.body?.reason || '',
      appealCount: req.body?.appealCount || 0,
    });
    if (!r.ok) return res.status(400).json({ error: r.error });
    res.json({ ok: true, credentialId: r.credentialId });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

/** GET /verify/:digest — public credential verifier (valid/revoked/expired). */
router.get('/verify/:digest', async (req, res) => {
  const r = await verifyCredential({ vcDigest: req.params.digest });
  res.render('verify', {
    title: 'Credential verification',
    result: r,
    csrfToken: null,
  });
});

// ─────────────────────────────────────────────────────────────────────
// ADMIN — definitions + credential management
// ─────────────────────────────────────────────────────────────────────

/** GET /admin/credentials — admin UI. */
router.get('/admin/credentials', requireAdmin, (req, res) => {
  res.render('admin/credentials', {
    title: 'Credentials',
    user: req.session.admin,
    csrfToken: req.csrfToken?.(),
  });
});

/** GET /api/admin/credential-definitions — list definitions. */
router.get('/api/admin/credential-definitions', requireAdmin, async (req, res) => {
  try {
    const definitions = await listCredentialDefinitions({ status: req.query.status || null });
    res.json({ definitions });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

/** POST /api/admin/credential-definitions — create definition. */
router.post('/api/admin/credential-definitions', requireAdmin, async (req, res) => {
  try {
    const r = await createCredentialDefinition({
      name: req.body?.name || '',
      version: req.body?.version || 'v1',
      criteria: req.body?.criteria || {},
      issuerAuthority: req.body?.issuerAuthority || 'admin',
      createdBy: actorId(req),
    });
    if (!r.ok) return res.status(400).json({ error: r.error });
    res.json({ ok: true, definitionId: r.definitionId });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

/** POST /api/admin/credential-definitions/:id/publish — publish definition. */
router.post('/api/admin/credential-definitions/:id/publish', requireAdmin, async (req, res) => {
  try {
    const r = await publishCredentialDefinition({ definitionId: Number(req.params.id), actorId: actorId(req) });
    if (!r.ok) return res.status(400).json({ error: r.error });
    res.json({ ok: true, definitionId: r.definitionId });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

/** POST /api/admin/credentials/issue — issue credential (guarded, idempotent). */
router.post('/api/admin/credentials/issue', requireAdmin, async (req, res) => {
  try {
    const r = await issueCredential({
      definitionId: Number(req.body?.definitionId || 0),
      userId: Number(req.body?.userId || 0),
      recipient: req.body?.recipient || '',
      evidence: req.body?.evidence || {},
      criteria: req.body?.criteria || {},
      issuedBy: actorId(req),
      issuedByRole: 'admin',
      evidenceRatified: Boolean(req.body?.evidenceRatified),
      teacherApproved: Boolean(req.body?.teacherApproved),
    });
    if (!r.ok) return res.status(400).json({ error: r.error, checks: r.checks, guard: r.guard });
    res.json({ ok: true, cached: r.cached || false, credential: r.credential });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

/** POST /api/admin/credentials/:id/revoke — revoke credential. */
router.post('/api/admin/credentials/:id/revoke', requireAdmin, async (req, res) => {
  try {
    const r = await revokeCredential({
      credentialId: Number(req.params.id),
      reason: req.body?.reason || '',
      actorId: actorId(req),
      actorRole: 'admin',
    });
    if (!r.ok) return res.status(400).json({ error: r.error });
    res.json({ ok: true, status: r.status });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

/** POST /api/admin/credentials/:id/renew — renew credential. */
router.post('/api/admin/credentials/:id/renew', requireAdmin, async (req, res) => {
  try {
    const r = await renewCredential({
      credentialId: Number(req.params.id),
      evidence: req.body?.evidence || {},
      criteria: req.body?.criteria || {},
      actorId: actorId(req),
    });
    if (!r.ok) return res.status(400).json({ error: r.error });
    res.json({ ok: true, status: r.status });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

export default router;
