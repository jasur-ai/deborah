/**
 * S35 — ADMIN PASSKEY LOGIN: /admin/login sahifasidan parolsiz kirish
 * ---------------------------------------------------------------------------
 * Qamrab oladi:
 *  1. /admin/login sahifasida passkey blok + admin-passkey-login.js mavjud.
 *  2. Passkey o'rnatilmagan: status → available:false; options → 400 not_setup.
 *  3. To'liq oqim: parol login → reauth → profil passkey registratsiya
 *     (admin:{username}) → yangi sessiya: status → login/options
 *     (allowCredentials) → haqiqiy assertion → login/verify → admin sessiya
 *     grant → /admin/dashboard 200.
 *  4. Boshqa hisob passkeyi bilan admin verify → 403 wrong_owner.
 *  5. S35 FIX regressiyasi: admin passkey 'admin:{ADMIN_USER}' bo'yicha
 *     topiladi (avval qat'iy 'admin:admin' qidirardi).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import supertest from 'supertest';
import { createApp } from '../../../server.js';
import { snapshotDb, restoreDb } from '../../helpers/setup.js';
import {
  createKeyPair,
  createRegistrationResponse,
  createAuthenticationResponse,
} from '../../helpers/webauthn-authenticator.js';

let app, httpServer;
let xff = '198.51.100.10';
function nextIp() {
  xff = `198.51.100.${10 + (Math.floor(Math.random() * 1000) % 40)}`;
  return xff;
}

function csrfFromForm(html) {
  const m = html.match(/name="_csrf" value="([^"]+)"/);
  return m ? m[1] : null;
}
function csrfFromScript(html) {
  const m = html.match(/window\.__CSRF_TOKEN\s*=\s*'([^']+)'|var CSRF = '([^']+)'/);
  return m ? (m[1] || m[2]) : null;
}
function b64urlToBuf(s) {
  return Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

async function adminPasswordLogin(agent) {
  const page = await agent.get('/admin/login').set('x-forwarded-for', nextIp());
  const tok = csrfFromForm(page.text);
  const res = await agent.post('/admin/login').set('x-forwarded-for', nextIp())
    .type('form')
    .send({ _csrf: tok || '', username: 'testadmin', password: 'testpass' });
  return res;
}

/** Admin parol sessiyasini ochib, passkey qo'shilganiga ishonch hosil qiladi. */
async function ensureAdminPasskey(agent) {
  const login = await adminPasswordLogin(agent);
  expect([302, 303]).toContain(login.status);
  const profile = await agent.get('/admin/profile').set('x-forwarded-for', nextIp());
  expect(profile.status).toBe(200);
  const tok = csrfFromScript(profile.text);
  expect(tok).toBeTruthy();

  const list = await agent.get('/api/admin/profile/passkeys')
    .set('x-forwarded-for', nextIp());
  if (list.body && list.body.count > 0) return { tok, registered: false };

  const reauth = await agent.post('/api/admin/reauth')
    .set('x-csrf-token', tok).send({ password: 'testpass' })
    .set('x-forwarded-for', nextIp());
  expect(reauth.status).toBe(200);
  expect(reauth.body.ok).toBe(true);

  const opts = await agent.post('/api/admin/profile/passkey/options')
    .set('x-csrf-token', tok).send({}).set('x-forwarded-for', nextIp());
  expect(opts.status).toBe(200);
  expect(opts.body.ok).toBe(true);
  const pubKey = opts.body.options;

  const kp = createKeyPair();
  const reg = createRegistrationResponse({
    rpId: 'localhost',
    origin: 'http://localhost:4567',
    challenge: pubKey.challenge,
    publicKey: kp.publicKey,
    privateKey: kp.privateKey,
  });
  const vr = await agent.post('/api/admin/profile/passkey/verify')
    .set('x-csrf-token', tok).send(reg) // admin API body = response obyektning O'ZI (wrapper yo'q)
    .set('x-forwarded-for', nextIp());
  expect(vr.status).toBe(200);
  expect(vr.body.ok).toBe(true);
  return { tok, registered: true, kp, reg };
}

beforeAll(async () => {
  await snapshotDb();
  // Barqaror rpId/origin — boshqa testlar bilan bir xil pattern
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

describe('S35 — admin login sahifasi (UI)', () => {
  it('passkey blok va skript login sahifasida bor', async () => {
    const agent = supertest.agent(app);
    const page = await agent.get('/admin/login').set('x-forwarded-for', nextIp());
    expect(page.status).toBe(200);
    expect(page.text).toContain('id="admin-passkey-login"');
    expect(page.text).toContain('id="admin-passkey-login-btn"');
    expect(page.text).toContain('/js/admin-passkey-login.js');
  });
});

describe('S35 — passkey o\'rnatilmagan holat', () => {
  it('status available:false; options → 400 not_setup', async () => {
    const agent = supertest.agent(app);
    const page = await agent.get('/admin/login').set('x-forwarded-for', nextIp());
    const tok = csrfFromForm(page.text);

    const status = await agent.get('/api/admin/passkey/login/status')
      .set('x-forwarded-for', nextIp());
    expect(status.status).toBe(200);
    expect(status.body.ok).toBe(true);
    expect(status.body.available).toBe(false);

    const opts = await agent.post('/api/admin/passkey/login/options')
      .set('x-csrf-token', tok || '').send({}).set('x-forwarded-for', nextIp());
    expect(opts.status).toBe(400);
    expect(opts.body.error).toBe('not_setup');
  });
});

describe('S35 — admin passkey bilan to\'g\'ridan-to\'g\'ri kirish (to\'liq oqim)', () => {
  it('profil passkey qo\'shish → yangi sessiyada passkey login → dashboard', async () => {
    // Admin passkey tayyorlaymiz
    const adminAgent = supertest.agent(app);
    const { kp, reg, registered } = await ensureAdminPasskey(adminAgent);
    if (!registered) throw new Error('test bazasida admin passkey oldindan bor — toza DB kutilgan edi');

    // ── YANGI sessiya: passkey bilan kirish ──
    const fresh = supertest.agent(app);
    const page = await fresh.get('/admin/login').set('x-forwarded-for', nextIp());
    const tok2 = csrfFromForm(page.text);
    expect(tok2).toBeTruthy();

    const status = await fresh.get('/api/admin/passkey/login/status')
      .set('x-forwarded-for', nextIp());
    expect(status.body.available).toBe(true);

    const opts2 = await fresh.post('/api/admin/passkey/login/options')
      .set('x-csrf-token', tok2).send({}).set('x-forwarded-for', nextIp());
    expect(opts2.status).toBe(200);
    expect(opts2.body.ok).toBe(true);
    // allowCredentials admin passkeylarini o'z ichiga oladi (S35 id-fix)
    expect(opts2.body.options.allowCredentials.length).toBeGreaterThanOrEqual(1);

    // Assertion: counter 1 (registratsiya 0 edi — monotonik o'sish)
    const assert = createAuthenticationResponse({
      rpId: 'localhost',
      origin: 'http://localhost:4567',
      challenge: opts2.body.options.challenge,
      credId: b64urlToBuf(reg.id),
      publicKey: kp.publicKey,
      privateKey: kp.privateKey,
      counter: 1,
    });

    const verify = await fresh.post('/api/admin/passkey/login/verify')
      .set('x-csrf-token', tok2).send(assert) // wrapper yo'q — to'g'ridan-to'g'ri assertion
      .set('x-forwarded-for', nextIp());
    expect(verify.status).toBe(200);
    expect(verify.body.ok).toBe(true);
    expect(verify.body.redirect).toBe('/admin/dashboard');

    // Admin sessiya haqiqatan grant qilingan
    const dash = await fresh.get('/admin/dashboard').set('x-forwarded-for', nextIp());
    expect(dash.status).toBe(200);
  });

  it('boshqa hisob passkeyi bilan admin verify → 403 wrong_owner', async () => {
    // Admin passkey borligiga ishonch hosil qilamiz (order-bog'liq emas)
    await ensureAdminPasskey(supertest.agent(app));

    // User passkey (student) yaratamiz — 'admin:*' emas
    const userAgent = supertest.agent(app);
    const uname = `s35u_${Date.now() % 1000000}`;
    const up = await userAgent.get('/user/register').set('x-forwarded-for', nextIp());
    const utok = csrfFromForm(up.text);
    const regUser = await userAgent.post('/user/login').set('x-forwarded-for', nextIp())
      .type('form').send({
        _csrf: utok || '', lang: 'uz', mode: 'reg',
        username: uname, password: 'sirli-parol-2026-x',
        email: `${uname}@test.uz`, consent: 'on',
      });
    expect([302, 303]).toContain(regUser.status);

    const panel = await userAgent.get('/user/panel').set('x-forwarded-for', nextIp());
    const utok2 = csrfFromScript(panel.text) || csrfFromForm(panel.text);
    expect(utok2).toBeTruthy();
    const reauth = await userAgent.post('/api/auth/reauth')
      .set('x-csrf-token', utok2).send({ password: 'sirli-parol-2026-x' })
      .set('x-forwarded-for', nextIp());
    expect(reauth.body.ok).toBe(true);

    const uopts = await userAgent.post('/api/passkey/register/options')
      .set('x-csrf-token', utok2).send({}).set('x-forwarded-for', nextIp());
    expect(uopts.body.ok).toBe(true);
    const kp2 = createKeyPair();
    const ureg = createRegistrationResponse({
      rpId: 'localhost',
      origin: 'http://localhost:4567',
      challenge: uopts.body.options.challenge,
      publicKey: kp2.publicKey,
      privateKey: kp2.privateKey,
    });
    const uvr = await userAgent.post('/api/passkey/register/verify')
      .set('x-csrf-token', utok2).send({ response: ureg })
      .set('x-forwarded-for', nextIp());
    expect(uvr.body.ok).toBe(true);

    // Endi admin login sahifasidan shu USER passkeyi bilan verify → 403 wrong_owner
    const fresh = supertest.agent(app);
    const page = await fresh.get('/admin/login').set('x-forwarded-for', nextIp());
    const tok = csrfFromForm(page.text);
    const aopts = await fresh.post('/api/admin/passkey/login/options')
      .set('x-csrf-token', tok).send({}).set('x-forwarded-for', nextIp());
    expect(aopts.body.ok).toBe(true);

    const uassert = createAuthenticationResponse({
      rpId: 'localhost',
      origin: 'http://localhost:4567',
      challenge: aopts.body.options.challenge,
      credId: b64urlToBuf(ureg.id),
      publicKey: kp2.publicKey,
      privateKey: kp2.privateKey,
      counter: 1,
    });
    const uverify = await fresh.post('/api/admin/passkey/login/verify')
      .set('x-csrf-token', tok).send(uassert)
      .set('x-forwarded-for', nextIp());
    expect(uverify.status).toBe(403);
    expect(uverify.body.error).toBe('wrong_owner');
  });
});
