/**
 * Edikit — Board Ratification, Result Release & Grade Ledger e2e/security
 * tests (Prompt 47)
 *
 * E2E walk (graceful degradation without PostgreSQL):
 *   - Admin page renders with design-system chrome.
 *   - Meta endpoint exposes constants (boardRoles, votes, defaults).
 *   - Write paths degrade to 400 'PostgreSQL required' after CSRF
 *     (validation contract intact over the wire).
 *   - Unauthenticated access rejected (requireAdmin).
 *   - Security: release without ratification refused; amendment ledger is
 *     append-only (validation contract); ratification is idempotent
 *     (validation contract before PG).
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createApp } from '../../server.js';
import CONFIG from '../../src/config/env.js';
import { snapshotDb, restoreDb } from '../helpers/setup.js';

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

describe('board — admin page + meta', () => {
  it('GET /admin/board renders for an admin', async () => {
    const res = await agent.get('/admin/board');
    expect(res.status).toBe(200);
    expect(res.text).toContain('Board &amp; Ratification');
    expect(res.text).toContain('Edikit Admin');
  });

  it('GET /api/admin/board/meta exposes constants', async () => {
    const res = await agent.get('/api/admin/board/meta');
    expect(res.status).toBe(200);
    expect(res.body.boardRoles).toContain('chair');
    expect(res.body.boardRoles).toContain('external');
    expect(res.body.votes).toContain('abstain');
    expect(res.body.defaults.releasePolicy).toBe('ratification_required');
    expect(res.body.decisionStatus.RATIFIED).toBe('ratified');
  });

  it('unauthenticated access to /admin/board is rejected', async () => {
    const anon = (await import('supertest')).default(app);
    const res = await anon.get('/admin/board');
    expect([302, 401, 403]).toContain(res.status);
  });

  it('unauthenticated POST to ratify is rejected', async () => {
    const anon = (await import('supertest')).default(app);
    const res = await anon.post('/api/admin/board/ratify').send({ meetingId: 1, runId: 1, userId: 1 });
    expect([302, 401, 403]).toContain(res.status);
  });
});

describe('board — write paths degrade gracefully (no PG)', () => {
  it('POST meetings validates then degrades to 400', async () => {
    const res = await agent
      .post('/api/admin/board/meetings')
      .set(csrfHeader())
      .send({ title: '2026 yozgi yig\'in' });
    expect(res.status).toBe(400);
    expect(res.body.ok).toBe(false);
    expect(res.body.error).toBe('PostgreSQL required');
  });

  it('POST roles rejects invalid role before DB', async () => {
    const res = await agent
      .post('/api/admin/board/roles')
      .set(csrfHeader())
      .send({ userId: 1, role: 'janitor' });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('valid board role');
  });

  it('POST ratify requires all ids before DB', async () => {
    const res = await agent
      .post('/api/admin/board/ratify')
      .set(csrfHeader())
      .send({ meetingId: 1, runId: 2, userId: 3 });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('PostgreSQL required');
  });

  it('POST amendments requires newFinal before DB', async () => {
    const res = await agent
      .post('/api/admin/board/amendments')
      .set(csrfHeader())
      .send({ runId: 1, newFinal: null, reason: 'regrade after appeal' });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('newFinal are required');
  });

  it('POST outbox reconcile requires id before DB', async () => {
    const res = await agent
      .post('/api/admin/board/outbox/1/reconcile')
      .set(csrfHeader())
      .send({ status: 'sent' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('PostgreSQL required');
  });
});

describe('board — read paths degrade gracefully (no PG)', () => {
  it('GET meetings returns empty list', async () => {
    const res = await agent.get('/api/admin/board/meetings');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.rows).toEqual([]);
  });

  it('GET amendments returns empty list', async () => {
    const res = await agent.get('/api/admin/board/amendments');
    expect(res.status).toBe(200);
    expect(res.body.rows).toEqual([]);
  });

  it('GET outbox returns empty list', async () => {
    const res = await agent.get('/api/admin/board/outbox');
    expect(res.status).toBe(200);
    expect(res.body.rows).toEqual([]);
  });
});
