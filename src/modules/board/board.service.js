/**
 * Deborah — Board Ratification, Result Release & Grade Ledger Service
 *
 * DB layer for Prompt 47 (research.md §49.15, §67.1 steps 14–16):
 *   - Board role/meeting/attendee management with conflict declarations.
 *   - Board-ready blocker check (fail-closed) before a result can be
 *     presented to the board.
 *   - ratifyResult — IMMUTABLE ratification transaction: snapshot hash +
 *     frozen ratified final. The grade is NEVER overwritten via direct
 *     UPDATE (§15) — subsequent changes go through the amendment ledger.
 *   - releaseBatch — SIS/HEMIS outbox enqueue, only for ratified
 *     decisions (ratification'siz release yo'q).
 *   - appendAmendment — append-only grade change ledger.
 *   - reconcileOutbox — idempotent SIS ack (external_key UNIQUE).
 *
 * Graceful degradation: without PostgreSQL write paths throw a clear
 * error, read paths return null/[] (consistent with the platform).
 */

import { getDb } from '../../infrastructure/postgres.js';
import { getCurrentTenant } from '../auth/tenant-context.js';
import { audit, AUDIT_ACTIONS } from '../auth/audit.js';
import {
  BOARD_ROLES,
  MEETING_STATUS,
  DECISION_STATUS,
  VOTES,
  OUTBOX_STATUS,
  BOARD_DEFAULTS,
  checkBoardReady,
  checkQuorum,
  buildSnapshotHash,
  nextAmendmentNo,
  validateAmendment,
  buildSisPayload,
} from './board.schema.js';

const PG_UNIQUE_VIOLATION = '23505';

function getTenantId() {
  return getCurrentTenant()?.tenantId || 1;
}

function parseJson(value) {
  if (value === null || value === undefined) return {};
  if (typeof value === 'string') {
    try { return JSON.parse(value); } catch { return {}; }
  }
  return value;
}

// ═══════════════════════════════════════════════════════════════════
// BOARD ROLES & MEETINGS
// ═══════════════════════════════════════════════════════════════════

/**
 * Assign a board role (chair | secretary | member | external).
 * Idempotent by tenant+user+role.
 */
export async function assignBoardRole({ userId, role = 'member', createdBy = null } = {}) {
  if (!userId || !BOARD_ROLES.includes(role)) throw new Error('userId and a valid board role are required');
  const db = await getDb();
  if (!db) throw new Error('PostgreSQL required');

  const existing = await db.selectFrom('board_roles')
    .where('tenant_id', '=', getTenantId())
    .where('user_id', '=', Number(userId))
    .where('role', '=', role)
    .selectAll()
    .executeTakeFirst();
  if (existing) {
    return { ok: true, id: existing.id, idempotent: true };
  }

  const row = await db.insertInto('board_roles')
    .values({ tenant_id: getTenantId(), user_id: Number(userId), role, created_by: createdBy || null })
    .returning(['id', 'role'])
    .executeTakeFirst();
  await audit({
    action: AUDIT_ACTIONS.BOARD_ROLE_ASSIGN,
    userId: createdBy,
    resourceType: 'board_role',
    resourceId: row.id,
    details: { userId, role },
  }).catch(() => {});
  return { ok: true, id: row.id, role: row.role };
}

/**
 * Create a board meeting for an assessment/cohort.
 */
export async function createBoardMeeting({
  assessmentId = null,
  courseOfferingId = null,
  title = '',
  requiredQuorum = BOARD_DEFAULTS.requiredQuorum,
  requiredApprovalRatio = BOARD_DEFAULTS.requiredApprovalRatio,
  policySnapshot = {},
  createdBy = null,
} = {}) {
  if (!title) throw new Error('title is required');
  const db = await getDb();
  if (!db) throw new Error('PostgreSQL required');

  const row = await db.insertInto('board_meetings')
    .values({
      tenant_id: getTenantId(),
      assessment_id: assessmentId ? Number(assessmentId) : null,
      course_offering_id: courseOfferingId ? Number(courseOfferingId) : null,
      title,
      status: MEETING_STATUS.SCHEDULED,
      required_quorum: Number(requiredQuorum) || BOARD_DEFAULTS.requiredQuorum,
      required_approval_ratio: Number(requiredApprovalRatio) || BOARD_DEFAULTS.requiredApprovalRatio,
      policy_snapshot: JSON.stringify({ ...BOARD_DEFAULTS, ...policySnapshot }),
      created_by: createdBy || null,
    })
    .returning(['id', 'status', 'required_quorum'])
    .executeTakeFirst();
  await audit({
    action: AUDIT_ACTIONS.BOARD_MEETING_CREATE,
    userId: createdBy,
    resourceType: 'board_meeting',
    resourceId: row.id,
    details: { assessmentId, title },
  }).catch(() => {});
  return { ok: true, id: row.id, meeting: row };
}

/** Open a scheduled meeting (scheduled → open). */
export async function openBoardMeeting({ meetingId, actorId = null } = {}) {
  if (!meetingId) throw new Error('meetingId is required');
  const db = await getDb();
  if (!db) throw new Error('PostgreSQL required');

  const meeting = await db.selectFrom('board_meetings')
    .where('id', '=', Number(meetingId)).where('tenant_id', '=', getTenantId())
    .selectAll().executeTakeFirst();
  if (!meeting) throw new Error('Meeting not found');
  if (meeting.status !== MEETING_STATUS.SCHEDULED) {
    return { ok: true, idempotent: true, status: meeting.status };
  }
  const row = await db.updateTable('board_meetings')
    .set({ status: MEETING_STATUS.OPEN, held_at: new Date() })
    .where('id', '=', Number(meetingId)).returning(['id', 'status'])
    .executeTakeFirst();
  return { ok: true, meeting: row };
}

/**
 * Record an attendee with conflict declaration. A conflicted member is
 * excluded from quorum and cannot vote (§09).
 */
export async function addAttendee({ meetingId, userId, role = 'member', conflictDeclared = false, conflictReason = '', createdBy = null } = {}) {
  if (!meetingId || !userId) throw new Error('meetingId and userId are required');
  const db = await getDb();
  if (!db) throw new Error('PostgreSQL required');

  const meeting = await db.selectFrom('board_meetings')
    .where('id', '=', Number(meetingId)).where('tenant_id', '=', getTenantId())
    .select('status').executeTakeFirst();
  if (!meeting) throw new Error('Meeting not found');
  if (meeting.status === MEETING_STATUS.RATIFIED || meeting.status === MEETING_STATUS.REJECTED) {
    throw new Error('Cannot add attendees to a closed meeting');
  }

  const existing = await db.selectFrom('board_attendees')
    .where('tenant_id', '=', getTenantId())
    .where('meeting_id', '=', Number(meetingId))
    .where('user_id', '=', Number(userId))
    .select('id').executeTakeFirst();
  if (existing) {
    await db.updateTable('board_attendees')
      .set({
        attended: true,
        conflict_declared: !!conflictDeclared,
        conflict_reason: conflictDeclared ? String(conflictReason || '').slice(0, 500) : null,
      })
      .where('id', '=', existing.id)
      .execute();
    return { ok: true, id: existing.id, idempotent: true };
  }

  const row = await db.insertInto('board_attendees')
    .values({
      tenant_id: getTenantId(),
      meeting_id: Number(meetingId),
      user_id: Number(userId),
      role,
      attended: true,
      conflict_declared: !!conflictDeclared,
      conflict_reason: conflictDeclared ? String(conflictReason || '').slice(0, 500) : null,
    })
    .returning(['id', 'conflict_declared'])
    .executeTakeFirst();
  return { ok: true, id: row.id, conflict_declared: row.conflict_declared };
}

/** Record a member's vote (approve | reject | abstain). */
export async function recordVote({ meetingId, userId, vote = 'approve', actorId = null } = {}) {
  if (!meetingId || !userId) throw new Error('meetingId and userId are required');
  if (!VOTES.includes(vote)) throw new Error(`Invalid vote: ${vote}`);
  const db = await getDb();
  if (!db) throw new Error('PostgreSQL required');

  const attendee = await db.selectFrom('board_attendees')
    .where('tenant_id', '=', getTenantId())
    .where('meeting_id', '=', Number(meetingId))
    .where('user_id', '=', Number(userId))
    .selectAll().executeTakeFirst();
  if (!attendee) throw new Error('Attendee not found — register attendance first');
  if (attendee.conflict_declared) throw new Error('Conflicted member cannot vote');
  if (!attendee.attended) throw new Error('Member must attend to vote');

  const row = await db.updateTable('board_attendees')
    .set({ vote, voted_at: new Date() })
    .where('id', '=', attendee.id)
    .returning(['id', 'vote'])
    .executeTakeFirst();
  return { ok: true, attendee: row };
}

// ═══════════════════════════════════════════════════════════════════
// BOARD-READY BLOCKER CHECK
// ═══════════════════════════════════════════════════════════════════

/**
 * Check whether a grade_calculation_run is ready for board ratification.
 * Fail-closed: any blocker → not ready.
 */
export async function getBoardReadiness({ runId, meetingId = null, actorId = null } = {}) {
  // meetingId is accepted for API symmetry but readiness depends only on
  // the run + its rule version + open moderation cases.
  const db = await getDb();
  if (!db) return { ok: false, blockers: ['PostgreSQL required'], ready: false };

  const run = await db.selectFrom('grade_calculation_runs')
    .where('id', '=', Number(runId)).where('tenant_id', '=', getTenantId())
    .selectAll().executeTakeFirst();
  if (!run) return { ok: false, ready: false, blockers: ['grade calculation run not found'] };

  const version = await db.selectFrom('academic_grade_rule_versions')
    .where('id', '=', run.rule_version_id).where('tenant_id', '=', getTenantId())
    .select(['id', 'status', 'rule_hash']).executeTakeFirst();

  const openCases = await db.selectFrom('moderation_cases')
    .where('tenant_id', '=', getTenantId())
    .where('status', '=', 'open')
    .select('id').execute();

  const result = checkBoardReady({
    rule: version ? { status: version.status } : null,
    run: { ...run, blocked: false },
    openModerationCases: openCases,
  });

  return { ok: result.ok, ready: result.ok, blockers: result.blockers, run, ruleVersion: version };
}

// ═══════════════════════════════════════════════════════════════════
// RATIFICATION TRANSACTION (IMMUTABLE)
// ═══════════════════════════════════════════════════════════════════

/**
 * Ratify a provisional grade. IMMUTABLE: the ratified final + snapshot
 * hash are written to board_decisions; the grade_calculation_runs row is
 * NEVER directly updated (§15 — no direct UPDATE overwrite). Subsequent
 * changes go through appendAmendment (append-only ledger) and are
 * re-released via sis_outbox versioning — the original board decision
 * row stays untouched (audit trail).
 *
 * Idempotent by tenant+run_id (UNIQUE board_decision_run).
 *
 * @param {Object} opts
 * @param {number} opts.meetingId
 * @param {number} opts.runId
 * @param {number} opts.userId - student the run belongs to
 * @param {number|null} [opts.decidedBy]
 */
export async function ratifyResult({ meetingId, runId, userId, decidedBy = null } = {}) {
  if (!meetingId || !runId || !userId) {
    throw new Error('meetingId, runId and userId are required');
  }
  const db = await getDb();
  if (!db) throw new Error('PostgreSQL required');

  // 1. Readiness gate (fail-closed)
  const readiness = await getBoardReadiness({ runId, meetingId });
  if (!readiness.ready) {
    return { ok: false, blocked: true, blockers: readiness.blockers };
  }

  // 2. Quorum gate from meeting attendees
  const attendees = await db.selectFrom('board_attendees')
    .where('tenant_id', '=', getTenantId())
    .where('meeting_id', '=', Number(meetingId))
    .selectAll().execute();
  const meeting = await db.selectFrom('board_meetings')
    .where('id', '=', Number(meetingId)).where('tenant_id', '=', getTenantId())
    .selectAll().executeTakeFirst();
  if (!meeting) throw new Error('Meeting not found');

  const quorum = checkQuorum({
    attendees,
    requiredQuorum: meeting.required_quorum,
    requiredApprovalRatio: Number(meeting.required_approval_ratio),
  });
  if (!quorum.quorumMet) {
    return { ok: false, quorumError: quorum.reason, quorum };
  }

  // 3. Snapshot hash (immutable evidence)
  const existingAmendments = await db.selectFrom('grade_amendments')
    .where('tenant_id', '=', getTenantId()).where('run_id', '=', Number(runId))
    .selectAll().execute();
  const run = readiness.run;
  const snapshotHash = buildSnapshotHash({
    run,
    ruleVersion: readiness.ruleVersion,
    amendments: existingAmendments,
  });

  const decision = quorum.ok ? DECISION_STATUS.RATIFIED : DECISION_STATUS.REJECTED;

  // 4. Immutable decision insert (idempotent by run)
  try {
    const row = await db.insertInto('board_decisions')
      .values({
        tenant_id: getTenantId(),
        meeting_id: Number(meetingId),
        run_id: Number(runId),
        user_id: Number(userId),
        provisional_final: Number(run.final_grade),
        grade_label: run.grade_label || null,
        ratified_final: quorum.ok ? Number(run.final_grade) : null,
        snapshot_hash: snapshotHash,
        decision,
        decided_by: decidedBy || null,
        decided_at: new Date(),
      })
      .returning(['id', 'decision', 'ratified_final', 'snapshot_hash'])
      .executeTakeFirst();
    if (quorum.ok) {
      await db.updateTable('board_meetings')
        .set({ status: MEETING_STATUS.RATIFIED, closed_at: new Date() })
        .where('id', '=', Number(meetingId)).execute();
    } else {
      await db.updateTable('board_meetings')
        .set({ status: MEETING_STATUS.REJECTED, closed_at: new Date() })
        .where('id', '=', Number(meetingId)).execute();
    }
    await audit({
      action: AUDIT_ACTIONS.BOARD_RATIFY,
      userId: decidedBy,
      resourceType: 'board_decision',
      resourceId: row.id,
      details: { runId, meetingId, decision, snapshotHash: snapshotHash.slice(0, 12), quorum },
    }).catch(() => {});
    return { ok: true, decision: row, quorum, snapshotHash };
  } catch (e) {
    if (e.code === PG_UNIQUE_VIOLATION || String(e.message).includes('duplicate')) {
      const existing = await db.selectFrom('board_decisions')
        .where('tenant_id', '=', getTenantId()).where('run_id', '=', Number(runId))
        .selectAll().executeTakeFirst();
      return { ok: true, idempotent: true, decision: existing };
    }
    throw e;
  }
}

// ═══════════════════════════════════════════════════════════════════
// RELEASE BATCH (SIS/HEMIS OUTBOX)
// ═══════════════════════════════════════════════════════════════════

/**
 * Release a ratified result to the SIS/HEMIS outbox. Refuses anything
 * that is NOT ratified (§15 — ratification'siz release yo'q).
 */
export async function releaseBatch({ decisionId = null, runId = null, userId = null, actorId = null } = {}) {
  const db = await getDb();
  if (!db) throw new Error('PostgreSQL required');

  let decision;
  if (decisionId) {
    decision = await db.selectFrom('board_decisions')
      .where('id', '=', Number(decisionId)).where('tenant_id', '=', getTenantId())
      .selectAll().executeTakeFirst();
  } else if (runId) {
    decision = await db.selectFrom('board_decisions')
      .where('tenant_id', '=', getTenantId()).where('run_id', '=', Number(runId))
      .selectAll().executeTakeFirst();
  }
  if (!decision) throw new Error('Ratified decision not found');
  if (decision.decision !== DECISION_STATUS.RATIFIED) {
    throw new Error('Release requires a ratified board decision');
  }

  const run = await db.selectFrom('grade_calculation_runs')
    .where('id', '=', decision.run_id).where('tenant_id', '=', getTenantId())
    .selectAll().executeTakeFirst();
  // The student is ALWAYS the decision's user — a caller-supplied userId
  // must match, otherwise an admin could misattribute a release to another
  // student's SIS id (hardening §16 authorization).
  const targetUserId = Number(userId || decision.user_id);
  if (decision.user_id !== null && Number(decision.user_id) !== targetUserId) {
    throw new Error('userId does not match the ratified decision');
  }
  const student = await db.selectFrom('users')
    .where('id', '=', targetUserId).where('tenant_id', '=', getTenantId())
    .select(['id', 'external_id']).executeTakeFirst();

  // Amendment version = current amendment count (0 = original release).
  // The EFFECTIVE grade is the LAST amendment's new_final when amendments
  // exist — run.final_grade stays frozen (no direct UPDATE §15), so it is
  // NOT the source of truth once the grade has been amended.
  const amendments = await db.selectFrom('grade_amendments')
    .where('tenant_id', '=', getTenantId()).where('run_id', '=', decision.run_id)
    .selectAll().orderBy('amendment_no', 'asc').execute();
  const version = amendments.length;
  const effectiveFinal = amendments.length > 0
    ? amendments[amendments.length - 1].new_final
    : Number(run?.final_grade ?? decision.ratified_final);

  const { externalKey, payload } = buildSisPayload({
    decision,
    run,
    user: student || null,
    version,
    effectiveFinal,
  });

  try {
    const row = await db.insertInto('sis_outbox')
      .values({
        tenant_id: getTenantId(),
        decision_id: decision.id,
        run_id: decision.run_id,
        user_id: targetUserId,
        external_key: externalKey,
        payload: JSON.stringify(payload),
        status: OUTBOX_STATUS.PENDING,
        attempts: 0,
      })
      .returning(['id', 'status', 'external_key'])
      .executeTakeFirst();
    await audit({
      action: AUDIT_ACTIONS.RESULT_RELEASE,
      userId: actorId,
      resourceType: 'sis_outbox',
      resourceId: row.id,
      details: { runId: decision.run_id, decisionId: decision.id, version },
    }).catch(() => {});
    return { ok: true, outbox: row, payload };
  } catch (e) {
    if (e.code === PG_UNIQUE_VIOLATION || String(e.message).includes('duplicate')) {
      const existing = await db.selectFrom('sis_outbox')
        .where('tenant_id', '=', getTenantId()).where('external_key', '=', externalKey)
        .selectAll().executeTakeFirst();
      return { ok: true, idempotent: true, outbox: existing };
    }
    throw e;
  }
}

// ═══════════════════════════════════════════════════════════════════
// APPEND-ONLY AMENDMENT LEDGER
// ═══════════════════════════════════════════════════════════════════

/**
 * Append a grade amendment (regrade/error correction/appeal outcome).
 * The ratified grade is never overwritten — a NEW amendment row records
 * the change; a NEW board decision + outbox version re-releases it.
 */
export async function appendAmendment({ runId, newFinal, reason = '', changedBy = null } = {}) {
  if (!runId || newFinal === null || newFinal === undefined) {
    throw new Error('runId and newFinal are required');
  }
  const db = await getDb();
  if (!db) throw new Error('PostgreSQL required');

  const run = await db.selectFrom('grade_calculation_runs')
    .where('id', '=', Number(runId)).where('tenant_id', '=', getTenantId())
    .selectAll().executeTakeFirst();
  if (!run) throw new Error('Calculation run not found');
  if (run.final_grade === null) throw new Error('Run has no final grade yet');

  const amendments = await db.selectFrom('grade_amendments')
    .where('tenant_id', '=', getTenantId()).where('run_id', '=', Number(runId))
    .selectAll().orderBy('amendment_no', 'asc').execute();
  const amendmentNo = nextAmendmentNo(amendments);

  // The 'old' value is the CURRENT EFFECTIVE grade — the last amendment's
  // new_final when amendments exist (amendment chain), otherwise the
  // frozen ratified final. run.final_grade is NOT overwritten (§15).
  const oldFinal = amendments.length > 0
    ? Number(amendments[amendments.length - 1].new_final)
    : Number(run.final_grade);

  const valid = validateAmendment({
    amendmentNo,
    oldFinal,
    newFinal: Number(newFinal),
    reason,
  });
  if (!valid.ok) return { ok: false, error: valid.reason };

  const row = await db.insertInto('grade_amendments')
    .values({
      tenant_id: getTenantId(),
      run_id: Number(runId),
      amendment_no: amendmentNo,
      old_final: oldFinal,
      new_final: Number(newFinal),
      reason: String(reason).slice(0, 1000),
      changed_by: changedBy || null,
    })
    .returning(['id', 'amendment_no', 'old_final', 'new_final'])
    .executeTakeFirst();
  await audit({
    action: AUDIT_ACTIONS.GRADE_AMEND,
    userId: changedBy,
    resourceType: 'grade_amendment',
    resourceId: row.id,
    details: { runId, amendmentNo, oldFinal, newFinal: Number(newFinal) },
  }).catch(() => {});
  return { ok: true, amendment: row };
}

// ═══════════════════════════════════════════════════════════════════
// SIS RECONCILIATION
// ═══════════════════════════════════════════════════════════════════

/**
 * Idempotently mark an outbox entry sent (and optionally reconciled).
 */
export async function reconcileOutbox({ outboxId = null, externalKey = null, status = 'sent', error = '', actorId = null } = {}) {
  if (!outboxId && !externalKey) throw new Error('outboxId or externalKey is required');
  if (!Object.values(OUTBOX_STATUS).includes(status)) {
    throw new Error(`Invalid outbox status: ${status}`);
  }
  const db = await getDb();
  if (!db) throw new Error('PostgreSQL required');

  let row;
  if (outboxId) {
    row = await db.selectFrom('sis_outbox')
      .where('id', '=', Number(outboxId)).where('tenant_id', '=', getTenantId())
      .selectAll().executeTakeFirst();
  } else {
    row = await db.selectFrom('sis_outbox')
      .where('tenant_id', '=', getTenantId()).where('external_key', '=', externalKey)
      .selectAll().executeTakeFirst();
  }
  if (!row) throw new Error('Outbox entry not found');
  if (row.status === 'reconciled') return { ok: true, idempotent: true, outbox: row };

  const set = {
    status,
    attempts: Number(row.attempts) + 1,
    last_error: status === 'failed' ? String(error).slice(0, 1000) : null,
    sent_at: status === 'sent' ? new Date() : row.sent_at,
    reconciled_at: status === 'reconciled' ? new Date() : row.reconciled_at,
  };
  const updated = await db.updateTable('sis_outbox')
    .set(set)
    .where('id', '=', row.id)
    .returning(['id', 'status', 'attempts', 'external_key'])
    .executeTakeFirst();
  return { ok: true, outbox: updated };
}

// ═══════════════════════════════════════════════════════════════════
// READ PATHS + METRICS
// ═══════════════════════════════════════════════════════════════════

export async function getBoardMeeting(id) {
  const db = await getDb();
  if (!db) return null;
  return db.selectFrom('board_meetings')
    .where('id', '=', Number(id)).where('tenant_id', '=', getTenantId())
    .selectAll().executeTakeFirst() || null;
}

export async function listBoardMeetings({ status } = {}) {
  const db = await getDb();
  if (!db) return [];
  let q = db.selectFrom('board_meetings')
    .where('tenant_id', '=', getTenantId())
    .selectAll().orderBy('id', 'desc');
  if (status) q = q.where('status', '=', status);
  return q.execute();
}

export async function listAttendees({ meetingId } = {}) {
  const db = await getDb();
  if (!db) return [];
  let q = db.selectFrom('board_attendees')
    .where('tenant_id', '=', getTenantId())
    .selectAll().orderBy('id', 'asc');
  if (meetingId) q = q.where('meeting_id', '=', Number(meetingId));
  return q.execute();
}

export async function listDecisions({ meetingId, runId } = {}) {
  const db = await getDb();
  if (!db) return [];
  let q = db.selectFrom('board_decisions')
    .where('tenant_id', '=', getTenantId())
    .selectAll().orderBy('id', 'desc');
  if (meetingId) q = q.where('meeting_id', '=', Number(meetingId));
  if (runId) q = q.where('run_id', '=', Number(runId));
  return q.execute();
}

export async function listAmendments({ runId } = {}) {
  const db = await getDb();
  if (!db) return [];
  let q = db.selectFrom('grade_amendments')
    .where('tenant_id', '=', getTenantId())
    .selectAll().orderBy('amendment_no', 'asc');
  if (runId) q = q.where('run_id', '=', Number(runId));
  return q.execute();
}

export async function listOutbox({ status } = {}) {
  const db = await getDb();
  if (!db) return [];
  let q = db.selectFrom('sis_outbox')
    .where('tenant_id', '=', getTenantId())
    .selectAll().orderBy('id', 'desc');
  if (status) q = q.where('status', '=', status);
  return q.execute();
}
