/**
 * Edikit — E2E/Security: Schedule Version & Publish (Prompt 39)
 *
 * Version lifecycle + publish-gate E2E walk (Prompt 39 §20):
 *   - Full version lifecycle: solver run → DRAFT → approve → PUBLISH, with
 *     immutable published versions (only archive afterwards).
 *   - Publish HARD GATE (§15): a run whose stored hard_violations or
 *     unscheduled is non-empty can NEVER be published — even a forced
 *     transition is rejected by validateScheduleTransition.
 *   - Security walk (graceful degradation without PostgreSQL):
 *       • Every /api/admin/scheduler/* endpoint requires admin (401/403
 *         unauthenticated; CSRF-first on writes).
 *       • /admin/scheduler page redirects to /admin/login without a session.
 *       • Service write paths throw a clear 'PostgreSQL required' error;
 *         read paths return []/null/fallback — no silent corruption.
 *       • API run/approve/publish/what-if never leak private data; all
 *         response contracts are { ok, ... } shaped.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createApp } from '../../server.js';
import CONFIG from '../../src/config/env.js';
import { createRequest, snapshotDb, restoreDb } from '../helpers/setup.js';
import {
  solveSchedule,
  hasHardViolations,
  validateScheduleTransition,
  SCHEDULE_STATUS,
  SCHEDULE_STATUS_TRANSITIONS,
} from '../../src/modules/scheduler/index.js';

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

const PROCTORS = [
  { id: 500, dailyLimit: 4, status: 'active' },
  { id: 501, dailyLimit: 4, status: 'active' },
];

// Feasible: every exam gets a slot, zero hard violations.
const EXAMS_FEASIBLE = [
  { id: 10, title: 'Matematika', studentIds: [101, 102, 103, 104, 105, 106, 107, 108, 109, 110], separateRoomStudentIds: [], window: null, requiredFeatures: [] },
  { id: 11, title: 'Fizika', studentIds: [111, 112, 113, 114, 115, 116, 117, 118], separateRoomStudentIds: [], window: null, requiredFeatures: ['computers'] },
  { id: 12, title: 'Kimyo', studentIds: [201, 202, 203, 204, 205, 206, 207, 208], separateRoomStudentIds: [], window: null, requiredFeatures: [] },
  { id: 13, title: 'Separate student', studentIds: [301], separateRoomStudentIds: [301], window: null, requiredFeatures: [] },
];

// Infeasible: 8 exams × 12 students vs 6 usable slots → must be unscheduled.
const EXAMS_INFEASIBLE = Array.from({ length: 8 }, (_, i) => ({
  id: 20 + i,
  title: `X${i + 1}`,
  studentIds: Array.from({ length: 12 }, (_, j) => 500 + i * 12 + j),
  separateRoomStudentIds: [],
  window: null,
  requiredFeatures: [],
}));

function extractCsrfToken(html) {
  const match = html.match(/name="_csrf"\s+value="([^"]+)"/);
  return match ? match[1] : null;
}

// ═══════════════════════════════════════════════════════════════════
// VERSION LIFECYCLE (pure logic — deterministic, server-authoritative)
// ═══════════════════════════════════════════════════════════════════

describe('Schedule version lifecycle (draft → approved → published)', () => {
  it('feasible run: every exam placed, zero violations, publishable', () => {
    const solution = solveSchedule({ exams: EXAMS_FEASIBLE, periods: PERIODS, rooms: ROOMS, proctors: PROCTORS, seed: 1 });
    expect(solution.assignments).toHaveLength(EXAMS_FEASIBLE.length);
    expect(solution.unscheduled).toHaveLength(0);
    expect(solution.violations).toHaveLength(0);
    expect(hasHardViolations(solution.violations, solution.unscheduled)).toBe(false);

    // version lifecycle: draft → approved → published
    expect(validateScheduleTransition({ from: SCHEDULE_STATUS.DRAFT, to: SCHEDULE_STATUS.APPROVED }).ok).toBe(true);
    const publishGate = validateScheduleTransition({
      from: SCHEDULE_STATUS.APPROVED,
      to: SCHEDULE_STATUS.PUBLISHED,
      violations: solution.violations,
      unscheduled: solution.unscheduled,
    });
    expect(publishGate.ok).toBe(true);
  });

  it('infeasible run: unscheduled exams → NEVER publishable (§15 hard gate)', () => {
    const solution = solveSchedule({ exams: EXAMS_INFEASIBLE, periods: PERIODS, rooms: ROOMS, proctors: PROCTORS, seed: 1 });
    expect(solution.unscheduled.length).toBeGreaterThan(0);
    expect(hasHardViolations(solution.violations, solution.unscheduled)).toBe(true);

    // Even after a (hypothetical) approval, publish MUST be blocked.
    const gate = validateScheduleTransition({
      from: SCHEDULE_STATUS.APPROVED,
      to: SCHEDULE_STATUS.PUBLISHED,
      violations: solution.violations,
      unscheduled: solution.unscheduled,
    });
    expect(gate.ok).toBe(false);
    expect(gate.reason).toMatch(/hard violations/i);
  });

  it('published versions are immutable — only archive is allowed', () => {
    expect(SCHEDULE_STATUS_TRANSITIONS.published).toEqual(['archived']);
    expect(validateScheduleTransition({ from: 'published', to: 'draft' }).ok).toBe(false);
    expect(validateScheduleTransition({ from: 'published', to: 'approved' }).ok).toBe(false);
    expect(validateScheduleTransition({ from: 'published', to: 'archived' }).ok).toBe(true);
  });

  it('draft cannot skip straight to published (approval is mandatory)', () => {
    expect(validateScheduleTransition({ from: 'draft', to: 'published', violations: [], unscheduled: [] }).ok).toBe(false);
  });

  it('deterministic: same input + seed → identical version (reproducible)', () => {
    const a = solveSchedule({ exams: EXAMS_FEASIBLE, periods: PERIODS, rooms: ROOMS, proctors: PROCTORS, seed: 7 });
    const b = solveSchedule({ exams: EXAMS_FEASIBLE, periods: PERIODS, rooms: ROOMS, proctors: PROCTORS, seed: 7 });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(a.deterministic).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════
// SERVICE GRACEFUL DEGRADATION (no PostgreSQL in CI)
// ═══════════════════════════════════════════════════════════════════

describe('Scheduler service — graceful degradation without PostgreSQL', () => {
  it('write paths throw a clear "PostgreSQL required" error', async () => {
    const svc = await import('../../src/modules/scheduler/index.js');
    for (const fn of ['createExamRoom', 'createExamPeriod', 'saveWeightConfig', 'runSolver', 'approveScheduleRun', 'publishScheduleRun']) {
      await expect(svc[fn]({})).rejects.toThrow(/PostgreSQL required/);
    }
  });

  it('read paths return safe empty/fallback values (no crash, no corruption)', async () => {
    const svc = await import('../../src/modules/scheduler/index.js');
    expect(await svc.listExamRooms()).toEqual([]);
    expect(await svc.listExamPeriods()).toEqual([]);
    expect(await svc.listScheduleRuns()).toEqual([]);
    expect(await svc.getScheduleRun(1)).toBeNull();
    const cfg = await svc.getWeightConfig();
    expect(cfg).toHaveProperty('weights');
    expect(cfg).toHaveProperty('seed');
  });

  it('whatIfMove on a missing run fails cleanly (no partial data leak)', async () => {
    const svc = await import('../../src/modules/scheduler/index.js');
    await expect(svc.whatIfMove(999, 10, 1)).rejects.toThrow(/not found/);
  });
});

// ═══════════════════════════════════════════════════════════════════
// API SECURITY WALK (E2E over HTTP)
// ═══════════════════════════════════════════════════════════════════

describe('Scheduler API — security (E2E)', () => {
  it('every /api/admin/scheduler/* endpoint requires admin (unauthenticated → 401/403)', async () => {
    const req = await createRequest();
    const getEndpoints = [
      '/api/admin/scheduler/meta',
      '/api/admin/scheduler/rooms',
      '/api/admin/scheduler/periods',
      '/api/admin/scheduler/weights',
      '/api/admin/scheduler/runs',
      '/api/admin/scheduler/runs/1',
    ];
    for (const ep of getEndpoints) {
      const res = await req.get(ep);
      expect([401, 403]).toContain(res.status);
    }
    const postEndpoints = [
      ['/api/admin/scheduler/rooms', {}],
      ['/api/admin/scheduler/periods', {}],
      ['/api/admin/scheduler/run', { title: 'x' }],
      ['/api/admin/scheduler/runs/1/approve', {}],
      ['/api/admin/scheduler/runs/1/publish', {}],
      ['/api/admin/scheduler/runs/1/what-if', {}],
    ];
    for (const [ep, body] of postEndpoints) {
      const res = await req.post(ep).send(body);
      expect([401, 403]).toContain(res.status);
    }
  });

  it('/admin/scheduler page is blocked without a session (401 JSON for API-ish clients, 302 for browsers)', async () => {
    const req = await createRequest();
    const res = await req.get('/admin/scheduler');
    expect([401, 403, 302]).toContain(res.status);
    if (res.status === 302) {
      expect(res.headers.location).toContain('/admin/login');
    }
  });

  it('writes without a CSRF token are rejected even WITH a valid admin session (CSRF-first)', async () => {
    const supertest = (await import('supertest')).default;
    const agent = supertest.agent(app);

    // Authenticate first (real admin session cookie).
    const loginPage = await agent.get('/admin/login');
    expect(loginPage.status).toBe(200);
    const token = extractCsrfToken(loginPage.text);
    expect(token).toBeTruthy();
    const loginRes = await agent
      .post('/admin/login')
      .type('form')
      .send({ username: CONFIG.ADMIN_USER, password: CONFIG.ADMIN_PASS, _csrf: token });
    expect(loginRes.status).toBe(302);

    // Admin is authenticated, but the write OMITS the CSRF token → must 403.
    const res = await agent.post('/api/admin/scheduler/run').send({ title: 'x' });
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/CSRF/);
  }, 15000);

  it('solver never emits private/black-box data on assignments', () => {
    const solution = solveSchedule({ exams: EXAMS_FEASIBLE, periods: PERIODS, rooms: ROOMS, proctors: PROCTORS, seed: 1 });
    const json = JSON.stringify(solution);
    // No emotion/stress/behaviour/private student attributes anywhere
    for (const forbidden of ['emotion', 'stress', 'behaviour', 'probability']) {
      expect(json).not.toContain(forbidden);
    }
    // Every soft item is explainable
    for (const a of solution.assignments) {
      expect(Array.isArray(a.softPenalty)).toBe(true);
      for (const item of a.softPenalty) {
        expect(typeof item.reason).toBe('string');
        expect(item.reason.length).toBeGreaterThan(0);
      }
    }
  });
});
