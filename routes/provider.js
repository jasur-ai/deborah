/**
 * Edikit — Unified Provider Async Adapter Routes
 *
 * Prompt 58 REST API:
 *   - GET   /api/admin/provider/meta                  — constants for UI
 *   - POST  /api/admin/provider/jobs                  — create job (gamma|manus)
 *   - GET   /api/admin/provider/jobs                  — list jobs
 *   - GET   /api/admin/provider/jobs/:id              — job detail
 *   - GET   /api/admin/provider/jobs/:id/events       — job events
 *   - GET   /api/admin/provider/jobs/:id/artifacts    — copied artifacts
 *   - POST  /api/admin/provider/jobs/:id/poll         — Gamma async poll
 *   - POST  /api/admin/provider/jobs/:id/cancel       — Gamma cancel
 *   - POST  /api/admin/provider/jobs/:id/follow-up    — Manus sendMessage
 *   - GET   /api/admin/provider/dashboard             — configs/jobs/dead-letters
 *   - POST  /api/admin/provider/configs/ensure        — ensure config rows
 *   - POST  /api/admin/provider/configs/:provider     — update config
 *   - POST  /api/webhooks/manus                       — Manus signed webhook (PUBLIC, signature-verified)
 *   - GET   /admin/provider                           — admin page
 *
 * Security (Prompt 58 §15-17):
 *   - API key hech qachon response'ga chiqmaydi (client env'da).
 *   - Manus webhook endpoint PUBLIC lekin HMAC signature bilan himoyalangan.
 *   - Har bir write path tenant-scoped + idempotent (request_hash).
 *   - Privileged actions (create/cancel/follow-up/artifact-copy) audit.
 */

import { Router } from 'express';
import { requireAdmin } from '../middleware/auth.js';
import {
  createProviderJob,
  pollGammaJob,
  cancelProviderJob,
  sendManusFollowUp,
  handleManusWebhook,
  listProviderJobs,
  getProviderJob,
  getProviderJobEvents,
  getProviderArtifacts,
  getProviderDashboard,
  ensureProviderConfigs,
  updateProviderConfig,
  PROVIDER_META,
} from '../src/modules/provider/index.js';

const router = Router();

function actorId(req) {
  return req.session?.admin?.id || req.session?.admin?.username || req.session?.user?.id || null;
}

/** GET /api/admin/provider/meta — constants for the admin UI. */
router.get('/api/admin/provider/meta', requireAdmin, (req, res) => {
  res.json(PROVIDER_META);
});

/** POST /api/admin/provider/jobs — create job (gamma | manus). */
router.post('/api/admin/provider/jobs', requireAdmin, async (req, res) => {
  try {
    const r = await createProviderJob({
      provider: req.body?.provider,
      title: req.body?.title,
      audience: req.body?.audience,
      language: req.body?.language || 'uz',
      theme: req.body?.theme || 'default',
      tone: req.body?.tone || 'formal',
      numCards: req.body?.numCards || 10,
      sourcePackIds: req.body?.sourcePackIds || [],
      brief: req.body?.brief || null,
      projectId: req.body?.projectId || null,
      fileIds: req.body?.fileIds || [],
      files: req.body?.files || [],
      actorId: actorId(req),
    });
    if (!r.ok) return res.status(400).json({ error: r.error, jobId: r.jobId || null, circuit: r.circuit || null });
    res.json({ ok: true, jobId: r.jobId, cached: Boolean(r.cached), status: r.status, provider: r.provider, providerJobId: r.providerJobId || null });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

/** GET /api/admin/provider/jobs — list jobs. */
router.get('/api/admin/provider/jobs', requireAdmin, async (req, res) => {
  try {
    const rows = await listProviderJobs({
      status: req.query.status || null,
      provider: req.query.provider || null,
      limit: req.query.limit || 50,
    });
    res.json({ jobs: rows });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

/** GET /api/admin/provider/jobs/:id — job detail. */
router.get('/api/admin/provider/jobs/:id', requireAdmin, async (req, res) => {
  try {
    const row = await getProviderJob(Number(req.params.id));
    if (!row) return res.status(404).json({ error: 'job not found' });
    res.json(row);
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

/** GET /api/admin/provider/jobs/:id/events — job event log. */
router.get('/api/admin/provider/jobs/:id/events', requireAdmin, async (req, res) => {
  try {
    const events = await getProviderJobEvents(Number(req.params.id));
    res.json({ events });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

/** GET /api/admin/provider/jobs/:id/artifacts — copied artifacts. */
router.get('/api/admin/provider/jobs/:id/artifacts', requireAdmin, async (req, res) => {
  try {
    const artifacts = await getProviderArtifacts(Number(req.params.id));
    res.json({ artifacts });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

/** POST /api/admin/provider/jobs/:id/poll — Gamma async polling (blocking with backoff). */
router.post('/api/admin/provider/jobs/:id/poll', requireAdmin, async (req, res) => {
  try {
    const r = await pollGammaJob({
      jobId: Number(req.params.id),
      maxAttempts: req.body?.maxAttempts || 60,
    });
    if (!r.ok) return res.status(400).json({ error: r.error, deadLetter: r.deadLetter || false });
    res.json({ ok: true, status: r.status, jobId: r.jobId, artifacts: r.artifacts || null, pending: r.pending || false });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

/** POST /api/admin/provider/jobs/:id/cancel — Gamma cancel (idempotent). */
router.post('/api/admin/provider/jobs/:id/cancel', requireAdmin, async (req, res) => {
  try {
    const r = await cancelProviderJob({ jobId: Number(req.params.id), actorId: actorId(req) });
    if (!r.ok) return res.status(400).json({ error: r.error });
    res.json({ ok: true, status: r.status, cached: r.cached || false });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

/** POST /api/admin/provider/jobs/:id/follow-up — Manus sendMessage. */
router.post('/api/admin/provider/jobs/:id/follow-up', requireAdmin, async (req, res) => {
  try {
    const r = await sendManusFollowUp({
      jobId: Number(req.params.id),
      message: req.body?.message,
      actorId: actorId(req),
    });
    if (!r.ok) return res.status(400).json({ error: r.error });
    res.json({ ok: true, jobId: r.jobId });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

/** GET /api/admin/provider/dashboard — configs/jobs/dead-letters/breakers. */
router.get('/api/admin/provider/dashboard', requireAdmin, async (req, res) => {
  try {
    const dash = await getProviderDashboard();
    if (!dash.ok) return res.status(400).json({ error: dash.error });
    res.json(dash);
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

/** POST /api/admin/provider/configs/ensure — ensure provider config rows. */
router.post('/api/admin/provider/configs/ensure', requireAdmin, async (req, res) => {
  try {
    const r = await ensureProviderConfigs();
    if (!r.ok) return res.status(400).json({ error: r.error });
    res.json({ ok: true, created: r.created });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

/** POST /api/admin/provider/configs/:provider — update provider config. */
router.post('/api/admin/provider/configs/:provider', requireAdmin, async (req, res) => {
  try {
    const r = await updateProviderConfig({
      provider: req.params.provider,
      patch: req.body || {},
      actorId: actorId(req),
    });
    if (!r.ok) return res.status(400).json({ error: r.error });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

/** POST /api/webhooks/manus — PUBLIC signed webhook (HMAC-verified). */
router.post('/api/webhooks/manus', async (req, res) => {
  try {
    const raw = req.rawBody !== undefined && typeof req.rawBody === 'string'
      ? req.rawBody
      : (typeof req.body === 'string' ? req.body : JSON.stringify(req.body || {}));
    const r = await handleManusWebhook({
      signature: req.headers['x-manus-signature'] || req.headers['x-signature'] || null,
      body: raw,
      bodyObj: typeof req.body === 'object' && req.body !== null ? req.body : null,
    });
    if (r.rejected) {
      return res.status(401).json({ error: r.error });
    }
    if (!r.ok) return res.status(400).json({ error: r.error });
    res.json({ ok: true, status: r.status, jobId: r.jobId, duplicate: r.duplicate || false, buffered: r.buffered || false });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

/** GET /admin/provider — admin page. */
router.get('/admin/provider', requireAdmin, (req, res) => {
  res.render('admin/provider', {
    title: 'Provider Adapters',
    user: req.session.admin,
    csrfToken: req.csrfToken?.(),
  });
});

export default router;
