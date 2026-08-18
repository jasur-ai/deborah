/**
 * Deborah — AUTH C-08 User management — Integration/contract tests
 * ------------------------------------------------------------------
 *  - /admin/api/users: qidiruv/filter/pagination/email+role+status
 *  - blok → login blok (generic xato) + audit
 *  - rol change → role_version + session revoke (B-25) + audit
 *  - revoke-sessions endpoint → count
 *  - IDOR: non-admin blok qila olmaydi (requireAdmin)
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { snapshotDb, restoreDb } from '../helpers/setup.js';
import { createApp } from '../../server.js';
import { fb } from '../../firebase/admin.js';
import { safeKey } from '../../utils/helpers.js';
import supertest from 'supertest';

let app;
let httpServer;

beforeAll(async () => {
  await snapshotDb();
  const created = await createApp();
  app = created.app;
  httpServer = created.httpServer;
  await new Promise((r) => httpServer.listen(0, r));
});

afterAll(async () => {
  await restoreDb();
  await new Promise((r) => httpServer.close(r));
});

const PW = 'sirli-parol-2026';
const ADMIN_USER = process.env.ADMIN_USER || 'testadmin';
const ADMIN_PASS = process.env.ADMIN_PASS || 'testpass';

function csrfFrom(html) {
  const m = html.match(/name="_csrf"\s+value="([^"]+)"/) || html.match(/window\.__CSRF_TOKEN = '([^']+)'/);
  return m ? m[1] : '';
}

/** Admin session (MFA flag off — legacy). */
async function adminAgent() {
  const agent = supertest.agent(app);
  const page = await agent.get('/admin/login');
  const csrf = csrfFrom(page.text);
  const res = await agent.post('/admin/login')
    .type('form')
    .send({ _csrf: csrf, username: ADMIN_USER, password: ADMIN_PASS });
  // MFA mandatory bo'lsa redirect /admin/mfa — flag off kutiladi (vitest env)
  if (res.headers.location && res.headers.location.includes('/admin/mfa')) {
    throw new Error('MFA mandatory — test legacy session ololmaydi');
  }
  return agent;
}

async function registerUser(agent, uname) {
  const page = await agent.get('/user/login');
  const csrf = csrfFrom(page.text);
  const res = await agent.post('/user/login')
    .set('x-forwarded-for', '203.0.113.90')
    .type('form')
    .send({
      _csrf: csrf, lang: 'uz', mode: 'reg', consent: 'on', username: uname, password: PW,
      email: `c08_${Date.now()}_${Math.floor(Math.random() * 1000000)}_a18@test.uz`,
    });
  expect(res.status).toBe(302);
  return safeKey(uname);
}

async function authAuditEntries() {
  const snap = await fb.get('auth_audit');
  if (!snap.exists()) return [];
  const days = snap.val();
  return Object.values(days).flatMap((d) => Object.values(d));
}

describe('AUTH C-08 — user management', () => {
  it('/admin/api/users: qiduruv + email/role/status maydonlar (PII minimal)', async () => {
    const agent = supertest.agent(app);
    const uname = `c08list_${Date.now() % 1000000}`;
    await registerUser(agent, uname);

    const admin = await adminAgent();
    const res = await admin.get('/admin/api/users').query({ q: uname });
    expect(res.status).toBe(200);
    expect(res.body.total).toBeGreaterThanOrEqual(1);
    const found = res.body.users.find((u) => u.username === uname);
    expect(found).toBeTruthy();
    expect(found.email).toContain('@test.uz');
    expect(found.role).toBe('student');
    expect(['active', 'blocked']).toContain(found.status);
  });

  it('blok → user login bloklanadi (generic xato) + audit account:blocked + sessiyalar revoke', async () => {
    const agent = supertest.agent(app);
    const uname = `c08block_${Date.now() % 1000000}`;
    const key = await registerUser(agent, uname);

    const admin = await adminAgent();
    const dash = await admin.get('/admin/users').set('Accept', 'text/html');
    const csrf = csrfFrom(dash.text);
    const block = await admin.post('/admin/api/users/block')
      .set('x-csrf-token', csrf)
      .send({ key, reason: 'Test blok' });
    expect(block.status).toBe(200);
    expect(block.body.success).toBe(true);

    // DB'da status blocked
    const snap = await fb.get(`users/${key}`);
    expect(snap.val().status).toBe('blocked');
    expect(snap.val().blocked_reason).toBe('Test blok');

    // Bloklangan user login → generic xato (200 login sahifa, kirdirmaydi)
    const uagent = supertest.agent(app);
    const page = await uagent.get('/user/login');
    const ucsrf = csrfFrom(page.text);
    const login = await uagent.post('/user/login')
      .set('x-forwarded-for', '203.0.113.91')
      .type('form')
      .send({ _csrf: ucsrf, lang: 'uz', username: uname, password: PW });
    expect(login.status).toBe(200); // login sahifasi (session berilmaydi)
    expect(login.headers.location).toBeUndefined();

    // Audit (ACCOUNT_BLOCKED = 'auth.account.blocked') — logAuthEvent fire-and-forget
    await new Promise((r) => setTimeout(r, 150));
    const entries = await authAuditEntries();
    const blockEvt = entries.find((e) => e.action === 'auth.account.blocked');
    expect(blockEvt).toBeTruthy();
    expect(blockEvt.detail && blockEvt.detail.actor).toBe(ADMIN_USER);
  });

  it('blok sababsiz → 400 reason required (C-08 §29)', async () => {
    const admin = await adminAgent();
    const dash = await admin.get('/admin/users').set('Accept', 'text/html');
    const csrf = csrfFrom(dash.text);
    const res = await admin.post('/admin/api/users/block')
      .set('x-csrf-token', csrf)
      .send({ key: 'someuser' }); // sabab yo'q
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('reason required');
  });

  it('rol change → role_version oshadi + audit (session revoke B-25)', async () => {
    const agent = supertest.agent(app);
    const uname = `c08role_${Date.now() % 1000000}`;
    const key = await registerUser(agent, uname);
    const before = (await fb.get(`users/${key}/role_version`)).val();

    const admin = await adminAgent();
    const dash = await admin.get('/admin/users').set('Accept', 'text/html');
    const csrf = csrfFrom(dash.text);
    const res = await admin.post('/admin/api/users/role')
      .set('x-csrf-token', csrf)
      .send({ key, role: 'teacher' });
    expect(res.status).toBe(200);
    expect(res.body.to).toBe('teacher');

    const after = (await fb.get(`users/${key}/role_version`)).val();
    expect(after).toBeGreaterThan(before); // eski sessiyalar bekor
    expect((await fb.get(`users/${key}/role`)).val()).toBe('teacher');

    // Audit (logAuthEvent fire-and-forget — kutamiz)
    await new Promise((r) => setTimeout(r, 150));
    const entries = await authAuditEntries();
    const roleEvt = entries.filter((e) => e.action === 'admin:action')
      .find((e) => e.detail && e.detail.action === 'role:change' && e.detail.resource === key);
    expect(roleEvt).toBeTruthy();
    expect(roleEvt.detail.from).toBe('student');
    expect(roleEvt.detail.to).toBe('teacher');
  });

  it('revoke-sessions → 200 (count 0+); IDOR: user admin API ga kira olmaydi (401/302)', async () => {
    const admin = await adminAgent();
    const dash = await admin.get('/admin/users').set('Accept', 'text/html');
    const csrf = csrfFrom(dash.text);
    const res = await admin.post('/admin/api/users/revoke-sessions')
      .set('x-csrf-token', csrf)
      .send({ key: 'nosuchuser' });
    expect(res.status).toBe(200);
    expect(typeof res.body.count).toBe('number');

    // Non-admin (student) blok qila olmaydi — requireAdmin → 302/401
    const student = supertest.agent(app);
    const uname = `c08idor_${Date.now() % 1000000}`;
    await registerUser(student, uname);
    const panel = await student.get('/user/panel');
    const scsrf = csrfFrom(panel.text);
    const attempt = await student.post('/admin/api/users/block')
      .set('x-csrf-token', scsrf)
      .send({ key: 'other', reason: 'hack' });
    expect([302, 401, 403]).toContain(attempt.status);
  });
});
