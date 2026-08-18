/**
 * Edikit — AUTH A-30 Admin/Teacher privilege hardening — Unit tests
 * ---------------------------------------------------------------
 *  - adminIpAllowed: exact / CIDR / empty allowlist
 *  - adminMfaMandatory: production doim true, flag toggle
 *  - admin lockout: 3 xato → 15 daqiqa (recordAdminLoginFailure)
 *  - evaluateAdminRisk: impossible travel / new device / trusted
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

vi.mock('../../src/modules/auth/new-device.js', () => ({
  ipHash: (ip) => (ip ? `h_${String(ip)}` : null),
}));

vi.mock('../../src/modules/auth/audit.js', () => ({
  audit: vi.fn(async () => true),
  logAuthEvent: vi.fn(async () => true),
  AUDIT_ACTIONS: {},
}));

vi.mock('../../src/modules/auth/geo-lite.js', () => ({
  cityFromIp: (ip) => {
    // 198.51.100.x → Samarqand; 203.0.113.x → Toshkent; boshqa → null
    if (ip && ip.startsWith('198.51.100.')) return 'Samarqand';
    if (ip && ip.startsWith('203.0.113.')) return 'Toshkent';
    return null;
  },
}));

import {
  adminMfaMandatory,
  privilegedMfaMandatory,
  adminIpAllowlist,
  adminIpAllowed,
  getAdminSecurity,
  updateAdminSecurity,
  adminLoginLockoutCheck,
  recordAdminLoginFailure,
  resetAdminLoginFailures,
  evaluateAdminRisk,
  ADMIN_MFA_ACCOUNT,
} from '../../src/modules/auth/admin-security.js';

beforeEach(() => {
  Object.keys(testStore).forEach((k) => delete testStore[k]);
  // MFA flag test'lar uchun toza — default off (production emas)
  delete process.env.ADMIN_MFA_MANDATORY;
  delete process.env.ADMIN_IP_ALLOWLIST;
  process.env.NODE_ENV = 'test';
});

afterEach(() => {
  vi.clearAllMocks();
  delete process.env.ADMIN_MFA_MANDATORY;
  delete process.env.ADMIN_IP_ALLOWLIST;
});

describe('adminMfaMandatory — production doim, dev/test flag', () => {
  it('production → doim true (bypass yo\'q)', () => {
    process.env.NODE_ENV = 'production';
    delete process.env.ADMIN_MFA_MANDATORY;
    expect(adminMfaMandatory()).toBe(true);
    expect(privilegedMfaMandatory()).toBe(true);
  });

  it('test/dev flag off → false (legacy compat)', () => {
    process.env.NODE_ENV = 'test';
    expect(adminMfaMandatory()).toBe(false);
  });

  it('test/dev flag true → true', () => {
    process.env.ADMIN_MFA_MANDATORY = 'true';
    expect(adminMfaMandatory()).toBe(true);
    expect(privilegedMfaMandatory()).toBe(true);
  });
});

describe('adminIpAllowed — exact + CIDR + empty', () => {
  it('bo\'sh allowlist → hammaga ochiq', () => {
    expect(adminIpAllowed('203.0.113.5', [])).toBe(true);
    expect(adminIpAllowed('10.0.0.1', adminIpAllowlist())).toBe(true);
  });

  it('exact IP match', () => {
    expect(adminIpAllowed('203.0.113.5', ['203.0.113.5'])).toBe(true);
    expect(adminIpAllowed('203.0.113.6', ['203.0.113.5'])).toBe(false);
  });

  it('CIDR match', () => {
    expect(adminIpAllowed('203.0.113.9', ['203.0.113.0/24'])).toBe(true);
    expect(adminIpAllowed('203.0.114.1', ['203.0.113.0/24'])).toBe(false);
    expect(adminIpAllowed('10.1.2.3', ['10.0.0.0/8'])).toBe(true);
  });

  it('noto\'g\'ri CIDR / bo\'sh ip → false', () => {
    expect(adminIpAllowed('203.0.113.5', ['bad'])).toBe(false);
    expect(adminIpAllowed(null, ['203.0.113.5'])).toBe(false);
  });
});

describe('admin lockout — 3 xato → 15 daqiqa', () => {
  it('3 xil IP dan xato → global lockout (ko\'p IP hujumi signal)', async () => {
    // 2 xil IP → hali blok yo'q
    expect((await recordAdminLoginFailure('203.0.113.1')).locked).toBe(false);
    expect((await recordAdminLoginFailure('203.0.113.2')).locked).toBe(false);
    // 3-chi xil IP → global lock (har xil IP 1 xatodan)
    const third = await recordAdminLoginFailure('203.0.113.3');
    expect(third.locked).toBe(true);
    expect(third.retryAfterSeconds).toBeGreaterThan(0);
    // Lockout vaqtida check → locked
    const check = await adminLoginLockoutCheck('203.0.113.4');
    expect(check.locked).toBe(true);
  });

  it("muvaffaqiyatli login lockout'ni tozalaydi", async () => {
    await recordAdminLoginFailure();
    await resetAdminLoginFailures();
    const check = await adminLoginLockoutCheck();
    expect(check.locked).toBe(false);
    const s = await getAdminSecurity();
    expect(s.loginFailures).toBe(0);
  });

  it('per-IP qatlam: bitta IP 3 xato → shu IP blok, boshqa IP kirishi mumkin (DoS qarshi)', async () => {
    // Zararli IP 3 xato qiladi → global ham shu zahoti lock qilmasligi kerak
    // (review fix: per-IP bucket — boshqa admin'lar kiradi). 2 xato per-IP:
    for (let i = 1; i <= 2; i += 1) {
      const r = await recordAdminLoginFailure('203.0.113.9');
      expect(r.locked).toBe(false);
    }
    // Global counter 2 — hali lock emas; boshqa IP hali kira oladi
    const other = await adminLoginLockoutCheck('203.0.113.10');
    expect(other.locked).toBe(false);
    // 3-chi xato shu IP'dan → per-IP lock
    const third = await recordAdminLoginFailure('203.0.113.9');
    expect(third.locked).toBe(true);
    expect(third.perIp).toBe(true);
    // Boshqa IP hali ochiq (global lock emas)
    const other2 = await adminLoginLockoutCheck('203.0.113.10');
    expect(other2.locked).toBe(false);
    // Zararli IP bloklangan
    const bad = await adminLoginLockoutCheck('203.0.113.9');
    expect(bad.locked).toBe(true);
    expect(bad.perIp).toBe(true);
  });

  it('security state settings/admin_security da saqlanadi (PII minimal)', async () => {
    await updateAdminSecurity({ lastCity: 'Toshkent', lastLoginAt: Date.now(), lastIpHash: 'h1' });
    const s = await getAdminSecurity();
    expect(s.lastCity).toBe('Toshkent');
    expect(typeof s.lastIpHash).toBe('string');
    expect(s.updatedAt).toBeTypeOf('number');
  });
});

describe('evaluateAdminRisk — suspicious admin login (A-30 §14)', () => {
  it('signal yo\'q → trusted (login buzilmaydi)', async () => {
    const r = await evaluateAdminRisk({ ip: '203.0.113.5', deviceFp: null }, {});
    expect(r.action).toBe('allow');
    expect(r.tier).toBe('trusted');
  });

  it('bir xil qurilma qaytsa → trusted_device signal → allow', async () => {
    const fp = 'ab'.repeat(8);
    const r = await evaluateAdminRisk(
      { ip: '203.0.113.5', deviceFp: fp },
      { lastDeviceFp: fp, lastCity: 'Toshkent', lastLoginAt: Date.now() - 3600000 }
    );
    expect(r.signals).toContain('trusted_device');
    expect(r.action).toBe('allow');
  });

  it('yangi qurilma (fp farq) → new_device +0.3 → stepup', async () => {
    const r = await evaluateAdminRisk(
      { ip: '203.0.113.5', deviceFp: 'cd'.repeat(8) },
      { lastDeviceFp: 'ab'.repeat(8), lastCity: 'Toshkent', lastLoginAt: Date.now() - 3600000 }
    );
    expect(r.signals).toContain('new_device');
    expect(r.tier).toBe('unknown');
    expect(r.action).toBe('stepup');
  });

  it('impossible travel: Toshkent → Samarqand 10 daqiqada → block (yangi qurilma bilan)', async () => {
    // 203.0.113.x → Toshkent; 198.51.100.x → Samarqand (~300 km, 10 daqiqa → 1800 km/h).
    // Yangi qurilma (fp farq) + impossible_travel → 0.3 + 0.5 = 0.8 → suspicious/block.
    const r = await evaluateAdminRisk(
      { ip: '198.51.100.7', deviceFp: 'cd'.repeat(8) },
      { lastDeviceFp: 'ab'.repeat(8), lastCity: 'Toshkent', lastLoginAt: Date.now() - 10 * 60 * 1000 }
    );
    expect(r.signals).toContain('impossible_travel');
    expect(r.signals).toContain('new_device');
    expect(r.action).toBe('block');
  });

  it('ADMIN_MFA_ACCOUNT = "admin" — mfa-totp moduli bilan izchil', () => {
    expect(ADMIN_MFA_ACCOUNT).toBe('admin');
  });
});
