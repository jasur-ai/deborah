/**
 * Edikit — IndexedDB Offline Journal, Reconnect & Recovery Tests
 *
 * Covers (Prompt 32, research.md §29):
 *   - Journal entry contract (validate/create)
 *   - Local encryption key strategy (deterministic derivation, AES-GCM
 *     round-trip, tamper detection)
 *   - Pending/ACK sequence: highest contiguous ACK, reconcile (drop durable,
 *     resend the rest — lossless)
 *   - Parallel device policy: reject | transfer | allow
 *   - Old-epoch mutation reject (stale recovery)
 *   - Emergency recovery package: build, verify, checksum tamper, answer-key
 *     scan backstop (§15 — the package never carries the answer key)
 *   - Service graceful degradation without PostgreSQL
 *   - Barrel export
 */

import { describe, it, expect } from 'vitest';

import {
  // schema (pure)
  JOURNAL_STATUS,
  DEVICE_POLICY,
  RECOVERY_PKG_VERSION,
  validateJournalEntry,
  createJournalEntry,
  deriveJournalKey,
  encryptJournalPayload,
  decryptJournalPayload,
  highestContiguousAck,
  reconcileJournal,
  evaluateParallelDevice,
  evaluateEpoch,
  buildRecoveryPackage,
  verifyRecoveryPackage,
  scanPackageForAnswerKeys,
  deriveJournalSyncKey,
  mapJournalToPerItemSeq,
  computeWatermarkAfterSync,
} from '../../src/modules/offline/offline.schema.js';

import {
  // service
  reconnectSync,
  exportRecoveryPackage,
  importRecoveryPackage,
  listRecoveryPackages,
} from '../../src/modules/offline/offline.service.js';

// ═══════════════════════════════════════════════════════════════════
// JOURNAL ENTRY CONTRACT
// ═══════════════════════════════════════════════════════════════════

describe('Offline — Journal Entry Contract', () => {
  it('should validate a canonical entry', () => {
    expect(validateJournalEntry({
      seq: 1, itemId: 5, patch: { value: 'A' }, clientTime: 1725000000000, deviceId: 'dev-1', epoch: 1,
    }).ok).toBe(true);
  });

  it('should reject malformed entries', () => {
    expect(validateJournalEntry({}).ok).toBe(false);
    expect(validateJournalEntry({ seq: 0, itemId: 5, patch: {}, clientTime: 1, deviceId: 'd', epoch: 1 }).ok).toBe(false);
    expect(validateJournalEntry({ seq: 1, itemId: 0, patch: {}, clientTime: 1, deviceId: 'd', epoch: 1 }).ok).toBe(false);
    expect(validateJournalEntry({ seq: 1, itemId: 5, patch: null, clientTime: 1, deviceId: 'd', epoch: 1 }).ok).toBe(false);
    expect(validateJournalEntry({ seq: 1, itemId: 5, patch: {}, clientTime: 'x', deviceId: 'd', epoch: 1 }).ok).toBe(false);
    expect(validateJournalEntry({ seq: 1, itemId: 5, patch: {}, clientTime: 1, deviceId: '', epoch: 1 }).ok).toBe(false);
    expect(validateJournalEntry({ seq: 1, itemId: 5, patch: {}, clientTime: 1, deviceId: 'd', epoch: 'x' }).ok).toBe(false);
  });

  it('should create a canonical entry and reject invalid ones', () => {
    const e = createJournalEntry({ seq: 3, itemId: 7, patch: { value: 'x' }, clientTime: 1, deviceId: 'dev-9', epoch: 2 });
    expect(e.seq).toBe(3);
    expect(e.epoch).toBe(2);
    expect(() => createJournalEntry({ seq: 0, itemId: 7, patch: {}, clientTime: 1, deviceId: 'd', epoch: 1 }))
      .toThrow('Invalid journal entry');
  });
});

// ═══════════════════════════════════════════════════════════════════
// LOCAL ENCRYPTION KEY STRATEGY
// ═══════════════════════════════════════════════════════════════════

describe('Offline — Local Encryption Key Strategy', () => {
  it('should derive a deterministic 32-byte key', () => {
    const k1 = deriveJournalKey({ sessionSecret: 'sec', userId: 1, attemptId: 2, deviceId: 'dev-1' });
    const k2 = deriveJournalKey({ sessionSecret: 'sec', userId: 1, attemptId: 2, deviceId: 'dev-1' });
    expect(k1).toEqual(k2);
    expect(k1.length).toBe(32);
  });

  it('should derive DIFFERENT keys for different devices/attempts/users', () => {
    const base = { sessionSecret: 'sec', userId: 1, attemptId: 2, deviceId: 'dev-1' };
    expect(deriveJournalKey(base)).not.toEqual(deriveJournalKey({ ...base, deviceId: 'dev-2' }));
    expect(deriveJournalKey(base)).not.toEqual(deriveJournalKey({ ...base, attemptId: 3 }));
    expect(deriveJournalKey(base)).not.toEqual(deriveJournalKey({ ...base, userId: 2 }));
  });

  it('should round-trip AES-GCM encryption with AAD', () => {
    const key = deriveJournalKey({ sessionSecret: 's', userId: 1, attemptId: 2, deviceId: 'd' });
    const enc = encryptJournalPayload({ key, payload: { value: 'hello' }, aad: '2:1' });
    expect(enc.iv && enc.tag && enc.data).toBeTruthy();
    expect(decryptJournalPayload({ key, enc, aad: '2:1' })).toEqual({ value: 'hello' });
  });

  it('should detect tampering (wrong AAD / wrong key → null)', () => {
    const key = deriveJournalKey({ sessionSecret: 's', userId: 1, attemptId: 2, deviceId: 'd' });
    const enc = encryptJournalPayload({ key, payload: { value: 'hello' }, aad: '2:1' });
    expect(decryptJournalPayload({ key, enc, aad: '2:9' })).toBeNull();
    const otherKey = deriveJournalKey({ sessionSecret: 'x', userId: 1, attemptId: 2, deviceId: 'd' });
    expect(decryptJournalPayload({ key: otherKey, enc, aad: '2:1' })).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════
// PENDING / ACK SEQUENCE + RECONNECTION RECONCILIATION
// ═══════════════════════════════════════════════════════════════════

describe('Offline — Pending/ACK + Reconcile', () => {
  const mk = (seq) => createJournalEntry({ seq, itemId: 1, patch: { value: 'x' }, clientTime: 1, deviceId: 'dev-1', epoch: 1 });

  it('should compute the highest contiguous ACK (gap stops the run)', () => {
    expect(highestContiguousAck([])).toBe(0);
    expect(highestContiguousAck([1])).toBe(1);
    expect(highestContiguousAck([1, 2, 3])).toBe(3);
    expect(highestContiguousAck([1, 2, 4])).toBe(2); // 3 missing → run stops
    expect(highestContiguousAck([3, 1, 2])).toBe(3); // unsorted input
    expect(highestContiguousAck([2, 3])).toBe(0);    // 1 missing → nothing contiguous
  });

  it('should drop durable entries and resend the rest (lossless)', () => {
    const entries = [mk(1), mk(2), mk(3), mk(4)];
    const plan = reconcileJournal({ entries, ackedSeq: 2 });
    expect(plan.toDrop.map((e) => e.seq)).toEqual([1, 2]);
    expect(plan.toResend.map((e) => e.seq)).toEqual([3, 4]);
    expect(plan.nextAckedSeq).toBe(2);
  });

  it('should respect the batch backpressure (maxBatch)', () => {
    const entries = [mk(1), mk(2), mk(3), mk(4), mk(5)];
    const plan = reconcileJournal({ entries, ackedSeq: 0, opts: { maxBatch: 2 } });
    expect(plan.toResend.map((e) => e.seq)).toEqual([1, 2]);
  });

  it('should drop invalid entries during reconciliation', () => {
    const good = mk(1);
    const plan = reconcileJournal({ entries: [good, { seq: 99, itemId: 'bad' }], ackedSeq: 0 });
    expect(plan.toResend).toHaveLength(1);
    expect(plan.toResend[0].seq).toBe(1);
  });

  it('should map GLOBAL journal seq to PER-ITEM client seq (multi-item attempt)', () => {
    // Global seq interleaves items: item 1 answered, then item 2, then item 1 again.
    const entries = [mk2(1, 101), mk2(2, 202), mk2(3, 101)];
    const mapped = mapJournalToPerItemSeq(entries);
    expect(mapped.map((e) => e.perItemSeq)).toEqual([1, 1, 2]);
  });

  it('should continue per-item seq from items answered ONLINE earlier', () => {
    // Item 101 already has client_seq 1 saved online → offline entries continue at 2.
    const entries = [mk2(1, 101)];
    const mapped = mapJournalToPerItemSeq(entries, { 101: 1 });
    expect(mapped[0].perItemSeq).toBe(2);
  });

  it('should preserve item_id when mapping', () => {
    const entries = [mk2(1, 101), mk2(2, 202)];
    const mapped = mapJournalToPerItemSeq(entries);
    expect(mapped[0].itemId).toBe(101);
    expect(mapped[1].itemId).toBe(202);
  });

  it('should compute a CONTIGUOUS watermark — a rejected gap stops the run (lossless)', () => {
    // seq 1 rejected (final), 2-3 accepted → watermark stays 0 (1 is durable-final
    // but the run stops at the first gap only if NOT durable; here 1 IS durable
    // via finalReasons, so run continues).
    const results = [
      { seq: 1, status: JOURNAL_STATUS.CONFLICT, reason: 'stale_epoch' },
      { seq: 2, status: JOURNAL_STATUS.ACKED, reason: null },
    ];
    const finalReasons = new Set(['stale_epoch']);
    expect(computeWatermarkAfterSync({ serverAcked: 0, results, finalReasons })).toBe(2);
  });

  it('should STOP at a transient failure so nothing durable is dropped', () => {
    const results = [
      { seq: 1, status: JOURNAL_STATUS.ACKED, reason: null },
      { seq: 2, status: JOURNAL_STATUS.CONFLICT, reason: 'save_error' }, // transient
      { seq: 3, status: JOURNAL_STATUS.ACKED, reason: null },
    ];
    const finalReasons = new Set(['stale_epoch']);
    expect(computeWatermarkAfterSync({ serverAcked: 0, results, finalReasons })).toBe(1);
  });

  it('should start from the server watermark', () => {
    const results = [{ seq: 4, status: JOURNAL_STATUS.ACKED, reason: null }];
    expect(computeWatermarkAfterSync({ serverAcked: 3, results, finalReasons: new Set() })).toBe(4);
  });
});

// Local helper for cross-item entries
function mk2(seq, itemId) {
  return createJournalEntry({ seq, itemId, patch: { value: 'x' }, clientTime: 1, deviceId: 'dev-1', epoch: 1 });
}

// ═══════════════════════════════════════════════════════════════════
// PARALLEL DEVICE POLICY (research.md §29.4)
// ═══════════════════════════════════════════════════════════════════

describe('Offline — Parallel Device Policy', () => {
  it('should allow the first device', () => {
    expect(evaluateParallelDevice({ deviceId: 'dev-1', activeDeviceIds: [] }).allowed).toBe(true);
    expect(evaluateParallelDevice({ deviceId: 'dev-1', activeDeviceIds: ['dev-1'] }).allowed).toBe(true);
  });

  it('should REJECT a second device by default', () => {
    const r = evaluateParallelDevice({ deviceId: 'dev-2', activeDeviceIds: ['dev-1'] });
    expect(r.allowed).toBe(false);
    expect(r.reason).toBe('parallel_device_denied');
    expect(r.revokeDeviceIds).toEqual([]);
  });

  it('should TRANSFER: second device replaces the first (old revoked)', () => {
    const r = evaluateParallelDevice({ deviceId: 'dev-2', activeDeviceIds: ['dev-1'], policy: DEVICE_POLICY.TRANSFER });
    expect(r.allowed).toBe(true);
    expect(r.reason).toBe('transfer');
    expect(r.revokeDeviceIds).toEqual(['dev-1']);
  });

  it('should ALLOW parallel devices in low-stakes mode', () => {
    const r = evaluateParallelDevice({ deviceId: 'dev-2', activeDeviceIds: ['dev-1'], policy: DEVICE_POLICY.ALLOW });
    expect(r.allowed).toBe(true);
    expect(r.revokeDeviceIds).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════
// OLD-EPOCH MUTATION REJECT (stale recovery)
// ═══════════════════════════════════════════════════════════════════

describe('Offline — Old-Epoch Reject', () => {
  it('should accept the current epoch', () => {
    expect(evaluateEpoch({ entryEpoch: 2, currentEpoch: 2 })).toEqual({ allowed: true, reason: null });
  });

  it('should reject STALE entries (teacher reopened the attempt)', () => {
    const r = evaluateEpoch({ entryEpoch: 1, currentEpoch: 2 });
    expect(r.allowed).toBe(false);
    expect(r.reason).toBe('stale_epoch');
  });

  it('should reject future-epoch entries (clock tampering)', () => {
    const r = evaluateEpoch({ entryEpoch: 3, currentEpoch: 2 });
    expect(r.allowed).toBe(false);
    expect(r.reason).toBe('future_epoch');
  });

  it('should reject invalid epochs', () => {
    expect(evaluateEpoch({ entryEpoch: NaN, currentEpoch: 2 }).allowed).toBe(false);
    expect(evaluateEpoch({ entryEpoch: 1, currentEpoch: null }).allowed).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════
// EMERGENCY RECOVERY PACKAGE (research.md §29.5)
// ═══════════════════════════════════════════════════════════════════

describe('Offline — Recovery Package', () => {
  const mk = (seq) => createJournalEntry({ seq, itemId: 1, patch: { value: 'x' }, clientTime: 1, deviceId: 'dev-1', epoch: 1 });
  const entries = [mk(1), mk(2), mk(3)];

  it('should build an immutable, checksum-signed package', () => {
    const pkg = buildRecoveryPackage({ attemptId: 10, userId: 1, deviceId: 'dev-1', entries });
    expect(pkg.version).toBe(RECOVERY_PKG_VERSION);
    expect(pkg.entries).toHaveLength(3);
    expect(pkg.checksum).toMatch(/^[a-f0-9]{64}$/);
    expect(verifyRecoveryPackage(pkg).ok).toBe(true);
  });

  it('should detect ANY mutation via checksum', () => {
    const pkg = buildRecoveryPackage({ attemptId: 10, userId: 1, deviceId: 'dev-1', entries });
    const tampered = { ...pkg, entries: pkg.entries.map((e, i) => (i === 1 ? { ...e, patch: { value: 'EVIL' } } : e)) };
    expect(verifyRecoveryPackage(tampered).ok).toBe(false);
    expect(verifyRecoveryPackage(tampered).reason).toBe('checksum_mismatch');
  });

  it('should reject unsupported versions and oversized journals', () => {
    const pkg = buildRecoveryPackage({ attemptId: 10, userId: 1, deviceId: 'dev-1', entries });
    expect(verifyRecoveryPackage({ ...pkg, version: 99 }).ok).toBe(false);
    const big = Array.from({ length: 21000 }, (_, i) => mk(i + 1));
    const bigPkg = buildRecoveryPackage({ attemptId: 10, userId: 1, deviceId: 'dev-1', entries: big });
    expect(verifyRecoveryPackage(bigPkg).ok).toBe(false);
  });

  it('should NEVER contain the answer key (scan backstop §15)', () => {
    const clean = buildRecoveryPackage({ attemptId: 10, userId: 1, deviceId: 'dev-1', entries });
    expect(scanPackageForAnswerKeys(clean).clean).toBe(true);

    // A malicious client journal entry smuggling answer data must be caught:
    const leakyEntries = [mk(1), { ...mk(2), patch: { value: 'x', answerKey: 'B' } }];
    const leaky = buildRecoveryPackage({ attemptId: 10, userId: 1, deviceId: 'dev-1', entries: leakyEntries });
    const scan = scanPackageForAnswerKeys(leaky);
    expect(scan.clean).toBe(false);
    expect(scan.found).toContain('answerKey');
  });

  it('should derive a deterministic journal sync idempotency key', () => {
    expect(deriveJournalSyncKey(10, 'dev-1', 3)).toBe(deriveJournalSyncKey(10, 'dev-1', 3));
    expect(deriveJournalSyncKey(10, 'dev-1', 3)).not.toBe(deriveJournalSyncKey(10, 'dev-1', 4));
    expect(deriveJournalSyncKey(10, 'dev-1', 3)).toMatch(/^[a-f0-9]{40}$/);
  });
});

// ═══════════════════════════════════════════════════════════════════
// SERVICE — GRACEFUL DEGRADATION + BARREL
// ═══════════════════════════════════════════════════════════════════

describe('Offline — Service & Barrel', () => {
  it('should expose all functions via the barrel', async () => {
    const mod = await import('../../src/modules/offline/index.js');
    for (const exp of [
      'reconnectSync', 'exportRecoveryPackage', 'importRecoveryPackage', 'listRecoveryPackages',
      'validateJournalEntry', 'deriveJournalKey', 'highestContiguousAck', 'reconcileJournal',
      'evaluateParallelDevice', 'evaluateEpoch', 'buildRecoveryPackage', 'verifyRecoveryPackage',
      'scanPackageForAnswerKeys', 'deriveJournalSyncKey', 'mapJournalToPerItemSeq',
      'computeWatermarkAfterSync',
    ]) {
      expect(typeof mod[exp], exp).toBe('function');
    }
  });

  it('should throw PostgreSQL required for write paths without PG', async () => {
    await expect(reconnectSync({ attemptId: 1, userId: 1, deviceId: 'dev-1', entries: [] }))
      .rejects.toThrow('PostgreSQL required');
    await expect(exportRecoveryPackage({ attemptId: 1, userId: 1, deviceId: 'dev-1', entries: [] }))
      .rejects.toThrow('PostgreSQL required');
    await expect(importRecoveryPackage({ pkg: {}, actor: 'admin' }))
      .rejects.toThrow('PostgreSQL required');
  });

  it('should degrade gracefully for read paths without PG', async () => {
    expect(await listRecoveryPackages(1)).toEqual([]);
  });
});
