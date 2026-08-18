/**
 * Deborah — Program Calendar & Workload Schema (pure logic)
 *
 * Pure, DB-free validation & collision logic for Prompt 26:
 *   - Program event schema validation (effort/marker/moderation minutes)
 *   - Same-cohort deadline query helper
 *   - Exam hard clash validator (cohort overlap, marker double-book, room conflict)
 *   - Feedback-before-next-task dependency check
 *   - Marker/moderation capacity warnings
 *   - What-if move impact service (coordinator impact for date publish)
 *   - ICS (RFC 5545) generation + IANA timezone validation
 *
 * SECURITY / DATA GUARD (Prompt 26 §15):
 *   - AI stress/emotion inference: NEVER — this module only reasons about
 *     objective workload numbers (minutes, dates, capacities). No sentiment,
 *     stress, or emotion fields exist or are derived anywhere.
 *   - Date auto-publish: NEVER — publish is an explicit coordinator action in
 *     the service layer, gated by hard-clash-zero.
 *
 * Purity: no I/O, no globals — fully unit-testable without PostgreSQL.
 */

// ── Event types ──
export const EVENT_TYPES = [
  'summative',
  'formative',
  'deadline',
  'feedback_window',
  'other',
];

// ── Status lifecycle ──
export const EVENT_STATUS = {
  DRAFT: 'draft',
  SCHEDULED: 'scheduled',
  PUBLISHED: 'published',
  ARCHIVED: 'archived',
};

export const EVENT_STATUS_TRANSITIONS = {
  draft: ['scheduled', 'archived'],
  scheduled: ['published', 'draft', 'archived'],
  published: ['archived'],
  archived: [],
};

// ── Notification change types ──
export const NOTIFICATION_CHANGE_TYPES = [
  'created',
  'updated',
  'date_changed',
  'cancelled',
  'published',
];

export const NOTIFICATION_RECIPIENT_SCOPES = ['cohort', 'markers', 'moderators', 'all'];

export const DEFAULT_TIMEZONE = 'Asia/Tashkent';

// ── Workload defaults ──
export const DEFAULT_MARKER_CAPACITY_MINUTES = 480; // 8 hours/day
export const DEFAULT_FEEDBACK_BUFFER_DAYS = 3;

// ═══════════════════════════════════════════════════════════════════
// TIMEZONE VALIDATION
// ═══════════════════════════════════════════════════════════════════

/**
 * Validate an IANA timezone name using Intl (no external dependency).
 *
 * @param {string} tz
 * @returns {boolean}
 */
export function isValidTimezone(tz) {
  if (typeof tz !== 'string' || tz.length === 0) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz }).format();
    return true;
  } catch (_) {
    return false;
  }
}

/**
 * Normalize an event's times into a consistent shape.
 * Accepts Date objects or ISO strings; returns { start, end } as Date or nulls.
 *
 * @param {Object} event
 * @returns {{ start: Date|null, end: Date|null, timezone: string }}
 */
export function normalizeEventTimes(event = {}) {
  const timezone = isValidTimezone(event.timezone) ? event.timezone : DEFAULT_TIMEZONE;
  const start = event.start_at || event.start
    ? new Date(event.start_at || event.start) : null;
  const end = event.end_at || event.end
    ? new Date(event.end_at || event.end) : null;
  return {
    start: start && !Number.isNaN(start.getTime()) ? start : null,
    end: end && !Number.isNaN(end.getTime()) ? end : null,
    timezone,
  };
}

// ═══════════════════════════════════════════════════════════════════
// EVENT SCHEMA
// ═══════════════════════════════════════════════════════════════════

/**
 * Validate a program event before create/update.
 * Objective workload fields only — effort is minutes, never inferred stress.
 *
 * @param {Object} event
 * @returns {{ ok: boolean, errors: string[], warnings: string[] }}
 */
export function validateEventSchema(event = {}) {
  const errors = [];
  const warnings = [];

  if (!event.title || typeof event.title !== 'string') {
    errors.push('event.title is required');
  }

  if (!EVENT_TYPES.includes(event.event_type)) {
    errors.push(`event.event_type must be one of ${EVENT_TYPES.join(', ')}`);
  }

  const { start, end, timezone } = normalizeEventTimes(event);
  if (!start) errors.push('event.start_at must be a valid date');
  if (!end) errors.push('event.end_at must be a valid date');
  if (start && end && end <= start) {
    errors.push('event.end_at must be after start_at');
  }

  if (!isValidTimezone(event.timezone)) {
    errors.push(`event.timezone must be a valid IANA timezone (got "${event.timezone}")`);
  } else if (event.timezone !== timezone) {
    warnings.push(`timezone normalized to ${timezone}`);
  }

  // Workload fields — non-negative objective minutes
  for (const field of ['student_effort_minutes', 'marker_minutes', 'moderation_minutes']) {
    const v = event[field];
    if (v !== undefined && v !== null) {
      if (!Number.isFinite(v) || v < 0) {
        errors.push(`event.${field} must be a non-negative number`);
      }
    }
  }

  // Feedback dependency: cannot reference itself (only when actually set)
  if (event.requires_feedback_from_event_id !== undefined &&
      event.requires_feedback_from_event_id === event.id) {
    errors.push('event cannot require feedback from itself');
  }

  // Cohort links must be an array of numbers if provided
  if (event.cohort_ids !== undefined) {
    if (!Array.isArray(event.cohort_ids)) {
      errors.push('event.cohort_ids must be an array');
    } else {
      for (const cid of event.cohort_ids) {
        if (!Number.isInteger(cid)) errors.push('event.cohort_ids entries must be integers');
      }
    }
  }

  return { ok: errors.length === 0, errors, warnings };
}

// ═══════════════════════════════════════════════════════════════════
// SAME-COHORT DEADLINE QUERY
// ═══════════════════════════════════════════════════════════════════

/**
 * Group a set of events by cohort and return, for each cohort, its deadlines
 * sorted by start time. This is the data source for same-cohort deadline
 * queries (Prompt 26 §09).
 *
 * @param {Array<Object>} events - [{ id, title, event_type, cohort_ids: [], start_at, end_at }]
 * @returns {Array<{ cohortId: number, deadlines: Array<Object> }>}
 */
export function queryCohortDeadlines(events = []) {
  const byCohort = new Map();
  for (const ev of events || []) {
    const ids = Array.isArray(ev.cohort_ids) ? ev.cohort_ids : [];
    for (const cohortId of ids) {
      if (!byCohort.has(cohortId)) byCohort.set(cohortId, []);
      byCohort.get(cohortId).push(ev);
    }
  }
  const result = [];
  for (const [cohortId, list] of byCohort.entries()) {
    list.sort((a, b) => new Date(a.start_at) - new Date(b.start_at));
    result.push({ cohortId, deadlines: list });
  }
  result.sort((a, b) => a.cohortId - b.cohortId);
  return result;
}

// ═══════════════════════════════════════════════════════════════════
// HARD CLASH VALIDATOR
// ═══════════════════════════════════════════════════════════════════

/**
 * Check whether two events overlap in time (interval overlap).
 *
 * @param {Object} a
 * @param {Object} b
 * @returns {boolean}
 */
export function eventsOverlap(a, b) {
  const { start: as, end: ae } = normalizeEventTimes(a);
  const { start: bs, end: be } = normalizeEventTimes(b);
  if (!as || !ae || !bs || !be) return false;
  return as < be && bs < ae;
}

/**
 * Validate exam hard clashes (Prompt 26 §10).
 *
 * Hard constraints:
 *   1. Same-cohort overlap — two events sharing a cohort must not overlap
 *   2. Marker double-book — same marker_user_id must not overlap two events
 *   3. Moderator double-book — same moderator_user_id must not overlap
 *   4. Room conflict — same room_id must not overlap two events
 *
 * @param {Array<Object>} events
 * @returns {{ ok: boolean, clashes: Array<{ type: string, detail: string, eventA: any, eventB: any }> }}
 */
export function validateExamHardClash(events = []) {
  const clashes = [];

  for (let i = 0; i < events.length; i++) {
    for (let j = i + 1; j < events.length; j++) {
      const a = events[i];
      const b = events[j];
      if (!eventsOverlap(a, b)) continue;

      // 1. Cohort overlap
      const cohortA = new Set(Array.isArray(a.cohort_ids) ? a.cohort_ids : []);
      const cohortB = new Set(Array.isArray(b.cohort_ids) ? b.cohort_ids : []);
      const shared = [...cohortA].filter((c) => cohortB.has(c));
      if (shared.length > 0) {
        clashes.push({
          type: 'cohort_overlap',
          detail: `Events "${a.title}" and "${b.title}" share cohort ${shared.join(', ')} and overlap in time`,
          eventA: a,
          eventB: b,
          sharedCohorts: shared,
        });
      }

      // 2. Marker double-book
      if (a.marker_user_id && a.marker_user_id === b.marker_user_id) {
        clashes.push({
          type: 'marker_double_book',
          detail: `Marker #${a.marker_user_id} is assigned to both "${a.title}" and "${b.title}" which overlap`,
          eventA: a,
          eventB: b,
        });
      }

      // 3. Moderator double-book
      if (a.moderator_user_id && a.moderator_user_id === b.moderator_user_id) {
        clashes.push({
          type: 'moderator_double_book',
          detail: `Moderator #${a.moderator_user_id} is assigned to both "${a.title}" and "${b.title}" which overlap`,
          eventA: a,
          eventB: b,
        });
      }

      // 4. Room conflict
      if (a.room_id && a.room_id === b.room_id) {
        clashes.push({
          type: 'room_conflict',
          detail: `Room "${a.room_id}" is used by both "${a.title}" and "${b.title}" which overlap`,
          eventA: a,
          eventB: b,
        });
      }
    }
  }

  return { ok: clashes.length === 0, clashes };
}

// ═══════════════════════════════════════════════════════════════════
// FEEDBACK-BEFORE-NEXT-TASK DEPENDENCY
// ═══════════════════════════════════════════════════════════════════

/**
 * Enforce feedback-before-next-task (Prompt 26 §11).
 *
 * If event B sets requires_feedback_from_event_id = A, then B's start must be
 * after A's feedback availability. Feedback availability is A.end_at plus an
 * optional buffer (default feedback buffer days).
 *
 * @param {Array<Object>} events - [{ id, title, start_at, end_at, requires_feedback_from_event_id }]
 * @param {Object} [opts]
 * @param {number} [opts.feedbackBufferDays]
 * @returns {{ ok: boolean, violations: Array<{ detail: string, eventId: number, requiresFeedbackFrom: number }> }}
 */
export function validateFeedbackDependency(events = [], { feedbackBufferDays = DEFAULT_FEEDBACK_BUFFER_DAYS } = {}) {
  const violations = [];
  const byId = new Map(events.map((e) => [e.id, e]));

  for (const ev of events) {
    const srcId = ev.requires_feedback_from_event_id;
    if (!srcId) continue;
    const src = byId.get(srcId);
    if (!src) {
      violations.push({
        detail: `Event "${ev.title}" requires feedback from event #${srcId} which does not exist in the schedule`,
        eventId: ev.id,
        requiresFeedbackFrom: srcId,
      });
      continue;
    }
    const srcEnd = new Date(src.end_at);
    const targetStart = new Date(ev.start_at);
    const bufferMs = feedbackBufferDays * 24 * 60 * 60 * 1000;
    const feedbackReadyAt = new Date(srcEnd.getTime() + bufferMs);
    if (targetStart < feedbackReadyAt) {
      violations.push({
        detail: `Feedback for "${src.title}" is ready ${feedbackReadyAt.toISOString()} but "${ev.title}" starts ${targetStart.toISOString()} — too early`,
        eventId: ev.id,
        requiresFeedbackFrom: srcId,
        feedbackReadyAt: feedbackReadyAt.toISOString(),
        targetStart: targetStart.toISOString(),
      });
    }
  }

  return { ok: violations.length === 0, violations };
}

// ═══════════════════════════════════════════════════════════════════
// MARKER / MODERATION CAPACITY WARNING
// ═══════════════════════════════════════════════════════════════════

/**
 * Compute per-marker workload and warn when capacity is exceeded
 * (Prompt 26 §12). Events are grouped by marker/moderator per day.
 *
 * @param {Array<Object>} events - [{ marker_user_id, moderator_user_id, marker_minutes, moderation_minutes, start_at }]
 * @param {Object} [opts]
 * @param {number} [opts.capacityMinutes]
 * @returns {{ ok: boolean, warnings: Array<{ detail: string, userId: number, role: string, date: string, totalMinutes: number, capacityMinutes: number }>, workloads: Array<Object> }}
 */
export function checkMarkerCapacity(events = [], { capacityMinutes = DEFAULT_MARKER_CAPACITY_MINUTES } = {}) {
  const warnings = [];
  const workloads = new Map(); // key: `${role}:${userId}:${date}`

  for (const ev of events || []) {
    const day = new Date(ev.start_at).toISOString().slice(0, 10);
    if (ev.marker_user_id && ev.marker_minutes > 0) {
      const key = `marker:${ev.marker_user_id}:${day}`;
      const entry = workloads.get(key) || { userId: ev.marker_user_id, role: 'marker', date: day, totalMinutes: 0, capacityMinutes };
      entry.totalMinutes += ev.marker_minutes;
      workloads.set(key, entry);
    }
    if (ev.moderator_user_id && ev.moderation_minutes > 0) {
      const key = `moderator:${ev.moderator_user_id}:${day}`;
      const entry = workloads.get(key) || { userId: ev.moderator_user_id, role: 'moderator', date: day, totalMinutes: 0, capacityMinutes };
      entry.totalMinutes += ev.moderation_minutes;
      workloads.set(key, entry);
    }
  }

  for (const entry of workloads.values()) {
    if (entry.totalMinutes > entry.capacityMinutes) {
      warnings.push({
        detail: `${entry.role} #${entry.userId} is over capacity on ${entry.date}: ${entry.totalMinutes}min > ${entry.capacityMinutes}min`,
        ...entry,
      });
    }
  }

  return { ok: warnings.length === 0, warnings, workloads: [...workloads.values()] };
}

// ═══════════════════════════════════════════════════════════════════
// WHAT-IF MOVE IMPACT SERVICE
// ═══════════════════════════════════════════════════════════════════

/**
 * Compute the impact of moving an event to a new window BEFORE committing
 * (Prompt 26 §13). Coordinator impact report = done condition for date publish.
 *
 * @param {Object} params
 * @param {Array<Object>} params.events - all events in the schedule
 * @param {number} params.movingEventId - event being moved
 * @param {string} params.newStart - new start ISO
 * @param {string} params.newEnd - new end ISO
 * @param {Object} [params.opts] - { feedbackBufferDays, capacityMinutes }
 * @returns {{ ok: boolean, impact: Object, newSchedule: Array<Object> }}
 */
export function computeWhatIfImpact({ events = [], movingEventId, newStart, newEnd, opts = {} } = {}) {
  const target = events.find((e) => e.id === movingEventId);
  if (!target) {
    return {
      ok: false,
      impact: {
        error: `Event #${movingEventId} not found in schedule`,
        wouldClash: false,
        affectedCohorts: [],
        affectedMarkers: [],
        hardClashes: [],
        dependencyViolations: [],
        capacityWarnings: [],
        summary: {},
      },
      newSchedule: events,
    };
  }

  // Build hypothetical schedule with the moved event
  const moved = {
    ...target,
    start_at: newStart,
    end_at: newEnd,
    timezone: target.timezone,
  };
  const newSchedule = events.map((e) => (e.id === movingEventId ? moved : e));

  const { clashes } = validateExamHardClash(newSchedule);
  const { violations } = validateFeedbackDependency(newSchedule, opts);
  const { warnings } = checkMarkerCapacity(newSchedule, opts);

  const wouldClash = clashes.length > 0 || violations.length > 0;

  const affectedCohorts = [...new Set(
    (target.cohort_ids || []).concat(clashes.filter((c) => c.type === 'cohort_overlap').flatMap((c) => c.sharedCohorts || []))
  )];
  const affectedMarkers = [...new Set(
    [target.marker_user_id, target.moderator_user_id]
      .concat(clashes.filter((c) => c.type === 'marker_double_book' || c.type === 'moderator_double_book').map((c) => c.detail.match(/#(\d+)/)?.[1]))
      .filter((v) => v != null && v !== '')
  )];

  return {
    ok: !wouldClash,
    impact: {
      movingEventId,
      oldStart: target.start_at,
      oldEnd: target.end_at,
      newStart,
      newEnd,
      wouldClash,
      hardClashes: clashes,
      dependencyViolations: violations,
      capacityWarnings: warnings,
      affectedCohorts,
      affectedMarkers,
      summary: {
        clashCount: clashes.length,
        dependencyViolationCount: violations.length,
        capacityWarningCount: warnings.length,
        affectedCohortCount: affectedCohorts.length,
        affectedMarkerCount: affectedMarkers.length,
      },
    },
    newSchedule,
  };
}

// ═══════════════════════════════════════════════════════════════════
// ICS (RFC 5545) GENERATION
// ═══════════════════════════════════════════════════════════════════

/**
 * Escape ICS text (commas, semicolons, newlines, backslash).
 *
 * @param {string} value
 * @returns {string}
 */
export function escapeIcsText(value = '') {
  return String(value)
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

/**
 * Format a Date into ICS UTC time with trailing Z (no TZID needed).
 * RFC 5545: a value with 'Z' suffix is UTC — clients display it in their
 * own zone, avoiding the TZID/local-wall-time mismatch entirely.
 *
 * @param {Date} date
 * @returns {string} YYYYMMDDTHHMMSSZ
 */
export function formatIcsTime(date) {
  const d = date instanceof Date ? date : new Date(date);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}` +
    `T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
}

/**
 * Format a Date into ICS LOCAL wall time for a specific IANA timezone
 * (only for VTIMEZONE/TZID-based flows). The default generateIcsEvent path
 * emits UTC-with-Z instead — see its doc comment. No external dependency — Intl.
 *
 * @param {Date} date
 * @param {string} timezone
 * @returns {string} YYYYMMDDTHHMMSS
 */
export function formatLocalIcsTime(date, timezone) {
  const d = date instanceof Date ? date : new Date(date);
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
  }).formatToParts(d);
  const get = (type) => (parts.find((p) => p.type === type) || {}).value || '00';
  // Some environments emit 24:00 for midnight with hour12:false — normalize.
  // Day-rollover is not handled: only safe for zones/instants where the
  // local date stays identical (Tashkent UTC+5 at midnight UTC is fine).
  const hour = get('hour') === '24' ? '00' : get('hour');
  return `${get('year')}${get('month')}${get('day')}T${hour}${get('minute')}${get('second')}`;
}

/**
 * Generate an RFC 5545 VCALENDAR for a program event.
 * Includes TZID reference; no external service required.
 *
 * @param {Object} event - { id, title, description, start_at, end_at, timezone, status, location }
 * @param {Object} [opts] - { prodId, uidPrefix }
 * @returns {string} ICS content
 */
export function generateIcsEvent(event = {}, { prodId = '-//Deborah//Program Calendar//EN', uidPrefix = 'deborah-event' } = {}) {
  const { start, end, timezone } = normalizeEventTimes(event);
  if (!start || !end) {
    throw new Error('Event start_at and end_at are required for ICS generation');
  }

  const uid = `${uidPrefix}-${event.id}-${start.getTime()}`;
  const status = event.status === 'published' ? 'CONFIRMED' : 'TENTATIVE';
  // The event's times are stored as UTC (timestamptz). Emit UTC with 'Z' so
  // calendar clients render the correct instant in ANY zone — TZID-based
  // local wall time is fragile without a full VTIMEZONE definition.
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    `PRODID:${escapeIcsText(prodId)}`,
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${escapeIcsText(uid)}`,
    `DTSTAMP:${formatIcsTime(new Date())}`,
    `DTSTART:${formatIcsTime(start)}`,
    `DTEND:${formatIcsTime(end)}`,
    `SUMMARY:${escapeIcsText(event.title || 'Program event')}`,
    `STATUS:${status}`,
  ];

  if (event.description) lines.push(`DESCRIPTION:${escapeIcsText(event.description)}`);
  const location = event.location || event.room_id;
  if (location) lines.push(`LOCATION:${escapeIcsText(location)}`);

  lines.push('END:VEVENT', 'END:VCALENDAR');
  return lines.join('\r\n');
}

/**
 * Pure decision helper for the date-change notification flow (§14): should
 * the service queue a 'date_changed' notification for this event update?
 * Rules: only SCHEDULED (student-visible) events get date-change notices;
 * drafts are invisible so no notice is needed; published are immutable.
 *
 * @param {string} currentStatus
 * @param {boolean} windowChanged
 * @returns {boolean}
 */
export function shouldQueueDateChangeNotification(currentStatus, windowChanged) {
  return currentStatus === 'scheduled' && windowChanged === true;
}

/**
 * Build a date-change notification payload (Prompt 26 §14).
 *
 * @param {Object} before - previous event times { start_at, end_at, timezone }
 * @param {Object} after - new event times { start_at, end_at, timezone }
 * @param {string} title
 * @returns {Object} payload
 */
export function buildDateChangePayload(before = {}, after = {}, title = '') {
  return {
    title,
    old_start: before.start_at || null,
    old_end: before.end_at || null,
    new_start: after.start_at || null,
    new_end: after.end_at || null,
    timezone: after.timezone || before.timezone || DEFAULT_TIMEZONE,
  };
}
