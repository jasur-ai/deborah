/**
 * Deborah — AI Question Generator 50/30/20 Routes
 *
 * Prompt 53 REST API (admin — requireAdmin):
 *   - GET  /api/admin/ai-question-gen/meta        — constants for admin UI
 *   - POST /api/admin/ai-question-gen/blueprints  — create blueprint + jobs
 *   - GET  /api/admin/ai-question-gen/blueprints  — list blueprints
 *   - GET  /api/admin/ai-question-gen/blueprints/:id — blueprint + jobs
 *   - POST /api/admin/ai-question-gen/candidates  — submit candidate (validators)
 *   - GET  /api/admin/ai-question-gen/candidates  — list candidates
 *   - GET  /api/admin/ai-question-gen/candidates/:id — candidate + validations
 *   - POST /api/admin/ai-question-gen/candidates/:id/review — teacher review/publish
 *   - GET  /api/admin/ai-question-gen/dashboard   — aggregate data
 *   - GET  /admin/ai-question-gen                 — admin page
 *
 * Security (Prompt 53 §15-17):
 *   - requireAdmin barcha write path'da; actor id session'dan.
 *   - AI_DRAFT teacher approval'siz APPROVED bo'lmaydi (lifecycle guard).
 *   - Source-grounded: verifyCitation — answer approved chunk'da bo'lmasa reject.
 *   - Publish faqat APPROVED → item-bank (source: ai_generated).
 */

import { Router } from 'express';
import { requireAdmin } from '../middleware/auth.js';
import {
  createGenerationBlueprint,
  listGenerationBlueprints,
  getGenerationBlueprint,
  submitGeneratedCandidate,
  listGeneratedCandidates,
  getGeneratedCandidate,
  reviewGeneratedCandidate,
  getQuestionGenDashboard,
  GEN_BLUEPRINT_STATUS,
  GEN_JOB_STATUS,
  GEN_CANDIDATE_STATUS,
  GEN_REVIEW_DECISION,
  SUPPORTED_ITEM_TYPES,
} from '../src/modules/ai-question-gen/index.js';

const router = Router();

function actorId(req) {
  return req.session?.admin?.id || req.session?.admin?.username || req.session?.user?.id || null;
}

/** GET /api/admin/ai-question-gen/meta — constants for the admin UI. */
router.get('/api/admin/ai-question-gen/meta', requireAdmin, (req, res) => {
  res.json({
    blueprintStatus: GEN_BLUEPRINT_STATUS,
    jobStatus: GEN_JOB_STATUS,
    candidateStatus: GEN_CANDIDATE_STATUS,
    reviewDecision: GEN_REVIEW_DECISION,
    supportedItemTypes: SUPPORTED_ITEM_TYPES,
  });
});

// ═══════════════════════════════════════════════════════════════════
// BLUEPRINTS
// ═══════════════════════════════════════════════════════════════════

/** POST /api/admin/ai-question-gen/blueprints — create blueprint + jobs. */
router.post('/api/admin/ai-question-gen/blueprints', requireAdmin, async (req, res) => {
  try {
    const r = await createGenerationBlueprint({
      name: req.body?.name,
      competencyId: req.body?.competencyId,
      sourcePackId: req.body?.sourcePackId,
      subjectArea: req.body?.subjectArea,
      educationLevel: req.body?.educationLevel,
      language: req.body?.language,
      targetCount: Number(req.body?.targetCount),
      itemTypes: req.body?.itemTypes || ['single_choice'],
      model: req.body?.model,
      modelVersion: req.body?.modelVersion,
      overgenerateFactor: req.body?.overgenerateFactor,
      createdBy: actorId(req),
    });
    res.status(201).json(r);
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

/** GET /api/admin/ai-question-gen/blueprints — list blueprints. */
router.get('/api/admin/ai-question-gen/blueprints', requireAdmin, async (req, res) => {
  try {
    const rows = await listGenerationBlueprints({ status: req.query.status });
    res.json({ ok: true, blueprints: rows });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

/** GET /api/admin/ai-question-gen/blueprints/:id — blueprint + jobs. */
router.get('/api/admin/ai-question-gen/blueprints/:id', requireAdmin, async (req, res) => {
  try {
    const b = await getGenerationBlueprint(Number(req.params.id));
    if (!b) return res.status(404).json({ ok: false, error: 'Blueprint not found' });
    res.json({ ok: true, blueprint: b });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

// ═══════════════════════════════════════════════════════════════════
// CANDIDATES
// ═══════════════════════════════════════════════════════════════════

/** POST /api/admin/ai-question-gen/candidates — submit generated candidate. */
router.post('/api/admin/ai-question-gen/candidates', requireAdmin, async (req, res) => {
  try {
    const r = await submitGeneratedCandidate({
      jobId: Number(req.body?.jobId),
      candidate: req.body?.candidate || {},
      approvedChunks: req.body?.approvedChunks || [],
      existingHashes: req.body?.existingHashes || [],
      actorId: actorId(req),
    });
    res.status(201).json(r);
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

/** GET /api/admin/ai-question-gen/candidates — list candidates. */
router.get('/api/admin/ai-question-gen/candidates', requireAdmin, async (req, res) => {
  try {
    const rows = await listGeneratedCandidates({
      jobId: req.query.jobId ? Number(req.query.jobId) : null,
      blueprintId: req.query.blueprintId ? Number(req.query.blueprintId) : null,
      status: req.query.status,
      limit: req.query.limit ? Number(req.query.limit) : 100,
    });
    res.json({ ok: true, candidates: rows });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

/** GET /api/admin/ai-question-gen/candidates/:id — candidate + validations. */
router.get('/api/admin/ai-question-gen/candidates/:id', requireAdmin, async (req, res) => {
  try {
    const c = await getGeneratedCandidate(Number(req.params.id));
    if (!c) return res.status(404).json({ ok: false, error: 'Candidate not found' });
    res.json({ ok: true, candidate: c });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

/** POST /api/admin/ai-question-gen/candidates/:id/review — teacher review/publish. */
router.post('/api/admin/ai-question-gen/candidates/:id/review', requireAdmin, async (req, res) => {
  try {
    const r = await reviewGeneratedCandidate({
      candidateId: Number(req.params.id),
      decision: req.body?.decision,
      note: req.body?.note || '',
      edits: req.body?.edits || null,
      bankId: req.body?.bankId,
      reviewerId: actorId(req),
    });
    res.json(r);
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

// ═══════════════════════════════════════════════════════════════════
// DASHBOARD + PAGE
// ═══════════════════════════════════════════════════════════════════

/** GET /api/admin/ai-question-gen/dashboard — aggregate data. */
router.get('/api/admin/ai-question-gen/dashboard', requireAdmin, async (req, res) => {
  try {
    const r = await getQuestionGenDashboard({ blueprintId: req.query.blueprintId ? Number(req.query.blueprintId) : null });
    res.json(r);
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

/** GET /admin/ai-question-gen — question generator admin page. */
router.get('/admin/ai-question-gen', requireAdmin, (req, res) => {
  res.render('admin/question-gen', {
    title: 'AI Question Generator',
    user: req.session.admin,
    csrfToken: req.csrfToken ? req.csrfToken() : '',
  });
});

export default router;
