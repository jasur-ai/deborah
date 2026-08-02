/**
 * Edikit — Marker Allocation, Calibration & Moderation unit tests (Prompt 46)
 *
 * Pure-schema coverage:
 *   - Pseudonym derivation: deterministic, non-reversible, salted
 *   - Allocation plan: round-robin, workload caps, capacity exhaustion
 *   - Conflict checks: self-marking, declared conflicts
 *   - Calibration: threshold-gated pass/fail, missing anchor fails
 *   - Scoring: criterion sum, mode resolution (sample determinism)
 *   - Disagreement: threshold delta, agreed mark policies (sample/second/double)
 *   - External examiner scoping guard
 *   - Progress metrics (scored/overdue/percent)
 */

import { describe, it, expect } from 'vitest';
import {
  derivePseudonym,
  buildAllocationPlan,
  checkMarkerConflict,
  evaluateCalibration,
  sumCriterionScores,
  resolveMarkingMode,
  evaluateDisagreement,
  computeAgreedMark,
  checkExternalExaminerScope,
  computeMarkingProgress,
  MARKING_MODES,
  MARKING_DEFAULTS,
} from '../../src/modules/marking/index.js';

// ═══════════════════════════════════════════════════════════════════
// PSEUDONYMS
// ═══════════════════════════════════════════════════════════════════

describe('derivePseudonym', () => {
  it('is deterministic for the same inputs', () => {
    expect(derivePseudonym({ tenantId: 1, submissionVersionId: 42 }))
      .toBe(derivePseudonym({ tenantId: 1, submissionVersionId: 42 }));
  });

  it('differs across submission ids and salts', () => {
    const a = derivePseudonym({ tenantId: 1, submissionVersionId: 1 });
    const b = derivePseudonym({ tenantId: 1, submissionVersionId: 2 });
    const c = derivePseudonym({ tenantId: 1, submissionVersionId: 1, salt: 'other-secret' });
    expect(a).not.toBe(b);
    expect(a).not.toBe(c);
  });

  it('is non-reversible (hash digest, not the raw id)', () => {
    const p = derivePseudonym({ tenantId: 1, submissionVersionId: 999 });
    expect(p).toMatch(/^S-[0-9A-F]{8}$/);
    expect(p).not.toContain('999');
  });
});

// ═══════════════════════════════════════════════════════════════════
// ALLOCATION & WORKLOAD
// ═══════════════════════════════════════════════════════════════════

describe('buildAllocationPlan', () => {
  it('returns error when no markers', () => {
    const r = buildAllocationPlan({ markers: [], submissions: [{ id: 1 }] });
    expect(r.ok).toBe(false);
    expect(r.error).toBe('no markers');
  });

  it('returns error when no submissions', () => {
    const r = buildAllocationPlan({ markers: [{ userId: 1, role: 'marker' }], submissions: [] });
    expect(r.ok).toBe(false);
    expect(r.error).toBe('no submissions');
  });

  it('round-robins across markers within workload caps', () => {
    const r = buildAllocationPlan({
      markers: [
        { userId: 1, role: 'marker', workloadCap: 2 },
        { userId: 2, role: 'marker', workloadCap: 2 },
      ],
      submissions: [{ id: 1 }, { id: 2 }, { id: 3 }],
    });
    expect(r.ok).toBe(true);
    expect(r.workItems.length).toBe(3);
    // Each marker got ≤ 2 items
    const perMarker = {};
    for (const w of r.workItems) perMarker[w.markerUserId] = (perMarker[w.markerUserId] || 0) + 1;
    expect(perMarker[1]).toBeLessThanOrEqual(2);
    expect(perMarker[2]).toBeLessThanOrEqual(2);
  });

  it('reports capacity exhaustion when caps are insufficient', () => {
    const r = buildAllocationPlan({
      markers: [{ userId: 1, role: 'marker', workloadCap: 1 }],
      submissions: [{ id: 1 }, { id: 2 }, { id: 3 }],
    });
    expect(r.ok).toBe(false);
    expect(r.error).toBe('workload capacity exhausted');
  });

  it('adds deterministic sample items in sample mode', () => {
    const r = buildAllocationPlan({
      markers: [
        { userId: 1, role: 'marker' },
        { userId: 2, role: 'sample_marker' },
      ],
      submissions: [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }, { id: 5 }, { id: 6 }, { id: 7 }, { id: 8 }, { id: 9 }, { id: 10 }],
      opts: { mode: MARKING_MODES.SAMPLE, sampleRatePercent: 20 },
    });
    expect(r.ok).toBe(true);
    expect(r.planSummary.sampleItems).toBeGreaterThan(0);
    expect(r.planSummary.workItems).toBeGreaterThan(r.planSummary.total);
  });
});

// ═══════════════════════════════════════════════════════════════════
// CONFLICT CHECKS
// ═══════════════════════════════════════════════════════════════════

describe('checkMarkerConflict', () => {
  it('blocks a marker from marking their own submission', () => {
    const r = checkMarkerConflict({ markerUserId: 5, submission: { studentUserId: 5 } });
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('own submission');
  });

  it('blocks declared conflicts', () => {
    const r = checkMarkerConflict({
      markerUserId: 5,
      submission: { studentUserId: 9 },
      conflicts: [{ markerUserId: 5, studentUserId: 9, reason: 'family member' }],
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('family member');
  });

  it('allows unrelated markers', () => {
    const r = checkMarkerConflict({
      markerUserId: 5,
      submission: { studentUserId: 9 },
      conflicts: [{ markerUserId: 6, studentUserId: 9 }],
    });
    expect(r.ok).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════
// CALIBRATION
// ═══════════════════════════════════════════════════════════════════

describe('evaluateCalibration', () => {
  it('passes when all deviations are within threshold', () => {
    const r = evaluateCalibration({
      goldScores: { a1: 80, a2: 60 },
      markerScores: { a1: 82, a2: 58 },
      threshold: 5,
    });
    expect(r.passed).toBe(true);
    expect(r.failedAnchors).toEqual([]);
  });

  it('fails when an anchor deviates beyond threshold', () => {
    const r = evaluateCalibration({
      goldScores: { a1: 80, a2: 60 },
      markerScores: { a1: 80, a2: 40 },
      threshold: 5,
    });
    expect(r.passed).toBe(false);
    expect(r.failedAnchors).toEqual(['a2']);
  });

  it('fails when a gold anchor is missing from marker scores (fail-closed)', () => {
    const r = evaluateCalibration({
      goldScores: { a1: 80, a2: 60 },
      markerScores: { a1: 80 },
      threshold: 5,
    });
    expect(r.passed).toBe(false);
    expect(r.failedAnchors).toContain('a2');
  });

  it('never passes with an empty gold set', () => {
    const r = evaluateCalibration({ goldScores: {}, markerScores: {} });
    expect(r.passed).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════
// SCORING & MODES
// ═══════════════════════════════════════════════════════════════════

describe('sumCriterionScores', () => {
  it('sums criterion scores with 2dp precision', () => {
    expect(sumCriterionScores([{ score: 10 }, { score: 15.5 }, { score: 4.25 }])).toBe(29.75);
  });

  it('returns 0 for empty input', () => {
    expect(sumCriterionScores([])).toBe(0);
  });
});

describe('resolveMarkingMode', () => {
  it('returns the mode unchanged for explicit modes', () => {
    expect(resolveMarkingMode({ mode: 'double' })).toBe('double');
    expect(resolveMarkingMode({ mode: 'second' })).toBe('second');
  });

  it('deterministically samples in sample mode', () => {
    const m0 = resolveMarkingMode({ mode: 'sample', submissionIndex: 0, sampleRatePercent: 25 });
    const m1 = resolveMarkingMode({ mode: 'sample', submissionIndex: 1, sampleRatePercent: 25 });
    const m4 = resolveMarkingMode({ mode: 'sample', submissionIndex: 4, sampleRatePercent: 25 });
    expect(m0).toBe('double');
    expect(m1).toBe('single');
    expect(m4).toBe('double'); // period = 100/25 = 4 → index % 4 === 0
  });

  it('falls back to single for unknown modes', () => {
    expect(resolveMarkingMode({ mode: 'weird' })).toBe('single');
  });
});

// ═══════════════════════════════════════════════════════════════════
// DISAGREEMENT / AGREED MARK
// ═══════════════════════════════════════════════════════════════════

describe('evaluateDisagreement', () => {
  it('agrees when delta is within threshold', () => {
    const r = evaluateDisagreement({ score1: 70, score2: 72, threshold: 5 });
    expect(r.agreed).toBe(true);
    expect(r.delta).toBe(2);
    expect(r.needsAdjudication).toBe(false);
  });

  it('needs adjudication when delta exceeds threshold', () => {
    const r = evaluateDisagreement({ score1: 70, score2: 60, threshold: 5 });
    expect(r.agreed).toBe(false);
    expect(r.needsAdjudication).toBe(true);
  });
});

describe('computeAgreedMark', () => {
  it('averages within threshold for double marking', () => {
    const r = computeAgreedMark({ policy: 'double', score1: 70, score2: 72, threshold: 5 });
    expect(r.adjudicated).toBe(false);
    expect(r.agreedScore).toBe(71);
  });

  it('escalates disagreement to adjudication for double marking', () => {
    const r = computeAgreedMark({ policy: 'double', score1: 70, score2: 55, threshold: 5 });
    expect(r.adjudicated).toBe(true);
    expect(r.agreedScore).toBeNull();
  });

  it('always averages for sample policy (QA, not authority)', () => {
    const r = computeAgreedMark({ policy: 'sample', score1: 90, score2: 40, threshold: 5 });
    expect(r.adjudicated).toBe(false);
    expect(r.agreedScore).toBe(65);
  });
});

// ═══════════════════════════════════════════════════════════════════
// EXTERNAL EXAMINER SCOPE
// ═══════════════════════════════════════════════════════════════════

describe('checkExternalExaminerScope', () => {
  it('is permissive when not externally scoped', () => {
    const r = checkExternalExaminerScope({ examinerUserId: 5, workItem: { markerUserId: 9 }, externalScoped: false });
    expect(r.ok).toBe(true);
  });

  it('blocks access to other markers work items when scoped', () => {
    const r = checkExternalExaminerScope({ examinerUserId: 5, workItem: { markerUserId: 9 }, externalScoped: true });
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('own work items');
  });

  it('allows own work items when scoped', () => {
    const r = checkExternalExaminerScope({ examinerUserId: 5, workItem: { markerUserId: 5 }, externalScoped: true });
    expect(r.ok).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════
// PROGRESS METRICS
// ═══════════════════════════════════════════════════════════════════

describe('computeMarkingProgress', () => {
  it('computes scored/percent', () => {
    const r = computeMarkingProgress({
      workItems: [
        { status: 'agreed', dueAt: null },
        { status: 'scored', dueAt: null },
        { status: 'assigned', dueAt: null },
        { status: 'assigned', dueAt: null },
      ],
      now: Date.now(),
    });
    expect(r.total).toBe(4);
    expect(r.scored).toBe(2);
    expect(r.percent).toBe(50);
  });

  it('counts overdue items (not agreed and past due)', () => {
    const past = new Date(Date.now() - 86400000).toISOString();
    const future = new Date(Date.now() + 86400000).toISOString();
    const r = computeMarkingProgress({
      workItems: [
        { status: 'assigned', dueAt: past },
        { status: 'in_progress', dueAt: past },
        { status: 'agreed', dueAt: past },
        { status: 'assigned', dueAt: future },
      ],
    });
    expect(r.overdue).toBe(2);
  });

  it('returns 100% for empty assignment', () => {
    const r = computeMarkingProgress({ workItems: [] });
    expect(r.percent).toBe(100);
  });
});
