/**
 * Edikit — Board Ratification, Result Release & Grade Ledger Routes
 *
 * Prompt 47 REST API:
 *   - GET  /api/admin/board/meta                       — constants for admin UI
 *   - POST /api/admin/board/roles                      — assign board role
 *   - POST /api/admin/board/meetings                   — create meeting
 *   - GET  /api/admin/board/meetings                   — list meetings
 *   - GET  /api/admin/board/meetings/:id               — meeting detail
 *   - POST /api/admin/board/meetings/:id/open          — open meeting
 *   - POST /api/admin/board/meetings/:id/attendees     — add attendee (conflict decl)
 *   - POST /api/admin/board/meetings/:id/vote          — record vote
 *   - GET  /api/admin/board/readiness?runId=           — board-ready blocker check
 *   - POST /api/admin/board/ratify                     — ratify a run (immutable)
 *   - POST /api/admin/board/release                    — SIS/HEMIS release batch
 *   - POST /api/admin/board/amendments                 — append amendment (ledger)
 *   - GET  /api/admin/board/amendments?runId=          — ledger history
 *   - GET  /api/admin/board/outbox                     — SIS outbox list
 *   - POST /api/admin/board/outbox/:id/reconcile       — idempotent ack
 *   - GET  /admin/board                                — admin page
 *
 * Security (Prompt 47):
 *   - requireAdmin on all write paths; actor id from session.
 *   - Ratified grade hech qachon direct UPDATE bilan overwrite qilinmaydi
 *     (append-only amendment ledger + immutable board_decisions).
 *   - Release faqat ratified decision bilan ishlaydi (§15).
 *   - Har bir write path tenant-scoped + idempotent.
 */

import { Router } from 'express';
import { requireAdmin } from '../middleware/auth.js';
import {
  assignBoardRole,
  createBoardMeeting,
  openBoardMeeting,
  addAttendee,
  recordVote,
  getBoardReadiness,
  ratifyResult,
  releaseBatch,
  appendAmendment,
  reconcileOutbox,
  getBoardMeeting,
  listBoardMeetings,
  listAttendees,
  listDecisions,
  listAmendments,
  listOutbox,
  BOARD_ROLES,
  MEETING_STATUS,
  DECISION_STATUS,
  VOTES,
  OUTBOX_STATUS,
  BOARD_DEFAULTS,
} from '../src/modules/board/index.js';

const router = Router();

function actorId(req) {
  return req.session?.admin?.id || req.session?.user?.id || null;
}

// ═══════════════════════════════════════════════════════════════════
// META / CONSTANTS
// ═══════════════════════════════════════════════════════════════════

/** GET /api/admin/board/meta — constants for the admin UI. */
router.get('/api/admin/board/meta', requireAdmin, (req, res) => {
  res.json({
    boardRoles: BOARD_ROLES,
    meetingStatus: MEETING_STATUS,
    decisionStatus: DECISION_STATUS,
    votes: VOTES,
    outboxStatus: OUTBOX_STATUS,
    defaults: BOARD_DEFAULTS,
  });
});

// ═══════════════════════════════════════════════════════════════════
// BOARD ROLES & MEETINGS
// ═══════════════════════════════════════════════════════════════════

/** POST /api/admin/board/roles — assign a board role. */
router.post('/api/admin/board/roles', requireAdmin, async (req, res) => {
  try {
    const { userId, role } = req.body || {};
    const result = await assignBoardRole({ userId, role, createdBy: actorId(req) });
    res.status(result.ok ? 201 : 400).json(result);
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

/** POST /api/admin/board/meetings — create a meeting. */
router.post('/api/admin/board/meetings', requireAdmin, async (req, res) => {
  try {
    const { assessmentId, courseOfferingId, title, requiredQuorum, requiredApprovalRatio, policySnapshot } = req.body || {};
    const result = await createBoardMeeting({
      assessmentId,
      courseOfferingId,
      title,
      requiredQuorum,
      requiredApprovalRatio,
      policySnapshot: policySnapshot || {},
      createdBy: actorId(req),
    });
    res.status(result.ok ? 201 : 400).json(result);
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

/** GET /api/admin/board/meetings — list meetings. */
router.get('/api/admin/board/meetings', requireAdmin, async (req, res) => {
  try {
    const rows = await listBoardMeetings({ status: req.query.status });
    res.json({ ok: true, rows });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

/** GET /api/admin/board/meetings/:id — meeting + attendees + decisions. */
router.get('/api/admin/board/meetings/:id', requireAdmin, async (req, res) => {
  try {
    const meeting = await getBoardMeeting(Number(req.params.id));
    if (!meeting) return res.status(404).json({ ok: false, error: 'Meeting not found' });
    const attendees = await listAttendees({ meetingId: Number(req.params.id) });
    const decisions = await listDecisions({ meetingId: Number(req.params.id) });
    res.json({ ok: true, meeting, attendees, decisions });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

/** POST /api/admin/board/meetings/:id/open — open a scheduled meeting. */
router.post('/api/admin/board/meetings/:id/open', requireAdmin, async (req, res) => {
  try {
    const result = await openBoardMeeting({ meetingId: Number(req.params.id), actorId: actorId(req) });
    res.status(result.ok ? 200 : 400).json(result);
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

/** POST /api/admin/board/meetings/:id/attendees — add attendee with conflict declaration. */
router.post('/api/admin/board/meetings/:id/attendees', requireAdmin, async (req, res) => {
  try {
    const { userId, role, conflictDeclared, conflictReason } = req.body || {};
    const result = await addAttendee({
      meetingId: Number(req.params.id),
      userId,
      role,
      conflictDeclared,
      conflictReason,
      createdBy: actorId(req),
    });
    res.status(result.ok ? 200 : 400).json(result);
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

/** POST /api/admin/board/meetings/:id/vote — record a vote. */
router.post('/api/admin/board/meetings/:id/vote', requireAdmin, async (req, res) => {
  try {
    const { userId, vote } = req.body || {};
    const result = await recordVote({ meetingId: Number(req.params.id), userId, vote, actorId: actorId(req) });
    res.status(result.ok ? 200 : 400).json(result);
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

// ═══════════════════════════════════════════════════════════════════
// READINESS, RATIFICATION, RELEASE
// ═══════════════════════════════════════════════════════════════════

/** GET /api/admin/board/readiness?runId= — board-ready blocker check. */
router.get('/api/admin/board/readiness', requireAdmin, async (req, res) => {
  try {
    const result = await getBoardReadiness({ runId: Number(req.query.runId), actorId: actorId(req) });
    res.json(result);
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

/** POST /api/admin/board/ratify — ratify a provisional grade (immutable). */
router.post('/api/admin/board/ratify', requireAdmin, async (req, res) => {
  try {
    const { meetingId, runId, userId } = req.body || {};
    const result = await ratifyResult({ meetingId, runId, userId, decidedBy: actorId(req) });
    res.status(result.ok ? 200 : (result.quorumError ? 409 : 400)).json(result);
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

/** POST /api/admin/board/release — SIS/HEMIS release batch. */
router.post('/api/admin/board/release', requireAdmin, async (req, res) => {
  try {
    const { decisionId, runId, userId } = req.body || {};
    const result = await releaseBatch({ decisionId, runId, userId, actorId: actorId(req) });
    res.status(result.ok ? 200 : 400).json(result);
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

// ═══════════════════════════════════════════════════════════════════
// AMENDMENT LEDGER & OUTBOX
// ═══════════════════════════════════════════════════════════════════

/** POST /api/admin/board/amendments — append an amendment (ledger). */
router.post('/api/admin/board/amendments', requireAdmin, async (req, res) => {
  try {
    const { runId, newFinal, reason } = req.body || {};
    const result = await appendAmendment({ runId, newFinal, reason, changedBy: actorId(req) });
    res.status(result.ok ? 201 : 400).json(result);
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

/** GET /api/admin/board/amendments?runId= — ledger history. */
router.get('/api/admin/board/amendments', requireAdmin, async (req, res) => {
  try {
    const rows = await listAmendments({ runId: req.query.runId ? Number(req.query.runId) : undefined });
    res.json({ ok: true, rows });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

/** GET /api/admin/board/outbox — SIS outbox list. */
router.get('/api/admin/board/outbox', requireAdmin, async (req, res) => {
  try {
    const rows = await listOutbox({ status: req.query.status });
    res.json({ ok: true, rows });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

/** POST /api/admin/board/outbox/:id/reconcile — idempotent ack. */
router.post('/api/admin/board/outbox/:id/reconcile', requireAdmin, async (req, res) => {
  try {
    const { status, error } = req.body || {};
    const result = await reconcileOutbox({
      outboxId: Number(req.params.id),
      status: status || 'sent',
      error: error || '',
      actorId: actorId(req),
    });
    res.status(result.ok ? 200 : 400).json(result);
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

// ═══════════════════════════════════════════════════════════════════
// ADMIN PAGE
// ═══════════════════════════════════════════════════════════════════

/** GET /admin/board — admin board console. */
router.get('/admin/board', requireAdmin, (req, res) => {
  res.render('admin/board', {
    title: 'Board & Ratification',
    user: req.session.admin,
    csrfToken: req.csrfToken ? req.csrfToken() : '',
  });
});

export default router;
