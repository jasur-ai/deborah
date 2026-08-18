/**
 * Edikit — AUTH C-04 Risk score service — Unit tests
 * ---------------------------------------------------------------
 *  - computeRiskScore: account_age signal (+0.2)
 *  - riskTier: per-role thresholds (admin qattiq)
 *  - evaluateRisk: userCreatedAt → account_age signal
 *  - requireLowRisk middleware: trusted → allow, unknown → stepup, suspicious → block
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
  },
}));

vi.mock('../../src/telemetry/index.js', () => ({
  recordMetric: vi.fn(() => true),
}));

import {
  computeRiskScore,
  riskTier,
  riskAction,
  riskThresholds,
  evaluateRisk,
} from '../../src/modules/auth/risk.js';
import { requireLowRisk } from '../../middleware/auth.js';

const USER = 'u1';
const FP_A = 'ab'.repeat(8);

beforeEach(() => {
  Object.keys(testStore).forEach((k) => delete testStore[k]);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('computeRiskScore — account_age signal (C-04 §06)', () => {
  it('account_age (yangi akkaunt) +0.2 → 0.2 → trusted (oddiy role)', () => {
    const r = computeRiskScore({ account_age: true });
    expect(r.score).toBe(0.2);
    expect(r.tier).toBe('trusted');
  });

  it('new_device + account_age = 0.5 → unknown/stepup', () => {
    const r = computeRiskScore({ new_device: true, account_age: true });
    expect(r.score).toBe(0.5);
    expect(r.tier).toBe('unknown');
    expect(riskAction(r.tier)).toBe('stepup');
  });

  it('account_age + trusted = -0.2 → 0 (clamp) → trusted', () => {
    const r = computeRiskScore({ account_age: true, trusted_device: true });
    expect(r.score).toBe(0);
    expect(r.tier).toBe('trusted');
  });

  it("weights yaxlitligi: barcha ijobiy signallar yig'indisi clamp 1", () => {
    const r = computeRiskScore({
      new_device: true, impossible_travel: true, velocity: true, vpn_proxy: true,
      bot: true, dev_tools: true, account_age: true,
    });
    expect(r.score).toBe(1);
    expect(r.tier).toBe('suspicious');
  });
});

describe('riskTier — per-role thresholds (C-04 §29, admin qattiq)', () => {
  it('default: <0.3 trusted, 0.3-0.7 unknown, >0.7 suspicious', () => {
    expect(riskTier(0.29)).toBe('trusted');
    expect(riskTier(0.3)).toBe('unknown');
    expect(riskTier(0.7)).toBe('unknown');
    expect(riskTier(0.71)).toBe('suspicious');
  });

  it('admin: <0.2 trusted, 0.2-0.5 unknown, >0.5 suspicious (qattiq)', () => {
    expect(riskTier(0.19, 'admin')).toBe('trusted');
    expect(riskTier(0.2, 'admin')).toBe('unknown'); // default holatda trusted bo'lardi
    expect(riskTier(0.5, 'admin')).toBe('unknown');
    expect(riskTier(0.51, 'admin')).toBe('suspicious'); // default'da unknown
  });

  it('teacher: suspicious chegarasi 0.6 (orta)', () => {
    expect(riskTier(0.51, 'teacher')).toBe('unknown'); // default'da suspicious
    expect(riskTier(0.61, 'teacher')).toBe('suspicious');
  });

  it('riskThresholds: noma lum role → default; admin → qattiq', () => {
    expect(riskThresholds('student')).toEqual(riskThresholds('default'));
    expect(riskThresholds('admin').trustedMax).toBe(0.2);
    expect(riskThresholds('admin').suspiciousMin).toBe(0.5);
  });

  it('computeRiskScore role parametri qabul qiladi (per-role tier)', () => {
    // 0.3 skor: default → unknown, admin → unknown (0.3 in [0.2, 0.5])
    const rDef = computeRiskScore({ new_device: true });
    expect(rDef.tier).toBe('unknown');
    // 0.55: default → unknown, admin → suspicious
    const rAdmin = computeRiskScore({ bot: true }, 'admin'); // bot=0.6 > 0.5
    expect(rAdmin.tier).toBe('suspicious');
    const rDef2 = computeRiskScore({ bot: true });
    expect(rDef2.tier).toBe('unknown'); // 0.6 ≤ 0.7
  });
});

describe('evaluateRisk — account_age (C-04 §06)', () => {
  const now = Date.now();

  it('created_at < 7 kun → account_age signal', async () => {
    const r = await evaluateRisk({
      userId: USER, fingerprintHash: FP_A, ipAddress: '203.0.113.5', userAgent: 'ua1',
      userCreatedAt: now - 2 * 24 * 3600 * 1000, // 2 kun
    });
    expect(r.signals).toContain('account_age');
    expect(r.score).toBe(0.5); // new_device 0.3 + account_age 0.2
    expect(r.tier).toBe('unknown');
  });

  it('created_at ≥ 7 kun → account_age signal yoq', async () => {
    const r = await evaluateRisk({
      userId: USER, fingerprintHash: FP_A, ipAddress: '203.0.113.5', userAgent: 'ua1',
      userCreatedAt: now - 30 * 24 * 3600 * 1000, // 30 kun
    });
    expect(r.signals).not.toContain('account_age');
    expect(r.score).toBe(0.3); // faqat new_device
  });

  it('userCreatedAt yoq / 0 → signal yoq (fail-safe)', async () => {
    const r1 = await evaluateRisk({ userId: USER, fingerprintHash: FP_A, ipAddress: '203.0.113.5' });
    expect(r1.signals).not.toContain('account_age');
  });
});

describe('requireLowRisk middleware (C-04 §12)', () => {
  function reqWith(tier) {
    return { session: tier ? { user: { riskTier: tier } } : {} };
  }

  it('trusted → next() (seamless)', () => {
    const req = reqWith('trusted');
    const next = vi.fn();
    requireLowRisk(req, {}, next);
    expect(next).toHaveBeenCalled();
  });

  it('riskTier yoq (eski sessiya) → next() (fail-soft)', () => {
    const req = reqWith(null);
    const next = vi.fn();
    requireLowRisk(req, {}, next);
    expect(next).toHaveBeenCalled();
  });

  it('unknown → 403 risk_stepup_required', () => {
    const req = reqWith('unknown');
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
    requireLowRisk(req, res, vi.fn());
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: 'risk_stepup_required' }));
  });

  it('suspicious → 403 risk_blocked', () => {
    const req = reqWith('suspicious');
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
    requireLowRisk(req, res, vi.fn());
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: 'risk_blocked' }));
  });
});
