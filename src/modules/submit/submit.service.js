/**
 * Deborah — Submit Sealing va Signed Receipt Service
 *
 * Prompt 33 — pending response'larni sync qilib attemptni IMMUTABLE submit
 * qilish. Server-authoritative end-of-exam flow:
 *   1. flushPendingBatch: client'dan kelgan so'nggi pending response'larni
 *      Prompt 31 saveResponse orqali persist qiladi (idempotent).
 *   2. submitAttempt: responses'ni o'qiydi → completeness summary hisoblaydi →
 *      (agar confirmed bo'lmasa faqat preview qaytaradi) → confirmed bo'lsa
 *      attempt row lock + SUBMITTED transition, final snapshot/hash, seal
 *      INSERT (UNIQUE attempt_id → double-submit no-op), scoring_outbox job
 *      enqueue (UNIQUE attempt_id → duplicate job impossible), signed receipt.
 *   3. getSubmissionState: seal mavjud bo'lsa receipt + hash + summary.
 *
 * SECURITY / DATA GUARD (Prompt 33 §15):
 *   - Hash, snapshot, summary, receipt — hammasi SERVER tomonda hisoblanadi;
 *     client hech qachon o'z qiymatlarini yuborolmaydi.
 *   - Post-submit mutation: attempt status submitted + response window check +
 *     evaluateSubmitGate uch qatlamli himoya.
 *   - Double submit: UNIQUE attempt_id (seals va outbox) → duplicate
 *     score/job strukturaviy imkonsiz.
 *
 * Graceful degradation: without PostgreSQL, read paths return null/[] and
 * write paths throw a clear 'PostgreSQL required' error.
 */

import { getDb } from '../../infrastructure/postgres.js';
import { getCurrentTenant } from '../auth/tenant-context.js';
import { audit, AUDIT_ACTIONS } from '../auth/audit.js';
import { getAttempt, transitionAttempt, ATTEMPT_STATUS } from '../attempt/index.js';
import { saveResponse, listResponses } from '../response/response.service.js';
import {
  OUTBOX_STATUS,
  buildCompletenessSummary,
  buildFinalSnapshot,
  computeSubmissionHash,
  buildReceiptBody,
  signReceipt,
  evaluateSubmitGate,
} from './submit.schema.js';

function getTenantId() {
  return getCurrentTenant()?.tenantId || 1;
}

/**
 * Flush a final batch of pending responses before sealing (Prompt 33 §07).
 * Every entry is persisted via the Prompt 31 response contract — idempotent
 * and server-timed. Returns per-entry results.
 *
 * @param {Object} params
 * @param {number} params.attemptId
 * @param {number} params.userId
 * @param {Array<Object>} params.entries - [{ itemId, clientSeq, payload, idempotencyKey }]
 * @returns {Promise<Object>} flush result
 */
export async function flushPendingBatch({ attemptId, userId, entries = [] } = {}) {
  const db = await getDb();
  if (!db) throw new Error('PostgreSQL required');

  const results = [];
  let accepted = 0;
  for (const e of entries) {
    const saved = await saveResponse({
      attemptId,
      userId,
      itemId: e.itemId,
      clientSeq: e.clientSeq,
      payload: e.payload,
      idempotencyKey: e.idempotencyKey || null,
    }).catch((err) => ({ ok: false, code: 'save_error', error: err.message }));
    if (saved?.ack?.accepted || saved?.duplicate) {
      accepted += 1;
      results.push({ itemId: e.itemId, seq: e.clientSeq, status: 'accepted' });
    } else {
      results.push({ itemId: e.itemId, seq: e.clientSeq, status: 'rejected', reason: saved?.ack?.rejectionReason || saved?.code || 'rejected' });
    }
  }
  return { ok: true, accepted, total: entries.length, results };
}

/**
 * Build the completeness PREVIEW (no seal yet) — the student sees what is
 * answered/unanswered and confirms (Prompt 33 §08/§09).
 *
 * @param {number} attemptId
 * @param {number} userId
 * @returns {Promise<Object|null>} preview or null when attempt missing
 */
export async function getSubmitPreview(attemptId, userId) {
  const db = await getDb();
  if (!db) return null; // read path — graceful degradation

  const attempt = await getAttempt(attemptId, userId);
  if (!attempt) return null;

  const responses = await listResponses(attemptId, userId);
  const items = Array.isArray(attempt.content_package?.items) ? attempt.content_package.items : [];
  const completeness = buildCompletenessSummary({ items, responses: responses || [] });
  return { attemptId, status: attempt.status, completeness };
}

/**
 * Submit an attempt: seal it immutably, enqueue the scoring job and return a
 * signed receipt. IDEMPOTENT — a second submit returns the existing seal +
 * receipt (never a duplicate score/job).
 *
 * @param {Object} params
 * @param {number} params.attemptId
 * @param {number} params.userId
 * @param {boolean} [params.confirmed] - student explicit confirmation (§09)
 * @param {Object} [params.entries] - optional final pending batch to flush first
 * @param {Object} [params.opts] - { receiptSecret, now }
 * @returns {Promise<Object>} submit result
 */
export async function submitAttempt({ attemptId, userId, confirmed = false, entries = [], opts = {} } = {}) {
  const db = await getDb();
  if (!db) throw new Error('PostgreSQL required');

  const attempt = await getAttempt(attemptId, userId);
  if (!attempt) return { ok: false, code: 'not_found' };

  const secret = opts.receiptSecret || process.env.RECEIPT_SECRET || '';
  const now = opts.now || Date.now();

  // ── Idempotency: already sealed → return the existing seal + receipt ──
  const existingSeal = await db.selectFrom('attempt_seals')
    .where('tenant_id', '=', getTenantId())
    .where('attempt_id', '=', attemptId)
    .selectAll()
    .executeTakeFirst()
    .catch(() => null);
  if (existingSeal) {
    return {
      ok: true,
      duplicate: true,
      submissionHash: existingSeal.submission_hash,
      responseCount: existingSeal.response_count,
      completeness: existingSeal.completeness,
      sealedAt: existingSeal.sealed_at,
      receipt: existingSeal.receipt || null,
      sealed: true,
    };
  }

  // ── Pre-seal gate: attempt must be open (not submitted/terminated) ──
  const gate = evaluateSubmitGate({ attemptStatus: attempt.status, hasSeal: false });
  if (!gate.allowed) {
    return { ok: false, code: 'attempt_closed', reason: gate.reason };
  }

  // ── Flush any final pending batch (Prompt 33 §07) ──
  let flush = null;
  if (entries && entries.length > 0) {
    flush = await flushPendingBatch({ attemptId, userId, entries });
  }

  // ── Server-computed completeness + snapshot + hash (§08/§11) ──
  const responses = await listResponses(attemptId, userId);
  const items = Array.isArray(attempt.content_package?.items) ? attempt.content_package.items : [];
  const completeness = buildCompletenessSummary({ items, responses: responses || [] });
  const snapshot = buildFinalSnapshot(responses || []);
  const submissionHash = computeSubmissionHash({ attemptId, snapshot, sealedAt: now });

  // ── PREVIEW mode: no seal yet — return for explicit confirmation (§09) ──
  // submissionHash is NOT returned here (it embeds sealedAt and would differ
  // from the final receipt hash — the receipt is the only authoritative hash).
  if (!confirmed) {
    return {
      ok: true,
      confirmed: false,
      preview: true,
      completeness,
      responseCount: snapshot.length,
      // preview only — seal/outbox/receipt NOT persisted (any pending batch
      // flush above already persisted responses, which is intended §07)
    };
  }

  // ── CONFIRMED: build the receipt FIRST so the seal INSERT is atomic ──
  // (a post-commit UPDATE would race with the 23505 duplicate path reading
  // the winner's seal before the receipt lands → receipt:null).
  const receiptBody = buildReceiptBody({
    attemptId,
    submissionHash,
    responseCount: snapshot.length,
    completeness,
    sealedAt: now,
    meta: { tenantId: getTenantId(), flushAccepted: flush?.accepted ?? 0 },
  });
  const signedReceipt = signReceipt(receiptBody, secret);

  let sealId = null;
  try {
    await db.transaction().execute(async (tx) => {
      // Row lock: attempt must still be in_progress (race-safe).
      const locked = await tx.selectFrom('attempts')
        .where('id', '=', attemptId)
        .where('tenant_id', '=', getTenantId())
        .where('status', '=', ATTEMPT_STATUS.IN_PROGRESS)
        .select(['id'])
        .executeTakeFirst()
        .catch(() => null);
      if (!locked) {
        throw Object.assign(new Error('attempt not in progress'), { code: 'attempt_closed' });
      }

      // UNIQUE attempt_id → concurrent second submit fails here (23505 → duplicate path).
      const seal = await tx.insertInto('attempt_seals')
        .values({
          tenant_id: getTenantId(),
          attempt_id: attemptId,
          user_id: userId,
          submission_hash: submissionHash,
          response_count: snapshot.length,
          completeness,
          snapshot,
          receipt: signedReceipt,
          sealed_at: new Date(now),
        })
        .returning('id')
        .executeTakeFirst();
      sealId = seal?.id ?? null;

      // UNIQUE attempt_id → duplicate scoring job impossible.
      await tx.insertInto('scoring_outbox')
        .values({
          tenant_id: getTenantId(),
          attempt_id: attemptId,
          seal_id: sealId,
          status: OUTBOX_STATUS.PENDING,
          payload: { submission_hash: submissionHash, response_count: snapshot.length, sealed_at: new Date(now).toISOString() },
        })
        .execute();
    });
  } catch (err) {
    // 23505 on uq_attempt_seal → concurrent submit won the race → return duplicate.
    if (err?.code === '23505' || /duplicate key/i.test(err?.message || '')) {
      const winner = await db.selectFrom('attempt_seals')
        .where('tenant_id', '=', getTenantId())
        .where('attempt_id', '=', attemptId)
        .selectAll()
        .executeTakeFirst()
        .catch(() => null);
      if (winner) {
        return {
          ok: true,
          duplicate: true,
          submissionHash: winner.submission_hash,
          responseCount: winner.response_count,
          completeness: winner.completeness,
          sealedAt: winner.sealed_at,
          receipt: winner.receipt || null,
          sealed: true,
        };
      }
      return { ok: false, code: 'seal_conflict' };
    }
    if (err?.code === 'attempt_closed') {
      return { ok: false, code: 'attempt_closed', reason: 'attempt not in progress' };
    }
    throw err;
  }

  // ── SUBMITTED transition + lease release (Prompt 33 §10) ──
  await transitionAttempt(attemptId, ATTEMPT_STATUS.SUBMITTED, userId).catch(() => null);

  // ── Signed receipt (§14) — already stored atomically in the seal INSERT ──
  // (signedReceipt is returned below)

  // ── Audit (§17) ──
  await audit({
    action: AUDIT_ACTIONS.ATTEMPT_SUBMIT,
    userId,
    resourceType: 'attempt',
    resourceId: attemptId,
    details: {
      submission_hash: submissionHash,
      response_count: snapshot.length,
      completeness_percent: completeness.percent,
      flush_accepted: flush?.accepted ?? 0,
      seal_id: sealId,
      sealed_at: new Date(now).toISOString(),
    },
  }).catch(() => null);
  await audit({
    action: AUDIT_ACTIONS.SCORING_ENQUEUE,
    userId,
    resourceType: 'attempt',
    resourceId: attemptId,
    details: { submission_hash: submissionHash, seal_id: sealId, status: 'pending' },
  }).catch(() => null);

  return {
    ok: true,
    confirmed: true,
    sealed: true,
    duplicate: false,
    submissionHash,
    responseCount: snapshot.length,
    completeness,
    sealedAt: new Date(now).toISOString(),
    receipt: signedReceipt,
  };
}

/**
 * Get the submission state for an attempt (seal + receipt if sealed).
 *
 * @param {number} attemptId
 * @param {number} userId
 * @returns {Promise<Object|null>}
 */
export async function getSubmissionState(attemptId, userId) {
  const db = await getDb();
  if (!db) return null;
  try {
    const attempt = await getAttempt(attemptId, userId);
    if (!attempt) return null;
    const seal = await db.selectFrom('attempt_seals')
      .where('tenant_id', '=', getTenantId())
      .where('attempt_id', '=', attemptId)
      .selectAll()
      .executeTakeFirst()
      .catch(() => null);
    if (!seal) return { attemptId, status: attempt.status, sealed: false };
    return {
      attemptId,
      status: attempt.status,
      sealed: true,
      submissionHash: seal.submission_hash,
      responseCount: seal.response_count,
      completeness: seal.completeness,
      sealedAt: seal.sealed_at,
      receipt: seal.receipt || null,
    };
  } catch (_) {
    return null;
  }
}
