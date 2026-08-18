/**
 * Deborah — AI/Content Checkpoint Routes
 *
 * Prompt 60 REST API:
 *   - GET   /api/admin/ai-checkpoint/meta   — constants (version, scopes, pilots)
 *   - POST  /api/admin/ai-checkpoint/run    — run measured pilot (idempotent)
 *   - GET   /api/admin/ai-checkpoint/runs   — list runs
 *   - GET   /api/admin/ai-checkpoint/runs/:id — run detail
 *   - GET   /admin/ai-checkpoint            — admin page
 *
 * Security (Prompt 60 §15-17): requireAdmin; har write path tenant-scoped
 * + idempotent; checkpoint run — privileged action → audit.
 */

import { Router } from 'express';
import { requireAdmin } from '../middleware/auth.js';
import {
  runAiCheckpoint,
  listCheckpointRuns,
  getCheckpointRun,
  CHECKPOINT_META,
} from '../src/modules/ai-checkpoint/index.js';

const router = Router();

function actorId(req) {
  return req.session?.admin?.id || req.session?.admin?.username || req.session?.user?.id || null;
}

/** GET /api/admin/ai-checkpoint/meta — constants. */
router.get('/api/admin/ai-checkpoint/meta', requireAdmin, (req, res) => {
  res.json(CHECKPOINT_META);
});

/** POST /api/admin/ai-checkpoint/run — run measured pilot (idempotent). */
router.post('/api/admin/ai-checkpoint/run', requireAdmin, async (req, res) => {
  try {
    const r = await runAiCheckpoint({
      scope: req.body?.scope || 'full',
      data: req.body?.data || {},
      actorId: actorId(req),
    });
    if (!r.ok) return res.status(400).json({ error: r.error });
    res.json({
      ok: true,
      runId: r.runId,
      cached: r.cached || false,
      ready: r.ready,
      summary: r.summary,
      pilots: r.pilots,
      residualRisks: r.residualRisks,
    });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

/** GET /api/admin/ai-checkpoint/runs — list runs. */
router.get('/api/admin/ai-checkpoint/runs', requireAdmin, async (req, res) => {
  try {
    const rows = await listCheckpointRuns({ scope: req.query.scope || null, limit: req.query.limit || 50 });
    res.json({ runs: rows });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

/** GET /api/admin/ai-checkpoint/runs/:id — run detail. */
router.get('/api/admin/ai-checkpoint/runs/:id', requireAdmin, async (req, res) => {
  try {
    const row = await getCheckpointRun(Number(req.params.id));
    if (!row) return res.status(404).json({ error: 'checkpoint run not found' });
    res.json(row);
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

/** GET /admin/ai-checkpoint — admin page. */
router.get('/admin/ai-checkpoint', requireAdmin, (req, res) => {
  res.render('admin/ai-checkpoint', {
    title: 'AI Checkpoint',
    user: req.session.admin,
    csrfToken: req.csrfToken?.(),
  });
});

export default router;
