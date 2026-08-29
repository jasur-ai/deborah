/**
 * Deborah — Exam Command Center, Incident & Notifications (pure logic)
 *
 * Prompt 41 — exam-day health, attendance va incidentlarni bitta auditable
 * command centerda boshqarish (research.md §53.4–53.7, §38.5). This module
 * is PURE (no I/O, no globals):
 *
 *   - Incident taxonomy: type / severity / status — full state machine with
 *     legal transitions and close guard (owner + action + reason required).
 *   - Status cards: buildRoomStatusCard, buildAttendanceCard, buildIncidentCard —
 *     command-center read-model building blocks (§53.4 example dashboard).
 *   - Notification preview sanitizer: buildNotificationPreview — SANITIZED
 *     payload; sensitive health/integrity/answer-key detail NEVER included
 *     (Prompt 41 §15 security/data guard).
 *   - Deep-link adapter boundary: buildDeepLinkAdapters — email/SMS/Telegram
 *     channel descriptors (pure descriptor objects; no I/O).
 *   - Old-schedule invalidation helper: supersedeOldNotifications.
 *   - Postmortem & action-item validation: draft → reviewed → closed;
 *     action-item open → in_progress → done|blocked.
 *
 * SECURITY / DATA GUARD (Prompt 41 §15):
 *   - buildNotificationPreview whitelist-sanitizes: faqat template-key + room/
 *     period/candidate-count kabi non-sensitive maydonlar; raw health/integrity
 *     detail, answer keys, grades, raw incident rationale — hech qachon.
 *   - Close guard: incident owner'siz, kamida bitta action'siz va close
 *     reason'siz yopilmaydi (research.md §53.7 acceptance criteria).
 *
 * Purity: deterministic, side-effect-free.
 */

// ═══════════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════════

/** Incident types (research.md §53.4). */
export const INCIDENT_TYPES = [
  'identity_mismatch',
  'medical',
  'accessibility',
  'network_power',
  'wrong_paper',
  'packet_mismatch',
  'rule_violation',
  'evacuation',
  'time_correction',
  'proctor_replacement',
  'other',
];

/** Incident severities (critical → low). */
export const INCIDENT_SEVERITIES = ['critical', 'high', 'medium', 'low'];

/** Incident state machine statuses. */
export const INCIDENT_STATUS = {
  OPEN: 'open',
  INVESTIGATING: 'investigating',
  MITIGATED: 'mitigated',
  RESOLVED: 'resolved',
  CLOSED: 'closed',
};

/** Legal transitions — open → investigating → mitigated → resolved → closed. */
export const INCIDENT_STATUS_TRANSITIONS = {
  open: ['investigating', 'resolved', 'closed'],
  investigating: ['mitigated', 'open', 'resolved', 'closed'],
  mitigated: ['resolved', 'open', 'closed'],
  resolved: ['closed', 'open'],
  closed: [],
};

/** Incident action hooks (Prompt 41 §11). */
export const INCIDENT_ACTION_TYPES = [
  'pause',
  'extension',
  'evacuation',
  'notify',
  'remedy',
  'other',
];

/** Notification channels (deep-link adapter boundary, §53.5). */
export const NOTIFICATION_CHANNELS = ['email', 'sms', 'telegram'];

/** Notification recipient scopes. */
export const NOTIFICATION_RECIPIENT_SCOPES = ['staff', 'room', 'candidates', 'all'];

/** Notification templates. */
export const NOTIFICATION_TEMPLATES = [
  'incident_opened',
  'incident_updated',
  'incident_closed',
  'evacuation',
  'schedule_change',
  'extension_granted',
  'test',
];

/** Notification status lifecycle. */
export const NOTIFICATION_STATUS = {
  PENDING: 'pending',
  SENT: 'sent',
  DELIVERED: 'delivered',
  FAILED: 'failed',
};

/** Postmortem status lifecycle. */
export const POSTMORTEM_STATUS = {
  DRAFT: 'draft',
  REVIEWED: 'reviewed',
  CLOSED: 'closed',
};

export const POSTMORTEM_STATUS_TRANSITIONS = {
  draft: ['reviewed', 'closed'],
  reviewed: ['closed', 'draft'],
  closed: [],
};

/** Postmortem action-item status lifecycle. */
export const ACTION_ITEM_STATUS = {
  OPEN: 'open',
  IN_PROGRESS: 'in_progress',
  DONE: 'done',
  BLOCKED: 'blocked',
};

export const ACTION_ITEM_STATUS_TRANSITIONS = {
  open: ['in_progress', 'done', 'blocked'],
  in_progress: ['done', 'blocked', 'open'],
  done: [],
  blocked: ['in_progress', 'open'],
};

/**
 * Whitelist for notification preview payload fields. Anything NOT in this
 * set is stripped by buildNotificationPreview (Prompt 41 §15 data guard).
 */
const NOTIFICATION_PREVIEW_ALLOWLIST = [
  'template_key',
  'channel',
  'recipient_scope',
  'room_name',
  'period_name',
  'incident_type',
  'incident_severity',
  'candidate_count',
  'affected_room_count',
  'event_name',
  'start_at',
  'end_at',
  'old_start_at',
  'new_start_at',
  'extension_minutes',
];

// ═══════════════════════════════════════════════════════════════════
// INCIDENT STATE MACHINE
// ═══════════════════════════════════════════════════════════════════

/**
 * Validate an incident create request. Pure decision helper.
 * @param {Object} data
 * @returns {{ok: true, incident: Object} | {ok: false, error: string}}
 */
export function validateIncident(data = {}) {
  const type = String(data.type || '');
  if (!INCIDENT_TYPES.includes(type)) {
    return { ok: false, error: `Invalid incident type. Allowed: ${INCIDENT_TYPES.join(', ')}` };
  }
  const severity = String(data.severity || 'medium');
  if (!INCIDENT_SEVERITIES.includes(severity)) {
    return { ok: false, error: `Invalid severity. Allowed: ${INCIDENT_SEVERITIES.join(', ')}` };
  }
  const summary = String(data.summary || '').trim();
  if (!summary || summary.length < 3 || summary.length > 500) {
    return { ok: false, error: 'Summary is required (3–500 chars)' };
  }
  if (data.external_key !== undefined && String(data.external_key).length > 120) {
    return { ok: false, error: 'external_key too long (max 120)' };
  }
  const affected = Array.isArray(data.affected_candidate_ids)
    ? data.affected_candidate_ids
        .map(Number)
        .filter((n) => Number.isInteger(n) && n > 0)
    : [];
  const incident = {
    type,
    severity,
    status: INCIDENT_STATUS.OPEN,
    summary,
    owner_user_id: data.owner_user_id ? Number(data.owner_user_id) : null,
    affected_candidate_ids: affected,
    action_required: data.action_required ? String(data.action_required).slice(0, 255) : null,
    run_id: data.run_id ? Number(data.run_id) : null,
    room_id: data.room_id ? Number(data.room_id) : null,
    period_id: data.period_id ? Number(data.period_id) : null,
    external_key: data.external_key ? String(data.external_key).slice(0, 120) : null,
  };
  return { ok: true, incident };
}

/**
 * Validate a state transition. Returns the new status or an error.
 * @param {string} from - current status
 * @param {string} to - requested status
 * @returns {{ok: true, to: string} | {ok: false, error: string}}
 */
export function validateIncidentTransition(from, to) {
  const allowed = INCIDENT_STATUS_TRANSITIONS[from];
  if (!allowed) return { ok: false, error: `Unknown from-status: ${from}` };
  if (!allowed.includes(to)) {
    return { ok: false, error: `Illegal transition ${from} → ${to}` };
  }
  return { ok: true, to };
}

/**
 * Close guard — research.md §53.7: "incident close reason va owner'siz
 * yopilmaydi". Requires owner + at least one action + close reason.
 * @param {Object} incident
 * @param {Object} opts
 * @returns {{ok: true} | {ok: false, error: string}}
 */
export function validateIncidentClose(incident = {}, { actionCount = 0, reason = '' } = {}) {
  if (!incident.owner_user_id) {
    return { ok: false, error: 'Incident cannot be closed without an owner' };
  }
  if (!Array.isArray(incident.actions) || incident.actions.length === 0) {
    if (actionCount < 1) {
      return { ok: false, error: 'Incident cannot be closed without at least one action' };
    }
  }
  const r = String(reason || '').trim();
  if (r.length < 3) {
    return { ok: false, error: 'Close reason is required (min 3 chars)' };
  }
  return { ok: true };
}

// ═══════════════════════════════════════════════════════════════════
// STATUS CARDS (command-center read model — §53.4)
// ═══════════════════════════════════════════════════════════════════

/**
 * Build a room status card from room + per-room counters.
 * @param {Object} room - { id, name, building, capacity, status }
 * @param {Object} counters - { expected, checkedIn, late, absent, openIncidents }
 * @returns {Object} sanitized card (no sensitive detail)
 */
export function buildRoomStatusCard(room = {}, counters = {}) {
  const expected = Number(counters.expected ?? 0);
  const checkedIn = Number(counters.checkedIn ?? 0);
  return {
    roomId: room.id ?? null,
    roomName: room.name ? String(room.name).slice(0, 200) : null,
    building: room.building ? String(room.building).slice(0, 120) : null,
    capacity: Number(room.capacity ?? 0),
    status: room.status ? String(room.status) : 'active',
    expected,
    checkedIn,
    late: Number(counters.late ?? 0),
    absent: Math.max(0, expected - checkedIn - Number(counters.late ?? 0)),
    openIncidents: Number(counters.openIncidents ?? 0),
    ready: room.status === 'active' && Number(counters.openIncidents ?? 0) === 0,
  };
}

/**
 * Build the attendance summary card (§53.4 "Students: 612 expected, 587 checked in").
 * @param {Object} totals - { expected, checkedIn, late, absent }
 * @returns {Object}
 */
export function buildAttendanceCard(totals = {}) {
  const expected = Number(totals.expected ?? 0);
  const checkedIn = Number(totals.checkedIn ?? 0);
  const late = Number(totals.late ?? 0);
  return {
    expected,
    checkedIn,
    late,
    absent: Math.max(0, expected - checkedIn - late),
    checkedInPct: expected > 0 ? Math.round((checkedIn / expected) * 100) : 0,
  };
}

/**
 * Build a sanitized incident card for the command-center dashboard.
 * NEVER includes raw health/integrity detail, answer keys or grades.
 * @param {Object} incident
 * @returns {Object}
 */
export function buildIncidentCard(incident = {}) {
  return {
    id: incident.id ?? null,
    type: incident.type ?? 'other',
    severity: incident.severity ?? 'medium',
    status: incident.status ?? 'open',
    summary: incident.summary ? String(incident.summary).slice(0, 500) : null,
    roomId: incident.room_id ?? null,
    periodId: incident.period_id ?? null,
    ownerUserId: incident.owner_user_id ?? null,
    affectedCandidateCount: Array.isArray(incident.affected_candidate_ids)
      ? incident.affected_candidate_ids.length
      : 0,
    actionRequired: incident.action_required ?? null,
    detectedAt: incident.detected_at ?? incident.created_at ?? null,
    closedAt: incident.closed_at ?? null,
  };
}

// ═══════════════════════════════════════════════════════════════════
// NOTIFICATION PREVIEW SANITIZER (Prompt 41 §15 — critical)
// ═══════════════════════════════════════════════════════════════════

/**
 * Sanitize a notification payload for the outbox. Whitelist-only: any key
 * not in NOTIFICATION_PREVIEW_ALLOWLIST is dropped. Sensitive health /
 * integrity / answer-key / grade detail can NEVER leak into a notification.
 *
 * @param {Object} payload - raw payload (may contain sensitive keys)
 * @returns {Object} sanitized payload
 */
export function buildNotificationPreview(payload = {}) {
  const out = {};
  for (const key of NOTIFICATION_PREVIEW_ALLOWLIST) {
    if (payload[key] !== undefined && payload[key] !== null) {
      const v = payload[key];
      // Never allow object/array values (nested sensitive data) — scalars only.
      if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
        out[key] = v;
      }
    }
  }
  return out;
}

/**
 * Deep-link adapter boundary (Prompt 41 §12) — pure descriptor for each
 * channel. The service layer uses these to record what would be sent;
 * actual sending is out-of-scope adapter work (integration boundary).
 *
 * @param {string} channel - email | sms | telegram
 * @param {Object} preview - sanitized payload (buildNotificationPreview output)
 * @returns {{ok: true, adapter: Object} | {ok: false, error: string}}
 */
export function buildDeepLinkAdapters(channel, preview = {}) {
  if (!NOTIFICATION_CHANNELS.includes(channel)) {
    return { ok: false, error: `Unsupported channel: ${channel}` };
  }
  const base = {
    channel,
    templateKey: preview.template_key || 'generic',
    recipientScope: preview.recipient_scope || 'staff',
    // Deep-link style target (pure descriptor — no live URL, no I/O).
    target: {
      scope: preview.recipient_scope || 'staff',
      room: preview.room_name || null,
      period: preview.period_name || null,
    },
  };
  return { ok: true, adapter: base };
}

/**
 * Build a batch of notification entries for a mass notification.
 * Each entry gets a deterministic idempotency key.
 *
 * @param {Object} opts
 * @param {string} opts.channel - email | sms | telegram
 * @param {string} opts.recipientScope - staff | room | candidates | all
 * @param {string} opts.templateKey - one of NOTIFICATION_TEMPLATES
 * @param {Object} opts.payload - raw payload (sanitized by caller via buildNotificationPreview)
 * @param {string} opts.batchKey - batch idempotency key prefix (e.g. `evac:run12:roomB204`)
 * @param {string[]} opts.recipientKeys - per-recipient suffix keys (e.g. user ids)
 * @returns {{ok: true, entries: Object[]} | {ok: false, error: string}}
 */
export function buildNotificationBatch({ channel, recipientScope, templateKey, payload = {}, batchKey = '', recipientKeys = [] } = {}) {
  if (!NOTIFICATION_CHANNELS.includes(channel)) {
    return { ok: false, error: `Unsupported channel: ${channel}` };
  }
  if (!NOTIFICATION_RECIPIENT_SCOPES.includes(recipientScope)) {
    return { ok: false, error: `Invalid recipient scope: ${recipientScope}` };
  }
  if (!NOTIFICATION_TEMPLATES.includes(templateKey)) {
    return { ok: false, error: `Invalid template: ${templateKey}` };
  }
  if (!batchKey) return { ok: false, error: 'batchKey is required' };
  const preview = buildNotificationPreview({ ...payload, template_key: templateKey, channel, recipient_scope: recipientScope });
  const keys = Array.isArray(recipientKeys) && recipientKeys.length > 0 ? recipientKeys : ['all'];
  const entries = keys.map((k, i) => ({
    channel,
    recipient_scope: recipientScope,
    template_key: templateKey,
    payload: preview,
    idempotency_key: `${batchKey}:${String(k).slice(0, 60)}:${i}`,
    // Deterministic: same batchKey + recipientKeys → same idempotency keys.
  }));
  return { ok: true, entries };
}

/**
 * Old-schedule invalidation (Prompt 41 §13): when a schedule change fires a
 * new notification batch, supersede previously-queued notifications for the
 * same template+scope (idempotency-safe).
 *
 * @param {Object[]} existing - outbox rows to consider superseding
 * @param {Object} opts
 * @returns {number[]} ids to supersede
 */
export function supersedeOldNotifications(existing = [], { templateKey, batchKey = '' } = {}) {
  return existing
    .filter((n) => n.status !== NOTIFICATION_STATUS.DELIVERED)
    .filter((n) => n.template_key === templateKey)
    .filter((n) => (batchKey ? !String(n.idempotency_key || '').startsWith(batchKey) : true))
    .map((n) => n.id)
    .filter(Boolean);
}

// ═══════════════════════════════════════════════════════════════════
// POSTMORTEM & ACTION ITEMS
// ═══════════════════════════════════════════════════════════════════

/**
 * Validate a postmortem create request.
 */
export function validatePostmortem(data = {}) {
  if (!data.incident_id) return { ok: false, error: 'incident_id is required' };
  const summary = String(data.summary || '').trim();
  const rootCause = String(data.root_cause || '').trim();
  if (summary.length > 500) return { ok: false, error: 'summary too long (max 500)' };
  if (rootCause.length > 500) return { ok: false, error: 'root_cause too long (max 500)' };
  return {
    ok: true,
    postmortem: {
      incident_id: Number(data.incident_id),
      summary: summary || null,
      root_cause: rootCause || null,
      status: POSTMORTEM_STATUS.DRAFT,
      owner_user_id: data.owner_user_id ? Number(data.owner_user_id) : null,
    },
  };
}

/**
 * Validate a postmortem state transition.
 */
export function validatePostmortemTransition(from, to) {
  const allowed = POSTMORTEM_STATUS_TRANSITIONS[from];
  if (!allowed) return { ok: false, error: `Unknown postmortem from-status: ${from}` };
  if (!allowed.includes(to)) return { ok: false, error: `Illegal postmortem transition ${from} → ${to}` };
  return { ok: true, to };
}

/**
 * Validate an action-item create request.
 */
export function validateActionItem(data = {}) {
  if (!data.postmortem_id) return { ok: false, error: 'postmortem_id is required' };
  const description = String(data.description || '').trim();
  if (!description || description.length < 3 || description.length > 500) {
    return { ok: false, error: 'description is required (3–500 chars)' };
  }
  return {
    ok: true,
    item: {
      postmortem_id: Number(data.postmortem_id),
      description,
      owner_user_id: data.owner_user_id ? Number(data.owner_user_id) : null,
      status: ACTION_ITEM_STATUS.OPEN,
      due_at: data.due_at ? new Date(data.due_at) : null,
    },
  };
}

/**
 * Validate an action-item status transition.
 */
export function validateActionItemTransition(from, to) {
  const allowed = ACTION_ITEM_STATUS_TRANSITIONS[from];
  if (!allowed) return { ok: false, error: `Unknown action-item from-status: ${from}` };
  if (!allowed.includes(to)) return { ok: false, error: `Illegal action-item transition ${from} → ${to}` };
  return { ok: true, to };
}
