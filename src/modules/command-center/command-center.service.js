/**
 * Edikit — Exam Command Center, Incident & Notifications Service
 *
 * DB layer for Prompt 41:
 *   - Incidents: create (idempotent via external_key), transition state
 *     machine, assign owner, add actions (pause/extension/evacuation hooks),
 *     close with guard (owner + action + reason).
 *   - Command-center snapshot read model: room status cards + attendance
 *     card + open incident cards (§53.4 dashboard).
 *   - Notification outbox: idempotent mass queue (idempotency_key UNIQUE),
 *     delivery status updates, old-schedule invalidation (superseded_by).
 *   - Postmortem & action-item workflow (draft → reviewed → closed;
 *     open → in_progress → done|blocked).
 *
 * SECURITY / DATA GUARD (Prompt 41 §15):
 *   - Outbox payload faqat buildNotificationPreview whitelistidan o'tgan
 *     scalar maydonlarni saqlaydi — sensitive health/integrity detail yo'q.
 *   - Har bir write path tenant-scoped + idempotency (external_key /
 *     idempotency_key). Privileged actionlar audit qilinadi.
 *
 * Graceful degradation: without PostgreSQL write paths throw a clear error,
 * read paths return null/[] (consistent with the rest of the platform).
 */

import { getDb } from '../../infrastructure/postgres.js';
import { getCurrentTenant } from '../auth/tenant-context.js';
import { audit, AUDIT_ACTIONS } from '../auth/audit.js';
import {
  validateIncident,
  validateIncidentTransition,
  validateIncidentClose,
  buildNotificationBatch,
  supersedeOldNotifications,
  validatePostmortem,
  validatePostmortemTransition,
  validateActionItem,
  validateActionItemTransition,
  buildRoomStatusCard,
  buildAttendanceCard,
  buildIncidentCard,
  NOTIFICATION_STATUS,
  INCIDENT_STATUS,
} from './command-center.schema.js';

/** PostgreSQL unique-violation error code (23505). */
const PG_UNIQUE_VIOLATION = '23505';

function getTenantId() {
  return getCurrentTenant()?.tenantId || 1;
}

// ═══════════════════════════════════════════════════════════════════
// INCIDENTS
// ═══════════════════════════════════════════════════════════════════

/**
 * Create an incident (idempotent by external_key).
 */
export async function createIncident({ data = {}, userId = null } = {}) {
  const v = validateIncident(data);
  if (!v.ok) throw new Error(v.error);
  const db = await getDb();
  if (!db) throw new Error('PostgreSQL required');

  let id;
  try {
    const inserted = await db.insertInto('incidents')
      .values({
        tenant_id: getTenantId(),
        ...v.incident,
        created_by: userId,
        updated_at: new Date(),
      })
      .returning('id')
      .executeTakeFirst();
    id = inserted?.id;
  } catch (err) {
    if (String(err?.code) === PG_UNIQUE_VIOLATION) {
      // Idempotent replay — external_key already exists.
      const existing = await db.selectFrom('incidents')
        .select(['id'])
        .where('tenant_id', '=', getTenantId())
        .where('external_key', '=', v.incident.external_key || '')
        .executeTakeFirst();
      if (existing) return { ok: true, id: existing.id, idempotent: true };
    }
    throw err;
  }

  await audit({
    action: AUDIT_ACTIONS.INCIDENT_CREATE,
    userId,
    resourceType: 'incident',
    resourceId: id,
    details: { type: v.incident.type, severity: v.incident.severity, roomId: v.incident.room_id },
  });
  return { ok: true, id, idempotent: false };
}

/**
 * Get a single incident with its actions.
 */
export async function getIncident(id) {
  const db = await getDb();
  if (!db) return null;
  try {
    const incident = await db.selectFrom('incidents')
      .where('id', '=', id)
      .where('tenant_id', '=', getTenantId())
      .selectAll()
      .executeTakeFirst();
    if (!incident) return null;
    const actions = await db.selectFrom('incident_actions')
      .where('incident_id', '=', id)
      .orderBy('created_at', 'asc')
      .selectAll()
      .execute();
    return { ...incident, actions };
  } catch (_) {
    return null;
  }
}

/**
 * List incidents (optionally filtered by status / run / room).
 */
export async function listIncidents({ status, runId, roomId, limit = 200, offset = 0 } = {}) {
  const db = await getDb();
  if (!db) return [];
  try {
    let q = db.selectFrom('incidents')
      .where('tenant_id', '=', getTenantId())
      .orderBy('detected_at', 'desc')
      .limit(limit)
      .offset(offset);
    if (status) q = q.where('status', '=', status);
    if (runId) q = q.where('run_id', '=', runId);
    if (roomId) q = q.where('room_id', '=', roomId);
    return await q.selectAll().execute();
  } catch (_) {
    return [];
  }
}

/**
 * Transition an incident through its state machine. Close requires
 * owner + ≥1 action + reason (validateIncidentClose).
 */
export async function transitionIncident({ id, to, reason = '', userId = null } = {}) {
  const db = await getDb();
  if (!db) throw new Error('PostgreSQL required');

  const incident = await getIncident(id);
  if (!incident) throw new Error('Incident not found');

  const v = validateIncidentTransition(incident.status, to);
  if (!v.ok) throw new Error(v.error);

  const updates = { status: v.to, updated_at: new Date() };
  if (v.to === INCIDENT_STATUS.RESOLVED) updates.resolved_at = new Date();
  if (v.to === INCIDENT_STATUS.CLOSED) {
    const close = validateIncidentClose(incident, {
      actionCount: Array.isArray(incident.actions) ? incident.actions.length : 0,
      reason,
    });
    if (!close.ok) throw new Error(close.error);
    updates.closed_at = new Date();
  }

  await db.insertInto('incident_state_history').values({
    tenant_id: getTenantId(),
    incident_id: id,
    from_status: incident.status,
    to_status: v.to,
    actor_user_id: userId,
    reason: reason ? String(reason).slice(0, 500) : null,
  }).execute();

  await db.updateTable('incidents')
    .set(updates)
    .where('id', '=', id)
    .where('tenant_id', '=', getTenantId())
    .execute();

  await audit({
    action: AUDIT_ACTIONS.INCIDENT_TRANSITION,
    userId,
    resourceType: 'incident',
    resourceId: id,
    details: { from: incident.status, to: v.to },
  });
  return { ok: true, from: incident.status, to: v.to };
}

/**
 * Assign / change the incident owner (remedy owner — Prompt 41 §10, §24).
 */
export async function assignIncidentOwner({ id, ownerUserId, userId = null } = {}) {
  const db = await getDb();
  if (!db) throw new Error('PostgreSQL required');
  if (!ownerUserId) throw new Error('ownerUserId is required');

  await db.updateTable('incidents')
    .set({ owner_user_id: Number(ownerUserId), updated_at: new Date() })
    .where('id', '=', id)
    .where('tenant_id', '=', getTenantId())
    .execute();

  await audit({
    action: AUDIT_ACTIONS.INCIDENT_OWNER_ASSIGN,
    userId,
    resourceType: 'incident',
    resourceId: id,
    details: { ownerUserId: Number(ownerUserId) },
  });
  return { ok: true };
}

/**
 * Record an incident action (pause / extension / evacuation / notify /
 * remedy). detail is sanitized by the caller (never raw health text).
 * Idempotent via client_key — UNIQUE (tenant_id, incident_id, client_key).
 */
export async function addIncidentAction({ id, actionType, detail = {}, actorUserId = null, evidenceNote = null, clientKey = null } = {}) {
  const db = await getDb();
  if (!db) throw new Error('PostgreSQL required');

  const incident = await getIncident(id);
  if (!incident) throw new Error('Incident not found');

  // Sanitize detail: scalars only, drop sensitive keys recursively.
  const safeDetail = sanitizeDetail(detail);

  let insertedId;
  try {
    const inserted = await db.insertInto('incident_actions')
      .values({
        tenant_id: getTenantId(),
        incident_id: id,
        action_type: String(actionType).slice(0, 30),
        client_key: clientKey ? String(clientKey).slice(0, 120) : null,
        detail: safeDetail,
        actor_user_id: actorUserId,
        evidence_note: evidenceNote ? String(evidenceNote).slice(0, 500) : null,
      })
      .returning('id')
      .executeTakeFirst();
    insertedId = inserted?.id;
  } catch (err) {
    if (String(err?.code) === PG_UNIQUE_VIOLATION && clientKey) {
      // Idempotent replay — same client_key already recorded.
      const existing = await db.selectFrom('incident_actions')
        .select(['id'])
        .where('tenant_id', '=', getTenantId())
        .where('incident_id', '=', id)
        .where('client_key', '=', String(clientKey).slice(0, 120))
        .executeTakeFirst();
      if (existing) return { ok: true, id: existing.id, idempotent: true };
    }
    throw err;
  }

  await audit({
    action: AUDIT_ACTIONS.INCIDENT_ACTION,
    userId: actorUserId,
    resourceType: 'incident',
    resourceId: id,
    details: { actionType, incidentId: id, clientKey: clientKey || null },
  });
  return { ok: true, id: insertedId, idempotent: false };
}

/** Recursively drop non-scalar / blacklisted values from action detail. */
const SENSITIVE_KEYS = new Set([
  'answer_key', 'answerKey', 'grade', 'grades', 'health', 'medical',
  'diagnosis', 'integrity_detail', 'raw_reason', 'ssn', 'passport',
]);

function sanitizeDetail(obj, depth = 0) {
  if (depth > 3) return {};
  if (!obj || typeof obj !== 'object') return {};
  const out = {};
  for (const [k, val] of Object.entries(obj)) {
    if (SENSITIVE_KEYS.has(k)) continue;
    if (typeof val === 'string' || typeof val === 'number' || typeof val === 'boolean') {
      out[k] = val;
    } else if (Array.isArray(val)) {
      out[k] = val.map((x) => (typeof x === 'string' || typeof x === 'number' ? x : null)).filter((x) => x !== null);
    } else if (val && typeof val === 'object') {
      out[k] = sanitizeDetail(val, depth + 1);
    }
  }
  return out;
}

// ═══════════════════════════════════════════════════════════════════
// COMMAND-CENTER SNAPSHOT READ MODEL (§53.4)
// ═══════════════════════════════════════════════════════════════════

/**
 * Build the command-center snapshot: room cards + attendance card + open
 * incident cards. Pure aggregation over the DB (graceful degradation).
 *
 * Reads are answer-key-free and sanitized (buildIncidentCard / cards).
 */
export async function getCommandCenterSnapshot({ runId } = {}) {
  const db = await getDb();
  if (!db) return { rooms: [], attendance: buildAttendanceCard(), openIncidents: [] };

  try {
    // Rooms with per-room counters.
    const rooms = await db.selectFrom('exam_rooms')
      .where('tenant_id', '=', getTenantId())
      .selectAll()
      .execute();

    // Per-room check-in counts from seat assignments.
    let seatRows = [];
    try {
      let q = db.selectFrom('exam_seat_assignments')
        .where('tenant_id', '=', getTenantId())
        .select(['room_id', 'checked_in_at', 'student_user_id']);
      if (runId) q = q.where('run_id', '=', runId);
      seatRows = await q.execute();
    } catch (_) {
      seatRows = [];
    }

    // Open incidents per room.
    let openIncidents = [];
    try {
      openIncidents = await db.selectFrom('incidents')
        .where('tenant_id', '=', getTenantId())
        .where('status', '!=', INCIDENT_STATUS.CLOSED)
        .selectAll()
        .execute();
    } catch (_) {
      openIncidents = [];
    }

    const roomCards = rooms.map((room) => {
      const inRoom = seatRows.filter((s) => Number(s.room_id) === Number(room.id));
      const incidents = openIncidents.filter((i) => Number(i.room_id) === Number(room.id));
      return buildRoomStatusCard(room, {
        expected: inRoom.length,
        checkedIn: inRoom.filter((s) => Boolean(s.checked_in_at)).length,
        late: 0,
        openIncidents: incidents.length,
      });
    });

    const attendance = buildAttendanceCard({
      expected: seatRows.length,
      checkedIn: seatRows.filter((s) => Boolean(s.checked_in_at)).length,
      late: 0,
    });

    return {
      rooms: roomCards,
      attendance,
      openIncidents: openIncidents.map(buildIncidentCard),
    };
  } catch (_) {
    return { rooms: [], attendance: buildAttendanceCard(), openIncidents: [] };
  }
}

// ═══════════════════════════════════════════════════════════════════
// NOTIFICATION OUTBOX
// ═══════════════════════════════════════════════════════════════════

/**
 * Queue a mass notification batch (idempotent by idempotency_key UNIQUE).
 *
 * @param {Object} opts
 * @param {string} opts.channel - email | sms | telegram
 * @param {string} opts.recipientScope
 * @param {string} opts.templateKey
 * @param {Object} opts.payload - raw payload (SANITIZED before store)
 * @param {string} opts.batchKey - idempotency prefix
 * @param {string[]} opts.recipientKeys
 * @param {number} opts.incidentId
 * @param {boolean} opts.supersedeOld - supersede prior pending same-template
 */
export async function queueNotifications({
  channel, recipientScope, templateKey, payload = {}, batchKey = '',
  recipientKeys = [], incidentId = null, supersedeOld = false, userId = null,
} = {}) {
  const db = await getDb();
  if (!db) throw new Error('PostgreSQL required');

  const batch = buildNotificationBatch({
    channel, recipientScope, templateKey, payload, batchKey, recipientKeys,
  });
  if (!batch.ok) throw new Error(batch.error);

  // Old-schedule invalidation (§13): supersede prior pending same-template
  // notifications (except this batch's own).
  let supersededIds = [];
  if (supersedeOld) {
    const existing = await db.selectFrom('notification_outbox')
      .where('tenant_id', '=', getTenantId())
      .where('template_key', '=', templateKey)
      .select(['id', 'status', 'template_key', 'idempotency_key'])
      .execute();
    supersededIds = supersedeOldNotifications(existing, { templateKey, batchKey });
    if (supersededIds.length > 0) {
      await db.updateTable('notification_outbox')
        .set({ status: NOTIFICATION_STATUS.FAILED, delivery_status: { attempts: 0, last_error_code: 'superseded' } })
        .where('id', 'in', supersededIds)
        .where('tenant_id', '=', getTenantId())
        .execute();
    }
  }

  let inserted = 0;
  let duplicates = 0;
  for (const entry of batch.entries) {
    try {
      await db.insertInto('notification_outbox')
        .values({
          tenant_id: getTenantId(),
          incident_id: incidentId,
          channel: entry.channel,
          recipient_scope: entry.recipient_scope,
          template_key: entry.template_key,
          payload: entry.payload,
          status: NOTIFICATION_STATUS.PENDING,
          idempotency_key: entry.idempotency_key,
          created_by: userId,
          updated_at: new Date(),
        })
        .execute();
      inserted += 1;
    } catch (err) {
      if (String(err?.code) === PG_UNIQUE_VIOLATION) {
        duplicates += 1; // idempotent replay — already queued
      } else {
        throw err;
      }
    }
  }

  await audit({
    action: AUDIT_ACTIONS.NOTIFICATION_QUEUE,
    userId,
    resourceType: 'notification_outbox',
    resourceId: incidentId,
    details: {
      channel, templateKey, recipientScope, batchKey,
      inserted, duplicates, superseded: supersededIds.length,
    },
  });
  return { ok: true, inserted, duplicates, superseded: supersededIds.length, total: batch.entries.length };
}

/**
 * Mark a notification as sent / delivered / failed (delivery status).
 * status must be in NOTIFICATION_STATUS.
 */
export async function updateNotificationStatus({ id, status, deliveryInfo = {} } = {}) {
  const db = await getDb();
  if (!db) throw new Error('PostgreSQL required');
  if (!Object.values(NOTIFICATION_STATUS).includes(status)) {
    throw new Error(`Invalid notification status: ${status}`);
  }

  const current = await db.selectFrom('notification_outbox')
    .where('id', '=', id)
    .where('tenant_id', '=', getTenantId())
    .select(['id', 'delivery_status'])
    .executeTakeFirst();
  if (!current) throw new Error('Notification not found');

  const prev = (current.delivery_status && typeof current.delivery_status === 'object')
    ? current.delivery_status : {};
  const attempts = Number(prev.attempts ?? 0) + 1;
  // Error codes only — no raw error text in the outbox.
  const ds = {
    attempts,
    last_error_code: deliveryInfo.last_error_code || null,
    delivered_at: status === NOTIFICATION_STATUS.DELIVERED ? new Date().toISOString() : prev.delivered_at || null,
  };

  await db.updateTable('notification_outbox')
    .set({ status, delivery_status: ds, updated_at: new Date() })
    .where('id', '=', id)
    .where('tenant_id', '=', getTenantId())
    .execute();

  await audit({
    action: AUDIT_ACTIONS.NOTIFICATION_DELIVERY,
    userId: deliveryInfo.actorUserId || null,
    resourceType: 'notification_outbox',
    resourceId: id,
    details: { status, attempts },
  });
  return { ok: true, status, attempts };
}

/** List outbox notifications (optionally by incident / status). */
export async function listNotifications({ incidentId, status, limit = 200, offset = 0 } = {}) {
  const db = await getDb();
  if (!db) return [];
  try {
    let q = db.selectFrom('notification_outbox')
      .where('tenant_id', '=', getTenantId())
      .orderBy('created_at', 'desc')
      .limit(limit)
      .offset(offset);
    if (incidentId) q = q.where('incident_id', '=', incidentId);
    if (status) q = q.where('status', '=', status);
    return await q.selectAll().execute();
  } catch (_) {
    return [];
  }
}

// ═══════════════════════════════════════════════════════════════════
// POSTMORTEM & ACTION ITEMS
// ═══════════════════════════════════════════════════════════════════

/**
 * Create a postmortem for an incident (post-exam review).
 */
export async function createPostmortem({ data = {}, userId = null } = {}) {
  const v = validatePostmortem(data);
  if (!v.ok) throw new Error(v.error);
  const db = await getDb();
  if (!db) throw new Error('PostgreSQL required');

  const inserted = await db.insertInto('postmortems')
    .values({ tenant_id: getTenantId(), ...v.postmortem, created_by: userId, updated_at: new Date() })
    .returning('id')
    .executeTakeFirst();

  await audit({
    action: AUDIT_ACTIONS.POSTMORTEM_CREATE,
    userId,
    resourceType: 'postmortem',
    resourceId: inserted?.id,
    details: { incidentId: v.postmortem.incident_id },
  });
  return { ok: true, id: inserted?.id };
}

/**
 * Transition a postmortem (draft → reviewed → closed).
 */
export async function transitionPostmortem({ id, to, userId = null } = {}) {
  const db = await getDb();
  if (!db) throw new Error('PostgreSQL required');

  const pm = await db.selectFrom('postmortems')
    .where('id', '=', id)
    .where('tenant_id', '=', getTenantId())
    .select(['id', 'status'])
    .executeTakeFirst();
  if (!pm) throw new Error('Postmortem not found');

  const v = validatePostmortemTransition(pm.status, to);
  if (!v.ok) throw new Error(v.error);

  await db.updateTable('postmortems')
    .set({ status: v.to, updated_at: new Date() })
    .where('id', '=', id)
    .where('tenant_id', '=', getTenantId())
    .execute();

  await audit({
    action: AUDIT_ACTIONS.POSTMORTEM_TRANSITION,
    userId,
    resourceType: 'postmortem',
    resourceId: id,
    details: { from: pm.status, to: v.to },
  });
  return { ok: true, from: pm.status, to: v.to };
}

/** List postmortems (optionally by incident). */
export async function listPostmortems({ incidentId, limit = 200, offset = 0 } = {}) {
  const db = await getDb();
  if (!db) return [];
  try {
    let q = db.selectFrom('postmortems')
      .where('tenant_id', '=', getTenantId())
      .orderBy('created_at', 'desc')
      .limit(limit)
      .offset(offset);
    if (incidentId) q = q.where('incident_id', '=', incidentId);
    return await q.selectAll().execute();
  } catch (_) {
    return [];
  }
}

/**
 * Add a postmortem action item.
 */
export async function addActionItem({ data = {}, userId = null } = {}) {
  const v = validateActionItem(data);
  if (!v.ok) throw new Error(v.error);
  const db = await getDb();
  if (!db) throw new Error('PostgreSQL required');

  const inserted = await db.insertInto('postmortem_action_items')
    .values({ tenant_id: getTenantId(), ...v.item, created_by: userId })
    .returning('id')
    .executeTakeFirst();

  await audit({
    action: AUDIT_ACTIONS.ACTION_ITEM_ADD,
    userId,
    resourceType: 'postmortem_action_item',
    resourceId: inserted?.id,
    details: { postmortemId: v.item.postmortem_id },
  });
  return { ok: true, id: inserted?.id };
}

/**
 * Transition an action item (open → in_progress → done|blocked).
 */
export async function transitionActionItem({ id, to, userId = null } = {}) {
  const db = await getDb();
  if (!db) throw new Error('PostgreSQL required');

  const item = await db.selectFrom('postmortem_action_items')
    .where('id', '=', id)
    .where('tenant_id', '=', getTenantId())
    .select(['id', 'status'])
    .executeTakeFirst();
  if (!item) throw new Error('Action item not found');

  const v = validateActionItemTransition(item.status, to);
  if (!v.ok) throw new Error(v.error);

  const updates = { status: v.to };
  if (v.to === 'done') updates.done_at = new Date();

  await db.updateTable('postmortem_action_items')
    .set(updates)
    .where('id', '=', id)
    .where('tenant_id', '=', getTenantId())
    .execute();

  await audit({
    action: AUDIT_ACTIONS.ACTION_ITEM_UPDATE,
    userId,
    resourceType: 'postmortem_action_item',
    resourceId: id,
    details: { from: item.status, to: v.to },
  });
  return { ok: true, from: item.status, to: v.to };
}

/** List action items (optionally by postmortem). */
export async function listActionItems({ postmortemId, status, limit = 200, offset = 0 } = {}) {
  const db = await getDb();
  if (!db) return [];
  try {
    let q = db.selectFrom('postmortem_action_items')
      .where('tenant_id', '=', getTenantId())
      .orderBy('created_at', 'desc')
      .limit(limit)
      .offset(offset);
    if (postmortemId) q = q.where('postmortem_id', '=', postmortemId);
    if (status) q = q.where('status', '=', status);
    return await q.selectAll().execute();
  } catch (_) {
    return [];
  }
}
