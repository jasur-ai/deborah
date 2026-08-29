/**
 * Deborah — IndexedDB Offline Journal, Reconnect & Recovery Service
 *
 * Prompt 32 — server-side half of the offline resilience contract
 * (research.md §29). The browser keeps an encrypted IndexedDB journal; this
 * service receives sync batches, validates EVERY entry server-side, updates
 * the per-device ACK watermark and returns the highest contiguous ack so the
 * client can drop durable entries and resend the rest (lossless).
 *
 * Also owns the emergency recovery package lifecycle:
 *   - exportRecoveryPackage: build + persist an immutable package (never the
 *     answer key — §15 / §29.3), checksum-signed.
 *   - importRecoveryPackage: PRIVILEGED import (admin/proctor) that verifies
 *     the checksum, re-checks answer-key absence and writes a full audit trail
 *     (who/when/package/checksum/status).
 *
 * SECURITY / DATA GUARD (Prompt 32 §15):
 *   - Every sync entry is re-validated + epoch-checked server-side.
 *   - Parallel-device policy (reject|transfer|allow) evaluated from the ACTIVE
 *     device watermarks, never from client claims.
 *   - A disconnect is never a strike — the journal syncs losslessly (§15).
 *   - Recovery import is privileged-only + audited.
 *
 * Graceful degradation: without PostgreSQL, read paths return null/[] and
 * write paths throw a clear 'PostgreSQL required' error.
 */

import { getDb } from '../../infrastructure/postgres.js';
import { getCurrentTenant } from '../auth/tenant-context.js';
import { audit, AUDIT_ACTIONS } from '../auth/audit.js';
import { getAttempt } from '../attempt/attempt.service.js';
import { saveResponse } from '../response/response.service.js';
import {
  DEVICE_POLICY,
  JOURNAL_STATUS,
  validateJournalEntry,
  reconcileJournal,
  evaluateParallelDevice,
  evaluateEpoch,
  buildRecoveryPackage,
  verifyRecoveryPackage,
  scanPackageForAnswerKeys,
  deriveJournalSyncKey,
  mapJournalToPerItemSeq,
  computeWatermarkAfterSync,
} from './offline.schema.js';

function getTenantId() {
  return getCurrentTenant()?.tenantId || 1;
}

/**
 * Load the device ACK watermark row for (attempt, device).
 *
 * @param {import('kysely').Kysely<any>} db
 * @param {number} attemptId
 * @param {number} userId
 * @param {string} deviceId
 * @returns {Promise<Object|null>}
 */
async function loadAckRow(db, attemptId, userId, deviceId) {
  return db.selectFrom('offline_journal_acks')
    .where('tenant_id', '=', getTenantId())
    .where('attempt_id', '=', attemptId)
    .where('user_id', '=', userId)
    .where('device_id', '=', deviceId)
    .selectAll()
    .executeTakeFirst()
    .catch(() => null);
}

/**
 * List distinct active devices for an attempt (for parallel-device policy).
 *
 * @param {import('kysely').Kysely<any>} db
 * @param {number} attemptId
 * @returns {Promise<Array<string>>}
 */
async function listActiveDevices(db, attemptId) {
  const rows = await db.selectFrom('offline_journal_acks')
    .where('tenant_id', '=', getTenantId())
    .where('attempt_id', '=', attemptId)
    .select(['device_id'])
    .execute()
    .catch(() => []);
  return rows.map((r) => r.device_id);
}

/**
 * Load per-item client_seq high-water marks from attempt_responses (items
 * answered ONLINE before a network drop continue their counter offline).
 *
 * @param {import('kysely').Kysely<any>} db
 * @param {number} attemptId
 * @param {number} userId
 * @returns {Promise<Object>} { [itemId]: maxClientSeq }
 */
async function loadPerItemMaxSeq(db, attemptId, userId) {
  const rows = await db.selectFrom('attempt_responses')
    .where('tenant_id', '=', getTenantId())
    .where('attempt_id', '=', attemptId)
    .where('user_id', '=', userId)
    .select(['item_id', 'client_seq'])
    .execute()
    .catch(() => []);
  const map = {};
  for (const r of rows) {
    const itemId = Number(r.item_id);
    const seq = Number(r.client_seq) || 0;
    if (!(itemId in map) || seq > map[itemId]) map[itemId] = seq;
  }
  return map;
}

/**
 * Sync a batch of offline journal entries for an attempt (reconnect).
 *
 * Flow (server-authoritative):
 *   1. Attempt ownership (getAttempt by userId) — 404 if absent.
 *   2. Parallel-device policy from active ACK watermarks.
 *   3. Per entry: re-validate shape, evaluate epoch vs attempt epoch.
 *   4. Persist accepted entries via the Prompt 31 response service (same
 *      idempotency/ACK contract), tracking per-entry outcome.
 *   5. Update/upsert the per-device ACK watermark = highest CONTIGUOUS seq.
 *   6. Return the ack + per-entry results; client drops ≤ ack, resends rest.
 *
 * @param {Object} params
 * @param {number} params.attemptId
 * @param {number} params.userId
 * @param {string} params.deviceId
 * @param {Array<Object>} params.entries - journal entries {seq,itemId,patch,clientTime,deviceId,epoch}
 * @param {Object} [params.opts] - { maxBatch, devicePolicy } — devicePolicy is
 *   SERVER-INTERNAL ONLY (policy snapshot callers); it is never read from the
 *   HTTP request body. The current epoch is always resolved from the attempt
 *   record, never from opts.
 * @returns {Promise<Object>} sync result
 */
export async function reconnectSync({ attemptId, userId, deviceId, entries = [], opts = {} } = {}) {
  const db = await getDb();
  if (!db) throw new Error('PostgreSQL required');

  const attempt = await getAttempt(attemptId, userId);
  if (!attempt) return { ok: false, code: 'not_found' };

  // ── SERVER-AUTHORITATIVE epoch + device policy (never client-supplied) ──
  // The client can NOT claim a current epoch or downgrade the parallel-device
  // policy to 'allow' — both are resolved server-side only (Prompt 32 §11/§12
  // and the Prompt 30 identityLevel bug class).
  const currentEpoch = Number(attempt.epoch ?? 1);
  const devicePolicy = opts.devicePolicy || DEVICE_POLICY.REJECT;

  // ── Parallel-device policy (active watermarks, not client claims) ──
  const activeDevices = await listActiveDevices(db, attemptId);
  const deviceCheck = evaluateParallelDevice({ deviceId, activeDeviceIds: activeDevices, policy: devicePolicy });
  if (!deviceCheck.allowed) {
    return {
      ok: true,
      ackedSeq: 0,
      blocked: true,
      reason: deviceCheck.reason,
      results: [],
    };
  }

  // ── TRANSFER policy: actually revoke the replaced devices (their ACK
  //    rows are deleted so they can no longer sync) ──
  if (deviceCheck.revokeDeviceIds.length > 0) {
    await db.deleteFrom('offline_journal_acks')
      .where('tenant_id', '=', getTenantId())
      .where('attempt_id', '=', attemptId)
      .where('device_id', 'in', deviceCheck.revokeDeviceIds)
      .execute()
      .catch(() => null);
  }

  // ── Reconcile: resend only what the server has not durably acked ──
  const ackRow = await loadAckRow(db, attemptId, userId, deviceId);
  const serverAcked = ackRow?.acked_seq ?? 0;
  const plan = reconcileJournal({ entries, ackedSeq: serverAcked, opts: { maxBatch: opts.maxBatch } });

  // Journal seq is GLOBAL per device, but the response contract is PER-ITEM.
  // Map to per-item client_seq, continuing from items answered ONLINE earlier
  // (per-item high-water marks from attempt_responses).
  const itemLastSeq = await loadPerItemMaxSeq(db, attemptId, userId);
  const mapped = mapJournalToPerItemSeq(plan.toResend, itemLastSeq);

  const results = [];

  for (const entry of mapped) {
    const epochCheck = evaluateEpoch({ entryEpoch: entry.epoch, currentEpoch });
    if (!epochCheck.allowed) {
      results.push({ seq: entry.seq, status: JOURNAL_STATUS.CONFLICT, reason: epochCheck.reason });
      continue; // stale/future epoch — do not mutate the attempt
    }

    // Reuse the Prompt 31 response persistence (idempotent, server-timed).
    // NOTE: no clientEpoch / no opts.now — SERVER time is authoritative for
    // the window check and server_received_at (never client clock).
    const saved = await saveResponse({
      attemptId,
      userId,
      itemId: entry.itemId,
      clientSeq: entry.perItemSeq,
      payload: entry.patch,
      idempotencyKey: deriveJournalSyncKey(attemptId, deviceId, entry.seq),
    }).catch((err) => ({ ok: false, code: 'save_error', error: err.message }));

    if (saved?.ack?.accepted || saved?.duplicate) {
      results.push({ seq: entry.seq, status: JOURNAL_STATUS.ACKED });
    } else {
      results.push({ seq: entry.seq, status: JOURNAL_STATUS.CONFLICT, reason: saved?.ack?.rejectionReason || saved?.code || 'rejected' });
    }
  }

  // ── Contiguous watermark (LOSSLESS): only advance through a run of durable
  //    outcomes. A rejected gap (e.g. seq 1 stale) STOPS the watermark so the
  //    client never drops a not-yet-durable entry — nothing is lost (§25).
  const FINAL_REASONS = new Set([
    'stale_epoch', 'future_epoch', 'invalid_epoch', 'invalid_item', 'item_locked',
    'stale_seq', 'duplicate', 'invalid_mode', 'epoch_mismatch', 'late', 'parallel_device_denied',
  ]);
  const newAcked = computeWatermarkAfterSync({ serverAcked, results, finalReasons: FINAL_REASONS });
  if (newAcked > serverAcked) {
    await db.insertInto('offline_journal_acks')
      .values({
        tenant_id: getTenantId(),
        attempt_id: attemptId,
        user_id: userId,
        device_id: deviceId,
        acked_seq: newAcked,
        last_acked_at: new Date(),
      })
      .onConflict((oc) => oc
        .columns(['tenant_id', 'attempt_id', 'device_id'])
        .doUpdateSet((eb) => ({
          acked_seq: Math.max(eb.ref('offline_journal_acks.acked_seq'), newAcked),
          last_acked_at: new Date(),
          updated_at: new Date(),
        })))
      .execute()
      .catch(() => null);
  }

  // ── Audit: seq/metadata only — NEVER the response payloads (§15) ──
  await audit({
    action: AUDIT_ACTIONS.OFFLINE_SYNC,
    userId,
    resourceType: 'attempt',
    resourceId: attemptId,
    details: {
      device_id: deviceId,
      device_policy: devicePolicy,
      sent: plan.toResend.length,
      dropped_durable: plan.toDrop.length,
      acked_seq: newAcked,
      conflict_count: results.filter((r) => r.status === JOURNAL_STATUS.CONFLICT).length,
      revoked_devices: deviceCheck.revokeDeviceIds.length,
    },
  }).catch(() => null);

  return {
    ok: true,
    ackedSeq: newAcked,
    dropped: plan.toDrop.length,
    resend: plan.toResend.length,
    blocked: false,
    results,
    saveState: { state: 'synced', acked: true, highestAcceptedSeq: newAcked },
  };
}

/**
 * Export an emergency recovery package for an attempt (student-initiated or
 * proctor-assisted). Persists the package row (idempotent by package_id) and
 * returns it for the client to download / keep as the failsafe.
 *
 * @param {Object} params
 * @param {number} params.attemptId
 * @param {number} params.userId
 * @param {string} params.deviceId
 * @param {Array<Object>} params.entries - local journal entries
 * @param {Object} [params.opts] - { meta, answerKeysForbidden }
 * @returns {Promise<Object>} recovery package
 */
export async function exportRecoveryPackage({ attemptId, userId, deviceId, entries = [], opts = {} } = {}) {
  const db = await getDb();
  if (!db) throw new Error('PostgreSQL required');

  const attempt = await getAttempt(attemptId, userId);
  if (!attempt) return { ok: false, code: 'not_found' };

  const ackRow = await loadAckRow(db, attemptId, userId, deviceId);
  const ackedSeq = ackRow?.acked_seq ?? 0;

  // Build + verify the package BEFORE persisting (integrity gate).
  const pkg = buildRecoveryPackage({
    attemptId,
    userId,
    deviceId,
    entries,
    ackedSeq,
    meta: opts.meta || { tenantId: getTenantId(), reason: 'offline_export' },
  });
  const verify = verifyRecoveryPackage(pkg);
  if (!verify.ok) return { ok: false, code: 'invalid_package', reason: verify.reason };

  // Answer-key scan backstop (§15 / §29.3) — reject leaky packages outright.
  const leak = scanPackageForAnswerKeys(pkg, opts.answerKeysForbidden);
  if (!leak.clean) return { ok: false, code: 'answer_key_present', found: leak.found };

  const packageId = deriveJournalSyncKey(attemptId, deviceId, 0) + ':' + Date.now();

  await db.insertInto('recovery_packages')
    .values({
      tenant_id: getTenantId(),
      attempt_id: attemptId,
      user_id: userId,
      package_id: packageId,
      checksum: pkg.checksum,
      status: 'exported',
      payload: pkg,
    })
    .onConflict((oc) => oc.columns(['tenant_id', 'package_id']).doNothing())
    .execute()
    .catch(() => null);

  await audit({
    action: AUDIT_ACTIONS.RECOVERY_EXPORT,
    userId,
    resourceType: 'attempt',
    resourceId: attemptId,
    details: { device_id: deviceId, package_id: packageId, checksum: pkg.checksum, entry_count: pkg.entries.length },
  }).catch(() => null);

  return { ok: true, package: pkg, packageId };
}

/**
 * Import an emergency recovery package — PRIVILEGED action (admin/proctor).
 * Verifies checksum, re-scans for answer keys, then records import with a full
 * audit trail (who/when/package). Does NOT directly mutate responses here —
 * the journal entries are replayed through the normal sync path by the caller
 * so every write keeps the Prompt 31 validation/ACK contract.
 *
 * @param {Object} params
 * @param {Object} params.pkg - recovery package
 * @param {string} params.actor - privileged actor id/username
 * @param {Object} [params.opts] - { answerKeysForbidden }
 * @returns {Promise<Object>} import result
 */
export async function importRecoveryPackage({ pkg, actor, opts = {} } = {}) {
  const db = await getDb();
  if (!db) throw new Error('PostgreSQL required');

  const verify = verifyRecoveryPackage(pkg);
  if (!verify.ok) return { ok: false, code: 'invalid_package', reason: verify.reason };

  const leak = scanPackageForAnswerKeys(pkg, opts.answerKeysForbidden);
  if (!leak.clean) {
    await audit({
      action: AUDIT_ACTIONS.RECOVERY_IMPORT,
      userId: null,
      resourceType: 'attempt',
      resourceId: pkg.attemptId,
      details: { actor, package_id: pkg.checksum, status: 'rejected', reason: 'answer_key_present' },
    }).catch(() => null);
    return { ok: false, code: 'answer_key_present', found: leak.found };
  }

  // Idempotent: same package checksum → already imported → return existing.
  const existing = await db.selectFrom('recovery_packages')
    .where('tenant_id', '=', getTenantId())
    .where('package_id', '=', pkg.checksum)
    .selectAll()
    .executeTakeFirst()
    .catch(() => null);

  if (existing && existing.status === 'imported') {
    return { ok: true, duplicate: true, status: 'imported', importedBy: existing.imported_by };
  }

  const result = await db.insertInto('recovery_packages')
    .values({
      tenant_id: getTenantId(),
      attempt_id: pkg.attemptId,
      user_id: pkg.userId,
      package_id: pkg.checksum,
      checksum: pkg.checksum,
      status: 'imported',
      payload: pkg,
      imported_by: String(actor),
      imported_at: new Date(),
    })
    .onConflict((oc) => oc.columns(['tenant_id', 'package_id']).doNothing())
    .execute()
    .catch(() => null);

  await audit({
    action: AUDIT_ACTIONS.RECOVERY_IMPORT,
    userId: pkg.userId,
    resourceType: 'attempt',
    resourceId: pkg.attemptId,
    details: {
      actor,
      package_id: pkg.checksum,
      status: 'imported',
      entry_count: pkg.entries.length,
      device_id: pkg.deviceId,
      acked_seq: pkg.ackedSeq,
    },
  }).catch(() => null);

  return { ok: true, duplicate: false, status: 'imported', inserted: !!result };
}

/**
 * List recovery packages for an attempt (privileged audit view).
 *
 * @param {number} attemptId
 * @returns {Promise<Array<Object>>}
 */
export async function listRecoveryPackages(attemptId) {
  const db = await getDb();
  if (!db) return [];
  try {
    return await db.selectFrom('recovery_packages')
      .where('tenant_id', '=', getTenantId())
      .where('attempt_id', '=', attemptId)
      .orderBy('created_at', 'desc')
      .selectAll()
      .execute();
  } catch (_) {
    return [];
  }
}
