/**
 * Deborah — Unit Tests: Exam Scheduling Solver (Prompt 39)
 *
 * Pure-logic coverage:
 *   - Deterministic seeded PRNG (same seed → same schedule)
 *   - Hard constraint model (student double-book, capacity, room/proctor
 *     double-book, outside window, separate-room)
 *   - Known FEASIBLE fixture → all placed, zero hard violations
 *   - Known INFEASIBLE fixture → unscheduled + violations (publish gate)
 *   - Soft penalty explainability (every item { type, weight, delta, reason })
 *   - Metrics/report + what-if move compare
 *   - Version lifecycle (draft → approved → published; hard gate)
 */

import { describe, it, expect } from 'vitest';
import {
  createSeededRng,
  seededShuffle,
  checkHardConstraints,
  evaluateSoftPenalties,
  solveSchedule,
  buildScheduleMetrics,
  hasHardViolations,
  computeWhatIfMove,
  validateScheduleTransition,
  DEFAULT_WEIGHTS,
  HARD_CONSTRAINT_TYPES,
  SCHEDULE_STATUS_TRANSITIONS,
} from '../../src/modules/scheduler/index.js';

// ═══════════════════════════════════════════════════════════════════
// FIXTURES
// ═══════════════════════════════════════════════════════════════════

const ROOMS = [
  { id: 1, name: 'A-101', capacity: 30, isolated: false, features: ['computers'], status: 'active' },
  { id: 2, name: 'A-102', capacity: 25, isolated: false, features: [], status: 'active' },
  { id: 3, name: 'ISO-1', capacity: 1, isolated: true, features: [], status: 'active' },
];

const PERIODS = [
  { id: 1, name: '1-smena', start: '2025-06-02T09:00:00Z', end: '2025-06-02T11:00:00Z', status: 'active' },
  { id: 2, name: '2-smena', start: '2025-06-02T13:00:00Z', end: '2025-06-02T15:00:00Z', status: 'active' },
  { id: 3, name: '3-smena', start: '2025-06-03T09:00:00Z', end: '2025-06-03T11:00:00Z', status: 'active' },
];

const EXAMS_FEASIBLE = [
  { id: 10, title: 'Matematika', studentIds: [101, 102, 103, 104, 105, 106, 107, 108, 109, 110], separateRoomStudentIds: [], window: null, requiredFeatures: [] },
  { id: 11, title: 'Fizika', studentIds: [111, 112, 113, 114, 115, 116, 117, 118], separateRoomStudentIds: [], window: null, requiredFeatures: ['computers'] },
  { id: 12, title: 'Kimyo', studentIds: [201, 202, 203, 204, 205, 206, 207, 208], separateRoomStudentIds: [], window: null, requiredFeatures: [] },
  { id: 13, title: 'Separate student', studentIds: [301], separateRoomStudentIds: [301], window: null, requiredFeatures: [] },
];

const PROCTORS = [
  { id: 500, dailyLimit: 4, status: 'active' },
  { id: 501, dailyLimit: 4, status: 'active' },
];

// ═══════════════════════════════════════════════════════════════════
// DETERMINISTIC SEEDED RNG
// ═══════════════════════════════════════════════════════════════════

describe('Scheduler — deterministic seeded PRNG', () => {
  it('produces the same sequence for the same seed', () => {
    const a = createSeededRng(42);
    const b = createSeededRng(42);
    const seqA = [a(), a(), a(), a(), a()];
    const seqB = [b(), b(), b(), b(), b()];
    expect(seqA).toEqual(seqB);
  });

  it('produces a different sequence for a different seed', () => {
    const a = createSeededRng(42);
    const b = createSeededRng(43);
    expect([a(), a()]).not.toEqual([b(), b()]);
  });

  it('values stay in [0, 1)', () => {
    const rng = createSeededRng(7);
    for (let i = 0; i < 100; i++) {
      const v = rng();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('seededShuffle is deterministic for a fixed seed', () => {
    const items = [1, 2, 3, 4, 5, 6, 7, 8];
    expect(seededShuffle(items, 9)).toEqual(seededShuffle(items, 9));
    // preserves the element set
    expect(seededShuffle(items, 9).sort((a, b) => a - b)).toEqual(items);
  });
});

// ═══════════════════════════════════════════════════════════════════
// HARD CONSTRAINT MODEL
// ═══════════════════════════════════════════════════════════════════

describe('Scheduler — hard constraint model', () => {
  it('HARD_CONSTRAINT_TYPES covers all six rules', () => {
    expect(HARD_CONSTRAINT_TYPES).toEqual(expect.arrayContaining([
      'student_double_book',
      'room_capacity',
      'room_double_book',
      'proctor_double_book',
      'outside_window',
      'separate_room_violation',
    ]));
  });

  it('accepts a clean placement', () => {
    const res = checkHardConstraints({
      exam: { id: 1, title: 'A', studentIds: [1, 2, 3] },
      period: { id: 1, start: '2025-06-02T09:00:00Z', end: '2025-06-02T11:00:00Z' },
      room: { id: 1, name: 'R1', capacity: 10, isolated: false, features: [] },
      placed: [],
    });
    expect(res.ok).toBe(true);
    expect(res.violations).toHaveLength(0);
  });

  it('detects student double-book across overlapping periods', () => {
    const res = checkHardConstraints({
      exam: { id: 2, title: 'B', studentIds: [1, 5, 6] },
      period: { id: 1, start: '2025-06-02T09:30:00Z', end: '2025-06-02T11:30:00Z' },
      room: { id: 2, name: 'R2', capacity: 10, isolated: false, features: [] },
      placed: [
        { exam: { id: 1, title: 'A' }, period: { id: 1, start: '2025-06-02T09:00:00Z', end: '2025-06-02T11:00:00Z' }, room: { id: 1 }, proctor: null, studentIds: [1, 2, 3] },
      ],
    });
    expect(res.ok).toBe(false);
    expect(res.violations.some((v) => v.type === 'student_double_book')).toBe(true);
  });

  it('detects room capacity overflow', () => {
    const res = checkHardConstraints({
      exam: { id: 1, title: 'A', studentIds: [1, 2, 3, 4, 5, 6] },
      period: { id: 1, start: '2025-06-02T09:00:00Z', end: '2025-06-02T11:00:00Z' },
      room: { id: 1, name: 'R1', capacity: 4, isolated: false, features: [] },
      placed: [],
    });
    expect(res.ok).toBe(false);
    expect(res.violations.some((v) => v.type === 'room_capacity')).toBe(true);
  });

  it('detects room double-book in the same period', () => {
    const res = checkHardConstraints({
      exam: { id: 2, title: 'B', studentIds: [5] },
      period: { id: 1, start: '2025-06-02T09:00:00Z', end: '2025-06-02T11:00:00Z' },
      room: { id: 1, name: 'R1', capacity: 10, isolated: false, features: [] },
      placed: [
        { exam: { id: 1, title: 'A' }, period: { id: 1, start: '2025-06-02T09:00:00Z', end: '2025-06-02T11:00:00Z' }, room: { id: 1 }, proctor: null, studentIds: [1, 2, 3] },
      ],
    });
    expect(res.violations.some((v) => v.type === 'room_double_book')).toBe(true);
  });

  it('detects proctor double-book in the same period', () => {
    const res = checkHardConstraints({
      exam: { id: 2, title: 'B', studentIds: [5] },
      period: { id: 1, start: '2025-06-02T09:00:00Z', end: '2025-06-02T11:00:00Z' },
      room: { id: 2, name: 'R2', capacity: 10, isolated: false, features: [] },
      proctor: { id: 500, dailyLimit: 4 },
      placed: [
        { exam: { id: 1, title: 'A' }, period: { id: 1, start: '2025-06-02T09:00:00Z', end: '2025-06-02T11:00:00Z' }, room: { id: 1 }, proctor: { id: 500 }, studentIds: [1, 2, 3] },
      ],
    });
    expect(res.violations.some((v) => v.type === 'proctor_double_book')).toBe(true);
  });

  it('detects outside-window placement', () => {
    const res = checkHardConstraints({
      exam: { id: 1, title: 'A', studentIds: [1], window: { start: '2025-06-05T09:00:00Z', end: '2025-06-05T11:00:00Z' } },
      period: { id: 1, start: '2025-06-02T09:00:00Z', end: '2025-06-02T11:00:00Z' },
      room: { id: 1, name: 'R1', capacity: 10, isolated: false, features: [] },
      placed: [],
    });
    expect(res.violations.some((v) => v.type === 'outside_window')).toBe(true);
  });

  it('requires an isolated room for separate-room accommodation students', () => {
    const res = checkHardConstraints({
      exam: { id: 1, title: 'A', studentIds: [301], separateRoomStudentIds: [301] },
      period: { id: 1, start: '2025-06-02T09:00:00Z', end: '2025-06-02T11:00:00Z' },
      room: { id: 1, name: 'R1', capacity: 10, isolated: false, features: [] },
      placed: [],
    });
    expect(res.violations.some((v) => v.type === 'separate_room_violation')).toBe(true);

    const okRes = checkHardConstraints({
      exam: { id: 1, title: 'A', studentIds: [301], separateRoomStudentIds: [301] },
      period: { id: 1, start: '2025-06-02T09:00:00Z', end: '2025-06-02T11:00:00Z' },
      room: { id: 3, name: 'ISO-1', capacity: 1, isolated: true, features: [] },
      placed: [],
    });
    expect(okRes.ok).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════
// SOFT PENALTY MODEL (explainable)
// ═══════════════════════════════════════════════════════════════════

describe('Scheduler — soft penalty explainability', () => {
  it('every penalty item is explainable { type, weight, delta, reason }', () => {
    const res = evaluateSoftPenalties({
      exam: { id: 1, title: 'A', studentIds: [1, 2, 3], requiredFeatures: ['computers', 'power'] },
      period: { id: 1, start: '2025-06-02T09:00:00Z', end: '2025-06-02T11:00:00Z' },
      room: { id: 1, name: 'R1', capacity: 10, isolated: false, features: [] },
      placed: [],
      weights: DEFAULT_WEIGHTS,
    });
    for (const item of res.items) {
      expect(typeof item.type).toBe('string');
      expect(typeof item.weight).toBe('number');
      expect(typeof item.delta).toBe('number');
      expect(typeof item.reason).toBe('string');
      expect(item.reason.length).toBeGreaterThan(0);
    }
    expect(res.total).toBeGreaterThan(0); // feature mismatch should fire
  });

  it('back-to-back penalty fires for same-day adjacent exams', () => {
    const res = evaluateSoftPenalties({
      exam: { id: 2, title: 'B', studentIds: [1, 9] },
      period: { id: 2, start: '2025-06-02T13:00:00Z', end: '2025-06-02T15:00:00Z' },
      room: { id: 2, name: 'R2', capacity: 10, isolated: false, features: [] },
      placed: [
        { exam: { id: 1, title: 'A' }, period: { id: 1, start: '2025-06-02T09:00:00Z', end: '2025-06-02T11:00:00Z' }, room: { id: 1 }, proctor: null, studentIds: [1, 2, 3] },
      ],
      weights: DEFAULT_WEIGHTS,
    });
    expect(res.items.some((i) => i.type === 'back_to_back')).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════
// SOLVER — KNOWN FEASIBLE / INFEASIBLE FIXTURES
// ═══════════════════════════════════════════════════════════════════

describe('Scheduler — known feasible fixture', () => {
  it('places every exam with zero hard violations', () => {
    const solution = solveSchedule({
      exams: EXAMS_FEASIBLE,
      periods: PERIODS,
      rooms: ROOMS,
      proctors: PROCTORS,
      seed: 1,
    });
    expect(solution.assignments).toHaveLength(EXAMS_FEASIBLE.length);
    expect(solution.unscheduled).toHaveLength(0);
    expect(solution.violations).toHaveLength(0);
    expect(hasHardViolations(solution.violations, solution.unscheduled)).toBe(false);
  });

  it('is deterministic — same input + seed → identical assignments', () => {
    const a = solveSchedule({ exams: EXAMS_FEASIBLE, periods: PERIODS, rooms: ROOMS, proctors: PROCTORS, seed: 7 });
    const b = solveSchedule({ exams: EXAMS_FEASIBLE, periods: PERIODS, rooms: ROOMS, proctors: PROCTORS, seed: 7 });
    expect(a.assignments).toEqual(b.assignments);
  });

  it('produces explainable metrics (report)', () => {
    const solution = solveSchedule({ exams: EXAMS_FEASIBLE, periods: PERIODS, rooms: ROOMS, proctors: PROCTORS, seed: 1 });
    const m = solution.metrics;
    expect(m.examCount).toBe(4);
    expect(m.placedExamCount).toBe(4);
    expect(m.unscheduledCount).toBe(0);
    expect(m.explainable).toBe(true);
    expect(typeof m.softTotal).toBe('number');
    expect(m.softByType).toBeTruthy();
  });
});

describe('Scheduler — known infeasible fixture', () => {
  it('reports unscheduled exams + hard violations (never publishable)', () => {
    // 8 exams × 12 students, but only 2 usable rooms (R1=30, R2=25; ISO-1
    // capacity 1 can't host a 12-student exam) × 3 periods = 6 slots → at
    // least 2 exams cannot be placed → unscheduled + hard violation.
    const crowded = Array.from({ length: 8 }, (_, i) => ({
      id: 20 + i,
      title: `X${i + 1}`,
      studentIds: Array.from({ length: 12 }, (_, j) => 100 + i * 12 + j),
      separateRoomStudentIds: [],
      window: null,
      requiredFeatures: [],
    }));
    const solution = solveSchedule({ exams: crowded, periods: PERIODS, rooms: ROOMS, proctors: PROCTORS, seed: 1 });
    // Either unscheduled or violation — something MUST be flagged
    expect(solution.unscheduled.length + solution.violations.length).toBeGreaterThan(0);
    expect(hasHardViolations(solution.violations, solution.unscheduled)).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════
// WHAT-IF / PERTURBATION COMPARE
// ═══════════════════════════════════════════════════════════════════

describe('Scheduler — what-if move compare', () => {
  it('reports feasibility + soft delta for moving an exam to another period', () => {
    const solution = solveSchedule({ exams: EXAMS_FEASIBLE, periods: PERIODS, rooms: ROOMS, proctors: PROCTORS, seed: 1 });
    const first = solution.assignments[0];
    const otherPeriod = PERIODS.find((p) => p.id !== first.periodId);
    const result = computeWhatIfMove({
      exams: EXAMS_FEASIBLE,
      periods: PERIODS,
      rooms: ROOMS,
      proctors: PROCTORS,
      assignments: solution.assignments,
      examId: first.examId,
      targetPeriodId: otherPeriod.id,
    });
    expect(result.ok).toBe(true);
    expect(typeof result.feasible).toBe('boolean');
    if (result.feasible) {
      expect(typeof result.deltaSoft).toBe('number');
      expect(result.after.periodId).toBe(otherPeriod.id);
    }
  });

  it('errors when the exam is not in the schedule', () => {
    const result = computeWhatIfMove({
      exams: EXAMS_FEASIBLE,
      periods: PERIODS,
      rooms: ROOMS,
      proctors: PROCTORS,
      assignments: [],
      examId: 999,
      targetPeriodId: 1,
    });
    expect(result.ok).toBe(false);
    expect(result.error).toBeTruthy();
  });
});

// ═══════════════════════════════════════════════════════════════════
// VERSION LIFECYCLE
// ═══════════════════════════════════════════════════════════════════

describe('Scheduler — version lifecycle & publish gate', () => {
  it('allows draft → approved → published', () => {
    expect(validateScheduleTransition({ from: 'draft', to: 'approved' }).ok).toBe(true);
    expect(validateScheduleTransition({ from: 'approved', to: 'published', violations: [], unscheduled: [] }).ok).toBe(true);
  });

  it('BLOCKS publish when hard violations exist (§15)', () => {
    const gate = validateScheduleTransition({
      from: 'approved',
      to: 'published',
      violations: [{ type: 'room_capacity', detail: 'x' }],
      unscheduled: [],
    });
    expect(gate.ok).toBe(false);
    expect(gate.reason).toMatch(/hard violations/i);
  });

  it('BLOCKS invalid transitions (published is immutable except archive)', () => {
    expect(validateScheduleTransition({ from: 'draft', to: 'published' }).ok).toBe(false);
    expect(validateScheduleTransition({ from: 'published', to: 'draft' }).ok).toBe(false);
    expect(SCHEDULE_STATUS_TRANSITIONS.published).toEqual(['archived']);
  });
});
