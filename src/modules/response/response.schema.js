/**
 * Deborah — Response API, ACK Sequence & Autosave (pure logic)
 *
 * Pure, DB-free logic for Prompt 31 (reliable autosave contract):
 *   - Response modes: first (first answer final) | editable (monotonic
 *     revisions) | item_lock (locked after first save) — resolved from the
 *     item's question type + policy override.
 *   - Client sequence validation: in-order accepts, duplicates/out-of-order
 *     rejected with a deterministic reason; server ACKs the HIGHEST accepted
 *     sequence.
 *   - Epoch validation: client epoch must not be stale vs server time; the
 *     SERVER receive time is authoritative (Prompt 31 §15 — a save is never
 *     shown as synced without a server ACK).
 *   - Late/stale rejection: saves after the server ends_at are rejected.
 *   - Essay patch/snapshot interval: full snapshot every N seconds or chars,
 *     patch ops in between.
 *   - Save-state indicator contract for the frontend.
 *   - Idempotency key derivation (attempt + item + seq).
 *
 * Purity: no I/O, no globals — fully unit-testable without PostgreSQL.
 */

import crypto from 'crypto';

// ═══════════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════════

export const RESPONSE_MODES = {
  FIRST: 'first',
  EDITABLE: 'editable',
  ITEM_LOCK: 'item_lock',
};

export const RESPONSE_STATUS = {
  PENDING: 'pending',
  ACCEPTED: 'accepted',
  REJECTED: 'rejected',
};

export const REJECTION_REASONS = {
  STALE_SEQ: 'stale_seq',           // client_seq <= last accepted (duplicate/out-of-order)
  DUPLICATE: 'duplicate',           // same idempotency key / seq already stored
  ITEM_LOCKED: 'item_locked',       // first/item_lock mode already has an accepted row
  LATE: 'late',                     // attempt window closed (server ends_at passed)
  INVALID_ITEM: 'invalid_item',     // item_id not part of this attempt's content
  EPOCH_MISMATCH: 'epoch_mismatch', // client epoch is stale/out of range
  INVALID_MODE: 'invalid_mode',     // mode not resolvable from type + policy
};

/** Question types treated as first-answer-final by default. */
export const FIRST_ANSWER_TYPES = [
  'single_choice', 'multiple_choice', 'true_false', 'matching', 'ordering', 'numeric',
];

/** Question types treated as editable by default (essays etc.). */
export const EDITABLE_TYPES = ['essay', 'short_answer', 'fill_blanks', 'file_upload'];

/** Essay snapshot cadence: snapshot every N chars OR every N ms. */
export const ESSAY_SNAPSHOT_CHAR_DELTA = 120;
export const ESSAY_SNAPSHOT_MS_DELTA = 15 * 1000;

/** Allowed client_seq drift tolerance for epoch (ms). */
export const EPOCH_TOLERANCE_MS = 5 * 60 * 1000;

// ═══════════════════════════════════════════════════════════════════
// RESPONSE MODE RESOLUTION
// ═══════════════════════════════════════════════════════════════════

/**
 * Resolve the response mode for an item from its question type + policy.
 * Policy override wins; otherwise derived from the question type. Returns
 * null when the mode cannot be resolved (Prompt 31 §24 stop condition).
 *
 * @param {string|null} questionType
 * @param {Object} [opts] - { policyMode }
 * @returns {string|null} first | editable | item_lock
 */
export function resolveResponseMode(questionType = '', opts = {}) {
  if (opts.policyMode && Object.values(RESPONSE_MODES).includes(opts.policyMode)) {
    return opts.policyMode;
  }
  if (FIRST_ANSWER_TYPES.includes(questionType)) return RESPONSE_MODES.FIRST;
  if (EDITABLE_TYPES.includes(questionType)) return RESPONSE_MODES.EDITABLE;
  return null;
}

// ═══════════════════════════════════════════════════════════════════
// CLIENT SEQ VALIDATION (in-order / duplicate / out-of-order)
// ═══════════════════════════════════════════════════════════════════

/**
 * Validate an incoming client_seq against the last accepted seq for the item.
 * - seq === last + 1  → accept (next in order)
 * - seq <= last       → stale/duplicate (reject)
 * - seq >  last + 1   → gap → accept ONLY for editable mode (autosave may
 *   skip ACKs while offline); first/item_lock are single-shot anyway.
 *
 * @param {Object} params
 * @param {number} params.clientSeq
 * @param {number|null} params.lastAcceptedSeq - last accepted seq for the item (0 if none)
 * @param {string} params.mode
 * @returns {{ accepted: boolean, reason: string|null, expectedNextSeq: number }}
 */
export function validateClientSeq({ clientSeq = 0, lastAcceptedSeq = 0, mode = RESPONSE_MODES.EDITABLE } = {}) {
  const seq = Number(clientSeq) || 0;
  const last = Number(lastAcceptedSeq) || 0;
  const expectedNext = last + 1;

  if (seq <= 0) return { accepted: false, reason: REJECTION_REASONS.STALE_SEQ, expectedNextSeq: expectedNext };

  if (seq <= last) {
    return { accepted: false, reason: REJECTION_REASONS.STALE_SEQ, expectedNextSeq: expectedNext };
  }
  if (seq > expectedNext && mode !== RESPONSE_MODES.EDITABLE) {
    // Gap in a non-editable mode is never valid (single-shot modes)
    return { accepted: false, reason: REJECTION_REASONS.STALE_SEQ, expectedNextSeq: expectedNext };
  }
  return { accepted: true, reason: null, expectedNextSeq: expectedNext };
}

// ═══════════════════════════════════════════════════════════════════
// EPOCH VALIDATION (staleness only — server time is authoritative)
// ═══════════════════════════════════════════════════════════════════

/**
 * Cross-check the client's epoch against server time. The client epoch is
 * never used for scoring — only to reject obviously stale submissions
 * (Prompt 31 §15 — server receive time is authoritative).
 *
 * @param {Object} params
 * @param {number|string|null} params.clientEpoch - client-provided epoch (ms)
 * @param {number|string|Date} [params.serverNow] - server receive time
 * @param {number} [params.toleranceMs]
 * @returns {{ accepted: boolean, reason: string|null }}
 */
export function validateEpoch({ clientEpoch = null, serverNow = Date.now(), toleranceMs = EPOCH_TOLERANCE_MS } = {}) {
  if (clientEpoch == null) return { accepted: true, reason: null }; // epoch optional
  const serverMs = new Date(serverNow).getTime();
  const clientMs = Number(clientEpoch);
  if (!Number.isFinite(clientMs)) return { accepted: false, reason: REJECTION_REASONS.EPOCH_MISMATCH };
  const drift = serverMs - clientMs;
  if (drift < -toleranceMs || drift > toleranceMs) {
    return { accepted: false, reason: REJECTION_REASONS.EPOCH_MISMATCH };
  }
  return { accepted: true, reason: null };
}

// ═══════════════════════════════════════════════════════════════════
// LATE / STALE REJECTION (server ends_at)
// ═══════════════════════════════════════════════════════════════════

/**
 * Check whether a save is still inside the server-authoritative attempt
 * window. Once serverNow > endsAt, every save is rejected (late).
 *
 * @param {Object} params
 * @param {Date|string|null} params.endsAt - attempt server ends_at
 * @param {number|string|Date} [params.now]
 * @returns {{ open: boolean, reason: string|null }}
 */
export function isAttemptWindowOpen({ endsAt = null, now = Date.now() } = {}) {
  if (!endsAt) return { open: true, reason: null }; // unbounded attempt
  const nowMs = new Date(now).getTime();
  const endMs = new Date(endsAt).getTime();
  if (nowMs > endMs) {
    return { open: false, reason: REJECTION_REASONS.LATE };
  }
  return { open: true, reason: null };
}

// ═══════════════════════════════════════════════════════════════════
// ITEM LOCK / FIRST-ANSWER GATE
// ═══════════════════════════════════════════════════════════════════

/**
 * Evaluate the item lock / first-answer gate before saving.
 * first & item_lock modes accept exactly one row per item — a second save is
 * rejected even if the client_seq would otherwise be valid.
 *
 * @param {Object} params
 * @param {string} params.mode
 * @param {boolean} params.hasAcceptedRow - an accepted row already exists for the item
 * @returns {{ allowed: boolean, reason: string|null }}
 */
export function evaluateItemLockGate({ mode = RESPONSE_MODES.EDITABLE, hasAcceptedRow = false } = {}) {
  if ((mode === RESPONSE_MODES.FIRST || mode === RESPONSE_MODES.ITEM_LOCK) && hasAcceptedRow) {
    return { allowed: false, reason: REJECTION_REASONS.ITEM_LOCKED };
  }
  return { allowed: true, reason: null };
}

// ═══════════════════════════════════════════════════════════════════
// ACK CONTRACT
// ═══════════════════════════════════════════════════════════════════

/**
 * Build the server ACK response. `highestAcceptedSeq` is the authoritative
 * sequence the client must treat as synced — everything ≤ it is durable.
 * A response is NEVER marked synced without this ACK (Prompt 31 §15).
 *
 * @param {Object} params
 * @param {boolean} params.accepted
 * @param {number} params.highestAcceptedSeq
 * @param {string} [params.rejectionReason]
 * @param {number|string|Date} [params.serverReceivedAt]
 * @param {number|null} [params.responseId]
 * @returns {Object} ACK contract
 */
export function buildServerAck({ accepted, highestAcceptedSeq = 0, rejectionReason = null, serverReceivedAt = Date.now(), responseId = null } = {}) {
  return {
    accepted: !!accepted,
    status: accepted ? RESPONSE_STATUS.ACCEPTED : RESPONSE_STATUS.REJECTED,
    highestAcceptedSeq: Number(highestAcceptedSeq) || 0,
    rejectionReason,
    serverReceivedAt: new Date(serverReceivedAt).toISOString(),
    responseId,
  };
}

// ═══════════════════════════════════════════════════════════════════
// ESSAY PATCH / SNAPSHOT INTERVAL
// ═══════════════════════════════════════════════════════════════════

/**
 * Decide whether a revision should be a full snapshot or a minimal patch.
 * Snapshot when the accumulated delta exceeds the char threshold OR the time
 * since the last snapshot exceeds the ms threshold.
 *
 * @param {Object} params
 * @param {string} params.current - current essay text
 * @param {string} [params.previous] - text of the last revision
 * @param {number|string|Date} [params.now]
 * @param {number|string|Date|null} [params.lastSnapshotAt]
 * @param {Object} [params.opts] - { charDelta, msDelta }
 * @returns {{ patchType: 'snapshot'|'patch', ops: Array|null }}
 */
export function decideEssayRevisionType({ current = '', previous = '', now = Date.now(), lastSnapshotAt = null, opts = {} } = {}) {
  const charDelta = Number(opts.charDelta) || ESSAY_SNAPSHOT_CHAR_DELTA;
  const msDelta = Number(opts.msDelta) || ESSAY_SNAPSHOT_MS_DELTA;

  const sizeDelta = Math.abs(String(current).length - String(previous).length);
  const sinceSnapshotMs = lastSnapshotAt ? new Date(now).getTime() - new Date(lastSnapshotAt).getTime() : Infinity;

  if (sizeDelta >= charDelta || sinceSnapshotMs >= msDelta || !previous) {
    return { patchType: 'snapshot', ops: null };
  }
  return { patchType: 'patch', ops: buildMinimalPatch(String(previous), String(current)) };
}

/**
 * Build a minimal text patch between two essay states (char-level diff).
 * Deterministic and lossless: { del: n, ins: { at, text } } — first common
 * prefix trimmed, then common suffix trimmed, delete the middle and insert
 * the new middle.
 *
 * @param {string} prev
 * @param {string} next
 * @returns {Array<Object>|null} null when identical
 */
export function buildMinimalPatch(prev, next) {
  if (prev === next) return null;
  // Common prefix
  let prefix = 0;
  const max = Math.min(prev.length, next.length);
  while (prefix < max && prev[prefix] === next[prefix]) prefix += 1;
  // Common suffix after prefix
  let suffix = 0;
  while (
    suffix < prev.length - prefix &&
    suffix < next.length - prefix &&
    prev[prev.length - 1 - suffix] === next[next.length - 1 - suffix]
  ) {
    suffix += 1;
  }
  const deleted = prev.slice(prefix, prev.length - suffix);
  const inserted = next.slice(prefix, next.length - suffix);
  return [{ op: 'replace', at: prefix, del: deleted.length, text: inserted }];
}

// ═══════════════════════════════════════════════════════════════════
// SAVE-STATE INDICATOR (frontend contract)
// ═══════════════════════════════════════════════════════════════════

/**
 * Build the frontend save-state indicator. `state` is one of:
 *   - 'synced'  — server ACK received (highestAcceptedSeq set)
 *   - 'pending' — save accepted, awaiting ACK (never show synced without ACK)
 *   - 'error'   — rejected / retryable
 *   - 'offline' — local buffer, will retry with backoff
 *
 * @param {Object} params
 * @param {string} params.state
 * @param {number|null} [params.highestAcceptedSeq]
 * @param {number} [params.retryCount]
 * @param {boolean} [params.acked]
 * @returns {Object} save-state contract
 */
export function buildSaveState({ state = 'pending', highestAcceptedSeq = null, retryCount = 0, acked = false } = {}) {
  const finalState = state === 'synced' && !acked ? 'pending' : state;
  return {
    state: finalState,
    highestAcceptedSeq: acked ? (Number(highestAcceptedSeq) || 0) : null,
    retryCount: Number(retryCount) || 0,
    acked: !!acked,
  };
}

// ═══════════════════════════════════════════════════════════════════
// IDEMPOTENCY KEY
// ═══════════════════════════════════════════════════════════════════

/**
 * Derive the idempotency key for a save: attempt + item + client_seq.
 * A retried save with the same key returns the STORED ACK.
 *
 * @param {number} attemptId
 * @param {number} itemId
 * @param {number} clientSeq
 * @returns {string}
 */
export function deriveResponseKey(attemptId, itemId, clientSeq) {
  return crypto.createHash('sha256')
    .update(`resp:${attemptId}:${itemId}:${clientSeq}`)
    .digest('hex')
    .slice(0, 40);
}

// ═══════════════════════════════════════════════════════════════════
// RETRY / BACKOFF HOOK
// ═══════════════════════════════════════════════════════════════════

/**
 * Compute the next retry delay (exponential backoff with jitter-less
 * deterministic growth, capped). The offline buffer uses this schedule.
 *
 * @param {number} retryCount
 * @param {Object} [opts] - { baseMs, maxMs }
 * @returns {number} delay in ms
 */
export function computeRetryDelay(retryCount = 0, { baseMs = 1000, maxMs = 30000 } = {}) {
  const n = Math.max(0, Number(retryCount) || 0);
  return Math.min(maxMs, baseMs * 2 ** n);
}
