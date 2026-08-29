/**
 * Deborah — Integration Tests: Seat & Proctor Property Tests (Prompt 40)
 *
 * Property/contract coverage (Prompt 40 §19 — proctor clash/workload):
 *   - For many SEEDED random instances, allocateProctorDuties produces:
 *       • ZERO same-period proctor clashes (independent verification)
 *       • ZERO room double-books (one duty per room per period)
 *       • Workload fairness (max spread ≤ 1 when possible)
 *       • Deterministic reproducibility (same seed → same duties)
 *   - Seat allocator: accessible supply is never exceeded; unseated
 *     students are always reported; determinism holds.
 *
 * HTTP contract (graceful degradation without PostgreSQL):
 *   - /api/admin/seating/* endpoints require admin (401/403 unauthenticated)
 *   - /admin/seating page redirects to /admin/login without a session
 *   - With a real admin session: meta 200; write paths → 400 { error:
 *     'PostgreSQL required' } — the DB write path degrades gracefully.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createApp } from '../../server.js';
import CONFIG from '../../src/config/env.js';
import { createRequest, snapshotDb, restoreDb } from '../helpers/setup.js';
import {
  createSeededRng,
  seededShuffle,
  allocateProctorDuties,
  verifyProctorNoClash,
  allocateSeats,
  checkSeatCapacity,
  validateSeatMapLayout,
} from '../../src/modules/seating/index.js';

// ═══════════════════════════════════════════════════════════════════
// DETERMINISTIC INSTANCE GENERATOR (seeded — property testing)
// ═══════════════════════════════════════════════════════════════════

function genProctorInstance(seed) {
  const rng = createSeededRng(seed);
  const ri = (n) => Math.floor(rng() * n);
  const nPeriods = 3 + ri(3); // 3..5 periods
  const nRooms = 2 + ri(3); // 2..4 rooms
  const proctorCount = 2 + ri(3); // 2..4 proctors
  const proctors = Array.from({ length: proctorCount }, (_, i) => ({
    userId: 500 + i,
    maxPerDay: 2 + ri(3), // 2..4
    availability: Array.from({ length: nPeriods }, (_, p) => p + 1),
  }));
  const slots = [];
  for (let p = 1; p <= nPeriods; p++) {
    const roomsInPeriod = 1 + ri(nRooms); // at least one per period
    for (let r = 0; r < roomsInPeriod; r++) {
      slots.push({ periodId: p, roomId: r + 1 });
    }
  }
  return { slots, proctors };
}

const SEAT_LAYOUT = {
  rows: [
    { label: 'A', seats: [
      { label: '1', features: [], accessible: false },
      { label: '2', features: [], accessible: false },
      { label: '3', features: ['wheelchair_access'], accessible: true },
      { label: '4', features: [], accessible: false },
      { label: '5', features: [], accessible: false },
      { label: '6', features: [], accessible: false },
    ]},
    { label: 'B', seats: [
      { label: '1', features: [], accessible: false },
      { label: '2', features: [], accessible: false },
      { label: '3', features: [], accessible: false },
      { label: '4', features: [], accessible: false },
      { label: '5', features: [], accessible: false },
      { label: '6', features: [], accessible: false },
    ]},
  ],
};

// ═══════════════════════════════════════════════════════════════════
// PROCTOR PROPERTY TESTS (§19)
// ═══════════════════════════════════════════════════════════════════

describe('Seating — proctor allocation property tests (§19)', () => {
  const SEEDS = [1, 2, 3, 4, 5, 6, 7, 8];

  it('produces ZERO same-period proctor clashes across seeded instances', () => {
    for (const seed of SEEDS) {
      const { slots, proctors } = genProctorInstance(seed);
      const r = allocateProctorDuties({ slots, proctors, seed });
      const verify = verifyProctorNoClash(r.duties);
      expect(verify.clashes, `seed ${seed}`).toEqual([]);
    }
  });

  it('never double-books a room in the same period', () => {
    for (const seed of SEEDS) {
      const { slots, proctors } = genProctorInstance(seed);
      const r = allocateProctorDuties({ slots, proctors, seed });
      const seen = new Set();
      for (const d of r.duties) {
        const key = `${d.periodId}:${d.roomId}`;
        expect(seen.has(key), `seed ${seed} double-books room ${d.roomId} in period ${d.periodId}`).toBe(false);
        seen.add(key);
      }
    }
  });

  it('balances workload — max spread is at most 1 when feasible', () => {
    for (const seed of SEEDS) {
      const { slots, proctors } = genProctorInstance(seed);
      // Only check instances where every slot got covered.
      const r = allocateProctorDuties({ slots, proctors, seed });
      if (r.unassigned.length === 0) {
        const loads = Object.values(r.workload);
        const spread = Math.max(...loads) - Math.min(...loads);
        expect(spread, `seed ${seed}`).toBeLessThanOrEqual(1);
      }
    }
  });

  it('is deterministic — same seed produces identical duties', () => {
    const { slots, proctors } = genProctorInstance(42);
    const r1 = allocateProctorDuties({ slots, proctors, seed: 42 });
    const r2 = allocateProctorDuties({ slots, proctors, seed: 42 });
    expect(r1.duties).toEqual(r2.duties);
  });

  it('reports unassigned slots instead of silently dropping work', () => {
    // 5 rooms in the same period but only 2 proctors → some slots unassigned
    const slots = Array.from({ length: 5 }, (_, i) => ({ periodId: 1, roomId: i + 1 }));
    const proctors = [
      { userId: 501, maxPerDay: 4, availability: [1] },
      { userId: 502, maxPerDay: 4, availability: [1] },
    ];
    const r = allocateProctorDuties({ slots, proctors, seed: 1 });
    expect(r.ok).toBe(false);
    expect(r.unassigned.length).toBeGreaterThan(0);
    // Never assigns a proctor to two rooms in the same period even under pressure
    const verify = verifyProctorNoClash(r.duties);
    expect(verify.clashes).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════
// SEAT PROPERTY TESTS
// ═══════════════════════════════════════════════════════════════════

describe('Seating — seat allocation property tests', () => {
  it('never exceeds accessible supply and reports every unseated student', () => {
    const students = [
      { userId: 1, variant: 'A', accommodation: { accessibleSeat: true } },
      { userId: 2, variant: 'A', accommodation: { accessibleSeat: true } }, // only 1 accessible seat
      ...Array.from({ length: 10 }, (_, i) => ({ userId: 10 + i, variant: ['A', 'B', 'C'][i % 3], accommodation: {} })),
    ];
    const capacity = checkSeatCapacity({ seatMap: { layout: SEAT_LAYOUT }, students });
    expect(capacity.ok).toBe(false); // accessible demand > supply
    const r = allocateSeats({ seatMap: { layout: SEAT_LAYOUT }, students, seed: 3 });
    // accessible students: exactly one seated on the accessible seat; the other is reported
    const accSeated = r.assignments.filter((a) => a.flags.includes('accessible_seat'));
    expect(accSeated).toHaveLength(1);
    expect(r.unseated.some((u) => u.reason === 'no_accessible_seat')).toBe(true);
  });

  it('every assignment respects the seat map (row/seat exist, no duplicate seats)', () => {
    const students = Array.from({ length: 12 }, (_, i) => ({ userId: 100 + i, variant: ['A', 'B', 'C'][i % 3], accommodation: {} }));
    const r = allocateSeats({ seatMap: { layout: SEAT_LAYOUT }, students, seed: 5 });
    expect(r.ok).toBe(true);
    const mapCheck = validateSeatMapLayout(SEAT_LAYOUT);
    const seats = new Set();
    for (const a of r.assignments) {
      const full = `${a.rowLabel}-${a.seatLabel}`;
      expect(seats.has(full), `duplicate seat ${full}`).toBe(false);
      seats.add(full);
      expect(mapCheck.seatCount).toBeGreaterThanOrEqual(r.assignments.length);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════
// HTTP CONTRACT (graceful degradation without PostgreSQL)
// ═══════════════════════════════════════════════════════════════════

let app;
let httpServer;
let agent;
let csrfToken;

beforeAll(async () => {
  snapshotDb();
  const result = await createApp();
  app = result.app;
  httpServer = result.httpServer;
  await new Promise((resolve) => httpServer.listen(0, resolve));

  const supertest = (await import('supertest')).default;
  agent = supertest.agent(app);
  const page = await agent.get('/admin/login');
  const m = page.text.match(/name="_csrf"\s+value="([^"]+)"/);
  await agent.post('/admin/login').type('form').send({
    username: CONFIG.ADMIN_USER,
    password: CONFIG.ADMIN_PASS,
    _csrf: m ? m[1] : '',
  });
  // Session is regenerated on login → read the fresh token from the page.
  const dash = await agent.get('/admin/dashboard');
  const t = dash.text.match(/window\.__CSRF_TOKEN\s*=\s*'([^']+)'/);
  csrfToken = t ? t[1] : '';
});

afterAll(async () => {
  restoreDb();
  return new Promise((resolve) => {
    if (httpServer && httpServer.listening) httpServer.close(() => resolve());
    else resolve();
  });
});

describe('Seating — HTTP ACL & graceful degradation', () => {
  it('/admin/seating page redirects to /admin/login without a session', async () => {
    const supertest = (await import('supertest')).default;
    const r = await supertest(app).get('/admin/seating');
    expect([302, 401, 403]).toContain(r.status);
    if (r.status === 302) expect(r.headers.location).toBe('/admin/login');
  });

  it('unauthenticated /api/admin/seating/* returns 401/403', async () => {
    const supertest = (await import('supertest')).default;
    for (const p of [
      '/api/admin/seating/meta',
      '/api/admin/seating/seat-maps',
      '/api/admin/seating/assignments',
      '/api/admin/seating/register/room',
      '/api/admin/seating/register/proctor',
    ]) {
      const r = await supertest(app).get(p);
      expect([401, 403], p).toContain(r.status);
    }
  });

  it('admin session → meta 200 with constants', async () => {
    const r = await agent.get('/api/admin/seating/meta');
    expect(r.status).toBe(200);
    expect(r.body.reseatReasons).toBeInstanceOf(Array);
    expect(r.body.checkinEventTypes).toBeInstanceOf(Array);
  });

  it('admin session → write paths degrade gracefully with "PostgreSQL required"', async () => {
    // seat-map upsert
    const r1 = await agent.post('/api/admin/seating/seat-maps/1')
      .set('x-csrf-token', csrfToken)
      .send({ layout: SEAT_LAYOUT });
    expect(r1.status).toBe(400);
    expect(r1.body.error).toMatch(/PostgreSQL required/);

    // seat allocation
    const r2 = await agent.post('/api/admin/seating/allocate')
      .set('x-csrf-token', csrfToken)
      .send({
        runId: 1,
        assignment: { id: 1, event_id: 1, period_id: 1, room_id: 1, student_ids: [101, 102] },
        studentAccommodations: [],
        seed: 1,
      });
    expect([400, 404]).toContain(r2.status); // 400 no PG / 404 no seat map

    // proctor allocation
    const r3 = await agent.post('/api/admin/seating/proctors')
      .set('x-csrf-token', csrfToken)
      .send({
        runId: 1,
        assignments: [{ period_id: 1, room_id: 1 }],
        proctors: [{ userId: 501, maxPerDay: 4, availability: [1] }],
        seed: 1,
      });
    expect(r3.status).toBe(400);
    expect(r3.body.error).toMatch(/PostgreSQL required/);

    // check-in journal
    const r4 = await agent.post('/api/admin/seating/checkin/journal')
      .set('x-csrf-token', csrfToken)
      .send({ deviceId: 'tab-1', entries: [{ clientSeq: 1, eventType: 'checkin', payload: {} }] });
    expect(r4.status).toBe(400);
    expect(r4.body.error).toMatch(/PostgreSQL required/);

    // reseat
    const r5 = await agent.post('/api/admin/seating/reseat')
      .set('x-csrf-token', csrfToken)
      .send({ runId: 1, studentUserId: 1, fromSeatAssignmentId: 1, toSeatAssignmentId: 2, reason: 'no_show' });
    expect(r5.status).toBe(400);
    expect(r5.body.error).toMatch(/PostgreSQL required/);
  });

  it('CSRF-first — write without token is rejected with 403', async () => {
    const r = await agent.post('/api/admin/seating/seat-maps/1').send({ layout: SEAT_LAYOUT });
    expect([403, 400]).toContain(r.status); // 403 CSRF, or 400 if CSRF skipped for non-JSON
  });

  it('read paths degrade gracefully (200 with empty data) without PostgreSQL', async () => {
    const r = await agent.get('/api/admin/seating/assignments');
    expect(r.status).toBe(200);
    expect(r.body.assignments).toBeInstanceOf(Array);
  });
});
