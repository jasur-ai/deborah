/**
 * Edikit — Exam Scheduling Solver API Routes
 *
 * REST API for Prompt 39:
 *   - Room inventory CRUD (exam_rooms)
 *   - Exam period CRUD (exam_periods)
 *   - Weight config get/save (scheduler_weight_config)
 *   - Solver run → DRAFT version; human approve → publish (hard gate)
 *   - What-if move compare (read-only)
 *   - Admin UI pages: /admin/scheduler
 *
 * Security:
 *   - /api/admin/* → requireAdmin (privileged: rooms, periods, weights, runs)
 *   - Publish gate is enforced server-side (hard violation → 400)
 *   - Every write path tenant-scoped + audited
 */

import { Router } from 'express';
import { requireAdmin } from '../middleware/auth.js';
import {
  // schema (pure)
  DEFAULT_WEIGHTS,
  SCHEDULE_STATUS,
  SCHEDULE_STATUS_TRANSITIONS,
  createSeededRng,
  checkHardConstraints,
  evaluateSoftPenalties,
  solveSchedule,
  buildScheduleMetrics,
  hasHardViolations,
  computeWhatIfMove,
  validateScheduleTransition,
  // service
  createExamRoom,
  listExamRooms,
  updateExamRoom,
  createExamPeriod,
  listExamPeriods,
  getWeightConfig,
  saveWeightConfig,
  runSolver,
  listScheduleRuns,
  getScheduleRun,
  approveScheduleRun,
  publishScheduleRun,
  whatIfMove,
} from '../src/modules/scheduler/index.js';

const router = Router();

function actorId(req) {
  return req.session?.admin?.id || req.session?.user?.id || null;
}

// ═══════════════════════════════════════════════════════════════════
// META / CONSTANTS
// ═══════════════════════════════════════════════════════════════════

/** GET /api/admin/scheduler/meta — statuses, transitions, default weights. */
router.get('/api/admin/scheduler/meta', requireAdmin, (req, res) => {
  res.json({
    statuses: SCHEDULE_STATUS,
    transitions: SCHEDULE_STATUS_TRANSITIONS,
    defaultWeights: DEFAULT_WEIGHTS,
  });
});

// ═══════════════════════════════════════════════════════════════════
// ROOM INVENTORY
// ═══════════════════════════════════════════════════════════════════

/** GET /api/admin/scheduler/rooms — list rooms. */
router.get('/api/admin/scheduler/rooms', requireAdmin, async (req, res) => {
  try {
    const rooms = await listExamRooms({ status: req.query.status, limit: Number(req.query.limit) || 200 });
    res.json({ ok: true, rooms });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/** POST /api/admin/scheduler/rooms — create room. */
router.post('/api/admin/scheduler/rooms', requireAdmin, async (req, res) => {
  try {
    const result = await createExamRoom({ ...req.body, createdBy: actorId(req) });
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/** PATCH /api/admin/scheduler/rooms/:id — update room. */
router.patch('/api/admin/scheduler/rooms/:id', requireAdmin, async (req, res) => {
  try {
    const result = await updateExamRoom(Number(req.params.id), { ...req.body, updatedBy: actorId(req) });
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════════
// EXAM PERIODS
// ═══════════════════════════════════════════════════════════════════

/** GET /api/admin/scheduler/periods — list periods. */
router.get('/api/admin/scheduler/periods', requireAdmin, async (req, res) => {
  try {
    const periods = await listExamPeriods({ termId: Number(req.query.termId) || undefined, status: req.query.status, limit: Number(req.query.limit) || 200 });
    res.json({ ok: true, periods });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/** POST /api/admin/scheduler/periods — create period. */
router.post('/api/admin/scheduler/periods', requireAdmin, async (req, res) => {
  try {
    const result = await createExamPeriod({ ...req.body, createdBy: actorId(req) });
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════════
// WEIGHT CONFIG
// ═══════════════════════════════════════════════════════════════════

/** GET /api/admin/scheduler/weights — current tenant weights + seed. */
router.get('/api/admin/scheduler/weights', requireAdmin, async (req, res) => {
  try {
    res.json(await getWeightConfig());
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/** PUT /api/admin/scheduler/weights — save weights + seed (audited). */
router.put('/api/admin/scheduler/weights', requireAdmin, async (req, res) => {
  try {
    const result = await saveWeightConfig({ weights: req.body.weights, seed: req.body.seed, userId: actorId(req) });
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════════
// SOLVER RUN / VERSIONS
// ═══════════════════════════════════════════════════════════════════

/**
 * POST /api/admin/scheduler/run — run solver → DRAFT version.
 * Body: { title, termId, exams, periods, rooms, proctors, seed, weights, opts, externalKey }
 */
router.post('/api/admin/scheduler/run', requireAdmin, async (req, res) => {
  try {
    const result = await runSolver({ ...req.body, userId: actorId(req) });
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/** GET /api/admin/scheduler/runs — list schedule versions. */
router.get('/api/admin/scheduler/runs', requireAdmin, async (req, res) => {
  try {
    const runs = await listScheduleRuns({ status: req.query.status, termId: Number(req.query.termId) || undefined, limit: Number(req.query.limit) || 100 });
    res.json({ ok: true, runs });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/** GET /api/admin/scheduler/runs/:id — full version snapshot (with assignments). */
router.get('/api/admin/scheduler/runs/:id', requireAdmin, async (req, res) => {
  try {
    const run = await getScheduleRun(Number(req.params.id));
    if (!run) return res.status(404).json({ error: 'Run not found' });
    res.json({ ok: true, run });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/** POST /api/admin/scheduler/runs/:id/approve — human approval (draft → approved). */
router.post('/api/admin/scheduler/runs/:id/approve', requireAdmin, async (req, res) => {
  try {
    res.json(await approveScheduleRun(Number(req.params.id), actorId(req)));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/** POST /api/admin/scheduler/runs/:id/publish — publish (hard-violation gate). */
router.post('/api/admin/scheduler/runs/:id/publish', requireAdmin, async (req, res) => {
  try {
    res.json(await publishScheduleRun(Number(req.params.id), actorId(req)));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/** POST /api/admin/scheduler/runs/:id/what-if — move exam to period (read-only compare). */
router.post('/api/admin/scheduler/runs/:id/what-if', requireAdmin, async (req, res) => {
  try {
    const result = await whatIfMove(Number(req.params.id), Number(req.body.examId), Number(req.body.targetPeriodId));
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════════
// UI PAGES
// ═══════════════════════════════════════════════════════════════════

/** GET /admin/scheduler — admin weight/constraint + solver UI. */
router.get('/admin/scheduler', (req, res) => {
  if (!req.session?.admin) return res.redirect('/admin/login');
  res.render('admin/scheduler', {
    title: 'Imtihon jadvali',
    admin: req.session.admin,
  });
});

export default router;
