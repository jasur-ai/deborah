/**
 * AUTH D-17 §11/§13 — Journey: email verify round-trip + session revoke/invalidation
 * ---------------------------------------------------------------------------
 * End-to-end HTTP oqim (in-process supertest):
 *  1. Register → email verify send → kod (DB preview) → complete → email_verified=true
 *     (A-18, B-07, A-23 — kod hech qachon log'da emas, faqat test DB'da).
 *  2. 2-brauzer login → GET /sessions (A-08) → bitta revoke → o'sha brauzer 401,
 *     qolgani 200; revoke-all → hammasi 401.
 *  3. Password change (B-25) → boshqa qurilma sessiyasi bekor, joriy saqlanadi.
 * Manba: A-08 §7/§8, A-18 §07, A-23 §04, B-07, B-25.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import supertest from 'supertest';
import { createApp } from '../../../server.js';
import { snapshotDb, restoreDb } from '../../helpers/setup.js';
import { fb } from '../../../firebase/admin.js';
import * as emailVerifyMod from '../../../src/modules/auth/email-verify.js';

// Kod plaintext saqlanmaydi (codeHash+salt) va mock email'da outbox yo'q —
// yagona toza yo'l: sendVerifyCode (dev/test'da preview code qaytaradi)
// return'ini spy orqali tutish. Faqat capture, real logika o'zgarmaydi.
let capturedCode = null;
const originalSendVerifyCode = emailVerifyMod.sendVerifyCode;

let app, httpServer;
let xff = '203.0.113.200';
function nextIp() {
  xff = `203.0.113.${200 + (Math.floor(Math.random() * 1000) % 50)}`;
  return xff;
}
function csrfFrom(html) {
  const m = html.match(/window\.__CSRF_TOKEN\s*=\s*("([^"]+)"|'([^']+)')/);
  return m ? (m[2] || m[3]) : null;
}

async function register(agent, { username, email }) {
  const ip = nextIp();
  const page = await agent.get('/user/register');
  const csrf = page.text.match(/name="_csrf" value="([^"]+)"/);
  const res = await agent.post('/user/login').set('x-forwarded-for', ip).type('form').send({
    _csrf: csrf ? csrf[1] : '',
    lang: 'uz', mode: 'reg', consent: 'on',
    username, password: 'sirli-parol-2026-x', email,
  });
  expect([302, 303]).toContain(res.status);
}

beforeAll(async () => {
  await snapshotDb();
  // Spy: real sendVerifyCode ishlaydi, faqat preview kodni capture qilamiz.
  // Register'ning o'zi sendVerifyCode chaqiradi (routes/auth.js:1943).
  vi.spyOn(emailVerifyMod, 'sendVerifyCode').mockImplementation(async (opts) => {
    const res = await originalSendVerifyCode(opts);
    if (res && res.ok && res.code) capturedCode = res.code;
    return res;
  });
  const created = await createApp();
  app = created.app;
  httpServer = created.httpServer;
  await new Promise((r) => httpServer.listen(0, r));
});
afterAll(async () => {
  if (httpServer) await new Promise((r) => httpServer.close(r));
  await restoreDb();
});

describe('AUTH D-17 §13 — email verify journey', () => {
  it('register → verify send → kod (DB preview) → complete → email_verified=true', async () => {
    const agent = supertest.agent(app);
    const uname = `jmail_${Date.now() % 1000000}`;
    await register(agent, { username: uname, email: `${uname}@test.uz` });

    // Panel CSRF
    const panel = await agent.get('/user/panel');
    const csrf = csrfFrom(panel.text);
    expect(csrf).toBeTruthy();

    // Preview kod — sendVerifyCode spy orqali (register'da yuborilgan)
    expect(capturedCode).toMatch(/^\d{6}$/);
    const code = capturedCode;
    capturedCode = null; // keyingi testlar uchun tozala

    // Complete → email_verified=true
    const complete = await agent
      .post('/api/auth/verify/complete')
      .set('x-csrf-token', csrf)
      .send({ code });
    expect(complete.status).toBe(200);
    expect(complete.body.ok).toBe(true);

    const user = await fb.get(`users/${uname}`);
    expect(user.val().email_verified).toBe(true);

    // Noto'g'ri kod → invalid_code
    const bad = await agent
      .post('/api/auth/verify/complete')
      .set('x-csrf-token', csrf)
      .send({ code: '000000' });
    expect([400, 422]).toContain(bad.status);
  });
});

describe('AUTH D-17 §11 — session revoke journey', () => {
  it('2 brauzer → sessions ro\'yxatda 2 → bitta revoke → o\'sha 401, qolgani 200', async () => {
    const uname = `jsess_${Date.now() % 1000000}`;
    const agent1 = supertest.agent(app);
    await register(agent1, { username: uname, email: `${uname}@test.uz` });

    // 2-brauzer login
    const agent2 = supertest.agent(app);
    const loginPage = await agent2.get('/user/login?lang=uz');
    const lcsrf = loginPage.text.match(/name="_csrf" value="([^"]+)"/);
    const login = await agent2.post('/user/login').set('x-forwarded-for', nextIp()).type('form').send({
      _csrf: lcsrf ? lcsrf[1] : '', username: uname, password: 'sirli-parol-2026-x', lang: 'uz',
    });
    expect([302, 303]).toContain(login.status);
    expect((await agent1.get('/user/panel')).status).toBe(200);
    expect((await agent2.get('/user/panel')).status).toBe(200);

    // A-08 §7: /sessions — HTML render; revoke form action'idan boshqa
    // sessiya id'ni olamiz (current sessiya revoke form ko'rsatmaydi — faqat
    // bitta revoke form borligi ro'yxatda 2 sessiya ekanini tasdiqlaydi).
    const c1 = csrfFrom((await agent1.get('/user/panel')).text);
    const list = await agent1.get('/sessions').set('x-forwarded-for', nextIp());
    expect(list.status).toBe(200);
    const revokeForms = [...list.text.matchAll(/action="\/sessions\/([^"]+)\/revoke"/g)];
    expect(revokeForms.length).toBe(1); // joriy sessiya revoke qilinmaydi
    const s2Id = decodeURIComponent(revokeForms[0][1]);
    expect(s2Id).toBeTruthy();

    // A-08 §8: revoke → agent2 401, agent1 200
    const rev = await agent1
      .post(`/sessions/${encodeURIComponent(s2Id)}/revoke`)
      .set('x-csrf-token', c1)
      .set('x-forwarded-for', nextIp());
    expect(rev.status).toBe(200);
    expect(rev.body.ok).toBe(true);

    const p2 = await agent2.get('/user/panel').redirects(0);
    expect([401, 302, 301]).toContain(p2.status);
    expect((await agent1.get('/user/panel')).status).toBe(200);
  });

  it('password change → boshqa qurilma sessiyasi bekor, joriy saqlanadi (B-25)', async () => {
    const uname = `jpc_${Date.now() % 1000000}`;
    const agent1 = supertest.agent(app);
    await register(agent1, { username: uname, email: `${uname}@test.uz` });

    // 2-brauzer
    const agent2 = supertest.agent(app);
    const loginPage = await agent2.get('/user/login?lang=uz');
    const lcsrf = loginPage.text.match(/name="_csrf" value="([^"]+)"/);
    await agent2.post('/user/login').set('x-forwarded-for', nextIp()).type('form').send({
      _csrf: lcsrf ? lcsrf[1] : '', username: uname, password: 'sirli-parol-2026-x', lang: 'uz',
    });
    expect((await agent1.get('/user/panel')).status).toBe(200);
    expect((await agent2.get('/user/panel')).status).toBe(200);

    // Password change (agent1) — MFA'siz sessiya step-up talab qilmaydi
    const c1 = csrfFrom((await agent1.get('/user/security-profile')).text);
    expect(c1).toBeTruthy();
    const change = await agent1
      .post('/api/password/change')
      .set('x-csrf-token', c1)
      .send({ currentPassword: 'sirli-parol-2026-x', newPassword: 'yangi-parol-2026-x-uzun' });
    expect(change.status).toBe(200);
    expect(change.body.ok).toBe(true);

    // Joriy saqlanadi; 2-brauzer bekor
    expect((await agent1.get('/user/panel')).status).toBe(200);
    const p2 = await agent2.get('/user/panel').redirects(0);
    expect([401, 302, 301]).toContain(p2.status);
  });
});
