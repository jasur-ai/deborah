/**
 * AUTH C-02 — Lockout state machine integration/contract tests
 * -------------------------------------------------------------------
 *  1. 10 xato → hard lock (strike 1, ~900s) → 11-urinish 429
 *  2. Support unlock (/admin/api/users/unlock) → login muvaffaqiyatli
 *  3. Admin block (/admin/api/users/block) → login generic blok (countdown emas)
 *  4. Admin unblock → login yana ishlaydi
 *  5. Audit: lockout.triggered / lockout.released / account.blocked yozildi
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { snapshotDb, restoreDb } from '../helpers/setup.js';
import { createApp } from '../../server.js';
import { fb } from '../../firebase/admin.js';
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

const PW = 'sirli-parol-2026';

function csrfFrom(html) {
  const m = html.match(/name="_csrf"\s+value="([^"]+)"/) || html.match(/window\.__CSRF_TOKEN = '([^']+)'/);
  return m ? m[1] : '';
}

async function registerUser(agent, uname, xff) {
  const page = await agent.get('/user/login');
  const csrf = csrfFrom(page.text);
  const res = await agent.post('/user/login')
    .set('x-forwarded-for', xff)
    .type('form')
    .send({
      _csrf: csrf, lang: 'uz', mode: 'reg', consent: 'on', username: uname, password: PW,
      email: `c02_${Date.now()}_${Math.floor(Math.random() * 1000000)}_a18@test.uz`,
    });
  expect(res.status).toBe(302);
}

// Har urinish uchun YANGI agent (register agent'i logged-in — /user/login
// redirectIfAuth bilan 302 qaytaradi, csrf bo'lmaydi). Server-side per-IP /
// per-account counter'lar global — yangi agent bypass emas.
async function wrongLogin(uname, xff, acceptJson = false) {
  const agent = supertest.agent(app);
  const page = await agent.get('/user/login');
  const csrf = csrfFrom(page.text);
  const headers = acceptJson ? { Accept: 'application/json' } : {};
  return agent.post('/user/login')
    .set('x-forwarded-for', xff)
    .set(headers)
    .type('form')
    .send({ _csrf: csrf, lang: 'uz', mode: 'login', username: uname, password: 'noto-gri-parol' });
}

/** To'g'ri parol bilan login (yangi agent). */
async function goodLogin(uname, xff) {
  const agent = supertest.agent(app);
  const page = await agent.get('/user/login');
  const csrf = csrfFrom(page.text);
  return agent.post('/user/login')
    .set('x-forwarded-for', xff)
    .type('form')
    .send({ _csrf: csrf, lang: 'uz', mode: 'login', username: uname, password: PW });
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

async function authAuditEntries() {
  const snap = await fb.get('auth_audit');
  if (!snap.exists()) return [];
  const days = snap.val();
  return Object.values(days).flatMap((d) => Object.values(d));
}

describe('AUTH C-02 — lockout state machine', () => {
  it('10 xato → hard lock (strike 1) → 11-urinish 429; support unlock → login o\'tadi', async () => {
    const uname = `c02a_${Date.now() % 1000000}`;
    const xff = '203.0.113.60';
    const agent = supertest.agent(app);
    await registerUser(agent, uname, xff);

    for (let i = 0; i < 10; i++) await wrongLogin(uname, xff);

    // strike 1 — 15 daqiqa (~900s)
    const strikes = await fb.get(`users/${uname}/lock_strikes`);
    expect(strikes.val()).toBe(1);
    const lu = await fb.get(`users/${uname}/locked_until`);
    expect(lu.exists()).toBe(true);

    // 11-urinish → 429 (route pre-check)
    const blocked = await wrongLogin(uname, xff, true);
    expect(blocked.status).toBe(429);
    const retryAfter = parseInt(blocked.headers['retry-after'] || '0', 10);
    expect(retryAfter).toBeGreaterThan(0);
    expect(retryAfter).toBeLessThanOrEqual(900);

    // Support manual unlock
    const admin = await adminAgent();
    const ul = await admin.post('/admin/api/users/unlock')
      .set('x-csrf-token', admin.__csrfToken)
      .send({ key: uname });
    expect(ul.status).toBe(200);
    expect(ul.body.success).toBe(true);
    const lu2 = await fb.get(`users/${uname}/locked_until`);
    expect(lu2.exists()).toBe(false);

    // Endi login muvaffaqiyatli
    const ok = await goodLogin(uname, xff);
    expect(ok.status).toBe(302);
  });

  it('admin block → login generic blok (countdown emas); unblock → ishlaydi', async () => {
    const uname = `c02b_${Date.now() % 1000000}`;
    const xff = '203.0.113.61';
    const agent = supertest.agent(app);
    await registerUser(agent, uname, xff);

    const admin = await adminAgent();
    const bl = await admin.post('/admin/api/users/block')
      .set('x-csrf-token', admin.__csrfToken)
      .send({ key: uname, reason: 'test abuse' });
    expect(bl.status).toBe(200);

    const st = await fb.get(`users/${uname}/status`);
    expect(st.val()).toBe('blocked');

    // Login → generic blok (data-lockout=0, countdown emas)
    const res = await wrongLogin(uname, xff);
    const html = res.text;
    expect(html).not.toContain('data-lockout="1"');
    // generic xato matni — aniq "bloklandi" ma'nosida (enumeration yo'q)
    expect(html.length).toBeGreaterThan(100);

    // Unblock → login ishlaydi
    const ub = await admin.post('/admin/api/users/unblock')
      .set('x-csrf-token', admin.__csrfToken)
      .send({ key: uname });
    expect(ub.status).toBe(200);
    const st2 = await fb.get(`users/${uname}/status`);
    expect(st2.exists()).toBe(false);

    const ok = await goodLogin(uname, xff);
    expect(ok.status).toBe(302);
  });

  it('audit: lockout.triggered + account.blocked yozildi', async () => {
    const uname = `c02c_${Date.now() % 1000000}`;
    const xff = '203.0.113.62';
    const agent = supertest.agent(app);
    await registerUser(agent, uname, xff);
    for (let i = 0; i < 10; i++) await wrongLogin(uname, xff);

    const admin = await adminAgent();
    await admin.post('/admin/api/users/block').set('x-csrf-token', admin.__csrfToken).send({ key: uname });

    const entries = await authAuditEntries();
    const triggered = entries.filter((e) => e.action === 'auth.lockout.triggered');
    expect(triggered.length).toBeGreaterThanOrEqual(1);
    expect(triggered[triggered.length - 1].detail.strike).toBe(1);
    const blocked = entries.filter((e) => e.action === 'auth.account.blocked');
    expect(blocked.length).toBeGreaterThanOrEqual(1);
  });

  it('permanent blokda unlock rad etiladi (support qarori zarur)', async () => {
    const uname = `c02d_${Date.now() % 1000000}`;
    const xff = '203.0.113.63';
    const agent = supertest.agent(app);
    await registerUser(agent, uname, xff);

    const admin = await adminAgent();
    // C-08 §29: blok sababi MAJBURIY
    const bl = await admin.post('/admin/api/users/block').set('x-csrf-token', admin.__csrfToken).send({ key: uname, reason: 'c02 test' });
    expect(bl.status).toBe(200);
    const st = await fb.get(`users/${uname}/status`);
    expect(st.val()).toBe('blocked');

    // support unlock permanent'ni rad etadi → 409
    const ul = await admin.post('/admin/api/users/unlock').set('x-csrf-token', admin.__csrfToken).send({ key: uname });
    expect(ul.status).toBe(409);
    expect(ul.body.code).toBe('ACCOUNT_BLOCKED');
  });
});
