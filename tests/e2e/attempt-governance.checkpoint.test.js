/**
 * Deborah — Attempt/Proctoring Checkpoint (Prompt 38)
 *
 * Phase D final verification — secure attemptni mock exam, reconnect storm va
 * accessibility holatida yakuniy tekshirish. Teacher Core checkpoint (Prompt
 * 29) naqshida PURE-LOGIC layer'da full journey walk:
 *
 *   07. normal mock exam — eligibility gates → server timer → public package
 *       → response ACK → completeness → submission hash → signed receipt
 *   08. offline/reconnect/crash — journal entry → encrypted sync key → lossless
 *       reconcile → recovery package → verify + answer-key scan
 *   09. third-strike — raw events → classify → dedupe → strike lifecycle →
 *       terminate; technical exclusions (blur/network/camera NEVER strike)
 *   10. pause/extend/reopen — epoch bump → old-epoch events rejected; attempt
 *       status transitions; accommodation extra time extends the window
 *   11. screen-reader/accommodation — effective operational config → extra time
 *   12. camera opt-out/pilot — pilot OFF → no-op alternative path; consent
 *       contract; forbidden fields (emotion/gaze/honesty) rejected
 *   13. answer-key payload scan — public package clean + recovery scan
 *
 * SECURITY / DATA GUARD (Prompt 38 §15):
 *   - Camera/browser flag HECH QACHON academic hukmga aylanmaydi: proctor
 *     classification faqat visibility/fullscreen'ni strike qiladi, blur/
 *     network/camera technical event (strike emas); camera evidence faqat
 *     review signal (human decision).
 *   - Hech qanday test DB'ni mutate qilmaydi; secret-bearing DTO student
 *     yuzasiga chiqmasligi strukturaviy tekshiriladi (verifyContentPackageClean,
 *     scanPackageForAnswerKeys).
 *   - Service'lar graceful degradation uchun tekshiriladi (PostgreSQL CI'da
 *     yo'q) — write path'lar 'PostgreSQL required' throw qiladi, read path'lar
 *     []/default qaytaradi.
 */

import { describe, it, expect } from 'vitest';

// ── Attempt (Prompt 30) ──
import {
  ATTEMPT_STATUS,
  ATTEMPT_STATUS_TRANSITIONS,
  requiredIdentityLevelForProfile,
  identityLevelSatisfied,
  computeAttemptTiming,
  computeRemainingSeconds,
  extractExtraTimeMinutes,
  buildPublicContentPackage,
  verifyContentPackageClean,
  evaluateParallelSessionPolicy,
  computeAttemptStartEligibility,
  startAttempt,
} from '../../src/modules/attempt/index.js';

// ── Proctor (Prompt 34) ──
import {
  STRIKE_LIMIT,
  classifyProctorEvent,
  dedupeEvent,
  strikeLevelFor,
  hashChainEvent,
  evaluateProctorEpoch,
  buildTimelineEntry,
  recordProctorEvents,
} from '../../src/modules/proctor/index.js';

// ── Offline (Prompt 32) ──
import {
  createJournalEntry,
  deriveJournalKey,
  encryptJournalPayload,
  decryptJournalPayload,
  highestContiguousAck,
  reconcileJournal,
  evaluateParallelDevice,
  buildRecoveryPackage,
  verifyRecoveryPackage,
  scanPackageForAnswerKeys,
  reconnectSync,
} from '../../src/modules/offline/index.js';

// ── Response / Submit (Prompt 30/31) ──
import {
  validateClientSeq,
  validateEpoch,
  isAttemptWindowOpen,
  buildServerAck,
} from '../../src/modules/response/index.js';
import {
  buildCompletenessSummary,
  buildFinalSnapshot,
  computeSubmissionHash,
  buildReceiptBody,
  signReceipt,
  verifyReceipt,
  evaluateSubmitGate,
  submitAttempt,
} from '../../src/modules/submit/index.js';

// ── Accommodation (Prompt 17) ──
import { getEffectiveOperationalConfig } from '../../src/modules/accommodation/index.js';

// ── Camera pilot (Prompt 37) ──
import {
  validateEvidenceFlags,
  shouldDiscardSample,
  deriveConsentState,
  buildPilotStatus,
  recordCameraEvidence,
} from '../../src/modules/camera/index.js';

// ═══════════════════════════════════════════════════════════════════
// 07. NORMAL MOCK EXAM — full secure journey
// ═══════════════════════════════════════════════════════════════════

describe('Attempt checkpoint — 07 normal mock exam', () => {
  it('should pass all start gates when identity + preflight + no parallel lease', () => {
    const eligibility = computeAttemptStartEligibility({
      identityRequired: 'passkey',
      identityAchieved: 'passkey',
      preflightExists: true,
      preflightEligible: true,
      parallelAllowed: true,
    });
    expect(eligibility.canStart).toBe(true);
    expect(eligibility.blockers).toHaveLength(0);
  });

  it('should block start on identity step-up, preflight, or parallel lease', () => {
    const r = computeAttemptStartEligibility({
      identityRequired: 'passkey',
      identityAchieved: 'password',
      preflightExists: false,
      parallelAllowed: false,
    });
    expect(r.canStart).toBe(false);
    const codes = r.blockers.map((b) => b.code);
    expect(codes).toContain('identity_step_up_required');
    expect(codes).toContain('preflight_required');
    expect(codes).toContain('parallel_session_denied');
  });

  it('should compute a server-authoritative timer (client can never extend)', () => {
    const t = computeAttemptTiming({ baseMinutes: 60, extraMinutes: 0, now: 1_700_000_000_000 });
    expect(t.totalMinutes).toBe(60);
    expect(t.endsAt.getTime() - t.startedAt.getTime()).toBe(60 * 60 * 1000);
    const remaining = computeRemainingSeconds(t.endsAt, 1_700_000_000_000 + 30 * 60 * 1000);
    expect(remaining).toBe(30 * 60);
  });

  it('should build a public content package that is structurally clean', () => {
    const pkg = buildPublicContentPackage(
      { id: 1, title: 'Mock' },
      [
        { item_id: 10, question: '1+1=?', options: ['1', '2', '3', '4'] },
        { item_id: 11, question: '2+2=?', options: ['2', '4', '6', '8'] },
      ],
    );
    const check = verifyContentPackageClean(pkg);
    expect(check.ok).toBe(true);
    expect(check.leaks).toHaveLength(0);
    expect(JSON.stringify(pkg)).not.toMatch(/correct|answer_key|rubric|private/i);
  });

  it('should reject a leaked public package (defense in depth)', () => {
    const leaked = { items: [{ item_id: 1, question: 'x', correct: 'B' }] };
    const check = verifyContentPackageClean(leaked);
    expect(check.ok).toBe(false);
    expect(check.leaks.length).toBeGreaterThan(0);
  });

  it('should ACK server-side, ignoring client time/seq forgery', () => {
    const ack = buildServerAck({ accepted: true, highestAcceptedSeq: 3 });
    expect(ack.accepted).toBe(true);
    // First-answer-final: duplicate seq rejected by contract
    const dup = validateClientSeq({ clientSeq: 3, lastAcceptedSeq: 3, mode: 'first_answer' });
    expect(dup.accepted).toBe(false);
    expect(validateClientSeq({ clientSeq: 4, lastAcceptedSeq: 3, mode: 'first_answer' }).accepted).toBe(true);
  });

  it('should close the submit gate for a sealed/closed attempt', () => {
    expect(evaluateSubmitGate({ attemptStatus: 'in_progress', hasSeal: false }).allowed).toBe(true);
    expect(evaluateSubmitGate({ attemptStatus: 'submitted', hasSeal: false }).reason).toBe('attempt_closed');
    expect(evaluateSubmitGate({ attemptStatus: 'terminated', hasSeal: false }).reason).toBe('attempt_closed');
    expect(evaluateSubmitGate({ attemptStatus: 'in_progress', hasSeal: true }).reason).toBe('already_sealed');
  });

  it('should produce a completeness summary and a signed, verifiable receipt', () => {
    const items = [{ item_id: 1 }, { item_id: 2 }, { item_id: 3 }];
    const responses = [{ item_id: 1, client_seq: 1, payload: { a: 1 } }, { item_id: 2, client_seq: 1, payload: { a: 2 } }];
    const summary = buildCompletenessSummary({ items, responses });
    expect(summary.answered).toBe(2);
    expect(summary.unanswered).toBe(1);
    expect(summary.percent).toBe(67);

    const snapshot = buildFinalSnapshot(responses);
    const hash = computeSubmissionHash({ attemptId: 42, snapshot, sealedAt: 1_700_000_000_000 });
    const receiptBody = buildReceiptBody({ attemptId: 42, submissionHash: hash, responseCount: snapshot.length, completeness: summary });
    const receipt = signReceipt(receiptBody, 'test-secret');
    // verifyReceipt BOOLEAN qaytaradi (HMAC timing-safe)
    expect(verifyReceipt(receipt, 'test-secret')).toBe(true);
    // Tamper detection: wrong secret fails verification
    expect(verifyReceipt(receipt, 'wrong-secret')).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 08. OFFLINE / RECONNECT / CRASH — lossless recovery
// ═══════════════════════════════════════════════════════════════════

describe('Attempt checkpoint — 08 offline/reconnect/crash', () => {
  it('should create + encrypt + decrypt a journal entry losslessly', () => {
    const entry = createJournalEntry({ seq: 1, itemId: 10, patch: { a: 1 }, clientTime: Date.now(), deviceId: 'd1', epoch: 1 });
    const key = deriveJournalKey({ sessionSecret: 'secret', userId: 7, attemptId: 42, deviceId: 'd1' });
    // AAD shifrlash va deshifrlashda BIR XIL bo'lishi shart (GCM auth tag)
    const aad = String(entry.seq);
    const enc = encryptJournalPayload({ key, payload: entry, aad });
    const dec = decryptJournalPayload({ key, enc, aad });
    expect(dec).toEqual(entry);
    // Tamper: noto'g'ri AAD → null
    expect(decryptJournalPayload({ key, enc, aad: '999' })).toBeNull();
  });

  it('should compute the highest contiguous ACK (gap stops the run)', () => {
    expect(highestContiguousAck([1, 2, 3, 5, 6])).toBe(3);
    expect(highestContiguousAck([])).toBe(0);
    expect(highestContiguousAck([1, 2, 3])).toBe(3);
  });

  it('should reconcile losslessly — drop durable, resend the rest', () => {
    const entries = [
      createJournalEntry({ seq: 1, itemId: 10, patch: { a: 1 }, clientTime: Date.now(), deviceId: 'd1', epoch: 1 }),
      createJournalEntry({ seq: 2, itemId: 11, patch: { a: 2 }, clientTime: Date.now(), deviceId: 'd1', epoch: 1 }),
      createJournalEntry({ seq: 3, itemId: 12, patch: { a: 3 }, clientTime: Date.now(), deviceId: 'd1', epoch: 1 }),
    ];
    const r = reconcileJournal({ entries, ackedSeq: 2 });
    expect(r.toDrop.length).toBe(2); // seq 1,2 already acked
    expect(r.toResend.length).toBe(1);
    expect(r.toResend[0].seq).toBe(3);
  });

  it('should reject a parallel device under REJECT policy', () => {
    const v = evaluateParallelDevice({ deviceId: 'd2', activeDeviceIds: ['d1'], policy: 'reject' });
    expect(v.allowed).toBe(false);
    const ok = evaluateParallelDevice({ deviceId: 'd1', activeDeviceIds: ['d1'], policy: 'reject' });
    expect(ok.allowed).toBe(true);
  });

  it('should build + verify a recovery package and scan it for answer keys', () => {
    const entries = [createJournalEntry({ seq: 1, itemId: 10, patch: { a: 1 }, clientTime: Date.now(), deviceId: 'd1', epoch: 1 })];
    const pkg = buildRecoveryPackage({ attemptId: 42, userId: 7, deviceId: 'd1', entries, ackedSeq: 0 });
    const verified = verifyRecoveryPackage(pkg);
    expect(verified.ok).toBe(true);
    // Clean package → no answer-key hits
    expect(scanPackageForAnswerKeys(pkg).clean).toBe(true);
    // Poisoned package → hits detected
    const poisoned = { ...pkg, entries: [{ ...entries[0], patch: { correct_option: 'B' } }] };
    expect(scanPackageForAnswerKeys(poisoned).found.length).toBeGreaterThan(0);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 09. THIRD-STRIKE — proctor lifecycle + technical exclusions
// ═══════════════════════════════════════════════════════════════════

describe('Attempt checkpoint — 09 third-strike', () => {
  it('should classify focus-loss above threshold and NEVER strike technical events', () => {
    const strike = classifyProctorEvent({ eventType: 'visibility_hidden', durationMs: 2100 });
    expect(strike.confirmed).toBe(true);
    for (const tech of ['blur', 'network_offline', 'camera_failure']) {
      const c = classifyProctorEvent({ eventType: tech, durationMs: 99999 });
      expect(c.confirmed).toBe(false); // §15: technical ≠ strike
    }
  });

  it('should dedupe overlapping / within-window episodes', () => {
    const confirmed = [{ clientSeq: 1, startedAt: 1000, durationMs: 2000 }];
    const overlap = dedupeEvent({ event: { clientSeq: 2, startedAt: 1500, durationMs: 2000 }, confirmed });
    expect(overlap.deduped).toBe(true);
    const far = dedupeEvent({ event: { clientSeq: 3, startedAt: 20000, durationMs: 2000 }, confirmed });
    expect(far.deduped).toBe(false);
  });

  it('should escalate strikes and terminate at the limit', () => {
    expect(strikeLevelFor(1)).toBe('warning_1');
    expect(strikeLevelFor(2)).toBe('warning_2');
    expect(strikeLevelFor(3)).toBe('terminated');
    expect(STRIKE_LIMIT).toBe(3);
  });

  it('should build an explainable timeline (no "cheat probability")', () => {
    const entry = buildTimelineEntry({
      event: { clientSeq: 1, eventType: 'visibility_hidden', startedAt: 1000, durationMs: 4000 },
      classification: { confirmed: true, reason: 'focus_loss_strike' },
      strikeLevel: 'warning_1',
    });
    expect(JSON.stringify(entry)).not.toMatch(/cheat|probability|honesty/i);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 10. PAUSE / EXTEND / REOPEN — epoch + transitions + extra time
// ═══════════════════════════════════════════════════════════════════

describe('Attempt checkpoint — 10 pause/extend/reopen', () => {
  it('should allow only valid attempt status transitions', () => {
    expect(ATTEMPT_STATUS_TRANSITIONS.ready).toContain('in_progress');
    expect(ATTEMPT_STATUS_TRANSITIONS.in_progress).toContain('submitted');
    expect(ATTEMPT_STATUS_TRANSITIONS.submitted).toHaveLength(0);
    expect(ATTEMPT_STATUS_TRANSITIONS.terminated).toHaveLength(0);
  });

  it('should reject stale-epoch events after reopen (epoch bump)', () => {
    expect(evaluateProctorEpoch({ eventEpoch: 1, currentEpoch: 1 }).allowed).toBe(true);
    expect(evaluateProctorEpoch({ eventEpoch: 1, currentEpoch: 2 }).allowed).toBe(false);
    expect(evaluateProctorEpoch({ eventEpoch: null, currentEpoch: 1 }).reason).toBe('invalid_epoch');
  });

  it('should extend the window by accommodation extra time', () => {
    const base = computeAttemptTiming({ baseMinutes: 60, extraMinutes: 15, now: 1_700_000_000_000 });
    expect(base.totalMinutes).toBe(75);
    expect(base.extraMinutes).toBe(15);
    const cfg = { extraTimeMinutes: 20 };
    expect(extractExtraTimeMinutes(cfg)).toBe(20);
  });

  it('should hash-chain evidence immutably per attempt', () => {
    const h1 = hashChainEvent({ prevHash: null, canonicalEvent: { a: 1 } });
    const h2 = hashChainEvent({ prevHash: h1, canonicalEvent: { a: 2 } });
    expect(h1).toBeTruthy();
    expect(h2).toBeTruthy();
    expect(h2).not.toBe(h1);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 11. SCREEN-READER / ACCOMMODATION
// ═══════════════════════════════════════════════════════════════════

describe('Attempt checkpoint — 11 screen-reader/accommodation', () => {
  it('should return a safe default operational config without PostgreSQL', async () => {
    const config = await getEffectiveOperationalConfig(1, 1);
    expect(config.extraTimeMinutes).toBe(0);
    expect(config.maxStrikes).toBe(3);
    expect(config.cameraDisabled).toBe(false);
    expect(config.readerType).toBeNull();
    expect(config.fontSize).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════
// 12. CAMERA OPT-OUT / PILOT — privacy-first alternative path
// ═══════════════════════════════════════════════════════════════════

describe('Attempt checkpoint — 12 camera opt-out/pilot', () => {
  it('should reject forbidden evidence fields (emotion/gaze/honesty) — §15', () => {
    for (const field of ['emotion', 'gaze', 'honesty_score', 'automatic_misconduct', 'cheat_probability']) {
      const v = validateEvidenceFlags({ [field]: true });
      expect(v.ok).toBe(false);
    }
    expect(validateEvidenceFlags({ face_present: true, face_count: 1 }).ok).toBe(true);
  });

  it('should discard normal frames (no raw retention)', () => {
    const d = shouldDiscardSample({ face_present: true, face_count: 1, phone_detected: false, freeze_detected: false });
    expect(d.discard).toBe(true);
    expect(shouldDiscardSample({ face_present: true, phone_detected: true }).discard).toBe(false);
  });

  it('should require consent and re-consent on version mismatch', () => {
    expect(deriveConsentState(null, 1).requires_consent).toBe(true);
    expect(deriveConsentState({ consent_version: 1, granted_at: 'x', revoked_at: null }, 1).requires_consent).toBe(false);
    expect(deriveConsentState({ consent_version: 1, granted_at: 'x', revoked_at: null }, 2).requires_consent).toBe(true);
  });

  it('should surface a privacy-transparent pilot status', () => {
    const status = buildPilotStatus({ policy: { pilot_enabled: true, consent_version: 1 } });
    expect(status.never_collected).toContain('emotion');
    expect(status.never_collected).toContain('raw_frames');
    expect(JSON.stringify(status)).not.toMatch(/storage_key/);
  });

  it('should no-op evidence ingest when pilot is OFF (alternative path)', async () => {
    const r = await recordCameraEvidence({
      attemptId: 1,
      userId: 1,
      samples: [{ client_seq: 1, flags: { phone_detected: true } }],
    });
    expect(r.ok).toBe(true);
    expect(r.skipped).toBe(true);
    expect(r.reason).toMatch(/disabled/);
  });
});

// ═══════════════════════════════════════════════════════════════════
// GRACEFUL DEGRADATION (PostgreSQL absent in CI)
// ═══════════════════════════════════════════════════════════════════

describe('Attempt checkpoint — graceful degradation', () => {
  it('should throw PostgreSQL required on write paths', async () => {
    await expect(startAttempt({ assignmentId: 1, userId: 1 })).rejects.toThrow('PostgreSQL required');
    await expect(recordProctorEvents({ attemptId: 1, userId: 1, events: [] })).rejects.toThrow('PostgreSQL required');
    await expect(reconnectSync({ attemptId: 1, userId: 1, deviceId: 'd1', entries: [] })).rejects.toThrow('PostgreSQL required');
    await expect(submitAttempt({ attemptId: 1, userId: 1, confirmed: true })).rejects.toThrow('PostgreSQL required');
  });
});
