/**
 * Deborah — AUTH A-28 Risk-based auth — Unit tests
 * ---------------------------------------------------------------
 *  - computeRiskScore: weights, clamp 0..1, tier
 *  - riskTier: boundary (0.3 / 0.7)
 *  - haversineKm + travelFeasible: impossible travel
 *  - evaluateRisk: new device / trusted / impossible travel / velocity
 *  - checkMidSessionFingerprint: mismatch audit + flag
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

vi.mock('../../src/modules/auth/audit.js', () => ({
  audit: vi.fn(async () => true),
  logAuthEvent: vi.fn(async () => true),
  AUDIT_ACTIONS: {
    RISK_SCORED: 'auth:risk:scored',
    RISK_STEPUP: 'auth:risk:stepup',
    RISK_BLOCKED: 'auth:risk:blocked',
    RISK_DEVICE_TRUST: 'auth:risk:device:trust',
    AUTH_LOGIN_FAIL: 'auth:login:failed',
    MFA_REQUIRED: 'mfa:required',
  },
}));

vi.mock('../../src/telemetry/index.js', () => ({
  recordMetric: vi.fn(() => true),
}));

import {
  computeRiskScore,
  riskTier,
  riskAction,
  haversineKm,
  travelFeasible,
  evaluateRisk,
  recordRiskDecision,
  checkMidSessionFingerprint,
  _riskConfig,
} from '../../src/modules/auth/risk.js';
import { fb } from '../../firebase/admin.js';
import { audit } from '../../src/modules/auth/audit.js';
import { recordMetric } from '../../src/telemetry/index.js';

const USER = 'u1';
const FP_A = 'ab'.repeat(8); // 16 hex belgi
const FP_B = 'cd'.repeat(8);

beforeEach(() => {
  Object.keys(testStore).forEach((k) => delete testStore[k]);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('computeRiskScore — signal weights va tiers', () => {
  it('yagona trusted signal → 0 (clamp) → trusted/allow', () => {
    const r = computeRiskScore({ trusted_device: true });
    expect(r.score).toBe(0);
    expect(r.tier).toBe('trusted');
    expect(r.signals).toContain('trusted_device');
  });

  it('yangi qurilma +0.3 → unknown/stepup', () => {
    const r = computeRiskScore({ new_device: true });
    expect(r.score).toBe(0.3);
    expect(r.tier).toBe('unknown');
    expect(riskAction(r.tier)).toBe('stepup');
  });

  it('impossible travel +0.5 → unknown', () => {
    const r = computeRiskScore({ impossible_travel: true });
    expect(r.score).toBe(0.5);
    expect(r.tier).toBe('unknown');
  });

  it('bot +0.6 → unknown (0.6 ≤ 0.7)', () => {
    const r = computeRiskScore({ bot: true });
    expect(r.score).toBe(0.6);
    expect(r.tier).toBe('unknown');
  });

  it('new_device + impossible_travel + velocity → 1.2 clamp 1 → suspicious/block', () => {
    const r = computeRiskScore({ new_device: true, impossible_travel: true, velocity: true });
    expect(r.score).toBe(1);
    expect(r.tier).toBe('suspicious');
    expect(riskAction(r.tier)).toBe('block');
  });

  it('trusted device signal trusted bilan offset (0.3 - 0.4 = -0.1 → 0)', () => {
    const r = computeRiskScore({ new_device: true, trusted_device: true });
    expect(r.score).toBe(0);
    expect(r.tier).toBe('trusted');
  });

  it('floor: trusted discount impossible_travel/bot\'ni to\'liq o\'chira olmaydi (≥0.3 unknown)', () => {
    // trusted(-0.4) + impossible_travel(+0.5) = 0.1 → floor 0.3 → unknown
    const r1 = computeRiskScore({ trusted_device: true, impossible_travel: true });
    expect(r1.score).toBe(0.3);
    expect(r1.tier).toBe('unknown');
    expect(riskAction(r1.tier)).toBe('stepup');
    // trusted(-0.4) + bot(+0.6) = 0.2 → floor 0.3 → unknown
    const r2 = computeRiskScore({ trusted_device: true, bot: true });
    expect(r2.score).toBe(0.3);
    expect(r2.tier).toBe('unknown');
  });

  it('salbiy signal kombinatsiyasi hech qachon 0 dan pastga tushmaydi', () => {
    expect(computeRiskScore({ trusted_device: true, new_device: true }).score).toBe(0);
    expect(computeRiskScore({}).score).toBe(0);
  });
});

describe('riskTier — boundary', () => {
  it('0.29 → trusted, 0.3 → unknown, 0.7 → unknown, 0.71 → suspicious', () => {
    expect(riskTier(0.29)).toBe('trusted');
    expect(riskTier(0.3)).toBe('unknown');
    expect(riskTier(0.7)).toBe('unknown');
    expect(riskTier(0.71)).toBe('suspicious');
    expect(riskTier(0)).toBe('trusted');
    expect(riskTier(1)).toBe('suspicious');
  });
});

describe('haversineKm + travelFeasible — impossible travel (server-side)', () => {
  it('Toshkent → London ~4900-5400 km oraligida', () => {
    const km = haversineKm([41.3, 69.2], [51.5, -0.12]);
    expect(km).toBeGreaterThan(4500);
    expect(km).toBeLessThan(5500);
  });

  it('10 daqiqada Toshkent → London → impossible (false)', () => {
    const now = Date.now();
    expect(
      travelFeasible({ fromCity: 'Toshkent', fromAt: now - 10 * 60 * 1000, toCity: 'London', toAt: now })
    ).toBe(false);
  });

  it('8 soatda Toshkent → London → feasible (true)', () => {
    const now = Date.now();
    expect(
      travelFeasible({ fromCity: 'Toshkent', fromAt: now - 8 * 3600 * 1000, toCity: 'London', toAt: now })
    ).toBe(true); // ~613 km/h < 900
  });

  it('bir xil shahar / noma\'lum shahar → fail-safe true', () => {
    const now = Date.now();
    expect(travelFeasible({ fromCity: 'Toshkent', fromAt: now - 1000, toCity: 'Toshkent', toAt: now })).toBe(true);
    expect(travelFeasible({ fromCity: null, fromAt: now - 1000, toCity: 'London', toAt: now })).toBe(true);
    expect(travelFeasible({ fromCity: 'NomaX', fromAt: now - 1000, toCity: 'London', toAt: now })).toBe(true);
  });
});

describe('evaluateRisk — server signals + fb device', () => {
  it('yangi qurilma (device record yo\'q) → new_device +0.3 → unknown/stepup', async () => {
    const r = await evaluateRisk({ userId: USER, fingerprintHash: FP_A, ipAddress: '203.0.113.5', userAgent: 'ua1' });
    expect(r.signals).toContain('new_device');
    expect(r.isNewDevice).toBe(true);
    expect(r.tier).toBe('unknown');
    expect(r.action).toBe('stepup');
  });

  it('trusted device → seamless (score 0)', async () => {
    // Avval device record yaratamiz (trusted)
    await fb.set(`users/${USER}/devices/${FP_A}`, {
      first_seen: 1, last_seen: 1, last_city: 'Toshkent', last_ip_hash: 'x', trusted: true, risk_events: [],
    });
    const r = await evaluateRisk({ userId: USER, fingerprintHash: FP_A, ipAddress: '203.0.113.5', userAgent: 'ua1' });
    expect(r.trusted).toBe(true);
    expect(r.signals).toContain('trusted_device');
    expect(r.signals).not.toContain('new_device');
    expect(r.tier).toBe('trusted');
    expect(r.action).toBe('allow');
  });

  it('impossible travel: Toshkent record → 10 daqiqada London IP → +0.5', async () => {
    const now = Date.now();
    await fb.set(`users/${USER}/devices/${FP_A}`, {
      first_seen: now - 86400000, last_seen: now - 10 * 60 * 1000,
      last_city: 'Toshkent', last_ip_hash: 'x', trusted: false, risk_events: [],
    });
    // London IP geo-lite'da yo'q — fail-safe. Test uchun shahar o'zgarishi
    // kerak: Toshkent (203.0.113.x) → Samarqand (198.51.100.x) — ~300km,
    // 10 daqiqada → 1800 km/h > 900 → impossible.
    const r = await evaluateRisk({ userId: USER, fingerprintHash: FP_A, ipAddress: '198.51.100.7', userAgent: 'ua1' });
    expect(r.signals).toContain('impossible_travel');
    expect(r.score).toBe(0.5);
  });

  it('velocity: device risk_events\'da 10 daqiqada ≥3 turli IP → +0.4', async () => {
    const now = Date.now();
    await fb.set(`users/${USER}/devices/${FP_A}`, {
      first_seen: now - 86400000, last_seen: now - 60000,
      last_city: 'Toshkent', last_ip_hash: 'h1', trusted: false,
      risk_events: [
        { at: now - 9 * 60 * 1000, ipHash: 'h1', signals: [] },
        { at: now - 5 * 60 * 1000, ipHash: 'h2', signals: [] },
        { at: now - 1 * 60 * 1000, ipHash: 'h3', signals: [] },
      ],
    });
    const r = await evaluateRisk({ userId: USER, fingerprintHash: FP_A, ipAddress: '203.0.113.5', userAgent: 'ua1' });
    expect(r.signals).toContain('velocity');
    expect(r.score).toBe(0.4);
  });

  it('blocked: new_device + impossible_travel → 0.8 → suspicious/block', async () => {
    const now = Date.now();
    // Yangi fingerprint (FP_B — record yo'q) → new_device +0.3
    // prevLoginState (users.last_city/last_login_at) → impossible_travel +0.5
    const r = await evaluateRisk({
      userId: USER,
      fingerprintHash: FP_B,
      ipAddress: '198.51.100.7',
      userAgent: 'ua1',
      prevLoginState: { city: 'Toshkent', at: now - 10 * 60 * 1000 },
    });
    expect(r.signals).toContain('new_device');
    expect(r.signals).toContain('impossible_travel');
    expect(r.score).toBe(0.8);
    expect(r.tier).toBe('suspicious');
    expect(r.action).toBe('block');
  });

  it('extraSignals (vpn/bot/dev_tools) server-side qo\'shiladi', async () => {
    const r = await evaluateRisk({
      userId: USER, fingerprintHash: FP_A, ipAddress: '203.0.113.5', userAgent: 'ua1',
      extraSignals: { vpnProxy: true, bot: true },
    });
    expect(r.signals).toContain('vpn_proxy');
    expect(r.signals).toContain('bot');
    expect(r.tier).toBe('suspicious'); // 0.3+0.6+0.3? — new_device 0.3 + vpn 0.3 + bot 0.6 = 1.2 → clamp 1
    expect(r.action).toBe('block');
  });
});

describe('recordRiskDecision + checkMidSessionFingerprint', () => {
  it('recordRiskDecision: audit + metric + device touch (hash saqlanadi, raw emas)', async () => {
    await recordRiskDecision({
      userId: USER, fingerprintHash: FP_A, score: 0.3, tier: 'unknown', action: 'stepup',
      signals: ['new_device'], ipAddress: '203.0.113.5', userAgent: 'ua1',
    });
    expect(audit).toHaveBeenCalled();
    expect(recordMetric).toHaveBeenCalled();
    const snap = await fb.get(`users/${USER}/devices/${FP_A}`);
    expect(snap.exists()).toBe(true);
    const d = snap.val();
    expect(d.trusted).toBe(false);
    expect(d.last_city).toBe('Toshkent');
    // Retention: risk_events hash'lar — raw IP yo'q
    expect(Array.isArray(d.risk_events)).toBe(true);
    expect(d.risk_events[0].signals).toEqual(['new_device']);
  });

  it('recordRiskDecision: blocked → risk_blocked audit + metric', async () => {
    await recordRiskDecision({
      userId: USER, fingerprintHash: FP_A, score: 1, tier: 'suspicious', action: 'block',
      signals: ['new_device', 'impossible_travel'], ipAddress: '198.51.100.7', userAgent: 'ua1', blocked: true,
    });
    expect(recordMetric).toHaveBeenCalledWith('auth.risk_blocked', 1, expect.anything());
  });

  it('mid-session mismatch → flagged + audit; match → false', async () => {
    const r1 = await checkMidSessionFingerprint({
      userId: USER, sessionFingerprint: FP_A, currentFingerprint: FP_B, ipAddress: '203.0.113.5', userAgent: 'ua1',
    });
    expect(r1.mismatch).toBe(true);
    expect(r1.flagged).toBe(true);
    expect(recordMetric).toHaveBeenCalledWith('auth.risk_mid_session_mismatch', 1, expect.anything());

    vi.clearAllMocks();
    const r2 = await checkMidSessionFingerprint({
      userId: USER, sessionFingerprint: FP_A, currentFingerprint: FP_A, ipAddress: '203.0.113.5', userAgent: 'ua1',
    });
    expect(r2.mismatch).toBe(false);
    expect(recordMetric).not.toHaveBeenCalledWith('auth.risk_mid_session_mismatch', 1, expect.anything());

    const r3 = await checkMidSessionFingerprint({
      userId: USER, sessionFingerprint: null, currentFingerprint: FP_B, ipAddress: '203.0.113.5', userAgent: 'ua1',
    });
    expect(r3.mismatch).toBe(false); // session'da fingerprint yo'q → fail-safe
  });
});

describe('config thresholds', () => {
  it('default: trusted 0.3, suspicious 0.7, travel speed 800 km/h (C-05 spec)', () => {
    const c = _riskConfig();
    expect(c.TRUSTED_MAX).toBe(0.3);
    expect(c.SUSPICIOUS_MIN).toBe(0.7);
    expect(c.TRAVEL_SPEED_KMH).toBe(800);
    expect(c.VELOCITY_DISTINCT_IPS).toBe(3);
  });
});
