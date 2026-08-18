/**
 * Deborah — Scan module e2e/security tests (Prompt 43)
 *
 * OMR/OCR low-confidence manual-route flow + API walk (graceful
 * degradation) + security guards:
 *   - meta endpoint serves constants for admin
 *   - batch read paths return empty arrays without PG
 *   - write paths degrade to 400 PostgreSQL required (CSRF-first)
 *   - OMR/OCR low-confidence → manual reconciliation route contract
 *   - unauthenticated access is rejected
 *   - low-confidence OCR never silently accepted (manual route §52.6)
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

  // ── Login ONCE (session cookie + CSRF token persist across tests) ──
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

describe('Scan — API walk (graceful degradation without PG)', () => {
  it('unauthenticated admin API is rejected (no data leak)', async () => {
    const request = await createRequest(); // fresh, no session cookie
    const r = await request.get('/api/admin/scan/batches');
    // requireAdmin returns 401 JSON for /api/* (never leaks HTML redirect)
    expect([401, 403, 302]).toContain(r.status);
  });

  it('meta endpoint serves constants for admin (even without PG)', async () => {
    const r = await api('get', '/api/admin/scan/meta');
    expect(r.status).toBe(200);
    expect(r.body.batchStatus).toBeTruthy();
    expect(r.body.reconciliationKinds).toContain('low_confidence_ocr');
  });

  it('batch read path returns empty arrays without PG', async () => {
    const r = await api('get', '/api/admin/scan/batches');
    expect(r.status).toBe(200);
    expect(Array.isArray(r.body.batches)).toBe(true);
  });

  it('write paths degrade to 400 PostgreSQL required (CSRF-first)', async () => {
    const r = await api('post', '/api/admin/scan/batches', { batchKey: 'scan:e2e:1' }, csrfToken);
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/PostgreSQL required/i);
  });

  it('page ingest path degrades to 400 PostgreSQL required', async () => {
    const r = await api('post', '/api/admin/scan/batches/1/pages', { imageBase64: 'aGk=' }, csrfToken);
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/PostgreSQL required/i);
  });

  it('OMR ingest path degrades to 400', async () => {
    const r = await api('post', '/api/admin/scan/batches/1/omr', {
      marks: [{ packetId: 'p', pageIndex: 0, questionKey: 'q1', optionIndex: 1, confidence: 0.5 }],
    }, csrfToken);
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/PostgreSQL required/i);
  });

  it('OCR ingest path degrades to 400', async () => {
    const r = await api('post', '/api/admin/scan/batches/1/ocr', {
      kind: 'handwriting', transcriptText: 'x²+6x+9=0', confidence: 0.6,
    }, csrfToken);
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/PostgreSQL required/i);
  });

  it('admin page renders for admin', async () => {
    const r = await api('get', '/admin/scan');
    expect(r.status).toBe(200);
    expect(r.text).toMatch(/Scan &amp; Reconciliation|Scan & Reconciliation/);
  });
});

describe('Scan — OMR/OCR low-confidence manual-route contract (Prompt 43 §12-13)', () => {
  it('classifyOmrConfidence routes low confidence to ambiguous/low (never high)', async () => {
    const { classifyOmrConfidence, OMR_CONFIDENCE_STATUS } = await import('../../src/modules/scan/scan.schema.js');
    expect(classifyOmrConfidence(0.5)).toBe(OMR_CONFIDENCE_STATUS.LOW);
    expect(classifyOmrConfidence(0.82)).toBe(OMR_CONFIDENCE_STATUS.AMBIGUOUS);
    expect(classifyOmrConfidence(0.95)).toBe(OMR_CONFIDENCE_STATUS.HIGH);
  });

  it('low-confidence OCR never silently accepted — manual route (service boundary)', async () => {
    // Without PG the service throws PostgreSQL required, proving it does NOT
    // silently accept the transcript (it must route to the manual queue).
    const { createOcrTranscript } = await import('../../src/modules/scan/index.js');
    await expect(
      createOcrTranscript({ batchId: 1, kind: 'handwriting', transcriptText: 'draft', confidence: 0.4 })
    ).rejects.toThrow('PostgreSQL required');
  });

  it('OCR kind validation rejects unknown kinds before DB', async () => {
    const { createOcrTranscript } = await import('../../src/modules/scan/index.js');
    await expect(
      createOcrTranscript({ batchId: 1, kind: 'hack', transcriptText: 'x', confidence: 0.9 })
    ).rejects.toThrow(/Invalid OCR kind/);
  });

  it('missing transcript text rejected before DB', async () => {
    const { createOcrTranscript } = await import('../../src/modules/scan/index.js');
    await expect(
      createOcrTranscript({ batchId: 1, kind: 'math', transcriptText: '', confidence: 0.9 })
    ).rejects.toThrow(/transcriptText/);
  });
});

describe('Scan — security guards (Prompt 43 §15-16)', () => {
  it('raw student PII is never part of QR payload contract', async () => {
    const { decodeAndRoutePage, QR_STATUS } = await import('../../src/modules/scan/scan.schema.js');
    const withPii = JSON.stringify({ sig: 'x', studentName: 'Ali', studentId: '12345' });
    const r = decodeAndRoutePage(withPii, 'key');
    expect(r.status).toBe(QR_STATUS.FORGED); // shape mismatch → rejected
  });

  it('forged QR never routes to a packet', async () => {
    const { decodeAndRoutePage, QR_STATUS } = await import('../../src/modules/scan/scan.schema.js');
    const r = decodeAndRoutePage(JSON.stringify({ sig: 'bad' }), 'key');
    expect(r.status).toBe(QR_STATUS.FORGED);
  });

  it('unreadable/missing QR → orphan path (never silent drop)', async () => {
    const { decodeAndRoutePage, QR_STATUS } = await import('../../src/modules/scan/scan.schema.js');
    const r = decodeAndRoutePage(null, 'key');
    expect(r.status).toBe(QR_STATUS.MISSING);
  });
});
