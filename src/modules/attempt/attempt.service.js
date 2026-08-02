/**
 * Edikit — Attempt Lease, Identity Step & Server Timer Service
 *
 * Prompt 30 (Phase D #1) — secure attempt start for an authorized student:
 *   - startAttempt: single-writer, server-timed attempt start.
 *       Gates (in order, all required):
 *         1. Assignment must exist (published snapshot)
 *         2. Student MUST be in the PUBLISHED roster snapshot (Prompt 28 §24 —
 *            never the live roster; no silent re-sync)
 *         3. A preflight MUST exist and be eligible (Prompt 28 contract)
 *         4. Identity step-up: achieved identity level must satisfy the policy
 *            security profile requirement (research.md §30)
 *         5. Parallel-session policy: at most one ACTIVE lease per
 *            (assignment, user) — the partial UNIQUE index rejects a
 *            concurrent second start atomically (23505)
 *       Then, in ONE transaction: create attempt (status ready, server
 *       started_at/ends_at), record device attestation, acquire the active
 *       lease. Returns the PUBLIC content package (no private keys).
 *   - transitionAttempt: ready → in_progress → submitted|terminated.
 *   - getAttemptPublicContent: student-facing item surface only.
 *
 * SECURITY / DATA GUARD (Prompt 30 §15):
 *   - Client clock, display timer or join code is NEVER authoritative —
 *     started_at/ends_at are computed on the server at start time.
 *   - The public content package is rebuilt from assignment_public_items
 *     (a table with NO private_data column) — answer keys structurally
 *     impossible to leak.
 *   - Write paths are tenant-scoped, authorized, validated and idempotent
 *     (external_key per assignment+user+day).
 *
 * Graceful degradation: without PostgreSQL, read paths return null/[] and
 * write paths throw a clear 'PostgreSQL required' error.
 */

import { getDb } from '../../infrastructure/postgres.js';
import { getCurrentTenant } from '../auth/tenant-context.js';
import { audit, AUDIT_ACTIONS } from '../auth/audit.js';
import {
  getAssignment,
  getAssignmentRoster,
  getAssignmentPublicItems,
} from '../publish/publish.service.js';
import { getPreflightStatus } from '../preflight/preflight.service.js';
import { getEffectiveOperationalConfig } from '../accommodation/accommodation.service.js';
import {
  checkRosterMembership,
} from '../preflight/preflight.schema.js';
import {
  ATTEMPT_STATUS,
  ATTEMPT_STATUS_TRANSITIONS,
  requiredIdentityLevelForPolicy,
  identityLevelSatisfied,
  computeAttemptTiming,
  extractExtraTimeMinutes,
  buildPublicContentPackage,
  verifyContentPackageClean,
  evaluateParallelSessionPolicy,
  deriveAttemptKey,
  computeAttemptStartEligibility,
  DEFAULT_IDENTITY_LEVEL,
} from './attempt.schema.js';

function getTenantId() {
  return getCurrentTenant()?.tenantId || 1;
}

/**
 * Shared duplicate-response shape: the STORED attempt row mapped to the
 * idempotent start response. Used by the pre-transaction idempotency check
 * and the 23505 race backstop so both paths return identical contracts.
 */
function toDuplicateResponse(row) {
  return {
    ok: true,
    attemptId: row.id,
    duplicate: true,
    status: row.status,
    startedAt: row.started_at,
    endsAt: row.ends_at,
    versionHash: row.version_hash,
    content_package: row.content_package || {},
  };
}

/** Load the policy pack pinned to an assignment (for identity requirement). */
async function loadPinnedPolicy(db, policyPackId, policyVersionId) {
  if (!policyPackId) return null;
  try {
    if (policyVersionId) {
      const byId = await db.selectFrom('policy_pack_versions')
        .where('id', '=', policyVersionId)
        .where('policy_pack_id', '=', policyPackId)
        .where('tenant_id', '=', getTenantId())
        .select(['policy_snapshot'])
        .executeTakeFirst();
      if (byId) return { security: byId.policy_snapshot?.security || {} };
    }
    const pack = await db.selectFrom('policy_packs')
      .where('id', '=', policyPackId)
      .where('tenant_id', '=', getTenantId())
      .select(['policy'])
      .executeTakeFirst();
    return pack ? { security: pack.policy?.security || {} } : null;
  } catch (_) {
    return null;
  }
}

/** Load the calendar event window for an assignment (availability). */
async function loadCalendarWindow(db, calendarEventId) {
  if (!calendarEventId) return { start_at: null, end_at: null };
  try {
    return await db.selectFrom('program_events')
      .where('id', '=', calendarEventId)
      .where('tenant_id', '=', getTenantId())
      .select(['start_at', 'end_at'])
      .executeTakeFirst() || { start_at: null, end_at: null };
  } catch (_) {
    return { start_at: null, end_at: null };
  }
}

/**
 * Start a single-writer, server-timed attempt for an authorized student.
 *
 * @param {Object} params
 * @param {number} params.assignmentId
 * @param {number} params.userId
 * @param {string|null} [params.identityLevel] - achieved identity level (none|password|google|passkey)
 * @param {Object} [params.clientInfo] - { userAgent, screenWidth, screenHeight, online, connectionType }
 * @param {Object} [params.deviceAttestation] - { cameraAvailable, sebPresent }
 * @param {Object} [params.opts] - { now } for deterministic tests
 * @returns {Promise<Object>}
 */
export async function startAttempt({ assignmentId, userId, identityLevel = null, clientInfo = {}, deviceAttestation = {}, opts = {} } = {}) {
  const db = await getDb();
  if (!db) throw new Error('PostgreSQL required');

  const assignment = await getAssignment(assignmentId);
  if (!assignment) return { ok: false, code: 'assignment_not_found' };

  // ── Gate 2: published roster snapshot membership ──
  const roster = await getAssignmentRoster(assignmentId);
  const rosterCheck = checkRosterMembership(roster, userId);
  if (!rosterCheck.in_snapshot) {
    // 404 semantics — the student must not learn the assignment exists
    return { ok: false, code: 'not_assigned' };
  }

  // ── Gate 3: preflight must exist and be eligible ──
  const preflight = await getPreflightStatus(assignmentId, userId);
  const preflightExists = !!preflight;
  const preflightEligible = preflight?.eligible === true;

  // ── Gate 4: identity step-up from the pinned policy ──
  const policy = await loadPinnedPolicy(db, assignment.policy_pack_id, assignment.policy_version_id);
  const identityRequired = requiredIdentityLevelForPolicy(policy);

  // ── Gate 5: parallel-session policy (existing active leases) ──
  const activeLeases = await db.selectFrom('attempt_leases')
    .where('tenant_id', '=', getTenantId())
    .where('assignment_id', '=', assignmentId)
    .where('user_id', '=', userId)
    .where('status', '=', 'active')
    .selectAll()
    .execute()
    .catch(() => []);
  const parallel = evaluateParallelSessionPolicy(activeLeases);

  const eligibility = computeAttemptStartEligibility({
    identityRequired,
    identityAchieved: identityLevel,
    preflightExists,
    preflightEligible,
    parallelAllowed: parallel.allowed,
  });

  // ── Idempotency: same assignment + user + day → existing attempt ──
  // Checked BEFORE the parallel gate so a same-day re-start of an existing
  // attempt returns the stored attempt (duplicate) instead of a misleading
  // parallel_session_denied blocker.
  const externalKey = deriveAttemptKey(assignmentId, userId, opts.now || Date.now());
  const existing = await db.selectFrom('attempts')
    .where('tenant_id', '=', getTenantId())
    .where('external_key', '=', externalKey)
    .selectAll()
    .executeTakeFirst()
    .catch(() => null);
  if (existing) {
    return toDuplicateResponse(existing);
  }

  if (!eligibility.canStart) {
    return { ok: false, code: 'blocked', blockers: eligibility.blockers };
  }

  // ── Server-authoritative timing + accommodation extra time ──
  // Base duration derives from the calendar availability window span (server
  // clock only); extra time comes from the REAL accommodation operational
  // config (getEffectiveOperationalConfig — max across the student's active
  // accommodation snapshots), NOT from any client-supplied value.
  const [calendarWindow, publicItems, accommodationConfig] = await Promise.all([
    loadCalendarWindow(db, assignment.calendar_event_id),
    getAssignmentPublicItems(assignmentId),
    getEffectiveOperationalConfig(assignmentId, userId).catch(() => ({})),
  ]);
  const baseMinutes = baseDurationFromWindow(calendarWindow);
  const extraMinutes = extractExtraTimeMinutes(accommodationConfig);
  const timing = computeAttemptTiming({
    baseMinutes,
    extraMinutes,
    now: opts.now || Date.now(),
  });

  const contentPackage = buildPublicContentPackage(assignment, publicItems);
  const cleanCheck = verifyContentPackageClean(contentPackage);
  if (!cleanCheck.ok) {
    // Publish gate already guarantees this — defensive backstop only.
    return { ok: false, code: 'content_secret_leak', leaks: cleanCheck.leaks };
  }

  // ── Atomic start: attempt + device + lease in ONE transaction ──
  let inserted = null;
  let leaseId = null;
  try {
    await db.transaction().execute(async (tx) => {
      inserted = await tx.insertInto('attempts')
        .values({
          tenant_id: getTenantId(),
          assignment_id: assignmentId,
          user_id: userId,
          external_key: externalKey,
          status: ATTEMPT_STATUS.READY,
          version_hash: assignment.version_hash || null,
          base_duration_minutes: timing.baseMinutes,
          extra_time_minutes: timing.extraMinutes,
          total_minutes: timing.totalMinutes,
          identity_level_required: identityRequired,
          identity_level_achieved: identityLevel || DEFAULT_IDENTITY_LEVEL,
          started_at: timing.startedAt,
          ends_at: timing.endsAt,
          content_package: contentPackage,
          client_info: clientInfo,
        })
        .returning('id')
        .executeTakeFirst();

      await tx.insertInto('attempt_devices')
        .values({
          tenant_id: getTenantId(),
          attempt_id: inserted.id,
          user_agent: clientInfo.userAgent || null,
          screen_width: clientInfo.screenWidth || null,
          screen_height: clientInfo.screenHeight || null,
          online: clientInfo.online ?? null,
          connection_type: clientInfo.connectionType || null,
          camera_available: deviceAttestation.cameraAvailable ?? null,
          seb_present: deviceAttestation.sebPresent ?? null,
        })
        .execute();

      const lease = await tx.insertInto('attempt_leases')
        .values({
          tenant_id: getTenantId(),
          assignment_id: assignmentId,
          user_id: userId,
          attempt_id: inserted.id,
          status: 'active',
          expires_at: timing.endsAt,
        })
        .returning('id')
        .executeTakeFirst();
      leaseId = lease.id;
    });
  } catch (err) {
    // Unique violation — TWO possible sources, distinguished by re-lookup:
    //   1. Idempotency race: two concurrent SAME-DAY starts both passed the
    //      pre-transaction external_key check → the loser hits
    //      uq_attempt_external_key. Re-lookup by external_key and return the
    //      winner's attempt as {duplicate:true} (the stored contract), the
    //      same pattern the preflight module uses (Prompt 28).
    //   2. Parallel-session race: two concurrent starts for DIFFERENT days
    //      (no shared external_key) → the loser hits the partial UNIQUE index
    //      uq_attempt_active_lease. Only then is it parallel_session_denied.
    if (err?.code === '23505' || /duplicate key/i.test(err?.message || '')) {
      const winner = await db.selectFrom('attempts')
        .where('tenant_id', '=', getTenantId())
        .where('external_key', '=', externalKey)
        .selectAll()
        .executeTakeFirst()
        .catch(() => null);
      if (winner) {
        return toDuplicateResponse(winner);
      }
      return { ok: false, code: 'parallel_session_denied', blockers: [{ code: 'parallel_session_denied', message: 'Faol attempt allaqachon mavjud' }] };
    }
    throw err;
  }

  await audit({
    action: AUDIT_ACTIONS.ATTEMPT_START,
    userId,
    resourceType: 'attempt',
    resourceId: inserted?.id ?? null,
    details: {
      assignment_id: assignmentId,
      status: ATTEMPT_STATUS.READY,
      identity_required: identityRequired,
      identity_achieved: identityLevel || DEFAULT_IDENTITY_LEVEL,
      total_minutes: timing.totalMinutes,
      extra_time_minutes: timing.extraMinutes,
      lease_id: leaseId,
      version_hash: assignment.version_hash || null,
    },
  });

  return {
    ok: true,
    attemptId: inserted?.id ?? null,
    duplicate: false,
    status: ATTEMPT_STATUS.READY,
    startedAt: timing.startedAt.toISOString(),
    endsAt: timing.endsAt ? timing.endsAt.toISOString() : null,
    totalMinutes: timing.totalMinutes,
    extraTimeMinutes: timing.extraMinutes,
    identityRequired,
    versionHash: assignment.version_hash || null,
    content_package: contentPackage,
    leaseId,
  };
}

/** Derive base duration from the calendar window span (server clock only). */
function baseDurationFromWindow(window) {
  if (!window?.start_at || !window?.end_at) return 0;
  const start = new Date(window.start_at).getTime();
  const end = new Date(window.end_at).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return 0;
  return Math.round((end - start) / 60000);
}

/**
 * Transition an attempt through its lifecycle.
 *
 * @param {number} attemptId
 * @param {string} to - in_progress | submitted | terminated
 * @param {number} userId - must own the attempt
 * @returns {Promise<Object>}
 */
export async function transitionAttempt(attemptId, to, userId) {
  const db = await getDb();
  if (!db) throw new Error('PostgreSQL required');

  const attempt = await db.selectFrom('attempts')
    .where('id', '=', attemptId)
    .where('tenant_id', '=', getTenantId())
    .selectAll()
    .executeTakeFirst();
  if (!attempt) return { ok: false, code: 'not_found' };
  if (Number(attempt.user_id) !== Number(userId)) {
    return { ok: false, code: 'forbidden' };
  }

  const allowed = ATTEMPT_STATUS_TRANSITIONS[attempt.status] || [];
  if (!allowed.includes(to)) {
    return { ok: false, code: 'invalid_transition', from: attempt.status, to };
  }

  const updates = { status: to, updated_at: new Date() };
  if (to === ATTEMPT_STATUS.SUBMITTED) updates.submitted_at = new Date();

  await db.updateTable('attempts')
    .set(updates)
    .where('id', '=', attemptId)
    .where('tenant_id', '=', getTenantId())
    .execute();

  // Release the single-writer lease on terminal transitions
  if (to === ATTEMPT_STATUS.SUBMITTED || to === ATTEMPT_STATUS.TERMINATED) {
    await db.updateTable('attempt_leases')
      .set({ status: 'released', released_at: new Date() })
      .where('attempt_id', '=', attemptId)
      .where('status', '=', 'active')
      .where('tenant_id', '=', getTenantId())
      .execute()
      .catch(() => null);
  }

  await audit({
    action: AUDIT_ACTIONS.ATTEMPT_TRANSITION,
    userId,
    resourceType: 'attempt',
    resourceId: attemptId,
    details: { from: attempt.status, to, assignment_id: attempt.assignment_id },
  });

  return { ok: true, from: attempt.status, to, attemptId };
}

/**
 * Get an attempt the user owns (with public content package).
 *
 * @param {number} attemptId
 * @param {number} userId
 * @returns {Promise<Object|null>}
 */
export async function getAttempt(attemptId, userId) {
  const db = await getDb();
  if (!db) return null;
  try {
    const row = await db.selectFrom('attempts')
      .where('id', '=', attemptId)
      .where('tenant_id', '=', getTenantId())
      .selectAll()
      .executeTakeFirst();
    if (!row) return null;
    if (Number(row.user_id) !== Number(userId)) return null;
    return row;
  } catch (_) {
    return null;
  }
}

/**
 * Public content package for an attempt (student-facing only).
 *
 * @param {number} attemptId
 * @param {number} userId
 * @returns {Promise<Object|null>}
 */
export async function getAttemptPublicContent(attemptId, userId) {
  const attempt = await getAttempt(attemptId, userId);
  if (!attempt) return null;
  return attempt.content_package || {};
}

/**
 * List a student's attempts for an assignment (history).
 *
 * @param {number} assignmentId
 * @param {number} userId
 * @returns {Promise<Array<Object>>}
 */
export async function listAttempts(assignmentId, userId) {
  const db = await getDb();
  if (!db) return [];
  try {
    return await db.selectFrom('attempts')
      .where('assignment_id', '=', assignmentId)
      .where('user_id', '=', userId)
      .where('tenant_id', '=', getTenantId())
      .orderBy('created_at', 'desc')
      .selectAll()
      .execute();
  } catch (_) {
    return [];
  }
}
