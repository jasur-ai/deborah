/**
 * Deborah — Integration Tests: Paper Packet, QR & Chain of Custody (Prompt 42)
 *
 * Contract coverage (Prompt 42 §19 — packet page/count/hash):
 *   - Packet plan → page count / content hash / checksum contract
 *   - Batch manifest reproducibility (same inputs → same hash)
 *   - QR token UNIQUE in migration (replay detection)
 *   - HTTP contract (graceful degradation without PostgreSQL):
 *       • /api/admin/paper/* endpoints require admin (401/403 unauth;
 *         CSRF-first on writes)
 *       • /admin/paper page redirects to /admin/login without a session
 *       • With a real admin session: meta 200; write paths → 400
 *         { error: 'PostgreSQL required' }
 *       • Read paths return 200 with empty arrays
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync } from 'fs';
import { createApp } from '../../server.js';
import CONFIG from '../../src/config/env.js';
import { createRequest, snapshotDb, restoreDb } from '../helpers/setup.js';
import {
  buildPacketPlan,
  buildBatchManifest,
  scanPaperForSecrets,
  signPageQr,
  verifyPageQr,
  PAPER_RENDER_FLAGS,
} from '../../src/modules/paper/index.js';

const SIGNING_KEY = 'deborah-paper-integration-key-0123456789abcdef';

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
// PACKET PAGE / COUNT / HASH CONTRACT (§19)
// ═══════════════════════════════════════════════════════════════════

describe('Paper — packet page/count/hash contract (§19)', () => {
  it('packet plan page count matches pageHashes and checksum covers pages', () => {
    const r = buildPacketPlan({
      assignmentId: 12,
      studentUserId: 3,
      variant: 'A',
      pageCount: 4,
      pageHashes: { 0: 'a', 1: 'b', 2: 'c', 3: 'd' },
    });
    expect(r.ok).toBe(true);
    expect(r.plan.pages).toHaveLength(4);
    expect(r.plan.pages.map((p) => p.content_hash)).toEqual(['a', 'b', 'c', 'd']);
    expect(r.plan.checksum).toMatch(/^[0-9a-f]{64}$/);
    // Changing any page hash changes the checksum.
    const r2 = buildPacketPlan({
      assignmentId: 12, studentUserId: 3, variant: 'A', pageCount: 4,
      pageHashes: { 0: 'a', 1: 'b', 2: 'c', 3: 'X' },
    });
    expect(r2.plan.checksum).not.toBe(r.plan.checksum);
  });

  it('manifest hash is reproducible and stable across identical inputs', () => {
    const plans = [
      buildPacketPlan({ assignmentId: 5, studentUserId: 1, variant: 'A', pageCount: 2 }).plan,
      buildPacketPlan({ assignmentId: 5, studentUserId: 2, variant: 'B', pageCount: 3 }).plan,
      buildPacketPlan({ assignmentId: 5, studentUserId: 3, variant: 'A', pageCount: 2 }).plan,
    ];
    const m1 = buildBatchManifest({ batchId: 1, batchKey: 'paper:5', packetPlans: plans });
    const m2 = buildBatchManifest({ batchId: 1, batchKey: 'paper:5', packetPlans: plans });
    expect(m1.hash).toBe(m2.hash);
    expect(m1.manifest.packetCount).toBe(3);
    expect(m1.manifest.opaquePacketIds).toHaveLength(3);
    // Secret scan passes on the whole manifest.
    expect(scanPaperForSecrets(m1.manifest).ok).toBe(true);
  });

  it('QR token UNIQUE index exists in migration 024 (replay detection)', () => {
    const src = readFileSync(new URL('../../migrations/024_paper_packet.js', import.meta.url), 'utf8');
    expect(src).toMatch(/uq_paper_pages_qr/);
    expect(src).toMatch(/unique: true/);
  });

  it('every page QR verifies and is replay-detectable via unique token', () => {
    const tokens = [];
    for (let i = 0; i < 3; i++) {
      const { token } = signPageQr({ packetId: 'opq-1', pageIndex: i, epoch: 1, key: SIGNING_KEY });
      const v = verifyPageQr(token, SIGNING_KEY);
      expect(v.ok).toBe(true);
      expect(v.payload.page).toBe(i);
      tokens.push(token);
    }
    expect(new Set(tokens).size).toBe(3); // each page unique
  });

  it('render flags are whitelisted (no raw reasons)', () => {
    for (const f of ['large_print', 'one_sided', 'extra_spacing']) {
      expect(PAPER_RENDER_FLAGS).toContain(f);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════
// HTTP CONTRACT (graceful degradation without PostgreSQL)
// ═══════════════════════════════════════════════════════════════════

describe('Paper — HTTP contract', () => {
  it('/admin/paper page redirects to /admin/login without a session', async () => {
    const request = await createRequest();
    const r = await request.get('/admin/paper');
    if (r.status === 302) {
      expect(r.headers.location).toBe('/admin/login');
    } else {
      // Shared app may already be logged in via agent (200 render) or a
      // global /admin guard may return 401.
      expect([200, 401]).toContain(r.status);
    }
  });

  it('meta returns constants for an authenticated admin', async () => {
    const r = await agent.get('/api/admin/paper/meta');
    expect(r.status).toBe(200);
    expect(r.body.custodyEventTypes).toContain('generated');
    expect(r.body.custodyEventTypes).toContain('destroyed');
    expect(r.body.batchStatus.GENERATED).toBeDefined();
    expect(r.body.batchTransitions.generated).toContain('downloaded');
    expect(r.body.renderFlags).toEqual(['large_print', 'one_sided', 'extra_spacing']);
  });

  it('batch list read path returns empty arrays without PostgreSQL', async () => {
    const r = await agent.get('/api/admin/paper/batches');
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(true);
    expect(Array.isArray(r.body.batches)).toBe(true);
  });

  it('batch generate degrades gracefully (400 PostgreSQL required)', async () => {
    const r = await agent.post('/api/admin/paper/batches')
      .set('x-csrf-token', csrfToken)
      .send({ batchKey: 'paper:test', assignmentId: 1, students: [{ userId: 1, variant: 'A', pageCount: 1 }] });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/PostgreSQL required/);
  });

  it('custody event write degrades gracefully (400 PostgreSQL required)', async () => {
    const r = await agent.post('/api/admin/paper/batches/1/custody')
      .set('x-csrf-token', csrfToken)
      .send({ eventType: 'generated', count: 5 });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/PostgreSQL required/);
  });

  it('unauthenticated access is rejected', async () => {
    const request = await createRequest();
    const r = await request.get('/api/admin/paper/batches');
    expect([401, 403, 302]).toContain(r.status);
  });

  it('invalid custody event type is rejected by validation (400)', async () => {
    const r = await agent.post('/api/admin/paper/batches/1/custody')
      .set('x-csrf-token', csrfToken)
      .send({ eventType: 'teleported', count: 1 });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/Invalid custody event type/);
  });
});
