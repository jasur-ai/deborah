/**
 * Deborah — Response API, ACK Sequence & Autosave Routes
 *
 * Prompt 31 (Phase D #2) REST API:
 *   - POST /api/student/attempts/:id/responses        — save a response
 *     (autosave contract: first/editable/item-lock modes, client_seq/epoch
 *     validation, idempotent, returns server ACK with highestAcceptedSeq)
 *   - GET  /api/student/attempts/:id/responses        — all accepted responses
 *     (recovery surface for the offline buffer / reconnect)
 *   - GET  /api/student/attempts/:id/items/:itemId/response  — item save-state
 *   - GET  /api/student/attempts/:id/items/:itemId/revisions — essay revisions
 *   - GET  /api/student/response/meta                 — contract meta
 *
 * Security:
 *   - Every route requires an authenticated student session (requireAuth)
 *   - Attempt ownership is enforced server-side (getAttempt by userId)
 *   - The server NEVER trusts client time/score/status; server_received_at
 *     is authoritative and the ACK highestAcceptedSeq is the only
 *     "synced" signal the client may show (Prompt 31 §15)
 *   - Raw essay text never reaches audit/log events
 */

import { Router } from 'express';
import {
  RESPONSE_MODES,
  RESPONSE_STATUS,
  REJECTION_REASONS,
  saveResponse,
  getResponseState,
  listResponses,
  listEssayRevisions,
} from '../src/modules/response/index.js';

const router = Router();

function actorId(req) {
  return req.session?.user?.id || req.session?.admin?.id || null;
}

/** POST /api/student/attempts/:id/responses — save a response (autosave). */
router.post('/api/student/attempts/:id/responses', async (req, res) => {
  try {
    const userId = actorId(req);
    if (!userId) return res.status(401).json({ error: 'Authentication required' });

    // SECURITY: `mode` is NEVER read from the request body — the response
    // mode (first|editable|item_lock) is resolved SERVER-SIDE from the item's
    // question type + the assessment policy snapshot. Accepting a client mode
    // would let a student downgrade a first-answer-final (MCQ) item to
    // 'editable' and revise it indefinitely (Prompt 30 identityLevel bug class).
    const { itemId, clientSeq = 1, payload = {}, clientEpoch = null, idempotencyKey = null } = req.body || {};
    if (!itemId) return res.status(400).json({ error: 'itemId is required' });
    if (!payload || payload.value === undefined) return res.status(400).json({ error: 'payload.value is required' });

    const result = await saveResponse({
      attemptId: parseInt(req.params.id, 10),
      userId,
      itemId: parseInt(itemId, 10),
      clientSeq: parseInt(clientSeq, 10),
      payload,
      clientEpoch,
      idempotencyKey,
    });

    if (result.ok === false && result.code === 'not_found') {
      return res.status(404).json({ error: 'Attempt not found' });
    }

    const ack = result.ack;
    if (ack.accepted) {
      res.status(result.duplicate ? 200 : 201).json(result);
    } else {
      const status = ack.rejectionReason === REJECTION_REASONS.LATE
        ? 409 // attempt window closed
        : (ack.rejectionReason === REJECTION_REASONS.INVALID_ITEM ? 400 : 409);
      res.status(status).json({ error: `Response rejected: ${ack.rejectionReason}`, ack });
    }
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/** GET /api/student/attempts/:id/responses — all accepted responses (recovery). */
router.get('/api/student/attempts/:id/responses', async (req, res) => {
  try {
    const userId = actorId(req);
    if (!userId) return res.status(401).json({ error: 'Authentication required' });
    const responses = await listResponses(parseInt(req.params.id, 10), userId);
    if (!responses) return res.status(404).json({ error: 'Attempt not found' });
    res.json({ responses });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/** GET /api/student/attempts/:id/items/:itemId/response — item save-state. */
router.get('/api/student/attempts/:id/items/:itemId/response', async (req, res) => {
  try {
    const userId = actorId(req);
    if (!userId) return res.status(401).json({ error: 'Authentication required' });
    const state = await getResponseState(
      parseInt(req.params.id, 10),
      userId,
      parseInt(req.params.itemId, 10)
    );
    if (!state) return res.status(404).json({ error: 'No saved response yet' });
    res.json(state);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/** GET /api/student/attempts/:id/items/:itemId/revisions — essay revisions. */
router.get('/api/student/attempts/:id/items/:itemId/revisions', async (req, res) => {
  try {
    const userId = actorId(req);
    if (!userId) return res.status(401).json({ error: 'Authentication required' });
    const revisions = await listEssayRevisions(
      parseInt(req.params.id, 10),
      userId,
      parseInt(req.params.itemId, 10)
    );
    if (!revisions) return res.status(404).json({ error: 'Attempt not found' });
    res.json({ revisions });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/** GET /api/student/response/meta — autosave contract meta. */
router.get('/api/student/response/meta', (req, res) => {
  res.json({
    modes: RESPONSE_MODES,
    statuses: RESPONSE_STATUS,
    rejectionReasons: REJECTION_REASONS,
  });
});

export default router;
