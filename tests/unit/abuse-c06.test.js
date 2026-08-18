/**
 * Edikit — AUTH C-06 Credential stuffing + OTP bombing — Unit tests
 * -------------------------------------------------------------------
 *  - detectStuffing: IP ko'p account (block), password spray (challenge),\n *    device ko'p account (challenge), past daraja (alert/ok)\n *  - detectOtpBomb: per-user 3/soat, per-IP 10/soat\n *  - fail-open: Redis yo'q → ok\n *  - passHash: parol hech qachon log'da/Redis'da emas\n */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const auditEvents = [];
vi.mock('../../src/modules/auth/audit.js', () => ({
  audit: vi.fn(async () => true),
  logAuthEvent: vi.fn(async ({ action, outcome, details }) => {
    auditEvents.push({ action, outcome, details });
    return true;
  }),
  AUDIT_ACTIONS: {
    STUFFING_DETECTED: 'auth:abuse:stuffing',
    OTP_BOMB_DETECTED: 'auth:abuse:otp_bomb',
    ABUSE_BLOCKED: 'auth:abuse:blocked',
  },
}));

vi.mock('../../src/telemetry/index.js', () => ({
  recordMetric: vi.fn(() => true),
}));

import { detectStuffing, detectOtpBomb, passHash, _abuseConfig } from '../../src/modules/auth/abuse.js';

beforeEach(() => {
  auditEvents.length = 0;
});

afterEach(() => {
  vi.clearAllMocks();
});

/** Redis SET mock — haqiqiy SADD/SCARD semantikasi. */
function makeRedis() {
  const sets = new Map(); // key → Set
  const counters = new Map(); // key → count
  return {
    sadd: vi.fn(async (key, val) => {
      if (!sets.has(key)) sets.set(key, new Set());
      sets.get(key).add(val);
      return sets.get(key).size;
    }),
    scard: vi.fn(async (key) => (sets.get(key) ? sets.get(key).size : 0)),
    expire: vi.fn(async () => 1),
    incr: vi.fn(async (key) => {
      counters.set(key, (counters.get(key) || 0) + 1);
      return counters.get(key);
    }),
    _sets: sets,
    _counters: counters,
  };
}

const REDIS_OK = { redisOk: true };

describe('detectStuffing — IP ko\'p account (guide §06)', () => {
  it('10 turli account fail (bir IP) → block + ABUSE_BLOCKED audit', async () => {
    const redis = makeRedis();
    let last = { level: 'ok' };
    for (let i = 0; i < 10; i++) {
      last = await detectStuffing({
        redis, ...REDIS_OK, ipAddress: '203.0.113.10',
        passwordHash: `hash${i}`, fingerprint: `fp${i}`, userId: `user${i}`,
      });
    }
    expect(last.level).toBe('block');
    expect(last.pattern).toBe('stuffing_ip');
    expect(auditEvents.some((e) => e.action === 'auth:abuse:blocked')).toBe(true);
  });

  it('5-9 turli account → alert (block emas)', async () => {
    const redis = makeRedis();
    let last = { level: 'ok' };
    for (let i = 0; i < 6; i++) {
      last = await detectStuffing({
        redis, ...REDIS_OK, ipAddress: '203.0.113.11',
        passwordHash: `h${i}`, fingerprint: `f${i}`, userId: `u${i}`,
      });
    }
    expect(last.level).toBe('alert');
    expect(auditEvents.some((e) => e.action === 'auth:abuse:stuffing')).toBe(true);
  });

  it('1-4 fail → ok (normal)', async () => {
    const redis = makeRedis();
    let last = { level: 'ok' };
    for (let i = 0; i < 3; i++) {
      last = await detectStuffing({
        redis, ...REDIS_OK, ipAddress: '203.0.113.12',
        passwordHash: `h${i}`, userId: `u${i}`,
      });
    }
    expect(last.level).toBe('ok');
  });
});

describe('detectStuffing — password spray + device (guide §06)', () => {
  it('bir parol 5+ username bilan → challenge password_spray', async () => {
    const redis = makeRedis();
    const samePass = 'bir-xil-parol';
    let last = { level: 'ok' };
    for (let i = 0; i < 5; i++) {
      last = await detectStuffing({
        redis, ...REDIS_OK, ipAddress: `203.0.113.2${i}`,
        passwordHash: passHash(samePass), userId: `user${i}`,
      });
    }
    expect(last.level).toBe('challenge');
    expect(last.pattern).toBe('password_spray');
  });

  it('bir fingerprint 3+ account bilan → challenge device_multi_account', async () => {
    const redis = makeRedis();
    let last = { level: 'ok' };
    for (let i = 0; i < 3; i++) {
      last = await detectStuffing({
        redis, ...REDIS_OK, ipAddress: `203.0.113.3${i}`,
        passwordHash: `h${i}`, fingerprint: 'BOT_FP_123', userId: `u${i}`,
      });
    }
    expect(last.level).toBe('challenge');
    expect(last.pattern).toBe('device_multi_account');
  });

  it('parol hash — parol ozi Redisda/logda emas', async () => {
    const redis = makeRedis();
    await detectStuffing({
      redis, ...REDIS_OK, ipAddress: '203.0.113.13',
      passwordHash: passHash('sirli-parol'), userId: 'u1',
    });
    // Redis'da saqlangan qiymatlar faqat user_id'lar (parol yo'q)
    const allValues = [...redis._sets.values()].flatMap((s) => [...s]);
    expect(allValues.some((v) => String(v).includes('sirli'))).toBe(false);
    expect(passHash('sirli-parol')).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('detectOtpBomb — per-user 3/soat, per-IP 10/soat (guide §07)', () => {
  it('per-user 3 send o\'tadi, 4-chisi bloklanadi', async () => {
    const redis = makeRedis();
    const results = [];
    for (let i = 0; i < 4; i++) {
      results.push(await detectOtpBomb({ redis, ...REDIS_OK, userId: 'u1', ipAddress: '203.0.113.20' }));
    }
    expect(results.slice(0, 3).every((r) => r.allowed)).toBe(true);
    expect(results[3].allowed).toBe(false);
    expect(results[3].level).toBe('block');
    expect(results[3].retryAfterSeconds).toBe(3600);
    expect(auditEvents.some((e) => e.action === 'auth:abuse:otp_bomb' && e.outcome === 'blocked')).toBe(true);
  });

  it('per-IP 10 send o\'tadi, 11-chisi bloklanadi (turli userlar)', async () => {
    const redis = makeRedis();
    const results = [];
    for (let i = 0; i < 11; i++) {
      results.push(await detectOtpBomb({ redis, ...REDIS_OK, userId: `u${i}`, ipAddress: '203.0.113.21' }));
    }
    expect(results.slice(0, 10).every((r) => r.allowed)).toBe(true);
    expect(results[10].allowed).toBe(false);
  });
});

describe('fail-open (C-01 §23)', () => {
  it('Redis yo\'q / redisOk=false → ok (auth buzilmaydi)', async () => {
    const r1 = await detectStuffing({ redis: null, redisOk: false, ipAddress: 'x', passwordHash: 'h', userId: 'u' });
    expect(r1.level).toBe('ok');
    const r2 = await detectOtpBomb({ redis: null, redisOk: false, userId: 'u', ipAddress: 'x' });
    expect(r2.allowed).toBe(true);
  });

  it('Redis xato tashlasa → ok', async () => {
    const bad = { sadd: vi.fn(async () => { throw new Error('down'); }), incr: vi.fn(async () => { throw new Error('down'); }) };
    const r1 = await detectStuffing({ redis: bad, redisOk: true, ipAddress: 'x', passwordHash: 'h', userId: 'u' });
    expect(r1.level).toBe('ok');
    const r2 = await detectOtpBomb({ redis: bad, redisOk: true, userId: 'u', ipAddress: 'x' });
    expect(r2.allowed).toBe(true);
  });
});

describe('config', () => {
  it('threshold va oyna (C-06 §25: 15 daqiqa TTL)', () => {
    const c = _abuseConfig();
    expect(c.WINDOW_MS).toBe(15 * 60 * 1000);
    expect(c.OTP_USER_LIMIT).toBe(3);
    expect(c.OTP_IP_LIMIT).toBe(10);
    expect(c.STUFFING_IP_FAILS).toBe(10);
    expect(c.SPRAY_PASSWORDS).toBe(5);
  });
});
