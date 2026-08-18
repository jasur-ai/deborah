/**
 * Edikit — AUTH C-05 Impossible travel + velocity — Unit tests
 * ---------------------------------------------------------------
 *  - travelFeasible: 800 km/soat threshold (C-05 §06)
 *  - geoFromIp: shahar + timezone (C-05 §08, Asia/Tashkent)
 *  - account-level velocity: Redis SET pattern (C-05 §09)
 *  - recordRiskDecision: impossible_travel / velocity audit action'lar
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const testStore = {};

vi.mock('../../firebase/admin.js', () => {
  function navigate(store, path) {
    const parts = path.split('/').filter(Boolean);
    let current = store;
    for (let i = 0; i < parts.length; i++) {
      if (current === null || typeof current !== 'object' || !(parts[i] in current))
        return { found: false, parent: current, key: parts[i] };
      if (i === parts.length - 1) return { found: true, value: current[parts[i]], parent: current, key: parts[i] };
      current = current[parts[i]];
    }
    return { found: true, value: current, parent: null, key: null };
  }
  return {
    fb: {
      get: vi.fn(async (path) => {
        const r = navigate(testStore, path);
        return { exists: () => r.found, val: () => (r.found ? JSON.parse(JSON.stringify(r.value)) : null) };
      }),
      set: vi.fn(async (path, value) => {
        const parts = path.split('/').filter(Boolean);
        let cur = testStore;
        for (let i = 0; i < parts.length - 1; i++) {
          if (!(parts[i] in cur) || typeof cur[parts[i]] !== 'object') cur[parts[i]] = {};
          cur = cur[parts[i]];
        }
        cur[parts[parts.length - 1]] = JSON.parse(JSON.stringify(value));
      }),
      remove: vi.fn(async (path) => {
        const r = navigate(testStore, path);
        if (r.found && r.parent) delete r.parent[r.key];
        else if (r.found) Object.keys(testStore).forEach((k) => delete testStore[k]);
      }),
    },
    default: {},
  };
});

const auditEvents = [];
vi.mock('../../src/modules/auth/audit.js', () => ({
  audit: vi.fn(async () => true),
  logAuthEvent: vi.fn(async ({ action, outcome }) => { auditEvents.push({ action, outcome }); return true; }),
  AUDIT_ACTIONS: {
    RISK_SCORED: 'auth:risk:scored',
    RISK_STEPUP: 'auth:risk:stepup',
    RISK_BLOCKED: 'auth:risk:blocked',
    IMPOSSIBLE_TRAVEL_DETECTED: 'auth:risk:impossible_travel',
    VELOCITY_DETECTED: 'auth:risk:velocity',
  },
}));

vi.mock('../../src/telemetry/index.js', () => ({
  recordMetric: vi.fn(() => true),
}));

import {
  travelFeasible,
  computeRiskScore,
  evaluateRisk,
  recordRiskDecision,
} from '../../src/modules/auth/risk.js';
import { geoFromIp, cityFromIp } from '../../src/modules/auth/geo-lite.js';

const USER = 'u1';
const FP_A = 'aa'.repeat(8);
const FP_B = 'bb'.repeat(8);
const FP_C = 'cc'.repeat(8);

beforeEach(() => {
  Object.keys(testStore).forEach((k) => delete testStore[k]);
  auditEvents.length = 0;
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('travelFeasible — 800 km/soat threshold (C-05 §06)', () => {
  const now = Date.now();

  it('Toshkent → Samarqand 10 daqiqada (~1800 km/h > 800) → impossible', () => {
    expect(
      travelFeasible({ fromCity: 'Toshkent', fromAt: now - 10 * 60 * 1000, toCity: 'Samarqand', toAt: now })
    ).toBe(false);
  });

  it('Toshkent → London 6 soatda (~816 km/h > 800) → impossible (C-05 spec)', () => {
    // 4900 km / 6 soat = 816 km/h — 900'da feasible edi, 800'da impossible
    expect(
      travelFeasible({ fromCity: 'Toshkent', fromAt: now - 6 * 3600 * 1000, toCity: 'London', toAt: now })
    ).toBe(false);
  });

  it('Toshkent → London 7 soatda (~700 km/h < 800) → feasible', () => {
    expect(
      travelFeasible({ fromCity: 'Toshkent', fromAt: now - 7 * 3600 * 1000, toCity: 'London', toAt: now })
    ).toBe(true);
  });

  it('noma`lum shahar / bir xil shahar → fail-safe true', () => {
    expect(travelFeasible({ fromCity: 'Toshkent', fromAt: now - 1000, toCity: 'Toshkent', toAt: now })).toBe(true);
    expect(travelFeasible({ fromCity: null, fromAt: now - 1000, toCity: 'London', toAt: now })).toBe(true);
  });
});

describe('geoFromIp — shahar + timezone (C-05 §08)', () => {
  it('UZ IP → Asia/Tashkent', () => {
    expect(geoFromIp('203.0.113.7')).toEqual({ city: 'Toshkent', tz: 'Asia/Tashkent' });
    expect(geoFromIp('91.212.1.1')).toEqual({ city: 'Nukus', tz: 'Asia/Tashkent' });
  });

  it('xorij IP → o`z timezone', () => {
    expect(geoFromIp('192.0.2.5')).toEqual({ city: 'London', tz: 'Europe/London' });
  });

  it('noma`lum / yo`q IP → null (fail-safe)', () => {
    expect(geoFromIp(null)).toBeNull();
    expect(geoFromIp('10.0.0.1')).toBeNull();
  });

  it('cityFromIp orqali ham ishlaydi (backward-compat)', () => {
    expect(cityFromIp('203.0.113.7')).toBe('Toshkent');
  });
});

describe('account-level velocity — Redis SET (C-05 §09)', () => {
  function makeRedis() {
    const members = new Set();
    return {
      sadd: vi.fn(async (key, val) => { members.add(val); return members.size; }),
      expire: vi.fn(async () => 1),
      scard: vi.fn(async () => members.size),
      _members: members,
    };
  }

  it('3 turli qurilma (10 daqiqa oyna) → velocity signal +0.4', async () => {
    const redis = makeRedis();
    // 1-qurilma (yangi device + Redis sadd)
    await evaluateRisk({ userId: USER, fingerprintHash: FP_A, ipAddress: '203.0.113.1', userAgent: 'ua1', redis, redisOk: true });
    const r2 = await evaluateRisk({ userId: USER, fingerprintHash: FP_B, ipAddress: '203.0.113.2', userAgent: 'ua2', redis, redisOk: true });
    const r3 = await evaluateRisk({ userId: USER, fingerprintHash: FP_C, ipAddress: '203.0.113.3', userAgent: 'ua3', redis, redisOk: true });
    expect(r3.signals).toContain('velocity');
    expect(r3.score).toBeGreaterThanOrEqual(0.4); // velocity 0.4 (yangi qurilmalar ham)
  });

  it('2 qurilma → velocity yo`q (threshold 3)', async () => {
    const redis = makeRedis();
    await evaluateRisk({ userId: USER, fingerprintHash: FP_A, ipAddress: '203.0.113.1', userAgent: 'ua1', redis, redisOk: true });
    const r2 = await evaluateRisk({ userId: USER, fingerprintHash: FP_B, ipAddress: '203.0.113.2', userAgent: 'ua2', redis, redisOk: true });
    expect(r2.signals).not.toContain('velocity');
  });

  it('redis yo`q / redisOk=false → fail-open (signal yo`q, xato yo`q)', async () => {
    const r = await evaluateRisk({ userId: USER, fingerprintHash: FP_A, ipAddress: '203.0.113.1', redis: null, redisOk: false });
    expect(r.signals).not.toContain('velocity');
  });

  it('redis xato tashlasa → fail-open', async () => {
    const badRedis = { sadd: vi.fn(async () => { throw new Error('redis down'); }) };
    const r = await evaluateRisk({ userId: USER, fingerprintHash: FP_A, ipAddress: '203.0.113.1', redis: badRedis, redisOk: true });
    expect(r.signals).not.toContain('velocity');
    expect(r.tier).toBeDefined();
  });
});

describe('recordRiskDecision — C-05 audit actionlar', () => {
  it('impossible_travel signal → auth:risk:impossible_travel audit', async () => {
    await recordRiskDecision({
      userId: USER, fingerprintHash: FP_A, score: 0.5, tier: 'unknown', action: 'stepup',
      signals: ['impossible_travel'], ipAddress: '203.0.113.5', userAgent: 'ua1',
    });
    expect(auditEvents.some((e) => e.action === 'auth:risk:impossible_travel' && e.outcome === 'detected')).toBe(true);
  });

  it('velocity signal → auth:risk:velocity audit', async () => {
    await recordRiskDecision({
      userId: USER, fingerprintHash: FP_A, score: 0.4, tier: 'unknown', action: 'stepup',
      signals: ['velocity'], ipAddress: '203.0.113.5', userAgent: 'ua1',
    });
    expect(auditEvents.some((e) => e.action === 'auth:risk:velocity' && e.outcome === 'detected')).toBe(true);
  });

  it('signal bo`lmasa maxsus audit yozilmaydi', async () => {
    await recordRiskDecision({
      userId: USER, fingerprintHash: FP_A, score: 0, tier: 'trusted', action: 'allow',
      signals: [], ipAddress: '203.0.113.5', userAgent: 'ua1',
    });
    expect(auditEvents.some((e) => e.action === 'auth:risk:impossible_travel')).toBe(false);
    expect(auditEvents.some((e) => e.action === 'auth:risk:velocity')).toBe(false);
  });
});

describe('computeRiskScore — velocity weight config (C-05 §10)', () => {
  it('impossible_travel +0.5, velocity +0.4 (C-04 weight\'lar saqlanadi)', () => {
    const r1 = computeRiskScore({ impossible_travel: true });
    expect(r1.score).toBe(0.5);
    const r2 = computeRiskScore({ velocity: true });
    expect(r2.score).toBe(0.4);
  });
});
