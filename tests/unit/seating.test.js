/**
 * Deborah — Unit Tests: Seat, Proctor, Hall Ticket & Check-in (Prompt 40)
 *
 * Pure-logic coverage (Prompt 40 §18 — seat capacity/accommodation):
 *   - Seat-map layout validation (rows/seats grid, accessible feature rule)
 *   - Seat capacity check (room capacity + accessible demand)
 *   - Accommodation-aware allocation (accessible first, extra-time bias,
 *     separate-room skipped for the caller)
 *   - Variant separation (same-variant students not adjacent)
 *   - Deterministic seeded allocation (same seed → same result)
 *   - Proctor allocator: no same-period clash + workload fairness
 *   - Independent proctor clash verification
 *   - Hall-ticket payload has NO answer keys / raw sensitive reasons
 *   - Hall-ticket token sign/verify (HMAC, timing-safe compare)
 *   - Offline check-in journal: contiguous high-water mark + reconcile
 *   - Reseat audit: reason codes only (raw rationale rejected)
 */

import { describe, it, expect } from 'vitest';
import {
  validateSeatMapLayout,
  flattenSeatMap,
  checkSeatCapacity,
  allocateSeats,
  seededShuffle,
  createSeededRng,
  allocateProctorDuties,
  verifyProctorNoClash,
  buildHallTicketPayload,
  signHallTicketToken,
  verifyHallTicketToken,
  buildCheckinEntry,
  highestContiguousSeq,
  reconcileCheckinJournal,
  buildReseatAuditEntry,
  RESEAT_REASONS,
  CHECKIN_EVENT_TYPES,
} from '../../src/modules/seating/index.js';

// ═══════════════════════════════════════════════════════════════════
// FIXTURES
// ═══════════════════════════════════════════════════════════════════

const GOOD_LAYOUT = {
  rows: [
    {
      label: 'A',
      seats: [
        { label: '1', features: [], accessible: false },
        { label: '2', features: [], accessible: false },
        { label: '3', features: ['wheelchair_access'], accessible: true },
        { label: '4', features: [], accessible: false },
      ],
    },
    {
      label: 'B',
      seats: [
        { label: '1', features: [], accessible: false },
        { label: '2', features: [], accessible: false },
        { label: '3', features: [], accessible: false },
        { label: '4', features: [], accessible: false },
      ],
    },
  ],
};

const SIGNING_KEY = 'deborah-test-signing-key-0123456789abcdef';

// ═══════════════════════════════════════════════════════════════════
// SEAT-MAP VALIDATION
// ═══════════════════════════════════════════════════════════════════

describe('Seating — seat-map validation', () => {
  it('accepts a valid layout and counts seats/accessible seats', () => {
    const r = validateSeatMapLayout(GOOD_LAYOUT);
    expect(r.ok).toBe(true);
    expect(r.errors).toEqual([]);
    expect(r.seatCount).toBe(8);
    expect(r.accessibleSeats).toEqual(['A-3']);
  });

  it('rejects an empty layout', () => {
    const r = validateSeatMapLayout({});
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => /at least one row/i.test(e))).toBe(true);
  });

  it('rejects duplicate full seat labels', () => {
    const r = validateSeatMapLayout({
      rows: [
        { label: 'A', seats: [{ label: '1' }, { label: '1' }] },
      ],
    });
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => /Duplicate/.test(e))).toBe(true);
  });

  it('rejects an accessible seat without wheelchair_access feature', () => {
    const r = validateSeatMapLayout({
      rows: [{ label: 'A', seats: [{ label: '1', accessible: true, features: [] }] }],
    });
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => /wheelchair_access/.test(e))).toBe(true);
  });

  it('flattens a layout into seat descriptors', () => {
    const seats = flattenSeatMap(GOOD_LAYOUT);
    expect(seats).toHaveLength(8);
    expect(seats[0]).toMatchObject({ rowLabel: 'A', seatLabel: '1', accessible: false });
    expect(seats[2]).toMatchObject({ rowLabel: 'A', seatLabel: '3', accessible: true });
  });
});

// ═══════════════════════════════════════════════════════════════════
// SEAT CAPACITY (§18 — seat capacity)
// ═══════════════════════════════════════════════════════════════════

describe('Seating — seat capacity (§18)', () => {
  it('fits students when capacity is sufficient', () => {
    const students = Array.from({ length: 8 }, (_, i) => ({ userId: 100 + i, variant: 'A', accommodation: {} }));
    const r = checkSeatCapacity({ seatMap: { layout: GOOD_LAYOUT }, students });
    expect(r.ok).toBe(true);
  });

  it('rejects when students exceed room capacity', () => {
    const students = Array.from({ length: 9 }, (_, i) => ({ userId: 100 + i, variant: 'A', accommodation: {} }));
    const r = checkSeatCapacity({ seatMap: { layout: GOOD_LAYOUT }, students });
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => /capacity/i.test(e))).toBe(true);
  });

  it('rejects when accessible demand exceeds accessible supply', () => {
    const students = [
      { userId: 1, variant: 'A', accommodation: { accessibleSeat: true } },
      { userId: 2, variant: 'A', accommodation: { accessibleSeat: true } },
      { userId: 3, variant: 'A', accommodation: { accessibleSeat: true } },
    ];
    const r = checkSeatCapacity({ seatMap: { layout: GOOD_LAYOUT }, students }); // only 1 accessible seat
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => /accessible/i.test(e))).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════
// ACCOMMODATION-AWARE ALLOCATION (§18 — accommodation)
// ═══════════════════════════════════════════════════════════════════

describe('Seating — accommodation-aware allocation (§18)', () => {
  it('reserves accessible seats for accessible students first', () => {
    const students = [
      { userId: 1, variant: 'A', accommodation: { accessibleSeat: true } },
      { userId: 2, variant: 'B', accommodation: {} },
      { userId: 3, variant: 'C', accommodation: {} },
      { userId: 4, variant: 'A', accommodation: {} },
      { userId: 5, variant: 'B', accommodation: {} },
      { userId: 6, variant: 'C', accommodation: {} },
      { userId: 7, variant: 'A', accommodation: {} },
      { userId: 8, variant: 'B', accommodation: {} },
    ];
    const r = allocateSeats({ seatMap: { layout: GOOD_LAYOUT }, students, seed: 42 });
    expect(r.ok).toBe(true);
    const acc = r.assignments.find((a) => a.userId === 1);
    expect(acc).toBeDefined();
    expect(acc.flags).toContain('accessible_seat');
    expect(acc.rowLabel + '-' + acc.seatLabel).toBe('A-3'); // the accessible seat
  });

  it('skips separate-room students (isolated session handled by caller)', () => {
    const students = [
      { userId: 1, variant: 'A', accommodation: { separateRoom: true } },
      { userId: 2, variant: 'B', accommodation: {} },
      { userId: 3, variant: 'C', accommodation: {} },
    ];
    const r = allocateSeats({ seatMap: { layout: GOOD_LAYOUT }, students, seed: 7 });
    // separate-room student is NOT seated here
    expect(r.assignments.find((a) => a.userId === 1)).toBeUndefined();
    expect(r.assignments).toHaveLength(2);
  });

  it('flags extra_time students with the extra_time flag', () => {
    const students = [
      { userId: 1, variant: 'A', accommodation: { extraTime: true } },
      { userId: 2, variant: 'B', accommodation: {} },
      { userId: 3, variant: 'C', accommodation: {} },
      { userId: 4, variant: 'A', accommodation: {} },
      { userId: 5, variant: 'B', accommodation: {} },
      { userId: 6, variant: 'C', accommodation: {} },
      { userId: 7, variant: 'A', accommodation: {} },
      { userId: 8, variant: 'B', accommodation: {} },
    ];
    const r = allocateSeats({ seatMap: { layout: GOOD_LAYOUT }, students, seed: 11 });
    expect(r.ok).toBe(true);
    const et = r.assignments.find((a) => a.userId === 1);
    expect(et.flags).toContain('extra_time');
  });

  it('reports unseated students when capacity is exceeded', () => {
    const students = Array.from({ length: 10 }, (_, i) => ({ userId: 100 + i, variant: 'A', accommodation: {} }));
    const r = allocateSeats({ seatMap: { layout: GOOD_LAYOUT }, students, seed: 1 });
    expect(r.ok).toBe(false);
    expect(r.unseated.length).toBeGreaterThan(0);
    expect(r.assignments.length).toBeLessThanOrEqual(8);
  });
});

// ═══════════════════════════════════════════════════════════════════
// VARIANT SEPARATION + DETERMINISM
// ═══════════════════════════════════════════════════════════════════

describe('Seating — variant separation & determinism', () => {
  it('never seats two same-variant students adjacent in the same row', () => {
    const students = Array.from({ length: 8 }, (_, i) => ({ userId: 100 + i, variant: ['A', 'B', 'C'][i % 3], accommodation: {} }));
    const r = allocateSeats({ seatMap: { layout: GOOD_LAYOUT }, students, seed: 5 });
    expect(r.ok).toBe(true);
    // Check adjacency within each row: no two consecutive same-variant students
    for (const rowLabel of ['A', 'B']) {
      const rowSeats = r.assignments
        .filter((a) => a.rowLabel === rowLabel)
        .sort((a, b) => a.seatLabel.localeCompare(b.seatLabel));
      for (let i = 1; i < rowSeats.length; i++) {
        if (rowSeats[i].variant && rowSeats[i - 1].variant) {
          expect(rowSeats[i].variant).not.toBe(rowSeats[i - 1].variant);
        }
      }
    }
  });

  it('is deterministic — same seed produces identical assignments', () => {
    const students = Array.from({ length: 8 }, (_, i) => ({ userId: 100 + i, variant: ['A', 'B', 'C'][i % 3], accommodation: {} }));
    const r1 = allocateSeats({ seatMap: { layout: GOOD_LAYOUT }, students, seed: 99 });
    const r2 = allocateSeats({ seatMap: { layout: GOOD_LAYOUT }, students, seed: 99 });
    expect(r1.assignments).toEqual(r2.assignments);
  });

  it('seededShuffle is deterministic and preserves elements', () => {
    const items = [1, 2, 3, 4, 5, 6, 7, 8];
    const s1 = seededShuffle(items, 13);
    const s2 = seededShuffle(items, 13);
    expect(s1).toEqual(s2);
    expect([...s1].sort()).toEqual(items);
  });

  it('createSeededRng produces reproducible float sequences', () => {
    const a = createSeededRng(1234);
    const b = createSeededRng(1234);
    const seqA = Array.from({ length: 5 }, () => a());
    const seqB = Array.from({ length: 5 }, () => b());
    expect(seqA).toEqual(seqB);
    seqA.forEach((v) => expect(v).toBeGreaterThanOrEqual(0));
    seqA.forEach((v) => expect(v).toBeLessThan(1));
  });
});

// ═══════════════════════════════════════════════════════════════════
// PROCTOR ALLOCATOR (§19 — clash / workload)
// ═══════════════════════════════════════════════════════════════════

describe('Seating — proctor allocator (§19)', () => {
  it('never assigns the same proctor to two rooms in the same period', () => {
    const slots = [
      { periodId: 1, roomId: 1 },
      { periodId: 1, roomId: 2 },
      { periodId: 1, roomId: 3 },
      { periodId: 2, roomId: 1 },
      { periodId: 2, roomId: 2 },
    ];
    const proctors = [
      { userId: 501, maxPerDay: 4, availability: [1, 2] },
      { userId: 502, maxPerDay: 4, availability: [1, 2] },
      { userId: 503, maxPerDay: 4, availability: [1, 2] },
    ];
    const r = allocateProctorDuties({ slots, proctors, seed: 3 });
    expect(r.ok).toBe(true);
    const verify = verifyProctorNoClash(r.duties);
    expect(verify.ok).toBe(true);
    expect(verify.clashes).toEqual([]);
  });

  it('leaves slots unassigned when no available proctor exists', () => {
    const slots = [
      { periodId: 1, roomId: 1 },
      { periodId: 1, roomId: 2 },
    ];
    // only one proctor → second room in same period cannot be covered
    const proctors = [{ userId: 501, maxPerDay: 4, availability: [1] }];
    const r = allocateProctorDuties({ slots, proctors, seed: 1 });
    expect(r.ok).toBe(false);
    expect(r.unassigned.length).toBeGreaterThan(0);
  });

  it('respects availability — a proctor is not used outside their availability', () => {
    const slots = [
      { periodId: 1, roomId: 1 },
      { periodId: 2, roomId: 1 },
    ];
    const proctors = [
      { userId: 501, maxPerDay: 4, availability: [1] }, // only period 1
      { userId: 502, maxPerDay: 4, availability: [1, 2] },
    ];
    const r = allocateProctorDuties({ slots, proctors, seed: 1 });
    expect(r.ok).toBe(true);
    const p2 = r.duties.find((d) => d.periodId === 2);
    expect(p2.proctorUserId).toBe(502);
  });

  it('balances workload — least-loaded proctor is preferred', () => {
    const slots = [
      { periodId: 1, roomId: 1 },
      { periodId: 2, roomId: 1 },
      { periodId: 3, roomId: 1 },
      { periodId: 4, roomId: 1 },
      { periodId: 5, roomId: 1 },
      { periodId: 6, roomId: 1 },
    ];
    const proctors = [
      { userId: 501, maxPerDay: 6, availability: [1, 2, 3, 4, 5, 6] },
      { userId: 502, maxPerDay: 6, availability: [1, 2, 3, 4, 5, 6] },
    ];
    const r = allocateProctorDuties({ slots, proctors, seed: 8 });
    expect(r.ok).toBe(true);
    // workload max spread is at most 1 (fairness)
    const loads = Object.values(r.workload);
    expect(Math.max(...loads) - Math.min(...loads)).toBeLessThanOrEqual(1);
  });
});

// ═══════════════════════════════════════════════════════════════════
// HALL TICKET (§20 — signed payload, NO answer keys / raw reasons)
// ═══════════════════════════════════════════════════════════════════

describe('Seating — hall ticket signing & safety (§15/§20)', () => {
  it('builds a canonical payload WITHOUT answer keys or raw sensitive reasons', () => {
    const payload = buildHallTicketPayload({
      assignmentId: 7,
      runId: 1,
      eventId: 2,
      periodId: 1,
      roomId: 3,
      studentUserId: 42,
      rowLabel: 'A',
      seatLabel: '3',
      variant: 'B',
      accommodationFlags: ['accessible_seat', 'extra_time', 'sensitive'],
      seatMapVersion: 2,
      issuedAt: 1234567890,
    });
    const json = JSON.stringify(payload);
    expect(json).not.toMatch(/answer|key|correct|raw|reason/i);
    expect(payload.accommodationFlags).not.toContain('sensitive');
    expect(payload.accommodationFlags).toContain('accessible_seat');
    expect(payload.type).toBe('hall_ticket');
    expect(payload.variant).toBe('B');
  });

  it('signs and verifies a token (HMAC)', () => {
    const payload = buildHallTicketPayload({
      assignmentId: 1, runId: 1, eventId: 1, periodId: 1, roomId: 1,
      studentUserId: 42, rowLabel: 'A', seatLabel: '1', variant: 'A',
      issuedAt: Date.now(),
    });
    const token = signHallTicketToken(payload, SIGNING_KEY);
    expect(token).toMatch(/^[0-9a-f]{64}$/);
    expect(verifyHallTicketToken(payload, token, SIGNING_KEY)).toBe(true);
  });

  it('rejects a tampered payload or wrong key', () => {
    const payload = buildHallTicketPayload({
      assignmentId: 1, runId: 1, eventId: 1, periodId: 1, roomId: 1,
      studentUserId: 42, rowLabel: 'A', seatLabel: '1', variant: 'A',
      issuedAt: Date.now(),
    });
    const token = signHallTicketToken(payload, SIGNING_KEY);
    expect(verifyHallTicketToken({ ...payload, seatLabel: '2' }, token, SIGNING_KEY)).toBe(false);
    expect(verifyHallTicketToken(payload, token, 'wrong-key-wrong-key-wrong-key-0000')).toBe(false);
  });

  it('returns false for empty token or key', () => {
    const payload = { assignmentId: 1 };
    expect(verifyHallTicketToken(payload, '', SIGNING_KEY)).toBe(false);
    expect(verifyHallTicketToken(payload, 'abcd', '')).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════
// OFFLINE CHECK-IN JOURNAL (§20 — offline check-in)
// ═══════════════════════════════════════════════════════════════════

describe('Seating — offline check-in journal (§20)', () => {
  it('builds a canonical entry with a valid event type', () => {
    const e = buildCheckinEntry({ deviceId: 'tab-1', clientSeq: 3, eventType: 'checkin', payload: { a: 1 } });
    expect(e.deviceId).toBe('tab-1');
    expect(e.clientSeq).toBe(3);
    expect(e.status).toBe('pending');
    // unknown event type falls back to checkin
    const bad = buildCheckinEntry({ deviceId: 'x', clientSeq: 1, eventType: 'nope' });
    expect(CHECKIN_EVENT_TYPES).toContain(bad.eventType);
  });

  it('computes the highest contiguous acked sequence', () => {
    expect(highestContiguousSeq([1, 2, 3, 5, 6])).toBe(3); // gap at 4
    expect(highestContiguousSeq([1, 2, 3, 4])).toBe(4);
    expect(highestContiguousSeq([])).toBe(0);
    expect(highestContiguousSeq([7])).toBe(0); // 1 missing
  });

  it('reconciles pending entries and computes next acked watermark', () => {
    const entries = [
      { clientSeq: 1, eventType: 'checkin', payload: {} },
      { clientSeq: 2, eventType: 'checkin', payload: {} },
      { clientSeq: 4, eventType: 'checkin', payload: {} },
    ];
    const r = reconcileCheckinJournal({ entries, ackedSeq: 1 });
    expect(r.toDrop).toHaveLength(1); // seq 1 already acked
    expect(r.toApply.map((e) => e.clientSeq)).toEqual([2, 4]);
    expect(r.nextAckedSeq).toBe(2); // 3 missing → watermark stays at 2
  });
});

// ═══════════════════════════════════════════════════════════════════
// RESEAT AUDIT (§20 — reason CODES only)
// ═══════════════════════════════════════════════════════════════════

describe('Seating — reseat audit (§20)', () => {
  it('accepts known reason codes', () => {
    for (const reason of RESEAT_REASONS) {
      const r = buildReseatAuditEntry({ runId: 1, studentUserId: 2, fromSeatAssignmentId: 1, toSeatAssignmentId: 3, reason, actorUserId: 9 });
      expect(r.ok).toBe(true);
      expect(r.entry.reason).toBe(reason);
    }
  });

  it('REJECTS a raw rationale string (security: reason codes only)', () => {
    const r = buildReseatAuditEntry({ runId: 1, studentUserId: 2, reason: 'student had a panic attack and needed to move near the window', actorUserId: 9 });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Invalid reseat reason/);
  });
});
