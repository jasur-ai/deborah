/**
 * Edikit — External Integration Boundary (HEMIS & OneID) Routes
 *
 * Prompt 66 REST API:
 *   - GET    /admin/external-integration                      — admin UI
 *   - GET    /api/admin/external-integration/connections     — list connections
 *   - POST   /api/admin/external-integration/connections     — register/upsert connection
 *   - GET    /api/admin/external-integration/status?provider — adapter status
 *   - POST   /api/admin/external-integration/field-maps      — save source-of-truth field map
 *   - GET    /api/admin/external-integration/field-maps      — list field maps
 *   - POST   /api/admin/external-integration/hemis/pull      — HEMIS pull → staging → diff
 *   - POST   /api/admin/external-integration/grade/push      — ratified-only grade push
 *   - POST   /api/admin/external-integration/jobs/:id/retry  — retry failed/dead-letter job
 *   - GET    /api/admin/external-integration/jobs            — list sync jobs
 *   - POST   /api/admin/external-integration/reconcile       — pull-back reconciliation
 *   - POST   /api/admin/external-integration/oneid/link      — OneID account link (takeover guard)
 *   - POST   /api/admin/external-integration/oneid/:id/revoke — revoke OneID link
 *   - GET    /api/admin/external-integration/identities      — list identity links
 *   - POST   /api/admin/external-integration/tokens          — store token (envelope encryption)
 *   - GET    /api/admin/external-integration/tokens          — list token metadata (no secrets)
 *   - POST   /api/admin/external-integration/tokens/:id/revoke — revoke token
 *   - GET    /api/admin/external-integration/summary         — dashboard summary
 *
 * Security (Prompt 66 §15-17): hamma route'lar requireAdmin; scraping/
 * undocumented endpoint taqiqlanadi (assertDocumentedEndpoint); ratified-
 * only grade push (§15); tenant-scoped + idempotent + audited.
 */

import { Router } from 'express';
import { requireAdmin } from '../middleware/auth.js';
import {
  registerConnection,
  listConnections,
  getAdapterStatus,
  saveFieldMap,
  listFieldMaps,
  hemisPullToStaging,
  pushRatifiedGrades,
  retrySyncJob,
  listSyncJobs,
  runReconciliation,
  oneidLinkAccount,
  oneidRevokeLink,
  listIdentities,
  tokenVaultStore,
  tokenVaultRevoke,
  listVaultTokens,
  getExternalIntegrationSummary,
} from '../src/modules/external-integration/index.js';

const router = Router();

function actorId(req) {
  return req.session?.admin?.username || req.session?.admin?.id || req.session?.user?.username || req.session?.user?.id || null;
}

/** GET /admin/external-integration — admin UI. */
router.get('/admin/external-integration', requireAdmin, (req, res) => {
  res.render('admin/external-integration', {
    title: 'External Integration',
    user: req.session.admin,
    csrfToken: req.csrfToken?.(),
  });
});

// ── Connections ────────────────────────────────────────────────────

router.get('/api/admin/external-integration/connections', requireAdmin, async (req, res) => {
  try {
    const connections = await listConnections({ provider: req.query.provider || null, limit: req.query.limit });
    res.json({ ok: true, connections });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

router.post('/api/admin/external-integration/connections', requireAdmin, async (req, res) => {
  try {
    const r = await registerConnection({
      provider: req.body.provider,
      mode: req.body.mode || 'sandbox',
      baseUrl: req.body.baseUrl || '',
      clientId: req.body.clientId || '',
      scopes: req.body.scopes || '',
      rateLimitRps: Number(req.body.rateLimitRps) || 5,
      contractVersion: req.body.contractVersion || '0',
      createdBy: actorId(req),
    });
    if (!r.ok) return res.status(400).json({ ok: false, error: r.error });
    res.json(r);
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

router.get('/api/admin/external-integration/status', requireAdmin, async (req, res) => {
  try {
    const status = await getAdapterStatus({ provider: req.query.provider || 'hemis' });
    res.json(status);
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ── Field maps ─────────────────────────────────────────────────────

router.post('/api/admin/external-integration/field-maps', requireAdmin, async (req, res) => {
  try {
    const r = await saveFieldMap({
      provider: req.body.provider || 'hemis',
      entity: req.body.entity || 'roster',
      map: req.body.map || null,
      createdBy: actorId(req),
    });
    if (!r.ok) return res.status(400).json({ ok: false, error: r.error });
    res.json(r);
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

router.get('/api/admin/external-integration/field-maps', requireAdmin, async (req, res) => {
  try {
    const maps = await listFieldMaps({ provider: req.query.provider || null, entity: req.query.entity || null, limit: req.query.limit });
    res.json({ ok: true, maps });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ── HEMIS pull / grade push / jobs ─────────────────────────────────

router.post('/api/admin/external-integration/hemis/pull', requireAdmin, async (req, res) => {
  try {
    const r = await hemisPullToStaging({
      connectionId: Number(req.body.connectionId) || 0,
      provider: req.body.provider || 'hemis',
      createdBy: actorId(req),
    });
    if (!r.ok) return res.status(400).json({ ok: false, error: r.error });
    res.json(r);
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

router.post('/api/admin/external-integration/grade/push', requireAdmin, async (req, res) => {
  try {
    const r = await pushRatifiedGrades({
      connectionId: Number(req.body.connectionId) || 0,
      grades: Array.isArray(req.body.grades) ? req.body.grades : [],
      decision: req.body.decision || '',
      createdBy: actorId(req),
    });
    if (!r.ok) return res.status(r.error?.includes('ratified') ? 409 : 400).json({ ok: false, error: r.error });
    res.json(r);
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

router.get('/api/admin/external-integration/jobs', requireAdmin, async (req, res) => {
  try {
    const jobs = await listSyncJobs({
      direction: req.query.direction || null,
      entity: req.query.entity || null,
      status: req.query.status || null,
      limit: req.query.limit,
    });
    res.json({ ok: true, jobs });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

router.post('/api/admin/external-integration/jobs/:id/retry', requireAdmin, async (req, res) => {
  try {
    const r = await retrySyncJob({ jobId: Number(req.params.id), createdBy: actorId(req) });
    if (!r.ok) return res.status(r.deadLettered ? 422 : 400).json({ ok: false, error: r.error, deadLettered: r.deadLettered });
    res.json(r);
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ── Reconciliation ─────────────────────────────────────────────────

router.post('/api/admin/external-integration/reconcile', requireAdmin, async (req, res) => {
  try {
    const r = await runReconciliation({
      connectionId: Number(req.body.connectionId) || 0,
      externalRows: req.body.externalRows || null,
      localRows: Array.isArray(req.body.localRows) ? req.body.localRows : [],
      keyField: req.body.keyField || 'externalId',
      createdBy: actorId(req),
    });
    if (!r.ok) return res.status(400).json({ ok: false, error: r.error });
    res.json(r);
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ── OneID identity links ───────────────────────────────────────────

router.post('/api/admin/external-integration/oneid/link', requireAdmin, async (req, res) => {
  try {
    const r = await oneidLinkAccount({
      connectionId: Number(req.body.connectionId) || 0,
      userId: req.body.userId ? Number(req.body.userId) : null,
      providerSubject: req.body.providerSubject || '',
      pinfl: req.body.pinfl || '',
      createdBy: actorId(req),
    });
    if (!r.ok) return res.status(r.error?.includes('takeover') ? 409 : 400).json({ ok: false, error: r.error });
    res.json(r);
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

router.post('/api/admin/external-integration/oneid/:id/revoke', requireAdmin, async (req, res) => {
  try {
    const r = await oneidRevokeLink({ linkId: Number(req.params.id), revokedBy: actorId(req) });
    if (!r.ok) return res.status(400).json({ ok: false, error: r.error });
    res.json(r);
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

router.get('/api/admin/external-integration/identities', requireAdmin, async (req, res) => {
  try {
    const identities = await listIdentities({ status: req.query.status || null, limit: req.query.limit });
    res.json({ ok: true, identities });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ── Token vault ────────────────────────────────────────────────────

router.post('/api/admin/external-integration/tokens', requireAdmin, async (req, res) => {
  try {
    const r = await tokenVaultStore({
      connectionId: Number(req.body.connectionId) || 0,
      tokenType: req.body.tokenType || 'access',
      token: req.body.token || '',
      scopes: Array.isArray(req.body.scopes) ? req.body.scopes : [],
      expiresAt: req.body.expiresAt || null,
      masterKey: req.body.masterKey || process.env.TOKEN_VAULT_MASTER_KEY || '',
      createdBy: actorId(req),
    });
    if (!r.ok) return res.status(400).json({ ok: false, error: r.error });
    res.json(r);
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

router.get('/api/admin/external-integration/tokens', requireAdmin, async (req, res) => {
  try {
    const tokens = await listVaultTokens({ provider: req.query.provider || null, limit: req.query.limit });
    res.json({ ok: true, tokens });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

router.post('/api/admin/external-integration/tokens/:id/revoke', requireAdmin, async (req, res) => {
  try {
    const r = await tokenVaultRevoke({ tokenId: Number(req.params.id), revokedBy: actorId(req) });
    if (!r.ok) return res.status(400).json({ ok: false, error: r.error });
    res.json(r);
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ── Summary ────────────────────────────────────────────────────────

router.get('/api/admin/external-integration/summary', requireAdmin, async (req, res) => {
  try {
    const summary = await getExternalIntegrationSummary();
    res.json(summary);
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

export default router;
