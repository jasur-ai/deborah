/**
 * Deborah — Submit Sealing va Signed Receipt Routes
 *
 * Prompt 33 (Phase D #4) REST API:
 *   - GET  /api/student/attempts/:id/submit/preview — completeness summary
 *     (answered/unanswered) for the explicit confirmation UI (§08/§09)
 *   - POST /api/student/attempts/:id/submit            — seal the attempt
 *     (body: { confirmed, entries[] }); UNCONFIRMED → preview only; CONFIRMED
 *     → immutable seal + scoring outbox + signed receipt (idempotent)
 *   - GET  /api/student/attempts/:id/submit/state      — submission state +
 *     receipt (verifiable client-side)
 *
 * Security:
 *   - requireAuth; actor id from the session (never the body).
 *   - The client NEVER sends its own hash/summary/receipt — everything is
 *     recomputed server-side (§15).
 *   - Double submit returns the EXISTING seal + receipt (duplicate score/job
 *     structurally impossible via UNIQUE indexes).
 */

import { Router } from 'express';
import {
  flushPendingBatch,
  getSubmitPreview,
  submitAttempt,
  getSubmissionState,
} from '../src/modules/submit/index.js';
// AUTH B-07 §10: summative (nazorat topshirish) — email verify shart
import { requireAuth, requireEmailVerified } from '../middleware/auth.js';

const router = Router();

function actorId(req) {
  return req.session?.user?.id || null;
}

/** GET /api/student/attempts/:id/submit/preview — completeness summary. */
router.get('/api/student/attempts/:id/submit/preview', async (req, res) => {
  try {
    const userId = actorId(req);
    if (!userId) return res.status(401).json({ error: 'Authentication required' });
    const preview = await getSubmitPreview(parseInt(req.params.id, 10), userId);
    if (!preview) return res.status(404).json({ error: 'Attempt not found' });
    res.json(preview);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/** POST /api/student/attempts/:id/submit — seal (idempotent) or preview. */
// B-07 §10: summative seal — email verify'siz 403 EMAIL_VERIFY_REQUIRED.
// Preview (confirmed=false) read-only — ochiq qoladi (o'qish/practice ruxsat,
// spec §10); faqat CONFIRMED seal (nazorat topshirish) verify shart.
router.post('/api/student/attempts/:id/submit', requireAuth, async (req, res) => {
  try {
    const { confirmed = false, entries = [] } = req.body || {};

    // B-07 §10: summative amal — confirmed=true (seal) verify shart.
    // actorId'den OLDIN tekshiriladi — session'da .id bo'lmasa ham
    // gate to'g'ri javob beradi (safeKey yetarli).
    if (confirmed === true) {
      await requireEmailVerified(req, res, () => {});
      if (res.headersSent) return;
    }

    const userId = actorId(req);
    if (!userId) return res.status(401).json({ error: 'Authentication required' });

    const result = await submitAttempt({
      attemptId: parseInt(req.params.id, 10),
      userId,
      confirmed: !!confirmed,
      entries: Array.isArray(entries) ? entries : [],
    });

    if (result.ok === false && result.code === 'not_found') {
      return res.status(404).json({ error: 'Attempt not found' });
    }
    if (result.ok === false && result.code === 'attempt_closed') {
      return res.status(409).json({ error: `Submit rejected: ${result.reason || 'attempt closed'}`, code: result.code });
    }
    if (result.preview) {
      return res.json(result); // 200 preview — awaiting explicit confirmation
    }
    res.status(result.duplicate ? 200 : 201).json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/** GET /api/student/attempts/:id/submit/state — submission state + receipt. */
router.get('/api/student/attempts/:id/submit/state', async (req, res) => {
  try {
    const userId = actorId(req);
    if (!userId) return res.status(401).json({ error: 'Authentication required' });
    const state = await getSubmissionState(parseInt(req.params.id, 10), userId);
    if (!state) return res.status(404).json({ error: 'Attempt not found' });
    res.json(state);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/** POST /api/student/attempts/:id/submit/flush — flush pending batch only. */
router.post('/api/student/attempts/:id/submit/flush', async (req, res) => {
  try {
    const userId = actorId(req);
    if (!userId) return res.status(401).json({ error: 'Authentication required' });
    const { entries = [] } = req.body || {};
    if (!Array.isArray(entries)) return res.status(400).json({ error: 'entries must be an array' });
    const result = await flushPendingBatch({
      attemptId: parseInt(req.params.id, 10),
      userId,
      entries,
    });
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

export default router;
