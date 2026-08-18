import { describe, it, expect } from 'vitest';
import { pickTier, TIER_RANGES, TIER_ACK_SLO } from '../../load/cast-scenarios.js';
import { summarizeMetrics } from '../../load/cast-socket-client.js';

describe('C5-09: Tier picker (item 2)', () => {
  it('maps counts to correct tier ranges', () => {
    expect(pickTier(1)).toBe('S');
    expect(pickTier(30)).toBe('S');
    expect(pickTier(31)).toBe('M');
    expect(pickTier(100)).toBe('M');
    expect(pickTier(101)).toBe('L');
    expect(pickTier(500)).toBe('L');
    expect(pickTier(501)).toBe('XL');
    expect(pickTier(1000)).toBe('XL');
    expect(pickTier(1001)).toBe('XXL');
    expect(pickTier(10000)).toBe('XXL');
  });

  it('tier ranges cover 1..10000 without gaps', () => {
    for (let c = 1; c <= 10000; c += 1) {
      const t = pickTier(c);
      expect(t).toBeTruthy();
      expect(c >= TIER_RANGES[t].min && c <= TIER_RANGES[t].max).toBe(true);
    }
  });
});

describe('C5-09: Ground truth metrics (item 17)', () => {
  it('computes acceptedLoss correctly when all accepted', () => {
    const metrics = {
      acks: Array.from({ length: 10 }, () => ({ ok: true, latencyMs: 50 })),
      answers: Array.from({ length: 10 }, () => ({ ok: true })),
      errors: [],
    };
    const s = summarizeMetrics(metrics, 10);
    expect(s.acceptedAnswers).toBe(10);
    expect(s.expectedAnswers).toBe(10);
    expect(s.acceptedLoss).toBe(0);
    expect(s.lost).toBe(0);
  });

  it('detects accepted loss (ground truth mismatch)', () => {
    const metrics = {
      acks: Array.from({ length: 8 }, () => ({ ok: true, latencyMs: 50 })),
      answers: Array.from({ length: 8 }, () => ({ ok: true })),
      errors: [{ kind: 'answer', err: 'timeout' }, { kind: 'answer', err: 'timeout' }],
    };
    const s = summarizeMetrics(metrics, 10);
    expect(s.acceptedAnswers).toBe(8);
    expect(s.acceptedLoss).toBe(2);
  });

  it('computes percentiles correctly', () => {
    const latencies = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
    const metrics = {
      acks: latencies.map((l) => ({ ok: true, latencyMs: l })),
      answers: [],
      errors: [],
    };
    const s = summarizeMetrics(metrics, 10);
    expect(s.latency.p50).toBe(50);
    expect(s.latency.p95).toBe(100);
    expect(s.latency.p99).toBe(100);
    expect(s.latency.max).toBe(100);
  });

  it('treats failed acks as lost, not answered', () => {
    const metrics = {
      acks: [{ ok: true, latencyMs: 40 }, { ok: false, latencyMs: 500 }],
      answers: [{ ok: true }, { ok: false }],
      errors: [{ kind: 'answerSubmit', err: 'ack timeout' }],
    };
    const s = summarizeMetrics(metrics, 2);
    expect(s.okCount).toBe(1);
    expect(s.lost).toBe(1);
    expect(s.acceptedLoss).toBe(1);
  });
});

describe('C5-09: SLO thresholds (release threshold)', () => {
  it('defines thresholds for every tier', () => {
    for (const t of Object.keys(TIER_RANGES)) {
      expect(TIER_ACK_SLO[t]).toBeTruthy();
      expect(TIER_ACK_SLO[t].p95).toBeGreaterThan(0);
    }
  });

  it('S/M ≤ 500ms, L/XL ≤ 750ms, XXL ≤ 1000ms', () => {
    expect(TIER_ACK_SLO.S.p95).toBeLessThanOrEqual(500);
    expect(TIER_ACK_SLO.M.p95).toBeLessThanOrEqual(500);
    expect(TIER_ACK_SLO.L.p95).toBeLessThanOrEqual(750);
    expect(TIER_ACK_SLO.XL.p95).toBeLessThanOrEqual(750);
    expect(TIER_ACK_SLO.XXL.p95).toBeLessThanOrEqual(1000);
  });
});
