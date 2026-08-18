/**
 * Deborah — Uch-strike Client Collector & Server Classifier Tests
 *
 * Covers (Prompt 34, research.md §31):
 *   - Raw event validation (shape contract)
 *   - 1.9s / 2.1s threshold boundary (§18)
 *   - Technical exclusions: blur / network / camera are NEVER strikes (§15)
 *   - Dedupe: blur+hidden+fullscreen overlap / 5000ms window → ONE strike (§19)
 *   - Strike lifecycle: warning 1 → warning 2 → terminate on the 3rd (§13)
 *   - Hash chain: deterministic, tamper-evident (§31.5)
 *   - Old-epoch reject on reopen (§20)
 *   - Timeline contract (explainable, no "cheat probability" — §31.2)
 *   - Service graceful degradation without PostgreSQL
 *   - Barrel export
 */

import { describe, it, expect } from 'vitest';

import {
  // schema (pure)
  STRIKE_THRESHOLD_MS,
  DEDUPE_WINDOW_MS,
  STRIKE_LIMIT,
  PROCTOR_EVENT_TYPES,
  TECHNICAL_EVENT_TYPES,
  FOCUS_LOSS_TYPES,
  STRIKE_LEVELS,
  validateProctorEvent,
  classifyProctorEvent,
  dedupeEvent,
  strikeLevelFor,
  hashChainEvent,
  evaluateProctorEpoch,
  buildTimelineEntry,
} from '../../src/modules/proctor/proctor.schema.js';

import {
  // service
  recordProctorEvents,
  getProctorState,
  reopenAttempt,
} from '../../src/modules/proctor/proctor.service.js';

// ═══════════════════════════════════════════════════════════════════
// RAW EVENT VALIDATION
// ═══════════════════════════════════════════════════════════════════

describe('Proctor — Raw Event Validation', () => {
  const mk = (over = {}) => ({
    clientSeq: 1,
    eventType: PROCTOR_EVENT_TYPES.VISIBILITY_HIDDEN,
    startedAt: Date.UTC(2026, 8, 1, 9, 0, 0),
    durationMs: 4000,
    deviceId: 'dev-1',
    epoch: 1,
    ...over,
  });

  it('should accept a valid raw event', () => {
    expect(validateProctorEvent(mk()).ok).toBe(true);
  });

  it('should reject malformed events', () => {
    expect(validateProctorEvent({}).ok).toBe(false);
    expect(validateProctorEvent(mk({ clientSeq: 0 })).ok).toBe(false);
    expect(validateProctorEvent(mk({ eventType: 'hacker_event' })).ok).toBe(false);
    expect(validateProctorEvent(mk({ startedAt: 'x' })).ok).toBe(false);
    expect(validateProctorEvent(mk({ durationMs: -5 })).ok).toBe(false);
    expect(validateProctorEvent(mk({ deviceId: '' })).ok).toBe(false);
    expect(validateProctorEvent(mk({ epoch: 'x' })).ok).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════
// THRESHOLD BOUNDARY (§18 — 1.9s / 2.1s)
// ═══════════════════════════════════════════════════════════════════

describe('Proctor — 2000ms Threshold Boundary', () => {
  it('should NOT strike a 1.9s focus loss (below threshold)', () => {
    const c = classifyProctorEvent({ eventType: 'visibility_hidden', durationMs: 1900 });
    expect(c.confirmed).toBe(false);
    expect(c.reason).toBe('below_threshold');
  });

  it('should strike a 2.1s focus loss (above threshold)', () => {
    const c = classifyProctorEvent({ eventType: 'visibility_hidden', durationMs: 2100 });
    expect(c.confirmed).toBe(true);
    expect(c.reason).toBe('focus_loss_strike');
  });

  it('should strike at EXACTLY the threshold (2000ms inclusive)', () => {
    expect(classifyProctorEvent({ eventType: 'fullscreen_exit', durationMs: STRIKE_THRESHOLD_MS }).confirmed).toBe(true);
  });

  it('should use the same threshold for fullscreen and visibility', () => {
    expect(classifyProctorEvent({ eventType: 'fullscreen_exit', durationMs: 2100 }).confirmed).toBe(true);
    expect(classifyProctorEvent({ eventType: 'visibility_hidden', durationMs: 2100 }).confirmed).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════
// TECHNICAL / ACCOMMODATION EXCLUSIONS (§15)
// ═══════════════════════════════════════════════════════════════════

describe('Proctor — Technical Exclusions', () => {
  it('should NEVER strike blur, network offline or camera failure', () => {
    for (const t of ['blur', 'network_offline', 'camera_failure']) {
      const c = classifyProctorEvent({ eventType: t, durationMs: 60000 }); // even 60s!
      expect(c.confirmed, t).toBe(false);
      expect(c.technical, t).toBe(true);
    }
  });

  it('should classify only visibility_hidden and fullscreen_exit as focus-loss', () => {
    expect(TECHNICAL_EVENT_TYPES.has('blur')).toBe(true);
    expect(FOCUS_LOSS_TYPES.has('visibility_hidden')).toBe(true);
    expect(FOCUS_LOSS_TYPES.has('fullscreen_exit')).toBe(true);
    expect(FOCUS_LOSS_TYPES.has('blur')).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════
// DEDUPE (§19 — blur+hidden+fullscreen overlap → ONE strike)
// ═══════════════════════════════════════════════════════════════════

describe('Proctor — Dedupe (overlap / 5000ms window)', () => {
  const T0 = Date.UTC(2026, 8, 1, 9, 0, 0);

  it('should dedupe OVERLAPPING incidents (same focus-loss episode)', () => {
    const confirmed = [{ clientSeq: 1, startedAt: T0, durationMs: 4000 }];
    // A second event that overlaps the same time window is the same incident:
    const r = dedupeEvent({ event: { startedAt: T0 + 1000, durationMs: 2000 }, confirmed });
    expect(r.deduped).toBe(true);
    expect(r.reason).toBe('overlap_dedupe');
    expect(r.withSeq).toBe(1);
  });

  it('should dedupe events within the 5000ms window even without overlap', () => {
    const confirmed = [{ clientSeq: 1, startedAt: T0, durationMs: 2000 }];
    // 4000ms later — no overlap, but within the 5000ms window → same incident
    const r = dedupeEvent({ event: { startedAt: T0 + 4000, durationMs: 1000 }, confirmed });
    expect(r.deduped).toBe(true);
  });

  it('should NOT dedupe events far apart (> 5000ms window)', () => {
    const confirmed = [{ clientSeq: 1, startedAt: T0, durationMs: 2000 }];
    const r = dedupeEvent({ event: { startedAt: T0 + DEDUPE_WINDOW_MS + 1000, durationMs: 1000 }, confirmed });
    expect(r.deduped).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════
// STRIKE LIFECYCLE (§13 — warning 1 → warning 2 → terminate 3)
// ═══════════════════════════════════════════════════════════════════

describe('Proctor — Strike Lifecycle', () => {
  it('should escalate warning_1 → warning_2 → terminated', () => {
    expect(strikeLevelFor(1)).toBe(STRIKE_LEVELS.WARNING_1);
    expect(strikeLevelFor(2)).toBe(STRIKE_LEVELS.WARNING_2);
    expect(strikeLevelFor(3)).toBe(STRIKE_LEVELS.TERMINATED);
    expect(strikeLevelFor(0)).toBeNull();
  });

  it('should keep escalating past 3 (server keeps the attempt terminated)', () => {
    expect(strikeLevelFor(4)).toBe(STRIKE_LEVELS.TERMINATED);
  });

  it('should expose the strike limit constant', () => {
    expect(STRIKE_LIMIT).toBe(3);
  });
});

// ═══════════════════════════════════════════════════════════════════
// HASH CHAIN (§31.5 — tamper-evident timeline)
// ═══════════════════════════════════════════════════════════════════

describe('Proctor — Hash Chain', () => {
  const ev = { clientSeq: 1, eventType: 'visibility_hidden', startedAt: 1, durationMs: 2000, deviceId: 'dev-1', epoch: 1, serverReceivedAt: 2 };

  it('should produce a deterministic 64-char hash', () => {
    const h = hashChainEvent({ prevHash: null, canonicalEvent: ev });
    expect(h).toMatch(/^[a-f0-9]{64}$/);
    expect(hashChainEvent({ prevHash: null, canonicalEvent: ev })).toBe(h);
  });

  it('should chain: next hash depends on the previous', () => {
    const h1 = hashChainEvent({ prevHash: null, canonicalEvent: ev });
    const h2 = hashChainEvent({ prevHash: h1, canonicalEvent: { ...ev, clientSeq: 2 } });
    expect(h2).not.toBe(h1);
    // Tampering with an EARLIER event changes every later hash:
    const h1b = hashChainEvent({ prevHash: null, canonicalEvent: { ...ev, durationMs: 9999 } });
    expect(h1b).not.toBe(h1);
  });
});

// ═══════════════════════════════════════════════════════════════════
// EPOCH / REOPEN (§20 — old-epoch events rejected)
// ═══════════════════════════════════════════════════════════════════

describe('Proctor — Epoch / Reopen', () => {
  it('should accept events for the current epoch', () => {
    expect(evaluateProctorEpoch({ eventEpoch: 2, currentEpoch: 2 })).toEqual({ allowed: true, reason: null });
  });

  it('should reject OLD-epoch events after a teacher reopen', () => {
    const r = evaluateProctorEpoch({ eventEpoch: 1, currentEpoch: 2 });
    expect(r.allowed).toBe(false);
    expect(r.reason).toBe('stale_epoch');
  });

  it('should reject invalid epochs', () => {
    expect(evaluateProctorEpoch({ eventEpoch: NaN, currentEpoch: 2 }).allowed).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════
// TIMELINE CONTRACT (§31.2 — explainable, no "cheat probability")
// ═══════════════════════════════════════════════════════════════════

describe('Proctor — Explainable Timeline', () => {
  it('should build a factual timeline entry', () => {
    const entry = buildTimelineEntry({
      event: { clientSeq: 1, startedAt: Date.UTC(2026, 8, 1, 9, 3, 12), eventType: 'fullscreen_exit', durationMs: 4100 },
      classification: { confirmed: true, reason: 'focus_loss_strike', technical: false },
      strikeLevel: STRIKE_LEVELS.WARNING_1,
    });
    expect(entry.summary).toContain('Focus-loss strike');
    expect(entry.summary).toContain('warning_1');
    expect(entry.durationMs).toBe(4100);
  });

  it('should mark technical events as "no strike"', () => {
    const entry = buildTimelineEntry({
      event: { clientSeq: 2, startedAt: Date.UTC(2026, 8, 1, 9, 19, 44), eventType: 'network_offline', durationMs: 38000 },
      classification: { confirmed: false, reason: 'technical_event', technical: true },
      strikeLevel: null,
    });
    expect(entry.summary).toBe('Technical event (no strike)');
    expect(entry.strikeLevel).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════
// SERVICE — GRACEFUL DEGRADATION + BARREL
// ═══════════════════════════════════════════════════════════════════

describe('Proctor — Service & Barrel', () => {
  it('should expose all functions via the barrel', async () => {
    const mod = await import('../../src/modules/proctor/index.js');
    for (const exp of [
      'recordProctorEvents', 'getProctorState', 'reopenAttempt',
      'validateProctorEvent', 'classifyProctorEvent', 'dedupeEvent', 'strikeLevelFor',
      'hashChainEvent', 'evaluateProctorEpoch', 'buildTimelineEntry',
    ]) {
      expect(typeof mod[exp], exp).toBe('function');
    }
  });

  it('should throw PostgreSQL required for write paths without PG', async () => {
    await expect(recordProctorEvents({ attemptId: 1, userId: 1, events: [] }))
      .rejects.toThrow('PostgreSQL required');
    await expect(reopenAttempt({ attemptId: 1, actor: 'admin' }))
      .rejects.toThrow('PostgreSQL required');
  });

  it('should degrade gracefully for read paths without PG', async () => {
    expect(await getProctorState(1, 1)).toBeNull();
  });
});
