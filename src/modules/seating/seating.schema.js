/**
 * Deborah — Seat, Proctor, Hall Ticket & Check-in (pure logic)
 *
 * Prompt 40 — published schedule asosida seat/proctor assignment va
 * offline-tolerant check-in (research.md §15 relational schema, §53.3
 * Seating). This module is PURE (no I/O, no globals):
 *
 *   - Room seat-map: validateLayout — rows/seats grid, per-seat features,
 *     accessible reserved seats, version.
 *   - Seat allocator: allocateSeats — deterministic (seeded), random /
 *     variant-separated / accommodation-aware:
 *       • students seated randomly within their room (deterministic seed);
 *       • variant separation: same-variant students are NOT adjacent;
 *       • accommodation: accessible seats reserved first, extra_time seats
 *         near aisle/exit, separate_room → isolated (own session).
 *   - Proctor allocator: allocateProctorDuties — no same-period clash,
 *     workload fairness (min max load), deterministic seed.
 *   - Hall ticket: buildHallTicketPayload + signHallTicketToken — signed
 *     QR payload; NEVER contains answer keys or raw sensitive reasons
 *     (only non-sensitive accommodation_flags + variant).
 *   - Offline check-in journal: buildCheckinEntry, highestContiguousSeq,
 *     reconcileCheckinJournal — offline-tolerant idempotent replay.
 *   - Reseat audit: buildReseatAuditEntry — non-sensitive reason codes.
 *   - Verification: verifyHallTicket, checkSeatCapacity.
 *
 * SECURITY / DATA GUARD (Prompt 40 §15):
 *   - Seat QR / hall ticket payload answer key yoki raw sensitive reason
 *     saqlamaydi — faqat token hash + non-sensitive flags.
 *   - Reseat reason: faqat kodlar ('no_show', 'accessibility', ...), hech
 *     qachon raw rationale matni emas.
 *
 * Purity: deterministic, side-effect-free (node:crypto import is compute-only,
 * not I/O — used for HMAC hall-ticket tokens).
 */

import { createHmac, timingSafeEqual } from 'node:crypto';

// ═══════════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════════

export const SEAT_MAP_STATUS = {
  ACTIVE: 'active',
  INACTIVE: 'inactive',
};

export const DUTY_STATUS = {
  ASSIGNED: 'assigned',
  ACKNOWLEDGED: 'acknowledged',
  REPLACED: 'replaced',
};

export const CHECKIN_EVENT_TYPES = ['checkin', 'ack_ticket', 'reseat'];

export const CHECKIN_STATUS = {
  PENDING: 'pending',
  APPLIED: 'applied',
  REJECTED: 'rejected',
};

export const RESEAT_REASONS = [
  'no_show',
  'accessibility',
  'disruption',
  'replacement',
  'identity_verification',
];

export const DEFAULT_VARIANTS = ['A', 'B', 'C'];

/** Hall-ticket token HMAC key length requirement (32+ bytes). */
export const MIN_SIGNING_KEY_LENGTH = 32;

// ═══════════════════════════════════════════════════════════════════
// DETERMINISTIC SEEDED PRNG (re-exported pattern — mulberry32)
// ═══════════════════════════════════════════════════════════════════

/**
 * Deterministic 32-bit seeded PRNG (mulberry32). Same seed → same sequence
 * on every platform — seat/proctor allocation is reproducible.
 *
 * @param {number} seed
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
 * Deterministic seeded Fisher–Yates shuffle.
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
// ROOM SEAT-MAP
// ═══════════════════════════════════════════════════════════════════

/**
 * Flatten a seat-map layout into a list of seat descriptors.
 *
 * @param {Object} layout - { rows: [{ label, seats: [{ label, features: [], accessible }] }] }
 * @returns {Array<{ rowLabel: string, seatLabel: string, features: string[], accessible: boolean }>}
 */
export function flattenSeatMap(layout = {}) {
  const seats = [];
  for (const row of layout.rows || []) {
    for (const seat of row.seats || []) {
      seats.push({
        rowLabel: String(row.label ?? ''),
        seatLabel: String(seat.label ?? ''),
        features: Array.isArray(seat.features) ? seat.features : [],
        accessible: Boolean(seat.accessible),
      });
    }
  }
  return seats;
}

/**
 * Validate a room seat-map layout.
 *
 * Rules:
 *   - must have at least one row with at least one seat
 *   - row labels unique; seat labels unique within a row
 *   - full seat label (row+seat) must be unique across the map
 *   - accessible seats must have 'wheelchair_access' feature
 *
 * @param {Object} layout
 * @returns {{ ok: boolean, errors: string[], seatCount: number, accessibleSeats: string[] }}
 */
export function validateSeatMapLayout(layout = {}) {
  const errors = [];
  const rows = Array.isArray(layout.rows) ? layout.rows : [];
  if (rows.length === 0) {
    errors.push('Seat map must contain at least one row');
    return { ok: false, errors, seatCount: 0, accessibleSeats: [] };
  }

  const rowLabels = new Set();
  const fullLabels = new Set();
  const accessibleSeats = [];
  let seatCount = 0;

  for (const row of rows) {
    const rl = String(row.label ?? '');
    if (!rl) errors.push('Row label is required');
    else if (rowLabels.has(rl)) errors.push(`Duplicate row label "${rl}"`);
    rowLabels.add(rl);

    const seatLabels = new Set();
    for (const seat of row.seats || []) {
      const sl = String(seat.label ?? '');
      if (!sl) errors.push(`Seat label required in row "${rl}"`);
      else if (seatLabels.has(sl)) errors.push(`Duplicate seat label "${sl}" in row "${rl}"`);
      seatLabels.add(sl);

      const full = `${rl}-${sl}`;
      if (fullLabels.has(full)) errors.push(`Duplicate full seat label "${full}"`);
      fullLabels.add(full);

      seatCount += 1;
      const features = Array.isArray(seat.features) ? seat.features : [];
      if (seat.accessible && !features.includes('wheelchair_access')) {
        errors.push(`Accessible seat "${full}" must have wheelchair_access feature`);
      }
      if (seat.accessible) accessibleSeats.push(full);
    }
  }

  if (seatCount === 0) errors.push('Seat map must contain at least one seat');

  return { ok: errors.length === 0, errors, seatCount, accessibleSeats };
}

// ═══════════════════════════════════════════════════════════════════
// SEAT ALLOCATOR (random / variant-separated / accommodation-aware)
// ═══════════════════════════════════════════════════════════════════

/**
 * Allocate students to seats within a single room session.
 *
 * Inputs:
 *   - seatMap: { layout } — room layout
 *   - students: [{ userId, variant, accommodation: { extraTime, accessibleSeat, separateRoom } }]
 *   - seed: deterministic
 *
 * Strategy (explainable, §53.3):
 *   1. Accessible students get accessible seats first (reserved).
 *   2. Separate-room students must NOT be mixed here — caller handles them
 *      in an isolated room; we skip them.
 *   3. Remaining students shuffled deterministically, then seated row by
 *      row with variant separation: if the next seat's neighbor (previous
 *      seat in the same row) has the same variant, skip to the next row.
 *   4. Extra-time students are biased toward row 0 (near aisle/exit) when
 *      possible.
 *
 * @param {Object} params
 * @param {Object} params.seatMap - { layout }
 * @param {Array<Object>} params.students - [{ userId, variant, accommodation }]
 * @param {number} [params.seed]
 * @returns {{
 *   ok: boolean, errors: string[],
 *   assignments: Array<{ userId, rowLabel, seatLabel, variant, flags: string[] }>,
 *   unseated: Array<{ userId, reason: string }>
 * }}
 */
export function allocateSeats({ seatMap = {}, students = [], seed = 1 } = {}) {
  const errors = [];
  const layoutCheck = validateSeatMapLayout(seatMap.layout);
  if (!layoutCheck.ok) {
    return { ok: false, errors: layoutCheck.errors, assignments: [], unseated: students.map((s) => ({ userId: s.userId, reason: 'invalid_seat_map' })) };
  }

  const allSeats = flattenSeatMap(seatMap.layout);
  const assignments = [];
  const unseated = [];
  const used = new Set();

  // ── 1. Accessible students → accessible seats (reserved first) ──
  const accessibleStudents = students.filter((s) => s.accommodation?.accessibleSeat);
  const accessibleSeatPool = allSeats.filter((s) => s.accessible);
  const shuffledAccessible = seededShuffle(accessibleSeatPool, seed + 1);
  for (let i = 0; i < accessibleStudents.length; i++) {
    const s = accessibleStudents[i];
    const seat = shuffledAccessible[i];
    if (!seat) {
      unseated.push({ userId: s.userId, reason: 'no_accessible_seat' });
      continue;
    }
    used.add(`${seat.rowLabel}-${seat.seatLabel}`);
    assignments.push({
      userId: s.userId,
      rowLabel: seat.rowLabel,
      seatLabel: seat.seatLabel,
      variant: s.variant || null,
      flags: ['accessible_seat'],
    });
  }

  // ── 2. Remaining students (skip separate-room — isolated session) ──
  const remaining = students.filter((s) => {
    if (s.accommodation?.separateRoom) return false; // handled by caller
    return !s.accommodation?.accessibleSeat;
  });
  const unassignedIds = new Set(remaining.map((s) => s.userId));

  // Extra-time students biased toward row 0 (near aisle/exit).
  const extraTimeFirst = [...remaining].sort((a, b) => {
    const ae = a.accommodation?.extraTime ? 0 : 1;
    const be = b.accommodation?.extraTime ? 0 : 1;
    return ae - be;
  });
  const shuffled = seededShuffle(extraTimeFirst, seed + 2);

  // Per-row free seat lists (full layout order). Accessible seats are
  // RESERVED for accessible students first (step 1); any that remain unused
  // are returned to the pool so regular students can use them — a reserved
  // accessible seat is never wasted when no accessible student claims it.
  const rows = (seatMap.layout.rows || []).map((r) => ({
    rowLabel: String(r.label ?? ''),
    seats: (r.seats || [])
      .map((s) => ({ rowLabel: String(r.label ?? ''), seatLabel: String(s.label ?? '') }))
      .filter((s) => !used.has(`${s.rowLabel}-${s.seatLabel}`)),
  }));
  const rowSeatLists = rows.map((r) => [...r.seats]);
  const rowStudents = rows.map(() => []);
  const rowLoad = rows.map(() => 0);

  // Distribute students to rows: round-robin by VARIANT so every row keeps a
  // balanced variant mix (separation is then achievable row-locally — see
  // arrangeRowVariants). Extra-time students go first and prefer row 0.
  for (const s of shuffled) {
    if (!unassignedIds.has(s.userId)) continue;
    const candidates = rows.map((_, i) => i).filter((i) => rowLoad[i] < rowSeatLists[i].length);
    if (candidates.length === 0) {
      unseated.push({ userId: s.userId, reason: 'no_free_seat' });
      unassignedIds.delete(s.userId);
      continue;
    }
    let best = candidates[0];
    let bestScore = Infinity;
    for (const i of candidates) {
      const sameVariant = rowStudents[i].filter((x) => (x.variant || null) === (s.variant || null)).length;
      const extraBias = s.accommodation?.extraTime ? i * 0.001 : 0;
      const score = sameVariant * 10 + rowLoad[i] + extraBias;
      if (score < bestScore) {
        bestScore = score;
        best = i;
      }
    }
    rowStudents[best].push(s);
    rowLoad[best] += 1;
  }

  // ── 3. Per-row arrangement (max-count greedy over variants) ──
  // Seats in each row are filled in layout order; the variant with the most
  // remaining students that differs from the previously placed one is chosen
  // next. Same-variant adjacency only occurs when unavoidable (pigeonhole:
  // a variant count > ceil((n+1)/2) in a row of n).
  for (let i = 0; i < rows.length; i++) {
    const arranged = arrangeRowVariants(rowStudents[i]);
    for (let j = 0; j < arranged.length; j++) {
      const seat = rowSeatLists[i][j];
      if (!seat) break;
      used.add(`${seat.rowLabel}-${seat.seatLabel}`);
      assignments.push({
        userId: arranged[j].userId,
        rowLabel: seat.rowLabel,
        seatLabel: seat.seatLabel,
        variant: arranged[j].variant,
        flags: arranged[j].flags,
      });
    }
  }

  return { ok: unseated.length === 0, errors, assignments, unseated };
}

/**
 * Arrange a row's students so that no two same-variant students sit
 * adjacent, whenever the variant multiset allows it (max-count greedy).
 *
 * @param {Array<Object>} students - [{ userId, variant, accommodation }]
 * @returns {Array<{ userId, variant, flags }>} arranged order (row fill order)
 */
function arrangeRowVariants(students = []) {
  const list = [...students];
  const total = list.length;
  const counts = new Map();
  for (const s of list) {
    const v = s.variant || 'NONE';
    counts.set(v, (counts.get(v) || 0) + 1);
  }
  const out = [];
  let last = null;
  // NOTE: iterate against the FIXED total — list shrinks via splice and
  // comparing against the live length would stop the loop early (dropping
  // students).
  while (out.length < total) {
    let chosen = null;
    // Pick the most numerous variant that differs from the last placed one.
    for (const [v, c] of counts) {
      if (c === 0 || v === last) continue;
      if (chosen === null || c > counts.get(chosen)) chosen = v;
    }
    if (chosen === null) {
      // Only the same variant remains — adjacency is unavoidable (pigeonhole).
      for (const [v, c] of counts) {
        if (c > 0) {
          chosen = v;
          break;
        }
      }
    }
    if (chosen === null) break; // safety — no students left
    const idx = list.findIndex((s) => (s.variant || 'NONE') === chosen);
    const st = list[idx];
    list.splice(idx, 1);
    out.push({
      userId: st.userId,
      variant: st.variant || null,
      flags: st.accommodation?.extraTime ? ['extra_time'] : [],
    });
    counts.set(chosen, counts.get(chosen) - 1);
    last = chosen;
  }
  return out;
}

/**
 * Check seat capacity: students must fit the seat count, accessible demand
 * must fit accessible supply.
 *
 * @param {Object} params
 * @returns {{ ok: boolean, errors: string[] }}
 */
export function checkSeatCapacity({ seatMap = {}, students = [] } = {}) {
  const errors = [];
  const layoutCheck = validateSeatMapLayout(seatMap.layout);
  if (!layoutCheck.ok) return { ok: false, errors: layoutCheck.errors };

  const studentCount = students.length;
  if (studentCount > layoutCheck.seatCount) {
    errors.push(`Room capacity ${layoutCheck.seatCount} < ${studentCount} students`);
  }
  const accessibleDemand = students.filter((s) => s.accommodation?.accessibleSeat).length;
  if (accessibleDemand > layoutCheck.accessibleSeats.length) {
    errors.push(`Accessible demand ${accessibleDemand} > ${layoutCheck.accessibleSeats.length} accessible seats`);
  }
  return { ok: errors.length === 0, errors };
}

// ═══════════════════════════════════════════════════════════════════
// PROCTOR ALLOCATOR (availability + workload fairness)
// ═══════════════════════════════════════════════════════════════════

/**
 * Allocate proctors to (period, room) duty slots deterministically.
 *
 * Hard: a proctor cannot serve two rooms in the same period (clash).
 * Soft: workload fairness — minimize the max number of duties per proctor.
 *
 * @param {Object} params
 * @param {Array<Object>} params.slots - [{ periodId, roomId }]
 * @param {Array<Object>} params.proctors - [{ userId, maxPerDay, availability: Array<periodId> }]
 * @param {number} [params.seed]
 * @returns {{
 *   ok: boolean, errors: string[],
 *   duties: Array<{ periodId, roomId, proctorUserId }>,
 *   unassigned: Array<{ periodId, roomId }>,
 *   workload: Object // proctorUserId → count
 * }}
 */
export function allocateProctorDuties({ slots = [], proctors = [], seed = 1 } = {}) {
  const errors = [];
  if (slots.length === 0) {
    return { ok: false, errors: ['No duty slots provided'], duties: [], unassigned: [], workload: {} };
  }
  void seed; // seed retained for API compatibility; order is deterministic regardless
  if (proctors.length === 0) {
    return { ok: false, errors: ['No proctors available'], duties: [], unassigned: slots, workload: {} };
  }

  const duties = [];
  const unassigned = [];
  const workload = {};

  for (const p of proctors) workload[p.userId] = 0;

  // Group slots by period so the per-period clash constraint is handled
  // together and loads stay balanced. Deterministic (seed no longer needed
  // for slot order — fairness comes from least-loaded selection).
  const byPeriod = new Map();
  for (const slot of slots) {
    if (!byPeriod.has(slot.periodId)) byPeriod.set(slot.periodId, []);
    byPeriod.get(slot.periodId).push(slot);
  }
  const periodIds = [...byPeriod.keys()].sort((a, b) => a - b);

  for (const periodId of periodIds) {
    const periodSlots = byPeriod.get(periodId).sort((a, b) => a.roomId - b.roomId);
    const usedInPeriod = new Set(); // proctor clash guard per period
    for (const slot of periodSlots) {
      const candidates = proctors.filter((p) => {
        if (usedInPeriod.has(p.userId)) return false; // clash
        if (p.availability && !p.availability.includes(periodId)) return false;
        const max = Number(p.maxPerDay) || 4;
        return (workload[p.userId] || 0) < max;
      });

      if (candidates.length === 0) {
        unassigned.push({ periodId: slot.periodId, roomId: slot.roomId });
        continue;
      }

      // Least-loaded first (deterministic tie-break by userId).
      candidates.sort((a, b) => {
        const diff = (workload[a.userId] || 0) - (workload[b.userId] || 0);
        return diff !== 0 ? diff : String(a.userId).localeCompare(String(b.userId));
      });
      const chosen = candidates[0];

      usedInPeriod.add(chosen.userId);
      workload[chosen.userId] = (workload[chosen.userId] || 0) + 1;
      duties.push({ periodId: slot.periodId, roomId: slot.roomId, proctorUserId: chosen.userId });
    }
  }

  return { ok: unassigned.length === 0, errors, duties, unassigned, workload };
}

/**
 * Independent proctor clash verification (for property/contract tests):
 * no proctor appears twice in the same period.
 *
 * @param {Array<Object>} duties - [{ periodId, proctorUserId }]
 * @returns {{ ok: boolean, clashes: Array<Object> }}
 */
export function verifyProctorNoClash(duties = []) {
  const byPeriod = new Map();
  const clashes = [];
  for (const d of duties) {
    if (!byPeriod.has(d.periodId)) byPeriod.set(d.periodId, new Map());
    const map = byPeriod.get(d.periodId);
    if (map.has(d.proctorUserId)) {
      clashes.push({ periodId: d.periodId, proctorUserId: d.proctorUserId });
    }
    map.set(d.proctorUserId, true);
  }
  return { ok: clashes.length === 0, clashes };
}

// ═══════════════════════════════════════════════════════════════════
// HALL TICKET (signed QR payload)
// ═══════════════════════════════════════════════════════════════════

/**
 * Build the hall-ticket payload (what goes into the QR).
 *
 * SECURITY (§15): NO answer keys, NO raw sensitive accommodation reasons.
 * Only: assignment id, run id, event/period/room ids, seat, variant,
 * non-sensitive flags, seat-map version, issued-at, token hash.
 *
 * @param {Object} params
 * @returns {Object} canonical payload
 */
export function buildHallTicketPayload({
  assignmentId,
  runId,
  eventId,
  periodId,
  roomId,
  studentUserId,
  rowLabel,
  seatLabel,
  variant,
  accommodationFlags = [],
  seatMapVersion = 1,
  issuedAt,
}) {
  return {
    v: 1,
    type: 'hall_ticket',
    assignmentId,
    runId,
    eventId,
    periodId,
    roomId,
    studentUserId,
    rowLabel,
    seatLabel,
    variant: variant || null,
    accommodationFlags: accommodationFlags.filter((f) => f !== 'sensitive'), // never raw
    seatMapVersion,
    issuedAt,
  };
}

/**
 * Sign the hall-ticket payload with HMAC-SHA256 and return the hex token.
 *
 * NOTE (ESM-safe): node:crypto is imported at module top; no require()
 * fallback — a forgeable "signature" would silently break the security
 * contract of Prompt 40 §15.
 *
 * @param {Object} payload - canonical hall-ticket payload
 * @param {string} key - HMAC signing key (≥32 bytes)
 * @returns {string} hex token
 */
export function signHallTicketToken(payload = {}, key = '') {
  const canonical = JSON.stringify(payload);
  return createHmac('sha256', String(key)).update(canonical).digest('hex');
}

/**
 * Verify a hall-ticket token against a payload (timing-safe compare).
 *
 * @param {Object} payload
 * @param {string} token
 * @param {string} key
 * @returns {boolean}
 */
export function verifyHallTicketToken(payload = {}, token = '', key = '') {
  if (!token || !key) return false;
  const expected = Buffer.from(signHallTicketToken(payload, key), 'hex');
  const actual = Buffer.from(String(token), 'hex');
  if (expected.length !== actual.length) return false;
  return timingSafeEqual(expected, actual);
}

// ═══════════════════════════════════════════════════════════════════
// OFFLINE CHECK-IN JOURNAL
// ═══════════════════════════════════════════════════════════════════

/**
 * Build a canonical check-in journal entry.
 *
 * @param {Object} params
 * @returns {Object} entry
 */
export function buildCheckinEntry({ deviceId, clientSeq, eventType, payload = {}, ackedSeq = 0 } = {}) {
  return {
    deviceId: String(deviceId || ''),
    clientSeq: Number(clientSeq) || 0,
    eventType: CHECKIN_EVENT_TYPES.includes(eventType) ? eventType : 'checkin',
    payload,
    ackedSeq: Number(ackedSeq) || 0,
    status: CHECKIN_STATUS.PENDING,
  };
}

/**
 * Highest contiguous applied sequence — high-water mark for replay.
 *
 * @param {Array<number>} seqs
 * @returns {number}
 */
export function highestContiguousSeq(seqs = []) {
  const set = new Set(seqs);
  let h = 0;
  while (set.has(h + 1)) h += 1;
  return h;
}

/**
 * Reconcile an offline journal: drop applied entries (seq ≤ ackedSeq),
 * keep pending ones ordered, and compute the next contiguous watermark.
 *
 * @param {Object} params
 * @param {Array<Object>} params.entries - journal entries (sorted by clientSeq)
 * @param {number} params.ackedSeq
 * @returns {{ toApply: Array<Object>, toDrop: Array<Object>, nextAckedSeq: number }}
 */
export function reconcileCheckinJournal({ entries = [], ackedSeq = 0 } = {}) {
  const sorted = [...entries].sort((a, b) => a.clientSeq - b.clientSeq);
  const toDrop = sorted.filter((e) => e.clientSeq <= ackedSeq);
  const pending = sorted.filter((e) => e.clientSeq > ackedSeq);
  // Watermark advances FORWARD from the current ackedSeq over pending seqs.
  // (Do NOT rebuild a Set from scratch — that would drop already-acked
  // seqs < ackedSeq and undercount the contiguous watermark.)
  const pendingSeqs = new Set(pending.map((e) => e.clientSeq));
  let next = Number(ackedSeq) || 0;
  while (pendingSeqs.has(next + 1)) next += 1;
  return { toApply: pending, toDrop, nextAckedSeq: next };
}

// ═══════════════════════════════════════════════════════════════════
// RESEAT AUDIT
// ═══════════════════════════════════════════════════════════════════

/**
 * Build a reseat audit entry. Reason is a CODE (never raw rationale).
 *
 * @param {Object} params
 * @returns {{ ok: boolean, error?: string, entry?: Object }}
 */
export function buildReseatAuditEntry({
  runId,
  studentUserId,
  fromSeatAssignmentId,
  toSeatAssignmentId,
  reason,
  actorUserId,
} = {}) {
  if (!RESEAT_REASONS.includes(reason)) {
    return { ok: false, error: `Invalid reseat reason "${reason}" — use a code from ${RESEAT_REASONS.join(', ')}` };
  }
  return {
    ok: true,
    entry: {
      runId,
      studentUserId,
      fromSeatAssignmentId,
      toSeatAssignmentId,
      reason,
      actorUserId,
    },
  };
}
