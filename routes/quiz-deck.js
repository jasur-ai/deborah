/**
 * Edikit — Quiz-from-Deck Routes
 *
 * Prompt 59:
 *   - GET   /api/admin/quiz-deck/meta          — constants
 *   - POST  /api/admin/quiz-deck/generate      — generate quiz from canonical deck
 *   - GET   /api/admin/quiz-deck/jobs          — list quiz jobs
 *   - GET   /api/admin/quiz-deck/jobs/:id      — quiz job detail
 *   - POST  /api/admin/quiz-deck/jobs/:id/approve — teacher approval
 *   - POST  /api/admin/quiz-deck/jobs/:id/publish — publish (teacher approval'dan keyin)
 *   - GET   /admin/quiz-deck                   — admin page
 *
 * Security (Prompt 59 §16, §22.18): AI savol teacher approval'siz
 * publish qilinmaydi; har bir write path tenant-scoped + idempotent.
 */

import { Router } from 'express';
import { requireAdmin } from '../middleware/auth.js';
import {
  generateQuizFromDeck,
  approveQuiz,
  publishQuiz,
  listQuizJobs,
  getQuizJob,
  QUIZ_META,
} from '../src/modules/quiz-deck/index.js';

const router = Router();

function actorId(req) {
  return req.session?.admin?.id || req.session?.admin?.username || req.session?.user?.id || null;
}

/** Parse jsonb value that may be a string (fake DB) or object (real PG). */
function parseJson(v) {
  if (v == null) return null;
  if (typeof v === 'object') return v;
  try {
    return JSON.parse(v);
  } catch (_) {
    return null;
  }
}

/** Map a raw job row to a view-friendly shape (jsonb → plain). */
function mapJobRow(row) {
  const questions = parseJson(row?.questions) || [];
  const needsReview = parseJson(row?.needs_review) || [];
  return {
    ...row,
    item_count: Array.isArray(questions) ? questions.length : 0,
    needs_review: Array.isArray(needsReview) && needsReview.length > 0,
    questions: undefined,
  };
}

/** GET /api/admin/quiz-deck/meta — constants. */
router.get('/api/admin/quiz-deck/meta', requireAdmin, (req, res) => {
  res.json(QUIZ_META);
});

/** POST /api/admin/quiz-deck/generate — generate quiz from canonical deck. */
router.post('/api/admin/quiz-deck/generate', requireAdmin, async (req, res) => {
  try {
    const r = await generateQuizFromDeck({
      presentationId: req.body?.presentationId,
      versionId: req.body?.versionId,
      document: req.body?.document,
      sourcePacks: req.body?.sourcePacks || [],
      previousDocument: req.body?.previousDocument || null,
      total: req.body?.total || null,
      actorId: actorId(req),
    });
    if (!r.ok) return res.status(400).json({ error: r.error });
    res.json({ ok: true, jobId: r.jobId, cached: r.cached || false, status: r.status, questions: r.questions, blueprint: r.blueprint, needsReview: r.needsReview });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

/** GET /api/admin/quiz-deck/jobs — list quiz jobs. */
router.get('/api/admin/quiz-deck/jobs', requireAdmin, async (req, res) => {
  try {
    const rows = await listQuizJobs({ status: req.query.status || null, limit: req.query.limit || 50 });
    res.json({ jobs: rows.map(mapJobRow) });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

/** GET /api/admin/quiz-deck/jobs/:id — quiz job detail. */
router.get('/api/admin/quiz-deck/jobs/:id', requireAdmin, async (req, res) => {
  try {
    const row = await getQuizJob(Number(req.params.id));
    if (!row) return res.status(404).json({ error: 'quiz job not found' });
    res.json(row);
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

/** POST /api/admin/quiz-deck/jobs/:id/approve — teacher approval. */
router.post('/api/admin/quiz-deck/jobs/:id/approve', requireAdmin, async (req, res) => {
  try {
    const r = await approveQuiz({ jobId: Number(req.params.id), actorId: actorId(req) });
    if (!r.ok) return res.status(400).json({ error: r.error });
    res.json({ ok: true, status: r.status });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

/** POST /api/admin/quiz-deck/jobs/:id/publish — publish (after teacher approval). */
router.post('/api/admin/quiz-deck/jobs/:id/publish', requireAdmin, async (req, res) => {
  try {
    const r = await publishQuiz({ jobId: Number(req.params.id), actorId: actorId(req) });
    if (!r.ok) return res.status(400).json({ error: r.error });
    res.json({ ok: true, status: r.status, itemIds: r.itemIds });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

/** GET /admin/quiz-deck — admin page. */
router.get('/admin/quiz-deck', requireAdmin, (req, res) => {
  res.render('admin/quiz-deck', {
    title: 'Quiz from Deck',
    user: req.session.admin,
    csrfToken: req.csrfToken?.(),
  });
});

export default router;
