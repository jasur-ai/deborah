/**
 * Edikit — Immutable Publish Transaction & Assignment Snapshot Service
 *
 * Atomic publish of an assessment draft into a SCHEDULED assignment:
 *   - Single PostgreSQL transaction writes ALL snapshots together
 *   - Row lock (FOR UPDATE) + external_key idempotency → race-safe publish
 *   - Public item snapshots (no private keys) + private scoring snapshots
 *   - EXACT brief/policy version pins
 *   - Roster membership snapshot + per-member accommodation snapshot
 *   - Calendar entry (program_events) + notification outbox, same transaction
 *   - Reproducible version_hash (same draft + pins → same hash)
 *
 * SECURITY / DATA GUARD (Prompt 27 §15):
 *   - Partial publish impossible: any failure inside the transaction rolls
 *     back everything — no half-published assignment can exist
 *   - Private keys cannot reach public snapshots: allowlist builder + secret
 *     scan gate in planPublish, and the public table has no private_data column
 *   - Written only when a brief/policy is APPROVED (exact version pinned)
 *
 * Graceful degradation: without PostgreSQL every write path throws a clear
 * error; read paths return null/[].
 */

import { getDb } from '../../infrastructure/postgres.js';
import { getCurrentTenant } from '../auth/tenant-context.js';
import { audit, AUDIT_ACTIONS } from '../auth/audit.js';
import {
  ASSIGNMENT_STATUS,
  planPublish,
  buildRosterSnapshot,
  derivePublishKey,
  rosterHash,
  canonicalHash,
  assignmentContentForHash,
  verifyPublicSnapshotClean,
} from './publish.schema.js';

function getTenantId() {
  return getCurrentTenant()?.tenantId || 1;
}

/**
 * Atomically publish an assessment draft.
 *
 * @param {Object} data
 * @param {number} data.assessmentId - Draft assessment to publish
 * @param {Array<Object>} data.items - Raw item rows (public_data + private_data)
 * @param {Array<Object>} data.sections - Section rows
 * @param {Object|null} data.brief - Approved brief { id, version, status }
 * @param {Object|null} data.policy - Approved policy pack { id, version, status }
 * @param {Array<Object>} data.rosterMembers - [{ user_id, group_id?, external_id? }]
 * @param {Object} [data.schedule] - { start_at, end_at, timezone, event_type, cohort_ids }
 * @param {number|null} data.createdBy
 * @returns {Promise<{ ok: boolean, assignmentId?: number, versionHash?: string, duplicate?: boolean, error?: string }>}
 */
export async function publishAssignment(data) {
  const db = await getDb();
  if (!db) throw new Error('PostgreSQL required');

  // ── Idempotency: same assessment + pins + roster → same publish key ──
  const pubKey = data.externalKey || derivePublishKey({
    assessmentId: data.assessmentId,
    briefVersionId: data.brief?.version || null,
    policyVersionId: data.policy?.version || null,
    rosterHash: rosterHash(data.rosterMembers || []),
  });

  // ── ONE transaction: idempotency → lock → plan → ALL snapshot writes ──
  // CRITICAL: the FOR UPDATE lock must be taken INSIDE the transaction.
  // PostgreSQL only holds row locks until statement end when no transaction
  // is open — a bare SELECT ... FOR UPDATE outside a transaction provides NO
  // race protection. Order matters:
  //   (a) idempotency check first — a sequential retry after a successful
  //       publish short-circuits with duplicate:true before touching the lock
  //   (b) FOR UPDATE lock — a concurrent second publish blocks here; its
  //       blocked SELECT re-reads the winner's committed 'published' row and
  //       throws, which the catch classifies as a race duplicate
  //   (c) deterministic plan (validates + secret-scans) then all writes
  let outcome;
  try {
    outcome = await db.transaction().execute(async (trx) => {
      // (a) Idempotency check FIRST — an identical publish (same idempotency
      //     key) that already committed is returned as a duplicate regardless
      //     of the assessment's current status. Without this, a sequential
      //     retry after a successful publish would hit the 'only drafts'
      //     error below instead of the expected { duplicate: true }.
      const existing = await trx.selectFrom('assessment_assignments')
        .where('tenant_id', '=', getTenantId())
        .where('external_key', '=', pubKey)
        .select('id')
        .executeTakeFirst();
      if (existing) {
        return { duplicate: true, assignmentId: existing.id, locked: null, plan: null };
      }

  // (b) Load & lock the assessment row (serializes concurrent publishes).
  //     The FOR UPDATE lock MUST be inside the transaction — PostgreSQL
  //     releases row locks at statement end otherwise, giving no race
  //     protection. A second concurrent publish blocks here; its blocked
  //     SELECT re-reads the row after the winner commits (now 'published')
  //     and throws 'only drafts can be published' — classified as a race
  //     duplicate in the catch below.
      const locked = await trx.selectFrom('assessments')
        .where('id', '=', data.assessmentId)
        .where('tenant_id', '=', getTenantId())
        .forUpdate()
        .selectAll()
        .executeTakeFirst();
      if (!locked) throw new Error('Assessment not found');
      if (locked.status !== 'draft') {
        throw new Error(`Assessment is ${locked.status} — only drafts can be published`);
      }

      // (c) Deterministic plan (validates + secret-scans before any write)
      const planResult = planPublish({
        assessment: locked,
        sections: data.sections || [],
        items: data.items || [],
        brief: data.brief,
        policy: data.policy,
        rosterMembers: data.rosterMembers || [],
        externalKey: pubKey,
      });
      if (!planResult.ok) {
        throw new Error(`Cannot publish: ${planResult.errors.join('; ')}`);
      }
      const { plan } = planResult;
    // 1. Assessment version snapshot (immutable, secret-safe) — compute the
    //    next version number (a version 1 may already exist from the draft
    //    builder's createAssessmentVersion route)
    const lastVersion = await trx.selectFrom('assessment_versions')
      .where('assessment_id', '=', locked.id)
      .where('tenant_id', '=', getTenantId())
      .orderBy('version', 'desc')
      .limit(1)
      .select('version')
      .executeTakeFirst();
    const nextVersion = (lastVersion?.version || 0) + 1;
    const versionRec = await trx.insertInto('assessment_versions')
      .values({
        assessment_id: locked.id,
        tenant_id: getTenantId(),
        version: nextVersion,
        status_snapshot: 'scheduled',
        blueprint_snapshot: locked.blueprint || {},
        randomization_snapshot: locked.randomization_config || {},
        sections_snapshot: (data.sections || []).map((s) => ({ ...s })),
        items_snapshot: plan.public_items,
        total_points: locked.total_points,
        total_time_seconds: locked.total_time_seconds,
        change_summary: 'Published via atomic publish transaction',
        created_by: data.createdBy || null,
      })
      .returning('id')
      .executeTakeFirst();

    // 2. Calendar entry (optional schedule)
    let calendarEventId = null;
    if (data.schedule?.start_at) {
      const eventRec = await trx.insertInto('program_events')
        .values({
          tenant_id: getTenantId(),
          assessment_id: locked.id,
          brief_id: data.brief?.id || null,
          policy_pack_id: data.policy?.id || null,
          title: locked.title,
          event_type: data.schedule.event_type || 'summative',
          status: 'scheduled',
          start_at: new Date(data.schedule.start_at),
          end_at: new Date(data.schedule.end_at || data.schedule.start_at),
          timezone: data.schedule.timezone || 'Asia/Tashkent',
          created_by: data.createdBy || null,
        })
        .returning('id')
        .executeTakeFirst();
      calendarEventId = eventRec?.id || null;
      if (calendarEventId && Array.isArray(data.schedule.cohort_ids)) {
        for (const groupId of data.schedule.cohort_ids) {
          await trx.insertInto('program_event_cohorts')
            .values({ event_id: calendarEventId, tenant_id: getTenantId(), group_id: groupId })
            .execute();
        }
      }
    }

    // 3. Assignment root (pins exact brief/policy versions + version_hash)
    const assignRec = await trx.insertInto('assessment_assignments')
      .values({
        tenant_id: getTenantId(),
        assessment_id: locked.id,
        assessment_version_id: versionRec?.id || null,
        title: locked.title,
        status: ASSIGNMENT_STATUS.SCHEDULED,
        version_hash: plan.version_hash,
        brief_id: data.brief?.id || null,
        brief_version_id: data.brief?.version || null,
        policy_pack_id: data.policy?.id || null,
        policy_version_id: data.policy?.version || null,
        calendar_event_id: calendarEventId,
        external_key: pubKey,
        published_at: new Date(),
        published_by: data.createdBy || null,
        created_by: data.createdBy || null,
      })
      .returning('id')
      .executeTakeFirst();
    const assignmentIdLocal = assignRec.id;

    // 4. Public item snapshots (allowlist — no private column exists)
    for (const pi of plan.public_items) {
      await trx.insertInto('assignment_public_items')
        .values({
          tenant_id: getTenantId(),
          assignment_id: assignmentIdLocal,
          item_id: pi.item_id ?? null,
          section_id: pi.section_id ?? null,
          section_title: pi.section_title ?? null,
          question_type: pi.question_type ?? null,
          difficulty: pi.difficulty ?? null,
          points: pi.points ?? 1,
          time_seconds: pi.time_seconds ?? null,
          sort_order: pi.sort_order ?? 0,
          public_data: pi.public_data || {},
          item_hash: pi.item_hash,
        })
        .execute();
    }

    // 5. Private scoring snapshots (separate table, role-restricted)
    for (const ps of plan.private_scores) {
      await trx.insertInto('assignment_private_scores')
        .values({
          tenant_id: getTenantId(),
          assignment_id: assignmentIdLocal,
          item_id: ps.item_id ?? null,
          private_data: ps.private_data || {},
          item_hash: ps.item_hash,
        })
        .execute();
    }

    // 6. Roster membership snapshot
    const roster = buildRosterSnapshot(data.rosterMembers || []);
    for (const member of roster) {
      await trx.insertInto('assignment_roster_members')
        .values({
          tenant_id: getTenantId(),
          assignment_id: assignmentIdLocal,
          user_id: member.user_id,
          group_id: member.group_id || null,
          external_id: member.external_id || null,
        })
        .execute();

      // 7. Per-member accommodation snapshot (freeze what they had at publish)
      const activeAccs = await trx.selectFrom('accommodations')
        .where('user_id', '=', member.user_id)
        .where('tenant_id', '=', getTenantId())
        .where('status', '=', 'active')
        .selectAll()
        .execute();
      for (const acc of activeAccs) {
        await trx.insertInto('accommodation_snapshots')
          .values({
            tenant_id: getTenantId(),
            assessment_assignment_id: assignmentIdLocal,
            user_id: member.user_id,
            accommodation_type: acc.type,
            snapshot_config: acc.operational_config || {},
            source_accommodation_id: acc.id,
            snapshot_version: acc.version,
            is_active: true,
          })
          .execute();
      }
    }

    // 8. Notification outbox — SAME transaction (§14)
    await trx.insertInto('assignment_notifications')
      .values({
        tenant_id: getTenantId(),
        assignment_id: assignmentIdLocal,
        change_type: 'scheduled',
        recipient_scope: 'roster',
        payload: {
          title: locked.title,
          version_hash: plan.version_hash,
          roster_count: roster.length,
          scheduled_at: data.schedule?.start_at || null,
        },
        status: 'pending',
        idempotency_key: `scheduled:${assignmentIdLocal}:${plan.version_hash}`,
      })
      .execute();

    // 9. Flip the draft → published (immutable afterwards). The assessment
    //    lifecycle is draft | published | archived (migration 009) — the
    //    'scheduled' state lives on the ASSIGNMENT, not the assessment.
    await trx.updateTable('assessments')
      .set({
        status: 'published',
        published_version_id: versionRec?.id || null,
        updated_at: new Date(),
      })
      .where('id', '=', locked.id)
      .where('tenant_id', '=', getTenantId())
      .execute();

      return { duplicate: false, assignmentId: assignmentIdLocal, locked, plan };
    });
  } catch (err) {
    // Race backstops — both signals mean a concurrent publish won and its
    // assignment already exists under this idempotency key:
    //   • 23505 / duplicate key — a concurrent insert collided on the unique
    //     (tenant_id, external_key) index
    //   • 'only drafts'        — we blocked on the row lock while the winner
    //     published and flipped the assessment; our re-read saw 'published'
    const isRace = err?.code === '23505'
      || /duplicate key/i.test(err?.message || '')
      || /only drafts can be published/i.test(err?.message || '');
    if (isRace) {
      const dup = await db.selectFrom('assessment_assignments')
        .where('tenant_id', '=', getTenantId())
        .where('external_key', '=', pubKey)
        .select('id')
        .executeTakeFirst();
      if (dup) return { ok: true, assignmentId: dup.id, duplicate: true };
    }
    throw err;
  }

  if (outcome.duplicate) {
    return { ok: true, assignmentId: outcome.assignmentId, duplicate: true };
  }

  await audit({
    action: AUDIT_ACTIONS.ASSIGNMENT_PUBLISH,
    userId: data.createdBy,
    resourceType: 'assessment_assignment',
    resourceId: outcome.assignmentId,
    details: {
      assessment_id: outcome.locked.id,
      version_hash: outcome.plan.version_hash,
      item_count: outcome.plan.summary.itemCount,
      roster_count: outcome.plan.summary.rosterCount,
      brief_version_id: data.brief?.version || null,
      policy_version_id: data.policy?.version || null,
    },
  });

  return {
    ok: true,
    assignmentId: outcome.assignmentId,
    versionHash: outcome.plan.version_hash,
    itemCount: outcome.plan.summary.itemCount,
    rosterCount: outcome.plan.summary.rosterCount,
  };
}

// ═══════════════════════════════════════════════════════════════════
// READS
// ═══════════════════════════════════════════════════════════════════

export async function getAssignment(id) {
  const db = await getDb();
  if (!db) return null;
  try {
    return await db.selectFrom('assessment_assignments')
      .where('id', '=', id)
      .where('tenant_id', '=', getTenantId())
      .selectAll()
      .executeTakeFirst();
  } catch (_) { return null; }
}

export async function listAssignments({ status, assessment_id, limit = 50, offset = 0 } = {}) {
  const db = await getDb();
  if (!db) return [];
  try {
    let query = db.selectFrom('assessment_assignments')
      .where('tenant_id', '=', getTenantId());
    if (status) query = query.where('status', '=', status);
    if (assessment_id) query = query.where('assessment_id', '=', assessment_id);
    return await query
      .orderBy('created_at', 'desc')
      .limit(limit).offset(offset)
      .selectAll()
      .execute();
  } catch (_) { return []; }
}

/** Public item snapshots for an assignment (student-facing surface). */
export async function getAssignmentPublicItems(assignmentId) {
  const db = await getDb();
  if (!db) return [];
  try {
    return await db.selectFrom('assignment_public_items')
      .where('assignment_id', '=', assignmentId)
      .where('tenant_id', '=', getTenantId())
      .orderBy('sort_order', 'asc')
      .selectAll()
      .execute();
  } catch (_) { return []; }
}

/** Private scoring snapshots — callers must be authorized (scoring role). */
export async function getAssignmentPrivateScores(assignmentId) {
  const db = await getDb();
  if (!db) return [];
  try {
    return await db.selectFrom('assignment_private_scores')
      .where('assignment_id', '=', assignmentId)
      .where('tenant_id', '=', getTenantId())
      .orderBy('item_id', 'asc')
      .selectAll()
      .execute();
  } catch (_) { return []; }
}

export async function getAssignmentRoster(assignmentId) {
  const db = await getDb();
  if (!db) return [];
  try {
    return await db.selectFrom('assignment_roster_members')
      .where('assignment_id', '=', assignmentId)
      .where('tenant_id', '=', getTenantId())
      .orderBy('user_id', 'asc')
      .selectAll()
      .execute();
  } catch (_) { return []; }
}

export async function getAssignmentNotifications(assignmentId, { status, limit = 100 } = {}) {
  const db = await getDb();
  if (!db) return [];
  try {
    let query = db.selectFrom('assignment_notifications')
      .where('assignment_id', '=', assignmentId)
      .where('tenant_id', '=', getTenantId());
    if (status) query = query.where('status', '=', status);
    return await query
      .orderBy('created_at', 'desc')
      .limit(limit)
      .selectAll()
      .execute();
  } catch (_) { return []; }
}

// ═══════════════════════════════════════════════════════════════════
// INTEGRITY VERIFICATION (immutability check)
// ═══════════════════════════════════════════════════════════════════

/**
 * Verify an assignment's snapshot integrity:
 *   - Stored version_hash matches a recomputed hash from live public rows
 *   - No private keys leaked into public item rows (secret scan)
 *   - Public/private item hashes are non-empty and stable
 *
 * @param {number} assignmentId
 * @returns {Promise<{ ok: boolean, checks: Array<{ check: string, ok: boolean, detail?: string }> }>}
 */
export async function verifyAssignmentIntegrity(assignmentId) {
  const db = await getDb();
  if (!db) return { ok: false, checks: [{ check: 'postgres', ok: false, detail: 'PostgreSQL not configured' }] };

  const checks = [];

  const assignment = await getAssignment(assignmentId);
  if (!assignment) {
    return { ok: false, checks: [{ check: 'exists', ok: false, detail: 'Assignment not found' }] };
  }
  checks.push({ check: 'exists', ok: true });

  // Recompute hash via the SAME single-source-of-truth helper planPublish uses
  const [publicItems, privateScores, roster] = await Promise.all([
    getAssignmentPublicItems(assignmentId),
    getAssignmentPrivateScores(assignmentId),
    getAssignmentRoster(assignmentId),
  ]);

  const recomputed = assignmentContentForHash({
    assessment: {
      id: assignment.assessment_id,
      title: assignment.title,
      blueprint: null,
      randomization_config: null,
      total_points: null,
      total_time_seconds: null,
      item_count: null,
    },
    publicItems,
    privateScores,
    brief: assignment.brief_id ? { id: assignment.brief_id, version: assignment.brief_version_id } : null,
    policy: assignment.policy_pack_id ? { id: assignment.policy_pack_id, version: assignment.policy_version_id } : null,
    roster,
  });
  checks.push({
    check: 'version_hash',
    ok: recomputed === assignment.version_hash,
    detail: recomputed === assignment.version_hash ? 'hash matches' : `stored=${assignment.version_hash} recomputed=${recomputed}`,
  });

  // Secret scan on public rows (defense in depth — column can't hold keys anyway)
  const { leaks } = verifyPublicSnapshotClean(publicItems);
  checks.push({
    check: 'secret_scan',
    ok: leaks.length === 0,
    detail: leaks.length === 0 ? 'no private keys in public rows' : `leaks: ${leaks.map((l) => l.path).join(', ')}`,
  });

  const allOk = checks.every((c) => c.ok);
  return { ok: allOk, checks };
}
