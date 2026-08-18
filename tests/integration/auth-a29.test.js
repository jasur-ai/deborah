/**
 * Edikit — AUTH A-29 Account security events — Integration tests
 * ---------------------------------------------------------------
 *  - Password change: boshqa sessiya revoke + security event + notification
 *  - Email change (double opt-in): reauth → request (yangi email kod) →
 *    verify → email yangilanadi + eski email xabar + event
 *  - Breach flag → panel'da banner
 *  - GET /api/account/security-events (PII-minimal)
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import supertest from 'supertest';
import { createApp } from '../../server.js';
import { snapshotDb, restoreDb } from '../helpers/setup.js';
import { fb } from '../../firebase/admin.js';
import { safeKey } from '../../utils/helpers.js';

let ipCounter = 200;
function nextIp() {
  ipCounter = 200 + ((ipCounter - 200 + 1) % 54);
  return `203.0.113.${ipCounter}`;
}

let app;
let httpServer;

function csrfFrom(html) {
  const m = html.match(/name="_csrf" value="([^"]+)"/);
  return m ? m[1] : null;
}

async function registerUser(agent, username) {
  const page = await agent.get('/user/login?lang=uz');
  const csrf = csrfFrom(page.text);
  const res = await agent.post('/user/login').set('x-forwarded-for', nextIp()).type('form').send({
    mode: 'reg', consent: 'on', _csrf: csrf, username,
    email: `${username}@test.uz`, password: 'parol-2026-x-uzun', lang: 'uz',
  });
  return res;
}

async function freshLogin(agent, username) {
  const fresh = supertest.agent(app);
  const page = await fresh.get('/user/login?lang=uz');
  const csrf = csrfFrom(page.text);
  await fresh.post('/user/login').set('x-forwarded-for', nextIp()).type('form').send({
    _csrf: csrf, username, password: 'parol-2026-x-uzun', lang: 'uz',
  });
  return fresh;
}

describe('AUTH A-29 — Account security events + password/email change', () => {
  beforeAll(async () => {
    await snapshotDb();
    ({ app, httpServer } = await createApp());
    await new Promise((r) => httpServer.listen(0, r));
  });
  afterAll(async () => {
    await restoreDb();
    await new Promise((r) => httpServer.close(r));
  });

  it('password change: reauth, revoke boshqa sessiya, security event + notification', async () => {
    const agent = supertest.agent(app);
    const uname = `a29a_${Date.now() % 1000000}`;
    await registerUser(agent, uname);

    // Ikkinchi sessiya (boshqa agent) — revoke bo'lishini tekshiramiz
    const agent2 = await freshLogin(agent, uname);

    // Asosiy agentda parolni o'zgartirish
    await agent.get('/user/panel');
    const csrf = csrfFrom((await agent.get('/user/login?lang=uz')).text);
    // session'da bo'lgan agent — panel CSRF
    const pPage = await agent.get('/user/panel');
    const m = pPage.text.match(/window\.__CSRF_TOKEN\s*=\s*("([^"]+)"|'([^']+)')/);
    const panelCsrf = m ? (m[2] || m[3]) : '';

    const res = await agent.post('/api/password/change').set('x-csrf-token', panelCsrf).send({
      currentPassword: 'parol-2026-x-uzun',
      newPassword: 'yangi-parol-2026-uzun',
    });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);

    // Boshqa sessiya (agent2) endi eski parolga bog'liq — revoke bo'lgan
    // (password_updated_at o'zgargandi — panel'ga kirish sessiyani bekor qiladi)
    const panel2 = await agent2.get('/user/panel');
    expect([301, 302, 401]).toContain(panel2.status);

    // Security event
    const events = await agent.get('/api/account/security-events');
    expect(events.body.ok).toBe(true);
    expect(events.body.events.some((e) => e.type === 'password_changed')).toBe(true);
    // PII-minimal: event'da ip/parol yo'q
    expect(JSON.stringify(events.body.events)).not.toContain('203.0.113.');
  });

  it('email change (B-24): reauth → request → confirm → email yangilanadi', async () => {
    const agent = supertest.agent(app);
    const uname = `a29b_${Date.now() % 1000000}`;
    await registerUser(agent, uname);
    const m = (await agent.get('/user/panel')).text.match(/window\.__CSRF_TOKEN\s*=\s*("([^"]+)"|'([^']+)')/);
    const csrf = m ? (m[2] || m[3]) : '';

    // Reauth shart (requireRecentAuth) — reauth'siz 403
    const noReauth = await agent.post('/api/account/email/request').set('x-csrf-token', csrf).send({ newEmail: 'new@test.uz' });
    expect(noReauth.status).toBe(403);
    expect(noReauth.body.error).toBe('reauth_required');

    // Reauth
    const ra = await agent.post('/api/auth/reauth').set('x-csrf-token', csrf).send({ password: 'parol-2026-x-uzun' });
    expect(ra.status).toBe(200);

    // Request — yangi email'ga kod + eski email'ga token (dev/test preview)
    const req = await agent.post('/api/account/email/request').set('x-csrf-token', csrf).send({ newEmail: 'new@test.uz' });
    expect(req.status).toBe(200);
    expect(req.body.ok).toBe(true);
    expect(req.body.codePreview).toMatch(/^\d{6}$/);
    expect(req.body.oldTokenPreview).toHaveLength(64);

    // Confirm — noto'g'ri kod rad etiladi
    const bad = await agent.post('/api/account/email/confirm').set('x-csrf-token', csrf).send({ newCode: '000000', oldToken: req.body.oldTokenPreview });
    expect(bad.status).toBe(422);
    expect(bad.body.error).toBe('invalid_code');

    // Confirm — to'g'ri kod + token
    const confirm = await agent.post('/api/account/email/confirm').set('x-csrf-token', csrf).send({ newCode: req.body.codePreview, oldToken: req.body.oldTokenPreview });
    expect(confirm.status).toBe(200);
    expect(confirm.body.ok).toBe(true);

    // Email yangilandi
    const emailSnap = await fb.get(`users/${uname}/email`);
    expect(emailSnap.exists()).toBe(true);
    expect(emailSnap.val()).toBe('new@test.uz');

    // Eski email indeks tozalandi, yangisi indekslangan (safeKey transform)
    const oldIdx = await fb.get(`users_email_index/${safeKey(`${uname}@test.uz`)}`);
    expect(oldIdx.exists()).toBe(false);
    const newIdx = await fb.get(`users_email_index/${safeKey('new@test.uz')}`);
    expect(newIdx.exists()).toBe(true);

    // Event: email_change_requested + email_changed
    const events = await agent.get('/api/account/security-events');
    const types = events.body.events.map((e) => e.type);
    expect(types).toContain('email_changed');
    expect(types).toContain('email_change_requested');
  });

  it('email change: bir xil email / band email → rad', async () => {
    const agent = supertest.agent(app);
    const uname = `a29c_${Date.now() % 1000000}`;
    await registerUser(agent, uname);
    const m = (await agent.get('/user/panel')).text.match(/window\.__CSRF_TOKEN\s*=\s*("([^"]+)"|'([^']+)')/);
    const csrf = m ? (m[2] || m[3]) : '';
    await agent.post('/api/auth/reauth').set('x-csrf-token', csrf).send({ password: 'parol-2026-x-uzun' });

    // Joriy email bilan bir xil
    const same = await agent.post('/api/account/email/request').set('x-csrf-token', csrf).send({ newEmail: `${uname}@test.uz` });
    expect(same.status).toBe(400);
    expect(same.body.error).toBe('same_email');

    // Band email (boshqa user ro'yxatdan o'tgan)
    const other = supertest.agent(app);
    const otherName = `a29d_${Date.now() % 1000000}`;
    await registerUser(other, otherName);
    const taken = await agent.post('/api/account/email/request').set('x-csrf-token', csrf).send({ newEmail: `${otherName}@test.uz` });
    expect(taken.status).toBe(409);
    expect(taken.body.error).toBe('emailTaken');
  });

  it('breach flag → panel\'da breach banner (data-testid)', async () => {
    const agent = supertest.agent(app);
    const uname = `a29e_${Date.now() % 1000000}`;
    await registerUser(agent, uname);
    await fb.set(`users/${uname}/breach_flagged`, Date.now());

    await agent.get('/user/panel');
    const panel = await agent.get('/user/panel');
    expect(panel.status).toBe(200);
    expect(panel.text).toContain('data-testid="breach-banner"');
  });
});
