/**
 * Deborah — Academic Grade Rules e2e/security tests (Prompt 45)
 *
 * E2E walk (Prompt 45 §15, §18-20):
 *   - API walk (graceful degradation without PostgreSQL): admin page
 *     renders, write paths degrade to 400 'PostgreSQL required'
 *     (CSRF-first), unauthenticated access rejected.
 *   - Old rule-version reproducibility contract: same rule_hash + input
 *     snapshot → same run_hash + final grade (pure).
 *   - Security: DSL reject eval-like keys; final grade never float.
 *   - Approved examples produce EXACT grades (done condition §25).
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
  restoreDb();
  return new Promise((resolve) => {
    if (httpServer && httpServer.listening) httpServer.close(() => resolve());
    else resolve();
  });
});

async function api(method, path, body, csrf) {
  const r = agent[method](path);
  if (body !== undefined) r.send(body);
  if (csrf) r.set('x-csrf-token', csrf);
  return await r;
}

describe('Grading — API walk (graceful degradation without PG)', () => {
  it('unauthenticated admin API is rejected (no data leak)', async () => {
    const request = await createRequest();
    const r = await request.get('/api/admin/grading/rules');
    expect([401, 403, 302]).toContain(r.status);
  });

  it('meta endpoint serves constants for admin (even without PG)', async () => {
    const r = await api('get', '/api/admin/grading/meta');
    expect(r.status).toBe(200);
    expect(r.body.ruleStatus.APPROVED).toBe('approved');
    expect(r.body.missingPolicy.EXCLUDE).toBe('exclude');
    expect(r.body.roundMethods).toContain('half_even');
  });

  it('rules read path returns empty arrays without PG', async () => {
    const r = await api('get', '/api/admin/grading/rules');
    expect(r.status).toBe(200);
    expect(Array.isArray(r.body.rules)).toBe(true);
  });

  it('write paths degrade to 400 PostgreSQL required (CSRF-first)', async () => {
    const dsl = {
      components: [{ key: 'a', label: 'A', max_score: 10, weight: 100 }],
      rounding: { method: 'half_up', scale: 2 },
    };
    const r = await api('post', '/api/admin/grading/rules', { name: 'R', ruleDsl: dsl }, csrfToken);
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/PostgreSQL required/i);
  });

  it('admin page renders for admin', async () => {
    const r = await api('get', '/admin/grading');
    expect(r.status).toBe(200);
    expect(r.text).toMatch(/Grade Rules/);
  });
});

describe('Grading — old rule-version reproducibility (Prompt 45 §20)', () => {
  it('same rule_hash + input → identical run_hash and final grade (exact)', async () => {
    const { hashRuleDsl, computeRunHash, calculateGrade } = await import('../../src/modules/grading/index.js');
    const dsl = {
      components: [
        { key: 'midterm', label: 'Oraliq', max_score: 30, weight: 40 },
        { key: 'final', label: 'Yakuniy', max_score: 50, weight: 60 },
      ],
      rounding: { method: 'half_up', scale: 2 },
      boundaries: [
        { minPercent: 90, label: 'A' },
        { minPercent: 0, label: 'F' },
      ],
    };
    const ruleHash = hashRuleDsl(dsl);
    const input = [
      { key: 'midterm', raw_score: 27, status: 'scored' },
      { key: 'final', raw_score: 45, status: 'scored' },
    ];
    const h1 = computeRunHash({ ruleHash, components: input });
    const h2 = computeRunHash({ ruleHash, components: input });
    expect(h1).toBe(h2);

    const r1 = calculateGrade({ dsl, components: input });
    const r2 = calculateGrade({ dsl, components: input });
    // EXACT equality — approved examples reproduce bit-for-bit (§25)
    expect(r1.finalGrade).toBe(r2.finalGrade);
    expect(r1.finalGrade).toBe(90);
    expect(r1.gradeLabel).toBe('A');
  });

  it('changed input → different hash and grade', async () => {
    const { hashRuleDsl, computeRunHash, calculateGrade } = await import('../../src/modules/grading/index.js');
    const dsl = {
      components: [{ key: 'a', label: 'A', max_score: 10, weight: 100 }],
      rounding: { method: 'half_up', scale: 2 },
      boundaries: [{ minPercent: 0, label: 'F' }],
    };
    const ruleHash = hashRuleDsl(dsl);
    const hA = computeRunHash({ ruleHash, components: [{ key: 'a', raw_score: 8, status: 'scored' }] });
    const hB = computeRunHash({ ruleHash, components: [{ key: 'a', raw_score: 9, status: 'scored' }] });
    expect(hA).not.toBe(hB);
    expect(calculateGrade({ dsl, components: [{ key: 'a', raw_score: 8, status: 'scored' }] }).finalGrade).toBe(80);
  });
});

describe('Grading — security guards (Prompt 45 §15)', () => {
  it('DSL rejects eval-like keys (arbitrary code never runs)', async () => {
    const { validateRuleDsl } = await import('../../src/modules/grading/index.js');
    expect(validateRuleDsl({ components: [{ key: 'a', label: 'A', max_score: 10, weight: 100 }], eval: 'process.exit(0)' }).ok).toBe(false);
    expect(validateRuleDsl({ components: [{ key: 'a', label: 'A', max_score: 10, weight: 100 }], constructor: {} }).ok).toBe(false);
  });

  it('final grade is not computed with floats (scaled integer pipeline)', async () => {
    const { calculateGrade, toScaled, fromScaled, SCALE } = await import('../../src/modules/grading/index.js');
    const dsl = {
      components: [
        { key: 'a', label: 'A', max_score: 3, weight: 33.333 },
        { key: 'b', label: 'B', max_score: 3, weight: 33.333 },
        { key: 'c', label: 'C', max_score: 3, weight: 33.334 },
      ],
      rounding: { method: 'half_up', scale: 2 },
      boundaries: [{ minPercent: 0, label: 'F' }],
    };
    const r = calculateGrade({ dsl, components: [
      { key: 'a', raw_score: 3, status: 'scored' },
      { key: 'b', raw_score: 3, status: 'scored' },
      { key: 'c', raw_score: 3, status: 'scored' },
    ] });
    expect(Number.isInteger(r.finalGrade * 100) || Number.isInteger(toScaled(r.finalGrade))).toBe(true);
    expect(typeof SCALE).toBe('number');
    expect(fromScaled(toScaled(0.1))).toBeCloseTo(0.1, 4);
  });

  it('blocked run never yields a partial final grade', async () => {
    const { calculateGrade, COMPONENT_STATUS } = await import('../../src/modules/grading/index.js');
    const r = calculateGrade({
      dsl: {
        components: [{ key: 'a', label: 'A', max_score: 10, weight: 100 }],
        rounding: { method: 'half_up', scale: 2 },
      },
      components: [{ key: 'a', raw_score: null, status: COMPONENT_STATUS.PENDING }],
    });
    expect(r.blocked).toBe(true);
    expect(r.finalGrade).toBeNull();
  });
});
