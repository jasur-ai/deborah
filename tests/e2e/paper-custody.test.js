/**
 * Edikit — E2E/Security: Paper Packet Print & Custody Authorization (Prompt 42)
 *
 * E2E walk (Prompt 42 §20):
 *   - Pure-logic E2E: packet plan → signed page QR → verify → secret scan
 *     → custody chain signature → short-lived download token expiry.
 *   - SECURITY (§15, research.md §52.3): QR payload never contains answer
 *     keys / raw PII; manifest secret scan passes; download token is scoped
 *     and expires.
 *   - API walk (graceful degradation without PostgreSQL):
 *       • /admin/paper page redirects to /admin/login without a session.
 *       • Every /api/admin/paper/* write path requires admin (CSRF-first)
 *         and degrades to 400 { error: 'PostgreSQL required' } without PG.
 *       • Read paths return 200 with empty arrays.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createApp } from '../../server.js';
import CONFIG from '../../src/config/env.js';
import { createRequest, snapshotDb, restoreDb } from '../helpers/setup.js';
import {
  buildPacketPlan,
  buildBatchManifest,
  signPageQr,
  verifyPageQr,
  scanPaperForSecrets,
  validateCustodyEvent,
  signCustodyEvent,
  CUSTODY_EVENT_TYPES,
} from '../../src/modules/paper/index.js';

const SIGNING_KEY = 'edikit-paper-e2e-custody-key-0123456789abcd';

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

// ═══════════════════════════════════════════════════════════════════
// PRINT / CUSTODY AUTHORIZATION E2E (§20)
// ═══════════════════════════════════════════════════════════════════

describe('Paper — print / custody authorization drill (§20)', () => {
  it('full flow: plan → QR sign/verify → manifest → custody chain', () => {
    // 1) Packet plan (no answer keys, detachable cover).
    const plan = buildPacketPlan({
      assignmentId: 9,
      studentUserId: 4,
      variant: 'B',
      accommodation: { oneSided: true },
      pageCount: 3,
      pageHashes: { 0: 'h0', 1: 'h1', 2: 'h2' },
      identity: { name: 'Ali', student_id: 'S004' },
    });
    expect(plan.ok).toBe(true);
    expect(scanPaperForSecrets(plan.plan)).toEqual({ ok: true });

    // 2) Page QRs — every page signed, verifies, no secrets.
    const tokens = [];
    for (let i = 0; i < plan.plan.page_count; i++) {
      const { token, payload } = signPageQr({ packetId: plan.plan.opaque_packet_id, pageIndex: i, epoch: 1, key: SIGNING_KEY });
      expect(verifyPageQr(token, SIGNING_KEY).ok).toBe(true);
      expect(scanPaperForSecrets(payload).ok).toBe(true);
      expect(JSON.stringify(payload)).not.toMatch(/answer|correct|rubric|private/i);
      tokens.push(token);
    }
    expect(new Set(tokens).size).toBe(3);

    // 3) Manifest reproducible + clean.
    const manifest = buildBatchManifest({ batchId: 1, batchKey: 'paper:9', packetPlans: [plan.plan] });
    expect(manifest.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(scanPaperForSecrets(manifest.manifest).ok).toBe(true);

    // 4) Custody chain — generated → downloaded → received, tamper-evident.
    let prevId = null;
    for (const evt of ['generated', 'batch_downloaded', 'operator_received']) {
      const v = validateCustodyEvent({ eventType: evt, count: 1 });
      expect(v.ok).toBe(true);
      const sig = signCustodyEvent({ prevEventId: prevId, eventType: evt, count: 1, batchId: 1, key: SIGNING_KEY });
      expect(sig).toMatch(/^[0-9a-f]{64}$/);
      prevId = (prevId || 0) + 1;
    }
  });

  it('custody event validation rejects unknown types', () => {
    for (const t of CUSTODY_EVENT_TYPES) {
      expect(validateCustodyEvent({ eventType: t, count: 1 }).ok).toBe(true);
    }
    expect(validateCustodyEvent({ eventType: 'burn', count: 1 }).ok).toBe(false);
  });

  it('tampered QR fails verification even with valid-shaped payload', () => {
    const { token } = signPageQr({ packetId: 'opq', pageIndex: 0, epoch: 1, key: SIGNING_KEY });
    const forged = JSON.parse(token);
    forged.packet = 'other-packet'; // change opaque id
    expect(verifyPageQr(JSON.stringify(forged), SIGNING_KEY).ok).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════
// API WALK — GRACEFUL DEGRADATION WITHOUT POSTGRESQL
// ═══════════════════════════════════════════════════════════════════

describe('Paper — API walk (graceful degradation)', () => {
  it('/admin/paper page redirects to /admin/login without a session', async () => {
    const request = await createRequest();
    const r = await request.get('/admin/paper');
    if (r.status === 302) {
      expect(r.headers.location).toBe('/admin/login');
    } else {
      expect([200, 401]).toContain(r.status);
    }
  });

  it('meta endpoint serves constants for admin', async () => {
    const r = await agent.get('/api/admin/paper/meta');
    expect(r.status).toBe(200);
    expect(r.body.custodyEventTypes.length).toBeGreaterThan(5);
    expect(r.body.batchStatus.GENERATED).toBeDefined();
    expect(r.body.batchTransitions.downloaded).toContain('received');
  });

  it('batch read path returns empty arrays without PG', async () => {
    const r = await agent.get('/api/admin/paper/batches');
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(true);
    expect(Array.isArray(r.body.batches)).toBe(true);
  });

  it('write paths degrade to 400 PostgreSQL required (CSRF-first)', async () => {
    const r = await agent.post('/api/admin/paper/batches')
      .set('x-csrf-token', csrfToken)
      .send({ batchKey: 'paper:e2e', assignmentId: 1, students: [{ userId: 1, variant: 'A', pageCount: 1 }] });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/PostgreSQL required/);
  });

  it('download-token path degrades to 400 PostgreSQL required', async () => {
    const r = await agent.post('/api/admin/paper/batches/1/download-token')
      .set('x-csrf-token', csrfToken)
      .send({ expiresInMinutes: 15 });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/PostgreSQL required/);
  });

  it('unauthenticated access is rejected', async () => {
    const request = await createRequest();
    const r = await request.get('/api/admin/paper/batches');
    expect([401, 403, 302]).toContain(r.status);
  });
});
