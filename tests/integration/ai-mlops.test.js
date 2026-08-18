/**
 * Deborah — AI Evaluation, MLOps & Rollback (integration/contract, Prompt 52)
 *
 * HTTP integration (real Express app + admin auth + CSRF):
 *   - /api/admin/ai-mlops/meta — constants exposed.
 *   - Model register validates then degrades to 400 without PG.
 *   - Dataset create validates holdout (golden never non-holdout) then degrades.
 *   - Evaluation run: metrics + gate decision (dry-run without PG).
 *   - Model change regression gate: qwk threshold met → approved.
 *   - Rollback kill switch degrades to 400 without PG; missing model → 404.
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

// QWK ≈ 0.96 (1 off-by-one), MAE = 0.2, ECE ≈ 0.094 (≤0.12), override 1/5 = 0.2 (≤0.2)
const VALID_ITEMS = [
  { ai: 4, gold: 4, subgroup: 'uz', confidence: 0.95 },
  { ai: 3, gold: 3, subgroup: 'uz', confidence: 0.9 },
  { ai: 2, gold: 2, subgroup: 'ru', confidence: 0.88 },
  { ai: 1, gold: 1, subgroup: 'en', confidence: 0.9 },
  { ai: 4, gold: 3, subgroup: 'en', confidence: 0.1 },
];

// ═══════════════════════════════════════════════════════════════════
// META & WRITE PATHS (graceful degradation)
// ═══════════════════════════════════════════════════════════════════

describe('ai-mlops — meta & write paths', () => {
  it('GET /api/admin/ai-mlops/meta exposes the MLOps vocabulary', async () => {
    const res = await agent.get('/api/admin/ai-mlops/meta');
    expect(res.status).toBe(200);
    expect(res.body.modelStatus.ACTIVE).toBe('active');
    expect(res.body.gateStage.SHADOW).toBe('shadow');
    expect(res.body.gateDecision.APPROVED).toBe('approved');
    expect(res.body.rollbackAction.DISABLE).toBe('disable');
  });

  it('POST /api/admin/ai-mlops/models requires name + version (stop condition)', async () => {
    const res = await agent.post('/api/admin/ai-mlops/models').set(csrfHeader()).send({ name: 'x' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/version is required/i);
  });

  it('POST /api/admin/ai-mlops/models validates then degrades to 400 without PG', async () => {
    const res = await agent
      .post('/api/admin/ai-mlops/models')
      .set(csrfHeader())
      .send({ name: 'claude-sonnet', version: '2026-07-01', provider: 'anthropic' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('PostgreSQL required');
  });

  it('POST /api/admin/ai-mlops/datasets rejects golden non-holdout (training guard)', async () => {
    const res = await agent
      .post('/api/admin/ai-mlops/datasets')
      .set(csrfHeader())
      .send({ name: 'Golden Bio', kind: 'golden', version: 'v1', holdout: false });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/holdout/i);
  });

  it('POST /api/admin/ai-mlops/datasets valid golden degrades to 400 without PG', async () => {
    const res = await agent
      .post('/api/admin/ai-mlops/datasets')
      .set(csrfHeader())
      .send({ name: 'Golden Bio', kind: 'golden', version: 'v1', holdout: true });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('PostgreSQL required');
  });

  it('GET /api/admin/ai-mlops/models + dashboard return empty without PG', async () => {
    const models = await agent.get('/api/admin/ai-mlops/models');
    expect(models.status).toBe(200);
    expect(models.body.models).toEqual([]);
    const dash = await agent.get('/api/admin/ai-mlops/dashboard');
    expect(dash.status).toBe(200);
    expect(dash.body.dryRun).toBe(true);
    expect(dash.body.models).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════
// EVALUATION + MODEL CHANGE REGRESSION GATE
// ═══════════════════════════════════════════════════════════════════

describe('ai-mlops — evaluation & regression gate', () => {
  it('POST evaluation computes metrics + gate (dry-run without PG)', async () => {
    const res = await agent
      .post('/api/admin/ai-mlops/evaluations')
      .set(csrfHeader())
      .send({ modelId: 1, datasetId: 1, items: VALID_ITEMS, overrides: 1, stage: 'shadow' });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.dryRun).toBe(true);
    expect(res.body.metrics.pairs).toBe(5);
    expect(res.body.metrics.mae).toBeCloseTo(0.2, 3);
    expect(res.body.gate.decision).toBe('approved');
    expect(res.body.subgroups.length).toBeGreaterThanOrEqual(3);
  });

  it('model change regression: low QWK → gate rejected', async () => {
    const res = await agent
      .post('/api/admin/ai-mlops/evaluations')
      .set(csrfHeader())
      .send({
        modelId: 2,
        datasetId: 1,
        items: [{ ai: 1, gold: 4 }, { ai: 0, gold: 4 }, { ai: 2, gold: 4 }, { ai: 1, gold: 4 }, { ai: 3, gold: 4 }],
        stage: 'shadow',
      });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.gate.decision).toBe('rejected');
    expect(res.body.gate.checks.find((c) => c.name === 'qwk').ok).toBe(false);
  });

  it('POST evaluation requires items', async () => {
    const res = await agent.post('/api/admin/ai-mlops/evaluations').set(csrfHeader()).send({ modelId: 1, datasetId: 1, items: [] });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/items are required/i);
  });

  it('POST rollback kill switch degrades to 400 without PG', async () => {
    const res = await agent
      .post('/api/admin/ai-mlops/rollback')
      .set(csrfHeader())
      .send({ modelId: 1, action: 'disable', reason: 'drift' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('PostgreSQL required');
  });
});

// ═══════════════════════════════════════════════════════════════════
// SECURITY BOUNDARIES
// ═══════════════════════════════════════════════════════════════════

describe('ai-mlops — security boundaries', () => {
  it('should reject unauthenticated access to MLOps endpoints', async () => {
    const anon = (await import('supertest')).default(app);
    const checks = [
      ['get', '/api/admin/ai-mlops/meta'],
      ['get', '/api/admin/ai-mlops/models'],
      ['post', '/api/admin/ai-mlops/models'],
      ['post', '/api/admin/ai-mlops/evaluations'],
      ['post', '/api/admin/ai-mlops/rollback'],
      ['get', '/admin/ai-mlops'],
    ];
    for (const [method, path] of checks) {
      const res = await anon[method](path).send({});
      expect([302, 401, 403]).toContain(res.status);
    }
  });

  it('should require CSRF on write endpoints', async () => {
    const res = await agent.post('/api/admin/ai-mlops/models').send({ name: 'x', version: 'v1' });
    expect([400, 403]).toContain(res.status);
  });
});
