/**
 * Edikit — Written AI Grading Shadow Mode Routes
 *
 * Prompt 51 REST API (admin — requireAdmin):
 *   - GET  /api/admin/ai-grading/meta             — constants for admin UI
 *   - POST /api/admin/ai-grading/jobs             — create job (model/version pin)
 *   - GET  /api/admin/ai-grading/jobs             — list jobs
 *   - GET  /api/admin/ai-grading/jobs/:id         — job detail
 *   - POST /api/admin/ai-grading/jobs/:id/run     — shadow run (pure pipeline)
 *   - GET  /api/admin/ai-grading/runs?jobId=      — list shadow runs
 *   - GET  /api/admin/ai-grading/runs/:id         — run + results + spans
 *   - POST /api/admin/ai-grading/runs/:id/override — teacher override (advisory)
 *   - POST /api/admin/ai-grading/jobs/:id/compare — AI-human metrics (QWK/MAE)
 *   - GET  /admin/ai-grading                      — admin page
 *
 * Security (Prompt 51 §15-17):
 *   - requireAdmin barcha write path'da; actor id session'dan.
 *   - LLM total score final authority EMAS — override faqat teacher.
 *   - PII redaction provider'ga borishdan oldin; model web/tool access yo'q.
 *   - Prompt-injection/keyword-stuffing/negation → human_review routing.
 *   - Input validation getDb()'dan oldin (graceful degradation).
 */

import { Router } from 'express';
import { requireAdmin } from '../middleware/auth.js';
import {
  createAiGradingJob,
  listAiGradingJobs,
  getAiGradingJob,
  runAiShadowGrade,
  listAiRuns,
  getAiRun,
  saveAiOverride,
  computeJobComparison,
  AI_JOB_STATUS,
  AI_RUN_STATUS,
  AI_ROUTING,
  AI_PROMPT_TEMPLATE_VERSION,
  CONFIDENCE_AUTO,
  CONFIDENCE_QUEUE,
} from '../src/modules/ai-grading/index.js';

const router = Router();

function actorId(req) {
  return req.session?.admin?.id || req.session?.user?.id || null;
}

/** GET /api/admin/ai-grading/meta — constants for the admin UI. */
router.get('/api/admin/ai-grading/meta', requireAdmin, (req, res) => {
  res.json({
    jobStatus: AI_JOB_STATUS,
    runStatus: AI_RUN_STATUS,
    routing: AI_ROUTING,
    promptTemplateVersion: AI_PROMPT_TEMPLATE_VERSION,
    confidenceAuto: CONFIDENCE_AUTO,
    confidenceQueue: CONFIDENCE_QUEUE,
  });
});

// ═══════════════════════════════════════════════════════════════════
// JOBS
// ═══════════════════════════════════════════════════════════════════

/** POST /api/admin/ai-grading/jobs — create a job (model/version pin). */
router.post('/api/admin/ai-grading/jobs', requireAdmin, async (req, res) => {
  try {
    const r = await createAiGradingJob({
      rubricVersionId: req.body?.rubricVersionId,
      name: req.body?.name,
      model: req.body?.model,
      modelVersion: req.body?.modelVersion,
      createdBy: actorId(req),
    });
    res.status(201).json(r);
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

/** GET /api/admin/ai-grading/jobs — list jobs. */
router.get('/api/admin/ai-grading/jobs', requireAdmin, async (req, res) => {
  try {
    const rows = await listAiGradingJobs({ status: req.query.status });
    res.json({ ok: true, jobs: rows });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

/** GET /api/admin/ai-grading/jobs/:id — job detail. */
router.get('/api/admin/ai-grading/jobs/:id', requireAdmin, async (req, res) => {
  try {
    const job = await getAiGradingJob(Number(req.params.id));
    if (!job) return res.status(404).json({ ok: false, error: 'Job not found' });
    res.json({ ok: true, job });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

/** POST /api/admin/ai-grading/jobs/:id/run — shadow run (pure pipeline). */
router.post('/api/admin/ai-grading/jobs/:id/run', requireAdmin, async (req, res) => {
  try {
    const r = await runAiShadowGrade({
      jobId: Number(req.params.id),
      pseudonym: req.body?.pseudonym,
      responseText: req.body?.responseText || '',
      criterion: req.body?.criterion || {},
      anchors: req.body?.anchors || [],
      providerOutput: req.body?.providerOutput ?? null,
      summative: Boolean(req.body?.summative),
      workItemId: req.body?.workItemId ?? null,
      actorId: actorId(req),
    });
    res.json(r);
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

// ═══════════════════════════════════════════════════════════════════
// RUNS / OVERRIDES / COMPARISON
// ═══════════════════════════════════════════════════════════════════

/** GET /api/admin/ai-grading/runs — list shadow runs. */
router.get('/api/admin/ai-grading/runs', requireAdmin, async (req, res) => {
  try {
    const rows = await listAiRuns({ jobId: req.query.jobId });
    res.json({ ok: true, runs: rows });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

/** GET /api/admin/ai-grading/runs/:id — run + criterion results + spans. */
router.get('/api/admin/ai-grading/runs/:id', requireAdmin, async (req, res) => {
  try {
    const run = await getAiRun(Number(req.params.id));
    if (!run) return res.status(404).json({ ok: false, error: 'Run not found' });
    res.json({ ok: true, run });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

/** POST /api/admin/ai-grading/runs/:id/override — teacher override (advisory). */
router.post('/api/admin/ai-grading/runs/:id/override', requireAdmin, async (req, res) => {
  try {
    const r = await saveAiOverride({
      runId: Number(req.params.id),
      workItemId: req.body?.workItemId ?? null,
      aiTotalScore: req.body?.aiTotalScore,
      overriddenScore: req.body?.overriddenScore,
      reason: req.body?.reason || '',
      teacherId: req.body?.teacherId ?? actorId(req),
    });
    res.json(r);
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

/** POST /api/admin/ai-grading/jobs/:id/compare — AI-human metrics. */
router.post('/api/admin/ai-grading/jobs/:id/compare', requireAdmin, async (req, res) => {
  try {
    const r = await computeJobComparison({ jobId: Number(req.params.id), pairs: req.body?.pairs || [] });
    res.json(r);
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

// ═══════════════════════════════════════════════════════════════════
// ADMIN PAGE
// ═══════════════════════════════════════════════════════════════════

/** GET /admin/ai-grading — human compare/override UI. */
router.get('/admin/ai-grading', requireAdmin, (req, res) => {
  res.render('admin/ai-grading', {
    title: 'AI Grading (Shadow)',
    user: req.session.admin,
    csrfToken: req.csrfToken ? req.csrfToken() : '',
  });
});

export default router;
