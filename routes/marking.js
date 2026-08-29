/**
 * Deborah — Marker Allocation, Calibration & Moderation Routes
 *
 * Prompt 46 REST API:
 *   - GET  /api/admin/marking/meta                  — constants for the admin UI
 *   - POST /api/admin/marking/assignments           — create marking assignment
 *   - GET  /api/admin/marking/assignments           — list assignments
 *   - GET  /api/admin/marking/assignments/:id       — assignment detail
 *   - POST /api/admin/marking/assignments/:id/allocate — allocate work items (pseudonymous)
 *   - GET  /api/admin/marking/assignments/:id/progress — progress/overdue metrics
 *   - POST /api/admin/marking/calibrations          — open calibration run
 *   - POST /api/admin/marking/calibrations/:id/complete — complete calibration (threshold-gated)
 *   - GET  /api/admin/marking/calibrations          — list calibration runs
 *   - GET  /api/admin/marking/work-items            — list work items
 *   - GET  /api/admin/marking/work-items/:id/scores — criterion scores for a work item
 *   - POST /api/admin/marking/work-items/:id/scores — save marker scores
 *   - GET  /api/admin/marking/moderation            — list moderation cases
 *   - POST /api/admin/marking/moderation/:id/adjudicate — adjudicate disagreement
 *   - GET  /admin/marking                           — admin page
 *
 * Security (Prompt 46):
 *   - requireAdmin on all write paths; actor id from session.
 *   - Pseudonyms are derived server-side (HMAC-salted) — markers never see
 *     the student's real identity.
 *   - External examiner scoping enforced in service (only own work items).
 */

import { Router } from 'express';
import { requireAdmin } from '../middleware/auth.js';
import {
  createMarkingAssignment,
  allocateWorkItems,
  openCalibrationRun,
  completeCalibrationRun,
  saveCriterionScores,
  adjudicateModerationCase,
  getMarkingAssignment,
  listMarkingAssignments,
  listWorkItems,
  listCriterionScores,
  listModerationCases,
  listCalibrationRuns,
  getAssignmentProgress,
  MARKER_ROLES,
  ASSIGNMENT_STATUS,
  WORK_ITEM_STATUS,
  MARKING_MODES,
  CALIBRATION_STATUS,
  MODERATION_STATUS,
  MARKING_DEFAULTS,
} from '../src/modules/marking/index.js';

const router = Router();

function actorId(req) {
  return req.session?.admin?.id || req.session?.user?.id || null;
}

// ═══════════════════════════════════════════════════════════════════
// META / CONSTANTS
// ═══════════════════════════════════════════════════════════════════

/** GET /api/admin/marking/meta — constants for the admin UI. */
router.get('/api/admin/marking/meta', requireAdmin, (req, res) => {
  res.json({
    markerRoles: MARKER_ROLES,
    assignmentStatus: ASSIGNMENT_STATUS,
    workItemStatus: WORK_ITEM_STATUS,
    markingModes: MARKING_MODES,
    calibrationStatus: CALIBRATION_STATUS,
    moderationStatus: MODERATION_STATUS,
    defaults: MARKING_DEFAULTS,
  });
});

// ═══════════════════════════════════════════════════════════════════
// ASSIGNMENTS (allocation)
// ═══════════════════════════════════════════════════════════════════

/** POST /api/admin/marking/assignments — create a marking assignment. */
router.post('/api/admin/marking/assignments', requireAdmin, async (req, res) => {
  try {
    const { assessmentId, markerUserId, role, workloadCap, externalScoped, conflicts } = req.body || {};
    const result = await createMarkingAssignment({
      assessmentId,
      markerUserId,
      role,
      workloadCap,
      externalScoped,
      conflicts,
      createdBy: actorId(req),
    });
    res.status(result.ok ? 201 : 400).json(result);
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

/** GET /api/admin/marking/assignments — list assignments. */
router.get('/api/admin/marking/assignments', requireAdmin, async (req, res) => {
  try {
    const rows = await listMarkingAssignments({
      assessmentId: req.query.assessmentId ? Number(req.query.assessmentId) : undefined,
      markerUserId: req.query.markerUserId ? Number(req.query.markerUserId) : undefined,
    });
    res.json({ ok: true, rows });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

/** GET /api/admin/marking/assignments/:id — assignment detail. */
router.get('/api/admin/marking/assignments/:id', requireAdmin, async (req, res) => {
  try {
    const row = await getMarkingAssignment(Number(req.params.id));
    if (!row) return res.status(404).json({ ok: false, error: 'Assignment not found' });
    res.json({ ok: true, row });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

/** POST /api/admin/marking/assignments/:id/allocate — allocate work items. */
router.post('/api/admin/marking/assignments/:id/allocate', requireAdmin, async (req, res) => {
  try {
    const { submissions, opts } = req.body || {};
    const result = await allocateWorkItems({
      assignmentId: Number(req.params.id),
      submissions: submissions || [],
      opts: opts || {},
      createdBy: actorId(req),
    });
    res.status(result.ok ? 201 : 400).json(result);
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

/** GET /api/admin/marking/assignments/:id/progress — progress metrics. */
router.get('/api/admin/marking/assignments/:id/progress', requireAdmin, async (req, res) => {
  try {
    const metrics = await getAssignmentProgress(Number(req.params.id));
    res.json({ ok: true, ...metrics });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

// ═══════════════════════════════════════════════════════════════════
// CALIBRATION
// ═══════════════════════════════════════════════════════════════════

/** POST /api/admin/marking/calibrations — open a calibration run. */
router.post('/api/admin/marking/calibrations', requireAdmin, async (req, res) => {
  try {
    const { assignmentId, anchorSetId, goldScores, threshold } = req.body || {};
    const result = await openCalibrationRun({
      assignmentId,
      anchorSetId,
      goldScores,
      threshold,
      createdBy: actorId(req),
    });
    res.status(result.ok ? 201 : 400).json(result);
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

/** POST /api/admin/marking/calibrations/:id/complete — complete calibration. */
router.post('/api/admin/marking/calibrations/:id/complete', requireAdmin, async (req, res) => {
  try {
    const { markerScores } = req.body || {};
    const result = await completeCalibrationRun({
      runId: Number(req.params.id),
      markerScores: markerScores || {},
      createdBy: actorId(req),
    });
    res.status(result.ok ? 200 : 400).json(result);
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

/** GET /api/admin/marking/calibrations — list calibration runs. */
router.get('/api/admin/marking/calibrations', requireAdmin, async (req, res) => {
  try {
    const rows = await listCalibrationRuns({
      assignmentId: req.query.assignmentId ? Number(req.query.assignmentId) : undefined,
    });
    res.json({ ok: true, rows });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

// ═══════════════════════════════════════════════════════════════════
// WORK ITEMS & SCORING
// ═══════════════════════════════════════════════════════════════════

/** GET /api/admin/marking/work-items — list work items. */
router.get('/api/admin/marking/work-items', requireAdmin, async (req, res) => {
  try {
    const rows = await listWorkItems({
      assignmentId: req.query.assignmentId ? Number(req.query.assignmentId) : undefined,
      markerUserId: req.query.markerUserId ? Number(req.query.markerUserId) : undefined,
      status: req.query.status,
    });
    res.json({ ok: true, rows });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

/** GET /api/admin/marking/work-items/:id/scores — criterion scores. */
router.get('/api/admin/marking/work-items/:id/scores', requireAdmin, async (req, res) => {
  try {
    const rows = await listCriterionScores({ workItemId: Number(req.params.id) });
    res.json({ ok: true, rows });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

/** POST /api/admin/marking/work-items/:id/scores — save marker scores. */
router.post('/api/admin/marking/work-items/:id/scores', requireAdmin, async (req, res) => {
  try {
    const { markerUserId, criterionScores, markerComment } = req.body || {};
    // NOTE: externalScoped is intentionally NOT accepted from the client —
    // the service derives it from the marking_assignments row server-side.
    const result = await saveCriterionScores({
      workItemId: Number(req.params.id),
      markerUserId,
      criterionScores: criterionScores || [],
      markerComment: markerComment || '',
      createdBy: actorId(req),
    });
    res.status(result.ok ? 200 : 400).json(result);
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

// ═══════════════════════════════════════════════════════════════════
// MODERATION
// ═══════════════════════════════════════════════════════════════════

/** GET /api/admin/marking/moderation — list moderation cases. */
router.get('/api/admin/marking/moderation', requireAdmin, async (req, res) => {
  try {
    const rows = await listModerationCases({ status: req.query.status });
    res.json({ ok: true, rows });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

/** POST /api/admin/marking/moderation/:id/adjudicate — adjudicate a case. */
router.post('/api/admin/marking/moderation/:id/adjudicate', requireAdmin, async (req, res) => {
  try {
    const { adjudicatedScore, note } = req.body || {};
    const result = await adjudicateModerationCase({
      caseId: Number(req.params.id),
      adjudicatedScore,
      note: note || '',
      adjudicatorId: actorId(req),
    });
    res.status(result.ok ? 200 : 400).json(result);
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

// ═══════════════════════════════════════════════════════════════════
// ADMIN PAGE
// ═══════════════════════════════════════════════════════════════════

/** GET /admin/marking — admin marking console. */
router.get('/admin/marking', requireAdmin, (req, res) => {
  res.render('admin/marking', {
    title: 'Marking & Moderation',
    user: req.session.admin,
    csrfToken: req.csrfToken ? req.csrfToken() : '',
  });
});

export default router;
