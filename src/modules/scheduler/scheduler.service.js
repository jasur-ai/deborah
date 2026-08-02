/**
 * Edikit — Exam Scheduling Solver Service
 *
 * DB layer for Prompt 39:
 *   - Room inventory CRUD (exam_rooms)
 *   - Exam period CRUD (exam_periods)
 *   - Weight config get/save (scheduler_weight_config, per tenant)
 *   - Solver run: load input rows (events, groups/members, rooms, periods,
 *     proctors) → pure solveSchedule → persist run + assignments + metrics
 *     as a DRAFT version (idempotent via external_key)
 *   - Human approval + versioning: draft → approved → published; PUBLISH is
 *     gated by hard-violation-zero (Prompt 39 §15) — a run with hard
 *     violations or unscheduled exams can NEVER be published
 *   - What-if move: pure computeWhatIfMove against a run's current
 *     assignments (read-only, no mutation)
 *
 * SECURITY / DATA GUARD:
 *   - Every query/mutation is tenant-scoped (tenant_id filter + write where)
 *   - Publish requires explicit approval flow + hard-violation-zero gate
 *   - No black-box score — metrics JSONB carries explainable soft items
 *   - No student private data (emotion/stress/behaviour) anywhere
 *
 * Graceful degradation: without PostgreSQL, write paths throw a clear error
 * and read paths return null/[] (consistent with the rest of the platform).
 */

import { getDb } from '../../infrastructure/postgres.js';
import { getCurrentTenant } from '../auth/tenant-context.js';
import { audit, AUDIT_ACTIONS } from '../auth/audit.js';
import {
  solveSchedule,
  computeWhatIfMove,
  validateScheduleTransition,
  DEFAULT_WEIGHTS,
  DEFAULT_PROCTOR_DAILY_LIMIT,
  DEFAULT_IDEAL_FILL,
  SCHEDULE_STATUS,
} from './scheduler.schema.js';

function getTenantId() {
  return getCurrentTenant()?.tenantId || 1;
}

// ═══════════════════════════════════════════════════════════════════
// ROOM INVENTORY CRUD
// ═══════════════════════════════════════════════════════════════════

/**
 * Create an exam room. Idempotent via external_key.
 */
export async function createExamRoom(data = {}) {
  const db = await getDb();
  if (!db) throw new Error('PostgreSQL required');

  const row = {
    tenant_id: getTenantId(),
    name: data.name,
    building: data.building || null,
    capacity: Number(data.capacity) || 0,
    features: JSON.stringify(data.features || []),
    isolated: Boolean(data.isolated),
    status: data.status || 'active',
    external_key: data.external_key || null,
    created_by: data.createdBy || null,
  };
  if (!row.name) throw new Error('Room name is required');
  if (row.capacity <= 0) throw new Error('Room capacity must be > 0');

  if (row.external_key) {
    const existing = await db.selectFrom('exam_rooms')
      .where('tenant_id', '=', getTenantId())
      .where('external_key', '=', row.external_key)
      .select(['id'])
      .executeTakeFirst()
      .catch(() => null);
    if (existing) return { ok: true, id: existing.id, duplicate: true };
  }

  const inserted = await db.insertInto('exam_rooms')
    .values(row)
    .returning('id')
    .executeTakeFirst();
  await audit({
    action: AUDIT_ACTIONS.EXAM_ROOM_CREATE,
    userId: data.createdBy || null,
    resourceType: 'exam_room',
    resourceId: inserted.id,
    details: { name: row.name, capacity: row.capacity, isolated: row.isolated },
  });
  return { ok: true, id: inserted.id };
}

/** List rooms (optionally only active). */
export async function listExamRooms({ status, limit = 200, offset = 0 } = {}) {
  const db = await getDb();
  if (!db) return [];
  try {
    let q = db.selectFrom('exam_rooms')
      .where('tenant_id', '=', getTenantId())
      .orderBy('name', 'asc')
      .limit(limit)
      .offset(offset);
    if (status) q = q.where('status', '=', status);
    return await q.selectAll().execute();
  } catch (_) {
    return [];
  }
}

/** Update a room (status/capacity/features). */
export async function updateExamRoom(id, data = {}) {
  const db = await getDb();
  if (!db) throw new Error('PostgreSQL required');

  const patch = { updated_at: new Date() };
  if (data.name !== undefined) patch.name = data.name;
  if (data.building !== undefined) patch.building = data.building;
  if (data.capacity !== undefined) patch.capacity = Number(data.capacity);
  if (data.features !== undefined) patch.features = JSON.stringify(data.features);
  if (data.isolated !== undefined) patch.isolated = Boolean(data.isolated);
  if (data.status !== undefined) patch.status = data.status;

  const res = await db.updateTable('exam_rooms')
    .set(patch)
    .where('id', '=', id)
    .where('tenant_id', '=', getTenantId())
    .execute();
  await audit({
    action: AUDIT_ACTIONS.EXAM_ROOM_UPDATE,
    userId: data.updatedBy || null,
    resourceType: 'exam_room',
    resourceId: id,
    details: { patch: Object.keys(patch) },
  });
  return { ok: true, affected: Number(res.numUpdatedRows || 0) };
}

// ═══════════════════════════════════════════════════════════════════
// EXAM PERIOD CRUD
// ═══════════════════════════════════════════════════════════════════

/**
 * Create an exam period (time window). Idempotent via external_key.
 */
export async function createExamPeriod(data = {}) {
  const db = await getDb();
  if (!db) throw new Error('PostgreSQL required');

  const row = {
    tenant_id: getTenantId(),
    term_id: data.termId || null,
    name: data.name,
    start_at: data.startAt,
    end_at: data.endAt,
    status: data.status || 'active',
    external_key: data.external_key || null,
    created_by: data.createdBy || null,
  };
  if (!row.name) throw new Error('Period name is required');
  if (!row.start_at || !row.end_at) throw new Error('Period start/end are required');
  if (new Date(row.end_at) <= new Date(row.start_at)) throw new Error('Period end must be after start');

  if (row.external_key) {
    const existing = await db.selectFrom('exam_periods')
      .where('tenant_id', '=', getTenantId())
      .where('external_key', '=', row.external_key)
      .select(['id'])
      .executeTakeFirst()
      .catch(() => null);
    if (existing) return { ok: true, id: existing.id, duplicate: true };
  }

  const inserted = await db.insertInto('exam_periods')
    .values(row)
    .returning('id')
    .executeTakeFirst();
  await audit({
    action: AUDIT_ACTIONS.EXAM_PERIOD_CREATE,
    userId: data.createdBy || null,
    resourceType: 'exam_period',
    resourceId: inserted.id,
    details: { name: row.name },
  });
  return { ok: true, id: inserted.id };
}

/** List periods (optionally filtered by term). */
export async function listExamPeriods({ termId, status, limit = 200, offset = 0 } = {}) {
  const db = await getDb();
  if (!db) return [];
  try {
    let q = db.selectFrom('exam_periods')
      .where('tenant_id', '=', getTenantId())
      .orderBy('start_at', 'asc')
      .limit(limit)
      .offset(offset);
    if (termId) q = q.where('term_id', '=', termId);
    if (status) q = q.where('status', '=', status);
    return await q.selectAll().execute();
  } catch (_) {
    return [];
  }
}

// ═══════════════════════════════════════════════════════════════════
// WEIGHT CONFIG
// ═══════════════════════════════════════════════════════════════════

/**
 * Get the tenant weight config (merged over defaults).
 */
export async function getWeightConfig() {
  const db = await getDb();
  const fallback = { weights: { ...DEFAULT_WEIGHTS }, seed: 1 };
  if (!db) return fallback;
  try {
    const row = await db.selectFrom('scheduler_weight_config')
      .where('tenant_id', '=', getTenantId())
      .selectAll()
      .executeTakeFirst();
    return row
      ? { weights: { ...DEFAULT_WEIGHTS, ...(row.weights || {}) }, seed: Number(row.seed) || 1 }
      : fallback;
  } catch (_) {
    return fallback;
  }
}

/**
 * Upsert the tenant weight config (admin-tunable weights + seed).
 * Audited — a privileged action.
 */
export async function saveWeightConfig({ weights = {}, seed, userId = null } = {}) {
  const db = await getDb();
  if (!db) throw new Error('PostgreSQL required');

  const merged = { ...DEFAULT_WEIGHTS, ...(weights || {}) };
  const seedValue = Number(seed) || 1;
  const tenantId = getTenantId();

  const existing = await db.selectFrom('scheduler_weight_config')
    .where('tenant_id', '=', tenantId)
    .select(['id'])
    .executeTakeFirst()
    .catch(() => null);

  if (existing) {
    await db.updateTable('scheduler_weight_config')
      .set({ weights: JSON.stringify(merged), seed: seedValue, updated_by: userId, updated_at: new Date() })
      .where('id', '=', existing.id)
      .where('tenant_id', '=', tenantId)
      .execute();
  } else {
    await db.insertInto('scheduler_weight_config')
      .values({ tenant_id: tenantId, weights: JSON.stringify(merged), seed: seedValue, updated_by: userId })
      .execute();
  }

  await audit({
    action: AUDIT_ACTIONS.SCHEDULER_WEIGHTS,
    userId,
    resourceType: 'scheduler_weight_config',
    resourceId: existing?.id || null,
    details: { weights: merged, seed: seedValue },
  });
  return { ok: true, weights: merged, seed: seedValue };
}

// ═══════════════════════════════════════════════════════════════════
// SOLVER RUN (create draft version)
// ═══════════════════════════════════════════════════════════════════

/**
 * Run the solver and persist a DRAFT schedule version.
 *
 * Inputs are passed explicitly (already fetched/assembled by the route):
 *   exams: [{ id, title, studentIds, separateRoomStudentIds, window, requiredFeatures }]
 *   periods, rooms, proctors — raw rows (service passes through)
 *
 * Idempotent via external_key: duplicate run returns the existing draft.
 */
export async function runSolver({ title, termId, exams = [], periods = [], rooms = [], proctors = [], seed, weights = {}, opts = {}, externalKey = null, userId = null } = {}) {
  const db = await getDb();
  if (!db) throw new Error('PostgreSQL required');

  if (externalKey) {
    const existing = await db.selectFrom('exam_schedule_runs')
      .where('tenant_id', '=', getTenantId())
      .where('external_key', '=', externalKey)
      .select(['id', 'status'])
      .executeTakeFirst()
      .catch(() => null);
    if (existing) return { ok: true, id: existing.id, duplicate: true, status: existing.status };
  }

  const config = await getWeightConfig();
  const effectiveWeights = { ...config.weights, ...(weights || {}) };
  const effectiveSeed = Number(seed) || config.seed || 1;

  const solution = solveSchedule({
    exams,
    periods,
    rooms,
    proctors,
    seed: effectiveSeed,
    weights: effectiveWeights,
    opts: { idealFill: DEFAULT_IDEAL_FILL, proctorDailyLimit: DEFAULT_PROCTOR_DAILY_LIMIT, ...(opts || {}) },
  });

  const metrics = {
    ...solution.metrics,
    hardViolationCount: solution.violations.length,
  };

  // Persist the run (draft) inside a transaction so assignments are atomic
  const inserted = await db.transaction().execute(async (trx) => {
    const run = await trx.insertInto('exam_schedule_runs')
      .values({
        tenant_id: getTenantId(),
        term_id: termId || null,
        title: title || `Exam schedule ${new Date().toISOString().slice(0, 10)}`,
        status: SCHEDULE_STATUS.DRAFT,
        seed: effectiveSeed,
        weights: JSON.stringify(effectiveWeights),
        metrics: JSON.stringify(metrics),
        hard_violations: JSON.stringify(solution.violations),
        unscheduled: JSON.stringify(solution.unscheduled),
        external_key: externalKey || null,
        created_by: userId,
      })
      .returning('id')
      .executeTakeFirst();

    for (const a of solution.assignments) {
      await trx.insertInto('exam_schedule_assignments')
        .values({
          run_id: run.id,
          tenant_id: getTenantId(),
          event_id: a.examId,
          period_id: a.periodId,
          room_id: a.roomId,
          proctor_user_id: a.proctorId,
          student_ids: JSON.stringify(a.studentIds),
          soft_penalty: JSON.stringify(a.softPenalty),
        })
        .execute();
    }
    return run;
  });

  await audit({
    action: AUDIT_ACTIONS.SCHEDULER_RUN,
    userId,
    resourceType: 'exam_schedule_run',
    resourceId: inserted.id,
    details: {
      examCount: exams.length,
      placed: solution.assignments.length,
      unscheduled: solution.unscheduled.length,
      violations: solution.violations.length,
      seed: effectiveSeed,
    },
  });

  return {
    ok: true,
    id: inserted.id,
    status: SCHEDULE_STATUS.DRAFT,
    metrics,
    violations: solution.violations,
    unscheduled: solution.unscheduled,
    deterministic: solution.deterministic,
  };
}

// ═══════════════════════════════════════════════════════════════════
// RUN QUERIES / APPROVAL / PUBLISH (human approval + versioning)
// ═══════════════════════════════════════════════════════════════════

/** List schedule runs (versions), newest first. */
export async function listScheduleRuns({ status, termId, limit = 100, offset = 0 } = {}) {
  const db = await getDb();
  if (!db) return [];
  try {
    let q = db.selectFrom('exam_schedule_runs')
      .where('tenant_id', '=', getTenantId())
      .orderBy('created_at', 'desc')
      .limit(limit)
      .offset(offset);
    if (status) q = q.where('status', '=', status);
    if (termId) q = q.where('term_id', '=', termId);
    return await q.selectAll().execute();
  } catch (_) {
    return [];
  }
}

/** Get a run WITH its assignments (full version snapshot). */
export async function getScheduleRun(id) {
  const db = await getDb();
  if (!db) return null;
  try {
    const run = await db.selectFrom('exam_schedule_runs')
      .where('id', '=', id)
      .where('tenant_id', '=', getTenantId())
      .selectAll()
      .executeTakeFirst();
    if (!run) return null;
    const assignments = await db.selectFrom('exam_schedule_assignments')
      .where('run_id', '=', id)
      .where('tenant_id', '=', getTenantId())
      .orderBy('id', 'asc')
      .selectAll()
      .execute();
    return {
      ...run,
      assignments: assignments.map((a) => ({
        ...a,
        student_ids: typeof a.student_ids === 'string' ? JSON.parse(a.student_ids) : a.student_ids,
        soft_penalty: typeof a.soft_penalty === 'string' ? JSON.parse(a.soft_penalty) : a.soft_penalty,
      })),
    };
  } catch (_) {
    return null;
  }
}

/**
 * Approve a draft run (human approval → version ready to publish).
 * draft → approved only.
 */
export async function approveScheduleRun(id, userId = null) {
  const db = await getDb();
  if (!db) throw new Error('PostgreSQL required');

  const run = await getScheduleRun(id);
  if (!run) throw new Error('Schedule run not found');
  const gate = validateScheduleTransition({ from: run.status, to: 'approved' });
  if (!gate.ok) throw new Error(gate.reason);

  await db.updateTable('exam_schedule_runs')
    .set({ status: 'approved', approved_at: new Date(), approved_by: userId, updated_at: new Date() })
    .where('id', '=', id)
    .where('tenant_id', '=', getTenantId())
    .execute();
  await audit({
    action: AUDIT_ACTIONS.SCHEDULER_APPROVE,
    userId,
    resourceType: 'exam_schedule_run',
    resourceId: id,
    details: { from: run.status, to: 'approved' },
  });
  return { ok: true, id, status: 'approved' };
}

/**
 * Publish an approved run. HARD GATE (Prompt 39 §15): a run whose stored
 * hard_violations or unscheduled is non-empty can NEVER be published — even
 * if the caller tries to force it. Published versions are immutable
 * (subsequent transitions only archive).
 */
export async function publishScheduleRun(id, userId = null) {
  const db = await getDb();
  if (!db) throw new Error('PostgreSQL required');

  const run = await getScheduleRun(id);
  if (!run) throw new Error('Schedule run not found');

  const violations = typeof run.hard_violations === 'string' ? JSON.parse(run.hard_violations) : run.hard_violations;
  const unscheduled = typeof run.unscheduled === 'string' ? JSON.parse(run.unscheduled) : run.unscheduled;

  const gate = validateScheduleTransition({ from: run.status, to: 'published', violations, unscheduled });
  if (!gate.ok) throw new Error(gate.reason);

  await db.updateTable('exam_schedule_runs')
    .set({ status: 'published', published_at: new Date(), published_by: userId, updated_at: new Date() })
    .where('id', '=', id)
    .where('tenant_id', '=', getTenantId())
    .execute();
  await audit({
    action: AUDIT_ACTIONS.SCHEDULER_PUBLISH,
    userId,
    resourceType: 'exam_schedule_run',
    resourceId: id,
    details: { from: run.status, to: 'published', hardViolations: violations.length },
  });
  return { ok: true, id, status: 'published' };
}

/**
 * What-if move against a run's current assignments (read-only).
 * Reassembles the input rows from the run's stored data.
 */
export async function whatIfMove(runId, examId, targetPeriodId, opts = {}) {
  const run = await getScheduleRun(runId);
  if (!run) throw new Error('Schedule run not found');

  const db = await getDb();
  if (!db) throw new Error('PostgreSQL required');

  const periods = await listExamPeriods();
  const rooms = await listExamRooms();
  const proctors = [];

  // Rebuild exam rows from assignments (student_ids + event_id)
  const exams = run.assignments.map((a) => ({
    id: a.event_id,
    title: `exam#${a.event_id}`,
    studentIds: a.student_ids || [],
    separateRoomStudentIds: [],
    window: null,
    requiredFeatures: [],
  }));

  const assignments = run.assignments.map((a) => ({
    examId: a.event_id,
    examTitle: `exam#${a.event_id}`,
    periodId: a.period_id,
    periodName: periods.find((p) => p.id === a.period_id)?.name || String(a.period_id),
    roomId: a.room_id,
    roomName: rooms.find((r) => r.id === a.room_id)?.name || String(a.room_id),
    proctorId: a.proctor_user_id,
    studentIds: a.student_ids || [],
    softPenalty: a.soft_penalty || [],
    softTotal: (a.soft_penalty || []).reduce((acc, it) => acc + (it.delta || 0), 0),
  }));

  const weights = run.weights && typeof run.weights === 'string' ? JSON.parse(run.weights) : run.weights || DEFAULT_WEIGHTS;

  return computeWhatIfMove({
    exams,
    periods,
    rooms,
    proctors,
    assignments,
    examId,
    targetPeriodId,
    weights,
    opts,
  });
}
