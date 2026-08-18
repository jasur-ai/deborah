/**
 * Deborah — Uch-strike Client Collector & Server Classifier Routes
 *
 * Prompt 34 (Phase D #5) REST API:
 *   - POST /api/student/attempts/:id/proctor/events — browser collector
 *     ingests raw visibility/fullscreen/blur/network/camera events; server
 *     classifies (threshold + dedupe), maintains strikes and terminates on
 *     the third confirmed incident (idempotent by client_seq)
 *   - GET  /api/student/attempts/:id/proctor/state    — strikes + explainable
 *     timeline for the student
 *   - POST /api/admin/attempts/:id/proctor/reopen     — PRIVILEGED reopen
 *     (teacher) — bumps epoch, old-epoch events rejected afterwards
 *
 * Security:
 *   - Student routes require an authenticated session; actor id from session.
 *   - The server NEVER trusts client classification — raw events are stored
 *     and classified server-side (three-layer model, research.md §31.1).
 *   - Reopen is admin-only + audited (PROCTOR_REOPEN).
 */

import { Router } from 'express';
import { requireAdmin } from '../middleware/auth.js';
import {
  recordProctorEvents,
  getProctorState,
  reopenAttempt,
} from '../src/modules/proctor/index.js';

const router = Router();

function actorId(req) {
  return req.session?.user?.id || null;
}

/** POST /api/student/attempts/:id/proctor/events — collector ingest. */
router.post('/api/student/attempts/:id/proctor/events', async (req, res) => {
  try {
    const userId = actorId(req);
    if (!userId) return res.status(401).json({ error: 'Authentication required' });

    const { events = [] } = req.body || {};
    if (!Array.isArray(events)) return res.status(400).json({ error: 'events must be an array' });

    const result = await recordProctorEvents({
      attemptId: parseInt(req.params.id, 10),
      userId,
      events,
    });

    if (result.ok === false && result.code === 'not_found') {
      return res.status(404).json({ error: 'Attempt not found' });
    }
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/** GET /api/student/attempts/:id/proctor/state — strikes + timeline. */
router.get('/api/student/attempts/:id/proctor/state', async (req, res) => {
  try {
    const userId = actorId(req);
    if (!userId) return res.status(401).json({ error: 'Authentication required' });
    const state = await getProctorState(parseInt(req.params.id, 10), userId);
    if (!state) return res.status(404).json({ error: 'Attempt not found' });
    res.json(state);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/** POST /api/admin/attempts/:id/proctor/reopen — PRIVILEGED teacher reopen. */
router.post('/api/admin/attempts/:id/proctor/reopen', requireAdmin, async (req, res) => {
  try {
    const actor = req.session?.admin?.username || req.session?.admin?.id || 'admin';
    const result = await reopenAttempt({ attemptId: parseInt(req.params.id, 10), actor });
    if (result.ok === false && result.code === 'not_found') {
      return res.status(404).json({ error: 'Attempt not found' });
    }
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

export default router;
