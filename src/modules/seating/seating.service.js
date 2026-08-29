/**
 * Deborah — Seat, Proctor, Hall Ticket & Check-in Service
 *
 * DB layer for Prompt 40:
 *   - Room seat-map CRUD (room_seat_maps, versioned)
 *   - Seat allocation: run → per-student seat assignments (random /
 *     variant-separated / accommodation-aware, deterministic seed)
 *   - Proctor duty allocation (no same-period clash, workload fairness)
 *   - Hall ticket: signed token + acknowledgement (hall_ticket_acks)
 *   - Offline check-in journal (checkin_journal, client_seq idempotent)
 *   - Reseat / replacement audit (reseat_audit, reason CODES only)
 *   - Register exports (room / proctor) — answer-key-free
 *
 * SECURITY / DATA GUARD (Prompt 40 §15):
 *   - Hall-ticket QR payload answer key yoki raw sensitive reason saqlamaydi.
 *   - Reseat reason faqat kodlar; raw rationale hech qachon saqlanmaydi.
 *   - Har bir query/mutation tenant-scoped; write'lar client_seq idempotent.
 *
 * Graceful degradation: without PostgreSQL write paths throw a clear error,
 * read paths return null/[] (consistent with the rest of the platform).
 */

import { getDb } from '../../infrastructure/postgres.js';
import { getCurrentTenant } from '../auth/tenant-context.js';
import { audit, AUDIT_ACTIONS } from '../auth/audit.js';
import {
  validateSeatMapLayout,
  checkSeatCapacity,
  allocateSeats,
  allocateProctorDuties as allocateProctorDutiesPure,
  buildHallTicketPayload,
  signHallTicketToken,
  buildCheckinEntry,
  highestContiguousSeq,
  reconcileCheckinJournal,
  buildReseatAuditEntry,
  MIN_SIGNING_KEY_LENGTH,
} from './seating.schema.js';

/** PostgreSQL unique-violation error code (23505). */
const PG_UNIQUE_VIOLATION = '23505';

function getTenantId() {
  return getCurrentTenant()?.tenantId || 1;
}

/**
 * HMAC signing key for hall tickets. Derived from SESSION_SECRET so it is
 * stable per deployment. Falls back to a fixed dev key (tests/CI).
 */
function signingKey() {
  const secret = process.env.SESSION_SECRET || 'deborah-dev-secret';
  return secret.length >= MIN_SIGNING_KEY_LENGTH ? secret : secret.padEnd(MIN_SIGNING_KEY_LENGTH, 'x');
}

// ═══════════════════════════════════════════════════════════════════
// ROOM SEAT-MAP CRUD
// ═══════════════════════════════════════════════════════════════════

/**
 * Upsert a room seat-map (new version).
 */
export async function upsertSeatMap({ roomId, layout = {}, userId = null } = {}) {
  const db = await getDb();
  if (!db) throw new Error('PostgreSQL required');

  const check = validateSeatMapLayout(layout);
  if (!check.ok) throw new Error(`Invalid seat map: ${check.errors.join('; ')}`);
  if (!roomId) throw new Error('roomId is required');

  const current = await db.selectFrom('room_seat_maps')
    .where('tenant_id', '=', getTenantId())
    .where('room_id', '=', roomId)
    .where('status', '=', 'active')
    .select(['id', 'version'])
    .executeTakeFirst()
    .catch(() => null);

  if (current) {
    // deactivate old version
    await db.updateTable('room_seat_maps')
      .set({ status: 'inactive', updated_at: new Date() })
      .where('id', '=', current.id)
      .where('tenant_id', '=', getTenantId())
      .execute();
  }

  const inserted = await db.insertInto('room_seat_maps')
    .values({
      tenant_id: getTenantId(),
      room_id: roomId,
      layout: JSON.stringify(layout),
      version: (current?.version || 0) + 1,
      status: 'active',
      created_by: userId || null,
    })
    .returning('id')
    .executeTakeFirst();

  await audit({
    action: AUDIT_ACTIONS.SEAT_MAP_UPDATE,
    userId,
    resourceType: 'room_seat_map',
    resourceId: inserted.id,
    details: { roomId, version: (current?.version || 0) + 1, seatCount: check.seatCount },
  });
  return { ok: true, id: inserted.id, version: (current?.version || 0) + 1, seatCount: check.seatCount };
}

/** Get the active seat-map for a room. */
export async function getActiveSeatMap(roomId) {
  const db = await getDb();
  if (!db) return null;
  try {
    const row = await db.selectFrom('room_seat_maps')
      .where('tenant_id', '=', getTenantId())
      .where('room_id', '=', roomId)
      .where('status', '=', 'active')
      .orderBy('version', 'desc')
      .selectAll()
      .executeTakeFirst();
    if (!row) return null;
    return { ...row, layout: typeof row.layout === 'string' ? JSON.parse(row.layout) : row.layout };
  } catch (_) {
    return null;
  }
}

/** List active seat-maps (optionally per room). */
export async function listSeatMaps({ roomId, limit = 200, offset = 0 } = {}) {
  const db = await getDb();
  if (!db) return [];
  try {
    let q = db.selectFrom('room_seat_maps')
      .where('tenant_id', '=', getTenantId())
      .where('status', '=', 'active')
      .orderBy('room_id', 'asc')
      .limit(limit)
      .offset(offset);
    if (roomId) q = q.where('room_id', '=', roomId);
    const rows = await q.selectAll().execute();
    return rows.map((r) => ({ ...r, layout: typeof r.layout === 'string' ? JSON.parse(r.layout) : r.layout }));
  } catch (_) {
    return [];
  }
}

// ═══════════════════════════════════════════════════════════════════
// SEAT ALLOCATION (per published schedule run)
// ═══════════════════════════════════════════════════════════════════

/**
 * Allocate seats for a schedule run's assignment.
 *
 * @param {Object} params
 * @param {number} params.runId
 * @param {Object} params.assignment - one exam_schedule_assignments row:
 *   { id, event_id, period_id, room_id, proctor_user_id, student_ids }
 * @param {Object} params.seatMap - active seat-map for the room
 * @param {Array<Object>} params.studentAccommodations - [{ userId, flags }]
 * @param {number} [params.seed]
 * @param {number|null} [params.userId]
 * @returns {{ ok: boolean, errors?: string[], assignments?: Array<Object>, unseated?: Array<Object> }}
 */
export async function allocateSeatAssignments({ runId, assignment, seatMap, studentAccommodations = [], seed = 1, userId = null } = {}) {
  const db = await getDb();
  if (!db) throw new Error('PostgreSQL required');
  if (!runId || !assignment) throw new Error('runId and assignment are required');

  const students = (assignment.student_ids || []).map((sid) => {
    const acc = studentAccommodations.find((a) => a.userId === sid)?.flags || [];
    return {
      userId: sid,
      variant: variantsFor(sid, seed),
      accommodation: {
        extraTime: acc.includes('extra_time'),
        accessibleSeat: acc.includes('accessible_seat'),
        separateRoom: acc.includes('separate_room'),
      },
    };
  });

  const capacity = checkSeatCapacity({ seatMap, students });
  if (!capacity.ok) return { ok: false, errors: capacity.errors, assignments: [], unseated: students };

  const result = allocateSeats({ seatMap, students, seed });
  if (!result.ok && result.assignments.length === 0) {
    return { ok: false, errors: result.errors, assignments: [], unseated: result.unseated };
  }

  // Separate-room students are NOT seated here — they need an isolated room
  // (handled by a dedicated isolated session in the scheduler).
  const inserted = [];
  for (const a of result.assignments) {
    const payload = buildHallTicketPayload({
      assignmentId: assignment.id,
      runId,
      eventId: assignment.event_id,
      periodId: assignment.period_id,
      roomId: assignment.room_id,
      studentUserId: a.userId,
      rowLabel: a.rowLabel,
      seatLabel: a.seatLabel,
      variant: a.variant,
      accommodationFlags: a.flags,
      seatMapVersion: seatMap.version || 1,
      issuedAt: Date.now(),
    });
    const token = signHallTicketToken(payload, signingKey());

    const row = await db.insertInto('exam_seat_assignments')
      .values({
        tenant_id: getTenantId(),
        run_id: runId,
        event_id: assignment.event_id,
        period_id: assignment.period_id,
        room_id: assignment.room_id,
        student_user_id: a.userId,
        row_label: a.rowLabel,
        seat_label: a.seatLabel,
        variant: a.variant,
        accommodation_flags: JSON.stringify(a.flags),
        hall_ticket_token: token,
      })
      .returning('id')
      .executeTakeFirst()
      .catch(async (err) => {
        // ONLY a unique-violation (idempotent re-allocate) is swallowed —
        // any other DB error (FK, etc.) must propagate, not silently drop
        // the student from the result (data-loss path).
        if (!err || err.code !== PG_UNIQUE_VIOLATION) throw err;
        const existing = await db.selectFrom('exam_seat_assignments')
          .where('tenant_id', '=', getTenantId())
          .where('run_id', '=', runId)
          .where('event_id', '=', assignment.event_id)
          .where('student_user_id', '=', a.userId)
          .selectAll()
          .executeTakeFirst()
          .catch(() => null);
        if (existing) {
          await db.updateTable('exam_seat_assignments')
            .set({ row_label: a.rowLabel, seat_label: a.seatLabel, variant: a.variant, accommodation_flags: JSON.stringify(a.flags), hall_ticket_token: token, updated_at: new Date() })
            .where('id', '=', existing.id)
            .where('tenant_id', '=', getTenantId())
            .execute();
          return { id: existing.id, duplicate: true };
        }
        return null;
      });
    if (row) inserted.push({ id: row.id, duplicate: Boolean(row.duplicate), ...a });
  }

  await audit({
    action: AUDIT_ACTIONS.SEAT_ALLOCATE,
    userId,
    resourceType: 'exam_schedule_run',
    resourceId: runId,
    details: {
      eventId: assignment.event_id,
      roomId: assignment.room_id,
      seated: inserted.length,
      unseated: result.unseated.length,
      seed,
    },
  });

  return { ok: result.unseated.length === 0, assignments: inserted, unseated: result.unseated };
}

/** Deterministic per-student variant (A/B/C) from run seed + student id. */
function variantsFor(userId, seed) {
  const i = Math.abs(Number(userId) * 31 + Number(seed) * 7) % 3;
  return ['A', 'B', 'C'][i];
}

/** Get seat assignments for a run (optionally filtered). */
export async function listSeatAssignments({ runId, eventId, roomId, limit = 500, offset = 0 } = {}) {
  const db = await getDb();
  if (!db) return [];
  try {
    let q = db.selectFrom('exam_seat_assignments')
      .where('tenant_id', '=', getTenantId())
      .orderBy('student_user_id', 'asc')
      .limit(limit)
      .offset(offset);
    if (runId) q = q.where('run_id', '=', runId);
    if (eventId) q = q.where('event_id', '=', eventId);
    if (roomId) q = q.where('room_id', '=', roomId);
    const rows = await q.selectAll().execute();
    return rows.map((r) => ({
      ...r,
      accommodation_flags: typeof r.accommodation_flags === 'string' ? JSON.parse(r.accommodation_flags) : r.accommodation_flags,
    }));
  } catch (_) {
    return [];
  }
}

/** Get a student's hall ticket (signed payload) for a run+event. */
export async function getStudentHallTicket({ runId, eventId, studentUserId }) {
  const db = await getDb();
  if (!db) return null;
  try {
    const row = await db.selectFrom('exam_seat_assignments')
      .where('tenant_id', '=', getTenantId())
      .where('run_id', '=', runId)
      .where('event_id', '=', eventId)
      .where('student_user_id', '=', studentUserId)
      .selectAll()
      .executeTakeFirst();
    if (!row) return null;
    const seatMap = await getActiveSeatMap(row.room_id);
    const payload = buildHallTicketPayload({
      assignmentId: row.id,
      runId: row.run_id,
      eventId: row.event_id,
      periodId: row.period_id,
      roomId: row.room_id,
      studentUserId: row.student_user_id,
      rowLabel: row.row_label,
      seatLabel: row.seat_label,
      variant: row.variant,
      accommodationFlags: typeof row.accommodation_flags === 'string' ? JSON.parse(row.accommodation_flags) : row.accommodation_flags,
      seatMapVersion: seatMap?.version || 1,
      issuedAt: row.created_at ? new Date(row.created_at).getTime() : Date.now(),
    });
    return { row, payload, token: row.hall_ticket_token, qr: JSON.stringify(payload) };
  } catch (_) {
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════════
// PROCTOR DUTY ALLOCATION
// ═══════════════════════════════════════════════════════════════════

/**
 * Allocate proctor duties for a run's assignments.
 *
 * @param {Object} params
 * @param {number} params.runId
 * @param {Array<Object>} params.assignments - [{ period_id, room_id }]
 * @param {Array<Object>} params.proctors - [{ userId, maxPerDay, availability }]
 * @param {number} [params.seed]
 * @param {number|null} [params.userId]
 */
export async function allocateProctorDutiesForRun({ runId, assignments = [], proctors = [], seed = 1, userId = null } = {}) {
  const db = await getDb();
  if (!db) throw new Error('PostgreSQL required');
  if (!runId) throw new Error('runId is required');

  const slots = assignments.map((a) => ({ periodId: a.period_id, roomId: a.room_id }));
  const result = allocateProctorDutiesPure({ slots, proctors, seed });
  if (!result.ok && result.duties.length === 0) {
    return { ok: false, errors: result.errors, duties: [], unassigned: result.unassigned };
  }

  const inserted = [];
  for (const d of result.duties) {
    const row = await db.insertInto('proctor_duty_assignments')
      .values({
        tenant_id: getTenantId(),
        run_id: runId,
        period_id: d.periodId,
        room_id: d.roomId,
        proctor_user_id: d.proctorUserId,
        status: 'assigned',
      })
      .returning('id')
      .executeTakeFirst()
      .catch(async (err) => {
        // ONLY unique-violation is idempotent; anything else must propagate.
        if (!err || err.code !== PG_UNIQUE_VIOLATION) throw err;
        const existing = await db.selectFrom('proctor_duty_assignments')
          .where('tenant_id', '=', getTenantId())
          .where('run_id', '=', runId)
          .where('period_id', '=', d.periodId)
          .where('room_id', '=', d.roomId)
          .selectAll()
          .executeTakeFirst()
          .catch(() => null);
        if (existing) return { id: existing.id, duplicate: true };
        return null;
      });
    if (row) inserted.push({ id: row.id, duplicate: Boolean(row.duplicate), ...d });
  }

  await audit({
    action: AUDIT_ACTIONS.PROCTOR_ALLOCATE,
    userId,
    resourceType: 'exam_schedule_run',
    resourceId: runId,
    details: { duties: inserted.length, unassigned: result.unassigned.length, workload: result.workload, seed },
  });

  return { ok: result.unassigned.length === 0, duties: inserted, unassigned: result.unassigned, workload: result.workload };
}

/** List proctor duties for a run. */
export async function listProctorDuties({ runId, periodId, limit = 200, offset = 0 } = {}) {
  const db = await getDb();
  if (!db) return [];
  try {
    let q = db.selectFrom('proctor_duty_assignments')
      .where('tenant_id', '=', getTenantId())
      .orderBy('period_id', 'asc')
      .limit(limit)
      .offset(offset);
    if (runId) q = q.where('run_id', '=', runId);
    if (periodId) q = q.where('period_id', '=', periodId);
    return await q.selectAll().execute();
  } catch (_) {
    return [];
  }
}

/** Proctor acknowledges a duty (offline-tolerant via journal). */
export async function acknowledgeProctorDuty(dutyId, proctorUserId) {
  const db = await getDb();
  if (!db) throw new Error('PostgreSQL required');

  const row = await db.updateTable('proctor_duty_assignments')
    .set({ status: 'acknowledged', acknowledged_at: new Date() })
    .where('id', '=', dutyId)
    .where('tenant_id', '=', getTenantId())
    .where('proctor_user_id', '=', proctorUserId)
    .execute();
  await audit({
    action: AUDIT_ACTIONS.PROCTOR_ACK,
    userId: proctorUserId,
    resourceType: 'proctor_duty_assignment',
    resourceId: dutyId,
    details: {},
  });
  return { ok: true, affected: Number(row.numUpdatedRows || 0) };
}

/**
 * Get one seat assignment by id (tenant-scoped).
 */
export async function getSeatAssignmentById(id) {
  const db = await getDb();
  if (!db) return null;
  try {
    return await db.selectFrom('exam_seat_assignments')
      .where('tenant_id', '=', getTenantId())
      .where('id', '=', Number(id))
      .selectAll()
      .executeTakeFirst();
  } catch (_) {
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════════
// HALL TICKET ACKNOWLEDGEMENT
// ═══════════════════════════════════════════════════════════════════

/** Student acknowledges their hall ticket. */
export async function acknowledgeHallTicket({ seatAssignmentId, studentUserId, seatMapVersion = 1 } = {}) {
  const db = await getDb();
  if (!db) throw new Error('PostgreSQL required');

  const inserted = await db.insertInto('hall_ticket_acks')
    .values({
      tenant_id: getTenantId(),
      student_user_id: studentUserId,
      seat_assignment_id: seatAssignmentId,
      seat_map_version: seatMapVersion,
    })
    .returning('id')
    .executeTakeFirst()
    .catch(async () => {
      const existing = await db.selectFrom('hall_ticket_acks')
        .where('tenant_id', '=', getTenantId())
        .where('student_user_id', '=', studentUserId)
        .where('seat_assignment_id', '=', seatAssignmentId)
        .select(['id'])
        .executeTakeFirst()
        .catch(() => null);
      return existing ? { id: existing.id, duplicate: true } : null;
    });
  if (!inserted) return { ok: false, error: 'Hall ticket ack failed' };

  await audit({
    action: AUDIT_ACTIONS.HALL_TICKET_ACK,
    userId: studentUserId,
    resourceType: 'exam_seat_assignment',
    resourceId: seatAssignmentId,
    details: { seatMapVersion },
  });
  return { ok: true, id: inserted.id, duplicate: Boolean(inserted.duplicate) };
}

// ═══════════════════════════════════════════════════════════════════
// OFFLINE CHECK-IN JOURNAL
// ═══════════════════════════════════════════════════════════════════

/**
 * Apply an offline check-in journal batch (idempotent by client_seq).
 *
 * @param {Object} params
 * @param {string} params.deviceId
 * @param {Array<Object>} params.entries - [{ clientSeq, eventType, payload }]
 * @param {number|null} [params.userId]
 */
export async function applyCheckinJournal({ deviceId, entries = [], userId = null } = {}) {
  const db = await getDb();
  if (!db) throw new Error('PostgreSQL required');
  if (!deviceId) throw new Error('deviceId is required');

  // Determine current acked_seq high-water mark for this device — the
  // contiguous watermark, not the max per-row value (out-of-order replay).
  const rows = await db.selectFrom('checkin_journal')
    .where('tenant_id', '=', getTenantId())
    .where('device_id', '=', deviceId)
    .select(['client_seq'])
    .execute()
    .catch(() => []);
  const ackedSeq = highestContiguousSeq(rows.map((r) => Number(r.client_seq)).filter((n) => n > 0));

  const normalized = entries.map((e) => buildCheckinEntry({ deviceId, clientSeq: e.clientSeq, eventType: e.eventType, payload: e.payload, ackedSeq }));

  // Persist all entries first (append-only), then apply in order.
  const results = [];
  let watermark = ackedSeq;
  for (const entry of normalized) {
    let inserted = null;
    try {
      inserted = await db.insertInto('checkin_journal')
        .values({
          tenant_id: getTenantId(),
          device_id: entry.deviceId,
          client_seq: entry.clientSeq,
          event_type: entry.eventType,
          payload: JSON.stringify(entry.payload),
          acked_seq: watermark,
          status: 'pending',
        })
        .returning('id')
        .executeTakeFirst();
    } catch (err) {
      // ONLY a unique-violation (duplicate client_seq → idempotent replay)
      // is swallowed; real DB errors must propagate, not masquerade as
      // "duplicate".
      if (!err || err.code !== PG_UNIQUE_VIOLATION) throw err;
    }

    if (inserted) {
      // Apply event
      const apply = await applyJournalEvent(entry);
      // Advance the contiguous watermark as far as this batch allows.
      const seqs = [
        ...rows.map((r) => Number(r.client_seq)),
        ...normalized.filter((n) => n.clientSeq <= entry.clientSeq).map((n) => n.clientSeq),
      ];
      watermark = highestContiguousSeq(seqs.filter((n) => n > 0));
      await db.updateTable('checkin_journal')
        .set({ status: apply.ok ? 'applied' : 'rejected', acked_seq: watermark })
        .where('id', '=', inserted.id)
        .where('tenant_id', '=', getTenantId())
        .execute();
      results.push({ clientSeq: entry.clientSeq, ok: apply.ok, error: apply.error || null, eventType: entry.eventType });
    } else {
      results.push({ clientSeq: entry.clientSeq, ok: true, duplicate: true });
    }
  }

  const reconcile = reconcileCheckinJournal({
    entries: normalized,
    ackedSeq,
  });

  await audit({
    action: AUDIT_ACTIONS.CHECKIN_APPLY,
    userId,
    resourceType: 'checkin_journal',
    resourceId: null,
    details: { deviceId, entries: entries.length, applied: results.filter((r) => r.ok && !r.duplicate).length, nextAckedSeq: reconcile.nextAckedSeq, watermark },
  });

  return { ok: results.every((r) => r.ok), results, nextAckedSeq: reconcile.nextAckedSeq, watermark };
}

/** Apply a single journal event (checkin / ack_ticket / reseat). */
async function applyJournalEvent(entry) {
  const db = await getDb();
  const p = entry.payload || {};
  try {
    if (entry.eventType === 'checkin') {
      const res = await db.updateTable('exam_seat_assignments')
        .set({ checked_in_at: new Date(p.checkedInAt || Date.now()), checked_in_by: p.actorUserId || null, client_seq: entry.clientSeq })
        .where('tenant_id', '=', getTenantId())
        .where('id', '=', Number(p.seatAssignmentId))
        .execute();
      const affected = Number(res.numUpdatedRows || 0);
      if (affected === 0) return { ok: false, error: 'seat_assignment_not_found' };
      return { ok: true };
    }
    if (entry.eventType === 'ack_ticket') {
      const res = await acknowledgeHallTicket({
        seatAssignmentId: Number(p.seatAssignmentId),
        studentUserId: Number(p.studentUserId),
        seatMapVersion: Number(p.seatMapVersion) || 1,
      });
      return res.ok ? { ok: true } : { ok: false, error: res.error };
    }
    if (entry.eventType === 'reseat') {
      const res = await reseatStudent({
        runId: Number(p.runId),
        studentUserId: Number(p.studentUserId),
        fromSeatAssignmentId: Number(p.fromSeatAssignmentId),
        toSeatAssignmentId: Number(p.toSeatAssignmentId),
        reason: p.reason,
        actorUserId: p.actorUserId || null,
      });
      return res.ok ? { ok: true } : { ok: false, error: res.error };
    }
    return { ok: false, error: `unknown_event_${entry.eventType}` };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

/** Read a device's journal (for reconcile). */
export async function getCheckinJournal({ deviceId, limit = 500 } = {}) {
  const db = await getDb();
  if (!db) return [];
  try {
    let q = db.selectFrom('checkin_journal')
      .where('tenant_id', '=', getTenantId())
      .orderBy('client_seq', 'asc')
      .limit(limit);
    if (deviceId) q = q.where('device_id', '=', deviceId);
    const rows = await q.selectAll().execute();
    return rows.map((r) => ({
      ...r,
      payload: typeof r.payload === 'string' ? JSON.parse(r.payload) : r.payload,
    }));
  } catch (_) {
    return [];
  }
}

// ═══════════════════════════════════════════════════════════════════
// RESEAT / REPLACEMENT AUDIT
// ═══════════════════════════════════════════════════════════════════

/**
 * Reseat a student (replacement) with an audit trail. Reason is a CODE.
 */
export async function reseatStudent({ runId, studentUserId, fromSeatAssignmentId, toSeatAssignmentId, reason, actorUserId = null } = {}) {
  const db = await getDb();
  if (!db) throw new Error('PostgreSQL required');

  const auditEntry = buildReseatAuditEntry({ runId, studentUserId, fromSeatAssignmentId, toSeatAssignmentId, reason, actorUserId });
  if (!auditEntry.ok) return { ok: false, error: auditEntry.error };

  await db.insertInto('reseat_audit')
    .values({
      tenant_id: getTenantId(),
      run_id: runId,
      student_user_id: studentUserId,
      from_seat_assignment_id: fromSeatAssignmentId,
      to_seat_assignment_id: toSeatAssignmentId,
      reason,
      actor_user_id: actorUserId,
    })
    .execute();

  // Mark the old seat as reseated-of → new assignment.
  if (toSeatAssignmentId) {
    await db.updateTable('exam_seat_assignments')
      .set({ reseat_of: fromSeatAssignmentId })
      .where('id', '=', toSeatAssignmentId)
      .where('tenant_id', '=', getTenantId())
      .execute();
  }

  await audit({
    action: AUDIT_ACTIONS.SEAT_RESEAT,
    userId: actorUserId,
    resourceType: 'exam_seat_assignment',
    resourceId: toSeatAssignmentId || null,
    details: { fromSeatAssignmentId, reason, runId },
  });
  return { ok: true };
}

/** Reseat audit trail for a run. */
export async function listReseatAudit({ runId, studentUserId, limit = 200, offset = 0 } = {}) {
  const db = await getDb();
  if (!db) return [];
  try {
    let q = db.selectFrom('reseat_audit')
      .where('tenant_id', '=', getTenantId())
      .orderBy('created_at', 'desc')
      .limit(limit)
      .offset(offset);
    if (runId) q = q.where('run_id', '=', runId);
    if (studentUserId) q = q.where('student_user_id', '=', studentUserId);
    return await q.selectAll().execute();
  } catch (_) {
    return [];
  }
}

// ═══════════════════════════════════════════════════════════════════
// REGISTER EXPORTS (answer-key-free)
// ═══════════════════════════════════════════════════════════════════

/** Room register: room → students + seats + check-in status (NO answer keys). */
export async function exportRoomRegister({ runId, roomId, limit = 1000 } = {}) {
  const db = await getDb();
  if (!db) return [];
  try {
    let q = db.selectFrom('exam_seat_assignments')
      .where('tenant_id', '=', getTenantId())
      .orderBy('room_id', 'asc')
      .orderBy('row_label', 'asc')
      .orderBy('seat_label', 'asc')
      .limit(limit);
    if (runId) q = q.where('run_id', '=', runId);
    if (roomId) q = q.where('room_id', '=', roomId);
    const rows = await q.selectAll().execute();
    return rows.map((r) => ({
      roomId: r.room_id,
      studentUserId: r.student_user_id,
      rowLabel: r.row_label,
      seatLabel: r.seat_label,
      variant: r.variant,
      checkedIn: Boolean(r.checked_in_at),
      accommodationFlags: typeof r.accommodation_flags === 'string' ? JSON.parse(r.accommodation_flags) : r.accommodation_flags,
    }));
  } catch (_) {
    return [];
  }
}

/** Proctor register: period → room → proctor (duty sheet). */
export async function exportProctorRegister({ runId, periodId, limit = 500 } = {}) {
  const db = await getDb();
  if (!db) return [];
  try {
    let q = db.selectFrom('proctor_duty_assignments')
      .where('tenant_id', '=', getTenantId())
      .orderBy('period_id', 'asc')
      .orderBy('room_id', 'asc')
      .limit(limit);
    if (runId) q = q.where('run_id', '=', runId);
    if (periodId) q = q.where('period_id', '=', periodId);
    return await q.selectAll().execute();
  } catch (_) {
    return [];
  }
}
