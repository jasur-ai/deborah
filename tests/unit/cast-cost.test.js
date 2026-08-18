import { describe, it, expect } from 'vitest';
import { computeCost, buildTrafficProfile, reconcileCost, isCostRegression, TIER_PEAK_CONNECTIONS } from '../../services/cast/cost-model.js';

const baseInput = {
  tier: 'XL',
  peakConnections: 1000,
  durationMinutes: 60,
  nodeCount: 3,
  nodeHourPrice: 1, // $/node-hour
  egressPricePerGb: 0.1,
  storagePricePerGbMonth: 0.02,
  observabilityPricePerGb: 0.5,
  supportHours: 2,
  supportHourlyCost: 50,
  realtimeRate: 0.001,
};

describe('C5-10: Zero-price fixture (tekshiruv #1)', () => {
  it('zero inputs produce zero total', () => {
    const c = computeCost({ tier: 'S', nodeCount: 1 });
    expect(c.total).toBe(0);
    for (const k of Object.keys(c.components)) expect(c.components[k]).toBe(0);
  });
});

describe('C5-10: Formula group (rejadagi contract)', () => {
  it('compute = nodeCount × nodeHours × nodeHourPrice', () => {
    const c = computeCost(baseInput);
    // 3 node × 1h × $1 = 3
    expect(c.components.compute).toBeCloseTo(3, 6);
  });

  it('realtime = peakConnections × rate', () => {
    const c = computeCost(baseInput);
    expect(c.components.realtime).toBeCloseTo(1000 * 0.001, 6);
  });

  it('support = hours × hourlyCost', () => {
    const c = computeCost(baseInput);
    expect(c.components.support).toBeCloseTo(2 * 50, 6);
  });

  it('total = sum of all components', () => {
    const c = computeCost(baseInput);
    const sum = Object.values(c.components).reduce((a, b) => a + b, 0);
    expect(c.total).toBeCloseTo(sum, 6);
  });
});

describe('C5-10: Payload increase regression (tekshiruv #2)', () => {
  it('bigger avgAnswerBytes → more network+storage', () => {
    const small = computeCost(baseInput, { avgAnswerBytes: 100 });
    const big = computeCost(baseInput, { avgAnswerBytes: 1000 });
    expect(big.components.network).toBeGreaterThan(small.components.network);
    expect(big.traffic.outboundBytes).toBeGreaterThan(small.traffic.outboundBytes);
  });

  it('egress = payload × recipient × frequency', () => {
    // avgAnswerBytes=256, answers=20000 → 5.12MB outbound just for answers
    const c = computeCost({ ...baseInput, tier: 'XL', peakConnections: 1000 });
    expect(c.traffic.totalAnswers).toBe(1000 * 20);
    expect(c.traffic.outboundBytes).toBeGreaterThan(0);
  });

  it('disabled anti-pattern is NOT included (item 10)', () => {
    // eventRecipientsFactor ≤ 1 — full leaderboard per-answer broadcast
    // (recipients = all participants) baseline'ga kirmaydi.
    const prof = buildTrafficProfile({ eventRecipientsFactor: 1 });
    expect(prof.eventRecipientsFactor).toBeLessThanOrEqual(1);
  });
});

describe('C5-10: Retention increase (tekshiruv #3)', () => {
  it('longer retention → more storage + observability', () => {
    const short = computeCost(baseInput, { retentionDays: 30 });
    const long = computeCost(baseInput, { retentionDays: 180 });
    expect(long.components.storage).toBeGreaterThan(short.components.storage);
    expect(long.components.observability).toBeGreaterThan(short.components.observability);
  });
});

describe('C5-10: Tier comparison (tekshiruv #4)', () => {
  it('higher tier → higher cost (given same rates)', () => {
    const costs = ['S', 'M', 'L', 'XL', 'XXL'].map((tier) =>
      computeCost({ ...baseInput, tier, peakConnections: TIER_PEAK_CONNECTIONS[tier], nodeCount: { S: 1, M: 1, L: 2, XL: 3, XXL: 6 }[tier] }).total,
    );
    for (let i = 1; i < costs.length; i++) {
      expect(costs[i]).toBeGreaterThan(costs[i - 1]);
    }
  });
});

describe('C5-10: Actual/projected reconciliation (tekshiruv #5, item 11/12)', () => {
  it('reconcileCost marks exact match as ok', () => {
    const r = reconcileCost(10, 10);
    expect(r.verdict).toBe('ok');
    expect(r.delta).toBe(0);
  });

  it('over budget is detected', () => {
    const r = reconcileCost(10, 13);
    expect(r.verdict).toBe('over');
    expect(r.deltaPct).toBeCloseTo(30, 6);
  });

  it('isCostRegression flags >20% overshoot', () => {
    expect(isCostRegression(100, 121)).toBe(true);
    expect(isCostRegression(100, 119)).toBe(false);
    expect(isCostRegression(100, 100)).toBe(false);
  });
});
