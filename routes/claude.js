/**
 * Edikit — Claude Native Adapter Routes
 *
 * Prompt 57 REST API (admin — requireAdmin):
 *   - GET  /api/admin/claude/meta                 — constants for admin UI
 *   - POST /api/admin/claude/synthesize           — run source-synthesis job
 *   - GET  /api/admin/claude/jobs                 — list jobs
 *   - GET  /api/admin/claude/jobs/:id             — job detail
 *   - GET  /api/admin/claude/jobs/:id/events      — streaming SSE job progress
 *   - GET  /api/admin/claude/dashboard            — providers/usage/circuit
 *   - POST /api/admin/claude/providers/ensure     — ensure provider rows
 *   - POST /api/admin/claude/providers/:model     — update provider config
 *   - GET  /admin/claude                          — admin page
 *
 * Security (Prompt 57 §15):
 *   - API key hech qachon response'ga chiqmaydi (client env'da).
 *   - Student PII default yuborilmaydi (assertNoStudentPii).
 *   - Har bir write path tenant-scoped + idempotent (request_hash).
 */

import { Router } from 'express';
import { requireAdmin } from '../middleware/auth.js';
import {
  synthesizeDeck,
  getClaudeJob,
  listClaudeJobs,
  getClaudeJobEvents,
  getClaudeDashboard,
  ensureClaudeProviders,
  updateClaudeProvider,
  CLAUDE_META,
} from '../src/modules/claude/index.js';

const router = Router();

function actorId(req) {
  return req.session?.admin?.id || req.session?.admin?.username || req.session?.user?.id || null;
}

/** GET /api/admin/claude/meta — constants for the admin UI. */
router.get('/api/admin/claude/meta', requireAdmin, (req, res) => {
  res.json(CLAUDE_META);
});

/** POST /api/admin/claude/synthesize — run source-synthesis job. */
router.post('/api/admin/claude/synthesize', requireAdmin, async (req, res) => {
  try {
    const r = await synthesizeDeck({
      title: req.body?.title,
      audience: req.body?.audience,
      language: req.body?.language || 'uz',
      theme: req.body?.theme || 'default',
      slideCount: req.body?.slideCount || 10,
      tone: req.body?.tone || 'formal',
      sources: req.body?.sources || [],
      files: req.body?.files || [],
      model: req.body?.model,
      maxTokens: req.body?.maxTokens || null,
      actorId: actorId(req),
      useStream: req.body?.useStream !== false,
    });
    if (!r.ok) return res.status(400).json({ error: r.error, jobId: r.jobId || null });
    res.json({
      ok: true,
      jobId: r.jobId,
      cached: Boolean(r.cached),
      document: r.document || null,
      usage: r.usage || null,
    });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

/** GET /api/admin/claude/jobs — list jobs. */
router.get('/api/admin/claude/jobs', requireAdmin, async (req, res) => {
  try {
    const rows = await listClaudeJobs({ status: req.query.status || null, limit: req.query.limit || 50 });
    res.json({ jobs: rows });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

/** GET /api/admin/claude/jobs/:id — job detail. */
router.get('/api/admin/claude/jobs/:id', requireAdmin, async (req, res) => {
  try {
    const row = await getClaudeJob(Number(req.params.id));
    if (!row) return res.status(404).json({ error: 'job not found' });
    res.json(row);
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

/** GET /api/admin/claude/jobs/:id/events — streaming SSE job progress. */
router.get('/api/admin/claude/jobs/:id/events', requireAdmin, async (req, res) => {
  try {
    const events = await getClaudeJobEvents(Number(req.params.id));
    res.json({ events });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

/** GET /api/admin/claude/dashboard — aggregate data. */
router.get('/api/admin/claude/dashboard', requireAdmin, async (req, res) => {
  try {
    const dash = await getClaudeDashboard();
    if (!dash.ok) return res.status(400).json({ error: dash.error });
    res.json(dash);
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

/** POST /api/admin/claude/providers/ensure — ensure provider rows. */
router.post('/api/admin/claude/providers/ensure', requireAdmin, async (req, res) => {
  try {
    const r = await ensureClaudeProviders();
    if (!r.ok) return res.status(400).json({ error: r.error });
    res.json({ ok: true, created: r.created });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

/** POST /api/admin/claude/providers/:model — update provider config. */
router.post('/api/admin/claude/providers/:model', requireAdmin, async (req, res) => {
  try {
    const r = await updateClaudeProvider({
      model: req.params.model,
      patch: req.body || {},
      actorId: actorId(req),
    });
    if (!r.ok) return res.status(400).json({ error: r.error });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

/** GET /admin/claude — admin page. */
router.get('/admin/claude', requireAdmin, (req, res) => {
  res.render('admin/claude', {
    title: 'Claude Adapter',
    user: req.session.admin,
    csrfToken: req.csrfToken?.(),
  });
});

export default router;
