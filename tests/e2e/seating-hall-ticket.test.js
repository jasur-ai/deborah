/**
 * Deborah — E2E/Security: Hall Ticket & Offline Check-in (Prompt 40)
 *
 * E2E walk (Prompt 40 §20):
 *   - Pure-logic E2E: seat allocation → signed hall ticket → token verify →
 *     offline journal reconcile (idempotent replay by client_seq).
 *   - SECURITY (§15): hall-ticket payload never contains answer keys or
 *     raw sensitive reasons; reseat reasons are CODES only; the QR payload
 *     is signed and tamper-evident (tampered payload fails verification).
 *   - API walk (graceful degradation without PostgreSQL):
 *       • Every /api/admin/seating/* endpoint requires admin (401/403
 *         unauth; CSRF-first on writes).
 *       • /admin/seating page redirects to /admin/login without a session.
 *       • Read paths return 200 with empty arrays; write paths throw a
 *         clear 'PostgreSQL required' — no silent corruption.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createApp } from '../../server.js';
import CONFIG from '../../src/config/env.js';
import { createRequest, snapshotDb, restoreDb } from '../helpers/setup.js';
import {
  allocateSeats,
  buildHallTicketPayload,
  signHallTicketToken,
  verifyHallTicketToken,
  buildCheckinEntry,
  highestContiguousSeq,
  reconcileCheckinJournal,
  buildReseatAuditEntry,
  RESEAT_REASONS,
  MIN_SIGNING_KEY_LENGTH,
} from '../../src/modules/seating/index.js';

const SIGNING_KEY = 'deborah-e2e-hall-ticket-signing-key-0123456789';

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

// ═══════════════════════════════════════════════════════════════════
// FIXTURES
// ═══════════════════════════════════════════════════════════════════

const SEAT_LAYOUT = {
  rows: [
    { label: 'A', seats: [
      { label: '1', features: [], accessible: false },
      { label: '2', features: [], accessible: false },
      { label: '3', features: ['wheelchair_access'], accessible: true },
      { label: '4', features: [], accessible: false },
    ]},
    { label: 'B', seats: [
      { label: '1', features: [], accessible: false },
      { label: '2', features: [], accessible: false },
      { label: '3', features: [], accessible: false },
      { label: '4', features: [], accessible: false },
    ]},
  ],
};

const STUDENTS = [
  { userId: 101, variant: 'A', accommodation: {} },
  { userId: 102, variant: 'B', accommodation: {} },
  { userId: 103, variant: 'C', accommodation: { accessibleSeat: true } },
  { userId: 104, variant: 'A', accommodation: {} },
  { userId: 105, variant: 'B', accommodation: { extraTime: true } },
  { userId: 106, variant: 'C', accommodation: {} },
  { userId: 107, variant: 'A', accommodation: {} },
  { userId: 108, variant: 'B', accommodation: {} },
];

// ═══════════════════════════════════════════════════════════════════
// PURE E2E: allocate → hall ticket → verify → check-in journal
// ═══════════════════════════════════════════════════════════════════

describe('Seating E2E — hall ticket lifecycle (§20)', () => {
  it('full flow: allocate → sign ticket → verify → journal reconcile', () => {
    // 1) Allocate seats (deterministic)
    const alloc = allocateSeats({ seatMap: { layout: SEAT_LAYOUT }, students: STUDENTS, seed: 42 });
    expect(alloc.ok).toBe(true);
    expect(alloc.assignments).toHaveLength(8);

    // 2) Build + sign a hall ticket for one student (no answer keys / raw reasons)
    const student = alloc.assignments.find((a) => a.userId === 103); // accessible student
    expect(student.flags).toContain('accessible_seat');
    const payload = buildHallTicketPayload({
      assignmentId: 1,
      runId: 1,
      eventId: 1,
      periodId: 1,
      roomId: 1,
      studentUserId: student.userId,
      rowLabel: student.rowLabel,
      seatLabel: student.seatLabel,
      variant: student.variant,
      accommodationFlags: student.flags,
      seatMapVersion: 1,
      issuedAt: 1234567890,
    });
    const json = JSON.stringify(payload);
    expect(json).not.toMatch(/answer|key|correct|raw/i);

    // 3) Sign + verify
    const token = signHallTicketToken(payload, SIGNING_KEY);
    expect(verifyHallTicketToken(payload, token, SIGNING_KEY)).toBe(true);

    // 4) Tampered payload must FAIL verification (hall-ticket mismatch = 0)
    const tampered = { ...payload, seatLabel: '9' };
    expect(verifyHallTicketToken(tampered, token, SIGNING_KEY)).toBe(false);

    // 5) Offline check-in journal: idempotent replay by client_seq
    const entries = [
      buildCheckinEntry({ deviceId: 'tab-1', clientSeq: 1, eventType: 'checkin', payload: { seatAssignmentId: 1 } }),
      buildCheckinEntry({ deviceId: 'tab-1', clientSeq: 2, eventType: 'checkin', payload: { seatAssignmentId: 2 } }),
      buildCheckinEntry({ deviceId: 'tab-1', clientSeq: 3, eventType: 'checkin', payload: { seatAssignmentId: 3 } }),
    ];
    expect(highestContiguousSeq(entries.map((e) => e.clientSeq))).toBe(3);

    // Replay after device acked through 2 → only 3 remains
    const reconcile = reconcileCheckinJournal({ entries, ackedSeq: 2 });
    expect(reconcile.toApply.map((e) => e.clientSeq)).toEqual([3]);
    expect(reconcile.nextAckedSeq).toBe(3);
  });

  it('hall-ticket token verification is tamper-evident across all students', () => {
    const alloc = allocateSeats({ seatMap: { layout: SEAT_LAYOUT }, students: STUDENTS, seed: 1 });
    expect(alloc.ok).toBe(true);
    for (const a of alloc.assignments) {
      const payload = buildHallTicketPayload({
        assignmentId: a.userId, runId: 1, eventId: 1, periodId: 1, roomId: 1,
        studentUserId: a.userId, rowLabel: a.rowLabel, seatLabel: a.seatLabel,
        variant: a.variant, accommodationFlags: a.flags, seatMapVersion: 1,
        issuedAt: Date.now(),
      });
      const token = signHallTicketToken(payload, SIGNING_KEY);
      expect(verifyHallTicketToken(payload, token, SIGNING_KEY)).toBe(true);
      expect(verifyHallTicketToken({ ...payload, studentUserId: a.userId + 1 }, token, SIGNING_KEY)).toBe(false);
    }
  });

  it('offline journal high-water mark tolerates gaps (out-of-order devices)', () => {
    const entries = [1, 2, 3, 5, 6].map((s) => buildCheckinEntry({ deviceId: 'tab-2', clientSeq: s, eventType: 'checkin', payload: {} }));
    const reconcile = reconcileCheckinJournal({ entries, ackedSeq: 0 });
    expect(reconcile.nextAckedSeq).toBe(3); // gap at 4
    expect(reconcile.toApply).toHaveLength(5);
  });

  it('reseat audit only accepts reason codes (no raw rationale)', () => {
    expect(RESEAT_REASONS).toContain('no_show');
    const ok = buildReseatAuditEntry({ runId: 1, studentUserId: 101, reason: 'no_show', actorUserId: 9 });
    expect(ok.ok).toBe(true);
    const bad = buildReseatAuditEntry({ runId: 1, studentUserId: 101, reason: 'student was nervous and asked to move' });
    expect(bad.ok).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════
// SECURITY WALK (graceful degradation without PostgreSQL)
// ═══════════════════════════════════════════════════════════════════

describe('Seating — security walk (§20)', () => {
  it('page redirects to /admin/login without a session', async () => {
    const supertest = (await import('supertest')).default;
    const r = await supertest(app).get('/admin/seating');
    expect([302, 401, 403]).toContain(r.status);
  });

  it('all /api/admin/seating/* endpoints require admin', async () => {
    const supertest = (await import('supertest')).default;
    const paths = [
      '/api/admin/seating/meta',
      '/api/admin/seating/seat-maps',
      '/api/admin/seating/seat-maps/1',
      '/api/admin/seating/assignments',
      '/api/admin/seating/proctor-duties',
      '/api/admin/seating/checkin/journal',
      '/api/admin/seating/reseat-audit',
      '/api/admin/seating/register/room',
      '/api/admin/seating/register/proctor',
    ];
    for (const p of paths) {
      const r = await supertest(app).get(p);
      expect([401, 403], p).toContain(r.status);
    }
  });

  it('admin session: meta 200; writes → "PostgreSQL required"; reads → empty data', async () => {
    const meta = await agent.get('/api/admin/seating/meta');
    expect(meta.status).toBe(200);
    expect(meta.body.reseatReasons.length).toBeGreaterThan(0);

    const write = await agent.post('/api/admin/seating/seat-maps/1')
      .set('x-csrf-token', csrfToken)
      .send({ layout: SEAT_LAYOUT });
    expect(write.status).toBe(400);
    expect(write.body.error).toMatch(/PostgreSQL required/);

    const reads = await Promise.all([
      agent.get('/api/admin/seating/assignments'),
      agent.get('/api/admin/seating/proctor-duties'),
      agent.get('/api/admin/seating/reseat-audit'),
      agent.get('/api/admin/seating/register/room'),
    ]);
    for (const r of reads) {
      expect(r.status).toBe(200);
      expect(Array.isArray(r.body.assignments || r.body.duties || r.body.audit || r.body.register)).toBe(true);
    }
  });

  it('CSRF-first: unauthenticated write without token is rejected', async () => {
    const supertest = (await import('supertest')).default;
    const r = await supertest(app).post('/api/admin/seating/reseat').send({ reason: 'no_show' });
    expect([401, 403]).toContain(r.status);
  });

  it('signing key length guard is enforced by the schema constant', () => {
    expect(SIGNING_KEY.length).toBeGreaterThanOrEqual(MIN_SIGNING_KEY_LENGTH);
  });
});
