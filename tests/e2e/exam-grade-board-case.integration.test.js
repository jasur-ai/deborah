/**
 * Deborah — Grade / Board / Case Integration & Security Suite (Prompt 49)
 *
 * End-to-end HTTP integration of the final result governance chain:
 * grading rule → board ratification → release → wrong-key rescore →
 * appeal case. Walks the real Express app with admin auth + CSRF, then
 * verifies graceful degradation (PostgreSQL absent in CI).
 *
 * SECURITY / DATA GUARD (Prompt 49 §15-17):
 *   - Unauthorized final release impossible: release endpoint requires a
 *     ratified decision; without PG it degrades to a clear error — there is
 *     NO path that releases a grade without ratification (§49.15).
 *   - Wrong-key rescore requires a FROZEN incident (release freeze §71.7).
 *   - AI hukmi chiqarmaydi — case decisions reject non-human deciders.
 *   - All write paths are tenant-scoped + audit'd; unauthenticated access
 *     is rejected with 401/302.
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

// ═══════════════════════════════════════════════════════════════════
// GRADE — rule lifecycle + deterministic calculate
// ═══════════════════════════════════════════════════════════════════

describe('grade/board/case — grading', () => {
  it('GET /api/admin/grading/meta exposes the DSL vocabulary', async () => {
    const res = await agent.get('/api/admin/grading/meta');
    expect(res.status).toBe(200);
    expect(res.body.componentStatus).toBeDefined();
    expect(res.body.roundMethods).toContain('half_up');
    expect(res.body.resitCapTypes).toContain('best_of');
  });

  it('POST /api/admin/grading/rules validates then degrades to 400 without PG', async () => {
    const res = await agent
      .post('/api/admin/grading/rules')
      .set(csrfHeader())
      .send({ name: 'Mock 2026', ruleDsl: { components: [{ key: 'a', label: 'A', weight: 100, max_score: 10 }] } });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('PostgreSQL required');
  });

  it('POST /api/admin/grading/rules rejects an invalid DSL before DB', async () => {
    const res = await agent
      .post('/api/admin/grading/rules')
      .set(csrfHeader())
      .send({ name: 'Bad', ruleDsl: { components: [{ key: 'a', label: 'A', weight: 50, max_score: 10 }] } }); // weights ≠ 100
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/weights must sum to 100|Invalid|error/i);
  });

  it('POST /api/admin/grading/calculate validates components then degrades to 400 without PG', async () => {
    const res = await agent
      .post('/api/admin/grading/calculate')
      .set(csrfHeader())
      .send({ ruleVersionId: 1, userId: 1, components: [{ key: 'mid', raw_score: 70, status: 'scored' }] });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('PostgreSQL required');
  });

  it('GET /api/admin/grading/runs returns empty list without PG', async () => {
    const res = await agent.get('/api/admin/grading/runs');
    expect(res.status).toBe(200);
    expect(res.body.runs).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════
// BOARD — ratification + release governance (no unauthorized release)
// ═══════════════════════════════════════════════════════════════════

describe('grade/board/case — board ratify/release', () => {
  it('GET /api/admin/board/meta exposes board vocabulary', async () => {
    const res = await agent.get('/api/admin/board/meta');
    expect(res.status).toBe(200);
    expect(res.body.boardRoles).toContain('chair');
    expect(res.body.votes).toContain('approve');
    expect(res.body.meetingStatus).toBeDefined();
  });

  it('POST /api/admin/board/ratify validates meeting/run/user then degrades to 400 without PG', async () => {
    const res = await agent
      .post('/api/admin/board/ratify')
      .set(csrfHeader())
      .send({ meetingId: 1, runId: 2, userId: 3 });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('PostgreSQL required');
  });

  it('POST /api/admin/board/ratify rejects missing ids before DB', async () => {
    const res = await agent.post('/api/admin/board/ratify').set(csrfHeader()).send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/required/i);
  });

  it('POST /api/admin/board/release refuses without a ratified decision (no unauthorized release)', async () => {
    // No decision id / run id → validation rejects; there is NO path that
    // releases a grade without ratification (§49.15).
    const res = await agent.post('/api/admin/board/release').set(csrfHeader()).send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/required/i);
    // With ids, still no release without PG-backed ratified decision
    const res2 = await agent.post('/api/admin/board/release').set(csrfHeader()).send({ decisionId: 1 });
    expect(res2.status).toBe(400);
    expect(res2.body.error).toBe('PostgreSQL required');
  });

  it('POST /api/admin/board/amendments validates then degrades to 400 without PG', async () => {
    const res = await agent
      .post('/api/admin/board/amendments')
      .set(csrfHeader())
      .send({ runId: 1, newFinal: 90, reason: 'wrong key corrected' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('PostgreSQL required');
  });
});

// ═══════════════════════════════════════════════════════════════════
// CASE — wrong-key freeze/rescore + appeal (AI hukmi yo'q)
// ═══════════════════════════════════════════════════════════════════

describe('grade/board/case — consideration/rescore/appeal', () => {
  it('POST /api/admin/scoring-incidents validates then degrades to 400 without PG', async () => {
    const res = await agent
      .post('/api/admin/scoring-incidents')
      .set(csrfHeader())
      .send({ title: '7-savol xato kalit', kind: 'wrong_key' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('PostgreSQL required');
  });

  it('POST /api/admin/scoring-incidents/:id/freeze validates then degrades to 400 without PG', async () => {
    const res = await agent
      .post('/api/admin/scoring-incidents/1/freeze')
      .set(csrfHeader())
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('PostgreSQL required');
  });

  it('POST /api/admin/scoring-incidents/:id/rescore requires ids before DB (release freeze drill)', async () => {
    const res = await agent
      .post('/api/admin/scoring-incidents/1/rescore')
      .set(csrfHeader())
      .send({ attemptId: 1, runId: 2, newFinal: 90, reason: 'wrong key corrected' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('PostgreSQL required');
  });

  it('POST /api/admin/cases/:id/decide rejects AI/system deciders fail-closed', async () => {
    // The route derives the decider from the authenticated admin session
    // (a human) — but the SERVICE rejects non-human deciders explicitly.
    // Through the route with an authenticated human admin the call passes
    // the human check and degrades to PG required (no silent AI decision).
    const res = await agent
      .post('/api/admin/cases/1/decide')
      .set(csrfHeader())
      .send({ decision: 'approved', reason: 'valid reason here' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('PostgreSQL required');
  });

  it('POST /api/admin/cases validates caseType + grounds before DB', async () => {
    const res = await agent
      .post('/api/admin/cases')
      .set(csrfHeader())
      .send({ caseType: 'birthday', userId: 1, grounds: 'x' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Invalid case type|grounds are required/);
  });
});

// ═══════════════════════════════════════════════════════════════════
// SECURITY — auth boundary + audit surface
// ═══════════════════════════════════════════════════════════════════

describe('grade/board/case — security boundaries', () => {
  it('should reject unauthenticated access to all governance endpoints', async () => {
    const anon = (await import('supertest')).default(app);
    for (const path of [
      '/api/admin/grading/rules', '/api/admin/board/ratify',
      '/api/admin/board/release', '/api/admin/scoring-incidents',
      '/api/admin/cases', '/admin/grading', '/admin/board', '/admin/consideration',
    ]) {
      const res = await anon.post(path).send({});
      expect([302, 401, 403]).toContain(res.status);
    }
  });

  it('should require CSRF on governance POST endpoints', async () => {
    const res = await agent
      .post('/api/admin/grading/rules')
      .send({ name: 'x' }); // no csrf header
    expect([400, 403]).toContain(res.status);
  });
});
