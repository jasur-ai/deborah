/**
 * AUTH D-17 §08/§10 — Journey: register → MFA enable → login+MFA challenge → panel;
 * passkey register/verify (A-26/A-27)
 * ---------------------------------------------------------------------------
 * End-to-end HTTP oqim (in-process supertest — child server emas, flake yo'q):
 *  1. Register → avtomatik login → panel.
 *  2. MFA setup (secret) → enable (birinchi TOTP) → status active.
 *  3. Logout → login → MFA challenge (redirect /user/mfa) → TOTP → panel.
 *  4. Noto'g'ri MFA kodi → 403 (challenge saqlanadi).
 *  5. Passkey: register/options → real authenticator response → register/verify.
 * Manba: A-26 §10/§12, A-27, D-17.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import supertest from 'supertest';
import { createApp } from '../../../server.js';
import { snapshotDb, restoreDb } from '../../helpers/setup.js';
import { generate } from 'otplib';
import {
  createKeyPair,
  createRegistrationResponse,
} from '../../helpers/webauthn-authenticator.js';

let app, httpServer;
let xff = '203.0.113.150';
function nextIp() {
  xff = `203.0.113.${150 + (Math.floor(Math.random() * 1000) % 50)}`;
  return xff;
}
function csrfFrom(html) {
  const m = html.match(/window\.__CSRF_TOKEN\s*=\s*("([^"]+)"|'([^']+)')/);
  return m ? (m[2] || m[3]) : null;
}
async function register(agent, { username, email, role = '', extra = {} }) {
  const ip = nextIp();
  const page = await agent.get('/user/register');
  const csrf = page.text.match(/name="_csrf" value="([^"]+)"/);
  const body = {
    _csrf: csrf ? csrf[1] : '',
    lang: 'uz', mode: 'reg',
    username, password: 'sirli-parol-2026-x', email,
    consent: 'on', role,
    ...extra,
  };
  return agent.post('/user/login').set('x-forwarded-for', ip).type('form').send(body);
}

beforeAll(async () => {
  await snapshotDb();
  // Barqaror rpId/origin — a27 bilan bir xil pattern (supertest port o'zgaruvchan)
  process.env.RP_ID = 'localhost';
  process.env.RP_ORIGIN = 'http://localhost:4567';
  const created = await createApp();
  app = created.app;
  httpServer = created.httpServer;
  await new Promise((r) => httpServer.listen(0, r));
});
afterAll(async () => {
  if (httpServer) await new Promise((r) => httpServer.close(r));
  await restoreDb();
});

describe('AUTH D-17 §08 — MFA journey', () => {
  it('register → MFA enable → login challenge → TOTP → panel', async () => {
    const agent = supertest.agent(app);
    const uname = `jmfa_${Date.now() % 1000000}`;
    const email = `jmfa_${Date.now()}@test.uz`;
    const reg = await register(agent, { username: uname, email });
    expect([302, 303]).toContain(reg.status);

    // MFA setup — secret olamiz
    const panel = await agent.get('/user/panel');
    const csrf = csrfFrom(panel.text);
    expect(csrf).toBeTruthy();
    const setup = await agent
      .post('/api/mfa/totp/setup').set('x-csrf-token', csrf)
      .send({}).set('x-forwarded-for', nextIp());
    expect(setup.status).toBe(200);
    expect(setup.body.ok).toBe(true);
    expect(setup.body.secret).toMatch(/^[A-Z2-7]+$/);

    // Birinchi TOTP kod bilan enable
    const code = await generate({ secret: setup.body.secret });
    const enable = await agent
      .post('/api/mfa/totp/enable').set('x-csrf-token', csrf)
      .send({ token: code }).set('x-forwarded-for', nextIp());
    expect(enable.status).toBe(200);
    expect(enable.body.ok).toBe(true);
    expect(enable.body.backupCodes).toHaveLength(10);

    const status = await agent.get('/api/mfa/status').set('x-forwarded-for', nextIp());
    expect(status.body.status).toBe('active');

    // Logout → login → MFA challenge
    await agent.get('/user/logout');
    const loginPage = await agent.get('/user/login');
    const loginCsrf = loginPage.text.match(/name="_csrf" value="([^"]+)"/);
    const login = await agent
      .post('/user/login').set('x-forwarded-for', nextIp()).type('form')
      .send({ _csrf: loginCsrf ? loginCsrf[1] : '', lang: 'uz', mode: 'login', username: uname, password: 'sirli-parol-2026-x' });
    expect([302, 303]).toContain(login.status);
    // MFA challenge sahifasiga redirect (challengeId query'da)
    expect(login.headers.location || '').toMatch(/\/user\/mfa/);

    // Challenge ID'ni MFA sahifasidan olamiz
    const mfaPage = await agent.get(login.headers.location);
    const challengeMatch = (login.headers.location || '').match(/challenge=([A-Za-z0-9_-]+)/);
    const challengeId = challengeMatch ? challengeMatch[1] : null;
    const mfaCsrf = mfaPage.text.match(/name="_csrf" value="([^"]+)"/);
    expect(challengeId).toBeTruthy();

    // To'g'ri TOTP → session beriladi
    const okCode = await generate({ secret: setup.body.secret });
    const verify = await agent
      .post('/api/mfa/verify').set('x-csrf-token', mfaCsrf ? mfaCsrf[1] : '')
      .send({ code: okCode, challengeId }).set('x-forwarded-for', nextIp());
    expect([200, 302]).toContain(verify.status);
    expect(verify.body.ok).toBe(true);

    const panel2 = await agent.get('/user/panel');
    expect([200, 302]).toContain(panel2.status);
    expect(panel2.status).toBe(200);
  });

  it('noto\'g\'ri MFA kodi → 403 (challenge saqlanadi, single-use faqat muvaffaqiyatda)', async () => {
    const agent = supertest.agent(app);
    const uname = `jmfab_${Date.now() % 1000000}`;
    const email = `jmfab_${Date.now()}@test.uz`;
    await register(agent, { username: uname, email });

    const panel = await agent.get('/user/panel');
    const csrf = csrfFrom(panel.text);
    const setup = await agent.post('/api/mfa/totp/setup').set('x-csrf-token', csrf).send({}).set('x-forwarded-for', nextIp());
    const code = await generate({ secret: setup.body.secret });
    await agent.post('/api/mfa/totp/enable').set('x-csrf-token', csrf).send({ token: code }).set('x-forwarded-for', nextIp());

    await agent.get('/user/logout');
    const lp = await agent.get('/user/login');
    const lcs = lp.text.match(/name="_csrf" value="([^"]+)"/);
    const login = await agent.post('/user/login').set('x-forwarded-for', nextIp()).type('form')
      .send({ _csrf: lcs ? lcs[1] : '', lang: 'uz', mode: 'login', username: uname, password: 'sirli-parol-2026-x' });
    const challengeId = (login.headers.location || '').match(/challenge=([A-Za-z0-9_-]+)/)?.[1];
    const mfaPage = await agent.get(login.headers.location);
    const mcs = mfaPage.text.match(/name="_csrf" value="([^"]+)"/);

    const bad = await agent.post('/api/mfa/verify').set('x-csrf-token', mcs ? mcs[1] : '')
      .send({ code: '000000', challengeId }).set('x-forwarded-for', nextIp());
    expect(bad.status).toBe(403);

    // Challenge hali valid — to'g'ri kod bilan o'tadi (xato urinish challenge'ni o'chirmaydi)
    const okCode = await generate({ secret: setup.body.secret });
    const good = await agent.post('/api/mfa/verify').set('x-csrf-token', mcs ? mcs[1] : '')
      .send({ code: okCode, challengeId }).set('x-forwarded-for', nextIp());
    expect(good.body.ok).toBe(true);
  });
});

describe('AUTH D-17 §10 — passkey register journey', () => {
  it('register/options → authenticator response → register/verify → status hasPasskeys', async () => {
    const agent = supertest.agent(app);
    const uname = `jpk_${Date.now() % 1000000}`;
    const email = `jpk_${Date.now()}@test.uz`;
    const reg = await register(agent, { username: uname, email });
    expect([302, 303]).toContain(reg.status);

    const panel = await agent.get('/user/panel');
    const csrf = csrfFrom(panel.text);
    expect(csrf).toBeTruthy();

    // A-25 §09: passkey qo'shish sensitive — parol reauth majburiy (403 reauth_required)
    const noReauth = await agent.post('/api/passkey/register/options').set('x-csrf-token', csrf)
      .send({}).set('x-forwarded-for', nextIp());
    expect(noReauth.status).toBe(403);
    expect(noReauth.body.error).toBe('reauth_required');

    const reauth = await agent.post('/api/auth/reauth').set('x-csrf-token', csrf)
      .send({ password: 'sirli-parol-2026-x' }).set('x-forwarded-for', nextIp());
    expect(reauth.status).toBe(200);
    expect(reauth.body.ok).toBe(true);

    // 1) Registration options (challenge + rp + user)
    const opts = await agent.post('/api/passkey/register/options').set('x-csrf-token', csrf)
      .send({}).set('x-forwarded-for', nextIp());
    expect(opts.status).toBe(200);
    expect(opts.body.ok).toBe(true);
    // options — WebAuthn publicKey'ning o'zi (generateRegistrationOptions natijasi)
    const pubKey = opts.body.options;
    expect(pubKey).toBeTruthy();
    const challengeB64 = pubKey.challenge;

    // 2) Haqiqiy (test) authenticator javobini quramiz
    const rpId = opts.body.rpId || 'localhost';
    const origin = opts.body.origin || 'http://localhost:4567';
    const kp = createKeyPair();
    const response = createRegistrationResponse({
      rpId,
      origin,
      challenge: challengeB64,
      publicKey: kp.publicKey,
      privateKey: kp.privateKey,
    });
    const payload = {
      id: response.id,
      rawId: response.rawId,
      response: response.response,
      type: 'public-key',
      clientExtensionResults: {},
    };

    // 3) Verify — passkey saqlanadi
    const verifyRes = await agent.post('/api/passkey/register/verify').set('x-csrf-token', csrf)
      .send({ response: payload }).set('x-forwarded-for', nextIp());
    expect(verifyRes.status).toBe(200);
    expect(verifyRes.body.ok).toBe(true);

    // 4) Status — passkey ro'yxatda
    const status = await agent.get('/api/passkey/status').set('x-forwarded-for', nextIp());
    expect(status.body.ok).toBe(true);
    expect(status.body.count).toBeGreaterThanOrEqual(1);
  });
});
