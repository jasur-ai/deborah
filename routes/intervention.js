/**
 * Deborah — Intervention Loop, Adaptive Practice & Support Routes
 *
 * Prompt 55 REST API (admin — requireAdmin):
 *   - GET  /api/admin/interventions/meta           — constants for admin UI
 *   - POST /api/admin/interventions/misconceptions — suggest mapping (AI, draft)
 *   - GET  /api/admin/interventions/misconceptions — list mappings
 *   - POST /api/admin/interventions/clusters/:id/review — approve/reject
 *   - POST /api/admin/interventions/library        — create intervention
 *   - POST /api/admin/interventions/library/:id/publish — publish + version
 *   - GET  /api/admin/interventions/library        — published interventions
 *   - POST /api/admin/interventions/cards          — generate next-action cards
 *   - GET  /api/admin/interventions/cards          — list cards
 *   - POST /api/admin/interventions/cards/:id/decision — approve/edit/dismiss/assign
 *   - POST /api/admin/interventions/reassessments  — assign different-item reassessment
 *   - POST /api/admin/interventions/metrics        — before/after/retention
 *   - POST /api/admin/interventions/mastery        — update rule/BKT mastery
 *   - POST /api/admin/interventions/practice       — schedule practice session
 *   - POST /api/admin/interventions/support        — open support case (privacy-guarded)
 *   - POST /api/admin/interventions/support/:id/close — resolve case
 *   - POST /api/admin/interventions/contest        — student contest request
 *   - GET  /api/admin/interventions/dashboard      — aggregate data
 *   - GET  /admin/interventions                    — admin page
 *
 * Security (Prompt 55 §15-17):
 *   - AI hech qachon intervention assign qilmaydi — faqat recommendation.
 *   - Permanent low-ability label / auto penalty / private chat sentiment
 *     ishlatilmaydi (Ethical Student Success — §47 #10).
 *   - Har bir write path tenant-scoped + idempotent.
 */

import { Router } from 'express';
import { requireAdmin } from '../middleware/auth.js';
import {
  suggestMisconceptionMapping,
  reviewMisconceptionCluster,
  listMisconceptionMappings,
  createIntervention,
  publishIntervention,
  listPublishedInterventions,
  generateNextActionCards,
  listActionCards,
  decideNextAction,
  assignReassessment,
  recordInterventionMetrics,
  updateMasteryEstimate,
  schedulePracticeSession,
  openSupportCase,
  resolveSupportCase,
  submitContestRequest,
  getInterventionDashboard,
  INTERVENTION_META,
  TEACHER_DECISIONS,
  INTERVENTION_KINDS,
  SUPPORT_SIGNAL_TYPES,
  CONTEST_REQUEST_TYPES,
} from '../src/modules/intervention/index.js';

const router = Router();

function actorId(req) {
  return req.session?.admin?.id || req.session?.admin?.username || req.session?.user?.id || null;
}

/** GET /api/admin/interventions/meta — constants for the admin UI. */
router.get('/api/admin/interventions/meta', requireAdmin, (req, res) => {
  res.json({
    ...INTERVENTION_META,
    teacherDecisions: TEACHER_DECISIONS,
    interventionKinds: INTERVENTION_KINDS,
    supportSignalTypes: SUPPORT_SIGNAL_TYPES,
    contestRequestTypes: CONTEST_REQUEST_TYPES,
  });
});

// ═══════════════════════════════════════════════════════════════════
// MISCONCEPTION MAPPINGS + CLUSTER REVIEW
// ═══════════════════════════════════════════════════════════════════

router.post('/api/admin/interventions/misconceptions', requireAdmin, async (req, res) => {
  try {
    const r = await suggestMisconceptionMapping({
      competencyId: req.body?.competencyId,
      label: req.body?.label,
      description: req.body?.description,
      evidencePattern: req.body?.evidencePattern,
      clusterKey: req.body?.clusterKey,
      actorId: actorId(req),
    });
    if (!r.ok) return res.status(400).json({ error: r.error });
    res.json({ ok: true, mappingId: r.mappingId, duplicate: Boolean(r.duplicate) });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

router.get('/api/admin/interventions/misconceptions', requireAdmin, async (req, res) => {
  try {
    const rows = await listMisconceptionMappings({
      competencyId: req.query.competencyId ? Number(req.query.competencyId) : null,
      status: req.query.status || null,
    });
    res.json({ mappings: rows });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

router.post('/api/admin/interventions/clusters/:id/review', requireAdmin, async (req, res) => {
  try {
    const r = await reviewMisconceptionCluster({
      clusterId: Number(req.params.id),
      decision: req.body?.decision,
      note: req.body?.note,
      actorId: actorId(req),
    });
    if (!r.ok) return res.status(400).json({ error: r.error });
    res.json({ ok: true, status: r.status });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

// ═══════════════════════════════════════════════════════════════════
// INTERVENTION LIBRARY
// ═══════════════════════════════════════════════════════════════════

router.post('/api/admin/interventions/library', requireAdmin, async (req, res) => {
  try {
    const r = await createIntervention({
      kind: req.body?.kind,
      title: req.body?.title,
      description: req.body?.description,
      sourcePackId: req.body?.sourcePackId,
      targetClusterId: req.body?.targetClusterId,
      actorId: actorId(req),
    });
    if (!r.ok) return res.status(400).json({ error: r.error });
    res.json({ ok: true, interventionId: r.interventionId });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

router.post('/api/admin/interventions/library/:id/publish', requireAdmin, async (req, res) => {
  try {
    const r = await publishIntervention({
      interventionId: Number(req.params.id),
      actorId: actorId(req),
    });
    if (!r.ok) return res.status(400).json({ error: r.error });
    res.json({ ok: true, version: r.version });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

router.get('/api/admin/interventions/library', requireAdmin, async (req, res) => {
  try {
    const rows = await listPublishedInterventions();
    res.json({ interventions: rows });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

// ═══════════════════════════════════════════════════════════════════
// NEXT-ACTION CARDS + TEACHER DECISION
// ═══════════════════════════════════════════════════════════════════

router.post('/api/admin/interventions/cards', requireAdmin, async (req, res) => {
  try {
    const r = await generateNextActionCards({
      evidence: req.body?.evidence || {},
      actorId: actorId(req),
    });
    if (!r.ok) return res.status(400).json({ error: r.error });
    res.json({ ok: true, cardId: r.cardId, card: r.card, duplicate: Boolean(r.duplicate) });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

router.get('/api/admin/interventions/cards', requireAdmin, async (req, res) => {
  try {
    const rows = await listActionCards({
      status: req.query.status || null,
      studentId: req.query.studentId ? Number(req.query.studentId) : null,
    });
    res.json({ cards: rows });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

router.post('/api/admin/interventions/cards/:id/decision', requireAdmin, async (req, res) => {
  try {
    const r = await decideNextAction({
      cardId: Number(req.params.id),
      decision: req.body?.decision,
      note: req.body?.note,
      edits: req.body?.edits,
      actorId: actorId(req),
    });
    if (!r.ok) return res.status(400).json({ error: r.error });
    res.json({ ok: true, status: r.status });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

// ═══════════════════════════════════════════════════════════════════
// REASSESSMENT + METRICS + MASTERY + PRACTICE
// ═══════════════════════════════════════════════════════════════════

router.post('/api/admin/interventions/reassessments', requireAdmin, async (req, res) => {
  try {
    const r = await assignReassessment({
      cardId: req.body?.cardId,
      studentId: req.body?.studentId,
      competencyId: req.body?.competencyId,
      sourceAttemptId: req.body?.sourceAttemptId,
      itemPool: req.body?.itemPool || [],
      sourceItemIds: req.body?.sourceItemIds || [],
      count: req.body?.count ?? 5,
      actorId: actorId(req),
    });
    if (!r.ok) return res.status(400).json({ error: r.error });
    res.json({ ok: true, reassessmentId: r.reassessmentId, items: r.items, duplicate: Boolean(r.duplicate) });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

router.post('/api/admin/interventions/metrics', requireAdmin, async (req, res) => {
  try {
    const r = await recordInterventionMetrics({
      studentId: req.body?.studentId,
      interventionId: req.body?.interventionId,
      preScore: req.body?.preScore,
      postScore: req.body?.postScore,
      retentionScore: req.body?.retentionScore,
      preAttemptId: req.body?.preAttemptId,
      postAttemptId: req.body?.postAttemptId,
      retentionAt: req.body?.retentionAt,
      actorId: actorId(req),
    });
    if (!r.ok) return res.status(400).json({ error: r.error });
    res.json({ ok: true, ...r });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

router.post('/api/admin/interventions/mastery', requireAdmin, async (req, res) => {
  try {
    const r = await updateMasteryEstimate({
      studentId: req.body?.studentId,
      competencyId: req.body?.competencyId,
      method: req.body?.method || 'rule',
      responses: req.body?.responses || [],
      correct: req.body?.correct,
      total: req.body?.total,
      lastN: req.body?.lastN || [],
      actorId: actorId(req),
    });
    if (!r.ok) return res.status(400).json({ error: r.error });
    res.json({ ok: true, est: r.est, level: r.level, method: r.method });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

router.post('/api/admin/interventions/practice', requireAdmin, async (req, res) => {
  try {
    const r = await schedulePracticeSession({
      studentId: req.body?.studentId,
      competencyId: req.body?.competencyId,
      sessionCount: req.body?.sessionCount ?? 0,
      lastDueAt: req.body?.lastDueAt,
      actorId: actorId(req),
    });
    if (!r.ok) return res.status(400).json({ error: r.error });
    res.json({ ok: true, sessionId: r.sessionId, intervalDays: r.intervalDays, dueAt: r.dueAt });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

// ═══════════════════════════════════════════════════════════════════
// SUPPORT CASE + STUDENT CONTEST (ETHICAL — NO PREDICTION LABELS)
// ═══════════════════════════════════════════════════════════════════

router.post('/api/admin/interventions/support', requireAdmin, async (req, res) => {
  try {
    const r = await openSupportCase({
      studentId: req.body?.studentId,
      signalType: req.body?.signalType || 'weak_concept',
      evidence: req.body?.evidence || {},
      notes: req.body?.notes,
      owner: req.body?.owner,
      actorId: actorId(req),
    });
    if (!r.ok) return res.status(400).json({ error: r.error });
    res.json({ ok: true, caseId: r.caseId, duplicate: Boolean(r.duplicate) });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

router.post('/api/admin/interventions/support/:id/close', requireAdmin, async (req, res) => {
  try {
    const r = await resolveSupportCase({
      caseId: Number(req.params.id),
      outcome: req.body?.outcome,
      actorId: actorId(req),
    });
    if (!r.ok) return res.status(400).json({ error: r.error });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

router.post('/api/admin/interventions/contest', requireAdmin, async (req, res) => {
  try {
    const r = await submitContestRequest({
      studentId: req.body?.studentId,
      caseId: req.body?.caseId,
      requestType: req.body?.requestType || 'appeal',
      reason: req.body?.reason,
      actorId: actorId(req),
    });
    if (!r.ok) return res.status(400).json({ error: r.error });
    res.json({ ok: true, contestId: r.contestId });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

// ═══════════════════════════════════════════════════════════════════
// DASHBOARD + PAGE
// ═══════════════════════════════════════════════════════════════════

router.get('/api/admin/interventions/dashboard', requireAdmin, async (req, res) => {
  try {
    const dash = await getInterventionDashboard();
    if (!dash.ok) return res.status(400).json({ error: dash.error });
    res.json(dash);
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

router.get('/admin/interventions', requireAdmin, (req, res) => {
  res.render('admin/intervention', {
    title: 'Intervention Loop',
    user: req.session.admin,
    csrfToken: req.csrfToken?.(),
  });
});

export default router;
