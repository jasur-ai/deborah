/**
 * Deborah — Response API, ACK Sequence & Autosave Service
 *
 * Prompt 31 — reliable autosave contract for MCQ, structured and essay
 * responses:
 *   - saveResponse: validates attempt ownership + window, resolves the
 *     response mode, validates client_seq/epoch, applies first/item_lock/
 *     editable semantics, persists (idempotently), returns a server ACK with
 *     the HIGHEST accepted sequence.
 *   - Essay autosave: full snapshot / minimal patch revisions persisted to
 *     attempt_response_revisions (prompt §11).
 *   - getResponseState / listResponses: recovery surface for the offline
 *     buffer + reconnect (Prompt 32 prep).
 *
 * SECURITY / DATA GUARD (Prompt 31 §15):
 *   - A response is NEVER reported as synced without a server ACK
 *     (highestAcceptedSeq is authoritative).
 *   - Raw essay text NEVER reaches audit/log events — audit stores item_id,
 *     seq, mode only.
 *   - Client time/epoch is never trusted for scoring — server_received_at is
 *     authoritative; epoch is only cross-checked for staleness.
 *
 * Graceful degradation: without PostgreSQL, read paths return null/[] and
 * write paths throw a clear 'PostgreSQL required' error.
 */

import { getDb } from '../../infrastructure/postgres.js';
import { getCurrentTenant } from '../auth/tenant-context.js';
import { audit, AUDIT_ACTIONS } from '../auth/audit.js';
import { getAttempt } from '../attempt/attempt.service.js';
import {
  RESPONSE_MODES,
  RESPONSE_STATUS,
  REJECTION_REASONS,
  resolveResponseMode,
  validateClientSeq,
  validateEpoch,
  isAttemptWindowOpen,
  evaluateItemLockGate,
  buildServerAck,
  decideEssayRevisionType,
  buildSaveState,
  deriveResponseKey,
  computeRetryDelay,
} from './response.schema.js';

function getTenantId() {
  return getCurrentTenant()?.tenantId || 1;
}

/**
 * Resolve the question type for an item from the attempt's content package.
 *
 * @param {Object} contentPackage - attempt.content_package
 * @param {number} itemId
 * @returns {string|null}
 */
export function resolveItemQuestionType(contentPackage = {}, itemId) {
  const items = Array.isArray(contentPackage?.items) ? contentPackage.items : [];
  const item = items.find((it) => Number(it?.item_id) === Number(itemId));
  return item?.question_type ?? null;
}

/**
 * Save a response for an attempt item (autosave contract).
 *
 * @param {Object} params
 * @param {number} params.attemptId
 * @param {number} params.userId
 * @param {number} params.itemId - item from the attempt's public content package
 * @param {number} params.clientSeq - monotonic per item
 * @param {Object} params.payload - { value }
 * @param {number|null} [params.clientEpoch] - client-provided time (optional, staleness only)
 * @param {string|null} [params.idempotencyKey] - derived client key
 * @param {Object} [params.opts] - { now, policyMode, essayPreviousText, essayLastSnapshotAt }
 *   NOTE: policyMode comes from the SERVER-side assessment policy snapshot
 *   only. A client-supplied mode is NEVER accepted (first-answer-final must
 *   not be downgradable to editable — Prompt 30 identityLevel bug class).
 * @returns {Promise<Object>} ACK contract
 */
export async function saveResponse({ attemptId, userId, itemId, clientSeq = 1, payload = {}, clientEpoch = null, idempotencyKey = null, opts = {} } = {}) {
  const db = await getDb();
  if (!db) throw new Error('PostgreSQL required');

  const attempt = await getAttempt(attemptId, userId);
  if (!attempt) return { ok: false, code: 'not_found' };

  // ── Window check (server-authoritative) ──
  const window = isAttemptWindowOpen({ endsAt: attempt.ends_at, now: opts.now || Date.now() });
  if (!window.open) {
    const ack = buildServerAck({ accepted: false, rejectionReason: REJECTION_REASONS.LATE, serverReceivedAt: opts.now || Date.now() });
    await audit({ action: AUDIT_ACTIONS.RESPONSE_REJECTED, userId, resourceType: 'attempt_response', resourceId: attemptId, details: { item_id: itemId, reason: REJECTION_REASONS.LATE } });
    return { ok: true, ack };
  }

  // ── Item membership + question type from the public content package ──
  const questionType = resolveItemQuestionType(attempt.content_package || {}, itemId);
  if (!questionType) {
    return { ok: true, ack: buildServerAck({ accepted: false, rejectionReason: REJECTION_REASONS.INVALID_ITEM, serverReceivedAt: opts.now || Date.now() }) };
  }

  // ── Mode resolution: SERVER-SIDE ONLY. The assessment policy snapshot
  //    (opts.policyMode) may override; the question type is the default.
  //    There is intentionally NO client-supplied mode path here.
  const resolvedMode = resolveResponseMode(questionType, { policyMode: opts.policyMode });
  if (!resolvedMode) {
    return { ok: true, ack: buildServerAck({ accepted: false, rejectionReason: REJECTION_REASONS.INVALID_MODE, serverReceivedAt: opts.now || Date.now() }) };
  }

  // ── Epoch staleness (server time authoritative) ──
  const epoch = validateEpoch({ clientEpoch, serverNow: opts.now || Date.now() });
  if (!epoch.accepted) {
    return { ok: true, ack: buildServerAck({ accepted: false, rejectionReason: REJECTION_REASONS.EPOCH_MISMATCH, serverReceivedAt: opts.now || Date.now() }) };
  }

  // ── Idempotency: same key → return the STORED ACK ──
  const key = idempotencyKey || deriveResponseKey(attemptId, itemId, clientSeq);
  const existingByKey = await db.selectFrom('attempt_responses')
    .where('tenant_id', '=', getTenantId())
    .where('idempotency_key', '=', key)
    .selectAll()
    .executeTakeFirst()
    .catch(() => null);
  if (existingByKey) {
    return {
      ok: true,
      duplicate: true,
      ack: buildServerAck({
        accepted: existingByKey.status === RESPONSE_STATUS.ACCEPTED,
        highestAcceptedSeq: existingByKey.client_seq,
        rejectionReason: existingByKey.rejection_reason,
        serverReceivedAt: existingByKey.server_received_at,
        responseId: existingByKey.id,
      }),
    };
  }

  // ── Latest accepted row for this item (seq + lock gates) ──
  const latest = await db.selectFrom('attempt_responses')
    .where('tenant_id', '=', getTenantId())
    .where('attempt_id', '=', attemptId)
    .where('item_id', '=', itemId)
    .where('status', '=', RESPONSE_STATUS.ACCEPTED)
    .orderBy('client_seq', 'desc')
    .limit(1)
    .selectAll()
    .executeTakeFirst()
    .catch(() => null);

  const lastAcceptedSeq = latest?.client_seq ?? 0;

  // ── first / item_lock gate: one accepted row per item ──
  const lockGate = evaluateItemLockGate({ mode: resolvedMode, hasAcceptedRow: !!latest });
  if (!lockGate.allowed) {
    return { ok: true, ack: buildServerAck({ accepted: false, rejectionReason: REJECTION_REASONS.ITEM_LOCKED, serverReceivedAt: opts.now || Date.now() }) };
  }

  // ── client_seq validation (in-order / duplicate / out-of-order) ──
  const seqCheck = validateClientSeq({ clientSeq, lastAcceptedSeq, mode: resolvedMode });
  if (!seqCheck.accepted) {
    return { ok: true, ack: buildServerAck({ accepted: false, rejectionReason: seqCheck.reason, serverReceivedAt: opts.now || Date.now() }) };
  }

  // ── Essay autosave: decide snapshot vs patch ──
  const isEssay = resolvedMode === RESPONSE_MODES.EDITABLE && ['essay', 'short_answer', 'fill_blanks'].includes(questionType);
  let revisionType = { patchType: 'snapshot', ops: null };
  if (isEssay) {
    // Snapshot cadence must be measured from the last FULL SNAPSHOT revision,
    // not the last response save (a patch in between would otherwise skew the
    // time-delta heuristic). Fall back to the caller's hint, then the latest
    // response, then null (first save → snapshot).
    let lastSnapshotAt = opts.essayLastSnapshotAt || null;
    if (!lastSnapshotAt) {
      lastSnapshotAt = await db.selectFrom('attempt_response_revisions')
        .where('tenant_id', '=', getTenantId())
        .where('attempt_id', '=', attemptId)
        .where('item_id', '=', itemId)
        .where('patch_type', '=', 'snapshot')
        .orderBy('revision', 'desc')
        .limit(1)
        .select('created_at')
        .executeTakeFirst()
        .catch(() => null);
      lastSnapshotAt = lastSnapshotAt?.created_at || latest?.created_at || null;
    }
    revisionType = decideEssayRevisionType({
      current: typeof payload?.value === 'string' ? payload.value : '',
      previous: opts.essayPreviousText || latest?.payload?.value || '',
      now: opts.now || Date.now(),
      lastSnapshotAt,
      opts,
    });
  }
  const revision = (latest?.revision ?? 0) + 1;

  // ── Persist in ONE transaction: response + optional revision row ──
  let inserted = null;
  try {
    await db.transaction().execute(async (tx) => {
      inserted = await tx.insertInto('attempt_responses')
        .values({
          tenant_id: getTenantId(),
          attempt_id: attemptId,
          user_id: userId,
          item_id: itemId,
          mode: resolvedMode,
          client_seq: clientSeq,
          revision,
          idempotency_key: key,
          status: RESPONSE_STATUS.ACCEPTED,
          payload,
          server_received_at: new Date(opts.now || Date.now()),
        })
        .returning('id')
        .executeTakeFirst();

      if (isEssay && inserted) {
        await tx.insertInto('attempt_response_revisions')
          .values({
            tenant_id: getTenantId(),
            response_id: inserted.id,
            attempt_id: attemptId,
            item_id: itemId,
            revision,
            patch_type: revisionType.patchType,
            snapshot: revisionType.patchType === 'snapshot' ? { value: payload.value } : {},
            patch: revisionType.patchType === 'patch' ? { ops: revisionType.ops } : {},
          })
          .execute();
      }
    });
  } catch (err) {
    // Atomic gates: unique (attempt, item, seq) OR first/item_lock accepted
    // unique → a concurrent duplicate save is rejected deterministically.
    if (err?.code === '23505' || /duplicate key/i.test(err?.message || '')) {
      const winner = await db.selectFrom('attempt_responses')
        .where('tenant_id', '=', getTenantId())
        .where('attempt_id', '=', attemptId)
        .where('item_id', '=', itemId)
        .orderBy('client_seq', 'desc')
        .limit(1)
        .selectAll()
        .executeTakeFirst()
        .catch(() => null);
      if (winner && winner.client_seq >= clientSeq) {
        return {
          ok: true,
          duplicate: true,
          ack: buildServerAck({
            accepted: true,
            highestAcceptedSeq: winner.client_seq,
            serverReceivedAt: winner.server_received_at,
            responseId: winner.id,
          }),
        };
      }
      return { ok: true, ack: buildServerAck({ accepted: false, rejectionReason: REJECTION_REASONS.DUPLICATE, serverReceivedAt: opts.now || Date.now() }) };
    }
    throw err;
  }

  // ── Minimal audit: NEVER the raw essay text (§15) ──
  await audit({
    action: AUDIT_ACTIONS.RESPONSE_SAVE,
    userId,
    resourceType: 'attempt_response',
    resourceId: inserted?.id ?? null,
    details: {
      attempt_id: attemptId,
      item_id: itemId,
      mode: resolvedMode,
      client_seq: clientSeq,
      revision,
      patch_type: revisionType.patchType,
    },
  });

  const ack = buildServerAck({
    accepted: true,
    highestAcceptedSeq: clientSeq,
    serverReceivedAt: opts.now || Date.now(),
    responseId: inserted?.id ?? null,
  });

  return {
    ok: true,
    duplicate: false,
    ack,
    revision,
    patchType: revisionType.patchType,
    saveState: buildSaveState({ state: 'synced', highestAcceptedSeq: clientSeq, acked: true }),
    retryDelayMs: computeRetryDelay(0),
  };
}

/**
 * Latest save-state for an item (recovery surface).
 *
 * @param {number} attemptId
 * @param {number} userId
 * @param {number} itemId
 * @returns {Promise<Object|null>}
 */
export async function getResponseState(attemptId, userId, itemId) {
  const db = await getDb();
  if (!db) return null;
  try {
    const attempt = await getAttempt(attemptId, userId);
    if (!attempt) return null;
    const latest = await db.selectFrom('attempt_responses')
      .where('tenant_id', '=', getTenantId())
      .where('attempt_id', '=', attemptId)
      .where('item_id', '=', itemId)
      .where('status', '=', RESPONSE_STATUS.ACCEPTED)
      .orderBy('client_seq', 'desc')
      .limit(1)
      .selectAll()
      .executeTakeFirst()
      .catch(() => null);
    if (!latest) return null;
    return {
      item_id: itemId,
      mode: latest.mode,
      client_seq: latest.client_seq,
      revision: latest.revision,
      payload: latest.payload,
      server_received_at: latest.server_received_at,
      saveState: buildSaveState({ state: 'synced', highestAcceptedSeq: latest.client_seq, acked: true }),
    };
  } catch (_) {
    return null;
  }
}

/**
 * List all accepted responses for an attempt (recovery / reconnect).
 *
 * @param {number} attemptId
 * @param {number} userId
 * @returns {Promise<Array<Object>>}
 */
export async function listResponses(attemptId, userId) {
  const db = await getDb();
  if (!db) return [];
  try {
    const attempt = await getAttempt(attemptId, userId);
    if (!attempt) return null; // owned attempt missing → route 404s
    return await db.selectFrom('attempt_responses')
      .where('tenant_id', '=', getTenantId())
      .where('attempt_id', '=', attemptId)
      .where('user_id', '=', userId)
      .orderBy('item_id', 'asc')
      .orderBy('client_seq', 'asc')
      .selectAll()
      .execute();
  } catch (_) {
    return [];
  }
}

/**
 * Essay revision history for an item.
 *
 * @param {number} attemptId
 * @param {number} userId
 * @param {number} itemId
 * @returns {Promise<Array<Object>>}
 */
export async function listEssayRevisions(attemptId, userId, itemId) {
  const db = await getDb();
  if (!db) return [];
  try {
    const attempt = await getAttempt(attemptId, userId);
    if (!attempt) return [];
    return await db.selectFrom('attempt_response_revisions')
      .where('tenant_id', '=', getTenantId())
      .where('attempt_id', '=', attemptId)
      .where('item_id', '=', itemId)
      .orderBy('revision', 'asc')
      .selectAll()
      .execute();
  } catch (_) {
    return [];
  }
}
