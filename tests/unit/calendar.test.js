/**
 * Deborah — Program Calendar & Workload Tests
 *
 * Covers (Prompt 26):
 *   - Event schema validation (effort/marker/moderation minutes)
 *   - IANA timezone validation + normalization
 *   - Same-cohort deadline query
 *   - Exam hard clash validator (cohort overlap, marker double-book, room conflict)
 *   - Feedback-before-next-task dependency
 *   - Marker/moderation capacity warnings
 *   - What-if move impact service (consistency test)
 *   - ICS (RFC 5545) generation + date-change notification payload
 *   - Service graceful degradation without PostgreSQL
 *   - Barrel export
 */

import { describe, it, expect } from 'vitest';

import {
  // schema (pure)
  EVENT_TYPES,
  EVENT_STATUS,
  EVENT_STATUS_TRANSITIONS,
  NOTIFICATION_CHANGE_TYPES,
  NOTIFICATION_RECIPIENT_SCOPES,
  DEFAULT_TIMEZONE,
  DEFAULT_MARKER_CAPACITY_MINUTES,
  DEFAULT_FEEDBACK_BUFFER_DAYS,
  isValidTimezone,
  normalizeEventTimes,
  validateEventSchema,
  queryCohortDeadlines,
  eventsOverlap,
  validateExamHardClash,
  validateFeedbackDependency,
  checkMarkerCapacity,
  computeWhatIfImpact,
  generateIcsEvent,
  escapeIcsText,
  formatIcsTime,
  formatLocalIcsTime,
  buildDateChangePayload,
  shouldQueueDateChangeNotification,
} from '../../src/modules/calendar/calendar.schema.js';

import {
  // service
  createProgramEvent,
  getProgramEvent,
  listProgramEvents,
  updateProgramEvent,
  archiveProgramEvent,
  transitionProgramEvent,
  listCohortEvents,
  listEventNotifications,
  markNotificationSent,
} from '../../src/modules/calendar/calendar.service.js';

// ═══════════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════════

describe('Calendar — Constants', () => {
  it('should have event types', () => {
    expect(EVENT_TYPES).toContain('summative');
    expect(EVENT_TYPES).toContain('deadline');
    expect(EVENT_TYPES).toContain('feedback_window');
  });

  it('should have status lifecycle (published immutable backwards)', () => {
    expect(EVENT_STATUS_TRANSITIONS.draft).toContain('scheduled');
    expect(EVENT_STATUS_TRANSITIONS.scheduled).toContain('published');
    expect(EVENT_STATUS_TRANSITIONS.published).not.toContain('scheduled');
    expect(EVENT_STATUS_TRANSITIONS.published).toContain('archived');
  });

  it('should have notification change types incl date_changed', () => {
    expect(NOTIFICATION_CHANGE_TYPES).toContain('date_changed');
    expect(NOTIFICATION_CHANGE_TYPES).toContain('published');
    expect(NOTIFICATION_RECIPIENT_SCOPES).toContain('cohort');
  });

  it('should have workload defaults', () => {
    expect(DEFAULT_TIMEZONE).toBe('Asia/Tashkent');
    expect(DEFAULT_MARKER_CAPACITY_MINUTES).toBe(480);
    expect(DEFAULT_FEEDBACK_BUFFER_DAYS).toBe(3);
  });
});

// ═══════════════════════════════════════════════════════════════════
// TIMEZONE
// ═══════════════════════════════════════════════════════════════════

describe('Calendar — timezone validation', () => {
  it('should accept valid IANA timezones', () => {
    expect(isValidTimezone('Asia/Tashkent')).toBe(true);
    expect(isValidTimezone('UTC')).toBe(true);
    expect(isValidTimezone('America/New_York')).toBe(true);
  });

  it('should reject invalid timezones', () => {
    expect(isValidTimezone('Mars/Olympus')).toBe(false);
    expect(isValidTimezone('')).toBe(false);
    expect(isValidTimezone(null)).toBe(false);
    expect(isValidTimezone(123)).toBe(false);
  });

  it('should normalize event times and fall back to default timezone', () => {
    const { start, end, timezone } = normalizeEventTimes({
      start_at: '2026-09-01T09:00:00Z',
      end_at: '2026-09-01T11:00:00Z',
      timezone: 'Asia/Tashkent',
    });
    expect(start.toISOString()).toBe('2026-09-01T09:00:00.000Z');
    expect(end.toISOString()).toBe('2026-09-01T11:00:00.000Z');
    expect(timezone).toBe('Asia/Tashkent');

    const fallback = normalizeEventTimes({ start_at: '2026-09-01T09:00:00Z' });
    expect(fallback.timezone).toBe(DEFAULT_TIMEZONE);
  });

  it('should handle invalid dates as null', () => {
    const { start, end } = normalizeEventTimes({ start_at: 'not-a-date', end_at: 'also-bad' });
    expect(start).toBeNull();
    expect(end).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════
// EVENT SCHEMA
// ═══════════════════════════════════════════════════════════════════

describe('Calendar — validateEventSchema', () => {
  const valid = {
    title: 'Math Final',
    event_type: 'summative',
    start_at: '2026-09-01T09:00:00Z',
    end_at: '2026-09-01T11:00:00Z',
    timezone: 'Asia/Tashkent',
    student_effort_minutes: 120,
    marker_minutes: 480,
    moderation_minutes: 60,
  };

  it('should accept a valid event', () => {
    expect(validateEventSchema(valid).ok).toBe(true);
  });

  it('should reject missing title', () => {
    const result = validateEventSchema({ ...valid, title: '' });
    expect(result.ok).toBe(false);
    expect(result.errors[0]).toContain('title');
  });

  it('should reject invalid event_type', () => {
    const result = validateEventSchema({ ...valid, event_type: 'surprise_quiz' });
    expect(result.ok).toBe(false);
  });

  it('should reject end before start', () => {
    const result = validateEventSchema({
      ...valid,
      start_at: '2026-09-01T11:00:00Z',
      end_at: '2026-09-01T09:00:00Z',
    });
    expect(result.ok).toBe(false);
  });

  it('should reject invalid timezone', () => {
    const result = validateEventSchema({ ...valid, timezone: 'Not/AZone' });
    expect(result.ok).toBe(false);
  });

  it('should reject negative workload minutes', () => {
    expect(validateEventSchema({ ...valid, student_effort_minutes: -5 }).ok).toBe(false);
    expect(validateEventSchema({ ...valid, marker_minutes: -1 }).ok).toBe(false);
  });

  it('should reject self feedback dependency', () => {
    const result = validateEventSchema({ ...valid, id: 7, requires_feedback_from_event_id: 7 });
    expect(result.ok).toBe(false);
  });

  it('should reject non-integer cohort_ids', () => {
    const result = validateEventSchema({ ...valid, cohort_ids: ['abc'] });
    expect(result.ok).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════
// SAME-COHORT DEADLINE QUERY
// ═══════════════════════════════════════════════════════════════════

describe('Calendar — same-cohort deadline query', () => {
  it('should group events by cohort and sort by start', () => {
    const result = queryCohortDeadlines([
      { id: 1, title: 'Late', cohort_ids: [10], start_at: '2026-09-05T09:00:00Z' },
      { id: 2, title: 'Early', cohort_ids: [10, 20], start_at: '2026-09-01T09:00:00Z' },
      { id: 3, title: 'Other cohort only', cohort_ids: [30], start_at: '2026-09-02T09:00:00Z' },
    ]);
    const c10 = result.find((r) => r.cohortId === 10);
    expect(c10.deadlines[0].id).toBe(2);
    expect(c10.deadlines[1].id).toBe(1);
    const c30 = result.find((r) => r.cohortId === 30);
    expect(c30.deadlines).toHaveLength(1);
  });

  it('should return empty when no cohorts', () => {
    expect(queryCohortDeadlines([{ id: 1, cohort_ids: [] }])).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════
// HARD CLASH VALIDATOR
// ═══════════════════════════════════════════════════════════════════

describe('Calendar — hard clash validator', () => {
  const eventA = {
    id: 1, title: 'Exam A', start_at: '2026-09-01T09:00:00Z', end_at: '2026-09-01T11:00:00Z',
    cohort_ids: [10], marker_user_id: 100, moderator_user_id: 200, room_id: 'R1',
  };
  const eventB = {
    id: 2, title: 'Exam B', start_at: '2026-09-01T10:00:00Z', end_at: '2026-09-01T12:00:00Z',
    cohort_ids: [10], marker_user_id: 100, room_id: 'R1',
  };
  const eventC = {
    id: 3, title: 'Exam C', start_at: '2026-09-02T09:00:00Z', end_at: '2026-09-02T11:00:00Z',
    cohort_ids: [11], marker_user_id: 300, room_id: 'R2',
  };

  it('should detect no clash for non-overlapping events', () => {
    const result = validateExamHardClash([eventA, eventC]);
    expect(result.ok).toBe(true);
    expect(result.clashes).toEqual([]);
  });

  it('should detect same-cohort overlap (direct clash blocker)', () => {
    const result = validateExamHardClash([eventA, eventB]);
    expect(result.ok).toBe(false);
    const cohort = result.clashes.find((c) => c.type === 'cohort_overlap');
    expect(cohort).toBeDefined();
    expect(cohort.sharedCohorts).toContain(10);
  });

  it('should detect marker double-book', () => {
    const result = validateExamHardClash([eventA, eventB]);
    const marker = result.clashes.find((c) => c.type === 'marker_double_book');
    expect(marker).toBeDefined();
    expect(marker.detail).toContain('100');
  });

  it('should detect room conflict', () => {
    const result = validateExamHardClash([eventA, eventB]);
    const room = result.clashes.find((c) => c.type === 'room_conflict');
    expect(room).toBeDefined();
    expect(room.detail).toContain('R1');
  });

  it('should detect moderator double-book', () => {
    const b = { ...eventB, moderator_user_id: 200 };
    const result = validateExamHardClash([eventA, b]);
    const mod = result.clashes.find((c) => c.type === 'moderator_double_book');
    expect(mod).toBeDefined();
  });

  it('eventsOverlap should be exact', () => {
    expect(eventsOverlap(eventA, eventB)).toBe(true);
    expect(eventsOverlap(eventA, eventC)).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════
// FEEDBACK-BEFORE-NEXT-TASK
// ═══════════════════════════════════════════════════════════════════

describe('Calendar — feedback dependency', () => {
  const source = { id: 1, title: 'Essay 1', end_at: '2026-09-01T12:00:00Z' };
  // default buffer = 3 days → feedback ready 2026-09-04T12:00:00Z

  it('should allow when next task starts after feedback + buffer', () => {
    const next = { id: 2, title: 'Essay 2', start_at: '2026-09-05T09:00:00Z', requires_feedback_from_event_id: 1 };
    const result = validateFeedbackDependency([source, next]);
    expect(result.ok).toBe(true);
  });

  it('should block when next task starts too early (before feedback buffer)', () => {
    const next = { id: 2, title: 'Essay 2', start_at: '2026-09-02T09:00:00Z', requires_feedback_from_event_id: 1 };
    const result = validateFeedbackDependency([source, next]);
    expect(result.ok).toBe(false);
    expect(result.violations[0].detail.toLowerCase()).toContain('feedback');
    expect(result.violations[0].detail).toContain('too early');
  });

  it('should respect custom buffer', () => {
    const next = { id: 2, title: 'Essay 2', start_at: '2026-09-02T09:00:00Z', requires_feedback_from_event_id: 1 };
    expect(validateFeedbackDependency([source, next], { feedbackBufferDays: 0 }).ok).toBe(true);
  });

  it('should flag missing source event', () => {
    const next = { id: 2, title: 'X', start_at: '2026-09-05T09:00:00Z', requires_feedback_from_event_id: 999 };
    const result = validateFeedbackDependency([next]);
    expect(result.ok).toBe(false);
    expect(result.violations[0].detail).toContain('999');
  });
});

// ═══════════════════════════════════════════════════════════════════
// MARKER CAPACITY
// ═══════════════════════════════════════════════════════════════════

describe('Calendar — marker capacity', () => {
  it('should warn when marker exceeds daily capacity', () => {
    const events = [
      { id: 1, marker_user_id: 100, marker_minutes: 300, start_at: '2026-09-01T09:00:00Z' },
      { id: 2, marker_user_id: 100, marker_minutes: 300, start_at: '2026-09-01T14:00:00Z' },
    ];
    const result = checkMarkerCapacity(events, { capacityMinutes: 480 });
    expect(result.ok).toBe(false);
    expect(result.warnings[0].detail).toContain('100');
    expect(result.warnings[0].totalMinutes).toBe(600);
  });

  it('should not warn within capacity', () => {
    const events = [{ id: 1, marker_user_id: 100, marker_minutes: 240, start_at: '2026-09-01T09:00:00Z' }];
    const result = checkMarkerCapacity(events, { capacityMinutes: 480 });
    expect(result.ok).toBe(true);
  });

  it('should separate days', () => {
    const events = [
      { id: 1, marker_user_id: 100, marker_minutes: 400, start_at: '2026-09-01T09:00:00Z' },
      { id: 2, marker_user_id: 100, marker_minutes: 400, start_at: '2026-09-02T09:00:00Z' },
    ];
    const result = checkMarkerCapacity(events, { capacityMinutes: 480 });
    expect(result.ok).toBe(true);
  });

  it('should track moderator workload too', () => {
    const events = [
      { id: 1, moderator_user_id: 50, moderation_minutes: 500, start_at: '2026-09-01T09:00:00Z' },
    ];
    const result = checkMarkerCapacity(events, { capacityMinutes: 480 });
    expect(result.ok).toBe(false);
    expect(result.warnings[0].role).toBe('moderator');
  });
});

// ═══════════════════════════════════════════════════════════════════
// WHAT-IF MOVE IMPACT (consistency test)
// ═══════════════════════════════════════════════════════════════════

describe('Calendar — what-if move impact', () => {
  const schedule = [
    {
      id: 1, title: 'Exam A', start_at: '2026-09-01T09:00:00Z', end_at: '2026-09-01T11:00:00Z',
      cohort_ids: [10], marker_user_id: 100, timezone: 'Asia/Tashkent',
    },
    {
      id: 2, title: 'Exam B', start_at: '2026-09-02T09:00:00Z', end_at: '2026-09-02T11:00:00Z',
      cohort_ids: [10], marker_user_id: 200, timezone: 'Asia/Tashkent',
    },
  ];

  it('should report ok when moving to a clash-free window', () => {
    const result = computeWhatIfImpact({
      events: schedule,
      movingEventId: 2,
      newStart: '2026-09-03T09:00:00Z',
      newEnd: '2026-09-03T11:00:00Z',
    });
    expect(result.ok).toBe(true);
    expect(result.impact.wouldClash).toBe(false);
    expect(result.impact.affectedCohorts).toContain(10);
    expect(result.impact.summary.clashCount).toBe(0);
  });

  it('should detect clash when moving into an overlapping window (consistency: validator agrees)', () => {
    const result = computeWhatIfImpact({
      events: schedule,
      movingEventId: 2,
      newStart: '2026-09-01T10:00:00Z',
      newEnd: '2026-09-01T12:00:00Z',
    });
    expect(result.ok).toBe(false);
    expect(result.impact.wouldClash).toBe(true);
    expect(result.impact.summary.clashCount).toBeGreaterThan(0);
    // Consistency: the produced new schedule must also fail the raw validator
    const rawCheck = validateExamHardClash(result.newSchedule);
    expect(rawCheck.ok).toBe(false);
    expect(result.impact.hardClashes[0].type).toBe('cohort_overlap');
  });

  it('should detect marker double-book in what-if', () => {
    const result = computeWhatIfImpact({
      events: schedule,
      movingEventId: 2,
      newStart: '2026-09-01T09:00:00Z',
      newEnd: '2026-09-01T11:00:00Z',
    });
    // moving event 2 (marker 200) to overlap event 1 (marker 100) — different
    // markers, so only cohort overlap. Then force same marker:
    const withSameMarker = schedule.map((e) => (e.id === 2 ? { ...e, marker_user_id: 100 } : e));
    const r2 = computeWhatIfImpact({
      events: withSameMarker,
      movingEventId: 2,
      newStart: '2026-09-01T09:00:00Z',
      newEnd: '2026-09-01T11:00:00Z',
    });
    expect(r2.impact.hardClashes.some((c) => c.type === 'marker_double_book')).toBe(true);
    expect(result.impact.hardClashes.some((c) => c.type === 'cohort_overlap')).toBe(true);
  });

  it('should error when movingEventId not found', () => {
    const result = computeWhatIfImpact({
      events: schedule,
      movingEventId: 999,
      newStart: '2026-09-03T09:00:00Z',
      newEnd: '2026-09-03T11:00:00Z',
    });
    expect(result.ok).toBe(false);
    expect(result.impact.error).toContain('999');
  });

  it('should preserve other events unchanged in newSchedule', () => {
    const result = computeWhatIfImpact({
      events: schedule,
      movingEventId: 2,
      newStart: '2026-09-03T09:00:00Z',
      newEnd: '2026-09-03T11:00:00Z',
    });
    const unchanged = result.newSchedule.find((e) => e.id === 1);
    expect(unchanged.start_at).toBe('2026-09-01T09:00:00Z');
  });
});

// ═══════════════════════════════════════════════════════════════════
// ICS + DATE-CHANGE NOTIFICATION
// ═══════════════════════════════════════════════════════════════════

describe('Calendar — ICS generation & date-change notification', () => {
  const event = {
    id: 42,
    title: 'Math Final',
    description: 'Closed book',
    room_id: 'Hall A',
    start_at: '2026-09-01T09:00:00Z',
    end_at: '2026-09-01T11:00:00Z',
    timezone: 'Asia/Tashkent',
    status: 'published',
  };

  it('should generate a valid RFC 5545 ICS with UTC times', () => {
    const ics = generateIcsEvent(event);
    expect(ics).toContain('BEGIN:VCALENDAR');
    expect(ics).toContain('END:VCALENDAR');
    expect(ics).toContain('BEGIN:VEVENT');
    expect(ics).toContain('UID:deborah-event-42-');
    // UTC + Z — RFC 5545 correct; clients render the same instant in any zone
    expect(ics).toContain('DTSTART:20260901T090000Z');
    expect(ics).toContain('DTEND:20260901T110000Z');
    expect(ics).toContain('STATUS:CONFIRMED');
    expect(ics).toContain('LOCATION:Hall A');
    expect(ics).toContain('SUMMARY:Math Final');
    expect(ics).not.toContain('TZID');
  });

  it('should mark non-published events TENTATIVE', () => {
    const ics = generateIcsEvent({ ...event, status: 'draft' });
    expect(ics).toContain('STATUS:TENTATIVE');
  });

  it('should escape ICS text', () => {
    expect(escapeIcsText('a,b;c\\d')).toBe('a\\,b\\;c\\\\d');
    expect(escapeIcsText('line1\nline2')).toBe('line1\\nline2');
  });

  it('should format ICS time in UTC with Z', () => {
    expect(formatIcsTime(new Date('2026-09-01T09:05:07Z'))).toBe('20260901T090507Z');
  });

  it('should format local wall time in a timezone (Tashkent = UTC+5)', () => {
    // 09:00 UTC → 14:00 in Asia/Tashkent (UTC+5, no DST)
    expect(formatLocalIcsTime(new Date('2026-09-01T09:00:00Z'), 'Asia/Tashkent'))
      .toBe('20260901T140000');
  });

  it('should throw on missing dates', () => {
    expect(() => generateIcsEvent({ id: 1, title: 'X' })).toThrow('start_at');
  });

  it('buildDateChangePayload should capture before/after', () => {
    const payload = buildDateChangePayload(
      { start_at: '2026-09-01T09:00:00Z', end_at: '2026-09-01T11:00:00Z', timezone: 'Asia/Tashkent' },
      { start_at: '2026-09-03T09:00:00Z', end_at: '2026-09-03T11:00:00Z', timezone: 'Asia/Tashkent' },
      'Math Final'
    );
    expect(payload.old_start).toBe('2026-09-01T09:00:00Z');
    expect(payload.new_start).toBe('2026-09-03T09:00:00Z');
    expect(payload.title).toBe('Math Final');
  });
});

// ═══════════════════════════════════════════════════════════════════
// DATE-CHANGE NOTIFICATION DECISION
// ═══════════════════════════════════════════════════════════════════

describe('Calendar — date-change notification decision', () => {
  it('should notify when a scheduled event window changes', () => {
    expect(shouldQueueDateChangeNotification('scheduled', true)).toBe(true);
  });

  it('should not notify drafts (invisible to students)', () => {
    expect(shouldQueueDateChangeNotification('draft', true)).toBe(false);
    expect(shouldQueueDateChangeNotification('draft', false)).toBe(false);
  });

  it('should not notify when window unchanged', () => {
    expect(shouldQueueDateChangeNotification('scheduled', false)).toBe(false);
  });

  it('should not notify published events (immutable — updates rejected upstream)', () => {
    expect(shouldQueueDateChangeNotification('published', true)).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════
// SERVICE (graceful degradation without PostgreSQL)
// ═══════════════════════════════════════════════════════════════════

describe('Calendar — Service (graceful degradation)', () => {
  it('createProgramEvent should reject without PostgreSQL', async () => {
    await expect(createProgramEvent({ title: 'E' })).rejects.toThrow('PostgreSQL required');
  });

  it('updateProgramEvent should reject without PostgreSQL', async () => {
    await expect(updateProgramEvent(1, { title: 'X' })).rejects.toThrow('PostgreSQL required');
  });

  it('archiveProgramEvent should reject without PostgreSQL', async () => {
    await expect(archiveProgramEvent(1, 1)).rejects.toThrow('PostgreSQL required');
  });

  it('transitionProgramEvent should reject without PostgreSQL', async () => {
    await expect(transitionProgramEvent(1, { to: 'published' })).rejects.toThrow('PostgreSQL required');
  });

  it('markNotificationSent should reject without PostgreSQL', async () => {
    await expect(markNotificationSent(1, 1)).rejects.toThrow('PostgreSQL required');
  });

  it('getProgramEvent should return null without PostgreSQL', async () => {
    expect(await getProgramEvent(1)).toBeNull();
  });

  it('listProgramEvents should return [] without PostgreSQL', async () => {
    expect(await listProgramEvents()).toEqual([]);
  });

  it('listCohortEvents should return [] without PostgreSQL', async () => {
    expect(await listCohortEvents(10)).toEqual([]);
  });

  it('listEventNotifications should return [] without PostgreSQL', async () => {
    expect(await listEventNotifications(1)).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════
// BARREL EXPORT
// ═══════════════════════════════════════════════════════════════════

describe('Calendar — Barrel Export', () => {
  it('should export all expected functions and constants', async () => {
    const mod = await import('../../src/modules/calendar/index.js');
    const expected = [
      // schema
      'EVENT_TYPES', 'EVENT_STATUS', 'EVENT_STATUS_TRANSITIONS',
      'NOTIFICATION_CHANGE_TYPES', 'NOTIFICATION_RECIPIENT_SCOPES',
      'DEFAULT_TIMEZONE', 'DEFAULT_MARKER_CAPACITY_MINUTES', 'DEFAULT_FEEDBACK_BUFFER_DAYS',
      'isValidTimezone', 'normalizeEventTimes', 'validateEventSchema',
      'queryCohortDeadlines', 'eventsOverlap', 'validateExamHardClash',
      'validateFeedbackDependency', 'checkMarkerCapacity', 'computeWhatIfImpact',
      'generateIcsEvent', 'escapeIcsText', 'formatIcsTime', 'formatLocalIcsTime',
      'buildDateChangePayload', 'shouldQueueDateChangeNotification',
      // service
      'createProgramEvent', 'getProgramEvent', 'listProgramEvents', 'updateProgramEvent',
      'archiveProgramEvent', 'transitionProgramEvent', 'listCohortEvents',
      'listEventNotifications', 'markNotificationSent',
    ];
    for (const exp of expected) {
      expect(mod[exp], `Missing export: ${exp}`).toBeDefined();
    }
  });
});
