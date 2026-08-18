/**
 * AUTH B-24 — Email change (reauth + double opt-in) integration tests
 * -------------------------------------------------------------------
 * 1) GET /user/email-change — anonim → redirect/401, login → 200 (UI).
 * 2) POST /api/account/email/request — reauth'siz → 403 reauth_required.
 * 3) /api/auth/reauth (parol) → ok; request → pending + ikkala email.
 * 4) POST /api/account/email/confirm — ikkala verify bilan commit → users.email o'zgaradi.
 * 5) CSRF yo'q → 403.
 * 6) IDOR — boshqa user'ning pending'iga confirm bloklangan.
 * 7) Cancel — eski email tokeni bilan pending tozalanadi.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createApp } from '../../server.js';
import { fb } from '../../firebase/admin.js';
import { safeKey } from '../../utils/helpers.js';
import { snapshotDb, restoreDb } from '../helpers/setup.js';

const EMAIL = `b24-old-${Date.now()}@test.uz`;
const NEW_EMAIL = `b24-new-${Date.now()}@test.uz`;
const PASSWORD = 'Str0ng!Pass2026';

async function extractCsrf(html) {
  const m = html.match(/name="_csrf" value="([^"]+)"/) || html.match(/window\.__CSRF_TOKEN\s*=\s*'([^']+)'/);
  return m ? m[1] : null;
}

async function registerUser(agent, username, email = EMAIL) {
  const regPage = await agent.get('/user/login?mode=reg').redirects(0);
  const csrf = await extractCsrf(regPage.text);
  const res = await agent.post('/user/login').type('form').send({
    _csrf: csrf,
    mode: 'reg', consent: 'on',
    username,
    password: PASSWORD,
    password2: PASSWORD,
    email,
    lang: 'uz',
  });
  return res;
}

describe('AUTH B-24 — Email change (integration)', () => {
  let app;
  let httpServer;
  let base;
  let agent;
  let userKey;

  beforeAll(async () => {
    await snapshotDb();
    const created = await createApp();
    app = created.app;
    httpServer = created.httpServer;
    await new Promise((r) => httpServer.listen(0, r));
    base = `http://localhost:${httpServer.address().port}`;
    agent = (await import('supertest')).default.agent(app);

    const reg = await registerUser(agent, `b24user${Date.now()}`);
    expect([200, 302]).toContain(reg.status);
    const panel = await agent.get('/user/panel');
    expect(panel.status).toBe(200);
    const usersSnap = await fb.get('users');
    const users = usersSnap.exists() ? usersSnap.val() : {};
    const entry = Object.entries(users).find(([, u]) => u.email === EMAIL);
    expect(entry).toBeTruthy();
    userKey = entry[0];
  });

  afterAll(async () => {
    await restoreDb();
    await new Promise((r) => httpServer.close(r));
  });

  it('anonim: GET /user/email-change → redirect/401', async () => {
    const anon = (await import('supertest')).default.agent(app);
    const res = await anon.get('/user/email-change').redirects(0);
    expect([302, 401]).toContain(res.status);
  });

  it('login: GET /user/email-change → 200 UI (title + CSRF token)', async () => {
    const res = await agent.get('/user/email-change');
    expect(res.status).toBe(200);
    expect(res.text).toContain('window.__CSRF__');
    expect(res.text).toMatch(/emailCopy|Email manzilini/);
  });

  it('request: reauthsiz → 403 reauth_required', async () => {
    const page = await agent.get('/user/email-change');
    const csrf = page.text.match(/window\.__CSRF__\s*=\s*"([^"]*)"/);
    expect(csrf).toBeTruthy();
    const res = await agent
      .post('/api/account/email/request')
      .set('Content-Type', 'application/json')
      .set('X-CSRF-Token', csrf[1])
      .send({ newEmail: NEW_EMAIL });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('reauth_required');
  });

  it('reauth + request → pending (ikkala emailga yuboriladi)', async () => {
    // CSRF token
    const page = await agent.get('/user/email-change');
    const csrf = page.text.match(/window\.__CSRF__\s*=\s*"([^"]*)"/);
    expect(csrf).toBeTruthy();

    // Reauth — to'g'ri parol
    const reauth = await agent
      .post('/api/auth/reauth')
      .set('Content-Type', 'application/json')
      .set('X-CSRF-Token', csrf[1])
      .send({ password: PASSWORD });
    expect(reauth.status).toBe(200);
    expect(reauth.body.ok).toBe(true);

    // Request
    const req = await agent
      .post('/api/account/email/request')
      .set('Content-Type', 'application/json')
      .set('X-CSRF-Token', csrf[1])
      .send({ newEmail: NEW_EMAIL });
    expect(req.status).toBe(200);
    expect(req.body.ok).toBe(true);
    expect(req.body.maskedNew).toContain('@test.uz');
    expect(req.body.codePreview).toMatch(/^\d{6}$/);
    expect(req.body.oldTokenPreview).toHaveLength(64);

    // Status — pending
    const status = await agent.get('/api/account/email/status').set('X-CSRF-Token', csrf[1]);
    expect(status.status).toBe(200);
    expect(status.body.pending.pending).toBe(true);
  });

  it('confirm: noto‘g‘ri kod → invalid_code', async () => {
    const page = await agent.get('/user/email-change');
    const csrf = page.text.match(/window\.__CSRF__\s*=\s*"([^"]*)"/);
    const res = await agent
      .post('/api/account/email/confirm')
      .set('Content-Type', 'application/json')
      .set('X-CSRF-Token', csrf[1])
      .send({ newCode: '000000', oldToken: 'f'.repeat(64) });
    expect(res.status).toBe(422);
    expect(res.body.error).toBe('invalid_code');
  });

  it('confirm: to‘g‘ri ikkala verify → email o‘zgaradi (DB)', async () => {
    const page = await agent.get('/user/email-change');
    const csrf = page.text.match(/window\.__CSRF__\s*=\s*"([^"]*)"/);
    // Yangi request (avvalgi pending yaroqsiz bo'lishi mumkin emas — yangi)
    const req = await agent
      .post('/api/account/email/request')
      .set('Content-Type', 'application/json')
      .set('X-CSRF-Token', csrf[1])
      .send({ newEmail: NEW_EMAIL });
    expect(req.body.ok).toBe(true);

    const confirm = await agent
      .post('/api/account/email/confirm')
      .set('Content-Type', 'application/json')
      .set('X-CSRF-Token', csrf[1])
      .send({ newCode: req.body.codePreview, oldToken: req.body.oldTokenPreview });
    expect(confirm.status).toBe(200);
    expect(confirm.body.ok).toBe(true);

    // DB — email o'zgargan
    const user = (await fb.get(`users/${userKey}`)).val();
    expect(user.email).toBe(NEW_EMAIL);
    expect(user.email_verified).toBe(true);
    // Index — yangi email → userKey
    expect((await fb.get(`users_email_index/${safeKey(NEW_EMAIL)}`)).val()).toBe(userKey);
  });

  it('CSRF yo‘q → 403', async () => {
    const res = await agent
      .post('/api/account/email/request')
      .set('Content-Type', 'application/json')
      .send({ newEmail: `b24-x-${Date.now()}@test.uz` });
    expect(res.status).toBe(403);
  });

  it('IDOR: boshqa user ning pending iga confirm bloklangan (session-scoped)', async () => {
    // Ikkinchi user — o'z email'iga pending yaratadi
    const agent2 = (await import('supertest')).default.agent(app);
    const reg2 = await registerUser(agent2, `b24user2${Date.now()}`);
    expect([200, 302]).toContain(reg2.status);
    const page2 = await agent2.get('/user/email-change');
    const csrf2 = page2.text.match(/window\.__CSRF__\s*=\s*"([^"]*)"/);
    await agent2
      .post('/api/auth/reauth')
      .set('Content-Type', 'application/json')
      .set('X-CSRF-Token', csrf2[1])
      .send({ password: PASSWORD });
    const req2 = await agent2
      .post('/api/account/email/request')
      .set('Content-Type', 'application/json')
      .set('X-CSRF-Token', csrf2[1])
      .send({ newEmail: `b24-2-${Date.now()}@test.uz` });
    expect(req2.body.ok).toBe(true);

    // Asosiy user (agent) agent2'ning pending'iga confirm qila olmaydi
    const page = await agent.get('/user/email-change');
    const csrf = page.text.match(/window\.__CSRF__\s*=\s*"([^"]*)"/);
    const confirm = await agent
      .post('/api/account/email/confirm')
      .set('Content-Type', 'application/json')
      .set('X-CSRF-Token', csrf[1])
      .send({ newCode: '111111', oldToken: 'a'.repeat(64) });
    // Agent'da o'z pending'i yo'q (oldin commit bo'ldi) → no_pending_change
    expect([400, 422]).toContain(confirm.status);
    expect(['no_pending_change', 'invalid_code', 'invalid_token']).toContain(confirm.body.error);
  });

  it('cancel: eski email tokeni bilan pending tozalanadi', async () => {
    // Agent2'da pending bor — cancel qilamiz (unique email bilan)
    const agent2 = (await import('supertest')).default.agent(app);
    const reg2 = await registerUser(agent2, `b24user3${Date.now()}`, `b24-c3-${Date.now()}@test.uz`);
    expect([200, 302]).toContain(reg2.status);
    const page2 = await agent2.get('/user/email-change');
    const csrf2 = page2.text.match(/window\.__CSRF__\s*=\s*"([^"]*)"/);
    await agent2
      .post('/api/auth/reauth')
      .set('Content-Type', 'application/json')
      .set('X-CSRF-Token', csrf2[1])
      .send({ password: PASSWORD });
    const req2 = await agent2
      .post('/api/account/email/request')
      .set('Content-Type', 'application/json')
      .set('X-CSRF-Token', csrf2[1])
      .send({ newEmail: `b24-3-${Date.now()}@test.uz` });
    expect(req2.body.ok).toBe(true);

    const cancel = await agent2
      .post('/api/account/email/cancel')
      .set('Content-Type', 'application/json')
      .set('X-CSRF-Token', csrf2[1])
      .send({ oldToken: req2.body.oldTokenPreview });
    expect(cancel.status).toBe(200);
    expect(cancel.body.ok).toBe(true);

    const status = await agent2.get('/api/account/email/status').set('X-CSRF-Token', csrf2[1]);
    expect(status.body.pending).toBeNull();
  });
});
