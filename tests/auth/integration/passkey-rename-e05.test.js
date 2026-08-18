/**
 * AUTH E-05 — Passkey multi-device boshqaruv: rename API
 * ---------------------------------------------------------------------------
 * Journey: register → reauth → passkey qo'shish → /api/passkey/rename:
 *  1. Owner o'z passkey nomini o'zgartiradi → status'da yangi nom ko'rinadi.
 *  2. Invalid nom (bo'sh / >50 belgi / control char) → 400 invalid_name.
 *  3. IDOR: boshqa user o'zgartira olmaydi → 404 (mavjudlik oshkor emas).
 *  4. Authsiz → 401; CSRF'siz → 403.
 * Manba: E-05 roadmap (multi-device credential boshqaruv).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import supertest from 'supertest';
import { createApp } from '../../../server.js';
import { snapshotDb, restoreDb } from '../../helpers/setup.js';
import {
  createKeyPair,
  createRegistrationResponse,
} from '../../helpers/webauthn-authenticator.js';

let app, httpServer;
let xff = '198.51.100.10';
function nextIp() {
  xff = `198.51.100.${10 + (Math.floor(Math.random() * 1000) % 40)}`;
  return xff;
}
function csrfFrom(html) {
  const m = html.match(/window\.__CSRF_TOKEN\s*=\s*("([^"]+)"|'([^']+)')/);
  return m ? (m[2] || m[3]) : null;
}
async function register(agent, uname, email) {
  const page = await agent.get('/user/register');
  const csrf = page.text.match(/name="_csrf" value="([^"]+)"/);
  return agent.post('/user/login').set('x-forwarded-for', nextIp()).type('form').send({
    _csrf: csrf ? csrf[1] : '',
    lang: 'uz', mode: 'reg',
    username: uname, password: 'sirli-parol-2026-x', email,
    consent: 'on', role: '',
  });
}

beforeAll(async () => {
  await snapshotDb();
  process.env.RP_ID = 'localhost';
  process.env.RP_ORIGIN = 'http://localhost:4568';
  const created = await createApp();
  app = created.app;
  httpServer = created.httpServer;
  await new Promise((r) => httpServer.listen(0, r));
});
afterAll(async () => {
  if (httpServer) await new Promise((r) => httpServer.close(r));
  await restoreDb();
});

async function registerPasskey(agent, csrf) {
  const opts = await agent.post('/api/passkey/register/options').set('x-csrf-token', csrf)
    .send({}).set('x-forwarded-for', nextIp());
  expect(opts.status).toBe(200);
  const pubKey = opts.body.options;
  const kp = createKeyPair();
  const response = createRegistrationResponse({
    rpId: opts.body.rpId || 'localhost',
    origin: opts.body.origin || 'http://localhost:4568',
    challenge: pubKey.challenge,
    publicKey: kp.publicKey,
    privateKey: kp.privateKey,
  });
  const payload = {
    id: response.id, rawId: response.rawId, response: response.response,
    type: 'public-key', clientExtensionResults: {},
  };
  const verify = await agent.post('/api/passkey/register/verify').set('x-csrf-token', csrf)
    .send({ response: payload }).set('x-forwarded-for', nextIp());
  expect(verify.status).toBe(200);
  expect(verify.body.ok).toBe(true);
  return verify.body.credential.id;
}

describe('AUTH E-05 — passkey rename (multi-device)', () => {
  it('owner passkey nomini ozgartiradi → status yangi nom korsatadi', async () => {
    const agent = supertest.agent(app);
    const uname = `prn_${Date.now() % 1000000}`;
    const email = `prn_${Date.now()}@test.uz`;
    const reg = await register(agent, uname, email);
    expect([302, 303]).toContain(reg.status);

    const panel = await agent.get('/user/panel');
    const csrf = csrfFrom(panel.text);
    expect(csrf).toBeTruthy();

    // Sensitive amal — reauth shart (A-25 §09)
    const noReauth = await agent.post('/api/passkey/register/options').set('x-csrf-token', csrf)
      .send({}).set('x-forwarded-for', nextIp());
    expect(noReauth.status).toBe(403);
    expect(noReauth.body.error).toBe('reauth_required');
    const reauth = await agent.post('/api/auth/reauth').set('x-csrf-token', csrf)
      .send({ password: 'sirli-parol-2026-x' }).set('x-forwarded-for', nextIp());
    expect(reauth.status).toBe(200);

    const credId = await registerPasskey(agent, csrf);

    // Rename
    const rename = await agent.post('/api/passkey/rename').set('x-csrf-token', csrf)
      .send({ credentialId: credId, name: '  MacBook Air M2  ' }).set('x-forwarded-for', nextIp());
    expect(rename.status).toBe(200);
    expect(rename.body.ok).toBe(true);
    expect(rename.body.credential.deviceName).toBe('MacBook Air M2');

    const status = await agent.get('/api/passkey/status').set('x-forwarded-for', nextIp());
    expect(status.body.ok).toBe(true);
    const mine = status.body.passkeys.find((p) => p.id === credId);
    expect(mine).toBeTruthy();
    expect(mine.deviceName).toBe('MacBook Air M2');
  });

  it('invalid nom → 400 invalid_name (bosh / uzun / control char)', async () => {
    const agent = supertest.agent(app);
    const uname = `prn2_${Date.now() % 1000000}`;
    const email = `prn2_${Date.now()}@test.uz`;
    const reg = await register(agent, uname, email);
    expect([302, 303]).toContain(reg.status);
    const panel = await agent.get('/user/panel');
    const csrf = csrfFrom(panel.text);
    await agent.post('/api/auth/reauth').set('x-csrf-token', csrf)
      .send({ password: 'sirli-parol-2026-x' }).set('x-forwarded-for', nextIp());
    const credId = await registerPasskey(agent, csrf);

    for (const bad of ['', '   ', 'x'.repeat(51), 'bad\u0000name', 'tab\tname']) {
      const r = await agent.post('/api/passkey/rename').set('x-csrf-token', csrf)
        .send({ credentialId: credId, name: bad }).set('x-forwarded-for', nextIp());
      expect(r.status).toBe(400);
      expect(r.body.error).toBe('invalid_name');
    }
    // Nom o'zgarmadi
    const status = await agent.get('/api/passkey/status').set('x-forwarded-for', nextIp());
    const mine = status.body.passkeys.find((p) => p.id === credId);
    expect(mine.deviceName).toBe('Qurilma');
  });

  it('IDOR: boshqa user nomini ozgartira olmaydi → 404', async () => {
    const victim = supertest.agent(app);
    const vu = `prnv_${Date.now() % 1000000}`;
    const vr = await register(victim, vu, `prnv_${Date.now()}@test.uz`);
    expect([302, 303]).toContain(vr.status);
    const vPanel = await victim.get('/user/panel');
    const vCsrf = csrfFrom(vPanel.text);
    await victim.post('/api/auth/reauth').set('x-csrf-token', vCsrf)
      .send({ password: 'sirli-parol-2026-x' }).set('x-forwarded-for', nextIp());
    const credId = await registerPasskey(victim, vCsrf);

    // Attacker — boshqa akkaunt
    const attacker = supertest.agent(app);
    const au = `prna_${Date.now() % 1000000}`;
    const ar = await register(attacker, au, `prna_${Date.now()}@test.uz`);
    expect([302, 303]).toContain(ar.status);
    const aPanel = await attacker.get('/user/panel');
    const aCsrf = csrfFrom(aPanel.text);
    // Attacker o'z parolini biladi — reauth'dan o'tadi, keyin IDOR tekshiriladi
    await attacker.post('/api/auth/reauth').set('x-csrf-token', aCsrf)
      .send({ password: 'sirli-parol-2026-x' }).set('x-forwarded-for', nextIp());

    const r = await attacker.post('/api/passkey/rename').set('x-csrf-token', aCsrf)
      .send({ credentialId: credId, name: 'Stolen' }).set('x-forwarded-for', nextIp());
    expect(r.status).toBe(404);
    expect(r.body.error).toBe('not_found');

    // Victim nomi o'zgarmadi
    const status = await victim.get('/api/passkey/status').set('x-forwarded-for', nextIp());
    const mine = status.body.passkeys.find((p) => p.id === credId);
    expect(mine.deviceName).toBe('Qurilma');
  });

  it('authsiz → blok (CSRF 403); CSRF siz → 403', async () => {
    // Authsiz so'rov: sessiya yo'q → global CSRF middleware birinchi bloklaydi (403)
    const anon = supertest.agent(app);
    const anonRes = await anon.post('/api/passkey/rename')
      .send({ credentialId: 'x', name: 'y' }).set('x-forwarded-for', nextIp());
    expect(anonRes.status).toBe(403);

    const agent = supertest.agent(app);
    const uname = `prn4_${Date.now() % 1000000}`;
    const reg = await register(agent, uname, `prn4_${Date.now()}@test.uz`);
    expect([302, 303]).toContain(reg.status);
    const noCsrf = await agent.post('/api/passkey/rename')
      .send({ credentialId: 'x', name: 'y' }).set('x-forwarded-for', nextIp());
    expect(noCsrf.status).toBe(403);
  });
});
