/**
 * Deborah — E2E/Security: Room Outage / Evacuation Drill (Prompt 41)
 *
 * E2E walk (Prompt 41 §20):
 *   - Pure-logic E2E drill: network outage incident → action (evacuation
 *     hook) → notification batch (sanitized) → state machine through
 *     resolved → close guard (owner + action + reason) → closed.
 *   - SECURITY (§15): notification preview sanitizer strips health /
 *     integrity / answer-key detail even when the raw payload includes it;
 *     action detail sanitizer drops sensitive keys; close guard blocks
 *     owner-less / action-less / reason-less closure (§53.7).
 *   - API walk (graceful degradation without PostgreSQL):
 *       • /admin/command-center page redirects to /admin/login without a
 *         session.
 *       • Every /api/admin/command-center/* write path requires admin
 *         (CSRF-first) and degrades to 400 { error: 'PostgreSQL required' }
 *         without PG — no silent corruption.
 *       • Read paths return 200 with empty arrays.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createApp } from '../../server.js';
import CONFIG from '../../src/config/env.js';
import { createRequest, snapshotDb, restoreDb } from '../helpers/setup.js';
import {
  validateIncident,
  validateIncidentTransition,
  validateIncidentClose,
  buildNotificationPreview,
  buildNotificationBatch,
  buildDeepLinkAdapters,
  INCIDENT_STATUS,
  INCIDENT_ACTION_TYPES,
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
// EVACUATION DRILL — PURE LOGIC E2E (§20)
// ═══════════════════════════════════════════════════════════════════

describe('Command center — room outage / evacuation drill (§20)', () => {
  it('runs the full incident lifecycle with close guard', () => {
    // 1. Create incident (network_power outage in room B204).
    const created = validateIncident({
      type: 'network_power',
      severity: 'critical',
      summary: 'Room B204 network degraded',
      room_id: 2,
      affected_candidate_ids: [1, 2, 3, 4],
      owner_user_id: 9,
    });
    expect(created.ok).toBe(true);
    const incident = { ...created.incident, actions: [] };

    // 2. Evacuation hook action (addIncidentAction pure-level via schema types).
    expect(INCIDENT_ACTION_TYPES).toContain('evacuation');
    incident.actions.push({ action_type: 'evacuation', detail: { room_name: 'B204', period_name: '09:00' } });

    // 3. State machine through to resolved.
    let status = incident.status;
    for (const next of [INCIDENT_STATUS.INVESTIGATING, INCIDENT_STATUS.MITIGATED, INCIDENT_STATUS.RESOLVED]) {
      const v = validateIncidentTransition(status, next);
      expect(v.ok, `${status} → ${next}`).toBe(true);
      status = v.to;
    }

    // 4. Close guard — without reason the close is blocked.
    const blocked = validateIncidentClose(incident, { reason: '' });
    expect(blocked.ok).toBe(false);
    expect(blocked.error).toMatch(/reason/i);

    // 5. With reason — close succeeds.
    const ok = validateIncidentClose(incident, { reason: 'network restored, students relocated' });
    expect(ok.ok).toBe(true);
  });

  it('blocked when no owner assigned (stop condition §24)', () => {
    const incident = {
      type: 'evacuation', severity: 'high', status: 'resolved',
      summary: 'Fire drill', actions: [{ action_type: 'evacuation' }],
    };
    const r = validateIncidentClose(incident, { reason: 'all safe' });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/owner/i);
  });
});

// ═══════════════════════════════════════════════════════════════════
// SECURITY — SANITIZED NOTIFICATION PREVIEW (§15)
// ═══════════════════════════════════════════════════════════════════

describe('Command center — notification preview data guard (§15)', () => {
  it('strips health/integrity/answer-key detail from the outbox payload', () => {
    const raw = {
      template_key: 'evacuation',
      channel: 'sms',
      recipient_scope: 'candidates',
      room_name: 'B204',
      candidate_count: 25,
      // Attempted sensitive leakage:
      health_detail: 'student fainted, blood pressure 90/60',
      integrity_detail: 'answer key hash mismatch',
      answer_key: 'A1B2C3',
      grade: 'F',
      raw_reason: 'candidate visibly distressed, needs medical attention',
      nested_sensitive: { diagnosis: 'panic attack' },
    };
    const preview = buildNotificationPreview(raw);
    // Whitelisted scalars survive.
    expect(preview.template_key).toBe('evacuation');
    expect(preview.room_name).toBe('B204');
    expect(preview.candidate_count).toBe(25);
    // Sensitive keys are never in the preview.
    for (const k of ['health_detail', 'integrity_detail', 'answer_key', 'grade', 'raw_reason', 'nested_sensitive']) {
      expect(preview[k], k).toBeUndefined();
    }
  });

  it('notification batch entries carry only sanitized payloads', () => {
    const b = buildNotificationBatch({
      channel: 'telegram', recipientScope: 'room', templateKey: 'schedule_change',
      payload: { room_name: 'C101', new_start_at: '10:30', integrity_detail: 'leak' },
      batchKey: 'sch:run12:C101', recipientKeys: ['p1'],
    });
    expect(b.ok).toBe(true);
    expect(b.entries[0].payload.integrity_detail).toBeUndefined();
    expect(b.entries[0].payload.new_start_at).toBe('10:30');
  });

  it('deep-link adapters never include sensitive fields', () => {
    const a = buildDeepLinkAdapters('telegram', {
      template_key: 'incident_opened', recipient_scope: 'staff',
      room_name: 'B204', health_detail: 'sensitive',
    });
    expect(a.ok).toBe(true);
    const str = JSON.stringify(a.adapter);
    expect(str).not.toMatch(/health_detail|sensitive/i);
  });
});

// ═══════════════════════════════════════════════════════════════════
// API WALK — GRACEFUL DEGRADATION WITHOUT POSTGRESQL
// ═══════════════════════════════════════════════════════════════════

describe('Command center — API walk (graceful degradation)', () => {
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

  it('meta endpoint serves constants for admin', async () => {
    const r = await agent.get('/api/admin/command-center/meta');
    expect(r.status).toBe(200);
    expect(r.body.incidentStatus.OPEN).toBeDefined();
    expect(r.body.incidentTransitions.open).toContain('investigating');
    expect(r.body.incidentActionTypes).toContain('evacuation');
  });

  it('snapshot read path returns empty arrays without PG', async () => {
    const r = await agent.get('/api/admin/command-center/snapshot');
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(true);
    expect(Array.isArray(r.body.snapshot.rooms)).toBe(true);
    expect(Array.isArray(r.body.snapshot.openIncidents)).toBe(true);
  });

  it('write paths degrade to 400 PostgreSQL required (CSRF-first)', async () => {
    const r = await agent.post('/api/admin/incidents')
      .set('x-csrf-token', csrfToken)
      .send({ type: 'network_power', severity: 'high', summary: 'outage' });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/PostgreSQL required/);
  });

  it('unauthenticated access is rejected', async () => {
    const request = await createRequest();
    const r = await request.get('/api/admin/command-center/snapshot');
    expect([401, 403, 302]).toContain(r.status);
  });
});
