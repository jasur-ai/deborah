/**
 * AUTH D-03 — Redis to'liq (integration)
 *
 * Server boot: `redisService` app.set qilingan; session flow ishlaydi;
 * Redis yo'q bo'lsa in-memory fallback (fail-open).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import supertest from 'supertest';
import { createApp } from '../../server.js';
import { snapshotDb, restoreDb } from '../helpers/setup.js';

let app;
let httpServer;

describe('AUTH D-03 — Redis service wiring (integration)', () => {
  beforeAll(async () => {
    await snapshotDb();
    ({ app, httpServer } = await createApp());
    await new Promise((r) => httpServer.listen(0, r));
  });
  afterAll(async () => {
    await restoreDb();
    await new Promise((r) => httpServer.close(r));
  });

  it('redisService app.get orqali mavjud (in-memory fallback test muhitida)', () => {
    const svc = app.get('redisService');
    expect(svc).toBeTruthy();
    expect(typeof svc.cacheSet).toBe('function');
    expect(typeof svc.acquireIdempotencyLock).toBe('function');
    // Test muhitida REDIS_URL yo'q → in-memory fallback (fail-open)
    expect(svc.ok).toBe(false);
  });

  it('cacheSet/cacheGet app service orqali ishlaydi', async () => {
    const svc = app.get('redisService');
    await svc.cacheSet('int:test', 'ok', 60000, 'int');
    expect(await svc.cacheGet('int:test', 'int')).toBe('ok');
  });

  it('idempotency lock app service orqali ishlaydi', async () => {
    const svc = app.get('redisService');
    const key = `int:idem:${Date.now()}`;
    expect(await svc.acquireIdempotencyLock(key, 5000)).toBe(true);
    expect(await svc.acquireIdempotencyLock(key, 5000)).toBe(false);
    await svc.releaseIdempotencyLock(key);
    expect(await svc.acquireIdempotencyLock(key, 5000)).toBe(true);
  });

  it('login page + session ishlaydi (Redis/MemoryStore) ', async () => {
    const agent = supertest.agent(app);
    const res = await agent.get('/user/login');
    expect(res.status).toBe(200);
    // Session cookie set bo'ldi
    expect(res.headers['set-cookie']).toBeTruthy();
  });
});
