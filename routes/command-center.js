/**
 * Deborah — Exam Command Center, Incident & Notifications API Routes
 *
 * Prompt 41 REST API:
 *   - Command-center snapshot read model (room cards + attendance + open
 *     incidents) — §53.4 dashboard
 *   - Incident lifecycle: create (idempotent external_key), transition state
 *     machine, assign owner, add actions (pause/extension/evacuation hooks),
 *     close with guard (owner + action + reason)
 *   - Notification outbox: idempotent mass queue, delivery status, old
 *     schedule invalidation (superseded_by)
 *   - Postmortem & action-item workflow
 *   - Admin UI page: /admin/command-center
 *
 * Security:
 *   - /api/admin/* → requireAdmin (privileged)
 *   - Outbox payload faqat buildNotificationPreview whitelistidan o'tadi —
 *     sensitive health/integrity/answer-key detail hech qachon (Prompt 41 §15)
 *   - Har bir write path tenant-scoped + idempotency (external_key /
 *     idempotency_key); privileged actionlar audit qilinadi
 */

import { Router } from 'express';
import { requireAdmin } from '../middleware/auth.js';
import {
  // schema (pure)
  INCIDENT_TYPES,
  INCIDENT_SEVERITIES,
  INCIDENT_STATUS,
  INCIDENT_STATUS_TRANSITIONS,
  INCIDENT_ACTION_TYPES,
  NOTIFICATION_CHANNELS,
  NOTIFICATION_RECIPIENT_SCOPES,
  NOTIFICATION_TEMPLATES,
  NOTIFICATION_STATUS,
  POSTMORTEM_STATUS,
  ACTION_ITEM_STATUS,
  // service
  createIncident,
  getIncident,
  listIncidents,
  transitionIncident,
  assignIncidentOwner,
  addIncidentAction,
  getCommandCenterSnapshot,
  queueNotifications,
  updateNotificationStatus,
  listNotifications,
  createPostmortem,
  transitionPostmortem,
  listPostmortems,
  addActionItem,
  transitionActionItem,
  listActionItems,
} from '../src/modules/command-center/index.js';

const router = Router();

function actorId(req) {
  return req.session?.admin?.id || req.session?.user?.id || null;
}

// ═══════════════════════════════════════════════════════════════════
// META / CONSTANTS
// ═══════════════════════════════════════════════════════════════════

/** GET /api/admin/command-center/meta — constants for the admin UI. */
router.get('/api/admin/command-center/meta', requireAdmin, (req, res) => {
  res.json({
    incidentTypes: INCIDENT_TYPES,
    incidentSeverities: INCIDENT_SEVERITIES,
    incidentStatus: INCIDENT_STATUS,
    incidentTransitions: INCIDENT_STATUS_TRANSITIONS,
    incidentActionTypes: INCIDENT_ACTION_TYPES,
    notificationChannels: NOTIFICATION_CHANNELS,
    recipientScopes: NOTIFICATION_RECIPIENT_SCOPES,
    templates: NOTIFICATION_TEMPLATES,
    notificationStatus: NOTIFICATION_STATUS,
    postmortemStatus: POSTMORTEM_STATUS,
    actionItemStatus: ACTION_ITEM_STATUS,
  });
});

// ═══════════════════════════════════════════════════════════════════
// COMMAND-CENTER SNAPSHOT (§53.4 dashboard read model)
// ═══════════════════════════════════════════════════════════════════

/** GET /api/admin/command-center/snapshot — room/attendance/incident cards. */
router.get('/api/admin/command-center/snapshot', requireAdmin, async (req, res) => {
  try {
    const snapshot = await getCommandCenterSnapshot({
      runId: req.query.runId ? Number(req.query.runId) : undefined,
    });
    res.json({ ok: true, snapshot });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════════
// INCIDENTS
// ═══════════════════════════════════════════════════════════════════

/** POST /api/admin/incidents — create an incident (idempotent external_key). */
router.post('/api/admin/incidents', requireAdmin, async (req, res) => {
  try {
    const r = await createIncident({ data: req.body || {}, userId: actorId(req) });
    res.json(r);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/** GET /api/admin/incidents — list incidents (filter by status/run/room). */
router.get('/api/admin/incidents', requireAdmin, async (req, res) => {
  try {
    const rows = await listIncidents({
      status: req.query.status,
      runId: req.query.runId ? Number(req.query.runId) : undefined,
      roomId: req.query.roomId ? Number(req.query.roomId) : undefined,
    });
    res.json({ ok: true, incidents: rows });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/** GET /api/admin/incidents/:id — single incident + actions. */
router.get('/api/admin/incidents/:id', requireAdmin, async (req, res) => {
  try {
    const incident = await getIncident(Number(req.params.id));
    if (!incident) return res.status(404).json({ error: 'Incident not found' });
    res.json({ ok: true, incident });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/** POST /api/admin/incidents/:id/transition — state machine step. */
router.post('/api/admin/incidents/:id/transition', requireAdmin, async (req, res) => {
  try {
    const r = await transitionIncident({
      id: Number(req.params.id),
      to: req.body?.to,
      reason: req.body?.reason || '',
      userId: actorId(req),
    });
    res.json(r);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/** POST /api/admin/incidents/:id/owner — assign remedy owner (§24). */
router.post('/api/admin/incidents/:id/owner', requireAdmin, async (req, res) => {
  try {
    const r = await assignIncidentOwner({
      id: Number(req.params.id),
      ownerUserId: req.body?.ownerUserId,
      userId: actorId(req),
    });
    res.json(r);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/** POST /api/admin/incidents/:id/actions — pause/extension/evacuation/notify/remedy. */
router.post('/api/admin/incidents/:id/actions', requireAdmin, async (req, res) => {
  try {
    const r = await addIncidentAction({
      id: Number(req.params.id),
      actionType: req.body?.actionType,
      detail: req.body?.detail || {},
      actorUserId: actorId(req),
      evidenceNote: req.body?.evidenceNote,
      clientKey: req.body?.clientKey,
    });
    res.json(r);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════════
// NOTIFICATIONS (outbox)
// ═══════════════════════════════════════════════════════════════════

/** POST /api/admin/notifications — queue a mass notification batch. */
router.post('/api/admin/notifications', requireAdmin, async (req, res) => {
  try {
    const r = await queueNotifications({
      channel: req.body?.channel,
      recipientScope: req.body?.recipientScope || 'staff',
      templateKey: req.body?.templateKey,
      payload: req.body?.payload || {},
      batchKey: req.body?.batchKey,
      recipientKeys: req.body?.recipientKeys || [],
      incidentId: req.body?.incidentId ? Number(req.body.incidentId) : null,
      supersedeOld: Boolean(req.body?.supersedeOld),
      userId: actorId(req),
    });
    res.json(r);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/** POST /api/admin/notifications/:id/status — delivery status update. */
router.post('/api/admin/notifications/:id/status', requireAdmin, async (req, res) => {
  try {
    const r = await updateNotificationStatus({
      id: Number(req.params.id),
      status: req.body?.status,
      deliveryInfo: { ...(req.body?.deliveryInfo || {}), actorUserId: actorId(req) },
    });
    res.json(r);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/** GET /api/admin/notifications — list outbox (by incident/status). */
router.get('/api/admin/notifications', requireAdmin, async (req, res) => {
  try {
    const rows = await listNotifications({
      incidentId: req.query.incidentId ? Number(req.query.incidentId) : undefined,
      status: req.query.status,
    });
    res.json({ ok: true, notifications: rows });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════════
// POSTMORTEM & ACTION ITEMS
// ═══════════════════════════════════════════════════════════════════

/** POST /api/admin/postmortems — create postmortem for an incident. */
router.post('/api/admin/postmortems', requireAdmin, async (req, res) => {
  try {
    const r = await createPostmortem({ data: req.body || {}, userId: actorId(req) });
    res.json(r);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/** POST /api/admin/postmortems/:id/transition — draft → reviewed → closed. */
router.post('/api/admin/postmortems/:id/transition', requireAdmin, async (req, res) => {
  try {
    const r = await transitionPostmortem({
      id: Number(req.params.id),
      to: req.body?.to,
      userId: actorId(req),
    });
    res.json(r);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/** GET /api/admin/postmortems — list (by incident). */
router.get('/api/admin/postmortems', requireAdmin, async (req, res) => {
  try {
    const rows = await listPostmortems({
      incidentId: req.query.incidentId ? Number(req.query.incidentId) : undefined,
    });
    res.json({ ok: true, postmortems: rows });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/** POST /api/admin/action-items — add action item to a postmortem. */
router.post('/api/admin/action-items', requireAdmin, async (req, res) => {
  try {
    const r = await addActionItem({ data: req.body || {}, userId: actorId(req) });
    res.json(r);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/** POST /api/admin/action-items/:id/transition — open → in_progress → done|blocked. */
router.post('/api/admin/action-items/:id/transition', requireAdmin, async (req, res) => {
  try {
    const r = await transitionActionItem({
      id: Number(req.params.id),
      to: req.body?.to,
      userId: actorId(req),
    });
    res.json(r);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/** GET /api/admin/action-items — list (by postmortem/status). */
router.get('/api/admin/action-items', requireAdmin, async (req, res) => {
  try {
    const rows = await listActionItems({
      postmortemId: req.query.postmortemId ? Number(req.query.postmortemId) : undefined,
      status: req.query.status,
    });
    res.json({ ok: true, actionItems: rows });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════════
// UI PAGE
// ═══════════════════════════════════════════════════════════════════

/** GET /admin/command-center — exam-day command center UI. */
router.get('/admin/command-center', (req, res) => {
  if (!req.session?.admin) return res.redirect('/admin/login');
  res.render('admin/command-center', {
    title: 'Imtihon boshqaruv markazi',
    admin: req.session.admin,
  });
});

export default router;
