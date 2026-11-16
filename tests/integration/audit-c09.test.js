/**
 * AUTH C-09 — Audit dashboard integration/contract tests
 * -------------------------------------------------------------------
 *  1. Admin /admin/audit sahifa 200; audit API filter/qidiruv/pagination
 *  2. Aggregate'lar: login success/fail rate, lockout, teacher, risk, HIBP, abuse
 *  3. Eksport CSV — PII minimal (parol/token/OTP YO'Q — grep)
 *  4. Non-admin /admin/api/audit'ga kira olmaydi (requireAdmin)
 *  5. Fail spike alert: threshold → email (mock) + audit yozuvi
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { snapshotDb, restoreDb } from '../helpers/setup.js';
import { createApp } from '../../server.js';
import { fb } from '../../firebase/admin.js';
import { logAuthEvent, AUDIT_ACTIONS } from '../../src/modules/auth/audit.js';
import { runFailSpikeAlert } from '../../src/modules/auth/audit-alert.js';
import supertest from 'supertest';

let app;
let httpServer;
let base;

beforeAll(async () => {
  await snapshotDb();
  const created = await createApp();
  app = created.app;
  httpServer = created.httpServer;
  await new Promise((r) => httpServer.listen(0, r));
  base = `http://localhost:${httpServer.address().port}`;
});

afterAll(async () => {
  await restoreDb();
  await new Promise((r) => httpServer.close(r));
});

function csrfFrom(html) {
  const m = html.match(/name="_csrf"\s+value="([^"]+)"/) || html.match(/window\.__CSRF_TOKEN = '([^']+)'/);
  return m ? m[1] : '';
}

async function adminAgent() {
  const admin = supertest.agent(app);
  const page = await admin.get('/admin/login');
  const csrf = csrfFrom(page.text);
  const adminUser = process.env.ADMIN_USER || 'admin';
  const adminPass = process.env.ADMIN_PASS || 'admin';
  const alr = await admin.post('/admin/login').set('x-forwarded-for', '198.51.100.200').type('form').send({
    _csrf: csrf, username: adminUser, password: adminPass,
  });
  expect([302, 200]).toContain(alr.status);
  const dash = await admin.get('/admin');
  const m = dash.text.match(/__CSRF_TOKEN\s*=\s*'([^']+)'/) || dash.text.match(/const CSRF = '([^']+)'/);
  const token = m ? m[1] : '';
  const re = await admin.post('/api/admin/reauth').send({ password: adminPass }).set('x-csrf-token', token);
  expect(re.status).toBe(200);
  admin.__csrfToken = token;
  return admin;
}

async function clearAudit() {
  const snap = await fb.get('auth_audit');
  if (snap.exists()) {
    for (const day of Object.keys(snap.val())) {
      await fb.remove(`auth_audit/${day}`).catch(() => {});
    }
  }
  await fb.remove('audit_alert_state').catch(() => {});
}

describe('AUTH C-09 — audit dashboard (admin)', () => {
  beforeEach(async () => {
    // Testlar orasida auth_audit + alert state toza — yig'ilish yo'q
    await clearAudit();
  });

  it('non-admin /admin/api/audit ga kira olmaydi (requireAdmin)', async () => {
    const anon = supertest.agent(app);
    const r = await anon.get('/admin/api/audit');
    expect([302, 401, 403]).toContain(r.status);
  });

  it('admin sahifa + API filter/qidiruv/pagination + aggregates + export CSV (PII yo\'q)', async () => {
    const admin = await adminAgent();

    // 1) Audit hodisalarini seed qilamiz
    const now = Date.now();
    for (let i = 0; i < 4; i++) {
      await logAuthEvent({
        action: AUDIT_ACTIONS.AUTH_LOGIN_FAIL, outcome: 'failed', method: 'password',
        actorId: `c09_spam_${i}`, ipAddress: '203.0.113.9', details: {},
      });
    }
    await logAuthEvent({
      action: AUDIT_ACTIONS.AUTH_LOGIN, outcome: 'success', method: 'password',
      actorId: 'c09_victim', ipAddress: '203.0.113.10', details: {},
    });
    await logAuthEvent({
      action: AUDIT_ACTIONS.LOCKOUT_TRIGGERED, outcome: 'locked', method: 'password',
      actorId: 'c09_spam_0', ipAddress: '203.0.113.9', details: { strike: 1 },
    });
    await logAuthEvent({
      action: AUDIT_ACTIONS.STUFFING_DETECTED, outcome: 'flagged', method: 'scheduled',
      actorId: null, ipAddress: '203.0.113.9', details: { pattern: 'multi-account' },
    });

    // 2) Sahifa render (200)
    const page = await admin.get('/admin/audit');
    expect(page.status).toBe(200);
    expect(page.text).toContain('Audit jurnali');

    // 3) Ro'yxat — seed 7 + admin login o'zi audit yozadi (>= 7)
    const all = await admin.get('/admin/api/audit');
    expect(all.status).toBe(200);
    expect(all.body.total).toBeGreaterThanOrEqual(7);

    // 4) Filter: login.failed → 4
    const fails = await admin.get('/admin/api/audit?action=auth.login.failed');
    expect(fails.body.total).toBe(4);
    expect(fails.body.items.every((e) => e.action === 'auth.login.failed')).toBe(true);

    // 5) Qidiruv: actor_id substring
    const q = await admin.get('/admin/api/audit?q=c09_victim');
    expect(q.body.total).toBe(1);

    // 6) Pagination — action-filter ichida deterministik (4 fail, pageSize 3)
    const p1 = await admin.get('/admin/api/audit?action=auth.login.failed&page=1&pageSize=3');
    const p2 = await admin.get('/admin/api/audit?action=auth.login.failed&page=2&pageSize=3');
    expect(p1.body.items.length).toBe(3);
    expect(p2.body.items.length).toBe(1);
    expect(p1.body.total).toBe(4);

    // 7) Aggregate'lar
    const agg = await admin.get('/admin/api/audit/aggregates');
    expect(agg.status).toBe(200);
    expect(agg.body.login_success).toBe(1);
    expect(agg.body.login_fail).toBe(4);
    expect(agg.body.lockout).toBe(1);
    expect(agg.body.abuse_events).toBe(1);
    expect(agg.body.total).toBeGreaterThanOrEqual(7); // seed 7 + admin login audit

    // 8) Eksport CSV — PII minimal (parol/token/OTP YO'Q, to'liq IP YO'Q)
    const csv = await admin.get('/admin/api/audit/export');
    expect(csv.status).toBe(200);
    expect(csv.headers['content-type']).toContain('text/csv');
    expect(csv.text).toContain('"ts","action","outcome","method","actor_id","ip_hash"');
    // PII minimal: secret QIYMATLAR yo'q (method: 'password' ustuni — legitim,
    // u auth usulini bildiradi; tekshiruv secret qiymatlariga qaratilgan)
    expect(csv.text).not.toMatch(/raw-?pass|reset-?token|otp[-_]?code|supersecret|secret[_-]?value/i);
    expect(csv.text).not.toContain('203.0.113.9'); // to'liq IP emas — hash
  });

  it('fail spike alert: threshold oshsa → email (mock) + audit; cooldown idempotent', async () => {
    // 5 ta fail (threshold 5) → alert
    for (let i = 0; i < 5; i++) {
      await logAuthEvent({
        action: AUDIT_ACTIONS.AUTH_LOGIN_FAIL, outcome: 'failed', method: 'password',
        actorId: `c09_spike_${i}`, ipAddress: '203.0.113.20',
      });
    }
    const sent = [];
    const send = (msg) => { sent.push(msg); return Promise.resolve({ ok: true }); };
    const r = await runFailSpikeAlert({ now: Date.now(), threshold: 5, windowMs: 60000, cooldownMs: 3600000, send });
    expect(r.alerted).toBe(true);
    expect(r.failCount).toBe(5);
    expect(sent.length).toBe(1);
    expect(sent[0].subject).toContain('Fail spike');

    // Qayta yugurish — cooldown ichida → qayta email YO'Q
    await runFailSpikeAlert({ now: Date.now(), threshold: 5, windowMs: 60000, cooldownMs: 3600000, send });
    expect(sent.length).toBe(1); // idempotent

    // Audit yozuvi bor (auth.audit.fail_spike)
    const snap = await fb.get('auth_audit');
    const entries = snap.exists()
      ? Object.values(snap.val()).flatMap((d) => Object.values(d))
      : [];
    const spike = entries.find((e) => e.action === 'auth.audit.fail_spike');
    expect(spike).toBeTruthy();
    expect(spike.outcome).toBe('flagged');
    expect(spike.detail).not.toHaveProperty('password');
  });
});
