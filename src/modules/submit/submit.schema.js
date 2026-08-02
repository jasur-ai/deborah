/**
 * Edikit — Submit Sealing va Signed Receipt (pure logic)
 *
 * Prompt 33 — pending response'larni sync qilib attemptni IMMUTABLE submit
 * qilish (research.md §29.5 end-of-exam failsafe). This module is PURE (no
 * I/O): the server service recomputes everything here — the client NEVER
 * sends its own hash, summary or receipt (server-authoritative, §15).
 *
 * Covers:
 *   - Completeness summary: answered/unanswered items from the final response
 *     set — the server tells the student what is (un)answered BEFORE sealing.
 *   - Submission hash: deterministic sha256 over the canonical final response
 *     snapshot (item_id + latest accepted client_seq + payload digest).
 *   - Receipt signing: HMAC-SHA256 over the canonical receipt body with the
 *     server secret — the student gets a verifiable, non-forgeable receipt.
 *   - Post-submit mutation detection: once sealed, a later response save for
 *     the same attempt is rejected (double-layer with the response window
 *     check).
 *   - Double-submit guard contract: EXACTLY ONE seal + one scoring job per
 *     attempt (backed by UNIQUE indexes in migration 017).
 *
 * Purity: crypto used here is deterministic and side-effect-free.
 */

import crypto from 'crypto';

// ═══════════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════════

export const RECEIPT_VERSION = 1;
export const OUTBOX_STATUS = {
  PENDING: 'pending',
  ENQUEUED: 'enqueued',
  PROCESSED: 'processed',
  FAILED: 'failed',
};

// ═══════════════════════════════════════════════════════════════════
// COMPLETENESS SUMMARY (server-computed)
// ═══════════════════════════════════════════════════════════════════

/**
 * Build the completeness summary from the content package items and the
 * accepted responses. The server computes this — the client only sees the
 * result and confirms (Prompt 33 §08/§09).
 *
 * @param {Object} params
 * @param {Array<Object>} params.items - content package items [{item_id, question_type, ...}]
 * @param {Array<Object>} params.responses - accepted responses [{item_id, client_seq, payload}]
 * @returns {Object} completeness summary
 */
export function buildCompletenessSummary({ items = [], responses = [] } = {}) {
  const answeredItems = new Set(responses.map((r) => Number(r.item_id)));
  const total = items.length;
  const answered = [...answeredItems].filter((id) => items.some((it) => Number(it.item_id) === id)).length;
  const unansweredItems = items.filter((it) => !answeredItems.has(Number(it.item_id))).map((it) => Number(it.item_id));
  const percent = total > 0 ? Math.round((answered / total) * 100) : 100;
  return {
    total,
    answered,
    unanswered: unansweredItems.length,
    unansweredItems,
    percent,
    complete: answered === total,
  };
}

// ═══════════════════════════════════════════════════════════════════
// SUBMISSION HASH (final snapshot digest)
// ═══════════════════════════════════════════════════════════════════

/**
 * Canonical final response snapshot: for each item, the LATEST accepted
 * client_seq + a payload digest. Deterministic regardless of row order.
 *
 * @param {Object} params
 * @param {Array<Object>} params.responses - accepted responses rows
 * @returns {Array<Object>} canonical snapshot entries
 */
export function buildFinalSnapshot(responses = []) {
  const byItem = new Map();
  for (const r of responses) {
    const itemId = Number(r.item_id);
    const seq = Number(r.client_seq) || 0;
    const existing = byItem.get(itemId);
    if (!existing || seq > existing.client_seq) {
      byItem.set(itemId, {
        item_id: itemId,
        client_seq: seq,
        payload: r.payload || {},
        payload_digest: payloadDigest(r.payload || {}),
      });
    }
  }
  return [...byItem.values()].sort((a, b) => a.item_id - b.item_id);
}

/**
 * sha256 digest of a response payload (values only — keeps snapshot small).
 *
 * @param {Object} payload
 * @returns {string}
 */
export function payloadDigest(payload = {}) {
  return crypto.createHash('sha256')
    .update(JSON.stringify(payload))
    .digest('hex')
    .slice(0, 16);
}

/**
 * Compute the immutable submission hash over the canonical snapshot.
 *
 * @param {Object} params
 * @param {number} params.attemptId
 * @param {Array<Object>} params.snapshot - from buildFinalSnapshot
 * @param {number} [params.sealedAt]
 * @returns {string} 64-char sha256 hex
 */
export function computeSubmissionHash({ attemptId, snapshot = [], sealedAt = Date.now() } = {}) {
  const canonical = JSON.stringify({ attemptId, snapshot, sealedAt });
  return crypto.createHash('sha256').update(canonical).digest('hex');
}

// ═══════════════════════════════════════════════════════════════════
// SIGNED RECEIPT (verifiable, non-forgeable)
// ═══════════════════════════════════════════════════════════════════

/**
 * Build a receipt body (canonical JSON, no signature yet).
 *
 * @param {Object} params
 * @param {number} params.attemptId
 * @param {string} params.submissionHash
 * @param {number} params.responseCount
 * @param {Object} params.completeness
 * @param {number|string|Date} [params.sealedAt]
 * @param {Object} [params.meta]
 * @returns {Object} receipt body
 */
export function buildReceiptBody({ attemptId, submissionHash, responseCount, completeness = {}, sealedAt = Date.now(), meta = {} } = {}) {
  return {
    version: RECEIPT_VERSION,
    attemptId,
    submissionHash,
    responseCount,
    completeness,
    sealedAt: new Date(sealedAt).toISOString(),
    meta,
  };
}

/**
 * Sign a receipt body with the server secret (HMAC-SHA256).
 *
 * @param {Object} body - from buildReceiptBody
 * @param {string} secret - server receipt signing secret
 * @returns {{ signature: string, body: Object }} signed receipt
 */
export function signReceipt(body = {}, secret = '') {
  if (!secret) throw new Error('receipt secret required');
  const canonical = JSON.stringify(body);
  const signature = crypto.createHmac('sha256', String(secret)).update(canonical).digest('hex');
  return { signature, body };
}

/**
 * Verify a signed receipt — returns false on ANY tamper (body change,
 * signature change, secret mismatch).
 *
 * @param {Object} receipt - { signature, body }
 * @param {string} secret
 * @returns {boolean}
 */
export function verifyReceipt(receipt = {}, secret = '') {
  if (!receipt || typeof receipt !== 'object' || !receipt.signature || !receipt.body) return false;
  const canonical = JSON.stringify(receipt.body);
  const expected = crypto.createHmac('sha256', String(secret)).update(canonical).digest('hex');
  const actual = String(receipt.signature);
  const a = Buffer.from(expected);
  const b = Buffer.from(actual);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

// ═══════════════════════════════════════════════════════════════════
// POST-SUBMIT MUTATION DETECTION
// ═══════════════════════════════════════════════════════════════════

/**
 * A sealed attempt is IMMUTABLE: any later response mutation must be rejected.
 * The service checks this BEFORE persisting a response (double-layer with the
 * response window check).
 *
 * @param {Object} params
 * @param {string} params.attemptStatus - attempts.status
 * @param {boolean} [params.hasSeal] - a seal row already exists
 * @returns {{ allowed: boolean, reason: string|null }}
 */
export function evaluateSubmitGate({ attemptStatus = 'in_progress', hasSeal = false } = {}) {
  if (attemptStatus === 'submitted' || attemptStatus === 'terminated') {
    return { allowed: false, reason: 'attempt_closed' };
  }
  if (hasSeal) return { allowed: false, reason: 'already_sealed' };
  return { allowed: true, reason: null };
}
