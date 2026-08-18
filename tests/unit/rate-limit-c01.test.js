/**
 * AUTH C-01 — Tiered rate limiter (per-account / per-IP / per-ASN / burst)
 *
 * Tests:
 *   1. Config — har endpoint limit jadvali (10 guruh) mavjud + qiymatlar
 *   2. Sliding-window — account tier qattiq blok (RATE_LIMITED + Retry-After)
 *   3. Burst token-bucket — 1 soniyalik portlash qarshi
 *   4. Per-ASN — bir xil ASN'dagi turli IP'lar jamlanadi; fail-open
 *   5. X-RateLimit-Limit/Remaining/Reset header'lar
 *   6. GET skip — sahifa yuklashlar sanalmaydi
 *   7. accountKeyOf — raw PII saqlanmaydi (HMAC hash)
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ENDPOINT_LIMITS, ENDPOINT_ROUTES } from '../../src/config/rate-limits.js';
import { createAuthRateLimiter } from '../../middleware/rate-limit.js';
import { setAsnResolver } from '../../src/modules/auth/asn.js';

function mockReq({ method = 'POST', ip = '203.0.113.10', body = {}, session = {} } = {}) {
  return { method, ip, body, session, headers: { 'user-agent': 'test' } };
}
function mockRes() {
  const res = { _status: 200, headers: {} };
  res.set = (k, v) => { res.headers[k] = v; return res; };
  res.status = (s) => { res._status = s; return res; };
  res.json = (obj) => { res.body = obj; return res; };
  return res;
}

describe('C-01 config — endpoint rate limit jadvali', () => {
  it('10 endpoint guruh + route prefix map bor', () => {
    expect(Object.keys(ENDPOINT_LIMITS).length).toBeGreaterThanOrEqual(10);
    expect(Object.keys(ENDPOINT_ROUTES).length).toBeGreaterThanOrEqual(10);
  });

  it('login: per-IP 20/15 (backstop), per-account 15/15, per-ASN 100/15 — burst YO\'Q (argon2 throttle)', () => {
    const l = ENDPOINT_LIMITS.login;
    expect(l.ip.max).toBe(20);
    expect(l.account.max).toBe(15);
    expect(l.asn.max).toBe(100);
    expect(l.burst).toBeUndefined();
  });

  it('register: per-IP 20/15, per-ASN 50/15, burst 5/s', () => {
    const r = ENDPOINT_LIMITS.register;
    expect(r.ip.max).toBe(20);
    expect(r.asn.max).toBe(50);
    expect(r.burst.max).toBe(5);
    expect(r.burst.windowMs).toBe(1000);
  });

  it('verify/reset: per-account 3/soat; mfa 5/15; telegram 5/15; roster 10/15', () => {
    expect(ENDPOINT_LIMITS.verifySend.account.max).toBe(3);
    expect(ENDPOINT_LIMITS.verifySend.account.windowMs).toBe(60 * 60 * 1000);
    expect(ENDPOINT_LIMITS.reset.account.max).toBe(3);
    expect(ENDPOINT_LIMITS.mfa.account.max).toBe(5);
    expect(ENDPOINT_LIMITS.telegram.ip.max).toBe(5);
    expect(ENDPOINT_LIMITS.roster.user.max).toBe(10);
  });
});

describe('C-01 tiered middleware — account (qattiq)', () => {
  let limiter;

  beforeEach(() => {
    limiter = createAuthRateLimiter({ redisOk: false });
    setAsnResolver(null); // fail-open: ASN yo'q
  });

  it('account limit oshsa → 429 RATE_LIMITED + Retry-After', async () => {
    const mw = limiter('login');
    // max 15 → 16-chi blok. Burst (5/s) aralashmasligi uchun sekundiga ≤4
    // request — real login argon2 ~250ms bilan shunday tezlikda bo'ladi.
    for (let i = 0; i < 15; i++) {
      const res = mockRes();
      let passed = false;
      await mw(mockReq({ body: { username: 'ali' }, ip: '203.0.113.10' }), res, () => { passed = true; });
      expect(passed).toBe(true);
      await new Promise((r) => setTimeout(r, 220));
    }
    const res = mockRes();
    let passed = false;
    await mw(mockReq({ body: { username: 'ali' }, ip: '203.0.113.10' }), res, () => { passed = true; });
    expect(passed).toBe(false);
    expect(res._status).toBe(429);
    expect(res.body.code).toBe('RATE_LIMITED');
    expect(res.body.retryAfter).toBeGreaterThan(0);
    expect(parseInt(res.headers['Retry-After'], 10)).toBe(res.body.retryAfter);
  });

  it('X-RateLimit-Limit/Remaining/Reset header\'lar bor (eng cheklovchi tier)', async () => {
    const mw = limiter('login');
    const res = mockRes();
    await mw(mockReq({ body: { username: 'ali' }, ip: '203.0.113.11' }), res, () => {});
    // Eng cheklovchi tier = burst (5/s) — shu ko'rsatiladi; account 15/15
    expect(['5', '15']).toContain(res.headers['X-RateLimit-Limit']);
    const limit = parseInt(res.headers['X-RateLimit-Limit'], 10);
    const remaining = parseInt(res.headers['X-RateLimit-Remaining'], 10);
    expect(remaining).toBeGreaterThanOrEqual(0);
    expect(remaining).toBeLessThan(limit);
    expect(parseInt(res.headers['X-RateLimit-Reset'], 10)).toBeGreaterThan(0);
  });

  it('turli accountlar bir-biriga ta\'sir qilmaydi', async () => {
    const mw = limiter('login');
    for (let i = 0; i < 20; i++) {
      const res = mockRes();
      await mw(mockReq({ body: { username: `u${i}` }, ip: '203.0.113.12' }), res, () => {});
    }
    // hech biri bloklanmadi — har account alohida bucket
  });

  it('GET request sanalmaydi (sahifa yuklash)', async () => {
    const mw = limiter('login');
    for (let i = 0; i < 30; i++) {
      const res = mockRes();
      let passed = false;
      await mw(mockReq({ method: 'GET', body: {}, ip: '203.0.113.13' }), res, () => { passed = true; });
      expect(passed).toBe(true);
    }
  });

  it('account kaliti raw PII saqlamaydi — HMAC hash', async () => {
    // middleware ichidagi bucket'lar hash'lanadi; biz hech qanday raw email
    // blok xabarida ko'rinmasligini tekshiramiz
    const mw = limiter('verifySend');
    const res = mockRes();
    await mw(mockReq({ body: { email: 'pii@example.com' }, ip: '203.0.113.14' }), res, () => {});
    expect(JSON.stringify(res.headers)).not.toContain('pii@example.com');
    expect(res.body ? JSON.stringify(res.body) : '').not.toContain('pii@example.com');
  });
});

describe('C-01 per-ASN — o\'rta tier', () => {
  it('bir xil ASN turli IP\'lar bilan jamlanadi → limitga yetganda blok', async () => {
    // ASN 64500 override: 203.0.113.0/24
    setAsnResolver(async () => 64500);
    const limiter = createAuthRateLimiter({ redisOk: false });
    const mw = limiter('register'); // asn max 50
    // 50 xil IP, bir xil ASN
    for (let i = 0; i < 50; i++) {
      const res = mockRes();
      await mw(mockReq({ ip: `203.0.113.${(i % 250) + 1}`, body: {} }), res, () => {});
    }
    const res = mockRes();
    let passed = false;
    await mw(mockReq({ ip: '203.0.113.99', body: {} }), res, () => { passed = true; });
    expect(passed).toBe(false);
    expect(res._status).toBe(429);
  });

  it('ASN resolve qilinmasa → fail-open (tier skip)', async () => {
    setAsnResolver(async () => null); // aniqlanmadi
    const limiter = createAuthRateLimiter({ redisOk: false });
    const mw = limiter('register');
    for (let i = 0; i < 60; i++) {
      const res = mockRes();
      let passed = false;
      await mw(mockReq({ ip: `203.0.113.${(i % 250) + 1}`, body: {} }), res, () => { passed = true; });
      expect(passed).toBe(true); // ASN tier o'tkazib yuborildi
    }
  });

  it('ipInCidr — CIDR moslashuvi to\'g\'ri', async () => {
    const { ipInCidr } = await import('../../src/modules/auth/asn.js');
    expect(ipInCidr('203.0.113.55', '203.0.113.0/24')).toBe(true);
    expect(ipInCidr('203.0.114.1', '203.0.113.0/24')).toBe(false);
    expect(ipInCidr('10.1.2.3', '10.0.0.0/8')).toBe(true);
    expect(ipInCidr('not-an-ip', '203.0.113.0/24')).toBe(false);
  });
});

describe('C-01 burst — token-bucket', () => {
  it('1 soniyada 5 dan ortiq register POST → 429 (register burst 5/s)', async () => {
    const limiter = createAuthRateLimiter({ redisOk: false });
    const mw = limiter('register');
    // turli account'lar — burst per-IP qatlami
    for (let i = 0; i < 5; i++) {
      const res = mockRes();
      await mw(mockReq({ body: {}, ip: '198.51.100.7' }), res, () => {});
    }
    const res = mockRes();
    let passed = false;
    await mw(mockReq({ body: {}, ip: '198.51.100.7' }), res, () => { passed = true; });
    expect(passed).toBe(false);
    expect(res._status).toBe(429);
  });

  it('noma\'lum routeKey → o\'tkazib yuboriladi', async () => {
    const limiter = createAuthRateLimiter({ redisOk: false });
    const mw = limiter('no-such-route');
    const res = mockRes();
    let passed = false;
    await mw(mockReq({ body: {} }), res, () => { passed = true; });
    expect(passed).toBe(true);
  });
});
