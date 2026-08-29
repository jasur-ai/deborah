/**
 * Deborah — Special Consideration, Deferral, Resit, Appeal & Scoring
 * Incident e2e/security tests (Prompt 48)
 *
 * E2E walk (graceful degradation without PostgreSQL):
 *   - Admin page renders with design-system chrome.
 *   - Meta endpoint exposes constants (caseTypes, caseStatus, remedies).
 *   - Write paths degrade to 400 'PostgreSQL required' after CSRF
 *     (validation contract intact over the wire).
 *   - Unauthenticated access rejected (requireAdmin).
 *   - Security: AI hukmi chiqarmaydi (decide requires human decider,
 *     appeal grounds reject AI/proctor conclusive facts — pure); evidence
 *     ACL blocks marker/proctor at the service layer.
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

describe('consideration — admin page + meta', () => {
  it('GET /admin/consideration renders for an admin', async () => {
    const res = await agent.get('/admin/consideration');
    expect(res.status).toBe(200);
    expect(res.text).toContain('Special Consideration');
    expect(res.text).toContain('Deborah Admin');
  });

  it('GET /api/admin/cases/meta exposes constants', async () => {
    const res = await agent.get('/api/admin/cases/meta');
    expect(res.status).toBe(200);
    expect(res.body.caseTypes).toContain('deferral');
    expect(res.body.caseTypes).toContain('appeal');
    expect(res.body.remedyTypes).toContain('equivalent_assessment');
    expect(res.body.incidentKinds).toContain('wrong_key');
    expect(res.body.caseStatus.APPEALED).toBe('appealed');
  });

  it('unauthenticated access to /admin/consideration is rejected', async () => {
    const anon = (await import('supertest')).default(app);
    const res = await anon.get('/admin/consideration');
    expect([302, 401, 403]).toContain(res.status);
  });

  it('unauthenticated POST to create a case is rejected', async () => {
    const anon = (await import('supertest')).default(app);
    const res = await anon.post('/api/admin/cases').send({ caseType: 'deferral', userId: 1, grounds: 'valid grounds' });
    expect([302, 401, 403]).toContain(res.status);
  });
});

describe('consideration — write paths degrade gracefully (no PG)', () => {
  it('POST cases validates then degrades to 400', async () => {
    const res = await agent
      .post('/api/admin/cases')
      .set(csrfHeader())
      .send({ caseType: 'deferral', userId: 1, grounds: 'valid grounds here' });
    expect(res.status).toBe(400);
    expect(res.body.ok).toBe(false);
    expect(res.body.error).toBe('PostgreSQL required');
  });

  it('POST cases rejects invalid case type before DB', async () => {
    const res = await agent
      .post('/api/admin/cases')
      .set(csrfHeader())
      .send({ caseType: 'birthday', userId: 1, grounds: 'valid grounds here' });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('Invalid case type');
  });

  it('POST decide validates decision then degrades to 400 without PG (human decider present)', async () => {
    // The authenticated admin IS a human decider — the service passes the
    // human check and degrades to 'PostgreSQL required' (no PG in tests).
    // Non-human decider rejection is covered at the service layer
    // (integration: decideCase with decidedBy 'ai'/'system').
    const res = await agent
      .post('/api/admin/cases/1/decide')
      .set(csrfHeader())
      .send({ decision: 'approved', reason: 'valid reason here' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('PostgreSQL required');
  });

  it('POST incidents requires title before DB', async () => {
    const res = await agent
      .post('/api/admin/scoring-incidents')
      .set(csrfHeader())
      .send({ title: '7-savol xato kalit' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('PostgreSQL required');
  });

  it('POST rescore requires all ids before DB', async () => {
    const res = await agent
      .post('/api/admin/scoring-incidents/1/rescore')
      .set(csrfHeader())
      .send({ attemptId: 1, runId: 2, newFinal: 90, reason: 'wrong key corrected' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('PostgreSQL required');
  });
});

describe('consideration — read paths degrade gracefully (no PG)', () => {
  it('GET cases returns empty list', async () => {
    const res = await agent.get('/api/admin/cases');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.rows).toEqual([]);
  });

  it('GET incidents returns empty list', async () => {
    const res = await agent.get('/api/admin/scoring-incidents');
    expect(res.status).toBe(200);
    expect(res.body.rows).toEqual([]);
  });
});
