/**
 * AUTH D-03 — Redis service unit tests (ioredis-mock, D-03 §28)
 *
 * Cache TTL, idempotency SETNX, risk counters, key prefix, PII yo'q,
 * fail-open (Redis xatosi bloklamaydi).
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { createRedisService } from '../../src/modules/auth/redis-service.js';

let svc;

describe('AUTH D-03 — Redis service (ioredis-mock)', () => {
  beforeAll(async () => {
    const { default: RedisMock } = await import('ioredis-mock');
    const client = new RedisMock();
    svc = await createRedisService({ url: 'redis://mock', client });
  });
  afterAll(async () => {
    await svc.close();
  });

  it('cacheSet → cacheGet round-trip', async () => {
    await svc.cacheSet('otm:stats', '{"count":211}', 60000, 'otm');
    const v = await svc.cacheGet('otm:stats', 'otm');
    expect(v).toBe('{"count":211}');
  });

  it('cacheGet noma\'lum kalit → null', async () => {
    expect(await svc.cacheGet('nope', 'otm')).toBeNull();
  });

  it('cache TTL: expiry dan keyin null', async () => {
    // TTL sekundlarda (ioredis-mock) — 1s TTL, 1.2s kutamiz
    await svc.cacheSet('short', 'x', 1000, 't');
    await new Promise((r) => setTimeout(r, 1200));
    expect(await svc.cacheGet('short', 't')).toBeNull();
  });

  it('key prefix + tenant scope: auth:{tenant}:{type}:{hash}', async () => {
    // Haqiqiy scope'li kalit yozamiz, keyin tekshiramiz
    await svc.cacheSet('some-scope', 'v', 60000, 'otm');
    const crypto = await import('node:crypto');
    const secret = process.env.SESSION_SECRET || 'redis-service';
    const hash = crypto.createHash('sha256').update(`${secret}:some-scope`).digest('hex').slice(0, 24);
    const keys = await svc.client.keys('auth:*');
    // Kalitlarda raw scope yo'q (faqat hash)
    expect(keys.some((k) => k.includes('some-scope'))).toBe(false);
    expect(keys.some((k) => k.includes(hash))).toBe(true);
  });

  it('idempotency: SETNX — birinchi true, ikkinchi false (TTL ichida)', async () => {
    const key = `attempt:${Date.now()}`;
    const first = await svc.acquireIdempotencyLock(key, 5000);
    expect(first).toBe(true);
    const second = await svc.acquireIdempotencyLock(key, 5000);
    expect(second).toBe(false);
    // release → qayta olish mumkin
    await svc.releaseIdempotencyLock(key);
    expect(await svc.acquireIdempotencyLock(key, 5000)).toBe(true);
  });

  it('incrCounter: TTL bilan counter oshadi', async () => {
    const scope = `ip:${Date.now()}`;
    expect(await svc.incrCounter(scope, 60000, 'risk')).toBe(1);
    expect(await svc.incrCounter(scope, 60000, 'risk')).toBe(2);
  });

  it('saddCounter: unique memberlar soni', async () => {
    const scope = `vel:${Date.now()}`;
    expect(await svc.saddCounter(scope, 'a', 60000, 'velocity')).toBe(1);
    expect(await svc.saddCounter(scope, 'b', 60000, 'velocity')).toBe(2);
    expect(await svc.saddCounter(scope, 'a', 60000, 'velocity')).toBe(2); // dup
  });

  it('ping → PONG (mock)', async () => {
    expect(await svc.ping()).toBe(true);
  });
});

describe('AUTH D-03 — fail-open (Redis xatosi)', () => {
  it('in-memory fallback: REDIS_URL yo\'q bo\'lsa ham ishlaydi', async () => {
    const memSvc = await createRedisService({ url: undefined });
    expect(memSvc.ok).toBe(false);
    await memSvc.cacheSet('k', 'v', 60000);
    expect(await memSvc.cacheGet('k')).toBe('v');
    expect(await memSvc.ping()).toBe(false);
    await memSvc.close();
  });
});
