/**
 * Edikit — AUTH A-27: Passkey/WebAuthn integration tests
 *
 * Real kripto (tests/helpers/webauthn-authenticator) bilan to'liq flow:
 *   register (options → create → verify) → login (options → get → verify) →
 *   session → settings → security (replay/counter/origin/IDOR) → rate limit.
 *
 * RP derive qilinadi: supertest Host header'dan rpId=127.0.0.1,
 * origin=http://127.0.0.1:<port> — options va verify bir xil.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import supertest from 'supertest';
// Warm-up: webauthn.js endi @simplewebauthn/server'ni LAZY import qiladi;
// bu statik import birinchi passkey call'ining testTimeout (10s) dan
// oshishini oldini oladi (import grafi ~15s).
import '@simplewebauthn/server';
import { createApp } from '../../server.js';
import { snapshotDb, restoreDb } from '../helpers/setup.js';
import {
  createKeyPair,
  createRegistrationResponse,
  createAuthenticationResponse,
} from '../helpers/webauthn-authenticator.js';

// Counter — har chaqiruvda +1, 100–249 oralig'ida (per-IP limit boshqa testga yuqmaydi)
let ipCounter = 100;
function nextIp() {
  ipCounter = 100 + ((ipCounter - 100 + 1) % 150);
  return `203.0.113.${ipCounter}`;
}

let app;
let httpServer;

function csrfFrom(html) {
  const m = html.match(/name="_csrf" value="([^"]+)"/);
  return m ? m[1] : null;
}
function csrfFromPanel(html) {
  const t = html.match(/window\.__CSRF_TOKEN\s*=\s*("([^"]+)"|'([^']+)')/);
  return t ? (t[2] || t[3]) : '';
}

const PASSWORD = 'parol-2026-x-uzun';

async function registerUser(agent, username) {
  const page = await agent.get('/user/login?lang=uz');
  const csrf = csrfFrom(page.text);
  const res = await agent.post('/user/login')
    .set('x-forwarded-for', nextIp())
    .type('form')
    .send({ mode: 'reg', consent: 'on', _csrf: csrf, username, email: `${username}@test.uz`, password: PASSWORD, lang: 'uz' });
  return res;
}

async function login(username) {
  const fresh = supertest.agent(app);
  const page = await fresh.get('/user/login?lang=uz');
  const csrf = csrfFrom(page.text);
  const ip = nextIp();
  const res = await fresh.post('/user/login')
    .set('x-forwarded-for', ip)
    .type('form')
    .send({ _csrf: csrf, username, password: PASSWORD, lang: 'uz' });
  return { agent: fresh, res, ip };
}

/** requireRecentAuth uchun parolni qayta tasdiqlash (reauth). */
async function reauth(agent, csrf) {
  const r = await agent.post('/api/auth/reauth').set('x-csrf-token', csrf).send({ password: PASSWORD });
  return r;
}

/** To'liq passkey registratsiyasi — keypair'ni qaytaradi (login testlari uchun). */
async function registerPasskey(agent, csrf) {
  const o = await agent.post('/api/passkey/register/options').set('x-csrf-token', csrf).set('x-forwarded-for', nextIp()).send({});
  expect(o.status).toBe(200);
  expect(o.body.ok).toBe(true);
  const kp = createKeyPair();
  // origin server javobidan — supertest o'zining ichki portini ishlatadi
  const resp = createRegistrationResponse({ rpId: o.body.rpId, origin: o.body.origin, challenge: o.body.options.challenge, ...kp });
  const v = await agent.post('/api/passkey/register/verify').set('x-csrf-token', csrf).set('x-forwarded-for', nextIp()).send({ response: resp });
  expect(v.status).toBe(200);
  expect(v.body.ok).toBe(true);
  return { kp, credentialId: resp.id };
}

/** Anonim session + CSRF (public POST'lar ham global CSRF'dan o'tishi kerak). */
async function anonSession() {
  const agent = supertest.agent(app);
  const page = await agent.get('/user/login?lang=uz');
  return { agent, csrf: csrfFrom(page.text) };
}

/** Passkey login (userless/discoverable) — yangi agent bilan. */
async function passkeyLogin(kp, credentialId, counter = 1) {
  const { agent, csrf } = await anonSession();
  const o = await agent.post('/api/passkey/login/options')
    .set('x-csrf-token', csrf).set('x-forwarded-for', nextIp()).send({});
  expect(o.status).toBe(200);
  const assertion = createAuthenticationResponse({
    rpId: o.body.rpId, origin: o.body.origin, challenge: o.body.options.challenge,
    credId: Buffer.from(credentialId, 'base64url'),
    publicKey: kp.publicKey, privateKey: kp.privateKey, counter,
  });
  const v = await agent.post('/api/passkey/login/verify')
    .set('x-csrf-token', csrf).set('x-forwarded-for', nextIp()).send({ response: assertion });
  return { agent, v };
}

describe('AUTH A-27 — Passkey/WebAuthn flow', () => {
  beforeAll(async () => {
    await snapshotDb();
    // supertest har so'rovda yangi port ochadi (Test._prepare → app.listen(0));
    // rpId/origin barqaror bo'lishi uchun env override ishlatiladi.
    process.env.RP_ID = 'localhost';
    process.env.RP_ORIGIN = 'http://localhost:4567';
    ({ app, httpServer } = await createApp());
    await new Promise((r) => httpServer.listen(0, r));
  });
  afterAll(async () => {
    delete process.env.RP_ID;
    delete process.env.RP_ORIGIN;
    await restoreDb();
    await new Promise((r) => httpServer.close(r));
  });

  describe('Register flow', () => {
    it('reauth talab → options → verify → royxatda', async () => {
      const agent = supertest.agent(app);
      const uname = `a27r_${Date.now() % 1000000}`;
      await registerUser(agent, uname);
      const csrf = csrfFromPanel((await agent.get('/user/panel')).text);

      // requireRecentAuth: reauth'siz 403
      const before = await agent.post('/api/passkey/register/options').set('x-csrf-token', csrf).send({});
      expect(before.status).toBe(403);
      expect(before.body.error).toBe('reauth_required');

      await reauth(agent, csrf);

      const { credentialId } = await registerPasskey(agent, csrf);
      expect(credentialId).toBeTruthy();

      // status — ro'yxat
      const st = await agent.get('/api/passkey/status');
      expect(st.status).toBe(200);
      expect(st.body.ok).toBe(true);
      expect(st.body.count).toBe(1);
      expect(st.body.passkeys[0].id).toBe(credentialId);
    });

    it('registersiz (auth yoq) 401', async () => {
      const { agent, csrf } = await anonSession();
      const r = await agent.post('/api/passkey/register/options').set('x-csrf-token', csrf).send({});
      expect(r.status).toBe(401); // CSRF o'tadi, lekin requireAuth bloklaydi
    });
  });

  describe('Login flow (userless / Conditional UI)', () => {
    it('passkey bilan toliq login → session beriladi', async () => {
      const agent = supertest.agent(app);
      const uname = `a27l_${Date.now() % 1000000}`;
      await registerUser(agent, uname);
      const csrf = csrfFromPanel((await agent.get('/user/panel')).text);
      await reauth(agent, csrf);
      const { kp, credentialId } = await registerPasskey(agent, csrf);

      const { agent: loginAgent, v } = await passkeyLogin(kp, credentialId, 1);
      expect(v.status).toBe(200);
      expect(v.body.ok).toBe(true);
      expect(v.body.redirect).toBe('/user/panel');

      // Session haqiqatan ham berilgan
      const panel = await loginAgent.get('/user/panel');
      expect(panel.status).toBe(200);
    });
  });

  describe('Security', () => {
    async function setupUser(prefix) {
      const agent = supertest.agent(app);
      const uname = `${prefix}_${Date.now() % 1000000}`;
      await registerUser(agent, uname);
      const csrf = csrfFromPanel((await agent.get('/user/panel')).text);
      await reauth(agent, csrf);
      const { kp, credentialId } = await registerPasskey(agent, csrf);
      return { agent, csrf, kp, credentialId, uname };
    }

    it('assertion replay → 401 (challenge single-use)', async () => {
      const { kp, credentialId } = await setupUser('a27replay');

      // Birinchi login muvaffaqiyatli
      const { agent: a1, csrf: c1 } = await anonSession();
      const o1 = await a1.post('/api/passkey/login/options').set('x-csrf-token', c1).set('x-forwarded-for', nextIp()).send({});
      const assertion = createAuthenticationResponse({
        rpId: o1.body.rpId, origin: o1.body.origin, challenge: o1.body.options.challenge,
        credId: Buffer.from(credentialId, 'base64url'),
        publicKey: kp.publicKey, privateKey: kp.privateKey, counter: 1,
      });
      const v1 = await a1.post('/api/passkey/login/verify').set('x-csrf-token', c1).set('x-forwarded-for', nextIp()).send({ response: assertion });
      expect(v1.status).toBe(200);

      // Xuddi shu assertion bilan qayta urinish — challenge yo'q (consumed)
      const { agent: a2, csrf: c2 } = await anonSession();
      const v2 = await a2.post('/api/passkey/login/verify').set('x-csrf-token', c2).set('x-forwarded-for', nextIp()).send({ response: assertion });
      expect(v2.status).toBe(401);
      expect(v2.body.error).toBe('no_challenge');
    });

    it('counter regression (clone) → 401 counter_regression', async () => {
      const { kp, credentialId } = await setupUser('a27regr');
      const { v: v1 } = await passkeyLogin(kp, credentialId, 1);
      expect(v1.status).toBe(200);
      // Counter pasaytirib qayta login — stored counter endi 1
      const { v: v2 } = await passkeyLogin(kp, credentialId, 0);
      expect(v2.status).toBe(401);
      expect(v2.body.error).toBe('counter_regression');
    });

    it('counter replay (teng, stored>0) → 401 counter_replay', async () => {
      const { kp, credentialId } = await setupUser('a27repl');
      const { v: v1 } = await passkeyLogin(kp, credentialId, 1);
      expect(v1.status).toBe(200);
      const { v: v2 } = await passkeyLogin(kp, credentialId, 1);
      expect(v2.status).toBe(401);
      expect(v2.body.error).toBe('counter_replay');
    });

    it('cross-origin attestation/assertion → 401', async () => {
      const { kp, credentialId } = await setupUser('a27orig');
      const { agent, csrf } = await anonSession();
      const o = await agent.post('/api/passkey/login/options').set('x-csrf-token', csrf).set('x-forwarded-for', nextIp()).send({});
      const assertion = createAuthenticationResponse({
        rpId: o.body.rpId, origin: 'https://evil.example.com', challenge: o.body.options.challenge,
        credId: Buffer.from(credentialId, 'base64url'),
        publicKey: kp.publicKey, privateKey: kp.privateKey, counter: 1,
      });
      const v = await agent.post('/api/passkey/login/verify').set('x-csrf-token', csrf).set('x-forwarded-for', nextIp()).send({ response: assertion });
      expect(v.status).toBe(401);
    });

    it('IDOR: boshqa user passkeyini ochira olmaydi', async () => {
      const a = await setupUser('a27idor_a');
      const b = await setupUser('a27idor_b');

      const r = await b.agent.post('/api/passkey/remove').set('x-csrf-token', b.csrf).send({ credentialId: a.credentialId });
      expect(r.status).toBe(404); // forbidden → not_found
      // Hali bor
      const st = await a.agent.get('/api/passkey/status');
      expect(st.body.count).toBe(1);
    });

    it('remove (owner) — reauth talab + ishlaydi', async () => {
      const s = await setupUser('a27rm');
      const r = await s.agent.post('/api/passkey/remove').set('x-csrf-token', s.csrf).send({ credentialId: s.credentialId });
      expect(r.status).toBe(200);
      const st = await s.agent.get('/api/passkey/status');
      expect(st.body.count).toBe(0);
    });
  });

  describe('Rate limit', () => {
    it('login/options — 11-urinishda 429 (10/15min per IP)', async () => {
      const { agent, csrf } = await anonSession();
      const ip = nextIp();
      let last;
      for (let i = 0; i < 11; i++) {
        last = await agent.post('/api/passkey/login/options').set('x-csrf-token', csrf).set('x-forwarded-for', ip).send({});
        if (i < 10) expect(last.status).toBe(200);
      }
      expect(last.status).toBe(429);
      // Global middleware (C-01) 429: { code: 'RATE_LIMITED', retryAfter } —
      // A-03 lockout kontrakti. Route limiteri esa { error: 'rate-limited' }.
      expect(last.body.code === 'RATE_LIMITED' || last.body.error === 'rate-limited').toBe(true);
    });
  });
});
