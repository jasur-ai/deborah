/**
 * Edikit — Submit Sealing va Signed Receipt Tests
 *
 * Covers (Prompt 33, research.md §29.5):
 *   - Completeness summary (server-computed, answered/unanswered)
 *   - Final snapshot: latest accepted seq per item + payload digest
 *   - Submission hash: deterministic, tamper-sensitive
 *   - Signed receipt: HMAC sign → verify, tamper → false (timing-safe)
 *   - Post-submit mutation gate (attempt_closed / already_sealed)
 *   - Service graceful degradation without PostgreSQL
 *   - Barrel export
 */

import { describe, it, expect } from 'vitest';

import {
  // schema (pure)
  buildCompletenessSummary,
  buildFinalSnapshot,
  payloadDigest,
  computeSubmissionHash,
  buildReceiptBody,
  signReceipt,
  verifyReceipt,
  evaluateSubmitGate,
} from '../../src/modules/submit/submit.schema.js';

import {
  // service
  flushPendingBatch,
  getSubmitPreview,
  submitAttempt,
  getSubmissionState,
} from '../../src/modules/submit/submit.service.js';

// ═══════════════════════════════════════════════════════════════════
// COMPLETENESS SUMMARY
// ═══════════════════════════════════════════════════════════════════

describe('Submit — Completeness Summary', () => {
  const items = [
    { item_id: 1, question_type: 'single_choice' },
    { item_id: 2, question_type: 'single_choice' },
    { item_id: 3, question_type: 'essay' },
  ];

  it('should report all answered when every item has a response', () => {
    const responses = [
      { item_id: 1, client_seq: 1, payload: { value: 'A' } },
      { item_id: 2, client_seq: 1, payload: { value: 'B' } },
      { item_id: 3, client_seq: 2, payload: { value: 'text' } },
    ];
    const s = buildCompletenessSummary({ items, responses });
    expect(s.total).toBe(3);
    expect(s.answered).toBe(3);
    expect(s.unanswered).toBe(0);
    expect(s.percent).toBe(100);
    expect(s.complete).toBe(true);
  });

  it('should list unanswered items for the confirmation UI', () => {
    const responses = [{ item_id: 1, client_seq: 1, payload: { value: 'A' } }];
    const s = buildCompletenessSummary({ items, responses });
    expect(s.answered).toBe(1);
    expect(s.unansweredItems).toEqual([2, 3]);
    expect(s.percent).toBe(33);
    expect(s.complete).toBe(false);
  });

  it('should ignore responses for items not in the package', () => {
    const responses = [
      { item_id: 1, client_seq: 1, payload: { value: 'A' } },
      { item_id: 99, client_seq: 1, payload: { value: 'x' } }, // not a real item
    ];
    const s = buildCompletenessSummary({ items, responses });
    expect(s.answered).toBe(1);
  });

  it('should treat an empty package as complete (0/0 → 100%)', () => {
    const s = buildCompletenessSummary({ items: [], responses: [] });
    expect(s.complete).toBe(true);
    expect(s.percent).toBe(100);
  });
});

// ═══════════════════════════════════════════════════════════════════
// FINAL SNAPSHOT + SUBMISSION HASH
// ═══════════════════════════════════════════════════════════════════

describe('Submit — Final Snapshot & Hash', () => {
  it('should keep the LATEST accepted seq per item (editable essays)', () => {
    const responses = [
      { item_id: 1, client_seq: 1, payload: { value: 'v1' } },
      { item_id: 1, client_seq: 2, payload: { value: 'v2' } },
      { item_id: 2, client_seq: 1, payload: { value: 'A' } },
    ];
    const snapshot = buildFinalSnapshot(responses);
    const item1 = snapshot.find((e) => e.item_id === 1);
    expect(item1.client_seq).toBe(2);
    expect(item1.payload_digest).toBe(payloadDigest({ value: 'v2' }));
    expect(snapshot).toHaveLength(2);
  });

  it('should sort deterministically by item_id', () => {
    const responses = [
      { item_id: 5, client_seq: 1, payload: { value: 'a' } },
      { item_id: 2, client_seq: 1, payload: { value: 'b' } },
    ];
    const snapshot = buildFinalSnapshot(responses);
    expect(snapshot.map((e) => e.item_id)).toEqual([2, 5]);
  });

  it('should compute a deterministic, tamper-sensitive submission hash', () => {
    const snapshot = buildFinalSnapshot([
      { item_id: 1, client_seq: 1, payload: { value: 'A' } },
    ]);
    const h1 = computeSubmissionHash({ attemptId: 10, snapshot, sealedAt: 1725000000000 });
    const h2 = computeSubmissionHash({ attemptId: 10, snapshot, sealedAt: 1725000000000 });
    expect(h1).toBe(h2);
    expect(h1).toMatch(/^[a-f0-9]{64}$/);
    // Tamper: different payload → different hash
    const tampered = computeSubmissionHash({
      attemptId: 10,
      snapshot: buildFinalSnapshot([{ item_id: 1, client_seq: 1, payload: { value: 'B' } }]),
      sealedAt: 1725000000000,
    });
    expect(tampered).not.toBe(h1);
    // Tamper: different sealedAt → different hash
    expect(computeSubmissionHash({ attemptId: 10, snapshot, sealedAt: 1725000000001 })).not.toBe(h1);
  });
});

// ═══════════════════════════════════════════════════════════════════
// SIGNED RECEIPT
// ═══════════════════════════════════════════════════════════════════

describe('Submit — Signed Receipt', () => {
  const SECRET = 'test-receipt-secret';

  it('should sign a receipt deterministically', () => {
    const body = buildReceiptBody({
      attemptId: 10,
      submissionHash: 'abc123',
      responseCount: 2,
      completeness: { answered: 2, total: 2 },
      sealedAt: 1725000000000,
    });
    const r1 = signReceipt(body, SECRET);
    const r2 = signReceipt(body, SECRET);
    expect(r1.signature).toBe(r2.signature);
    expect(r1.signature).toMatch(/^[a-f0-9]{64}$/);
    expect(verifyReceipt(r1, SECRET)).toBe(true);
  });

  it('should FAIL verification on body tamper (student edits receipt)', () => {
    const body = buildReceiptBody({
      attemptId: 10,
      submissionHash: 'abc123',
      responseCount: 2,
      completeness: { answered: 2, total: 2 },
      sealedAt: 1725000000000,
    });
    const { signature } = signReceipt(body, SECRET);
    const tampered = {
      signature,
      body: { ...body, responseCount: 99 }, // student inflates their count
    };
    expect(verifyReceipt(tampered, SECRET)).toBe(false);
  });

  it('should FAIL verification with the wrong secret (non-forgeable)', () => {
    const body = buildReceiptBody({ attemptId: 10, submissionHash: 'abc', responseCount: 1 });
    const { signature } = signReceipt(body, SECRET);
    expect(verifyReceipt({ signature, body }, 'wrong-secret')).toBe(false);
  });

  it('should reject malformed receipts', () => {
    expect(verifyReceipt(null, SECRET)).toBe(false);
    expect(verifyReceipt({}, SECRET)).toBe(false);
    expect(verifyReceipt({ signature: 'x' }, SECRET)).toBe(false);
  });

  it('should require a secret to sign', () => {
    const body = buildReceiptBody({ attemptId: 1, submissionHash: 'a', responseCount: 0 });
    expect(() => signReceipt(body, '')).toThrow('receipt secret required');
  });
});

// ═══════════════════════════════════════════════════════════════════
// POST-SUBMIT MUTATION GATE
// ═══════════════════════════════════════════════════════════════════

describe('Submit — Post-Submit Mutation Gate', () => {
  it('should allow saves while the attempt is in progress and unsealed', () => {
    expect(evaluateSubmitGate({ attemptStatus: 'in_progress', hasSeal: false }))
      .toEqual({ allowed: true, reason: null });
  });

  it('should reject saves after SUBMITTED (attempt immutable)', () => {
    const r = evaluateSubmitGate({ attemptStatus: 'submitted', hasSeal: false });
    expect(r.allowed).toBe(false);
    expect(r.reason).toBe('attempt_closed');
  });

  it('should reject saves for a sealed attempt even if status lags', () => {
    const r = evaluateSubmitGate({ attemptStatus: 'in_progress', hasSeal: true });
    expect(r.allowed).toBe(false);
    expect(r.reason).toBe('already_sealed');
  });

  it('should reject terminated attempts', () => {
    expect(evaluateSubmitGate({ attemptStatus: 'terminated', hasSeal: false }).allowed).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════
// SERVICE — GRACEFUL DEGRADATION + BARREL
// ═══════════════════════════════════════════════════════════════════

describe('Submit — Service & Barrel', () => {
  it('should expose all functions via the barrel', async () => {
    const mod = await import('../../src/modules/submit/index.js');
    for (const exp of [
      'flushPendingBatch', 'getSubmitPreview', 'submitAttempt', 'getSubmissionState',
      'buildCompletenessSummary', 'buildFinalSnapshot', 'computeSubmissionHash',
      'buildReceiptBody', 'signReceipt', 'verifyReceipt', 'evaluateSubmitGate',
    ]) {
      expect(typeof mod[exp], exp).toBe('function');
    }
  });

  it('should throw PostgreSQL required for write paths without PG', async () => {
    await expect(submitAttempt({ attemptId: 1, userId: 1, confirmed: true }))
      .rejects.toThrow('PostgreSQL required');
    await expect(flushPendingBatch({ attemptId: 1, userId: 1, entries: [] }))
      .rejects.toThrow('PostgreSQL required');
  });

  it('should degrade gracefully for read paths without PG', async () => {
    expect(await getSubmitPreview(1, 1)).toBeNull();
    expect(await getSubmissionState(1, 1)).toBeNull();
  });
});
