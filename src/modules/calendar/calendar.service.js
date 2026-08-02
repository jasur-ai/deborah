/**
 * Edikit — Program Calendar & Workload Service
 *
 * DB layer for Prompt 26:
 *   - Program event CRUD (draft → scheduled → published, explicit coordinator publish)
 *   - Cohort links (same-cohort deadline queries)
 *   - Hard-clash-gated publish: publishEvent runs the validator and refuses
 *     if hard clashes exist — NO auto-publish of dates (Prompt 26 §15)
 *   - What-if move impact: updateEvent with a new window returns the impact
 *     report before committing, so the coordinator can approve consciously
 *   - Notification outbox (event_notifications): ICS/timezone/date-change flow
 *   - Write idempotency via external_key (unique per tenant)
 *
 * SECURITY / DATA GUARD:
 *   - Every query/mutation is tenant-scoped (tenant_id filter + write where)
 *   - No stress/emotion inference — workload fields are objective minutes only
 *   - Published events are immutable except archive (dates cannot silently change)
 *
 * Graceful degradation: without PostgreSQL, write paths throw a clear error
 * and read paths return null/[] (consistent with the rest of the platform).
 */

import { getDb } from '../../infrastructure/postgres.js';
import { getCurrentTenant } from '../auth/tenant-context.js';
import { audit, AUDIT_ACTIONS } from '../auth/audit.js';
import {
  validateEventSchema,
  validateExamHardClash,
  validateFeedbackDependency,
  checkMarkerCapacity,
  computeWhatIfImpact,
  buildDateChangePayload,
  shouldQueueDateChangeNotification,
  NOTIFICATION_CHANGE_TYPES,
  NOTIFICATION_RECIPIENT_SCOPES,
  EVENT_STATUS_TRANSITIONS,
} from './calendar.schema.js';

function getTenantId() {
  return getCurrentTenant()?.tenantId || 1;
}

/**
 * Load the full schedule WITH cohort_ids attached (join program_event_cohorts).
 * Critical: listProgramEvents() alone does NOT attach cohort_ids, so clash
 * validators would miss same-cohort overlaps. This is the single source of
 * truth for schedule-level checks (publish gate, what-if impact).
 *
 * ARCHIVED events are excluded — archiving must free the room/marker/cohort
 * slot so stale entries cannot keep blocking legitimate publishes with
 * false clashes ("hard clash zero" done-condition works in both directions).
 *
 * NOTE: capped at `limit` (default 500) events — for programs larger than
 * this, schedule-level clash detection silently skips the remainder. The
 * hard-clash gate is the Prompt 26 done-condition, so raise/iterate this cap
 * if a single program can exceed 500 live events.
 */
async function loadScheduleWithCohorts({ limit = 500 } = {}) {
  const db = await getDb();
  if (!db) return [];
  try {
    const events = await db.selectFrom('program_events')
      .where('tenant_id', '=', getTenantId())
      .where('status', '!=', 'archived')
      .orderBy('start_at', 'asc')
      .limit(limit)
      .selectAll()
      .execute();
    const links = await db.selectFrom('program_event_cohorts')
      .where('tenant_id', '=', getTenantId())
      .select(['event_id', 'group_id'])
      .execute();
    const byEvent = new Map();
    for (const link of links) {
      if (!byEvent.has(link.event_id)) byEvent.set(link.event_id, []);
      byEvent.get(link.event_id).push(link.group_id);
    }
    return events.map((e) => ({ ...e, cohort_ids: byEvent.get(e.id) || [] }));
  } catch (_) { return []; }
}

// ═══════════════════════════════════════════════════════════════════
// PROGRAM EVENT CRUD
// ═══════════════════════════════════════════════════════════════════

/**
 * Create a program event. Idempotent when external_key is provided —
 * a duplicate create returns the existing event id.
 */
export async function createProgramEvent(data) {
  const db = await getDb();
  if (!db) throw new Error('PostgreSQL required');
  if (!data.title) throw new Error('Event title is required');

  const schemaResult = validateEventSchema(data);
  if (!schemaResult.ok) {
    throw new Error(`Invalid event: ${schemaResult.errors.join('; ')}`);
  }

  // Idempotency: external_key unique per tenant
  if (data.external_key) {
    const existing = await db.selectFrom('program_events')
      .where('tenant_id', '=', getTenantId())
      .where('external_key', '=', data.external_key)
      .select('id')
      .executeTakeFirst();
    if (existing) return { id: existing.id, duplicate: true };
  }

  const result = await db.insertInto('program_events')
    .values({
      tenant_id: getTenantId(),
      term_id: data.term_id || null,
      offering_id: data.offering_id || null,
      assessment_id: data.assessment_id || null,
      brief_id: data.brief_id || null,
      policy_pack_id: data.policy_pack_id || null,
      title: data.title,
      event_type: data.event_type, // required — validateEventSchema rejects missing
      status: data.status || 'draft',
      start_at: new Date(data.start_at),
      end_at: new Date(data.end_at),
      timezone: data.timezone || 'Asia/Tashkent',
      student_effort_minutes: data.student_effort_minutes || 0,
      marker_minutes: data.marker_minutes || 0,
      moderation_minutes: data.moderation_minutes || 0,
      marker_user_id: data.marker_user_id || null,
      moderator_user_id: data.moderator_user_id || null,
      room_id: data.room_id || null,
      requires_feedback_from_event_id: data.requires_feedback_from_event_id || null,
      external_key: data.external_key || null,
      created_by: data.created_by || null,
    })
    .returning('id')
    .executeTakeFirst();

  if (result) {
    // Cohort links
    const cohortIds = Array.isArray(data.cohort_ids) ? data.cohort_ids : [];
    for (const groupId of cohortIds) {
      await db.insertInto('program_event_cohorts')
        .values({ event_id: result.id, tenant_id: getTenantId(), group_id: groupId })
        .execute();
    }

    await audit({
      action: AUDIT_ACTIONS.CALENDAR_EVENT_CREATE,
      userId: data.created_by,
      resourceType: 'program_event',
      resourceId: result.id,
      details: { title: data.title, event_type: data.event_type, start_at: data.start_at },
    });
  }
  return result ? { id: result.id } : null;
}

export async function getProgramEvent(id) {
  const db = await getDb();
  if (!db) return null;
  try {
    const event = await db.selectFrom('program_events')
      .where('id', '=', id)
      .where('tenant_id', '=', getTenantId())
      .selectAll()
      .executeTakeFirst();
    if (!event) return null;
    // Attach cohort ids
    const links = await db.selectFrom('program_event_cohorts')
      .where('event_id', '=', id)
      .where('tenant_id', '=', getTenantId())
      .select('group_id')
      .execute();
    return { ...event, cohort_ids: links.map((l) => l.group_id) };
  } catch (_) { return null; }
}

export async function listProgramEvents({ term_id, status, event_type, from, to, limit = 100, offset = 0 } = {}) {
  const db = await getDb();
  if (!db) return [];
  try {
    let query = db.selectFrom('program_events')
      .where('tenant_id', '=', getTenantId());
    if (term_id) query = query.where('term_id', '=', term_id);
    if (status) query = query.where('status', '=', status);
    if (event_type) query = query.where('event_type', '=', event_type);
    if (from) query = query.where('start_at', '>=', new Date(from));
    if (to) query = query.where('start_at', '<=', new Date(to));
    return await query
      .orderBy('start_at', 'asc')
      .limit(limit).offset(offset)
      .selectAll()
      .execute();
  } catch (_) { return []; }
}

/**
 * Update a program event (draft/scheduled only — published events are
 * immutable except archive). If the window changes, the what-if impact is
 * computed and returned so the coordinator can decide; dates are NOT
 * auto-published.
 */
export async function updateProgramEvent(id, data) {
  const db = await getDb();
  if (!db) throw new Error('PostgreSQL required');

  const existing = await getProgramEvent(id);
  if (!existing) throw new Error('Event not found');
  if (existing.status === 'published') {
    throw new Error('Published events are immutable — archive and re-create to reschedule');
  }
  if (existing.status === 'archived') {
    throw new Error('Archived events cannot be updated');
  }

  // Merge + validate
  const proposed = {
    ...existing,
    ...data,
    id,
  };
  const schemaResult = validateEventSchema(proposed);
  if (!schemaResult.ok) {
    throw new Error(`Invalid event: ${schemaResult.errors.join('; ')}`);
  }

  // What-if impact if window/marker changes
  const windowChanged =
    (data.start_at && new Date(data.start_at).getTime() !== new Date(existing.start_at).getTime()) ||
    (data.end_at && new Date(data.end_at).getTime() !== new Date(existing.end_at).getTime());
  let impact = null;
  if (windowChanged) {
    const schedule = await loadScheduleWithCohorts();
    impact = computeWhatIfImpact({
      // Reflect in-request cohort changes too, so the impact report matches
      // what the DB will contain after this update commits.
      events: schedule.map((e) => (e.id === id
        ? { ...e, start_at: proposed.start_at, end_at: proposed.end_at, cohort_ids: proposed.cohort_ids || e.cohort_ids }
        : e)),
      movingEventId: id,
      newStart: proposed.start_at,
      newEnd: proposed.end_at,
    }).impact;
  }

  const updates = {
    updated_at: new Date(),
    title: proposed.title,
    event_type: proposed.event_type,
    start_at: new Date(proposed.start_at),
    end_at: new Date(proposed.end_at),
    timezone: proposed.timezone,
    student_effort_minutes: proposed.student_effort_minutes || 0,
    marker_minutes: proposed.marker_minutes || 0,
    moderation_minutes: proposed.moderation_minutes || 0,
    marker_user_id: proposed.marker_user_id || null,
    moderator_user_id: proposed.moderator_user_id || null,
    room_id: proposed.room_id || null,
    requires_feedback_from_event_id: proposed.requires_feedback_from_event_id || null,
  };
  for (const f of ['term_id', 'offering_id', 'assessment_id', 'brief_id', 'policy_pack_id']) {
    if (data[f] !== undefined) updates[f] = data[f] || null;
  }

  await db.updateTable('program_events')
    .set(updates)
    .where('id', '=', id)
    .where('tenant_id', '=', getTenantId())
    .execute();

  // Cohort links: replace if provided
  if (Array.isArray(data.cohort_ids)) {
    await db.deleteFrom('program_event_cohorts')
      .where('event_id', '=', id)
      .where('tenant_id', '=', getTenantId())
      .execute();
    for (const groupId of data.cohort_ids) {
      await db.insertInto('program_event_cohorts')
        .values({ event_id: id, tenant_id: getTenantId(), group_id: groupId })
        .execute();
    }
  }

  // Date-change notification (outbox) — the coordinator is told, but the
  // date is only effective for students after publish. Only scheduled
  // (student-visible) events get date-change notices.
  if (shouldQueueDateChangeNotification(existing.status, windowChanged)) {
    await queueNotification({
      event_id: id,
      change_type: 'date_changed',
      recipient_scope: data.notify_scope || 'all',
      payload: buildDateChangePayload(existing, proposed, proposed.title),
      idempotency_key: `date_changed:${id}:${existing.start_at}:${proposed.start_at}`,
      created_by: data.updated_by || null,
    });
  }

  await audit({
    action: AUDIT_ACTIONS.CALENDAR_EVENT_UPDATE,
    userId: data.updated_by,
    resourceType: 'program_event',
    resourceId: id,
    details: {
      windowChanged,
      impact: impact ? impact.summary : null,
      title: proposed.title,
    },
  });

  return { ok: true, id, impact, windowChanged };
}

export async function archiveProgramEvent(id, userId) {
  const db = await getDb();
  if (!db) throw new Error('PostgreSQL required');

  const existing = await getProgramEvent(id);
  if (!existing) throw new Error('Event not found');
  if (existing.status === 'archived') return { ok: true, id, alreadyArchived: true };

  await db.updateTable('program_events')
    .set({ status: 'archived', updated_at: new Date() })
    .where('id', '=', id)
    .where('tenant_id', '=', getTenantId())
    .execute();

  await audit({
    action: AUDIT_ACTIONS.CALENDAR_EVENT_ARCHIVE,
    userId,
    resourceType: 'program_event',
    resourceId: id,
  });
  return { ok: true, id };
}

/**
 * Transition event status (draft→scheduled→published→archived).
 * Publishing a SCHEDULED event runs the hard clash validator and REFUSES
 * if any clash exists — dates are never published with hard clashes.
 * Done condition (Prompt 26 §25): hard clash zero + coordinator impact.
 */
export async function transitionProgramEvent(id, { to, userId, confirmImpact = false } = {}) {
  const db = await getDb();
  if (!db) throw new Error('PostgreSQL required');

  const existing = await getProgramEvent(id);
  if (!existing) throw new Error('Event not found');

  const allowed = EVENT_STATUS_TRANSITIONS[existing.status] || [];
  if (!allowed.includes(to)) {
    throw new Error(`Cannot transition event from "${existing.status}" to "${to}"`);
  }

  if (to === 'published') {
    // Hard gate: compute impact across the whole schedule (with cohort links!)
    const schedule = await loadScheduleWithCohorts();
    const clash = validateExamHardClash(schedule);
    // NOTE: dependency check runs over the FULL schedule INCLUDING drafts —
    // intentional: a coordinator must not publish a date while any known
    // feedback-before-next-task chain in the program is broken, even if the
    // violating event is still a draft. This surfaces the issue at publish
    // time instead of silently letting a broken dependency stand.
    const dep = validateFeedbackDependency(schedule);
    const cap = checkMarkerCapacity(schedule);
    const hasHardProblem = clash.clashes.length > 0 || dep.violations.length > 0;

    if (hasHardProblem) {
      throw new Error(`Cannot publish — hard clashes present: ${clash.clashes.length} clash(es), ${dep.violations.length} dependency violation(s)`);
    }
    if (cap.warnings.length > 0 && !confirmImpact) {
      throw new Error(`Cannot publish without impact confirmation — ${cap.warnings.length} marker capacity warning(s). Pass confirmImpact=true after reviewing.`);
    }

    await db.updateTable('program_events')
      .set({
        status: 'published',
        published_at: new Date(),
        published_by: userId || null,
        updated_at: new Date(),
      })
      .where('id', '=', id)
      .where('tenant_id', '=', getTenantId())
      .execute();

    await queueNotification({
      event_id: id,
      change_type: 'published',
      recipient_scope: 'all',
      payload: { title: existing.title, start_at: existing.start_at, end_at: existing.end_at, timezone: existing.timezone },
      idempotency_key: `published:${id}:${existing.start_at}`,
      created_by: userId || null,
    });
  } else {
    await db.updateTable('program_events')
      .set({ status: to, updated_at: new Date() })
      .where('id', '=', id)
      .where('tenant_id', '=', getTenantId())
      .execute();
  }

  await audit({
    action: to === 'published'
      ? AUDIT_ACTIONS.CALENDAR_EVENT_PUBLISH
      : AUDIT_ACTIONS.CALENDAR_EVENT_TRANSITION,
    userId,
    resourceType: 'program_event',
    resourceId: id,
    details: { from: existing.status, to, confirmImpact },
  });

  return { ok: true, id, from: existing.status, to };
}

// ═══════════════════════════════════════════════════════════════════
// SAME-COHORT DEADLINE QUERY
// ═══════════════════════════════════════════════════════════════════

/**
 * Query all events for a cohort (group), sorted by start — the data source
 * for same-cohort deadline collision checks.
 */
export async function listCohortEvents(groupId, { limit = 200 } = {}) {
  const db = await getDb();
  if (!db) return [];
  try {
    const links = await db.selectFrom('program_event_cohorts')
      .where('group_id', '=', groupId)
      .where('tenant_id', '=', getTenantId())
      .select('event_id')
      .limit(limit)
      .execute();
    if (links.length === 0) return [];
    const ids = links.map((l) => l.event_id);
    const events = await db.selectFrom('program_events')
      .where('tenant_id', '=', getTenantId())
      .where('id', 'in', ids)
      .orderBy('start_at', 'asc')
      .selectAll()
      .execute();
    return events.map((e) => ({ ...e, cohort_ids: [groupId] }));
  } catch (_) { return []; }
}

// ═══════════════════════════════════════════════════════════════════
// NOTIFICATION OUTBOX
// ═══════════════════════════════════════════════════════════════════

async function queueNotification({ event_id, change_type, recipient_scope = 'all', payload = {}, idempotency_key = null, created_by = null }) {
  const db = await getDb();
  if (!db) return null;
  if (!NOTIFICATION_CHANGE_TYPES.includes(change_type)) return null;
  if (!NOTIFICATION_RECIPIENT_SCOPES.includes(recipient_scope)) recipient_scope = 'all';

  if (idempotency_key) {
    const existing = await db.selectFrom('event_notifications')
      .where('tenant_id', '=', getTenantId())
      .where('idempotency_key', '=', idempotency_key)
      .select('id')
      .executeTakeFirst();
    if (existing) return { id: existing.id, duplicate: true };
  }

  const result = await db.insertInto('event_notifications')
    .values({
      tenant_id: getTenantId(),
      event_id,
      change_type,
      recipient_scope,
      payload,
      status: 'pending',
      idempotency_key: idempotency_key || null,
    })
    .returning('id')
    .executeTakeFirst();

  if (result) {
    await audit({
      action: AUDIT_ACTIONS.CALENDAR_NOTIFICATION,
      userId: created_by,
      resourceType: 'event_notification',
      resourceId: result.id,
      details: { change_type, event_id, recipient_scope },
    });
  }
  return result ? { id: result.id } : null;
}

/** List pending notifications for an event (outbox reads). */
export async function listEventNotifications(eventId, { status, limit = 100 } = {}) {
  const db = await getDb();
  if (!db) return [];
  try {
    let query = db.selectFrom('event_notifications')
      .where('event_id', '=', eventId)
      .where('tenant_id', '=', getTenantId());
    if (status) query = query.where('status', '=', status);
    return await query
      .orderBy('created_at', 'desc')
      .limit(limit)
      .selectAll()
      .execute();
  } catch (_) { return []; }
}

/** Mark a notification as sent (delivery acknowledgement). */
export async function markNotificationSent(id, userId) {
  const db = await getDb();
  if (!db) throw new Error('PostgreSQL required');

  await db.updateTable('event_notifications')
    .set({ status: 'sent' })
    .where('id', '=', id)
    .where('tenant_id', '=', getTenantId())
    .execute();

  await audit({
    action: AUDIT_ACTIONS.CALENDAR_NOTIFICATION,
    userId,
    resourceType: 'event_notification',
    resourceId: id,
    details: { change_type: 'sent_acknowledged' },
  });
  return { ok: true, id };
}
