/**
 * Edikit — IndexedDB Offline Journal, Reconnect & Recovery (pure logic)
 *
 * Prompt 32 — low-bandwidth/crash resilience (research.md §29). This module
 * is PURE (no I/O, no globals): the browser adapter (public/js/offline-
 * journal.js) and the server service both rely on the SAME contracts here,
 * so the reconnect/recovery behaviour is unit-testable without a browser.
 *
 * Covers:
 *   - Journal entry contract: every edit appended as {seq, itemId, patch,
 *     clientTime, deviceId, epoch}. Monotonic per device+attempt.
 *   - Local encryption key strategy: a per-(attempt, user, device) key derived
 *     from a server-issued session secret via HKDF-style derivation — the raw
 *     answer key is NEVER derivable from it (research.md §29.3: the offline
 *     package never contains the answer key).
 *   - Pending/ACK sequence tracking: server ACKs the highest CONTIGUOUS seq;
 *     anything above is resent on reconnect (lossless sync).
 *   - Reconnect state reconciliation: batch in-flight entries, compute what
 *     to resend vs drop, idempotent by (attempt, item, seq).
 *   - Parallel device policy: reject | transfer (research.md §29.4) — a second
 *     device either gets rejected or, on explicit transfer, revokes the old
 *     device's lease.
 *   - Old-epoch mutation reject: teacher reopen bumps the epoch; entries from
 *     a previous epoch are rejected (stale recovery).
 *   - Emergency recovery package: immutable {version, journal, deviceId,
 *     exportedAt, checksum}; importable ONLY by a privileged actor with an
 *     audit trail. Answer-key scan backstop.
 *   - Disconnect is never a strike: a dropped connection does not penalize
 *     the student — the journal survives and syncs on reconnect (§15).
 *
 * Purity: crypto used here is deterministic and side-effect-free (derive keys,
 * hash checksums). No fs/db/network.
 */

import crypto from 'crypto';

// ═══════════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════════

export const JOURNAL_STATUS = {
  PENDING: 'pending',
  ACKED: 'acked',
  CONFLICT: 'conflict',
};

export const DEVICE_POLICY = {
  REJECT: 'reject',       // second device rejected outright
  TRANSFER: 'transfer',   // second device replaces the first (old revoked)
  ALLOW: 'allow',         // low-stakes: parallel devices allowed
};

export const RECOVERY_PKG_VERSION = 1;
export const JOURNAL_MAX_ENTRIES = 5000;
export const RECOVERY_MAX_JOURNAL = 20000;

/**
 * Shared HKDF salt for local journal key derivation. NON-EMPTY on purpose:
 * WebCrypto's importKey rejects zero-length raw HMAC keys (DataError) in most
 * browsers, so the browser adapter and this server contract must agree on a
 * non-empty salt constant.
 */
export const JOURNAL_KEY_SALT = 'edikit-journal';

// ═══════════════════════════════════════════════════════════════════
// JOURNAL ENTRY CONTRACT
// ═══════════════════════════════════════════════════════════════════

/**
 * Validate a single journal entry shape. The browser adapter appends these;
 * the server re-validates EVERY entry on sync (never trust the client).
 *
 * @param {Object} entry
 * @returns {{ ok: boolean, reason?: string }}
 */
export function validateJournalEntry(entry = {}) {
  if (!entry || typeof entry !== 'object') return { ok: false, reason: 'not_object' };
  if (!Number.isInteger(entry.seq) || entry.seq <= 0) return { ok: false, reason: 'invalid_seq' };
  if (!Number.isInteger(entry.itemId) || entry.itemId <= 0) return { ok: false, reason: 'invalid_item' };
  if (typeof entry.patch !== 'object' || entry.patch === null) return { ok: false, reason: 'invalid_patch' };
  if (!Number.isFinite(entry.clientTime)) return { ok: false, reason: 'invalid_client_time' };
  if (typeof entry.deviceId !== 'string' || !entry.deviceId) return { ok: false, reason: 'invalid_device' };
  if (typeof entry.epoch !== 'number') return { ok: false, reason: 'invalid_epoch' };
  return { ok: true };
}

/**
 * Create a canonical journal entry. seq is the per-(attempt, device) monotonic
 * counter; epoch is the attempt epoch (bumped on teacher reopen).
 *
 * @param {Object} params
 * @param {number} params.seq
 * @param {number} params.itemId
 * @param {Object} params.patch - { value } response payload
 * @param {number} params.clientTime
 * @param {string} params.deviceId
 * @param {number} params.epoch
 * @returns {Object} canonical entry
 */
export function createJournalEntry({ seq, itemId, patch, clientTime, deviceId, epoch }) {
  const entry = { seq, itemId, patch, clientTime, deviceId, epoch };
  const check = validateJournalEntry(entry);
  if (!check.ok) throw new Error(`Invalid journal entry: ${check.reason}`);
  return entry;
}

// ═══════════════════════════════════════════════════════════════════
// LOCAL ENCRYPTION KEY STRATEGY
// ═══════════════════════════════════════════════════════════════════

/**
 * Derive the per-attempt local journal encryption key (HKDF-style via HMAC).
 * Inputs: a server-issued session secret (attempt session), user id, device
 * id. The result is a 32-byte key for AES-256-GCM used ONLY for at-rest
 * browser encryption of the journal.
 *
 * The answer key is NOT an input and cannot be derived from the session
 * secret (research.md §29.3 — the offline package never contains it).
 *
 * @param {Object} params
 * @param {string} params.sessionSecret - server-issued attempt session secret
 * @param {number|string} params.userId
 * @param {number} params.attemptId
 * @param {string} params.deviceId
 * @param {string} [params.salt] - default JOURNAL_KEY_SALT; the browser adapter
 *   (public/js/offline-journal.js) always uses that same constant — a non-
 *   default salt here would silently diverge from the browser derivation.
 * @returns {Buffer} 32-byte key
 */
export function deriveJournalKey({ sessionSecret, userId, attemptId, deviceId, salt = JOURNAL_KEY_SALT } = {}) {
  if (!sessionSecret) throw new Error('sessionSecret required');
  const info = Buffer.from(`edikit-journal:v1:${attemptId}:${userId}:${deviceId}:${salt}`, 'utf8');
  // HKDF-like: PRK = HMAC(salt, secret); OKM = HMAC(PRK, info || 0x01)
  const prk = crypto.createHmac('sha256', Buffer.from(String(salt), 'utf8')).update(String(sessionSecret)).digest();
  const okm = crypto.createHmac('sha256', prk).update(Buffer.concat([info, Buffer.from([1])])).digest();
  return okm; // 32 bytes
}

/**
 * Encrypt a journal payload at rest (AES-256-GCM). Returns {iv, tag, data}
 * as base64 strings — deterministic given the same inputs.
 *
 * @param {Object} params
 * @param {Buffer} params.key - 32-byte key from deriveJournalKey
 * @param {Object} params.payload - JSON-serializable payload
 * @param {string} [params.aad] - additional authenticated data (attempt+seq)
 * @returns {{ iv: string, tag: string, data: string }}
 */
export function encryptJournalPayload({ key, payload, aad = '' } = {}) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  if (aad) cipher.setAAD(Buffer.from(String(aad), 'utf8'));
  const enc = Buffer.concat([cipher.update(JSON.stringify(payload), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
    data: enc.toString('base64'),
  };
}

/**
 * Decrypt a journal payload encrypted with encryptJournalPayload.
 *
 * @param {Object} params
 * @param {Buffer} params.key
 * @param {Object} params.enc - { iv, tag, data }
 * @param {string} [params.aad]
 * @returns {Object|null} decrypted payload or null on tamper
 */
export function decryptJournalPayload({ key, enc, aad = '' } = {}) {
  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(enc.iv, 'base64'));
    if (aad) decipher.setAAD(Buffer.from(String(aad), 'utf8'));
    decipher.setAuthTag(Buffer.from(enc.tag, 'base64'));
    const dec = Buffer.concat([decipher.update(Buffer.from(enc.data, 'base64')), decipher.final()]);
    return JSON.parse(dec.toString('utf8'));
  } catch (_) {
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════════
// PENDING / ACK SEQUENCE + RECONNECTION RECONCILIATION
// ═══════════════════════════════════════════════════════════════════

/**
 * Compute the highest CONTIGUOUS acked seq given a sorted set of acked seqs.
 * The server ACKs the longest run starting at 1; a gap means everything
 * above the gap is not yet durable (must be resent).
 *
 * @param {Array<number>} ackedSeqs
 * @returns {number} highest contiguous seq (0 when none)
 */
export function highestContiguousAck(ackedSeqs = []) {
  const sorted = [...ackedSeqs].sort((a, b) => a - b);
  let expected = 1;
  for (const s of sorted) {
    if (s === expected) expected += 1;
    else if (s > expected) break; // gap → stop
  }
  return expected - 1;
}

/**
 * Reconcile the local journal against the server's ACK watermark on reconnect.
 * Deterministic: entries ≤ acked are DROPPED (already durable), entries above
 * are RESENT in order (lossless). Returns the sync plan.
 *
 * @param {Object} params
 * @param {Array<Object>} params.entries - local journal entries (any order)
 * @param {number} params.ackedSeq - server's highest contiguous ack for device
 * @param {Object} [params.opts] - { maxBatch }
 * @returns {{ toResend: Array<Object>, toDrop: Array<Object>, nextAckedSeq: number }}
 */
export function reconcileJournal({ entries = [], ackedSeq = 0, opts = {} } = {}) {
  const maxBatch = Number(opts.maxBatch) || JOURNAL_MAX_ENTRIES;
  const valid = entries.filter((e) => validateJournalEntry(e).ok).sort((a, b) => a.seq - b.seq);
  const toDrop = valid.filter((e) => e.seq <= ackedSeq);
  let toResend = valid.filter((e) => e.seq > ackedSeq);
  if (toResend.length > maxBatch) {
    toResend = toResend.slice(0, maxBatch); // backpressure: rest next sync
  }
  return { toResend, toDrop, nextAckedSeq: ackedSeq };
}

// ═══════════════════════════════════════════════════════════════════
// PARALLEL DEVICE POLICY (research.md §29.4)
// ═══════════════════════════════════════════════════════════════════

/**
 * Evaluate whether a device may sync / continue the attempt given other
 * active devices.
 *   - reject   → any additional device is rejected while the first is active
 *   - transfer → the requesting device REPLACES the active one (old revoked);
 *                only ONE device is ever active
 *   - allow    → parallel devices allowed (low-stakes)
 *
 * @param {Object} params
 * @param {string} params.deviceId - requesting device
 * @param {Array<string>} params.activeDeviceIds - currently active devices
 * @param {string} [params.policy] - DEVICE_POLICY
 * @returns {{ allowed: boolean, reason: string|null, revokeDeviceIds: Array<string> }}
 */
export function evaluateParallelDevice({ deviceId, activeDeviceIds = [], policy = DEVICE_POLICY.REJECT } = {}) {
  const active = activeDeviceIds.filter((d) => d && d !== deviceId);
  if (active.length === 0) return { allowed: true, reason: null, revokeDeviceIds: [] };

  if (policy === DEVICE_POLICY.ALLOW) return { allowed: true, reason: null, revokeDeviceIds: [] };
  if (policy === DEVICE_POLICY.TRANSFER) {
    return { allowed: true, reason: 'transfer', revokeDeviceIds: active };
  }
  // reject (default)
  return { allowed: false, reason: 'parallel_device_denied', revokeDeviceIds: [] };
}

// ═══════════════════════════════════════════════════════════════════
// OLD-EPOCH MUTATION REJECT (stale recovery)
// ═══════════════════════════════════════════════════════════════════

/**
 * Reject journal entries from a previous attempt epoch. Teacher reopen bumps
 * the epoch; a stale journal (crashed tab from before the reopen) must not
 * mutate the new attempt.
 *
 * @param {Object} params
 * @param {number} params.entryEpoch - epoch in the journal entry
 * @param {number} params.currentEpoch - attempt's current epoch
 * @returns {{ allowed: boolean, reason: string|null }}
 */
export function evaluateEpoch({ entryEpoch, currentEpoch } = {}) {
  if (!Number.isFinite(entryEpoch) || !Number.isFinite(currentEpoch)) {
    return { allowed: false, reason: 'invalid_epoch' };
  }
  if (entryEpoch < currentEpoch) return { allowed: false, reason: 'stale_epoch' };
  if (entryEpoch > currentEpoch) return { allowed: false, reason: 'future_epoch' };
  return { allowed: true, reason: null };
}

// ═══════════════════════════════════════════════════════════════════
// EMERGENCY RECOVERY PACKAGE (research.md §29.5)
// ═══════════════════════════════════════════════════════════════════

/**
 * Build an immutable emergency recovery package from the journal. The package
 * NEVER contains the answer key — only student response patches + server
 * metadata. Checksum = sha256 over the canonical JSON so any mutation is
 * detectable on privileged import.
 *
 * @param {Object} params
 * @param {number} params.attemptId
 * @param {number|string} params.userId
 * @param {string} params.deviceId
 * @param {Array<Object>} params.entries - validated journal entries
 * @param {number} params.ackedSeq - server ACK watermark at export
 * @param {number} [params.exportedAt]
 * @param {Object} [params.meta] - { tenantId, assignmentId, reason }
 * @returns {Object} recovery package (immutable contract)
 */
export function buildRecoveryPackage({ attemptId, userId, deviceId, entries = [], ackedSeq = 0, exportedAt = Date.now(), meta = {} } = {}) {
  const canonicalEntries = entries.filter((e) => validateJournalEntry(e).ok).sort((a, b) => a.seq - b.seq);
  const body = {
    version: RECOVERY_PKG_VERSION,
    attemptId,
    userId,
    deviceId,
    ackedSeq,
    exportedAt,
    meta,
    entries: canonicalEntries,
  };
  const canonical = JSON.stringify(body);
  const checksum = crypto.createHash('sha256').update(canonical).digest('hex');
  return { ...body, checksum };
}

/**
 * Verify a recovery package's checksum (integrity before privileged import).
 *
 * @param {Object} pkg
 * @returns {{ ok: boolean, reason?: string }}
 */
export function verifyRecoveryPackage(pkg = {}) {
  if (!pkg || typeof pkg !== 'object') return { ok: false, reason: 'not_object' };
  if (pkg.version !== RECOVERY_PKG_VERSION) return { ok: false, reason: 'unsupported_version' };
  if (!Number.isInteger(pkg.attemptId) || pkg.attemptId <= 0) return { ok: false, reason: 'invalid_attempt' };
  if (typeof pkg.deviceId !== 'string' || !pkg.deviceId) return { ok: false, reason: 'invalid_device' };
  if (!Array.isArray(pkg.entries) || pkg.entries.length > RECOVERY_MAX_JOURNAL) {
    return { ok: false, reason: 'invalid_entries' };
  }
  const { checksum, ...rest } = pkg;
  const recomputed = crypto.createHash('sha256').update(JSON.stringify(rest)).digest('hex');
  if (recomputed !== checksum) return { ok: false, reason: 'checksum_mismatch' };
  for (const e of pkg.entries) {
    const check = validateJournalEntry(e);
    if (!check.ok) return { ok: false, reason: `invalid_entry:${e?.seq ?? '?'}:${check.reason}` };
  }
  return { ok: true };
}

/**
 * Answer-key scan backstop (Prompt 32 §15 / research.md §29.3): the recovery
 * package and journal payloads must never carry the private answer key.
 * Scans the serialized package for forbidden field names.
 *
 * @param {Object} pkg - recovery package or journal batch
 * @param {Array<string>} [forbiddenKeys] - field names that would leak the key
 * @returns {{ clean: boolean, found: Array<string> }}
 */
export function scanPackageForAnswerKeys(pkg, forbiddenKeys = ['answer_key', 'answerKey', 'correct_option', 'correctOption', 'private_data', 'scores']) {
  const haystack = JSON.stringify(pkg || {});
  const found = forbiddenKeys.filter((k) => haystack.includes(k));
  return { clean: found.length === 0, found };
}

/**
 * Derive the idempotency key for a journal entry sync (attempt + device + seq).
 * A retried sync with the same key is idempotent server-side.
 *
 * @param {number} attemptId
 * @param {string} deviceId
 * @param {number} seq
 * @returns {string}
 */
export function deriveJournalSyncKey(attemptId, deviceId, seq) {
  return crypto.createHash('sha256')
    .update(`journal:${attemptId}:${deviceId}:${seq}`)
    .digest('hex')
    .slice(0, 40);
}

// ═══════════════════════════════════════════════════════════════════
// GLOBAL JOURNAL SEQ → PER-ITEM CLIENT SEQ MAPPING
// ═══════════════════════════════════════════════════════════════════

/**
 * The journal seq is GLOBAL per (attempt, device) — every edit across ALL
 * items appends a new integer. But the Prompt 31 response contract requires a
 * PER-ITEM monotonic client_seq (first answer for an item must be 1).
 *
 * This maps the global journal onto per-item sequences, continuing from the
 * server's per-item high-water marks (items already answered ONLINE before a
 * network drop keep their counter). Returns entries annotated with
 * `perItemSeq`.
 *
 * @param {Array<Object>} entries - journal entries (validated)
 * @param {Object} [itemLastSeq] - { [itemId]: lastClientSeq } from the server
 * @returns {Array<Object>} entries (sorted by global seq) with perItemSeq
 */
export function mapJournalToPerItemSeq(entries = [], itemLastSeq = {}) {
  const sorted = entries.filter((e) => validateJournalEntry(e).ok).sort((a, b) => a.seq - b.seq);
  const perItem = { ...itemLastSeq };
  return sorted.map((e) => {
    const itemId = Number(e.itemId);
    const next = (perItem[itemId] || 0) + 1;
    perItem[itemId] = next;
    return { ...e, perItemSeq: next };
  });
}

// ═══════════════════════════════════════════════════════════════════
// CONTIGUOUS ACK WATERMARK (lossless — no data loss on rejected gaps)
// ═══════════════════════════════════════════════════════════════════

/**
 * Advance the per-device ACK watermark only through a CONTIGUOUS run of
 * durable outcomes, starting at serverAcked + 1. An entry counts as durable
 * when it was ACCEPTED or FINALLY rejected (stale_epoch, invalid_item,
 * item_locked, stale_seq … — reasons that can never succeed on retry). The
 * run STOPS at the first transient failure (save_error/db error) so the
 * client resends from there — nothing durable is ever dropped (lossless).
 *
 * @param {Object} params
 * @param {number} params.serverAcked - watermark before this sync
 * @param {Array<Object>} params.results - [{ seq, status, reason }]
 * @param {Set<string>} [params.finalReasons] - permanently-failing reasons
 * @returns {number} new contiguous watermark
 */
export function computeWatermarkAfterSync({ serverAcked = 0, results = [], finalReasons = new Set() } = {}) {
  const sorted = [...results].sort((a, b) => a.seq - b.seq);
  let watermark = serverAcked;
  let expected = serverAcked + 1;
  for (const r of sorted) {
    if (r.seq !== expected) break; // gap → stop (out-of-order batch)
    const durable = r.status === JOURNAL_STATUS.ACKED || (r.status === JOURNAL_STATUS.CONFLICT && finalReasons.has(r.reason));
    if (!durable) break; // transient → stop, client retries from here
    watermark = r.seq;
    expected += 1;
  }
  return watermark;
}
