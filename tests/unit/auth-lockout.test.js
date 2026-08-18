/**
 * Edikit — Auth Lockout & Rate Limit Service Unit Tests (AUTH A-03)
 *
 * Covers:
 *   - per-user hard lockout (failed_attempts / locked_until in DB)
 *   - per-IP soft lockout (in-memory window)
 *   - reset limit (3/hr per account) & register limit (5/15min per IP)
 *   - lockoutResponse 429 + Retry-After (JSON/API path)
 *   - jitter disabled in test env
 *   - audit redaction (password/token/otp never logged) + ip_hash
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

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
        else if (r.found) Object.keys(testStore).forEach(k => delete testStore[k]);
      }),
    },
    default: {},
  };
});

// CONFIG env — test'da default'lar (jitter = 0)
vi.mock('../../config/env.js', () => ({
  default: {
    NODE_ENV: 'test',
    AUTH_LOCKOUT_IP_FAILURES: 5,
    AUTH_LOCKOUT_IP_MS: 5 * 60 * 1000,
    AUTH_LOCKOUT_USER_FAILURES: 10,
    AUTH_LOCKOUT_USER_MS: 15 * 60 * 1000,
    AUTH_JITTER_MAX_MS: 600,
    AUTH_REGISTER_MAX: 5,
    AUTH_RESET_MAX: 3,
  },
}));

import { fb } from '../../firebase/admin.js';
import {
  recordFailure,
  recordSuccess,
  checkUserLockout,
  checkResetLimit,
  recordResetRequest,
  checkRegisterLimit,
  recordRegister,
  lockoutResponse,
  jitterDelayMs,
  LOCKOUT_ERROR_CODE,
  _resetStores,
} from '../../src/modules/auth/lockout.js';
import { redactDetails, ipHash, auditDayKey, logAuthEvent } from '../../src/modules/auth/audit.js';

describe('Lockout Service (AUTH A-03)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.keys(testStore).forEach(k => delete testStore[k]);
    _resetStores();
  });

  it('per-user: 10 xato urinish → hard lock (locked_until + retryAfter)', async () => {
    const ip = '203.0.113.7';
    let last;
    for (let i = 0; i < 10; i++) {
      last = await recordFailure({ userKey: 'user', ip, method: 'password' });
    }
    expect(last.locked).toBe(true);
    expect(last.retryAfterSeconds).toBe(900); // 15 daqiqa
    expect(last.userFailedAttempts).toBe(10);
    const snap = await fb.get('users/user/failed_attempts');
    expect(snap.val()).toBe(10);
    const lockedSnap = await fb.get('users/user/locked_until');
    expect(typeof lockedSnap.val()).toBe('number');
    expect(lockedSnap.val()).toBeGreaterThan(Date.now());
  });

  it("checkUserLockout: lock'dagi user uchun retryAfterSeconds qaytaradi", async () => {
    await fb.set('users/locked/failed_attempts', 12);
    await fb.set('users/locked/locked_until', Date.now() + 60_000);
    const res = await checkUserLockout('locked');
    expect(res.locked).toBe(true);
    expect(res.retryAfterSeconds).toBeGreaterThan(0);
    expect(res.retryAfterSeconds).toBeLessThanOrEqual(60);
    expect(res.failedAttempts).toBe(12);
  });

  it('recordSuccess: hisoblagichlarni tozalaydi (user + IP)', async () => {
    await fb.set('users/u1/failed_attempts', 7);
    await fb.set('users/u1/locked_until', Date.now() + 60_000);
    for (let i = 0; i < 5; i++) {
      await recordFailure({ ip: '198.51.100.4' }); // IP yumshoq lock
    }
    await recordSuccess({ userKey: 'u1', ip: '198.51.100.4' });
    const fa = await fb.get('users/u1/failed_attempts');
    expect(fa.val()).toBe(0);
    const lu = await fb.get('users/u1/locked_until');
    expect(lu.exists()).toBe(false);
    // IP lock tozalandi — keyingi failure qayta sanaydi
    const rec = await recordFailure({ ip: '198.51.100.4' });
    expect(rec.locked).toBe(false);
  });

  it("per-IP: 5 xato → yumshoq lock (userKey'siz)", async () => {
    let last;
    for (let i = 0; i < 5; i++) {
      last = await recordFailure({ ip: '203.0.113.9' });
    }
    expect(last.locked).toBe(true);
    expect(last.retryAfterSeconds).toBe(300); // 5 daqiqa
  });

  it('reset limit: 3/soat per account → 4-si bloklanadi', () => {
    for (let i = 0; i < 3; i++) {
      expect(checkResetLimit('alice').allowed).toBe(true);
      recordResetRequest('alice');
    }
    const blocked = checkResetLimit('ALICE'); // case-insensitive
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
  });

  it('register limit: 5/15 daqiqa per IP → 6-si bloklanadi', () => {
    for (let i = 0; i < 5; i++) {
      expect(checkRegisterLimit('198.51.100.10').allowed).toBe(true);
      recordRegister('198.51.100.10');
    }
    const blocked = checkRegisterLimit('198.51.100.10');
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
    expect(checkRegisterLimit('198.51.100.11').allowed).toBe(true); // boshqa IP ta'sir qilmaydi
  });

  it('lockoutResponse: API so\'rovga 429 + Retry-After + RATE_LIMITED', () => {
    const req = { originalUrl: '/api/auth/login', path: '/api/auth/login', accepts: () => 'json' };
    let status, body, header;
    const res = {
      set: vi.fn((k, v) => { header = [k, v]; return res; }),
      status: vi.fn((s) => { status = s; return res; }),
      json: vi.fn((b) => { body = b; return res; }),
    };
    lockoutResponse(req, res, { retryAfterSeconds: 87 });
    expect(status).toBe(429);
    expect(header).toEqual(['Retry-After', '87']);
    expect(body.code).toBe(LOCKOUT_ERROR_CODE);
    expect(body.retryAfter).toBe(87);
  });

  it('jitter: test muhitida 0 (CI tezligi)', () => {
    expect(jitterDelayMs(5)).toBe(0);
  });
});

describe('Auth Audit redaction (AUTH A-03)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.keys(testStore).forEach(k => delete testStore[k]);
  });

  it('redactDetails: password/token/otp/secret kalitlari olib tashlanadi', () => {
    const details = {
      username: 'alice',
      password: 'secret123',
      passwordHash: 'deadbeef',
      resetToken: 'tok',
      otp: '123456',
      client_secret: 'abc',
      nested: { code: 'x', ok: true },
      method: 'password',
    };
    const out = redactDetails(details);
    expect(out.username).toBe('alice');
    expect(out.method).toBe('password');
    expect(out).not.toHaveProperty('password');
    expect(out).not.toHaveProperty('passwordHash');
    expect(out).not.toHaveProperty('resetToken');
    expect(out).not.toHaveProperty('otp');
    expect(out).not.toHaveProperty('client_secret');
    expect(out.nested).not.toHaveProperty('code');
    expect(out.nested.ok).toBe(true);
  });

  it('ipHash: deterministik sha256, bo\'sh bo\'lsa null', () => {
    const a = ipHash('203.0.113.7');
    expect(a).toBe(ipHash('203.0.113.7'));
    expect(a).not.toBe(ipHash('203.0.113.8'));
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(ipHash(null)).toBeNull();
    expect(ipHash('')).toBeNull();
  });

  it('auditDayKey: YYYY-MM-DD format', () => {
    expect(auditDayKey(new Date('2026-08-09T12:00:00Z').getTime())).toBe('2026-08-09');
    expect(auditDayKey(0)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('logAuthEvent: PII-minimal yozuv (ip_hash, redacted detail, no password)', async () => {
    await logAuthEvent({
      action: 'auth.login.failed',
      outcome: 'failed',
      method: 'password',
      actorId: 'user',
      ipAddress: '203.0.113.7',
      userAgent: 'Mozilla/5.0 Test',
      details: { username: 'alice', password: 'hunter2', retryAfter: 300 },
    });
    // auth_audit/{day}/{ts}_* yozuvini topamiz
    const snap = await fb.get('auth_audit');
    expect(snap.exists()).toBe(true);
    const days = snap.val();
    const dayKeys = Object.keys(days);
    expect(dayKeys.length).toBe(1);
    const day = days[dayKeys[0]];
    const entries = Object.values(day);
    expect(entries.length).toBe(1);
    const entry = entries[0];
    expect(entry.action).toBe('auth.login.failed');
    expect(entry.outcome).toBe('failed');
    expect(entry.method).toBe('password');
    expect(entry.actor_id).toBe('user');
    expect(entry.ip_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(entry.ip_hash).toBe(ipHash('203.0.113.7'));
    expect(entry.ua).toContain('Mozilla');
    expect(entry.detail.username).toBe('alice');
    expect(entry.detail).not.toHaveProperty('password');
  });
});
