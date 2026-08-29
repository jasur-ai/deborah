/**
 * AUTH D-31 — Redis session detail (ioredis-mock + memory fallback)
 *
 * Sorted-set parallel limit (A-02, Lua atomic), pub/sub cross-node revoke,
 * failover degrade mode. Race test: parallel login/revoke atomic.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createRedisService } from '../../../src/modules/auth/redis-service.js';

let svc;
let memSvc;

describe('AUTH D-31 — Redis session detail', () => {
  beforeAll(async () => {
    const { default: RedisMock } = await import('ioredis-mock');
    svc = await createRedisService({ url: 'redis://mock', client: new RedisMock() });
    memSvc = await createRedisService({ url: undefined }); // memory fallback
  });
  afterAll(async () => {
    await svc.close();
    await memSvc.close();
  });

  /* ── Sorted-set parallel limit (A-02, §06) ── */
  it('1) parallelSessionsAdd — limit 3, 4-chi kelganda eng eski evict (Lua atomic)', async () => {
    await svc.parallelSessionsAdd('user-a', 's1', { limit: 3 });
    await svc.parallelSessionsAdd('user-a', 's2', { limit: 3 });
    await svc.parallelSessionsAdd('user-a', 's3', { limit: 3 });
    expect(await svc.parallelSessionsCount('user-a')).toBe(3);
    const res = await svc.parallelSessionsAdd('user-a', 's4', { limit: 3 });
    expect(res.count).toBe(3);
    expect(await svc.parallelSessionsOldest('user-a')).not.toBe('s1'); // s1 evicted
  });

  it('2) parallelSessionsRemove — revoke dan keyin count kamayadi', async () => {
    await svc.parallelSessionsRemove('user-a', 's2');
    expect(await svc.parallelSessionsCount('user-a')).toBe(2);
  });

  it('3) parallelSessionsAdd — memory fallback ham limitni saqlaydi', async () => {
    for (let i = 1; i <= 6; i++) await memSvc.parallelSessionsAdd('user-m', `m${i}`, { limit: 5 });
    expect(await memSvc.parallelSessionsCount('user-m')).toBe(5);
  });

  /* ── pub/sub cross-node revoke (§09/§27) ── */
  it('4) publishRevoke → onRevoke darhol qabul qiladi (same-process)', async () => {
    const received = [];
    const unsub = await svc.onRevoke((msg) => received.push(msg));
    await svc.publishRevoke({ sessionId: 'sess-123', userId: 'u1' });
    await new Promise((r) => setTimeout(r, 30));
    expect(received.length).toBe(1);
    expect(received[0].sessionId).toBe('sess-123');
    expect(received[0]).not.toHaveProperty('password'); // PII minimal §12
    unsub();
  });

  it('5) onRevoke unsubscribe — keyin kelmaydi', async () => {
    const received = [];
    const unsub = await svc.onRevoke((m) => received.push(m));
    unsub();
    await svc.publishRevoke({ sessionId: 'sess-999' });
    await new Promise((r) => setTimeout(r, 20));
    expect(received.length).toBe(0);
  });

  it('6) pub/sub memory fallback ishlaydi (REDIS_URL yoq)', async () => {
    const received = [];
    const unsub = await memSvc.onRevoke((m) => received.push(m));
    await memSvc.publishRevoke({ sessionId: 'sess-mem' });
    await new Promise((r) => setTimeout(r, 20));
    expect(received.some((m) => m.sessionId === 'sess-mem')).toBe(true);
    unsub();
  });

  /* ── Failover degrade mode (§10/§26) ── */
  it('7) health — redis ok → degrade false', async () => {
    const h = await svc.health();
    expect(h.ok).toBe(true);
    expect(h.degrade).toBe(false);
  });

  it('8) degrade mode — Redis down bolsa ok=false (login qattiq emas, fallback DB)', async () => {
    // ping'da xato beradigan mock client — real DNS chaqiruvi yo'q
    const dead = await createRedisService({
      url: 'redis://mock-down',
      client: { ping: async () => { throw new Error('redis down'); }, quit: async () => {} },
    });
    const h = await dead.health();
    expect(h.degrade).toBe(true);
    await dead.close();
  });

  /* ── Race: parallel login/revoke (Lua atomic, §07/§21) ── */
  it('9) race — parallel login (3x) limit 5: hech qachon 5 dan oshmaydi', async () => {
    await Promise.all([
      svc.parallelSessionsAdd('user-race', 'r1', { limit: 5 }),
      svc.parallelSessionsAdd('user-race', 'r2', { limit: 5 }),
      svc.parallelSessionsAdd('user-race', 'r3', { limit: 5 }),
    ]);
    const count = await svc.parallelSessionsCount('user-race');
    expect(count).toBe(3);
    // 6 ta parallel — limit 5, count hech qachon 5 dan oshmaydi
    const results = await Promise.all(
      Array.from({ length: 6 }, (_, i) => svc.parallelSessionsAdd('user-race', `rx${i}`, { limit: 5 }))
    );
    results.forEach((r) => expect(r.count).toBeLessThanOrEqual(5));
    expect(await svc.parallelSessionsCount('user-race')).toBeLessThanOrEqual(5);
  });
});
