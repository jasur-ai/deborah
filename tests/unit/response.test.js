/**
 * Deborah — Response API, ACK Sequence & Autosave Tests
 *
 * Covers (Prompt 31):
 *   - Response mode resolution (question type + policy override)
 *   - Client seq validation: in-order / duplicate / out-of-order (gap)
 *   - Epoch validation (staleness only — server time authoritative)
 *   - Late/stale rejection (server ends_at)
 *   - First / item-lock gate (one accepted row per item)
 *   - Server ACK contract (highestAcceptedSeq authoritative)
 *   - Essay snapshot vs patch interval (char/time deltas + minimal patch)
 *   - Save-state indicator (never 'synced' without ACK)
 *   - Idempotency key derivation
 *   - Retry/backoff schedule
 *   - Service graceful degradation without PostgreSQL
 *   - Barrel export
 */

import { describe, it, expect } from 'vitest';

import {
  // schema (pure)
  RESPONSE_MODES,
  RESPONSE_STATUS,
  REJECTION_REASONS,
  FIRST_ANSWER_TYPES,
  EDITABLE_TYPES,
  resolveResponseMode,
  validateClientSeq,
  validateEpoch,
  isAttemptWindowOpen,
  evaluateItemLockGate,
  buildServerAck,
  decideEssayRevisionType,
  buildMinimalPatch,
  buildSaveState,
  deriveResponseKey,
  computeRetryDelay,
} from '../../src/modules/response/response.schema.js';

import {
  // service
  saveResponse,
  getResponseState,
  listResponses,
  listEssayRevisions,
  resolveItemQuestionType,
} from '../../src/modules/response/response.service.js';

// ═══════════════════════════════════════════════════════════════════
// CONSTANTS & MODE RESOLUTION
// ═══════════════════════════════════════════════════════════════════

describe('Response — Constants & Mode Resolution', () => {
  it('should have response modes and statuses', () => {
    expect(RESPONSE_MODES).toEqual({ FIRST: 'first', EDITABLE: 'editable', ITEM_LOCK: 'item_lock' });
    expect(RESPONSE_STATUS.ACCEPTED).toBe('accepted');
    expect(RESPONSE_STATUS.REJECTED).toBe('rejected');
    expect(REJECTION_REASONS.LATE).toBe('late');
    expect(REJECTION_REASONS.ITEM_LOCKED).toBe('item_locked');
  });

  it('should resolve MCQ types to first-answer mode', () => {
    for (const t of FIRST_ANSWER_TYPES) {
      expect(resolveResponseMode(t)).toBe(RESPONSE_MODES.FIRST);
    }
  });

  it('should resolve essay types to editable mode', () => {
    expect(resolveResponseMode('essay')).toBe(RESPONSE_MODES.EDITABLE);
    expect(resolveResponseMode('short_answer')).toBe(RESPONSE_MODES.EDITABLE);
  });

  it('should let policy mode override the derived mode', () => {
    expect(resolveResponseMode('single_choice', { policyMode: 'item_lock' })).toBe(RESPONSE_MODES.ITEM_LOCK);
    expect(resolveResponseMode('essay', { policyMode: 'first' })).toBe(RESPONSE_MODES.FIRST);
  });

  it('should return null for unresolvable modes (stop condition §24)', () => {
    expect(resolveResponseMode('unknown_type')).toBeNull();
    expect(resolveResponseMode('')).toBeNull();
    expect(resolveResponseMode('single_choice', { policyMode: 'bogus' })).toBe(RESPONSE_MODES.FIRST);
  });
});

// ═══════════════════════════════════════════════════════════════════
// CLIENT SEQ VALIDATION
// ═══════════════════════════════════════════════════════════════════

describe('Response — Client Seq Validation', () => {
  it('should accept the next in-order sequence', () => {
    const r = validateClientSeq({ clientSeq: 2, lastAcceptedSeq: 1, mode: RESPONSE_MODES.EDITABLE });
    expect(r.accepted).toBe(true);
    expect(r.expectedNextSeq).toBe(2);
  });

  it('should accept seq 1 when nothing is accepted yet', () => {
    const r = validateClientSeq({ clientSeq: 1, lastAcceptedSeq: 0, mode: RESPONSE_MODES.FIRST });
    expect(r.accepted).toBe(true);
  });

  it('should reject duplicates (seq <= last accepted)', () => {
    const dup = validateClientSeq({ clientSeq: 2, lastAcceptedSeq: 2, mode: RESPONSE_MODES.EDITABLE });
    expect(dup.accepted).toBe(false);
    expect(dup.reason).toBe(REJECTION_REASONS.STALE_SEQ);
    const stale = validateClientSeq({ clientSeq: 1, lastAcceptedSeq: 3, mode: RESPONSE_MODES.EDITABLE });
    expect(stale.accepted).toBe(false);
  });

  it('should reject seq <= 0', () => {
    const r = validateClientSeq({ clientSeq: 0, lastAcceptedSeq: 0, mode: RESPONSE_MODES.EDITABLE });
    expect(r.accepted).toBe(false);
  });

  it('should allow gaps ONLY for editable mode (offline autosave)', () => {
    const editableGap = validateClientSeq({ clientSeq: 5, lastAcceptedSeq: 2, mode: RESPONSE_MODES.EDITABLE });
    expect(editableGap.accepted).toBe(true);
    const firstGap = validateClientSeq({ clientSeq: 5, lastAcceptedSeq: 2, mode: RESPONSE_MODES.FIRST });
    expect(firstGap.accepted).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════
// EPOCH + LATE WINDOW
// ═══════════════════════════════════════════════════════════════════

describe('Response — Epoch & Late Window', () => {
  const NOW = Date.UTC(2026, 8, 1, 9, 0, 0);

  it('should accept when epoch is within tolerance (staleness only)', () => {
    expect(validateEpoch({ clientEpoch: NOW, serverNow: NOW }).accepted).toBe(true);
    expect(validateEpoch({ clientEpoch: NOW - 60_000, serverNow: NOW }).accepted).toBe(true);
  });

  it('should reject clearly stale epoch (client clock far behind)', () => {
    const r = validateEpoch({ clientEpoch: NOW - 60 * 60 * 1000, serverNow: NOW });
    expect(r.accepted).toBe(false);
    expect(r.reason).toBe(REJECTION_REASONS.EPOCH_MISMATCH);
    expect(validateEpoch({ clientEpoch: 'not-a-number', serverNow: NOW }).accepted).toBe(false);
  });

  it('should treat missing epoch as optional (accepted)', () => {
    expect(validateEpoch({ clientEpoch: null, serverNow: NOW }).accepted).toBe(true);
  });

  it('should reject saves after the server ends_at (late)', () => {
    const endsAt = '2026-09-01T10:00:00.000Z';
    expect(isAttemptWindowOpen({ endsAt, now: '2026-09-01T09:30:00.000Z' }).open).toBe(true);
    const late = isAttemptWindowOpen({ endsAt, now: '2026-09-01T10:00:01.000Z' });
    expect(late.open).toBe(false);
    expect(late.reason).toBe(REJECTION_REASONS.LATE);
  });

  it('should treat unbounded attempts as open', () => {
    expect(isAttemptWindowOpen({ endsAt: null }).open).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════
// ITEM LOCK / FIRST-ANSWER GATE
// ═══════════════════════════════════════════════════════════════════

describe('Response — Item Lock / First-Answer Gate', () => {
  it('should allow the first accepted row for first/item_lock modes', () => {
    expect(evaluateItemLockGate({ mode: RESPONSE_MODES.FIRST, hasAcceptedRow: false }).allowed).toBe(true);
    expect(evaluateItemLockGate({ mode: RESPONSE_MODES.ITEM_LOCK, hasAcceptedRow: false }).allowed).toBe(true);
  });

  it('should reject a second accepted row for first/item_lock modes', () => {
    const first = evaluateItemLockGate({ mode: RESPONSE_MODES.FIRST, hasAcceptedRow: true });
    expect(first.allowed).toBe(false);
    expect(first.reason).toBe(REJECTION_REASONS.ITEM_LOCKED);
    const lock = evaluateItemLockGate({ mode: RESPONSE_MODES.ITEM_LOCK, hasAcceptedRow: true });
    expect(lock.allowed).toBe(false);
  });

  it('should allow multiple rows for editable mode', () => {
    expect(evaluateItemLockGate({ mode: RESPONSE_MODES.EDITABLE, hasAcceptedRow: true }).allowed).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════
// SERVER ACK CONTRACT
// ═══════════════════════════════════════════════════════════════════

describe('Response — Server ACK Contract', () => {
  it('should return highestAcceptedSeq as the authoritative sync point', () => {
    const ack = buildServerAck({ accepted: true, highestAcceptedSeq: 4, serverReceivedAt: Date.UTC(2026, 8, 1, 9, 0, 0) });
    expect(ack.accepted).toBe(true);
    expect(ack.status).toBe(RESPONSE_STATUS.ACCEPTED);
    expect(ack.highestAcceptedSeq).toBe(4);
    expect(ack.serverReceivedAt).toBe('2026-09-01T09:00:00.000Z');
  });

  it('should mark rejected ACK with the rejection reason', () => {
    const ack = buildServerAck({ accepted: false, rejectionReason: REJECTION_REASONS.LATE });
    expect(ack.status).toBe(RESPONSE_STATUS.REJECTED);
    expect(ack.rejectionReason).toBe(REJECTION_REASONS.LATE);
    expect(ack.highestAcceptedSeq).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════
// ESSAY SNAPSHOT / PATCH INTERVAL
// ═══════════════════════════════════════════════════════════════════

describe('Response — Essay Snapshot/Patch Interval', () => {
  const NOW = Date.UTC(2026, 8, 1, 9, 0, 0);

  it('should snapshot on first revision (no previous text)', () => {
    const r = decideEssayRevisionType({ current: 'hello world', previous: '', now: NOW, lastSnapshotAt: null });
    expect(r.patchType).toBe('snapshot');
  });

  it('should snapshot when char delta exceeds the threshold', () => {
    const r = decideEssayRevisionType({ current: 'x'.repeat(300), previous: 'x'.repeat(100), now: NOW, lastSnapshotAt: NOW });
    expect(r.patchType).toBe('snapshot');
  });

  it('should snapshot when time since last snapshot exceeds the threshold', () => {
    const r = decideEssayRevisionType({
      current: 'a', previous: 'b', now: NOW,
      lastSnapshotAt: new Date(NOW - 60 * 1000).toISOString(),
      opts: { msDelta: 15 * 1000 },
    });
    expect(r.patchType).toBe('snapshot');
  });

  it('should emit a minimal patch for small incremental edits', () => {
    const r = decideEssayRevisionType({ current: 'hello world!', previous: 'hello world', now: NOW, lastSnapshotAt: NOW });
    expect(r.patchType).toBe('patch');
    expect(r.ops).toBeTruthy();
    expect(r.ops[0].op).toBe('replace');
    expect(r.ops[0].text).toBe('!');
  });

  it('should build a lossless minimal patch', () => {
    const ops = buildMinimalPatch('The quick brown fox', 'The quick red fox');
    expect(ops).toHaveLength(1);
    expect(ops[0]).toMatchObject({ op: 'replace', at: 10, text: 'red' });
    // Reconstruct: prefix + text + suffix
    const prev = 'The quick brown fox';
    const next = 'The quick red fox';
    const prefix = prev.slice(0, ops[0].at);
    const suffix = prev.slice(ops[0].at + ops[0].del);
    expect(prefix + ops[0].text + suffix).toBe(next);
  });

  it('should return null ops when text is identical', () => {
    expect(buildMinimalPatch('same', 'same')).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════
// SAVE-STATE INDICATOR + IDEMPOTENCY + RETRY
// ═══════════════════════════════════════════════════════════════════

describe('Response — Save-State, Idempotency & Retry', () => {
  it('should never report synced without an ACK (acked flag)', () => {
    expect(buildSaveState({ state: 'synced', acked: true, highestAcceptedSeq: 3 }).state).toBe('synced');
    // Without acked → coerced to pending (never fake sync)
    const notAcked = buildSaveState({ state: 'synced', acked: false, highestAcceptedSeq: 3 });
    expect(notAcked.state).toBe('pending');
    expect(notAcked.highestAcceptedSeq).toBeNull();
  });

  it('should build offline/pending/error states', () => {
    expect(buildSaveState({ state: 'offline', retryCount: 2 }).state).toBe('offline');
    expect(buildSaveState({ state: 'error', retryCount: 1 }).state).toBe('error');
    expect(buildSaveState({ state: 'pending', retryCount: 0 }).state).toBe('pending');
  });

  it('should derive a deterministic idempotency key per (attempt, item, seq)', () => {
    expect(deriveResponseKey(1, 5, 2)).toBe(deriveResponseKey(1, 5, 2));
    expect(deriveResponseKey(1, 5, 2)).not.toBe(deriveResponseKey(1, 5, 3));
    expect(deriveResponseKey(1, 5, 2)).not.toBe(deriveResponseKey(2, 5, 2));
    expect(deriveResponseKey(1, 5, 2)).toMatch(/^[a-f0-9]{40}$/);
  });

  it('should compute exponential backoff with a cap', () => {
    expect(computeRetryDelay(0)).toBe(1000);
    expect(computeRetryDelay(1)).toBe(2000);
    expect(computeRetryDelay(2)).toBe(4000);
    expect(computeRetryDelay(10)).toBe(30000); // capped
    expect(computeRetryDelay(0, { baseMs: 500, maxMs: 4000 })).toBe(500);
  });
});

// ═══════════════════════════════════════════════════════════════════
// SERVICE — ITEM RESOLUTION + GRACEFUL DEGRADATION + BARREL
// ═══════════════════════════════════════════════════════════════════

describe('Response — Service & Barrel', () => {
  it('should expose all service functions via the barrel', async () => {
    const mod = await import('../../src/modules/response/index.js');
    for (const exp of ['saveResponse', 'getResponseState', 'listResponses', 'listEssayRevisions', 'resolveItemQuestionType']) {
      expect(typeof mod[exp], exp).toBe('function');
    }
  });

  it('should resolve item question type from the content package', () => {
    const pkg = {
      items: [
        { item_id: 1, question_type: 'single_choice' },
        { item_id: 2, question_type: 'essay' },
      ],
    };
    expect(resolveItemQuestionType(pkg, 1)).toBe('single_choice');
    expect(resolveItemQuestionType(pkg, 2)).toBe('essay');
    expect(resolveItemQuestionType(pkg, 99)).toBeNull();
    expect(resolveItemQuestionType({}, 1)).toBeNull();
  });

  it('should throw PostgreSQL required for write paths without PG', async () => {
    await expect(saveResponse({ attemptId: 1, userId: 1, itemId: 1, clientSeq: 1, payload: { value: 'A' } }))
      .rejects.toThrow('PostgreSQL required');
  });

  it('should NEVER accept a client-supplied mode override (Prompt 30 identityLevel bug class)', () => {
    // SECURITY CONTRACT: policyMode is a SERVER-trusted input (assessment
    // policy snapshot). The pure resolver honors it (a server policy may
    // legitimately raise or lower strictness), but the ONLY way it reaches
    // saveResponse is via opts.policyMode — never from the client body.
    expect(resolveResponseMode('single_choice', { policyMode: undefined })).toBe(RESPONSE_MODES.FIRST);
    expect(resolveResponseMode('single_choice', { policyMode: 'item_lock' })).toBe(RESPONSE_MODES.ITEM_LOCK);
    expect(resolveResponseMode('single_choice', { policyMode: 'editable' })).toBe(RESPONSE_MODES.EDITABLE);
    // …so the SERVER must never pass a client-provided value as policyMode.
    // saveResponse's only parameter is a single options object (destructured
    // with a default → fn.length === 0) and its body contains no `mode = null`
    // client-override path:
    expect(saveResponse.length).toBe(0);
    expect(String(saveResponse).includes('mode = null')).toBe(false);
  });

  it('should degrade gracefully for read paths without PG', async () => {
    expect(await getResponseState(1, 1, 1)).toBeNull();
    expect(await listResponses(1, 1)).toEqual([]);
    expect(await listEssayRevisions(1, 1, 1)).toEqual([]);
  });
});
