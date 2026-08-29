/**
 * Deborah — AI Question Generator 50/30/20 (integration/contract, Prompt 53)
 *
 * HTTP integration (real Express app + admin auth + CSRF):
 *   - /api/admin/ai-question-gen/meta — constants exposed.
 *   - Blueprint create validates (unsupported type / missing source pack)
 *     then degrades to 400 without PG.
 *   - Candidate submit: source-missing answer rejection, valid dry-run.
 *   - Review flow degrades to 400 without PG.
 *   - Unauthenticated → 401/302/403; CSRF required.
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

const VALID_CHUNKS = [{ id: 1, quote: 'Fotosintezda CO2 Kalvin sikli bosqichida sarflanadi' }];
const GOOD_CANDIDATE = {
  stem: 'Fotosintezda CO2 qaysi bosqichda sarflanadi?',
  correctAnswer: 'Kalvin sikli',
  options: [
    { key: 'A', text: 'Kalvin sikli', isCorrect: true },
    { key: 'B', text: "Yorug'lik bosqichi", isCorrect: false },
    { key: 'C', text: 'Glikoliz', isCorrect: false },
  ],
  correctKey: 'A',
  questionType: 'single_choice',
  difficulty: 'easy',
  cognitiveLevel: 'remember',
  sourceRefs: [{ chunkId: 1 }],
};

// ═══════════════════════════════════════════════════════════════════
// META & WRITE PATHS (graceful degradation)
// ═══════════════════════════════════════════════════════════════════

describe('ai-question-gen — meta & write paths', () => {
  it('GET /api/admin/ai-question-gen/meta exposes the generator vocabulary', async () => {
    const res = await agent.get('/api/admin/ai-question-gen/meta');
    expect(res.status).toBe(200);
    expect(res.body.candidateStatus.AI_DRAFT).toBe('ai_draft');
    expect(res.body.candidateStatus.APPROVED).toBe('approved');
    expect(res.body.supportedItemTypes).toContain('single_choice');
  });

  it('POST blueprint rejects unsupported item type (validation before PG)', async () => {
    const res = await agent
      .post('/api/admin/ai-question-gen/blueprints')
      .set(csrfHeader())
      .send({ name: 'Bio', targetCount: 20, itemTypes: ['essay'], sourcePackId: 1, model: 'm', modelVersion: 'v1' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/unsupported item type/i);
  });

  it('POST blueprint rejects missing source pack', async () => {
    const res = await agent
      .post('/api/admin/ai-question-gen/blueprints')
      .set(csrfHeader())
      .send({ name: 'Bio', targetCount: 20, itemTypes: ['single_choice'], sourcePackId: null, model: 'm', modelVersion: 'v1' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/source pack is required/i);
  });

  it('POST blueprint valid → degrades to 400 without PG', async () => {
    const res = await agent
      .post('/api/admin/ai-question-gen/blueprints')
      .set(csrfHeader())
      .send({ name: 'DTM Biologiya', targetCount: 20, itemTypes: ['single_choice'], sourcePackId: 1, model: 'claude-sonnet', modelVersion: '2026-07-01' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('PostgreSQL required');
  });

  it('GET blueprints + dashboard return empty without PG', async () => {
    const bps = await agent.get('/api/admin/ai-question-gen/blueprints');
    expect(bps.status).toBe(200);
    expect(bps.body.blueprints).toEqual([]);
    const dash = await agent.get('/api/admin/ai-question-gen/dashboard');
    expect(dash.body.dryRun).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════
// CANDIDATE SUBMIT (dry-run pipeline)
// ═══════════════════════════════════════════════════════════════════

describe('ai-question-gen — candidate submit (Prompt 53 §19)', () => {
  it('POST candidate source-missing → rejected (validator fail)', async () => {
    const res = await agent
      .post('/api/admin/ai-question-gen/candidates')
      .set(csrfHeader())
      .send({
        jobId: 1,
        approvedChunks: VALID_CHUNKS,
        candidate: { ...GOOD_CANDIDATE, correctAnswer: 'Glikoliz' },
      });
    expect(res.status).toBe(201);
    expect(res.body.ok).toBe(true);
    expect(res.body.accepted).toBe(false);
    expect(res.body.validation.summary.failed).toContain('answer_verifier');
  });

  it('POST candidate valid → accepted dry-run with all validators', async () => {
    const res = await agent
      .post('/api/admin/ai-question-gen/candidates')
      .set(csrfHeader())
      .send({ jobId: 1, approvedChunks: VALID_CHUNKS, candidate: GOOD_CANDIDATE });
    expect(res.status).toBe(201);
    expect(res.body.ok).toBe(true);
    expect(res.body.accepted).toBe(true);
    expect(res.body.dryRun).toBe(true);
    expect(res.body.validation.validations).toHaveLength(7);
    expect(res.body.validation.summary.allOk).toBe(true);
  });

  it('POST candidate requires stem', async () => {
    const res = await agent.post('/api/admin/ai-question-gen/candidates').set(csrfHeader()).send({ jobId: 1, candidate: {} });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/candidate\.stem is required/i);
  });

  it('POST review degrades to 400 without PG', async () => {
    const res = await agent
      .post('/api/admin/ai-question-gen/candidates/1/review')
      .set(csrfHeader())
      .send({ decision: 'approve' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('PostgreSQL required');
  });

  it('POST review rejects invalid decision before PG', async () => {
    const res = await agent
      .post('/api/admin/ai-question-gen/candidates/1/review')
      .set(csrfHeader())
      .send({ decision: 'explode' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/invalid decision/i);
  });
});

// ═══════════════════════════════════════════════════════════════════
// SECURITY BOUNDARIES
// ═══════════════════════════════════════════════════════════════════

describe('ai-question-gen — security boundaries', () => {
  it('should reject unauthenticated access to generator endpoints', async () => {
    const anon = (await import('supertest')).default(app);
    const checks = [
      ['get', '/api/admin/ai-question-gen/meta'],
      ['get', '/api/admin/ai-question-gen/blueprints'],
      ['post', '/api/admin/ai-question-gen/blueprints'],
      ['post', '/api/admin/ai-question-gen/candidates'],
      ['post', '/api/admin/ai-question-gen/candidates/1/review'],
      ['get', '/admin/ai-question-gen'],
    ];
    for (const [method, path] of checks) {
      const res = await anon[method](path).send({});
      expect([302, 401, 403]).toContain(res.status);
    }
  });

  it('should require CSRF on write endpoints', async () => {
    const res = await agent.post('/api/admin/ai-question-gen/blueprints').send({ name: 'x' });
    expect([400, 403]).toContain(res.status);
  });
});
