/**
 * Edikit — Seat, Proctor, Hall Ticket & Check-in API Routes
 *
 * Prompt 40 REST API:
 *   - Room seat-map CRUD (room_seat_maps, versioned) — validate layout
 *   - Seat allocation: run → per-student seat assignments (random /
 *     variant-separated / accommodation-aware, deterministic seed)
 *   - Proctor duty allocation (no same-period clash, workload fairness)
 *   - Hall ticket: signed QR payload + student acknowledgement
 *   - Offline check-in journal (checkin_journal, client_seq idempotent)
 *   - Reseat / replacement audit (reason CODES only)
 *   - Room / proctor register export (NO answer keys)
 *   - Admin UI page: /admin/seating
 *
 * Security:
 *   - /api/admin/* → requireAdmin (privileged: seat-maps, allocate, reseat)
 *   - Hall-ticket QR payload answer key yoki raw sensitive reason saqlamaydi
 *   - Reseat reason faqat kodlar (validateReseatReason); raw rationale yo'q
 *   - Har bir write path tenant-scoped + client_seq idempotent
 */

import { Router } from 'express';
import { requireAdmin } from '../middleware/auth.js';
import {
  // schema (pure)
  RESEAT_REASONS,
  CHECKIN_EVENT_TYPES,
  // service
  upsertSeatMap,
  getActiveSeatMap,
  listSeatMaps,
  allocateSeatAssignments,
  listSeatAssignments,
  getSeatAssignmentById,
  getStudentHallTicket,
  allocateProctorDutiesForRun,
  listProctorDuties,
  acknowledgeProctorDuty,
  acknowledgeHallTicket,
  applyCheckinJournal,
  getCheckinJournal,
  reseatStudent,
  listReseatAudit,
  exportRoomRegister,
  exportProctorRegister,
} from '../src/modules/seating/index.js';

const router = Router();

function actorId(req) {
  return req.session?.admin?.id || req.session?.user?.id || null;
}

// ═══════════════════════════════════════════════════════════════════
// META / CONSTANTS
// ═══════════════════════════════════════════════════════════════════

/** GET /api/admin/seating/meta — constants for the admin UI. */
router.get('/api/admin/seating/meta', requireAdmin, (req, res) => {
  res.json({ reseatReasons: RESEAT_REASONS, checkinEventTypes: CHECKIN_EVENT_TYPES });
});

// ═══════════════════════════════════════════════════════════════════
// ROOM SEAT-MAPS
// ═══════════════════════════════════════════════════════════════════

/** GET /api/admin/seating/seat-maps — list active seat-maps (optionally per room). */
router.get('/api/admin/seating/seat-maps', requireAdmin, async (req, res) => {
  try {
    const maps = await listSeatMaps({ roomId: req.query.roomId ? Number(req.query.roomId) : undefined });
    res.json({ ok: true, seatMaps: maps });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/** GET /api/admin/seating/seat-maps/:roomId — active seat-map for a room. */
router.get('/api/admin/seating/seat-maps/:roomId', requireAdmin, async (req, res) => {
  try {
    const map = await getActiveSeatMap(Number(req.params.roomId));
    if (!map) return res.status(404).json({ error: 'Seat map not found' });
    res.json({ ok: true, seatMap: map });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/** POST /api/admin/seating/seat-maps/:roomId — upsert (new version) seat-map. */
router.post('/api/admin/seating/seat-maps/:roomId', requireAdmin, async (req, res) => {
  try {
    const { layout } = req.body || {};
    const result = await upsertSeatMap({ roomId: Number(req.params.roomId), layout, userId: actorId(req) });
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════════
// SEAT ALLOCATION
// ═══════════════════════════════════════════════════════════════════

/** POST /api/admin/seating/allocate — seat assignment for a run+event. */
router.post('/api/admin/seating/allocate', requireAdmin, async (req, res) => {
  try {
    const { runId, assignment, studentAccommodations = [], seed = 1 } = req.body || {};
    if (!runId || !assignment) return res.status(400).json({ error: 'runId and assignment are required' });
    const seatMap = await getActiveSeatMap(Number(assignment.room_id));
    if (!seatMap) return res.status(400).json({ error: `No active seat map for room ${assignment.room_id}` });
    const result = await allocateSeatAssignments({
      runId: Number(runId),
      assignment: { ...assignment, room_id: Number(assignment.room_id), event_id: Number(assignment.event_id) },
      seatMap,
      studentAccommodations,
      seed: Number(seed) || 1,
      userId: actorId(req),
    });
    if (!result.ok) return res.status(400).json(result);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/** GET /api/admin/seating/assignments — list seat assignments. */
router.get('/api/admin/seating/assignments', requireAdmin, async (req, res) => {
  try {
    const rows = await listSeatAssignments({
      runId: req.query.runId ? Number(req.query.runId) : undefined,
      eventId: req.query.eventId ? Number(req.query.eventId) : undefined,
      roomId: req.query.roomId ? Number(req.query.roomId) : undefined,
    });
    res.json({ ok: true, assignments: rows });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/** GET /api/admin/seating/hall-ticket/:assignmentId — signed hall ticket. */
router.get('/api/admin/seating/hall-ticket/:assignmentId', requireAdmin, async (req, res) => {
  try {
    const row = await getSeatAssignmentById(Number(req.params.assignmentId));
    if (!row) return res.status(404).json({ error: 'Assignment not found' });
    const ticket = await getStudentHallTicket({
      runId: row.run_id,
      eventId: row.event_id,
      studentUserId: row.student_user_id,
    });
    if (!ticket) return res.status(404).json({ error: 'Hall ticket not found' });
    res.json({ ok: true, ticket });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════════
// PROCTOR DUTIES
// ═══════════════════════════════════════════════════════════════════

/** POST /api/admin/seating/proctors — proctor duty allocation. */
router.post('/api/admin/seating/proctors', requireAdmin, async (req, res) => {
  try {
    const { runId, assignments = [], proctors = [], seed = 1 } = req.body || {};
    if (!runId) return res.status(400).json({ error: 'runId is required' });
    const result = await allocateProctorDutiesForRun({
      runId: Number(runId),
      assignments,
      proctors,
      seed: Number(seed) || 1,
      userId: actorId(req),
    });
    if (!result.ok) return res.status(400).json(result);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/** GET /api/admin/seating/proctor-duties — list duties. */
router.get('/api/admin/seating/proctor-duties', requireAdmin, async (req, res) => {
  try {
    const rows = await listProctorDuties({
      runId: req.query.runId ? Number(req.query.runId) : undefined,
      periodId: req.query.periodId ? Number(req.query.periodId) : undefined,
    });
    res.json({ ok: true, duties: rows });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/** POST /api/admin/seating/proctors/:id/ack — proctor acknowledges duty. */
router.post('/api/admin/seating/proctors/:id/ack', requireAdmin, async (req, res) => {
  try {
    const result = await acknowledgeProctorDuty(Number(req.params.id), actorId(req));
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════════
// HALL TICKET ACK / CHECK-IN JOURNAL / RESEAT
// ═══════════════════════════════════════════════════════════════════

/** POST /api/admin/seating/hall-ticket/:assignmentId/ack — student ack. */
router.post('/api/admin/seating/hall-ticket/:assignmentId/ack', requireAdmin, async (req, res) => {
  try {
    const { studentUserId, seatMapVersion = 1 } = req.body || {};
    if (!studentUserId) return res.status(400).json({ error: 'studentUserId is required' });
    const result = await acknowledgeHallTicket({
      seatAssignmentId: Number(req.params.assignmentId),
      studentUserId: Number(studentUserId),
      seatMapVersion: Number(seatMapVersion) || 1,
    });
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/** POST /api/admin/seating/checkin/journal — offline-tolerant batch apply. */
router.post('/api/admin/seating/checkin/journal', requireAdmin, async (req, res) => {
  try {
    const { deviceId, entries = [] } = req.body || {};
    if (!deviceId) return res.status(400).json({ error: 'deviceId is required' });
    if (!Array.isArray(entries)) return res.status(400).json({ error: 'entries must be an array' });
    const result = await applyCheckinJournal({ deviceId, entries, userId: actorId(req) });
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/** GET /api/admin/seating/checkin/journal — read a device's journal. */
router.get('/api/admin/seating/checkin/journal', requireAdmin, async (req, res) => {
  try {
    const rows = await getCheckinJournal({ deviceId: req.query.deviceId });
    res.json({ ok: true, journal: rows });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/** POST /api/admin/seating/reseat — reseat/replacement with audit trail. */
router.post('/api/admin/seating/reseat', requireAdmin, async (req, res) => {
  try {
    const result = await reseatStudent({
      runId: Number(req.body.runId),
      studentUserId: Number(req.body.studentUserId),
      fromSeatAssignmentId: Number(req.body.fromSeatAssignmentId),
      toSeatAssignmentId: Number(req.body.toSeatAssignmentId),
      reason: req.body.reason,
      actorUserId: actorId(req),
    });
    if (!result.ok) return res.status(400).json(result);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/** GET /api/admin/seating/reseat-audit — reseat trail. */
router.get('/api/admin/seating/reseat-audit', requireAdmin, async (req, res) => {
  try {
    const rows = await listReseatAudit({
      runId: req.query.runId ? Number(req.query.runId) : undefined,
      studentUserId: req.query.studentUserId ? Number(req.query.studentUserId) : undefined,
    });
    res.json({ ok: true, audit: rows });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════════
// REGISTER EXPORTS (answer-key-free)
// ═══════════════════════════════════════════════════════════════════

/** GET /api/admin/seating/register/room — room register (NO answer keys). */
router.get('/api/admin/seating/register/room', requireAdmin, async (req, res) => {
  try {
    const rows = await exportRoomRegister({
      runId: req.query.runId ? Number(req.query.runId) : undefined,
      roomId: req.query.roomId ? Number(req.query.roomId) : undefined,
    });
    res.json({ ok: true, register: rows });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/** GET /api/admin/seating/register/proctor — proctor duty sheet. */
router.get('/api/admin/seating/register/proctor', requireAdmin, async (req, res) => {
  try {
    const rows = await exportProctorRegister({
      runId: req.query.runId ? Number(req.query.runId) : undefined,
      periodId: req.query.periodId ? Number(req.query.periodId) : undefined,
    });
    res.json({ ok: true, register: rows });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════════
// UI PAGE
// ═══════════════════════════════════════════════════════════════════

/** GET /admin/seating — admin seat/proctor/hall-ticket UI. */
router.get('/admin/seating', (req, res) => {
  if (!req.session?.admin) return res.redirect('/admin/login');
  res.render('admin/seating', {
    title: "O'rinlar va proktorlar",
    admin: req.session.admin,
  });
});

export default router;
