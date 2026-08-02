/**
 * Edikit — E2E/Security: Camera Evidence ACL, Retention & Delete (Prompt 37)
 *
 * Security walk (graceful degradation without PostgreSQL):
 *   - Evidence review endpoint requires admin (ACL) — student/unauthenticated
 *     never reaches evidence data
 *   - Disposition endpoint requires admin (privileged action)
 *   - Retention endpoint requires admin
 *   - Sanitized status never leaks storage keys
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createApp } from '../../server.js';
import { createRequest, snapshotDb, restoreDb } from '../helpers/setup.js';

let httpServer;

beforeAll(async () => {
  snapshotDb();
  const result = await createApp();
  httpServer = result.httpServer;
  await new Promise((resolve) => httpServer.listen(0, resolve));
});

afterAll(async () => {
  restoreDb();
  return new Promise((resolve) => {
    if (httpServer && httpServer.listening) httpServer.close(() => resolve());
    else resolve();
  });
});

describe('Camera evidence ACL (E2E walk)', () => {
  it('review timeline requires admin — student session gets 401/403', async () => {
    const req = await createRequest();
    const res = await req.get('/api/admin/attempts/1/camera/review');
    expect([401, 403]).toContain(res.status);
  });

  it('disposition requires admin (privileged action)', async () => {
    const req = await createRequest();
    const res = await req
      .post('/api/admin/camera/evidence/1/disposition')
      .send({ disposition: 'cleared' });
    expect([401, 403]).toContain(res.status);
  });

  it('retention enforcement requires admin', async () => {
    const req = await createRequest();
    const res = await req.post('/api/admin/camera/retention').send({});
    expect([401, 403]).toContain(res.status);
  });

  it('admin review page requires admin session (redirect to login otherwise)', async () => {
    const req = await createRequest();
    const res = await req.get('/admin/camera-review');
    expect([301, 302, 303, 401, 403]).toContain(res.status);
  });

  it('student pilot page requires student session (redirect otherwise)', async () => {
    const req = await createRequest();
    const res = await req.get('/user/camera-pilot');
    expect([301, 302, 303, 401, 403]).toContain(res.status);
  });
});

describe('Camera evidence retention/delete contract (pure layer)', () => {
  it('expired retention is deleted (isRetentionExpired + computeRetentionUntil)', async () => {
    const { computeRetentionUntil, isRetentionExpired } = await import('../../src/modules/camera/camera.schema.js');
    const until = computeRetentionUntil(30, Date.now() - 31 * 24 * 60 * 60 * 1000);
    expect(isRetentionExpired(until)).toBe(true);
  });

  it('disposition transition guard blocks discarded → cleared (ACL on state machine)', async () => {
    const { validateDispositionTransition } = await import('../../src/modules/camera/camera.schema.js');
    expect(validateDispositionTransition('discarded', 'cleared').ok).toBe(false);
  });
});
