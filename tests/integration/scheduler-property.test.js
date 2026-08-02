/**
 * Edikit — Integration Tests: Exam Scheduling Solver Property Tests (Prompt 39)
 *
 * Hard-constraint property testing (Prompt 39 §19):
 *   - For many SEEDED random instances (deterministic PRNG), the solver's
 *     placements are ALWAYS internally consistent: independently re-checking
 *     every assignment (capacity, student/room/proctor double-book, window,
 *     separate-room isolation) yields ZERO hidden violations.
 *   - Deterministic reproducibility: same seed + same instance → identical
 *     schedule (reproducible versions).
 *   - Reported violations are complete — no violation exists that the report
 *     does not contain.
 *   - Soft penalty items are always explainable ({ type, weight, delta,
 *     reason }) — no black-box score.
 *   - Publish gate contract: hasHardViolations exactly matches violations/
 *     unscheduled presence; validateScheduleTransition blocks publish.
 *
 * HTTP contract (graceful degradation without PostgreSQL):
 *   - /api/admin/scheduler/* endpoints require admin (401/403 unauthenticated)
 *   - /admin/scheduler page redirects to /admin/login without a session
 *   - With a real admin session: meta 200; POST /run → 400 { error:
 *     'PostgreSQL required' } — the DB write path degrades gracefully.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createApp } from '../../server.js';
import CONFIG from '../../src/config/env.js';
import { createRequest, snapshotDb, restoreDb } from '../helpers/setup.js';
import {
  createSeededRng,
  seededShuffle,
  periodsOverlap,
  solveSchedule,
  hasHardViolations,
  validateScheduleTransition,
  DEFAULT_WEIGHTS,
} from '../../src/modules/scheduler/index.js';

// ═══════════════════════════════════════════════════════════════════
// DETERMINISTIC INSTANCE GENERATOR (seeded — property testing)
// ═══════════════════════════════════════════════════════════════════

const STUDENT_POOL = Array.from({ length: 40 }, (_, i) => 1000 + i);

/**
 * Build a deterministic random scheduling instance from a seed.
 * Same seed → identical instance on every platform.
 */
function genInstance(seed) {
  const rng = createSeededRng(seed);
  const ri = (n) => Math.floor(rng() * n);

  // 4 rooms: last one is ISOLATED (separate-room accommodation)
  const rooms = Array.from({ length: 4 }, (_, i) => ({
    id: i + 1,
    name: `R-${i + 1}`,
    capacity: 8 + ri(18), // 8..25
    isolated: i === 3,
    features: i === 1 ? ['computers'] : [],
    status: 'active',
  }));

  // 3 non-overlapping periods
  const periods = [
    { id: 1, name: 'P1', start: '2025-06-02T09:00:00Z', end: '2025-06-02T11:00:00Z', status: 'active' },
    { id: 2, name: 'P2', start: '2025-06-02T14:00:00Z', end: '2025-06-02T16:00:00Z', status: 'active' },
    { id: 3, name: 'P3', start: '2025-06-03T09:00:00Z', end: '2025-06-03T11:00:00Z', status: 'active' },
  ];

  const proctors = [
    { id: 500, dailyLimit: 4, status: 'active' },
    { id: 501, dailyLimit: 4, status: 'active' },
  ];

  const exams = Array.from({ length: 6 }, (_, i) => {
    const separate = i === 4; // one exam needs an isolated room
    // 2..16 students so capacity is sometimes binding (rooms 8..25)
    const full = seededShuffle(STUDENT_POOL, seed * 10 + i).slice(0, 2 + ri(15));
    // Separate-room exam: the ONLY students are the accommodation students
    // (mixing is a hard violation) — matches the unit-test fixture shape.
    const studentIds = separate ? full.slice(0, 1) : full;
    return {
      id: 100 + i,
      title: `Exam ${i + 1}`,
      studentIds,
      separateRoomStudentIds: separate ? studentIds.slice() : [],
      // one exam restricted to the first period (window)
      window: i === 5 ? { start: periods[0].start, end: periods[0].end } : null,
      requiredFeatures: i === 2 ? ['computers'] : [],
    };
  });

  return { rooms, periods, proctors, exams };
}

/**
 * INDEPENDENT re-verification of a solution — does NOT use the solver's own
 * audit pass. Re-checks every assignment structurally:
 *   capacity, room double-book, proctor double-book, student double-book
 *   (overlapping periods), window containment, separate-room isolation.
 */
function independentlyVerify(instance, solution) {
  const problems = [];
  const roomsById = new Map(instance.rooms.map((r) => [r.id, r]));
  const periodsById = new Map(instance.periods.map((p) => [p.id, p]));
  const examsById = new Map(instance.exams.map((e) => [e.id, e]));

  for (const a of solution.assignments) {
    const room = roomsById.get(a.roomId);
    const period = periodsById.get(a.periodId);
    const exam = examsById.get(a.examId) || {};

    // capacity
    if (a.studentIds.length > room.capacity) {
      problems.push({ type: 'capacity', examId: a.examId, detail: `${a.studentIds.length} > ${room.capacity}` });
    }
    // room double-book (same period + same room)
    if (solution.assignments.some((x) => x.examId !== a.examId && x.periodId === a.periodId && x.roomId === a.roomId)) {
      problems.push({ type: 'room_double_book', examId: a.examId });
    }
    // proctor double-book (same period + same proctor)
    if (a.proctorId != null && solution.assignments.some((x) => x.examId !== a.examId && x.periodId === a.periodId && x.proctorId === a.proctorId)) {
      problems.push({ type: 'proctor_double_book', examId: a.examId });
    }
    // exam window containment
    if (exam.window && (new Date(period.start) < new Date(exam.window.start) || new Date(period.end) > new Date(exam.window.end))) {
      problems.push({ type: 'outside_window', examId: a.examId });
    }
    // separate-room isolation
    if ((exam.separateRoomStudentIds || []).length > 0) {
      if (!room.isolated || a.studentIds.length !== exam.separateRoomStudentIds.length) {
        problems.push({ type: 'separate_room_violation', examId: a.examId });
      }
    }
    // student double-book across overlapping periods
    for (const x of solution.assignments) {
      if (x.examId === a.examId) continue;
      const xp = periodsById.get(x.periodId);
      if (!periodsOverlap(period, xp)) continue;
      const shared = a.studentIds.filter((s) => x.studentIds.includes(s));
      if (shared.length > 0) {
        problems.push({ type: 'student_double_book', examId: a.examId, other: x.examId, students: shared });
      }
    }
  }
  return problems;
}

// ═══════════════════════════════════════════════════════════════════
// PROPERTY TESTS (seeded instances 1..12)
// ═══════════════════════════════════════════════════════════════════

const SEEDS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];

describe('Scheduler property — placements are always internally consistent', () => {
  for (const seed of SEEDS) {
    it(`seed ${seed}: independent re-check finds ZERO hidden violations`, () => {
      const instance = genInstance(seed);
      const solution = solveSchedule({ ...instance, seed });
      expect(independentlyVerify(instance, solution)).toEqual([]);
    });

    it(`seed ${seed}: reported violations are complete (only unscheduled when placements clean)`, () => {
      const instance = genInstance(seed);
      const solution = solveSchedule({ ...instance, seed });
      // Since placements are always clean, the ONLY violation type the solver
      // may report is 'unscheduled' — nothing hidden or fabricated.
      for (const v of solution.violations) {
        expect(v.type).toBe('unscheduled');
      }
      // Consistency: hasHardViolations exactly matches reported state
      expect(hasHardViolations(solution.violations, solution.unscheduled)).toBe(
        solution.violations.length > 0 || solution.unscheduled.length > 0
      );
      // Publish gate contract
      const gate = validateScheduleTransition({
        from: 'approved',
        to: 'published',
        violations: solution.violations,
        unscheduled: solution.unscheduled,
      });
      if (hasHardViolations(solution.violations, solution.unscheduled)) {
        expect(gate.ok).toBe(false);
      } else {
        expect(gate.ok).toBe(true);
      }
    });
  }
});

describe('Scheduler property — deterministic reproducibility', () => {
  it('same seed + same instance → byte-identical schedule (all seeds)', () => {
    for (const seed of SEEDS) {
      const instance = genInstance(seed);
      const a = solveSchedule({ ...instance, seed });
      const b = solveSchedule({ ...instance, seed });
      expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    }
  });

  it('different seed may yield a different schedule but never an inconsistent one', () => {
    for (const seed of SEEDS) {
      const instance = genInstance(seed);
      const a = solveSchedule({ ...instance, seed: 1 });
      const b = solveSchedule({ ...instance, seed: seed + 100 });
      expect(independentlyVerify(instance, a)).toEqual([]);
      expect(independentlyVerify(instance, b)).toEqual([]);
    }
  });
});

describe('Scheduler property — every soft penalty is explainable', () => {
  it('all softPenalty items carry { type, weight, delta, reason } with non-empty reason', () => {
    for (const seed of SEEDS) {
      const instance = genInstance(seed);
      const solution = solveSchedule({ ...instance, seed, weights: DEFAULT_WEIGHTS });
      for (const a of solution.assignments) {
        for (const item of a.softPenalty) {
          expect(typeof item.type).toBe('string');
          expect(typeof item.weight).toBe('number');
          expect(typeof item.delta).toBe('number');
          expect(typeof item.reason).toBe('string');
          expect(item.reason.length).toBeGreaterThan(0);
        }
        // softTotal equals the sum of item deltas (no hidden score)
        const sum = a.softPenalty.reduce((acc, it) => acc + it.delta, 0);
        expect(a.softTotal).toBe(sum);
      }
      // metrics report is explainable
      expect(solution.metrics.explainable).toBe(true);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════
// HTTP CONTRACT (graceful degradation without PostgreSQL)
// ═══════════════════════════════════════════════════════════════════

let app;
let httpServer;

beforeAll(async () => {
  snapshotDb();
  const result = await createApp();
  app = result.app;
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

function extractCsrfToken(html) {
  const match = html.match(/name="_csrf"\s+value="([^"]+)"/);
  return match ? match[1] : null;
}

describe('Scheduler HTTP — ACL (admin only)', () => {
  it('GET meta without session → 401 JSON', async () => {
    const req = await createRequest();
    const res = await req.get('/api/admin/scheduler/meta');
    expect([401, 403]).toContain(res.status);
  });

  it('POST run without session → 401/403 (CSRF-first)', async () => {
    const req = await createRequest();
    const res = await req.post('/api/admin/scheduler/run').send({ title: 'x' });
    expect([401, 403]).toContain(res.status);
  });

  it('GET rooms without session → 401', async () => {
    const req = await createRequest();
    const res = await req.get('/api/admin/scheduler/rooms');
    expect([401, 403]).toContain(res.status);
  });

  it('PUT weights without session → 401/403', async () => {
    const req = await createRequest();
    const res = await req.put('/api/admin/scheduler/weights').send({ weights: {} });
    expect([401, 403]).toContain(res.status);
  });

  it('GET /admin/scheduler page without session → blocked (401 JSON for API-ish clients, 302 for browsers)', async () => {
    const req = await createRequest();
    const res = await req.get('/admin/scheduler');
    // requireAdmin returns 401 JSON when the client accepts JSON (supertest
    // sends Accept: */*) and 302 for plain browser navigation — both block
    // unauthenticated access to the admin-only page.
    expect([401, 403, 302]).toContain(res.status);
    if (res.status === 302) {
      expect(res.headers.location).toContain('/admin/login');
    }
  });
});

describe('Scheduler HTTP — admin session + graceful degradation', () => {
  it('admin login → meta 200, then POST run → 400 "PostgreSQL required"', async () => {
    const supertest = (await import('supertest')).default;
    // Use the SAME app instance that was started in beforeAll (an agent on a
    // second getApp() instance would hold a different session store).
    const agent = supertest.agent(app);

    const loginPage = await agent.get('/admin/login');
    expect(loginPage.status).toBe(200);
    const token = extractCsrfToken(loginPage.text);
    expect(token).toBeTruthy();

    const loginRes = await agent
      .post('/admin/login')
      .type('form')
      .send({ username: CONFIG.ADMIN_USER, password: CONFIG.ADMIN_PASS, _csrf: token });
    expect(loginRes.status).toBe(302);

    // Authenticated reads work
    const metaRes = await agent.get('/api/admin/scheduler/meta');
    expect(metaRes.status).toBe(200);
    expect(metaRes.body).toHaveProperty('defaultWeights');

    // The login POST regenerated the session (session-fixation prevention),
    // so the pre-login CSRF token is stale. Grab the fresh token that the
    // layout injects into every authenticated page (views/partials/head.ejs).
    const dashRes = await agent.get('/admin/dashboard');
    expect(dashRes.status).toBe(200);
    const fresh = dashRes.text.match(/window\.__CSRF_TOKEN\s*=\s*'([^']+)'/);
    expect(fresh).toBeTruthy();

    // Write path degrades gracefully without PostgreSQL
    const runRes = await agent
      .post('/api/admin/scheduler/run')
      .set('x-csrf-token', fresh[1])
      .send({ title: 'demo', exams: [], periods: [], rooms: [], proctors: [] });
    expect(runRes.status).toBe(400);
    expect(runRes.body.error).toMatch(/PostgreSQL required/);
  }, 15000);
});
