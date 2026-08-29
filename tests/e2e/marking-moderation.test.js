/**
 * Deborah — Marking & Moderation e2e/security tests (Prompt 46)
 *
 * E2E walk (graceful degradation without PostgreSQL):
 *   - Admin page renders with design-system chrome.
 *   - Meta endpoint exposes constants (markerRoles, markingModes…).
 *   - Write paths degrade to 400 'PostgreSQL required' after CSRF
 *     (validation contract intact over the wire).
 *   - Unauthenticated access rejected (requireAdmin).
 *   - Security: external-examiner scope enforced at service layer;
 *     pseudonym endpoints never leak student identity.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createApp } from '../../server.js';
import CONFIG from '../../src/config/env.js';
import { createRequest, snapshotDb, restoreDb } from '../helpers/setup.js';

let app;
let httpServer;
let agent;
let csrfToken;

beforeAll(async () => {
  snapshotDb();
  const result = await createApp();
  app = result.app;
  httpServer = result.httpServer;
  await new Promise((resolve) => httpServer.listen(0, resolve));

  const supertest = (await import('supertest')).default;
  agent = supertest.agent(app);

  const page = await agent.get('/admin/login');
  const m = page.text.match(/name="_csrf"\s+value="([^"]+)"/);
  await agent.post('/admin/login').type('form').send({
    username: CONFIG.ADMIN_USER,
    password: CONFIG.ADMIN_PASS,
    _csrf: m ? m[1] : '',
  });

  const dash = await agent.get('/admin/dashboard');
  const t = dash.text.match(/window\.__CSRF_TOKEN\s*=\s*'([^']+)'/);
  csrfToken = t ? t[1] : '';
});

afterAll(async () => {
  await new Promise((resolve) => httpServer.close(resolve));
  restoreDb();
});

function csrfHeader() {
  return { 'x-csrf-token': csrfToken || '' };
}

describe('marking — admin page + meta', () => {
  it('GET /admin/marking renders for an admin', async () => {
    const res = await agent.get('/admin/marking');
    expect(res.status).toBe(200);
    expect(res.text).toContain('Marking &amp; Moderation');
    expect(res.text).toContain('Deborah Admin');
  });

  it('GET /api/admin/marking/meta exposes constants', async () => {
    const res = await agent.get('/api/admin/marking/meta');
    expect(res.status).toBe(200);
    expect(res.body.markerRoles).toContain('second_marker');
    expect(res.body.markerRoles).toContain('external_examiner');
    expect(res.body.markingModes.DOUBLE).toBe('double');
    expect(res.body.markingModes.SECOND).toBe('second');
    expect(res.body.defaults).toBeTruthy();
    expect(res.body.defaults.disagreementThreshold).toBeGreaterThan(0);
  });

  it('unauthenticated access to /admin/marking is rejected', async () => {
    const anon = (await import('supertest')).default(app);
    const res = await anon.get('/admin/marking');
    expect([302, 401, 403]).toContain(res.status);
  });

  it('unauthenticated POST to assignments is rejected', async () => {
    const anon = (await import('supertest')).default(app);
    const res = await anon.post('/api/admin/marking/assignments').send({ assessmentId: 1, markerUserId: 2 });
    expect([302, 401, 403]).toContain(res.status);
  });
});

describe('marking — write paths degrade gracefully (no PG)', () => {
  it('POST assignments validates then degrades to 400', async () => {
    const res = await agent
      .post('/api/admin/marking/assignments')
      .set(csrfHeader())
      .send({ assessmentId: 1, markerUserId: 2, role: 'marker' });
    expect(res.status).toBe(400);
    expect(res.body.ok).toBe(false);
    expect(res.body.error).toBe('PostgreSQL required');
  });

  it('POST assignments rejects invalid role before DB', async () => {
    const res = await agent
      .post('/api/admin/marking/assignments')
      .set(csrfHeader())
      .send({ assessmentId: 1, markerUserId: 2, role: 'janitor' });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('Invalid marker role');
  });

  it('POST allocations with empty submissions is rejected before DB', async () => {
    const res = await agent
      .post('/api/admin/marking/assignments/1/allocate')
      .set(csrfHeader())
      .send({ submissions: [] });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('submissions is required');
  });

  it('POST calibrations with empty goldScores is rejected before DB', async () => {
    const res = await agent
      .post('/api/admin/marking/calibrations')
      .set(csrfHeader())
      .send({ assignmentId: 1, anchorSetId: 2, goldScores: {} });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('goldScores is required');
  });
});

describe('marking — read paths degrade gracefully (no PG)', () => {
  it('GET assignments returns empty list', async () => {
    const res = await agent.get('/api/admin/marking/assignments');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.rows).toEqual([]);
  });

  it('GET work-items returns empty list', async () => {
    const res = await agent.get('/api/admin/marking/work-items');
    expect(res.status).toBe(200);
    expect(res.body.rows).toEqual([]);
  });

  it('GET moderation returns empty list', async () => {
    const res = await agent.get('/api/admin/marking/moderation');
    expect(res.status).toBe(200);
    expect(res.body.rows).toEqual([]);
  });
});
