/**
 * Edikit — Exam, Paper & Grade Checkpoint (Prompt 49)
 *
 * Final controlled mock cycle — exam operationsdan final result/appealgacha
 * FULL journey walk at the pure-logic layer (attempt-governance / teacher-core
 * checkpoint naqshida). Hech qanday DB mutate qilinmaydi; barcha qarorlar
 * deterministic pure-funksiyalar orqali tekshiriladi.
 *
 * Journey (Prompt 49 §07–§13):
 *   07. schedule/seat/proctor — solveSchedule (hard violation=0) → seat
 *       allocation → signed hall ticket → proctor duty no-clash
 *   08. online + paper cohort — paper packet plan + signed page QR +
 *       manifest + custody chain; submission receipt (signed/verified)
 *   09. scan/reconcile — expected page set → duplicates/missing/orphans →
 *       reconciliation counters → completion blocker (page loss = 0)
 *   10. marker calibration/moderation — pseudonym, allocation plan,
 *       calibration (threshold), disagreement → agreed mark
 *   11. grade rules — deterministic calculateGrade arithmetic
 *   12. board ratify/release — checkBoardReady (fail-closed), quorum,
 *       snapshot hash, SIS payload, amendment ledger
 *   13. wrong-key rescore + appeal drill — no-detriment, AI hukmi yo'q,
 *       case state machine, sensitive-evidence ACL
 *
 * DONE CONDITION (Prompt 49 §25): hard conflict = 0, page loss = 0,
 * arithmetic error = 0, unauthorized final release = 0.
 *
 * SECURITY / DATA GUARD (Prompt 49 §15):
 *   - No test mutates the DB; no manual hidden correction drill.
 *   - Services degrade gracefully (PostgreSQL absent in CI) — write paths
 *     throw 'PostgreSQL required', read paths return []/null.
 */

import { describe, it, expect } from 'vitest';

// ── Scheduler (Prompt 39) ──
import {
  solveSchedule,
  hasHardViolations,
  validateScheduleTransition,
} from '../../src/modules/scheduler/index.js';

// ── Seating (Prompt 40) ──
import {
  allocateSeats,
  allocateProctorDuties,
  verifyProctorNoClash,
  buildHallTicketPayload,
  signHallTicketToken,
  verifyHallTicketToken,
  highestContiguousSeq,
} from '../../src/modules/seating/index.js';

// ── Paper (Prompt 42) ──
import {
  buildPacketPlan,
  buildBatchManifest,
  signPageQr,
  verifyPageQr,
  scanPaperForSecrets,
  validateCustodyEvent,
  signCustodyEvent,
} from '../../src/modules/paper/index.js';

// ── Scan / Reconciliation (Prompt 43) ──
import {
  buildExpectedPageSet,
  detectDuplicatePages,
  detectMissingPages,
  detectOrphanPages,
  buildReconciliationCounters,
  evaluateQualityGate,
  validateScanBatchTransition,
  decodeAndRoutePage,
  SCAN_PAGE_STATUS,
  SCAN_BATCH_STATUS,
} from '../../src/modules/scan/index.js';

// ── Safe-submit receipt (Prompt 31) ──
import { buildSubmissionReceipt, verifySubmissionReceipt } from '../../src/modules/safe-submit/index.js';

// ── Marking (Prompt 46) ──
import {
  derivePseudonym,
  buildAllocationPlan,
  evaluateCalibration,
  resolveMarkingMode,
  evaluateDisagreement,
  computeAgreedMark,
  checkMarkerConflict,
  computeMarkingProgress,
} from '../../src/modules/marking/index.js';

// ── Grading (Prompt 45) ──
import {
  calculateGrade,
  applyBoundary,
  computeRunHash,
  hashRuleDsl,
  validateRuleDsl,
} from '../../src/modules/grading/index.js';

// ── Board (Prompt 47) ──
import {
  checkBoardReady,
  checkQuorum,
  buildSnapshotHash,
  nextAmendmentNo,
  validateAmendment,
  buildSisPayload,
} from '../../src/modules/board/index.js';

// ── Consideration (Prompt 48) ──
import {
  computeRescoreImpact,
  validateAppealGrounds,
  checkCaseTransition,
  canViewSensitiveEvidence,
  validateCapPolicy,
  buildCaseReference,
  CASE_STATUS,
} from '../../src/modules/consideration/index.js';

// Shared signing key (≥32 chars) for QR / hall ticket / custody HMACs.
const SIGN_KEY = 'exam-grade-checkpoint-secret-key-2026';

// ═══════════════════════════════════════════════════════════════════
// 07. SCHEDULE / SEAT / PROCTOR — hard conflict = 0
// ═══════════════════════════════════════════════════════════════════

describe('Exam Grade checkpoint — 07 schedule/seat/proctor', () => {
  const periods = [
    { id: 1, name: 'P1', start: '2026-09-01T09:00:00Z', end: '2026-09-01T11:00:00Z' },
    { id: 2, name: 'P2', start: '2026-09-01T14:00:00Z', end: '2026-09-01T16:00:00Z' },
  ];
  const rooms = [
    { id: 1, name: 'R1', capacity: 30, isolated: false, features: ['projector'] },
    { id: 2, name: 'R2', capacity: 10, isolated: true, features: [] },
  ];
  const proctors = [{ id: 1, dailyLimit: 4 }, { id: 2, dailyLimit: 4 }];

  it('should solve a schedule with ZERO hard violations (done condition)', () => {
    const exams = [
      { id: 101, title: 'Math', studentIds: [1, 2, 3, 4, 5], window: { start: '2026-09-01T08:00:00Z', end: '2026-09-01T17:00:00Z' } },
      { id: 102, title: 'Physics', studentIds: [6, 7, 8], window: { start: '2026-09-01T08:00:00Z', end: '2026-09-01T17:00:00Z' } },
    ];
    const result = solveSchedule({ exams, periods, rooms, proctors, seed: 7 });
    expect(hasHardViolations(result.violations, result.unscheduled)).toBe(false);
    expect(result.unscheduled).toHaveLength(0);
    expect(result.assignments).toHaveLength(2);
    expect(result.metrics.explainable).toBe(true);
    expect(result.deterministic).toBe(true);
    // Re-solve with same seed → identical schedule (reproducible version)
    const again = solveSchedule({ exams, periods, rooms, proctors, seed: 7 });
    expect(again.assignments).toEqual(result.assignments);
  });

  it('should refuse to publish a schedule with hard violations', () => {
    // Over-capacity exam → hard violation
    const exams = [{ id: 201, title: 'Huge', studentIds: Array.from({ length: 50 }, (_, i) => i + 1) }];
    const result = solveSchedule({ exams, periods, rooms: [{ id: 1, name: 'Small', capacity: 10, isolated: false, features: [] }], proctors, seed: 1 });
    expect(result.unscheduled.length).toBeGreaterThan(0);
    expect(validateScheduleTransition({ from: 'draft', to: 'published', violations: result.violations, unscheduled: result.unscheduled }).ok).toBe(false);
  });

  it('should allocate seats (accessible first) with no double-seating', () => {
    const seatMap = {
      layout: {
        rows: [
          { label: 'A', seats: [{ label: '1', accessible: true, features: ['wheelchair_access'] }, { label: '2', accessible: false }, { label: '3', accessible: false }] },
        ],
      },
    };
    const students = [
      { userId: 10, accommodation: { accessibleSeat: true }, variant: 'A' },
      { userId: 11, variant: 'B' },
      { userId: 12, variant: 'A' },
    ];
    const result = allocateSeats({ seatMap, students, seed: 3 });
    expect(result.ok).toBe(true);
    expect(result.assignments).toHaveLength(3);
    const keys = result.assignments.map((a) => `${a.rowLabel}-${a.seatLabel}`);
    expect(new Set(keys).size).toBe(3); // no double-seating
    // Accessible student got the accessible seat
    const acc = result.assignments.find((a) => a.userId === 10);
    expect(acc.flags).toContain('accessible_seat');
  });

  it('should sign + verify a hall ticket and reject tampering', () => {
    const payload = buildHallTicketPayload({
      assignmentId: 1, runId: 5, eventId: 9, periodId: 1, roomId: 1,
      studentUserId: 10, rowLabel: 'A', seatLabel: '1', variant: 'A',
      accommodationFlags: ['large_print', 'sensitive'], seatMapVersion: 1, issuedAt: '2026-09-01T08:00:00Z',
    });
    const token = signHallTicketToken(payload, SIGN_KEY);
    expect(verifyHallTicketToken(payload, token, SIGN_KEY)).toBe(true);
    expect(verifyHallTicketToken({ ...payload, seatLabel: '2' }, token, SIGN_KEY)).toBe(false);
    // Sensitive accommodation flag never reaches the ticket
    expect(payload.accommodationFlags).not.toContain('sensitive');
  });

  it('should allocate proctor duties with NO clash', () => {
    const result = allocateProctorDuties({
      slots: [{ periodId: 1, roomId: 1 }, { periodId: 2, roomId: 2 }],
      proctors: [{ userId: 1 }, { userId: 2 }],
      seed: 3,
    });
    expect(result.ok).toBe(true);
    expect(result.duties).toHaveLength(2);
    expect(verifyProctorNoClash(result.duties).ok).toBe(true); // no same-period clash
  });

  it('should compute the highest contiguous check-in seq (gap stops the run)', () => {
    expect(highestContiguousSeq([1, 2, 3, 5, 6])).toBe(3);
    expect(highestContiguousSeq([1, 2, 3])).toBe(3);
    expect(highestContiguousSeq([])).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 08. ONLINE + PAPER COHORT — packets, QR, manifest, receipt
// ═══════════════════════════════════════════════════════════════════

describe('Exam Grade checkpoint — 08 online + paper cohort', () => {
  it('should build a secret-free paper packet plan and reproducible manifest', () => {
    const plan = buildPacketPlan({
      assignmentId: 1, studentUserId: 10, variant: 'A',
      pageCount: 3, pageHashes: { 0: 'h0', 1: 'h1', 2: 'h2' },
      identity: { name: 'Ali', student_id: 'UZ-123' },
    });
    expect(plan.ok).toBe(true);
    expect(plan.plan.opaque_packet_id).toMatch(/^[0-9a-f]{32}$/);
    expect(plan.plan.pages).toHaveLength(3);
    expect(plan.plan.cover_identity.name).toBe('Ali'); // detachable cover only
    // Manifest reproducible — same inputs → same hash
    const m1 = buildBatchManifest({ batchId: 1, batchKey: 'B1', packetPlans: [plan.plan] });
    const m2 = buildBatchManifest({ batchId: 1, batchKey: 'B1', packetPlans: [plan.plan] });
    expect(m1.hash).toBe(m2.hash);
  });

  it('should sign + verify page QR and scan artifacts for secrets', () => {
    const plan = buildPacketPlan({ assignmentId: 1, pageCount: 2, pageHashes: { 0: 'h0', 1: 'h1' } });
    const packetId = plan.plan.opaque_packet_id;
    const signed = signPageQr({ packetId, pageIndex: 1, key: SIGN_KEY, nonce: 'n1' });
    const v = verifyPageQr(signed.token, SIGN_KEY);
    expect(v.ok).toBe(true);
    expect(v.payload.packet).toBe(packetId);
    expect(v.payload.page).toBe(1);
    // Tamper → rejected
    expect(verifyPageQr(signed.token.replace('"n1"', '"n2"'), SIGN_KEY).ok).toBe(false);
    // QR payload must never contain answer keys / PII
    const qrPayload = JSON.parse(signed.token);
    delete qrPayload.sig;
    expect(scanPaperForSecrets(qrPayload).ok).toBe(true);
  });

  it('should build a signed submission receipt that verifies and rejects tampering', () => {
    const receipt = buildSubmissionReceipt({ attemptId: 42, versionNo: 2, sessionKey: 'sess-1', sha256: 'abc123', quarantineStatus: 'clean', secret: SIGN_KEY });
    expect(verifySubmissionReceipt(receipt, SIGN_KEY)).toBe(true);
    expect(verifySubmissionReceipt(receipt, 'wrong-key')).toBe(false);
    expect(receipt.body.attemptId).toBe(42);
  });

  it('should maintain a tamper-evident custody chain', () => {
    const ev1 = validateCustodyEvent({ eventType: 'generated', count: 30 });
    expect(ev1.ok).toBe(true);
    const h1 = signCustodyEvent({ prevEventId: null, eventType: 'generated', count: 30, batchId: 1, key: SIGN_KEY });
    const h2 = signCustodyEvent({ prevEventId: h1, eventType: 'operator_received', count: 30, batchId: 1, key: SIGN_KEY });
    expect(h1).toBeTruthy();
    expect(h2).not.toBe(h1); // chained, tamper-evident
    // Invalid event type rejected
    expect(validateCustodyEvent({ eventType: 'hacked', count: 1 }).ok).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 09. SCAN / RECONCILE — page loss = 0
// ═══════════════════════════════════════════════════════════════════

describe('Exam Grade checkpoint — 09 scan/reconcile', () => {
  const packets = [
    { packetId: 'pkt-A', pageCount: 2 },
    { packetId: 'pkt-B', pageCount: 2 },
  ];

  it('should detect NO missing pages when the batch is complete (page loss = 0)', () => {
    const expected = buildExpectedPageSet(packets);
    expect(expected.size).toBe(4);
    const reconciled = [
      { packetId: 'pkt-A', pageIndex: 0 }, { packetId: 'pkt-A', pageIndex: 1 },
      { packetId: 'pkt-B', pageIndex: 0 }, { packetId: 'pkt-B', pageIndex: 1 },
    ];
    expect(detectMissingPages(expected, reconciled)).toHaveLength(0);
    expect(detectOrphanPages(expected, reconciled)).toHaveLength(0);
    expect(detectDuplicatePages(reconciled)).toHaveLength(0);
  });

  it('should flag a missing page and BLOCK grading_ready (completion blocker)', () => {
    const expected = buildExpectedPageSet(packets);
    const reconciled = [
      { packetId: 'pkt-A', pageIndex: 0 }, { packetId: 'pkt-A', pageIndex: 1 },
      { packetId: 'pkt-B', pageIndex: 0 }, // pkt-B::1 missing
    ];
    const missing = detectMissingPages(expected, reconciled);
    expect(missing).toHaveLength(1);
    expect(missing[0].key).toBe('pkt-B::1');
    // Counters + transition guard
    const counters = buildReconciliationCounters({
      pages: reconciled.map((r, i) => ({ id: i, page_status: SCAN_PAGE_STATUS.ROUTED, routed_packet_id: r.packetId, routed_page_index: r.pageIndex })),
      expectedPackets: packets,
    });
    expect(counters.missing_pages).toBe(1);
    expect(counters.reconciled_pages).toBe(3);
    const t = validateScanBatchTransition(SCAN_BATCH_STATUS.RECONCILING, SCAN_BATCH_STATUS.GRADING_READY, counters);
    expect(t.ok).toBe(false); // completion blocked
    expect(t.error).toMatch(/blocked/i);
  });

  it('should detect duplicate and orphan pages (never silent drop)', () => {
    const expected = buildExpectedPageSet(packets);
    const routed = [
      { pageId: 1, packetId: 'pkt-A', pageIndex: 0 },
      { pageId: 2, packetId: 'pkt-A', pageIndex: 0 }, // duplicate
      { pageId: 3, packetId: 'pkt-FOREIGN', pageIndex: 5 }, // orphan
    ];
    expect(detectDuplicatePages(routed)).toHaveLength(1);
    expect(detectOrphanPages(expected, routed)).toHaveLength(1);
  });

  it('should enforce the quality gate (blur/cut/upside-down → not OK)', () => {
    expect(evaluateQualityGate({ dpi: 300, blur: false }).ok).toBe(true);
    // Defects stack below minQualityScore (60): blur 25 + low_dpi 15 + cut 20 = 60 → 40
    expect(evaluateQualityGate({ dpi: 150, blur: true, cut: true }).ok).toBe(false);
    expect(evaluateQualityGate({ dpi: 150, blur: true }).flags).toContain('low_dpi');
    expect(evaluateQualityGate({ orientation: 'upside_down' }).ok).toBe(false); // hard fail
  });

  it('should decode a signed page QR and reject a forged one', () => {
    const signed = signPageQr({ packetId: 'pkt-A', pageIndex: 1, key: SIGN_KEY, nonce: 'n' });
    const routed = decodeAndRoutePage(signed.token, SIGN_KEY);
    expect(routed.status).toBe('decoded');
    expect(routed.packetId).toBe('pkt-A');
    expect(decodeAndRoutePage(null, SIGN_KEY).status).toBe('missing');
    // HMAC forgery is caught by paper.schema verifyPageQr (timing-safe) — the
    // scan service re-verifies the signature after shape-level decode.
    expect(verifyPageQr(signed.token, 'wrong-key-00000000000000000000').ok).toBe(false);
    expect(verifyPageQr(signed.token, SIGN_KEY).ok).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 10. MARKER CALIBRATION / MODERATION
// ═══════════════════════════════════════════════════════════════════

describe('Exam Grade checkpoint — 10 marker calibration/moderation', () => {
  it('should derive an opaque, deterministic pseudonym (marker sees no identity)', () => {
    const p1 = derivePseudonym({ tenantId: 1, submissionVersionId: 7, salt: 'secret' });
    const p2 = derivePseudonym({ tenantId: 1, submissionVersionId: 7, salt: 'secret' });
    expect(p1).toBe(p2);
    expect(p1).toMatch(/^S-[0-9A-F]{8}$/);
    expect(p1).not.toContain('Ali'); // no identity leak
  });

  it('should allocate work items within caps and honor conflicts', () => {
    const plan = buildAllocationPlan({
      markers: [{ userId: 1, role: 'marker', workloadCap: 2 }, { userId: 2, role: 'marker', workloadCap: 2 }],
      submissions: [{ id: 10 }, { id: 11 }, { id: 12 }],
      opts: { mode: 'single' },
    });
    expect(plan.ok).toBe(true);
    expect(plan.workItems).toHaveLength(3);
    // Conflict: marker 1 must never mark own submission
    const selfCheck = checkMarkerConflict({ markerUserId: 1, submission: { studentUserId: 1 } });
    expect(selfCheck.ok).toBe(false);
    const okCheck = checkMarkerConflict({ markerUserId: 1, submission: { studentUserId: 99 } });
    expect(okCheck.ok).toBe(true);
  });

  it('should pass/fail calibration on anchor deviation threshold', () => {
    const pass = evaluateCalibration({ goldScores: { a1: 5, a2: 4 }, markerScores: { a1: 5, a2: 4 }, threshold: 1 });
    expect(pass.passed).toBe(true);
    const fail = evaluateCalibration({ goldScores: { a1: 5, a2: 4 }, markerScores: { a1: 3, a2: 4 }, threshold: 1 });
    expect(fail.passed).toBe(false);
    expect(fail.failedAnchors).toContain('a1');
  });

  it('should resolve double-marking disagreement to adjudication', () => {
    expect(resolveMarkingMode({ mode: 'single' })).toBe('single');
    const close = evaluateDisagreement({ score1: 10, score2: 12, threshold: 5 });
    expect(close.agreed).toBe(true);
    const far = evaluateDisagreement({ score1: 10, score2: 18, threshold: 5 });
    expect(far.needsAdjudication).toBe(true);
    const agreed = computeAgreedMark({ policy: 'double', score1: 10, score2: 18, threshold: 5 });
    expect(agreed.agreedScore).toBeNull(); // → adjudication
    expect(agreed.adjudicated).toBe(true);
  });

  it('should compute marking progress with overdue detection', () => {
    const progress = computeMarkingProgress({
      workItems: [
        { status: 'agreed' }, { status: 'scored' }, { status: 'in_progress' },
        { status: 'queued', dueAt: Date.now() - 1000 },
      ],
      now: Date.now(),
    });
    expect(progress.total).toBe(4);
    expect(progress.scored).toBe(2);
    expect(progress.percent).toBe(50);
    expect(progress.overdue).toBe(1);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 11. GRADE RULES — arithmetic error = 0
// ═══════════════════════════════════════════════════════════════════

describe('Exam Grade checkpoint — 11 grade rules', () => {
  const dsl = {
    missingPolicy: 'exclude',
    rounding: { method: 'half_up', scale: 2 },
    components: [
      { key: 'mid', label: 'Midterm', weight: 40, max_score: 100 },
      { key: 'fin', label: 'Final', weight: 60, max_score: 100 },
    ],
  };

  it('should validate the declarative DSL and hash it deterministically', () => {
    expect(validateRuleDsl(dsl).ok).toBe(true);
    expect(hashRuleDsl(dsl)).toBe(hashRuleDsl({ ...dsl }));
    expect(validateRuleDsl({ ...dsl, components: [{ key: 'a', label: 'A', weight: 50, max_score: 10 }] }).ok).toBe(false); // weights ≠ 100
  });

  it('should compute 70% → C with exact arithmetic (mid 70/100, final 70/100)', () => {
    const r = calculateGrade({
      dsl,
      components: [
        { key: 'mid', raw_score: 70, status: 'scored' },
        { key: 'fin', raw_score: 70, status: 'scored' },
      ],
    });
    expect(r.blocked).toBe(false);
    expect(r.finalGrade).toBe(70);
    expect(r.gradeLabel).toBe('C');
    expect(applyBoundary(r.finalGrade * 10000, dsl.boundaries)).toBe('C');
  });

  it('should BLOCK when a component is pending (no partial final)', () => {
    const r = calculateGrade({
      dsl,
      components: [
        { key: 'mid', raw_score: 70, status: 'scored' },
        { key: 'fin', raw_score: null, status: 'pending' },
      ],
    });
    expect(r.blocked).toBe(true);
    expect(r.finalGrade).toBeNull();
  });

  it('should exclude a missing component (weight redistributed) — no arithmetic error', () => {
    const r = calculateGrade({
      dsl,
      components: [
        { key: 'mid', raw_score: 80, status: 'scored' },
        { key: 'fin', raw_score: null, status: 'missing' }, // excluded
      ],
    });
    expect(r.blocked).toBe(false);
    expect(r.finalGrade).toBe(80);
  });

  it('should produce a deterministic run hash (reproducible replay)', () => {
    const ruleHash = hashRuleDsl(dsl);
    const h1 = computeRunHash({ ruleHash, components: [{ key: 'mid', raw_score: 70, status: 'scored' }], context: { attemptNumber: 1 } });
    const h2 = computeRunHash({ ruleHash, components: [{ key: 'mid', raw_score: 70, status: 'scored' }], context: { attemptNumber: 1 } });
    expect(h1).toBe(h2);
    expect(h1).not.toBe(computeRunHash({ ruleHash, components: [{ key: 'mid', raw_score: 71, status: 'scored' }], context: { attemptNumber: 1 } }));
  });
});

// ═══════════════════════════════════════════════════════════════════
// 12. BOARD RATIFY / RELEASE — unauthorized final release = 0
// ═══════════════════════════════════════════════════════════════════

describe('Exam Grade checkpoint — 12 board ratify/release', () => {
  const run = { id: 1, status: 'complete', final_grade: 82, grade_label: 'B', blocked: false };
  const rule = { status: 'approved', rule_hash: 'abc' };

  it('should be board-ready when all preconditions hold', () => {
    const ready = checkBoardReady({ rule, run, openModerationCases: [] });
    expect(ready.ok).toBe(true);
    expect(ready.blockers).toHaveLength(0);
  });

  it('should FAIL CLOSED on missing rule / open moderation / unsupported release policy', () => {
    expect(checkBoardReady({ rule: null, run, openModerationCases: [] }).ok).toBe(false);
    expect(checkBoardReady({ rule, run, openModerationCases: [{ id: 1 }] }).ok).toBe(false);
    expect(checkBoardReady({ rule, run, openModerationCases: [], policy: { releasePolicy: 'auto_release' } }).ok).toBe(false);
    // Unauthorized final release impossible — releasePolicy is ratification_required
    expect(checkBoardReady({ rule: { status: 'draft' }, run, openModerationCases: [] }).ok).toBe(false);
  });

  it('should enforce quorum with conflict exclusion (conflicted member cannot vote)', () => {
    const q = checkQuorum({
      attendees: [
        { attended: true, conflict_declared: false, vote: 'approve' },
        { attended: true, conflict_declared: false, vote: 'approve' },
        { attended: true, conflict_declared: true, vote: 'reject' }, // conflicted — excluded
        { attended: true, conflict_declared: false, vote: null },    // attended, no vote
      ],
      requiredQuorum: 3,
      requiredApprovalRatio: 0.6,
    });
    expect(q.conflicted).toBe(1);
    expect(q.eligibleVoters).toBe(3); // conflicted excluded from quorum
    expect(q.ok).toBe(true); // 2/2 approvals (non-abstaining) = 100%
  });

  it('should build an immutable snapshot hash and chained amendments', () => {
    const h1 = buildSnapshotHash({ run, ruleVersion: rule, amendments: [] });
    const h2 = buildSnapshotHash({ run, ruleVersion: rule, amendments: [{ amendment_no: 1, old_final: 80, new_final: 82, reason: 'x' }] });
    expect(h1).toMatch(/^[0-9a-f]{64}$/);
    expect(h2).not.toBe(h1); // amendment changes the fingerprint
    expect(nextAmendmentNo([])).toBe(1);
    expect(nextAmendmentNo([{ amendment_no: 1 }])).toBe(2);
    // Amendment must actually change the grade
    expect(validateAmendment({ amendmentNo: 1, oldFinal: 80, newFinal: 80, reason: 'no change' }).ok).toBe(false);
    expect(validateAmendment({ amendmentNo: 1, oldFinal: 80, newFinal: 82, reason: 'wrong key corrected' }).ok).toBe(true);
  });

  it('should build an idempotent SIS payload (external_key embeds run + version)', () => {
    const decision = { id: 9, snapshot_hash: 'xyz', ratified_final: 82, decided_at: '2026-09-02T10:00:00Z' };
    const user = { external_id: 'EXT-42' };
    const p = buildSisPayload({ decision, run, user, version: 0 });
    expect(p.externalKey).toBe('gr-1-v0');
    expect(p.payload.finalGrade).toBe(82);
    expect(p.payload.studentExternalId).toBe('EXT-42');
    expect(p.payload.type).toBe('grade_result');
    // Re-release with version 1 → different key (dedupe by external_key)
    expect(buildSisPayload({ decision, run, user, version: 1 }).externalKey).toBe('gr-1-v1');
  });
});

// ═══════════════════════════════════════════════════════════════════
// 13. WRONG-KEY RESCORE + APPEAL DRILL — no-detriment, AI hukmi yo'q
// ═══════════════════════════════════════════════════════════════════

describe('Exam Grade checkpoint — 13 rescore + appeal drill', () => {
  it('should apply no-detriment rescore (student never loses)', () => {
    const up = computeRescoreImpact({ before: 70, after: 85, noDetriment: true });
    expect(up.effective).toBe(85);
    expect(up.improved).toBe(true);
    const down = computeRescoreImpact({ before: 85, after: 70, noDetriment: true });
    expect(down.effective).toBe(85); // keeps higher score
    expect(down.delta).toBe(-15);
    const raw = computeRescoreImpact({ before: 85, after: 70, noDetriment: false });
    expect(raw.effective).toBe(70);
  });

  it('should reject AI/proctor signals as conclusive appeal facts (AI hukmi yo\'q)', () => {
    expect(validateAppealGrounds({ grounds: 'Baholashda arifmetik xatolik bor deb hisoblayman.' }).ok).toBe(true);
    expect(validateAppealGrounds({ grounds: 'The AI score said I should get higher.' }).ok).toBe(false);
    expect(validateAppealGrounds({ grounds: 'Proctor camera flag proves my answer.' }).ok).toBe(false);
    expect(validateAppealGrounds({ grounds: 'short' }).ok).toBe(false);
  });

  it('should enforce the §72.3 case state machine', () => {
    expect(checkCaseTransition({ from: CASE_STATUS.DRAFT, to: CASE_STATUS.SUBMITTED }).ok).toBe(true);
    expect(checkCaseTransition({ from: CASE_STATUS.DRAFT, to: CASE_STATUS.CLOSED }).ok).toBe(false);
    expect(checkCaseTransition({ from: CASE_STATUS.DECISION_PENDING, to: CASE_STATUS.APPROVED }).ok).toBe(true);
  });

  it('should keep sensitive evidence away from marker/proctor (ACL)', () => {
    expect(canViewSensitiveEvidence({ role: 'institution_admin' })).toBe(true);
    expect(canViewSensitiveEvidence({ role: 'marker' })).toBe(false);
    expect(canViewSensitiveEvidence({ role: 'proctor' })).toBe(false);
    expect(canViewSensitiveEvidence({ role: 'external_examiner' })).toBe(false);
  });

  it('should pin cap policy and build a scoped case reference', () => {
    expect(validateCapPolicy({ capRule: 'capped', capPolicyVersion: 'v2' }).ok).toBe(true);
    expect(validateCapPolicy({ capRule: 'capped', capPolicyVersion: '' }).ok).toBe(false);
    expect(validateCapPolicy({ capRule: 'max_attempts', capPolicyVersion: 'v1', attemptCount: 4, maxAttempts: 3 }).ok).toBe(false);
    expect(buildCaseReference({ tenantId: 1, attemptId: 5 })).toMatch(/^SC-1-[0-9A-F]{8}$/);
  });
});

// ═══════════════════════════════════════════════════════════════════
// GRACEFUL DEGRADATION (PostgreSQL absent in CI)
// ═══════════════════════════════════════════════════════════════════

describe('Exam Grade checkpoint — graceful degradation', () => {
  it('should throw PostgreSQL required on write paths', async () => {
    const scheduler = await import('../../src/modules/scheduler/index.js');
    await expect(scheduler.runSolver({ title: 'x', exams: [], periods: [], rooms: [] })).rejects.toThrow('PostgreSQL required');
    const seating = await import('../../src/modules/seating/index.js');
    await expect(seating.upsertSeatMap({ roomId: 1, layout: {} })).rejects.toThrow('PostgreSQL required');
    const board = await import('../../src/modules/board/index.js');
    await expect(board.ratifyResult({ meetingId: 1, runId: 1, userId: 1 })).rejects.toThrow('PostgreSQL required');
    await expect(board.releaseBatch({ decisionId: 1 })).rejects.toThrow('PostgreSQL required');
    const grading = await import('../../src/modules/grading/index.js');
    await expect(grading.runGradeCalculation({ ruleVersionId: 1, userId: 1, components: [{ key: 'mid', raw_score: 70, status: 'scored' }] })).rejects.toThrow('PostgreSQL required');
    const consideration = await import('../../src/modules/consideration/index.js');
    await expect(consideration.rescoreAttempt({ incidentId: 1, attemptId: 1, runId: 1, newFinal: 90 })).rejects.toThrow('PostgreSQL required');
  });

  it('should return []/null on read paths', async () => {
    const grading = await import('../../src/modules/grading/index.js');
    expect(await grading.listGradeRules({})).toEqual([]);
    const board = await import('../../src/modules/board/index.js');
    expect(await board.listBoardMeetings({})).toEqual([]);
    const consideration = await import('../../src/modules/consideration/index.js');
    expect(await consideration.listCases({})).toEqual([]);
    expect(await consideration.listIncidents({})).toEqual([]);
  });
});
