/**
 * Deborah — Integration Tests: Reconnect / Load Suite (Prompt 38)
 *
 * Reconnect storm va load holatida secure attemptning yakuniy tekshiruvi.
 * Contract tests against the real HTTP server (createApp factory):
 *   - Evidence ingest + offline sync + submit endpoints auth guards
 *   - Reconnect journal reconcile contract (pure layer through HTTP)
 *   - Parallel device policy + epoch staleness contract
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createApp } from '../../server.js';
import { createRequest, snapshotDb, restoreDb } from '../helpers/setup.js';

let httpServer;

beforeAll(async () => {
  snapshotDb();
  const result = await createApp();
  httpServer = result.httpServer;
  await new Promise((resolve) => httpServer.listen(0, resolve));
});

afterAll(async () => {
  restoreDb();
  return new Promise((resolve) => {
    if (httpServer && httpServer.listening) httpServer.close(() => resolve());
    else resolve();
  });
});

describe('Reconnect/Load — evidence & sync API auth guards', () => {
  it('POST camera evidence without session → rejected (CSRF first)', async () => {
    const req = await createRequest();
    const res = await req
      .post('/api/student/attempts/1/camera/evidence')
      .send({ samples: [{ client_seq: 1, flags: { phone_detected: true } }] });
    expect([401, 403]).toContain(res.status);
  });

  it('POST proctor events without session → rejected (CSRF first)', async () => {
    const req = await createRequest();
    const res = await req
      .post('/api/student/attempts/1/proctor/events')
      .send({ events: [{ client_seq: 1, eventType: 'visibility_hidden', startedAt: Date.now(), durationMs: 2000 }] });
    expect([401, 403]).toContain(res.status);
  });

  it('GET proctor state without session → 401 JSON', async () => {
    const req = await createRequest();
    const res = await req.get('/api/student/attempts/1/proctor/state');
    expect(res.status).toBe(401);
  });
});

describe('Reconnect/Load — offline journal reconcile contract (pure layer)', () => {
  it('reconcile is lossless and contiguous across reconnect storms', async () => {
    const { createJournalEntry, reconcileJournal, highestContiguousAck } = await import('../../src/modules/offline/index.js');
    const now = Date.now();
    // Reconnect 1: 1..4 sent, 1..3 acked → resend 4
    const e1 = [
      createJournalEntry({ seq: 1, itemId: 10, patch: { a: 1 }, clientTime: now, deviceId: 'd1', epoch: 1 }),
      createJournalEntry({ seq: 2, itemId: 10, patch: { a: 2 }, clientTime: now, deviceId: 'd1', epoch: 1 }),
      createJournalEntry({ seq: 3, itemId: 11, patch: { b: 1 }, clientTime: now, deviceId: 'd1', epoch: 1 }),
      createJournalEntry({ seq: 4, itemId: 11, patch: { b: 2 }, clientTime: now, deviceId: 'd1', epoch: 1 }),
    ];
    const r1 = reconcileJournal({ entries: e1, ackedSeq: 3 });
    expect(r1.toResend.map((x) => x.seq)).toEqual([4]);
    expect(r1.toDrop.length).toBe(3);

    // Reconnect 2 (storm): entries 1..6, ackedSeq 4 → resend 5,6
    const e2 = [
      ...e1,
      createJournalEntry({ seq: 5, itemId: 12, patch: { c: 1 }, clientTime: now, deviceId: 'd1', epoch: 1 }),
      createJournalEntry({ seq: 6, itemId: 12, patch: { c: 2 }, clientTime: now, deviceId: 'd1', epoch: 1 }),
    ];
    const r2 = reconcileJournal({ entries: e2, ackedSeq: 4 });
    expect(r2.toResend.map((x) => x.seq)).toEqual([5, 6]);
  });

  it('highest contiguous ACK stops at a gap (out-of-order delivery)', async () => {
    const { highestContiguousAck } = await import('../../src/modules/offline/index.js');
    expect(highestContiguousAck([1, 2, 4, 5])).toBe(2);
    expect(highestContiguousAck([1, 2, 3])).toBe(3);
  });

  it('parallel device is rejected under REJECT policy during reconnect storm', async () => {
    const { evaluateParallelDevice } = await import('../../src/modules/offline/index.js');
    const storm = ['d1', 'd2', 'd3'];
    expect(evaluateParallelDevice({ deviceId: 'd4', activeDeviceIds: storm, policy: 'reject' }).allowed).toBe(false);
    // O'zi allaqachon active bo'lsa ham, boshqa active qurilmalar bor → reject
    expect(evaluateParallelDevice({ deviceId: 'd2', activeDeviceIds: storm, policy: 'reject' }).allowed).toBe(false);
    // Faqat o'zi active bo'lsa → allowed
    expect(evaluateParallelDevice({ deviceId: 'd2', activeDeviceIds: ['d2'], policy: 'reject' }).allowed).toBe(true);
  });

  it('stale-epoch journal entries are rejected after reopen', async () => {
    const { evaluateEpoch } = await import('../../src/modules/offline/index.js');
    expect(evaluateEpoch({ entryEpoch: 1, currentEpoch: 1 }).allowed).toBe(true);
    expect(evaluateEpoch({ entryEpoch: 1, currentEpoch: 2 }).allowed).toBe(false);
  });

  it('recovery package round-trips and scans clean', async () => {
    const { buildRecoveryPackage, verifyRecoveryPackage, scanPackageForAnswerKeys } = await import('../../src/modules/offline/index.js');
    const { createJournalEntry } = await import('../../src/modules/offline/index.js');
    const entry = createJournalEntry({ seq: 1, itemId: 10, patch: { a: 1 }, clientTime: Date.now(), deviceId: 'd1', epoch: 1 });
    const pkg = buildRecoveryPackage({ attemptId: 42, userId: 7, deviceId: 'd1', entries: [entry], ackedSeq: 0 });
    expect(verifyRecoveryPackage(pkg).ok).toBe(true);
    expect(scanPackageForAnswerKeys(pkg).clean).toBe(true);
  });
});

describe('Reconnect/Load — submit & receipt contract (pure layer)', () => {
  it('submit gate blocks closed attempts', async () => {
    const { evaluateSubmitGate } = await import('../../src/modules/submit/index.js');
    expect(evaluateSubmitGate({ attemptStatus: 'terminated' }).allowed).toBe(false);
    expect(evaluateSubmitGate({ attemptStatus: 'in_progress', hasSeal: true }).reason).toBe('already_sealed');
  });

  it('signed receipt verifies and detects tampering', async () => {
    const { buildReceiptBody, signReceipt, verifyReceipt } = await import('../../src/modules/submit/index.js');
    const body = buildReceiptBody({ attemptId: 1, submissionHash: 'a'.repeat(64), responseCount: 2, completeness: { complete: true, percent: 100 } });
    const receipt = signReceipt(body, 'secret');
    expect(verifyReceipt(receipt, 'secret')).toBe(true);
    expect(verifyReceipt(receipt, 'other')).toBe(false);
  });
});
