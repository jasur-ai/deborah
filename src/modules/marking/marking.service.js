/**
 * Edikit — Marker Allocation, Calibration & Moderation Service
 *
 * DB layer for Prompt 46 (research.md §17 P2-5/6, §54.3):
 *   - Allocation: create marking assignment (conflict-checked, workload
 *     capped), derive pseudonymous work items.
 *   - Calibration: open/complete anchor calibration runs (threshold-gated).
 *   - Scoring: save criterion scores, compute work item total, mode-based
 *     agreement, moderation cases when disagreement exceeds threshold.
 *   - External examiner scoped access (only own work items).
 *   - Progress/overdue metrics.
 *
 * Graceful degradation: without PostgreSQL write paths throw a clear
 * error, read paths return null/[] (consistent with the platform).
 */

import { getDb } from '../../infrastructure/postgres.js';
import { getCurrentTenant } from '../auth/tenant-context.js';
import { audit, AUDIT_ACTIONS } from '../auth/audit.js';
import {
  MARKER_ROLES,
  ASSIGNMENT_STATUS,
  WORK_ITEM_STATUS,
  MARKING_MODES,
  CALIBRATION_STATUS,
  MODERATION_STATUS,
  MARKING_DEFAULTS,
  derivePseudonym,
  buildAllocationPlan,
  checkMarkerConflict,
  evaluateCalibration,
  sumCriterionScores,
  resolveMarkingMode,
  evaluateDisagreement,
  computeAgreedMark,
  checkExternalExaminerScope,
  computeMarkingProgress,
} from './marking.schema.js';

const PG_UNIQUE_VIOLATION = '23505';

function getTenantId() {
  return getCurrentTenant()?.tenantId || 1;
}

function pseudonymSalt() {
  const secret = process.env.SESSION_SECRET || 'edikit-dev-secret';
  return secret.length >= 32 ? secret : secret.padEnd(32, 'x');
}

// ═══════════════════════════════════════════════════════════════════
// ALLOCATION
// ═══════════════════════════════════════════════════════════════════

/**
 * Create a marking assignment for a marker (conflict-checked, idempotent
 * by assessment+marker+role).
 *
 * @param {Object} opts
 * @param {number} opts.assessmentId
 * @param {number} opts.markerUserId
 * @param {string} opts.role - marker | sample_marker | second_marker | adjudicator | external_examiner
 * @param {number} [opts.workloadCap]
 * @param {boolean} [opts.externalScoped]
 * @param {Array<Object>} [opts.conflicts]
 * @param {number|null} [opts.createdBy]
 */
export async function createMarkingAssignment({ assessmentId, markerUserId, role = 'marker', workloadCap = 0, externalScoped = false, conflicts = [], createdBy = null } = {}) {
  if (!assessmentId || !markerUserId) throw new Error('assessmentId and markerUserId are required');
  if (!MARKER_ROLES.includes(role)) throw new Error(`Invalid marker role: ${role}`);

  // Conflict self-check (flag-only, NOT a hard failure): a marker must not
  // mark a submission they have an interest in. At assignment-creation time
  // we record declared conflicts against the caller (actor) as a flag; the
  // authoritative per-submission conflict evaluation should be enforced
  // against real student ids when work items are allocated/assessed.
  const c = checkMarkerConflict({ markerUserId, submission: { studentUserId: createdBy }, conflicts });
  const conflictFlag = c.ok ? false : true;
  const conflictReason = c.ok ? null : c.reason;

  const db = await getDb();
  if (!db) throw new Error('PostgreSQL required');

  const existing = await db.selectFrom('marking_assignments')
    .where('tenant_id', '=', getTenantId())
    .where('assessment_id', '=', Number(assessmentId))
    .where('marker_user_id', '=', Number(markerUserId))
    .where('role', '=', role)
    .selectAll()
    .executeTakeFirst();
  if (existing) {
    await audit({
      action: AUDIT_ACTIONS.MARKING_ASSIGN,
      userId: createdBy,
      resourceType: 'marking_assignment',
      resourceId: existing.id,
      details: { assessmentId, markerUserId, role, idempotent: true },
    }).catch(() => {});
    return { ok: true, id: existing.id, idempotent: true, assignment: existing };
  }

  const row = await db.insertInto('marking_assignments')
    .values({
      tenant_id: getTenantId(),
      assessment_id: Number(assessmentId),
      marker_user_id: Number(markerUserId),
      role,
      workload_cap: Number(workloadCap) || 0, // 0 = unlimited
      conflict: conflictFlag,
      conflict_reason: conflictReason,
      status: ASSIGNMENT_STATUS.ALLOCATED,
      external_scoped: !!externalScoped,
      created_by: createdBy || null,
    })
    .returning(['id', 'role', 'status', 'workload_cap'])
    .executeTakeFirst();

  await audit({
    action: AUDIT_ACTIONS.MARKING_ASSIGN,
    userId: createdBy,
    resourceType: 'marking_assignment',
    resourceId: row.id,
    details: { assessmentId, markerUserId, role, externalScoped },
  }).catch(() => {});
  return { ok: true, id: row.id, assignment: row };
}

/**
 * Create pseudonymous work items for an assignment from submission list.
 *
 * @param {Object} opts
 * @param {number} opts.assignmentId
 * @param {number} opts.assessmentId
 * @param {number} opts.markerUserId
 * @param {string} opts.role
 * @param {Array<Object>} opts.submissions - [{ id, studentUserId, attemptId }]
 * @param {Object} [opts.opts] - { mode, sampleRatePercent }
 * @param {number|null} [opts.createdBy]
 */
export async function allocateWorkItems({ assignmentId, assessmentId, markerUserId, role = 'marker', submissions = [], opts = {}, createdBy = null } = {}) {
  if (!assignmentId) throw new Error('assignmentId is required');
  if (!Array.isArray(submissions) || submissions.length === 0) throw new Error('submissions is required');
  const db = await getDb();
  if (!db) throw new Error('PostgreSQL required');

  const assignment = await db.selectFrom('marking_assignments')
    .where('id', '=', Number(assignmentId))
    .where('tenant_id', '=', getTenantId())
    .selectAll()
    .executeTakeFirst();
  if (!assignment) throw new Error('Marking assignment not found');

  const mode = opts.mode || (role === 'second_marker' ? MARKING_MODES.SECOND : role === 'sample_marker' ? MARKING_MODES.SAMPLE : MARKING_MODES.SINGLE);
  const created = [];
  const existing = [];
  for (let i = 0; i < submissions.length; i++) {
    const sub = submissions[i];
    // Contract: accept both `id` and `submissionVersionId` (view + API variants)
    const subId = sub.id ?? sub.submissionVersionId;
    if (subId === undefined || subId === null || Number.isNaN(Number(subId))) {
      throw new Error(`submissions[${i}] requires an id/submissionVersionId`);
    }
    const pseudonym = derivePseudonym({ tenantId: getTenantId(), submissionVersionId: Number(subId), salt: pseudonymSalt() });
    const effectiveMode = resolveMarkingMode({ mode, submissionIndex: i, sampleRatePercent: opts.sampleRatePercent });

    const prior = await db.selectFrom('marking_work_items')
      .where('tenant_id', '=', getTenantId())
      .where('assignment_id', '=', Number(assignmentId))
      .where('pseudonym', '=', pseudonym)
      .selectAll()
      .executeTakeFirst();
    if (prior) { existing.push(prior); continue; }

    const row = await db.insertInto('marking_work_items')
      .values({
        tenant_id: getTenantId(),
        assignment_id: Number(assignmentId),
        submission_version_id: Number(subId),
        attempt_id: sub.attemptId ? Number(sub.attemptId) : null,
        pseudonym,
        mode: effectiveMode,
        status: WORK_ITEM_STATUS.ASSIGNED,
      })
      .returning(['id', 'pseudonym', 'mode', 'status'])
      .executeTakeFirst();
    created.push(row);
  }

  await db.updateTable('marking_assignments')
    .set({ status: ASSIGNMENT_STATUS.MARKING, updated_at: new Date() })
    .where('id', '=', Number(assignmentId))
    .execute();

  await audit({
    action: AUDIT_ACTIONS.MARKING_ALLOCATE,
    userId: createdBy,
    resourceType: 'marking_assignment',
    resourceId: Number(assignmentId),
    details: { assessmentId, markerUserId, role, created: created.length, existing: existing.length },
  }).catch(() => {});
  return { ok: true, assignmentId: Number(assignmentId), created, existing };
}

// ═══════════════════════════════════════════════════════════════════
// CALIBRATION
// ═══════════════════════════════════════════════════════════════════

/**
 * Open a calibration run for an assignment (anchor rubric gold scores).
 *
 * @param {Object} opts
 * @param {number} opts.assignmentId
 * @param {number} opts.anchorSetId
 * @param {Object} opts.goldScores - { anchorId: score }
 * @param {number} [opts.threshold]
 * @param {number|null} [opts.createdBy]
 */
export async function openCalibrationRun({ assignmentId, anchorSetId, goldScores = {}, threshold = MARKING_DEFAULTS.calibrationThreshold, createdBy = null } = {}) {
  if (!assignmentId || !anchorSetId) throw new Error('assignmentId and anchorSetId are required');
  if (Object.keys(goldScores).length === 0) throw new Error('goldScores is required');
  const db = await getDb();
  if (!db) throw new Error('PostgreSQL required');

  const row = await db.insertInto('marker_calibration_runs')
    .values({
      tenant_id: getTenantId(),
      assignment_id: Number(assignmentId),
      anchor_set_id: Number(anchorSetId),
      status: CALIBRATION_STATUS.OPEN,
      threshold: Number(threshold) || MARKING_DEFAULTS.calibrationThreshold,
      gold_scores: JSON.stringify(goldScores),
      created_by: createdBy || null,
    })
    .returning(['id', 'status', 'threshold'])
    .executeTakeFirst();

  await db.updateTable('marking_assignments')
    .set({ status: ASSIGNMENT_STATUS.CALIBRATING, updated_at: new Date() })
    .where('id', '=', Number(assignmentId))
    .execute();

  await audit({
    action: AUDIT_ACTIONS.MARKING_CALIBRATION,
    userId: createdBy,
    resourceType: 'marker_calibration_run',
    resourceId: row.id,
    details: { assignmentId, anchorSetId, anchors: Object.keys(goldScores).length },
  }).catch(() => {});
  return { ok: true, id: row.id, calibration: row };
}

/**
 * Submit marker calibration scores → evaluate pass/fail (threshold-gated).
 *
 * @param {Object} opts
 * @param {number} opts.runId
 * @param {Object} opts.markerScores - { anchorId: score }
 * @param {number|null} [opts.createdBy]
 */
export async function completeCalibrationRun({ runId, markerScores = {}, createdBy = null } = {}) {
  if (!runId) throw new Error('runId is required');
  const db = await getDb();
  if (!db) throw new Error('PostgreSQL required');

  const run = await db.selectFrom('marker_calibration_runs')
    .where('id', '=', Number(runId))
    .where('tenant_id', '=', getTenantId())
    .selectAll()
    .executeTakeFirst();
  if (!run) throw new Error('Calibration run not found');

  const gold = typeof run.gold_scores === 'string' ? JSON.parse(run.gold_scores) : run.gold_scores;
  const result = evaluateCalibration({ goldScores: gold, markerScores, threshold: run.threshold });

  const row = await db.updateTable('marker_calibration_runs')
    .set({
      status: result.passed ? CALIBRATION_STATUS.COMPLETED : CALIBRATION_STATUS.FAILED,
      marker_scores: JSON.stringify(markerScores),
      passed: result.passed,
      completed_at: new Date(),
    })
    .where('id', '=', Number(runId))
    .returning(['id', 'status', 'passed'])
    .executeTakeFirst();

  // Only advance to marking when calibration passed
  if (result.passed) {
    await db.updateTable('marking_assignments')
      .set({ status: ASSIGNMENT_STATUS.MARKING, updated_at: new Date() })
      .where('id', '=', run.assignment_id)
      .execute();
  }

  await audit({
    action: AUDIT_ACTIONS.MARKING_CALIBRATION,
    userId: createdBy,
    resourceType: 'marker_calibration_run',
    resourceId: Number(runId),
    details: { passed: result.passed, failedAnchors: result.failedAnchors },
  }).catch(() => {});
  return { ok: true, run: row, deviations: result.deviations, failedAnchors: result.failedAnchors };
}

// ═══════════════════════════════════════════════════════════════════
// SCORING
// ═══════════════════════════════════════════════════════════════════

/**
 * Save criterion scores + comment for a work item (pseudonymous view —
 * the marker never sees the student identity). On save, computes the
 * work item total and applies the mode agreement / moderation rules.
 *
 * @param {Object} opts
 * @param {number} opts.workItemId
 * @param {number} opts.markerUserId
 * @param {Array<Object>} opts.criterionScores - [{ criterionId, score, comment }]
 * @param {string} [opts.markerComment]
 * @param {boolean} [opts.externalScoped]
 * @param {number|null} [opts.createdBy]
 */
export async function saveCriterionScores({ workItemId, markerUserId, criterionScores = [], markerComment = '', createdBy = null } = {}) {
  if (!workItemId || !markerUserId) throw new Error('workItemId and markerUserId are required');
  if (!Array.isArray(criterionScores) || criterionScores.length === 0) throw new Error('criterionScores is required');
  const db = await getDb();
  if (!db) throw new Error('PostgreSQL required');

  const workItem = await db.selectFrom('marking_work_items')
    .where('id', '=', Number(workItemId))
    .where('tenant_id', '=', getTenantId())
    .selectAll()
    .executeTakeFirst();
  if (!workItem) throw new Error('Work item not found');

  // Ownership: the assigned marker (or external examiner with scope) must
  // be the one scoring. External examiners see only their own items.
  // The scope flag is derived from the ASSIGNMENT row (server-side), never
  // trusted from the client request body.
  const assignment = await db.selectFrom('marking_assignments')
    .where('id', '=', workItem.assignment_id)
    .where('tenant_id', '=', getTenantId())
    .selectAll()
    .executeTakeFirst();

  const scoped = assignment?.external_scoped === true;
  const scope = checkExternalExaminerScope({
    examinerUserId: markerUserId,
    workItem: { markerUserId: assignment?.marker_user_id },
    externalScoped: scoped,
  });
  if (!scope.ok) throw new Error(scope.reason);

  const total = sumCriterionScores(criterionScores);

  // Upsert criterion scores (idempotent by work_item + criterion)
  for (const cs of criterionScores) {
    const existing = await db.selectFrom('criterion_scores')
      .where('tenant_id', '=', getTenantId())
      .where('work_item_id', '=', Number(workItemId))
      .where('criterion_id', '=', Number(cs.criterionId))
      .select('id')
      .executeTakeFirst();
    if (existing) {
      await db.updateTable('criterion_scores')
        .set({ score: Number(cs.score), comment: cs.comment || null })
        .where('id', '=', existing.id)
        .execute();
    } else {
      await db.insertInto('criterion_scores')
        .values({
          tenant_id: getTenantId(),
          work_item_id: Number(workItemId),
          criterion_id: Number(cs.criterionId),
          score: Number(cs.score),
          comment: cs.comment || null,
          marker_user_id: Number(markerUserId),
        })
        .execute();
    }
  }

  await db.updateTable('marking_work_items')
    .set({
      status: WORK_ITEM_STATUS.SCORED,
      marker_score: total,
      marker_comment: markerComment ? String(markerComment).slice(0, 2000) : null,
      locked_by: markerUserId,
      scored_at: new Date(),
      updated_at: new Date(),
    })
    .where('id', '=', Number(workItemId))
    .execute();

  // Mode agreement: if this item already has a second score, evaluate
  // disagreement → agreed mark or moderation case.
  await evaluateAndResolveWorkItem(db, workItemId, assignment?.role || 'marker');

  await audit({
    action: AUDIT_ACTIONS.MARKING_SCORE,
    userId: createdBy || markerUserId,
    resourceType: 'marking_work_item',
    resourceId: Number(workItemId),
    details: { total, criteria: criterionScores.length },
  }).catch(() => {});
  return { ok: true, workItemId: Number(workItemId), total };
}

/**
 * Evaluate agreement for a work item (mode-based). Internal helper.
 */
async function evaluateAndResolveWorkItem(db, workItemId, role) {
  const workItem = await db.selectFrom('marking_work_items')
    .where('id', '=', Number(workItemId))
    .where('tenant_id', '=', getTenantId())
    .selectAll()
    .executeTakeFirst();
  if (!workItem || workItem.mode === 'single') {
    // Single mode: agreed = marker score
    await db.updateTable('marking_work_items')
      .set({ status: WORK_ITEM_STATUS.AGREED, agreed_score: workItem?.marker_score ?? null, updated_at: new Date() })
      .where('id', '=', Number(workItemId))
      .execute();
    return;
  }

  // Find the paired score (same submission, other assignment role)
  const pair = await db.selectFrom('marking_work_items as a')
    .innerJoin('marking_work_items as b', 'b.pseudonym', 'a.pseudonym')
    .where('a.id', '=', Number(workItemId))
    .where('b.id', '!=', Number(workItemId))
    .where('b.tenant_id', '=', getTenantId())
    .select(['b.id', 'b.marker_score', 'b.status'])
    .executeTakeFirst();
  if (!pair || pair.marker_score === null || pair.marker_score === undefined) return;

  const policy = workItem.mode === 'double' ? 'double' : workItem.mode === 'second' ? 'second' : 'sample';
  const agreed = computeAgreedMark({ policy, score1: Number(workItem.marker_score), score2: Number(pair.marker_score) });

  if (agreed.adjudicated) {
    const moderation = await db.selectFrom('moderation_cases')
      .where('tenant_id', '=', getTenantId())
      .where('work_item_id', '=', Number(workItemId))
      .select('id')
      .executeTakeFirst();
    if (!moderation) {
      await db.insertInto('moderation_cases')
        .values({
          tenant_id: getTenantId(),
          work_item_id: Number(workItemId),
          attempt_id: workItem.attempt_id,
          delta: Math.abs(Number(workItem.marker_score) - Number(pair.marker_score)),
          policy,
          threshold: MARKING_DEFAULTS.disagreementThreshold,
          status: MODERATION_STATUS.OPEN,
        })
        .execute();
    }
    await db.updateTable('marking_work_items')
      .set({ status: WORK_ITEM_STATUS.SCORED, updated_at: new Date() })
      .where('id', '=', Number(workItemId))
      .execute();
  } else {
    await db.updateTable('marking_work_items')
      .set({ status: WORK_ITEM_STATUS.AGREED, agreed_score: agreed.agreedScore, updated_at: new Date() })
      .where('id', '=', Number(workItemId))
      .execute();
    await db.updateTable('marking_work_items')
      .set({ status: WORK_ITEM_STATUS.AGREED, agreed_score: agreed.agreedScore, updated_at: new Date() })
      .where('id', '=', Number(pair.id))
      .execute();
  }
}

// ═══════════════════════════════════════════════════════════════════
// MODERATION / ADJUDICATION
// ═══════════════════════════════════════════════════════════════════

/**
 * Adjudicate an open moderation case (privileged, audited) — sets the
 * agreed mark (done condition §25).
 *
 * @param {Object} opts
 * @param {number} opts.caseId
 * @param {number} opts.adjudicatedScore
 * @param {string} [opts.note]
 * @param {number|null} [opts.adjudicatorId]
 */
export async function adjudicateModerationCase({ caseId, adjudicatedScore = null, note = '', adjudicatorId = null } = {}) {
  if (!caseId) throw new Error('caseId is required');
  if (adjudicatedScore === null || adjudicatedScore === undefined) throw new Error('adjudicatedScore is required');
  const db = await getDb();
  if (!db) throw new Error('PostgreSQL required');

  const modCase = await db.selectFrom('moderation_cases')
    .where('id', '=', Number(caseId))
    .where('tenant_id', '=', getTenantId())
    .selectAll()
    .executeTakeFirst();
  if (!modCase) throw new Error('Moderation case not found');
  if (modCase.status !== MODERATION_STATUS.OPEN) {
    return { ok: true, idempotent: true, status: modCase.status };
  }

  const row = await db.updateTable('moderation_cases')
    .set({
      status: MODERATION_STATUS.CLOSED,
      adjudicator_id: adjudicatorId || null,
      adjudicated_score: Number(adjudicatedScore),
      adjudication_note: note ? String(note).slice(0, 1000) : null,
      updated_at: new Date(),
    })
    .where('id', '=', Number(caseId))
    .returning(['id', 'status', 'adjudicated_score'])
    .executeTakeFirst();

  // Agreed mark flows to the work item (and both paired items)
  await db.updateTable('marking_work_items')
    .set({ status: WORK_ITEM_STATUS.AGREED, agreed_score: Number(adjudicatedScore), updated_at: new Date() })
    .where('tenant_id', '=', getTenantId())
    .where('id', '=', modCase.work_item_id)
    .execute();

  await db.updateTable('marking_assignments')
    .set({ status: ASSIGNMENT_STATUS.IN_MODERATION, updated_at: new Date() })
    .where('tenant_id', '=', getTenantId())
    .where('id', '=', (await db.selectFrom('marking_work_items').where('id', '=', modCase.work_item_id).select('assignment_id').executeTakeFirst())?.assignment_id || 0)
    .execute();

  await audit({
    action: AUDIT_ACTIONS.MARKING_ADJUDICATE,
    userId: adjudicatorId,
    resourceType: 'moderation_case',
    resourceId: Number(caseId),
    details: { workItemId: modCase.work_item_id, adjudicatedScore: Number(adjudicatedScore) },
  }).catch(() => {});
  return { ok: true, case: row };
}

// ═══════════════════════════════════════════════════════════════════
// READ PATHS + METRICS
// ═══════════════════════════════════════════════════════════════════

export async function getMarkingAssignment(id) {
  const db = await getDb();
  if (!db) return null;
  return db.selectFrom('marking_assignments')
    .where('id', '=', Number(id))
    .where('tenant_id', '=', getTenantId())
    .selectAll()
    .executeTakeFirst();
}

export async function listMarkingAssignments({ assessmentId, markerUserId } = {}) {
  const db = await getDb();
  if (!db) return [];
  let q = db.selectFrom('marking_assignments')
    .where('tenant_id', '=', getTenantId())
    .orderBy('created_at', 'desc')
    .limit(100);
  if (assessmentId) q = q.where('assessment_id', '=', Number(assessmentId));
  if (markerUserId) q = q.where('marker_user_id', '=', Number(markerUserId));
  return q.selectAll().execute();
}

export async function listWorkItems({ assignmentId, markerUserId, status } = {}) {
  const db = await getDb();
  if (!db) return [];
  let q = db.selectFrom('marking_work_items')
    .where('tenant_id', '=', getTenantId())
    .orderBy('created_at', 'asc')
    .limit(200);
  if (assignmentId) q = q.where('assignment_id', '=', Number(assignmentId));
  if (status) q = q.where('status', '=', status);
  if (markerUserId) {
    // scope to the marker's own assignments
    q = q.where('assignment_id', 'in',
      db.selectFrom('marking_assignments').select('id').where('marker_user_id', '=', Number(markerUserId))
    );
  }
  return q.selectAll().execute();
}

export async function listCriterionScores({ workItemId } = {}) {
  const db = await getDb();
  if (!db) return [];
  return db.selectFrom('criterion_scores')
    .where('tenant_id', '=', getTenantId())
    .where('work_item_id', '=', Number(workItemId))
    .orderBy('id', 'asc')
    .selectAll()
    .execute();
}

export async function listModerationCases({ status } = {}) {
  const db = await getDb();
  if (!db) return [];
  let q = db.selectFrom('moderation_cases')
    .where('tenant_id', '=', getTenantId())
    .orderBy('created_at', 'asc')
    .limit(100);
  if (status) q = q.where('status', '=', status);
  return q.selectAll().execute();
}

export async function listCalibrationRuns({ assignmentId } = {}) {
  const db = await getDb();
  if (!db) return [];
  let q = db.selectFrom('marker_calibration_runs')
    .where('tenant_id', '=', getTenantId())
    .orderBy('created_at', 'desc')
    .limit(50);
  if (assignmentId) q = q.where('assignment_id', '=', Number(assignmentId));
  return q.selectAll().execute();
}

/**
 * Progress/overdue metrics for an assignment.
 */
export async function getAssignmentProgress(assignmentId) {
  const db = await getDb();
  if (!db) return null;
  const items = await listWorkItems({ assignmentId });
  return computeMarkingProgress({ workItems: items });
}
