/**
 * AUTH D-31 (wsl) — session-manager ↔ Redis birlashma
 *
 * recordSession → sorted-set (parallelSessionsAdd), limit'dan chiqqan eng eski
 * sessiya store'dan destroy + cross-node publishRevoke; revokeSession /
 * revokeByUser / revokeOtherSessions → parallelSessionsRemove + publishRevoke;
 * failover: Redis yo'q bo'lsa login qattiq emas (fail-open, §26).
 *
 * ioredis-mock (NODE_ENV=test — tarmoqqa chiqmaydi) + vitest LOCAL_DB_FILE
 * (har process uchun alohida temp DB — data/db.json tegsiz).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createRedisService } from '../../../src/modules/auth/redis-service.js';
import {
  setRedisService,
  setSessionStore,
  recordSession,
  revokeSession,
  revokeByUser,
  revokeOtherSessions,
} from '../../../src/modules/auth/session-manager.js';

let svc;
let destroyed;
let received;

describe('AUTH D-31 (wsl) — session-manager ↔ Redis birlashma', () => {
  beforeAll(async () => {
    const { default: RedisMock } = await import('ioredis-mock');
    svc = await createRedisService({ url: 'redis://mock', client: new RedisMock() });
    setRedisService(svc);
    destroyed = [];
    received = [];
    // Fake express-session store — destroy chaqiruvlarini qayd qiladi
    setSessionStore({
      destroy: (sid, cb) => { destroyed.push(sid); cb?.(); },
    });
    await svc.onRevoke((msg) => received.push(msg));
  });

  afterAll(async () => {
    setRedisService(null);
    setSessionStore(null);
    await svc.close();
  });

  it('1) recordSession → sorted-set ga qo\'shiladi (count 1)', async () => {
    const ok = await recordSession({ userId: 'd31-u1', sessionId: 'sess-1', ipAddress: '10.0.0.1', userAgent: 'UA-1', authMethod: 'password' });
    expect(ok).toBe(true);
    expect(await svc.parallelSessionsCount('d31-u1')).toBe(1);
    expect(await svc.parallelSessionsOldest('d31-u1')).toBe('sess-1');
  });

  it('2) limit (5) dan oshganda eng eski destroy + cross-node revoke (A-02/D-31 §07)', async () => {
    // sess-2..sess-6 qo'shamiz — 6-chisi sess-1 ni evict qiladi
    for (let i = 2; i <= 6; i++) {
      await recordSession({ userId: 'd31-u1', sessionId: `sess-${i}`, authMethod: 'password' });
    }
    expect(await svc.parallelSessionsCount('d31-u1')).toBe(5); // limit saqlanadi
    expect(await svc.parallelSessionsOldest('d31-u1')).not.toBe('sess-1'); // eng eski chiqib ketdi
    // Store'dan destroy qilingan (server-side)
    expect(destroyed).toContain('sess-1');
    // Cross-node xabar: sess-1 uchun publishRevoke kelgan (pub/sub async — kutamiz)
    await new Promise((r) => setTimeout(r, 30));
    expect(received.some((m) => m.sessionId === 'sess-1' && m.reason === 'parallel_limit')).toBe(true);
  });

  it('3) revokeSession → sorted-set dan o\'chadi + publishRevoke', async () => {
    const before = received.length;
    const res = await revokeSession('d31-u1', 'sess-2');
    expect(res.ok).toBe(true);
    expect(await svc.parallelSessionsCount('d31-u1')).toBe(4);
    await new Promise((r) => setTimeout(r, 20));
    expect(received.length).toBeGreaterThan(before);
    expect(received[received.length - 1].sessionId).toBe('sess-2');
  });

  it('4) revokeByUser → har sessiya uchun cross-node revoke (bulk)', async () => {
    const before = received.length;
    const { count } = await revokeByUser('d31-u1', { reason: 'admin_block' });
    expect(count).toBeGreaterThan(0);
    await new Promise((r) => setTimeout(r, 20));
    const events = received.slice(before).filter((m) => m.reason === 'bulk_revoke');
    expect(events.length).toBe(count);
    expect(await svc.parallelSessionsCount('d31-u1')).toBe(0);
  });

  it('5) revokeOtherSessions → joriydan boshqalar revoke + sorted-set sync', async () => {
    await recordSession({ userId: 'd31-u2', sessionId: 'keep', authMethod: 'password' });
    await recordSession({ userId: 'd31-u2', sessionId: 'drop-a', authMethod: 'password' });
    await recordSession({ userId: 'd31-u2', sessionId: 'drop-b', authMethod: 'password' });
    const { count } = await revokeOtherSessions('d31-u2', 'keep');
    expect(count).toBe(2);
    expect(await svc.parallelSessionsCount('d31-u2')).toBe(1);
    expect(await svc.parallelSessionsOldest('d31-u2')).toBe('keep');
  });

  it('6) failover — Redis ulashmagan bo\'lsa login qattiq emas (§26)', async () => {
    setRedisService(null); // degrade: Redis yo'q
    const ok = await recordSession({ userId: 'd31-u3', sessionId: 'no-redis-1', authMethod: 'password' });
    expect(ok).toBe(true); // DB fallback — login buzilmaydi
    setRedisService(svc);
  });

  it('7) failover — Redis xatosi bo\'lsa ham recordSession ishlaydi (fail-open)', async () => {
    // Xatolik beruvchi fake service
    setRedisService({
      parallelSessionsAdd: async () => { throw new Error('redis down'); },
      publishRevoke: async () => { throw new Error('redis down'); },
      parallelSessionsRemove: async () => { throw new Error('redis down'); },
    });
    const ok = await recordSession({ userId: 'd31-u4', sessionId: 'broken-1', authMethod: 'password' });
    expect(ok).toBe(true);
    setRedisService(svc);
  });
});
