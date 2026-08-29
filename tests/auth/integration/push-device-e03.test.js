/**
 * AUTH E-03 — FCM device-token push API
 * ---------------------------------------------------------------------------
 * Journey: register → device token register → status → unregister →
 * logout revoke (?revoke_token=) → DSAR export pushDevices PII.
 * Manba: E-03 roadmap (FCM provider, DSAR token=PII).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import supertest from 'supertest';
import { createApp } from '../../../server.js';
import { snapshotDb, restoreDb } from '../../helpers/setup.js';
import { fb } from '../../../firebase/admin.js';

let app, httpServer;
let xff = '192.0.2.10';
function nextIp() {
  xff = `192.0.2.${10 + (Math.floor(Math.random() * 1000) % 40)}`;
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

const TOKEN = `dLk${'aB'.repeat(78)}`; // ~160 belgi — haqiqiy FCM formatiga yaqin

beforeAll(async () => {
  await snapshotDb();
  process.env.FCM_ENABLED = 'true';
  process.env.FCM_SERVER_KEY = 'test-server-key';
  const created = await createApp();
  app = created.app;
  httpServer = created.httpServer;
  await new Promise((r) => httpServer.listen(0, r));
});
afterAll(async () => {
  if (httpServer) await new Promise((r) => httpServer.close(r));
  await restoreDb();
  delete process.env.FCM_SERVER_KEY;
});

describe('AUTH E-03 — FCM device-token API', () => {
  it('register → status → unregister oqimi (auth + CSRF)', async () => {
    const agent = supertest.agent(app);
    const uname = `fcm_${Date.now() % 1000000}`;
    const reg = await register(agent, uname, `fcm_${Date.now()}@test.uz`);
    expect([302, 303]).toContain(reg.status);

    const panel = await agent.get('/user/panel');
    const csrf = csrfFrom(panel.text);
    expect(csrf).toBeTruthy();

    // Register
    const reg2 = await agent.post('/api/push/device/register').set('x-csrf-token', csrf)
      .send({ token: TOKEN, platform: 'android' }).set('x-forwarded-for', nextIp());
    expect(reg2.status).toBe(200);
    expect(reg2.body.ok).toBe(true);
    expect(reg2.body.created).toBe(true);

    // Idempotent
    const again = await agent.post('/api/push/device/register').set('x-csrf-token', csrf)
      .send({ token: TOKEN, platform: 'android' }).set('x-forwarded-for', nextIp());
    expect(again.body.created).toBe(false);

    // Status — raw token qaytmaydi (PII minimal)
    const status = await agent.get('/api/push/device/status').set('x-forwarded-for', nextIp());
    expect(status.body.ok).toBe(true);
    expect(status.body.count).toBe(1);
    expect(status.body.devices[0].platform).toBe('android');
    expect(JSON.stringify(status.body)).not.toContain(TOKEN);

    // Unregister
    const unreg = await agent.post('/api/push/device/unregister').set('x-csrf-token', csrf)
      .send({ token: TOKEN }).set('x-forwarded-for', nextIp());
    expect(unreg.status).toBe(200);
    const status2 = await agent.get('/api/push/device/status').set('x-forwarded-for', nextIp());
    expect(status2.body.count).toBe(0);
  });

  it('invalid token → 400; limit 5 → 429; authsiz/CSRF blok', async () => {
    const agent = supertest.agent(app);
    const uname = `fcm2_${Date.now() % 1000000}`;
    const reg = await register(agent, uname, `fcm2_${Date.now()}@test.uz`);
    expect([302, 303]).toContain(reg.status);
    const panel = await agent.get('/user/panel');
    const csrf = csrfFrom(panel.text);

    const bad = await agent.post('/api/push/device/register').set('x-csrf-token', csrf)
      .send({ token: 'short' }).set('x-forwarded-for', nextIp());
    expect(bad.status).toBe(400);
    expect(bad.body.error).toBe('invalid_token');

    // Limit 5
    for (let i = 0; i < 5; i++) {
      const t = `${i}-${TOKEN}`;
      const r = await agent.post('/api/push/device/register').set('x-csrf-token', csrf)
        .send({ token: t }).set('x-forwarded-for', nextIp());
      expect(r.status).toBe(200);
    }
    const sixth = await agent.post('/api/push/device/register').set('x-csrf-token', csrf)
      .send({ token: `6-${TOKEN}` }).set('x-forwarded-for', nextIp());
    expect(sixth.status).toBe(429);
    expect(sixth.body.error).toBe('limit_reached');

    // Authsiz → CSRF 403
    const anon = supertest.agent(app);
    const anonRes = await anon.post('/api/push/device/register')
      .send({ token: TOKEN }).set('x-forwarded-for', nextIp());
    expect(anonRes.status).toBe(403);
  });

  it('logout ?revoke_token= → token ochiriladi (PII revoke)', async () => {
    const agent = supertest.agent(app);
    const uname = `fcm3_${Date.now() % 1000000}`;
    const reg = await register(agent, uname, `fcm3_${Date.now()}@test.uz`);
    expect([302, 303]).toContain(reg.status);
    const panel = await agent.get('/user/panel');
    const csrf = csrfFrom(panel.text);
    await agent.post('/api/push/device/register').set('x-csrf-token', csrf)
      .send({ token: TOKEN }).set('x-forwarded-for', nextIp());

    // Logout — o'z tokenini revoke qiladi
    await agent.get(`/user/logout?revoke_token=${encodeURIComponent(TOKEN)}`).redirects(0);

    // Yangi login → token yo'qligi ko'rinadi
    const lp = await agent.get('/user/login');
    const lcs = lp.text.match(/name="_csrf" value="([^"]+)"/);
    await agent.post('/user/login').set('x-forwarded-for', nextIp()).type('form')
      .send({ _csrf: lcs ? lcs[1] : '', lang: 'uz', mode: 'login', username: uname, password: 'sirli-parol-2026-x' });
    const status = await agent.get('/api/push/device/status').set('x-forwarded-for', nextIp());
    expect(status.body.count).toBe(0);
  });

  it('DSAR export pushDevices PII ni oz ichiga oladi', async () => {
    const agent = supertest.agent(app);
    const uname = `fcm4_${Date.now() % 1000000}`;
    const reg = await register(agent, uname, `fcm4_${Date.now()}@test.uz`);
    expect([302, 303]).toContain(reg.status);
    const panel = await agent.get('/user/panel');
    const csrf = csrfFrom(panel.text);
    await agent.post('/api/push/device/register').set('x-csrf-token', csrf)
      .send({ token: TOKEN, platform: 'ios' }).set('x-forwarded-for', nextIp());

    const exp = await agent.post('/api/privacy/dsar/export').set('x-csrf-token', csrf)
      .send({}).set('x-forwarded-for', nextIp());
    expect(exp.status).toBe(200);
    expect(exp.body.ok).toBe(true);
    const json = typeof exp.body.data === 'string' ? JSON.parse(exp.body.data) : exp.body.data;
    expect(Array.isArray(json.pushDevices)).toBe(true);
    expect(json.pushDevices.length).toBe(1);
    expect(json.pushDevices[0].token).toBe(TOKEN); // foydalanuvchi o'z PII — to'liq
    expect(json.pushDevices[0].platform).toBe('ios');
  });
});
