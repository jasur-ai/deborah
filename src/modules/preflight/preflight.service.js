/**
 * Deborah — Student Preflight Service
 *
 * Prompt 28 (Student assignment list, brief va preflight):
 *   - getStudentAssignments: assignments where the student is in the PUBLISHED
 *     roster snapshot (never the live roster — §24 stop condition: no silent
 *     re-sync when snapshot and current roster disagree)
 *   - getStudentAssignmentBrief: authorized, exact-version-pinned, whitelist-
 *     sanitized brief/policy render (§15 — answer keys never reach the surface)
 *   - runPreflight: computes the full eligibility contract from client hints
 *     and persists it (idempotent per assignment + user + day)
 *   - getPreflightStatus: latest persisted contract
 *
 * SECURITY:
 *   - Roster membership is the ONLY authorization gate (snapshot-based)
 *   - Brief/policy renders go through whitelist sanitizers in the pure schema
 *   - Availability window comes from the linked calendar event
 *   - Write path is idempotent + tenant-scoped + audited
 *
 * Graceful degradation: without PostgreSQL, list reads return [], brief
 * returns null, writes throw a clear 'PostgreSQL required' error.
 */

import { sql } from 'kysely';
import { getDb } from '../../infrastructure/postgres.js';
import { getCurrentTenant } from '../auth/tenant-context.js';
import { audit, AUDIT_ACTIONS } from '../auth/audit.js';
import { getAssignment, getAssignmentRoster } from '../publish/publish.service.js';
import { getSnapshotsForAssignment, confirmAccommodation } from '../accommodation/accommodation.service.js';
import {
  computeAvailabilityWindow,
  checkRosterMembership,
  sanitizeBriefForStudent,
  sanitizePolicyForStudent,
  buildDeviceCheck,
  buildSecurityCheck,
  buildPracticeRequirement,
  buildPracticeStatus,
  computeStartEligibility,
  derivePreflightKey,
  PREFLIGHT_STATUS,
} from './preflight.schema.js';

function getTenantId() {
  return getCurrentTenant()?.tenantId || 1;
}

/**
 * Load the calendar event availability window for an assignment.
 * Returns null when no event is linked (assignment → unscheduled window).
 *
 * @param {import('kysely').Kysely<any>} db
 * @param {number|null} calendarEventId
 * @returns {Promise<{ start_at: Date|null, end_at: Date|null }|null>}
 */
async function loadCalendarEvent(db, calendarEventId) {
  if (!calendarEventId) return null;
  try {
    return await db.selectFrom('program_events')
      .where('id', '=', calendarEventId)
      .where('tenant_id', '=', getTenantId())
      .select(['start_at', 'end_at'])
      .executeTakeFirst() || null;
  } catch (_) {
    return null;
  }
}

/**
 * Resolve the exact pinned brief version for an assignment.
 * Tries the stored brief_version_id first (id lookup), then falls back to the
 * brief's current version number, then the latest version row. The content
 * used for the student render is ALWAYS the version snapshot — the version
 * the assignment was published against (Prompt 28 §09 exact version render).
 *
 * @param {import('kysely').Kysely<any>} db
 * @param {number} briefId
 * @param {number|null} versionId
 * @returns {Promise<Object|null>} version row { version, content_snapshot, ai_use_level_snapshot, ... }
 */
async function resolveBriefVersion(db, briefId, versionId) {
  if (!briefId) return null;
  try {
    if (versionId) {
      const byId = await db.selectFrom('assessment_brief_versions')
        .where('id', '=', versionId)
        .where('brief_id', '=', briefId)
        .where('tenant_id', '=', getTenantId())
        .selectAll()
        .executeTakeFirst();
      if (byId) return byId;
    }
    const byNumber = await db.selectFrom('assessment_brief_versions')
      .where('brief_id', '=', briefId)
      .where('tenant_id', '=', getTenantId())
      .orderBy('version', 'desc')
      .limit(1)
      .selectAll()
      .executeTakeFirst();
    return byNumber || null;
  } catch (_) {
    return null;
  }
}

/**
 * Resolve the exact pinned policy version for an assignment (same strategy
 * as resolveBriefVersion).
 */
async function resolvePolicyVersion(db, policyPackId, versionId) {
  if (!policyPackId) return null;
  try {
    if (versionId) {
      const byId = await db.selectFrom('policy_pack_versions')
        .where('id', '=', versionId)
        .where('policy_pack_id', '=', policyPackId)
        .where('tenant_id', '=', getTenantId())
        .selectAll()
        .executeTakeFirst();
      if (byId) return byId;
    }
    const byNumber = await db.selectFrom('policy_pack_versions')
      .where('policy_pack_id', '=', policyPackId)
      .where('tenant_id', '=', getTenantId())
      .orderBy('version', 'desc')
      .limit(1)
      .selectAll()
      .executeTakeFirst();
    return byNumber || null;
  } catch (_) {
    return null;
  }
}

/**
 * Build the full preflight context for one assignment + student:
 * availability window, roster membership, sanitized brief/policy render,
 * accommodation snapshot presence. Pure computation — no persistence.
 *
 * @param {Object} assignment - assessment_assignments row (getAssignment)
 * @param {Array<Object>} roster - assignment_roster_members rows
 * @param {Object|null} calendarEvent - { start_at, end_at } | null
 * @param {Object|null} briefRow - assessment_briefs row
 * @param {Object|null} briefVersion - assessment_brief_versions row
 * @param {Object|null} policyRow - policy_packs row
 * @param {Object|null} policyVersion - policy_pack_versions row
 * @param {Array<Object>} accommodationSnapshots - accommodation_snapshots rows
 * @param {Object} [opts] - { now }
 * @returns {Object} preflight context
 */
export function buildPreflightContext({
  assignment,
  roster = [],
  calendarEvent = null,
  briefRow = null,
  briefVersion = null,
  policyRow = null,
  policyVersion = null,
  accommodationSnapshots = [],
  opts = {},
}) {
  const now = opts.now || Date.now();

  const availability = computeAvailabilityWindow({
    startAt: calendarEvent?.start_at ?? null,
    endAt: calendarEvent?.end_at ?? null,
    now,
  });
  const rosterCheck = checkRosterMembership(roster, opts.userId);
  const brief = sanitizeBriefForStudent({
    version: briefVersion?.version ?? briefRow?.version ?? null,
    ai_use_level: briefVersion?.ai_use_level_snapshot ?? briefRow?.ai_use_level ?? null,
    content: briefVersion?.content_snapshot ?? briefRow?.content ?? {},
  });
  const policy = sanitizePolicyForStudent({
    version: policyVersion?.version ?? policyRow?.version ?? null,
    policy: policyVersion?.policy_snapshot ?? policyRow?.policy ?? {},
  });
  const accommodation = {
    required: accommodationSnapshots.length > 0,
    confirmed: false,
    snapshot_count: accommodationSnapshots.length,
    effective_config: accommodationSnapshots.length > 0
      ? accommodationSnapshots[0].snapshot_config || {}
      : {},
  };

  return {
    assignment_id: assignment?.id ?? null,
    title: assignment?.title ?? null,
    status: assignment?.status ?? null,
    version_hash: assignment?.version_hash ?? null,
    availability,
    roster: rosterCheck,
    brief,
    policy,
    accommodation,
  };
}

// ═══════════════════════════════════════════════════════════════════
// STUDENT ASSIGNMENT LIST (roster-snapshot based)
// ═══════════════════════════════════════════════════════════════════

/**
 * List assignments a student is authorized for — membership is read from the
 * PUBLISHED roster snapshot (assignment_roster_members), never from the live
 * enrollments table. Each entry carries its availability window.
 *
 * @param {number} userId
 * @param {Object} [opts] - { now }
 * @returns {Promise<Array<Object>>}
 */
export async function getStudentAssignments(userId, opts = {}) {
  const db = await getDb();
  if (!db) return [];
  try {
    const rows = await db.selectFrom('assignment_roster_members')
      .innerJoin('assessment_assignments', 'assessment_assignments.id', 'assignment_roster_members.assignment_id')
      .where('assignment_roster_members.user_id', '=', userId)
      .where('assignment_roster_members.tenant_id', '=', getTenantId())
      .where('assessment_assignments.tenant_id', '=', getTenantId())
      .select([
        'assessment_assignments.id as assignment_id',
        'assessment_assignments.title',
        'assessment_assignments.status',
        'assessment_assignments.version_hash',
        'assessment_assignments.calendar_event_id',
        'assessment_assignments.brief_id',
        'assessment_assignments.brief_version_id',
        'assessment_assignments.policy_pack_id',
        'assessment_assignments.policy_version_id',
        'assessment_assignments.published_at',
      ])
      .orderBy('assessment_assignments.published_at', 'desc')
      .execute();

    const out = [];
    for (const row of rows) {
      const event = await loadCalendarEvent(db, row.calendar_event_id);
      out.push({
        assignment_id: row.assignment_id,
        title: row.title,
        status: row.status,
        version_hash: row.version_hash,
        availability: computeAvailabilityWindow({
          startAt: event?.start_at ?? null,
          endAt: event?.end_at ?? null,
          now: opts.now || Date.now(),
        }),
      });
    }
    return out;
  } catch (_) {
    return [];
  }
}

// ═══════════════════════════════════════════════════════════════════
// AUTHORIZED BRIEF/POLICY RENDER
// ═══════════════════════════════════════════════════════════════════

/**
 * Render the exact pinned, sanitized brief + policy for an assignment.
 * Authorization gate: the student MUST be in the published roster snapshot —
 * otherwise returns { ok:false, code:'not_assigned' } (snapshot wins over the
 * live roster; no silent re-sync, §24).
 *
 * @param {number} assignmentId
 * @param {number} userId
 * @returns {Promise<Object|null>}
 */
export async function getStudentAssignmentBrief(assignmentId, userId) {
  const db = await getDb();
  if (!db) return null;

  const assignment = await getAssignment(assignmentId);
  if (!assignment) return null;

  const roster = await getAssignmentRoster(assignmentId);
  const rosterCheck = checkRosterMembership(roster, userId);
  if (!rosterCheck.in_snapshot) {
    return { ok: false, code: 'not_assigned' };
  }

  const [briefRow, policyRow, calendarEvent] = await Promise.all([
    assignment.brief_id
      ? db.selectFrom('assessment_briefs').where('id', '=', assignment.brief_id).where('tenant_id', '=', getTenantId()).selectAll().executeTakeFirst().catch(() => null)
      : Promise.resolve(null),
    assignment.policy_pack_id
      ? db.selectFrom('policy_packs').where('id', '=', assignment.policy_pack_id).where('tenant_id', '=', getTenantId()).selectAll().executeTakeFirst().catch(() => null)
      : Promise.resolve(null),
    loadCalendarEvent(db, assignment.calendar_event_id),
  ]);
  const [briefVersion, policyVersion] = await Promise.all([
    resolveBriefVersion(db, assignment.brief_id, assignment.brief_version_id),
    resolvePolicyVersion(db, assignment.policy_pack_id, assignment.policy_version_id),
  ]);

  const brief = sanitizeBriefForStudent({
    version: briefVersion?.version ?? briefRow?.version ?? null,
    ai_use_level: briefVersion?.ai_use_level_snapshot ?? briefRow?.ai_use_level ?? null,
    content: briefVersion?.content_snapshot ?? briefRow?.content ?? {},
  });
  const policy = sanitizePolicyForStudent({
    version: policyVersion?.version ?? policyRow?.version ?? null,
    policy: policyVersion?.policy_snapshot ?? policyRow?.policy ?? {},
  });

  return {
    ok: true,
    assignment: {
      id: assignment.id,
      title: assignment.title,
      status: assignment.status,
      version_hash: assignment.version_hash,
    },
    availability: computeAvailabilityWindow({
      startAt: calendarEvent?.start_at ?? null,
      endAt: calendarEvent?.end_at ?? null,
    }),
    roster: rosterCheck,
    brief,
    policy,
  };
}

// ═══════════════════════════════════════════════════════════════════
// RUN PREFLIGHT (persisted, idempotent per day)
// ═══════════════════════════════════════════════════════════════════

/**
 * Run (and persist) the full preflight for a student + assignment.
 * Idempotent per assignment + user + UTC day: re-running the same day returns
 * the existing row (duplicate: true).
 *
 * @param {Object} params
 * @param {number} params.assignmentId
 * @param {number} params.userId
 * @param {Object} [params.clientInfo] - { userAgent, screenWidth, screenHeight, online, connectionType, connectionDownlink }
 * @param {Object} [params.deviceAttestation] - { cameraAvailable, sebPresent }
 * @param {Object} [params.practiceData] - { completed_runs, required_runs }
 * @param {Object} [params.opts] - { now }
 * @returns {Promise<Object>}
 */
export async function runPreflight({ assignmentId, userId, clientInfo = {}, deviceAttestation = {}, practiceData = {}, opts = {} } = {}) {
  const db = await getDb();
  if (!db) throw new Error('PostgreSQL required');

  const assignment = await getAssignment(assignmentId);
  if (!assignment) throw new Error('Assignment not found');

  const roster = await getAssignmentRoster(assignmentId);
  const rosterCheck = checkRosterMembership(roster, userId);
  // NOTE: we still persist the contract for an unassigned student — the
  // blocker row tells them exactly why they cannot start (§25 done condition).

  const calendarEvent = await loadCalendarEvent(db, assignment.calendar_event_id);
  const [briefRow, policyRow] = await Promise.all([
    assignment.brief_id
      ? db.selectFrom('assessment_briefs').where('id', '=', assignment.brief_id).where('tenant_id', '=', getTenantId()).selectAll().executeTakeFirst().catch(() => null)
      : Promise.resolve(null),
    assignment.policy_pack_id
      ? db.selectFrom('policy_packs').where('id', '=', assignment.policy_pack_id).where('tenant_id', '=', getTenantId()).selectAll().executeTakeFirst().catch(() => null)
      : Promise.resolve(null),
  ]);
  const [briefVersion, policyVersion] = await Promise.all([
    resolveBriefVersion(db, assignment.brief_id, assignment.brief_version_id),
    resolvePolicyVersion(db, assignment.policy_pack_id, assignment.policy_version_id),
  ]);
  const accommodationSnapshots = await db.selectFrom('accommodation_snapshots')
    .where('assessment_assignment_id', '=', assignmentId)
    .where('user_id', '=', userId)
    .where('is_active', '=', true)
    .selectAll()
    .execute()
    .catch(() => []);

  // ── Accommodation confirmation state ──
  // The student confirms their accommodation separately (POST .../accommodation/confirm).
  // The confirmed flag lives on the persisted preflight row; we reuse it so a
  // re-run sees the confirmation instead of hardcoding false forever.
  const priorRow = await db.selectFrom('preflight_checks')
    .where('assignment_id', '=', assignmentId)
    .where('user_id', '=', userId)
    .where('tenant_id', '=', getTenantId())
    .orderBy('created_at', 'desc')
    .limit(1)
    .select(['accommodation'])
    .executeTakeFirst()
    .catch(() => null);
  const accommodationConfirmed = priorRow?.accommodation?.confirmed === true;

  const context = buildPreflightContext({
    assignment,
    roster,
    calendarEvent,
    briefRow,
    briefVersion,
    policyRow,
    policyVersion,
    accommodationSnapshots,
    opts: { ...opts, userId },
  });

  // Practice requirement from the brief/policy + practice progress
  const practiceRequirement = buildPracticeRequirement(
    briefRow?.content ? { content: briefRow.content } : null,
    policyRow?.policy ? { policy: policyRow.policy } : null,
  );
  const practice = buildPracticeStatus(practiceRequirement, practiceData);

  // Device capability + camera/SEB hook
  const device = buildDeviceCheck(clientInfo);
  const security = buildSecurityCheck(context.policy.security || {}, deviceAttestation);

  const result = computeStartEligibility({
    availability: context.availability,
    roster: context.roster,
    brief: context.brief,
    policy: context.policy,
    practice,
    device,
    security,
    accommodation: { ...context.accommodation, confirmed: accommodationConfirmed },
  });

  const externalKey = derivePreflightKey(assignmentId, userId, opts.now || Date.now());
  const existing = await db.selectFrom('preflight_checks')
    .where('tenant_id', '=', getTenantId())
    .where('assignment_id', '=', assignmentId)
    .where('user_id', '=', userId)
    .where('external_key', '=', externalKey)
    .selectAll()
    .executeTakeFirst()
    .catch(() => null);
  if (existing) {
    // Duplicate (same day): return the STORED contract so the view renders
    // the real blockers/eligibility instead of a misleading empty failure.
    return {
      ok: true,
      preflightId: existing.id,
      duplicate: true,
      status: existing.status,
      eligible: existing.eligible,
      blockers: existing.blockers || [],
      warnings: existing.result?.warnings || [],
      accommodation: existing.accommodation
        ? { required: existing.accommodation.required, confirmed: existing.accommodation.confirmed }
        : undefined,
    };
  }

  const status = result.eligible ? PREFLIGHT_STATUS.PASSED : PREFLIGHT_STATUS.BLOCKED;
  const acc = { ...context.accommodation, confirmed: accommodationConfirmed };
  let inserted;
  try {
    inserted = await db.insertInto('preflight_checks')
      .values({
        tenant_id: getTenantId(),
        assignment_id: assignmentId,
        user_id: userId,
        external_key: externalKey,
        status,
        eligible: result.eligible,
        result: { ...result, eligible_at: new Date().toISOString() },
        availability: context.availability,
        roster: context.roster,
        brief: context.brief,
        policy: context.policy,
        accommodation: acc,
        practice,
        device,
        security,
        blockers: result.blockers,
        client_info: clientInfo,
      })
      .returning('id')
      .executeTakeFirst();
  } catch (err) {
    // Idempotency race backstop: two concurrent preflight submissions (e.g.
    // double-click) can both pass the existence check — the UNIQUE index on
    // (tenant, assignment, user, external_key) rejects the second insert.
    // Return the winner's STORED contract as a duplicate (same shape as the
    // primary duplicate branch above, so the view renders real blockers).
    if (err?.code === '23505' || /duplicate key/i.test(err?.message || '')) {
      const dup = await db.selectFrom('preflight_checks')
        .where('tenant_id', '=', getTenantId())
        .where('assignment_id', '=', assignmentId)
        .where('user_id', '=', userId)
        .where('external_key', '=', externalKey)
        .selectAll()
        .executeTakeFirst()
        .catch(() => null);
      if (dup) {
        return {
          ok: true,
          preflightId: dup.id,
          duplicate: true,
          status: dup.status,
          eligible: dup.eligible,
          blockers: dup.blockers || [],
          warnings: dup.result?.warnings || [],
          accommodation: dup.accommodation
            ? { required: dup.accommodation.required, confirmed: dup.accommodation.confirmed }
            : undefined,
        };
      }
    }
    throw err;
  }

  await audit({
    action: AUDIT_ACTIONS.PREFLIGHT_RUN,
    userId,
    resourceType: 'preflight_check',
    resourceId: inserted?.id ?? null,
    details: {
      assignment_id: assignmentId,
      eligible: result.eligible,
      blocker_count: result.blockers.length,
      status,
    },
  });

  return {
    ok: true,
    preflightId: inserted?.id ?? null,
    duplicate: false,
    status,
    eligible: result.eligible,
    blockers: result.blockers,
    warnings: result.warnings,
    accommodation: { required: acc.required, confirmed: acc.confirmed },
  };
}

// ═══════════════════════════════════════════════════════════════════
// ACCOMMODATION CONFIRMATION
// ═══════════════════════════════════════════════════════════════════

/**
 * Confirm the student's accommodation for an assignment (§10).
 * Authorization gate: student must be in the published roster snapshot.
 * Reuses the accommodation module's confirmAccommodation (validates snapshot
 * presence + audits), then records the confirmation on the latest preflight
 * row so subsequent preflight runs see confirmed: true.
 *
 * @param {Object} params - { assignmentId, userId }
 * @returns {Promise<Object>}
 */
export async function confirmStudentAccommodation({ assignmentId, userId }) {
  const db = await getDb();
  if (!db) throw new Error('PostgreSQL required');

  const assignment = await getAssignment(assignmentId);
  if (!assignment) return { ok: false, code: 'not_found' };

  const roster = await getAssignmentRoster(assignmentId);
  const rosterCheck = checkRosterMembership(roster, userId);
  if (!rosterCheck.in_snapshot) {
    return { ok: false, code: 'not_assigned' };
  }

  const snapshots = await getSnapshotsForAssignment(assignmentId, userId);
  if (!snapshots || snapshots.length === 0) {
    return { ok: false, code: 'no_accommodation' };
  }

  const confirmed = await confirmAccommodation(userId, assignmentId, snapshots[0].snapshot_config || {});

  // Record confirmation on the latest preflight row (if any exists) — merge
  // confirmed:true into the accommodation JSONB (Kysely sql template, no
  // string-built raw SQL).
  await db.updateTable('preflight_checks')
    .set({
      accommodation: sql`accommodation || ${JSON.stringify({ confirmed: true })}::jsonb`,
    })
    .where('assignment_id', '=', assignmentId)
    .where('user_id', '=', userId)
    .where('tenant_id', '=', getTenantId())
    .execute()
    .catch(() => null);

  return { ok: true, confirmedAt: confirmed?.confirmedAt || new Date().toISOString() };
}

// ═══════════════════════════════════════════════════════════════════
// PREFLIGHT STATUS (latest persisted contract)
// ═══════════════════════════════════════════════════════════════════

/**
 * Get the latest persisted preflight row for a student + assignment.
 *
 * @param {number} assignmentId
 * @param {number} userId
 * @returns {Promise<Object|null>}
 */
export async function getPreflightStatus(assignmentId, userId) {
  const db = await getDb();
  if (!db) return null;
  try {
    return await db.selectFrom('preflight_checks')
      .where('assignment_id', '=', assignmentId)
      .where('user_id', '=', userId)
      .where('tenant_id', '=', getTenantId())
      .orderBy('created_at', 'desc')
      .limit(1)
      .selectAll()
      .executeTakeFirst() || null;
  } catch (_) {
    return null;
  }
}

/**
 * List all preflight rows for a student (history).
 *
 * @param {number} userId
 * @param {number} [limit]
 * @returns {Promise<Array<Object>>}
 */
export async function listStudentPreflights(userId, { limit = 50 } = {}) {
  const db = await getDb();
  if (!db) return [];
  try {
    return await db.selectFrom('preflight_checks')
      .where('user_id', '=', userId)
      .where('tenant_id', '=', getTenantId())
      .orderBy('created_at', 'desc')
      .limit(limit)
      .selectAll()
      .execute();
  } catch (_) {
    return [];
  }
}
