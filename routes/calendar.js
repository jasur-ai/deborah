/**
 * Edikit — Program Calendar & Workload API Routes
 *
 * REST API for Prompt 26:
 *   - Program event CRUD (draft → scheduled → published, hard-clash-gated)
 *   - Same-cohort deadline queries
 *   - Pure helpers: clash validation, feedback dependency, marker capacity,
 *     what-if move impact, ICS generation
 *   - Notification outbox (ICS/timezone/date-change flow)
 *
 * Date publish guard: dates are NEVER auto-published — publish requires an
 * explicit POST /:id/transition to "published" which runs the hard clash
 * validator and refuses on any clash.
 */

import { Router } from 'express';
import {
  // schema (pure)
  EVENT_TYPES,
  EVENT_STATUS,
  EVENT_STATUS_TRANSITIONS,
  NOTIFICATION_CHANGE_TYPES,
  NOTIFICATION_RECIPIENT_SCOPES,
  isValidTimezone,
  validateEventSchema,
  queryCohortDeadlines,
  validateExamHardClash,
  validateFeedbackDependency,
  checkMarkerCapacity,
  computeWhatIfImpact,
  generateIcsEvent,
  buildDateChangePayload,
  DEFAULT_MARKER_CAPACITY_MINUTES,
  DEFAULT_FEEDBACK_BUFFER_DAYS,
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
} from '../src/modules/calendar/index.js';

const router = Router();

function actorId(req) {
  return req.session?.user?.id || req.session?.admin?.id || null;
}

// ═══════════════════════════════════════════════════════════════════
// META / CONSTANTS
// ═══════════════════════════════════════════════════════════════════

/** GET /api/calendar/meta — event types, statuses, notification config. */
router.get('/api/calendar/meta', (req, res) => {
  res.json({
    eventTypes: EVENT_TYPES,
    statuses: EVENT_STATUS,
    transitions: EVENT_STATUS_TRANSITIONS,
    notificationChangeTypes: NOTIFICATION_CHANGE_TYPES,
    recipientScopes: NOTIFICATION_RECIPIENT_SCOPES,
    defaultMarkerCapacityMinutes: DEFAULT_MARKER_CAPACITY_MINUTES,
    defaultFeedbackBufferDays: DEFAULT_FEEDBACK_BUFFER_DAYS,
  });
});

// ═══════════════════════════════════════════════════════════════════
// PURE HELPERS
// ═══════════════════════════════════════════════════════════════════

/** POST /api/calendar/validate — validate an event object. */
router.post('/api/calendar/validate', (req, res) => {
  try {
    res.json(validateEventSchema(req.body?.event || {}));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/** POST /api/calendar/timezone/validate — validate an IANA timezone. */
router.post('/api/calendar/timezone/validate', (req, res) => {
  try {
    const { timezone } = req.body || {};
    res.json({ valid: isValidTimezone(timezone), timezone });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/** POST /api/calendar/clash-check — hard clash validator over a schedule. */
router.post('/api/calendar/clash-check', (req, res) => {
  try {
    res.json(validateExamHardClash(req.body?.events || []));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/** POST /api/calendar/cohort-deadlines — group events by cohort, sorted. */
router.post('/api/calendar/cohort-deadlines', (req, res) => {
  try {
    res.json(queryCohortDeadlines(req.body?.events || []));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/** POST /api/calendar/feedback-check — feedback-before-next-task dependency. */
router.post('/api/calendar/feedback-check', (req, res) => {
  try {
    const { events, feedbackBufferDays } = req.body || {};
    res.json(validateFeedbackDependency(events || [], { feedbackBufferDays }));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/** POST /api/calendar/capacity-check — marker/moderation capacity warnings. */
router.post('/api/calendar/capacity-check', (req, res) => {
  try {
    const { events, capacityMinutes } = req.body || {};
    res.json(checkMarkerCapacity(events || [], { capacityMinutes }));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/** POST /api/calendar/what-if — what-if move impact before committing. */
router.post('/api/calendar/what-if', (req, res) => {
  try {
    const { events, movingEventId, newStart, newEnd, opts } = req.body || {};
    res.json(computeWhatIfImpact({ events: events || [], movingEventId, newStart, newEnd, opts }));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/** POST /api/calendar/ics — generate RFC 5545 ICS for an event object. */
router.post('/api/calendar/ics', (req, res) => {
  try {
    const ics = generateIcsEvent(req.body?.event || {});
    res.type('text/calendar').send(ics);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════════
// PROGRAM EVENTS
// ═══════════════════════════════════════════════════════════════════

/** POST /api/calendar/events — create (idempotent via external_key). */
router.post('/api/calendar/events', async (req, res) => {
  try {
    const result = await createProgramEvent({ ...req.body, created_by: actorId(req) });
    res.status(201).json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/** GET /api/calendar/events — list with filters. */
router.get('/api/calendar/events', async (req, res) => {
  try {
    res.json(await listProgramEvents({
      term_id: req.query.term_id ? parseInt(req.query.term_id, 10) : undefined,
      status: req.query.status,
      event_type: req.query.event_type,
      from: req.query.from,
      to: req.query.to,
      limit: parseInt(req.query.limit || '100', 10),
      offset: parseInt(req.query.offset || '0', 10),
    }));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/** GET /api/calendar/events/:id — detail with cohort_ids + notifications. */
router.get('/api/calendar/events/:id', async (req, res) => {
  try {
    const event = await getProgramEvent(parseInt(req.params.id, 10));
    if (!event) return res.status(404).json({ error: 'Event not found' });
    const notifications = await listEventNotifications(event.id, { limit: 20 });
    res.json({ ...event, notifications });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/** PATCH /api/calendar/events/:id — update; returns what-if impact on window change. */
router.patch('/api/calendar/events/:id', async (req, res) => {
  try {
    res.json(await updateProgramEvent(parseInt(req.params.id, 10), {
      ...req.body,
      updated_by: actorId(req),
    }));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/** DELETE /api/calendar/events/:id — archive (soft). */
router.delete('/api/calendar/events/:id', async (req, res) => {
  try {
    res.json(await archiveProgramEvent(parseInt(req.params.id, 10), actorId(req)));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/** POST /api/calendar/events/:id/transition — status change (draft→scheduled→published). */
router.post('/api/calendar/events/:id/transition', async (req, res) => {
  try {
    const { to, confirmImpact } = req.body || {};
    res.json(await transitionProgramEvent(parseInt(req.params.id, 10), {
      to,
      confirmImpact: confirmImpact === true,
      userId: actorId(req),
    }));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════════
// COHORT DEADLINES
// ═══════════════════════════════════════════════════════════════════

/** GET /api/calendar/cohorts/:groupId/events — same-cohort deadline query. */
router.get('/api/calendar/cohorts/:groupId/events', async (req, res) => {
  try {
    const events = await listCohortEvents(parseInt(req.params.groupId, 10));
    res.json({ groupId: parseInt(req.params.groupId, 10), events });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════════
// NOTIFICATIONS (ICS/timezone/date-change outbox)
// ═══════════════════════════════════════════════════════════════════

/** GET /api/calendar/notifications — list across events (optionally by event_id). */
router.get('/api/calendar/notifications', async (req, res) => {
  try {
    if (!req.query.event_id) {
      return res.status(400).json({ error: 'event_id query param required' });
    }
    res.json(await listEventNotifications(parseInt(req.query.event_id, 10), {
      status: req.query.status,
      limit: parseInt(req.query.limit || '100', 10),
    }));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/** POST /api/calendar/notifications/:id/sent — delivery acknowledgement. */
router.post('/api/calendar/notifications/:id/sent', async (req, res) => {
  try {
    res.json(await markNotificationSent(parseInt(req.params.id, 10), actorId(req)));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

export default router;
