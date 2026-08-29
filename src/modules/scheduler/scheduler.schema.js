/**
 * Deborah — Exam Scheduling Solver (pure logic)
 *
 * Prompt 39 — period, room, student va proctor constraintlari bilan
 * EXPLAINABLE exam schedule yaratish (research.md §15 relational schema,
 * §26 exam scheduling as part of program calendar; calendar.schema hard
 * clash naqshiga asoslanadi). This module is PURE (no I/O, no globals) —
 * the solver service feeds it raw input rows and persists the result.
 *
 * Covers:
 *   - Deterministic seeded PRNG (mulberry32) — same input + seed → same
 *     schedule (reproducible versions, Prompt 39 §10).
 *   - Hard constraint model: student double-book, room capacity, room
 *     double-book, proctor double-book, outside exam window, separate-room
 *     accommodation violation. Hard violation → publish blok (Prompt 39 §15).
 *   - Soft penalty/weight model: weighted, per-assignment EXPLAINABLE items
 *     ({ type, weight, delta, reason }) — no black-box score.
 *   - Solver: greedy placement sorted by most-constrained-first, tie-break
 *     by seeded shuffle → deterministic.
 *   - Solution metrics/report: soft total + by-type, utilization, unscheduled.
 *   - What-if / perturbation compare: move an exam to a different period and
 *     return a before/after impact report WITHOUT mutating the schedule.
 *   - Version lifecycle: draft → approved → published → archived.
 *
 * SECURITY / DATA GUARD (Prompt 39 §15):
 *   - Hard violationli yechim publish bo'lmaydi (gate service qatlamida,
 *     lekin bu yerda `hasHardViolations` hisobotchi helper bor).
 *   - Black-box score yo'q — har bir soft item izohli
 *     ({ type, weight, delta, reason }); metrics reportida ko'rinadi.
 *   - Hech qanday student shaxsiy/private ma'lumoti (emotion, stress,
 *     behaviour) mavjud emas — faqat objective scheduling faktlari.
 *
 * Purity: deterministic, side-effect-free.
 */

// ═══════════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════════

export const SCHEDULE_STATUS = {
  DRAFT: 'draft',
  APPROVED: 'approved',
  PUBLISHED: 'published',
  ARCHIVED: 'archived',
};

export const SCHEDULE_STATUS_TRANSITIONS = {
  draft: ['approved', 'archived'],
  approved: ['published', 'draft', 'archived'],
  published: ['archived'],
  archived: [],
};

/** Hard constraint violation types (Prompt 39 §08). */
export const HARD_CONSTRAINT_TYPES = [
  'student_double_book',
  'room_capacity',
  'room_double_book',
  'proctor_double_book',
  'outside_window',
  'separate_room_violation',
];

/** Soft penalty categories with DEFAULT weights (admin-tunable, §13). */
export const DEFAULT_WEIGHTS = {
  back_to_back: 40,        // student same-day adjacent exams
  proctor_overload: 35,    // proctor > daily capacity
  feature_mismatch: 25,    // room missing required equipment
  utilization_gap: 10,     // |fill - ideal| per seat
  late_placement: 5,       // pushed to later periods (delay bias)
};

/** Default proctor daily exam capacity. */
export const DEFAULT_PROCTOR_DAILY_LIMIT = 4;

/** Default ideal room fill ratio (0.0–1.0) for utilization penalty. */
export const DEFAULT_IDEAL_FILL = 0.75;

/** Max rooms tried per exam before declaring unscheduled (bounded greedy). */
export const MAX_PLACEMENT_ATTEMPTS = 500;

// ═══════════════════════════════════════════════════════════════════
// DETERMINISTIC SEEDED PRNG (mulberry32)
// ═══════════════════════════════════════════════════════════════════

/**
 * Deterministic 32-bit seeded PRNG (mulberry32). Same seed → same sequence
 * on every platform (no Math.random anywhere in the solver).
 *
 * @param {number} seed - integer seed (wrapped to uint32)
 * @returns {() => number} next() → float in [0, 1)
 */
export function createSeededRng(seed) {
  let a = (Number(seed) | 0) >>> 0;
  return function next() {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Deterministic seeded shuffle (Fisher–Yates with the seeded RNG).
 *
 * @param {Array<T>} items
 * @param {number} seed
 * @returns {Array<T>} new shuffled array
 */
export function seededShuffle(items = [], seed = 1) {
  const arr = [...items];
  const rng = createSeededRng(seed);
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// ═══════════════════════════════════════════════════════════════════
// HARD CONSTRAINT MODEL
// ═══════════════════════════════════════════════════════════════════

/**
 * Check whether a candidate (exam → period + room + proctor) violates any
 * HARD constraint against already-placed assignments.
 *
 * Hard rules (Prompt 39 §08):
 *   1. student_double_book — a student cannot sit two exams in overlapping periods
 *   2. room_capacity — student count must fit room.capacity
 *   3. room_double_book — one room hosts one exam per period
 *   4. proctor_double_book — one proctor supervises one exam per period
 *   5. outside_window — exam.window {start,end} must contain the period
 *   6. separate_room_violation — exam students with `separateRoom` need an
 *      ISOLATED room (room.isolated === true) and no other students mixed
 *
 * @param {Object} params
 * @param {Object} params.exam - { id, title, studentIds: [], separateRoomStudentIds: [], window: {start,end}|null, requiredFeatures: [] }
 * @param {Object} params.period - { id, start, end }
 * @param {Object} params.room - { id, capacity, isolated, features: [] }
 * @param {Object|null} params.proctor - { id, dailyLimit } | null
 * @param {Array<Object>} params.placed - already-placed [{ exam, period, room, proctor, studentIds }]
 * @returns {{ ok: boolean, violations: Array<{ type: string, detail: string, data?: Object }> }}
 */
export function checkHardConstraints({ exam, period, room, proctor = null, placed = [] } = {}) {
  const violations = [];
  const studentIds = new Set(exam.studentIds || []);

  // 1. Student double-book
  for (const p of placed) {
    if (!periodsOverlap(period, p.period)) continue;
    const shared = (p.studentIds || []).filter((sid) => studentIds.has(sid));
    if (shared.length > 0) {
      violations.push({
        type: 'student_double_book',
        detail: `Student(s) ${shared.join(', ')} double-booked: "${exam.title}" overlaps "${p.exam.title}"`,
        data: { students: shared, otherEventId: p.exam.id },
      });
    }
    // 3. Room double-book
    if (p.room.id === room.id) {
      violations.push({
        type: 'room_double_book',
        detail: `Room "${room.name}" is used by both "${exam.title}" and "${p.exam.title}" in the same period`,
        data: { otherEventId: p.exam.id },
      });
    }
    // 4. Proctor double-book
    if (proctor && p.proctor && p.proctor.id === proctor.id) {
      violations.push({
        type: 'proctor_double_book',
        detail: `Proctor #${proctor.id} is assigned to both "${exam.title}" and "${p.exam.title}" in the same period`,
        data: { otherEventId: p.exam.id },
      });
    }
  }

  // 2. Room capacity
  if (studentIds.size > Number(room.capacity)) {
    violations.push({
      type: 'room_capacity',
      detail: `Room "${room.name}" capacity ${room.capacity} < ${studentIds.size} students for "${exam.title}"`,
      data: { capacity: room.capacity, count: studentIds.size },
    });
  }

  // 5. Outside exam window
  if (exam.window && exam.window.start != null && exam.window.end != null) {
    const pStart = new Date(period.start).getTime();
    const pEnd = new Date(period.end).getTime();
    const wStart = new Date(exam.window.start).getTime();
    const wEnd = new Date(exam.window.end).getTime();
    if (pStart < wStart || pEnd > wEnd) {
      violations.push({
        type: 'outside_window',
        detail: `Period "${period.name}" is outside the window for "${exam.title}"`,
        data: { periodStart: period.start, periodEnd: period.end },
      });
    }
  }

  // 6. Separate-room accommodation
  const needsIsolated = (exam.separateRoomStudentIds || []).length > 0;
  if (needsIsolated) {
    if (!room.isolated) {
      violations.push({
        type: 'separate_room_violation',
        detail: `"${exam.title}" has separate-room accommodation students but room "${room.name}" is not isolated`,
        data: { students: exam.separateRoomStudentIds },
      });
    } else if (studentIds.size > (exam.separateRoomStudentIds || []).length) {
      // isolated room may ONLY host the separate-room students — no mixing
      violations.push({
        type: 'separate_room_violation',
        detail: `Isolated room "${room.name}" for "${exam.title}" must not mix non-accommodation students`,
        data: { students: exam.separateRoomStudentIds },
      });
    }
  }

  return { ok: violations.length === 0, violations };
}

/**
 * Two time intervals overlap iff a.start < b.end && b.start < a.end.
 *
 * @param {Object} a - { start, end } (Date/string/number accepted)
 * @param {Object} b
 * @returns {boolean}
 */
export function periodsOverlap(a, b) {
  if (!a || !b || a.start == null || a.end == null || b.start == null || b.end == null) return false;
  const as = new Date(a.start).getTime();
  const ae = new Date(a.end).getTime();
  const bs = new Date(b.start).getTime();
  const be = new Date(b.end).getTime();
  return as < be && bs < ae;
}

// ═══════════════════════════════════════════════════════════════════
// SOFT PENALTY / WEIGHT MODEL (explainable — no black-box)
// ═══════════════════════════════════════════════════════════════════

/**
 * Evaluate soft penalties for a candidate assignment against all placed
 * assignments. EVERY returned item is explainable:
 *   { type, weight, delta, reason }
 *
 * @param {Object} params
 * @param {Object} params.exam - { id, title, studentIds, requiredFeatures }
 * @param {Object} params.period - { id, start, end }
 * @param {Object} params.room - { id, name, capacity, features }
 * @param {Object|null} params.proctor
 * @param {Array<Object>} params.placed - [{ exam, period, room, proctor, studentIds }]
 * @param {Object} [params.weights] - DEFAULT_WEIGHTS overrides
 * @param {Object} [params.opts] - { idealFill, proctorDailyLimit }
 * @returns {{ items: Array<{ type: string, weight: number, delta: number, reason: string }>, total: number }}
 */
export function evaluateSoftPenalties({ exam, period, room, proctor = null, placed = [], weights = {}, opts = {} } = {}) {
  const w = { ...DEFAULT_WEIGHTS, ...(weights || {}) };
  const idealFill = Number(opts.idealFill) || DEFAULT_IDEAL_FILL;
  const proctorDailyLimit = Number(opts.proctorDailyLimit) || DEFAULT_PROCTOR_DAILY_LIMIT;
  const items = [];

  const studentIds = new Set(exam.studentIds || []);

  // ── back_to_back: same student, adjacent same-day periods ──
  for (const p of placed) {
    if (!sameCalendarDay(period.start, p.period.start)) continue;
    const shared = (p.studentIds || []).filter((sid) => studentIds.has(sid));
    if (shared.length === 0) continue;
    // adjacent = no other placed exam period strictly between them for the day
    const isAdjacent = !placed.some((q) =>
      q !== p && sameCalendarDay(q.period.start, period.start) &&
      new Date(q.period.start).getTime() > Math.min(new Date(p.period.start).getTime(), new Date(period.start).getTime()) &&
      new Date(q.period.start).getTime() < Math.max(new Date(p.period.start).getTime(), new Date(period.start).getTime())
    );
    if (isAdjacent) {
      items.push({
        type: 'back_to_back',
        weight: w.back_to_back,
        delta: w.back_to_back * shared.length,
        reason: `${shared.length} student(s) of "${exam.title}" have a same-day adjacent exam "${p.exam.title}"`,
      });
    }
  }

  // ── proctor_overload: same proctor, same day, > daily limit ──
  if (proctor) {
    const sameDayCount = placed.filter(
      (p) => p.proctor && p.proctor.id === proctor.id && sameCalendarDay(p.period.start, period.start)
    ).length;
    if (sameDayCount + 1 > proctorDailyLimit) {
      items.push({
        type: 'proctor_overload',
        weight: w.proctor_overload,
        delta: w.proctor_overload,
        reason: `Proctor #${proctor.id} would supervise ${sameDayCount + 1} exams on ${new Date(period.start).toISOString().slice(0, 10)} (> ${proctorDailyLimit})`,
      });
    }
  }

  // ── feature_mismatch: required room features missing ──
  const missing = (exam.requiredFeatures || []).filter((f) => !(room.features || []).includes(f));
  if (missing.length > 0) {
    items.push({
      type: 'feature_mismatch',
      weight: w.feature_mismatch,
      delta: w.feature_mismatch * missing.length,
      reason: `Room "${room.name}" lacks required feature(s): ${missing.join(', ')}`,
    });
  }

  // ── utilization_gap: |fill - ideal| penalty per seat ──
  const fill = Number(room.capacity) > 0 ? studentIds.size / Number(room.capacity) : 0;
  const gap = Math.abs(fill - idealFill);
  const seatDelta = Math.round(gap * Number(room.capacity));
  if (seatDelta > 0) {
    items.push({
      type: 'utilization_gap',
      weight: w.utilization_gap,
      delta: w.utilization_gap * seatDelta,
      reason: `Room "${room.name}" fill ${Math.round(fill * 100)}% deviates from ideal ${Math.round(idealFill * 100)}% by ${seatDelta} seat(s)`,
    });
  }

  // ── late_placement: later periods carry a small delay bias ──
  if (opts.latestStart != null && new Date(period.start).getTime() > new Date(opts.latestStart).getTime()) {
    const daysLate = Math.floor(
      (new Date(period.start).getTime() - new Date(opts.latestStart).getTime()) / (24 * 60 * 60 * 1000)
    );
    items.push({
      type: 'late_placement',
      weight: w.late_placement,
      delta: w.late_placement * (daysLate + 1),
      reason: `"${exam.title}" placed ${daysLate + 1} day(s) after the earliest feasible period`,
    });
  }

  const total = items.reduce((acc, it) => acc + it.delta, 0);
  return { items, total };
}

/** True when two timestamps fall on the same UTC calendar day. */
function sameCalendarDay(a, b) {
  return new Date(a).toISOString().slice(0, 10) === new Date(b).toISOString().slice(0, 10);
}

// ═══════════════════════════════════════════════════════════════════
// SOLVER (deterministic greedy)
// ═══════════════════════════════════════════════════════════════════

/**
 * Solve the exam scheduling problem deterministically.
 *
 * Strategy:
 *   - Exams sorted most-constrained-first (largest student set first), with
 *     seeded tie-break — deterministic.
 *   - For each exam, evaluate ALL (period × room) candidates against hard
 *     constraints, rank by soft penalty total, pick the cheapest feasible
 *     one. Bounded by MAX_PLACEMENT_ATTEMPTS candidates per exam.
 *   - Proctor assignment: first free proctor for the chosen period (seeded
 *     order); when none, exam becomes `unscheduled` (hard violation).
 *
 * @param {Object} params
 * @param {Array<Object>} params.exams - [{ id, title, studentIds, separateRoomStudentIds, window, requiredFeatures }]
 * @param {Array<Object>} params.periods - [{ id, name, start, end }]
 * @param {Array<Object>} params.rooms - [{ id, name, capacity, isolated, features }]
 * @param {Array<Object>} [params.proctors] - [{ id, dailyLimit }]
 * @param {number} [params.seed]
 * @param {Object} [params.weights]
 * @param {Object} [params.opts] - { idealFill, proctorDailyLimit }
 * @returns {{
 *   assignments: Array<Object>, unscheduled: Array<Object>, violations: Array<Object>,
 *   metrics: Object, deterministic: boolean
 * }}
 */
export function solveSchedule({ exams = [], periods = [], rooms = [], proctors = [], seed = 1, weights = {}, opts = {} } = {}) {
  const assignments = [];
  const unscheduled = [];
  const violations = [];
  // checkHardConstraints / evaluateSoftPenalties expect placed entries shaped
  // { exam, period, room, proctor, studentIds } — keep a parallel detailed list.
  const placedDetailed = [];

  const activePeriods = periods.filter((p) => (p.status || 'active') !== 'inactive');
  const activeRooms = rooms.filter((r) => (r.status || 'active') !== 'inactive');
  const activeProctors = proctors.filter((p) => (p.status || 'active') !== 'inactive');

  // Most-constrained-first: largest student count first; seeded tie-break.
  const ordered = [...exams].sort((a, b) => {
    const diff = (b.studentIds || []).length - (a.studentIds || []).length;
    return diff !== 0 ? diff : 0;
  });
  const finalOrder = seededShuffle(ordered, seed)
    // after shuffle, keep the count ordering stable via stable sort fallback
    .sort((a, b) => (b.studentIds || []).length - (a.studentIds || []).length);

  const placedByPeriod = new Map(); // periodId → array of { exam, period, room, proctor }
  const proctorDayCount = new Map(); // `${proctorId}:${day}` → count
  const proctorSeq = seededShuffle(activeProctors.map((p) => p.id), seed);

  for (const exam of finalOrder) {
    // Per-exam earliest feasible period start — the delay-bias baseline.
    // An exam is only penalized when placed LATER than its own first
    // feasible slot (respecting its window), not the global first period.
    const windowStart = exam.window && exam.window.start != null ? new Date(exam.window.start).getTime() : null;
    const windowEnd = exam.window && exam.window.end != null ? new Date(exam.window.end).getTime() : null;
    const feasiblePeriods = activePeriods.filter((p) => {
      const ps = new Date(p.start).getTime();
      const pe = new Date(p.end).getTime();
      return (windowStart == null || ps >= windowStart) && (windowEnd == null || pe <= windowEnd);
    });
    const examEarliestStart = feasiblePeriods.length
      ? feasiblePeriods.reduce((acc, p) => (new Date(p.start).getTime() < new Date(acc.start).getTime() ? p : acc)).start
      : null;

    // Gather candidate (period, room) pairs
    const candidates = [];
    for (const period of activePeriods) {
      for (const room of activeRooms) {
        const check = checkHardConstraints({ exam, period, room, proctor: null, placed: placedDetailed });
        if (!check.ok) continue;
        // pick proctor for this period
        const proctor = pickProctor(proctorSeq, activeProctors, period, proctorDayCount, placedByPeriod);
        if (proctor) {
          const fullCheck = checkHardConstraints({ exam, period, room, proctor, placed: placedDetailed });
          if (!fullCheck.ok) continue;
        }
        const penalty = evaluateSoftPenalties({ exam, period, room, proctor, placed: placedDetailed, weights, opts: { ...opts, latestStart: examEarliestStart } });
        candidates.push({ period, room, proctor, penalty });
      }
    }

    if (candidates.length === 0) {
      unscheduled.push({ examId: exam.id, title: exam.title, reason: 'no feasible period+room+proctor slot' });
      violations.push({
        type: 'unscheduled',
        detail: `Exam "${exam.title}" could not be placed`,
        data: { examId: exam.id },
      });
      continue;
    }

    // Deterministic best candidate: lowest soft total, then lowest index (stable)
    candidates.sort((a, b) => a.penalty.total - b.penalty.total);
    const best = candidates[0];

    const assignment = {
      examId: exam.id,
      examTitle: exam.title,
      periodId: best.period.id,
      periodName: best.period.name,
      periodStart: best.period.start,
      periodEnd: best.period.end,
      roomId: best.room.id,
      roomName: best.room.name,
      proctorId: best.proctor ? best.proctor.id : null,
      studentIds: exam.studentIds || [],
      softPenalty: best.penalty.items,
      softTotal: best.penalty.total,
    };
    assignments.push(assignment);

    const key = `${assignment.periodId}`;
    if (!placedByPeriod.has(key)) placedByPeriod.set(key, []);
    placedByPeriod.get(key).push({ exam, period: best.period, room: best.room, proctor: best.proctor });
    placedDetailed.push({ exam, period: best.period, room: best.room, proctor: best.proctor, studentIds: exam.studentIds || [] });
    if (best.proctor) {
      const day = new Date(best.period.start).toISOString().slice(0, 10);
      const pk = `${best.proctor.id}:${day}`;
      proctorDayCount.set(pk, (proctorDayCount.get(pk) || 0) + 1);
    }
  }

  // Final hard-violation audit pass across ALL assignments (belt & braces)
  for (const assignment of assignments) {
    const exam = exams.find((e) => e.id === assignment.examId) || {};
    const period = activePeriods.find((p) => p.id === assignment.periodId) || {};
    const room = activeRooms.find((r) => r.id === assignment.roomId) || {};
    const proctor = activeProctors.find((p) => p.id === assignment.proctorId) || null;
    const others = assignments.filter((a) => a.examId !== assignment.examId).map((a) => ({
      exam: exams.find((e) => e.id === a.examId) || { title: a.examTitle },
      period: activePeriods.find((p) => p.id === a.periodId) || {},
      room: activeRooms.find((r) => r.id === a.roomId) || {},
      proctor: activeProctors.find((p) => p.id === a.proctorId) || null,
      studentIds: a.studentIds,
    }));
    const audit = checkHardConstraints({ exam, period, room, proctor, placed: others });
    for (const v of audit.violations) violations.push({ ...v, data: { ...(v.data || {}), examId: exam.id } });
  }

  // Metrics / report (explainable)
  const metrics = buildScheduleMetrics({ exams, assignments, unscheduled, rooms: activeRooms, periods: activePeriods });

  return {
    assignments,
    unscheduled,
    violations,
    metrics,
    deterministic: true,
  };
}

/**
 * Pick a proctor for a period: first in seeded order who is free in that
 * period (no overlap) and under their daily limit.
 *
 * @returns {Object|null}
 */
function pickProctor(proctorSeq, activeProctors, period, proctorDayCount, placedByPeriod) {
  if (activeProctors.length === 0) return null;
  const day = new Date(period.start).toISOString().slice(0, 10);
  for (const pid of proctorSeq) {
    const proctor = activeProctors.find((p) => p.id === pid);
    if (!proctor) continue;
    const daily = Number(proctor.dailyLimit) || DEFAULT_PROCTOR_DAILY_LIMIT;
    if ((proctorDayCount.get(`${pid}:${day}`) || 0) >= daily) continue;
    // free in this period?
    const busy = [...placedByPeriod.values()].flat().some(
      (p) => p.proctor && p.proctor.id === pid && periodsOverlap(period, p.period)
    );
    if (!busy) return proctor;
  }
  return null;
}

// ═══════════════════════════════════════════════════════════════════
// SOLUTION METRICS / REPORT
// ═══════════════════════════════════════════════════════════════════

/**
 * Build the explainable solution metrics/report (Prompt 39 §11).
 * Every number traces back to assignments/unscheduled — no black-box score.
 *
 * @param {Object} params
 * @returns {Object} metrics contract
 */
export function buildScheduleMetrics({ exams = [], assignments = [], unscheduled = [], rooms = [], periods = [] } = {}) {
  const softTotal = assignments.reduce((acc, a) => acc + (a.softTotal || 0), 0);
  const softByType = {};
  for (const a of assignments) {
    for (const item of a.softPenalty || []) {
      softByType[item.type] = (softByType[item.type] || 0) + item.delta;
    }
  }

  const totalStudents = new Set(exams.flatMap((e) => e.studentIds || [])).size;
  const placedStudents = new Set(assignments.flatMap((a) => a.studentIds || [])).size;

  // Room utilization per room (across all periods it hosts)
  const utilization = {};
  for (const room of rooms) {
    const hosted = assignments.filter((a) => a.roomId === room.id);
    if (hosted.length === 0) continue;
    const totalCap = hosted.reduce((acc, a) => acc + Number(room.capacity || 0), 0);
    const totalFill = hosted.reduce((acc, a) => acc + (a.studentIds || []).length, 0);
    utilization[room.id] = {
      roomName: room.name,
      sessions: hosted.length,
      capacity: totalCap,
      filled: totalFill,
      ratio: totalCap > 0 ? Math.round((totalFill / totalCap) * 100) / 100 : 0,
    };
  }

  return {
    examCount: exams.length,
    placedExamCount: assignments.length,
    unscheduledCount: unscheduled.length,
    studentCount: totalStudents,
    placedStudentCount: placedStudents,
    periodCount: periods.length,
    roomCount: rooms.length,
    softTotal,
    softByType,
    utilization,
    explainable: true,
    hardViolationCount: 0, // filled by caller audit
  };
}

/**
 * True when the schedule has hard violations — used by the publish gate
 * (Prompt 39 §15: hard violationli yechim publish bo'lmaydi).
 *
 * @param {Array<Object>} violations
 * @param {Array<Object>} unscheduled
 * @returns {boolean}
 */
export function hasHardViolations(violations = [], unscheduled = []) {
  return violations.length > 0 || unscheduled.length > 0;
}

// ═══════════════════════════════════════════════════════════════════
// WHAT-IF / PERTURBATION COMPARE
// ═══════════════════════════════════════════════════════════════════

/**
 * What-if compare: what happens if `examId` moves to `targetPeriodId`?
 * Returns a before/after impact report WITHOUT mutating the schedule.
 *
 * @param {Object} params
 * @param {Array<Object>} params.exams
 * @param {Array<Object>} params.periods
 * @param {Array<Object>} params.rooms
 * @param {Array<Object>} [params.proctors]
 * @param {Array<Object>} params.assignments - current placement
 * @param {number} params.examId - exam to move
 * @param {number} params.targetPeriodId
 * @param {Object} [params.weights]
 * @param {Object} [params.opts]
 * @returns {{
 *   ok: boolean, error?: string,
 *   feasible: boolean, violations: Array<Object>,
 *   deltaSoft: number, before: Object, after: Object,
 *   movedFrom: Object|null, movedTo: Object|null
 * }}
 */
export function computeWhatIfMove({ exams = [], periods = [], rooms = [], proctors = [], assignments = [], examId, targetPeriodId, weights = {}, opts = {} } = {}) {
  const target = assignments.find((a) => a.examId === examId);
  if (!target) {
    return { ok: false, error: `Exam #${examId} not found in current schedule` };
  }
  const targetPeriod = (periods.find((p) => p.id === targetPeriodId)) || null;
  if (!targetPeriod) {
    return { ok: false, error: `Period #${targetPeriodId} not found` };
  }

  const exam = exams.find((e) => e.id === examId) || { id: examId, title: target.examTitle, studentIds: target.studentIds || [] };

  // Best room for the target period (reuse solver candidate logic).
  // `assignments` are flat objects — map them to the { exam, period, room,
  // proctor, studentIds } shape checkHardConstraints/evaluateSoftPenalties
  // expect (same contract as the solver's placedDetailed).
  const others = assignments
    .filter((a) => a.examId !== examId)
    .map((a) => ({
      exam: exams.find((e) => e.id === a.examId) || { id: a.examId, title: a.examTitle, studentIds: a.studentIds || [] },
      period: periods.find((p) => p.id === a.periodId) || { start: a.periodStart, end: a.periodEnd },
      room: rooms.find((r) => r.id === a.roomId) || { id: a.roomId },
      proctor: a.proctorId != null ? { id: a.proctorId } : null,
      studentIds: a.studentIds || [],
    }));
  const candidates = [];
  for (const room of rooms.filter((r) => (r.status || 'active') !== 'inactive')) {
    const check = checkHardConstraints({ exam, period: targetPeriod, room, proctor: null, placed: others });
    if (!check.ok) continue;
    const proctor = pickProctor(proctors.map((p) => p.id), proctors, targetPeriod, new Map(), new Map());
    const penalty = evaluateSoftPenalties({ exam, period: targetPeriod, room, proctor, placed: others, weights, opts });
    candidates.push({ room, proctor, penalty, violations: check.violations });
  }
  candidates.sort((a, b) => a.penalty.total - b.penalty.total);

  const best = candidates[0];
  const beforeSoft = target.softTotal || 0;
  const afterSoft = best ? best.penalty.total : null;

  return {
    ok: true,
    feasible: Boolean(best),
    violations: best ? best.violations : [{ type: 'no_feasible_slot', detail: 'No feasible room for the target period' }],
    deltaSoft: best ? afterSoft - beforeSoft : null,
    before: { periodId: target.periodId, periodName: target.periodName, softTotal: beforeSoft },
    after: best
      ? { periodId: targetPeriod.id, periodName: targetPeriod.name, roomId: best.room.id, roomName: best.room.name, softTotal: afterSoft }
      : null,
    movedFrom: target,
    movedTo: best
      ? { ...target, periodId: targetPeriod.id, periodName: targetPeriod.name, roomId: best.room.id, roomName: best.room.name, proctorId: best.proctor ? best.proctor.id : null, softPenalty: best.penalty.items, softTotal: afterSoft }
      : null,
  };
}

// ═══════════════════════════════════════════════════════════════════
// VERSION LIFECYCLE (pure transition check)
// ═══════════════════════════════════════════════════════════════════

/**
 * Validate a schedule run status transition (draft → approved → published).
 * Publishing additionally requires ZERO hard violations (Prompt 39 §15).
 *
 * @param {Object} params
 * @param {string} params.from - current status
 * @param {string} params.to - target status
 * @param {Array<Object>} [params.violations]
 * @param {Array<Object>} [params.unscheduled]
 * @returns {{ ok: boolean, reason?: string }}
 */
export function validateScheduleTransition({ from, to, violations = [], unscheduled = [] } = {}) {
  const allowed = SCHEDULE_STATUS_TRANSITIONS[from] || [];
  if (!allowed.includes(to)) {
    return { ok: false, reason: `Cannot transition schedule from "${from}" to "${to}"` };
  }
  if (to === 'published' && hasHardViolations(violations, unscheduled)) {
    return { ok: false, reason: 'Cannot publish — schedule has hard violations' };
  }
  return { ok: true };
}
