/**
 * AUTH D-18 §07 — Security: session fixation + MFA bypass
 * ---------------------------------------------------------------------------
 * 1. Session fixation: login'da session ID ALBATTA o'zgaradi (regenerate —
 *    attacker cookie'sini o'rnatgan foydalanuvchi auth bo'lib qolmaydi).
 * 2. MFA bypass: MFA yoqilgan user parol bilan kirsa → sensitive amal
 *    (disable/backup rotate/passkey register) → 403 (step-up/re-auth talab).
 * 3. MFA challenge replay: bir marta ishlatilgan challenge qayta → 401
 *    (A-26 §10 qo'shimcha — bu yerda HTTP darajasida tasdiq).
 * Manba: A-02 §12 (regenerate), A-26 §10, A-25 §09, D-18 §07.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { fb } from '../../../firebase/admin.js';
import supertest from 'supertest';
import { createApp } from '../../../server.js';
import { snapshotDb, restoreDb } from '../../helpers/setup.js';
import { generate } from 'otplib';

let app, httpServer;
let xff = '203.0.113.220';
function nextIp() {
  xff = `203.0.113.${220 + (Math.floor(Math.random() * 1000) % 40)}`;
  return xff;
}
function csrfFrom(html) {
  const m = html.match(/name="_csrf" value="([^"]+)"/);
  return m ? m[1] : null;
}
function tokenFrom(html) {
  const m = html.match(/window\.__CSRF_TOKEN\s*=\s*("([^"]+)"|'([^']+)')/);
  return m ? (m[2] || m[3]) : null;
}

async function register(agent, { username, email }) {
  const page = await agent.get('/user/register');
  const csrf = page.text.match(/name="_csrf" value="([^"]+)"/);
  const res = await agent.post('/user/login').set('x-forwarded-for', nextIp()).type('form').send({
    _csrf: csrf ? csrf[1] : '',
    lang: 'uz', mode: 'reg', consent: 'on',
    username, password: 'sirli-parol-2026-x', email,
  });
  expect([302, 303]).toContain(res.status);
  // 2026-08-27: MFA faqat admin/o'qituvchi — test userini teacher'ga ko'tiramiz
  try { await fb.set(`users/${username}/role`, 'teacher'); } catch (_) {}
}

async function login(agent, username) {
  const page = await agent.get('/user/login?lang=uz');
  const csrf = csrfFrom(page.text);
  const res = await agent.post('/user/login').set('x-forwarded-for', nextIp()).type('form').send({
    _csrf: csrf, username, password: 'sirli-parol-2026-x', lang: 'uz',
  });
  expect([302, 303]).toContain(res.status);
}

beforeAll(async () => {
  await snapshotDb();
  const created = await createApp();
  app = created.app;
  httpServer = created.httpServer;
  await new Promise((r) => httpServer.listen(0, r));
});
afterAll(async () => {
  if (httpServer) await new Promise((r) => httpServer.close(r));
  await restoreDb();
});

describe('AUTH D-18 §07 — session fixation', () => {
  it('login' + "'" + 'dan keyin session cookie qiymati O' + "'" + 'ZGARADI (regenerate)', async () => {
    const agent = supertest.agent(app);
    const uname = `sfix_${Date.now() % 1000000}`;
    await register(agent, { username: uname, email: `${uname}@test.uz` });

    // Session cookie qiymatini login response set-cookie'dan olamiz
    const sidBefore = sessionCookieValue((await agent.get('/user/panel')).headers);
    expect(sidBefore).toBeTruthy();

    // Logout → yangi (anonim) sessiya
    await agent.get('/user/logout').redirects(0);

    // Login → yangi session ID (regenerate — fixation himoya)
    const loginRes = await doLogin(agent, uname);
    const sidAfter = sessionCookieValue(loginRes.headers);
    expect(sidAfter).toBeTruthy();
    expect(sidAfter).not.toBe(sidBefore);
  });

  it('attacker session cookie' + "'" + 'si bilan kirish → auth sessiya boshqa (yangi) ID oladi', async () => {
    // User alohida agent bilan register (attacker sessiyasidan ajratilgan)
    const uname = `sfix2_${Date.now() % 1000000}`;
    const creator = supertest.agent(app);
    await register(creator, { username: uname, email: `${uname}@test.uz` });

    // Pre-auth (attacker) sessiya — GET login sahifasi set-cookie beradi
    const attacker = supertest.agent(app);
    const page = await attacker.get('/user/login?lang=uz');
    const attackerSid = sessionCookieValue(page.headers);
    expect(attackerSid).toBeTruthy();

    // Attack cookie bilan login (attacker sessiyasi auth bo'lishi mumkin emas:
    // regenerate yangi ID beradi)
    const csrf = csrfFrom(page.text);
    const res = await attacker.post('/user/login').set('x-forwarded-for', nextIp()).type('form').send({
      _csrf: csrf, username: uname, password: 'sirli-parol-2026-x', lang: 'uz',
    });
    expect([302, 303]).toContain(res.status);
    const authSid = sessionCookieValue(res.headers);
    // Auth sessiya attacker'ning pre-auth sessiyasidan FARQ qiladi (regenerate)
    expect(authSid).toBeTruthy();
    expect(authSid).not.toBe(attackerSid);
  });
});

/** set-cookie header'laridan session cookie qiymatini ajratadi. */
function sessionCookieValue(headers) {
  const setCookie = headers['set-cookie'];
  if (!setCookie) return '';
  const arr = Array.isArray(setCookie) ? setCookie : [setCookie];
  const sid = arr.map((c) => c.split(';')[0]).find((kv) => kv.startsWith('connect.sid=') || kv.includes('.sid='));
  return sid ? sid.split('=').slice(1).join('=') : '';
}

/** Login (parol) — set-cookie bilan qaytadi. */
async function doLogin(agent, username) {
  const page = await agent.get('/user/login?lang=uz');
  const csrf = csrfFrom(page.text);
  const res = await agent.post('/user/login').set('x-forwarded-for', nextIp()).type('form').send({
    _csrf: csrf, username, password: 'sirli-parol-2026-x', lang: 'uz',
  });
  expect([302, 303]).toContain(res.status);
  return res;
}

describe('AUTH D-18 §07 — MFA bypass', () => {
  it('MFA yoqilgan user parol bilan kirsa → sensitive amal 403 (step-up)', async () => {
    const agent = supertest.agent(app);
    const uname = `smfa_${Date.now() % 1000000}`;
    await register(agent, { username: uname, email: `${uname}@test.uz` });

    // MFA enable
    const panel = await agent.get('/user/panel');
    const t = tokenFrom(panel.text);
    const setup = await agent.post('/api/mfa/totp/setup').set('x-csrf-token', t).send({});
    expect(setup.status).toBe(200);
    const code = await generate({ secret: setup.body.secret });
    const enable = await agent.post('/api/mfa/totp/enable').set('x-csrf-token', t).send({ token: code });
    expect(enable.status).toBe(200);

    // Logout → parol bilan login (MFA'siz)
    await agent.get('/user/logout').redirects(0);
    await login(agent, uname);

    // Sensitive amal: MFA disable → 403 (step-up talab — A-25 §09)
    const t2 = tokenFrom((await agent.get('/user/panel')).text);
    const dis = await agent.post('/api/mfa/totp/disable').set('x-csrf-token', t2).send({});
    expect(dis.status).toBe(403);

    // Passkey register/options ham sensitive → 403
    const opt = await agent.post('/api/passkey/register/options').set('x-csrf-token', t2).send({});
    expect(opt.status).toBe(403);
  });

  it('MFA challenge replay → 401 (single-use)', async () => {
    const agent = supertest.agent(app);
    const uname = `smfa2_${Date.now() % 1000000}`;
    await register(agent, { username: uname, email: `${uname}@test.uz` });

    // MFA enable
    const panel = await agent.get('/user/panel');
    const t = tokenFrom(panel.text);
    const setup = await agent.post('/api/mfa/totp/setup').set('x-csrf-token', t).send({});
    const code = await generate({ secret: setup.body.secret });
    await agent.post('/api/mfa/totp/enable').set('x-csrf-token', t).send({ token: code });

    // Logout → login → MFA challenge
    await agent.get('/user/logout').redirects(0);
    const lp = await agent.get('/user/login?lang=uz');
    const csrf = csrfFrom(lp.text);
    const res = await agent.post('/user/login').set('x-forwarded-for', nextIp()).type('form').send({
      _csrf: csrf, username: uname, password: 'sirli-parol-2026-x', lang: 'uz',
    });
    // MFA yoqilgan → challenge sahifasiga redirect
    expect([302, 303]).toContain(res.status);
    expect(res.headers.location || '').toContain('/user/mfa');

    // Challenge ID redirect query'dan + sahifadagi CSRF
    const challengeId = (res.headers.location || '').match(/challenge=([A-Za-z0-9_-]+)/)?.[1];
    expect(challengeId).toBeTruthy();
    const mfaPage = await agent.get(res.headers.location);
    const mcsrf = tokenFrom(mfaPage.text) || mfaPage.text.match(/name="_csrf" value="([^"]+)"/)?.[1];
    const okCode = await generate({ secret: setup.body.secret });
    const v1 = await agent.post('/api/mfa/verify').set('x-csrf-token', mcsrf).send({ code: okCode, challengeId });
    expect([200, 302]).toContain(v1.status);

    // Replay: xuddi shu challenge qayta → 401 (consume qilingan / no_pending).
    // Muvaffaqiyatli verify session'ni regenerate qildi — yangi CSRF kerak.
    const freshCsrf = tokenFrom((await agent.get('/user/panel')).text);
    const v2 = await agent.post('/api/mfa/verify').set('x-csrf-token', freshCsrf).send({ code: okCode, challengeId });
    expect([401, 400]).toContain(v2.status);
  });
});
