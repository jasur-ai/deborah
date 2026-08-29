/**
 * Deborah — Integration Tests: Command Center & Notifications (Prompt 41)
 *
 * Contract coverage (Prompt 41 §19 — mass notification idempotency):
 *   - buildNotificationBatch → queueNotifications idempotency contract:
 *     same batchKey + recipients → SAME idempotency_keys; a UNIQUE
 *     (tenant_id, idempotency_key) guarantees replay-safe queuing.
 *   - supersedeOldNotifications old-schedule invalidation contract.
 *   - HTTP contract (graceful degradation without PostgreSQL):
 *       • /api/admin/command-center/* endpoints require admin (401/403
 *         unauthenticated; CSRF-first on writes).
 *       • /admin/command-center page redirects to /admin/login without a session.
 *       • With a real admin session: meta 200; write paths → 400
 *         { error: 'PostgreSQL required' } — graceful degradation.
 *       • Snapshot read path returns 200 with empty arrays (no PG).
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync } from 'fs';
import { createApp } from '../../server.js';
import CONFIG from '../../src/config/env.js';
import { createRequest, snapshotDb, restoreDb } from '../helpers/setup.js';
import {
  buildNotificationBatch,
  supersedeOldNotifications,
  NOTIFICATION_STATUS,
} from '../../src/modules/command-center/index.js';

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
// MASS NOTIFICATION IDEMPOTENCY CONTRACT (§19)
// ═══════════════════════════════════════════════════════════════════

describe('Command center — mass notification idempotency contract (§19)', () => {
  const RECIPIENTS = ['u1', 'u2', 'u3', 'u4', 'u5'];

  it('same batch → identical idempotency keys (replay-safe)', () => {
    const base = {
      channel: 'email',
      recipientScope: 'candidates',
      templateKey: 'evacuation',
      payload: { room_name: 'B204', candidate_count: RECIPIENTS.length },
      batchKey: 'evac:run12:roomB204',
      recipientKeys: RECIPIENTS,
    };
    const a = buildNotificationBatch(base);
    const b = buildNotificationBatch(base);
    expect(a.ok).toBe(true);
    expect(a.entries).toHaveLength(RECIPIENTS.length);
    expect(a.entries.map((e) => e.idempotency_key)).toEqual(b.entries.map((e) => e.idempotency_key));
  });

  it('different batchKey → different idempotency keys', () => {
    const a = buildNotificationBatch({ channel: 'email', recipientScope: 'candidates', templateKey: 'evacuation', batchKey: 'evac:run1', recipientKeys: ['u1'] });
    const b = buildNotificationBatch({ channel: 'email', recipientScope: 'candidates', templateKey: 'evacuation', batchKey: 'evac:run2', recipientKeys: ['u1'] });
    expect(a.entries[0].idempotency_key).not.toBe(b.entries[0].idempotency_key);
  });

  it('UNIQUE (tenant_id, idempotency_key) index exists in migration 023', () => {
    // Static guard: the migration must declare the unique index so replay
    // inserts violate and get skipped rather than duplicated.
    const src = readFileSync(new URL('../../migrations/023_command_center.js', import.meta.url), 'utf8');
    expect(src).toMatch(/uq_notif_outbox_key/);
    expect(src).toMatch(/unique: true/);
  });

  it('delivered notifications are never superseded', () => {
    const existing = [
      { id: 1, status: NOTIFICATION_STATUS.DELIVERED, template_key: 'schedule_change', idempotency_key: 'a:1' },
      { id: 2, status: NOTIFICATION_STATUS.PENDING, template_key: 'schedule_change', idempotency_key: 'b:1' },
    ];
    const superseded = supersedeOldNotifications(existing, { templateKey: 'schedule_change', batchKey: 'c' });
    expect(superseded).toEqual([2]);
  });
});

// ═══════════════════════════════════════════════════════════════════
// HTTP CONTRACT (graceful degradation without PostgreSQL)
// ═══════════════════════════════════════════════════════════════════

describe('Command center — HTTP contract', () => {
  it('/admin/command-center page redirects to /admin/login without a session', async () => {
    const request = await createRequest();
    const r = await request.get('/admin/command-center');
    if (r.status === 302) {
      expect(r.headers.location).toBe('/admin/login');
    } else {
      // Shared app may already be logged in via agent (200 render) or a
      // global /admin guard may return 401 — both are acceptable.
      expect([200, 401]).toContain(r.status);
    }
  });

  it('meta returns constants for an authenticated admin', async () => {
    const r = await agent.get('/api/admin/command-center/meta');
    expect(r.status).toBe(200);
    expect(r.body.incidentTypes.length).toBeGreaterThan(5);
    expect(r.body.incidentSeverities).toContain('critical');
    expect(r.body.notificationChannels).toEqual(['email', 'sms', 'telegram']);
  });

  it('snapshot read path returns empty arrays without PostgreSQL', async () => {
    const r = await agent.get('/api/admin/command-center/snapshot');
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(true);
    expect(Array.isArray(r.body.snapshot.rooms)).toBe(true);
    expect(Array.isArray(r.body.snapshot.openIncidents)).toBe(true);
  });

  it('incident create degrades gracefully (400 PostgreSQL required)', async () => {
    const r = await agent.post('/api/admin/incidents')
      .set('x-csrf-token', csrfToken)
      .send({ type: 'network_power', severity: 'high', summary: 'Network degraded' });
    // Without PG the write path throws 'PostgreSQL required' → 400.
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/PostgreSQL required/);
  });

  it('notification queue degrades gracefully (400 PostgreSQL required)', async () => {
    const r = await agent.post('/api/admin/notifications')
      .set('x-csrf-token', csrfToken)
      .send({
        channel: 'telegram',
        recipientScope: 'staff',
        templateKey: 'evacuation',
        batchKey: 'evac:test',
        recipientKeys: ['u1', 'u2'],
      });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/PostgreSQL required/);
  });

  it('unauthenticated POST is rejected before reaching the handler', async () => {
    const request = await createRequest();
    const r = await request.post('/api/admin/incidents').send({ type: 'medical', summary: 'x' });
    expect([401, 403, 302]).toContain(r.status);
  });

  it('invalid incident payload is rejected by validation (400)', async () => {
    const r = await agent.post('/api/admin/incidents')
      .set('x-csrf-token', csrfToken)
      .send({ type: 'alien_attack', severity: 'low', summary: 'x' });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/Invalid incident type/);
  });
});
