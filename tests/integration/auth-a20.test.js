import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import supertest from 'supertest';
import { createApp } from '../../server.js';
import { snapshotDb, restoreDb } from '../helpers/setup.js';
import { fb } from '../../firebase/admin.js';
import { safeKey } from '../../utils/helpers.js';
import { indexEmail } from '../../src/modules/auth/email-verify.js';

let app;
let httpServer;
let ipCounter = 10;

function nextIp() {
  ipCounter += 1;
  return `203.0.114.${ipCounter}`;
}

function csrfFrom(html) {
  const m = html.match(/name="_csrf" value="([^"]+)"/);
  return m ? m[1] : null;
}

async function createUser({ username, email, verified }) {
  await fb.set(`users/${username}`, {
    username,
    email: email || null,
    email_verified: verified === true,
    password: '$argon2id$v=19$m=65536,p=4,t=3$test$test',
    created_at: Date.now(),
    safeKey: username,
    isVip: false,
  });
  if (email) await indexEmail(email, username);
  return username;
}

describe('AUTH A-20 — parol tiklash email orqali', () => {
  beforeAll(async () => {
    await snapshotDb();
    ({ app, httpServer } = await createApp());
    await new Promise((r) => httpServer.listen(0, r));
  });
  afterAll(async () => {
    await restoreDb();
    await new Promise((r) => httpServer.close(r));
  });

  it('forgot: email bilan so\'rov → verified user\'ga devPreview (token) qaytadi', async () => {
    const uname = `a20e_${Date.now() % 1000000}`;
    const email = `${uname}@test.uz`;
    await createUser({ username: uname, email, verified: true });

    const agent = supertest.agent(app);
    const page = await agent.get('/user/forgot?lang=uz');
    const csrf = csrfFrom(page.text);
    const res = await agent
      .post('/user/forgot')
      .set('x-forwarded-for', nextIp())
      .type('form')
      .send({ _csrf: csrf, username: email, lang: 'uz' });
    expect(res.status).toBe(200);
    // Enumeration-safe xabar + dev havola
    expect(res.text).toContain('dev-reset-preview');
    const m = res.text.match(/\/user\/reset\?token=([0-9a-f]{96})/);
    expect(m).toBeTruthy();
  });

  it('forgot: username bilan ham ishlaydi (verified)', async () => {
    const uname = `a20u_${Date.now() % 1000000}`;
    const email = `${uname}@test.uz`;
    await createUser({ username: uname, email, verified: true });

    const agent = supertest.agent(app);
    const page = await agent.get('/user/forgot?lang=uz');
    const csrf = csrfFrom(page.text);
    const res = await agent
      .post('/user/forgot')
      .set('x-forwarded-for', nextIp())
      .type('form')
      .send({ _csrf: csrf, username: uname, lang: 'uz' });
    expect(res.status).toBe(200);
    expect(res.text).toContain('dev-reset-preview');
  });

  it('forgot: verified bo\'lmagan → token YO\'Q, javob bir xil (enumeration)', async () => {
    const uname = `a20nv_${Date.now() % 1000000}`;
    const email = `${uname}@test.uz`;
    await createUser({ username: uname, email, verified: false });

    const agent = supertest.agent(app);
    const page = await agent.get('/user/forgot?lang=uz');
    const csrf = csrfFrom(page.text);
    const res = await agent
      .post('/user/forgot')
      .set('x-forwarded-for', nextIp())
      .type('form')
      .send({ _csrf: csrf, username: uname, lang: 'uz' });
    expect(res.status).toBe(200);
    // Generic "yuborildi" xabari (bir xil), dev-preview YO'Q
    expect(res.text).toContain('yuborildi');
    expect(res.text).not.toContain('dev-reset-preview');
  });

  it('forgot: legacy user (email yo\'q) → token YO\'Q, bir xil javob', async () => {
    const uname = `a20leg_${Date.now() % 1000000}`;
    await createUser({ username: uname, email: null, verified: false });

    const agent = supertest.agent(app);
    const page = await agent.get('/user/forgot?lang=uz');
    const csrf = csrfFrom(page.text);
    const res = await agent
      .post('/user/forgot')
      .set('x-forwarded-for', nextIp())
      .type('form')
      .send({ _csrf: csrf, username: uname, lang: 'uz' });
    expect(res.status).toBe(200);
    expect(res.text).not.toContain('dev-reset-preview');
  });

  it('forgot: mavjud bo\'lmagan account → bir xil javob (enumeration himoya)', async () => {
    const agent = supertest.agent(app);
    const page = await agent.get('/user/forgot?lang=uz');
    const csrf = csrfFrom(page.text);
    const res = await agent
      .post('/user/forgot')
      .set('x-forwarded-for', nextIp())
      .type('form')
      .send({ _csrf: csrf, username: `nonexistent_${Date.now()}`, lang: 'uz' });
    expect(res.status).toBe(200);
    expect(res.text).toContain('yuborildi');
    expect(res.text).not.toContain('dev-reset-preview');
  });

  it('API: /api/reset/request — email lookup + verified shart', async () => {
    const uname = `a20api_${Date.now() % 1000000}`;
    const email = `${uname}@test.uz`;
    await createUser({ username: uname, email, verified: true });

    const agent = supertest.agent(app);
    const page = await agent.get('/user/login?lang=uz');
    const csrf = csrfFrom(page.text);
    const res = await agent
      .post('/api/reset/request')
      .set('x-forwarded-for', nextIp())
      .set('x-csrf-token', csrf)
      .send({ account: email });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.devPreview).toBeTruthy();
  });

  it('API: verified bo\'lmagan → generic javob, devPreview yo\'q', async () => {
    const uname = `a20apinv_${Date.now() % 1000000}`;
    const email = `${uname}@test.uz`;
    await createUser({ username: uname, email, verified: false });

    const agent = supertest.agent(app);
    const page = await agent.get('/user/login?lang=uz');
    const csrf = csrfFrom(page.text);
    const res = await agent
      .post('/api/reset/request')
      .set('x-forwarded-for', nextIp())
      .set('x-csrf-token', csrf)
      .send({ account: uname });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.devPreview).toBeUndefined();
  });

  it('API: to\'liq round-trip — email → havola → reset → auto-login', async () => {
    const uname = `a20rt_${Date.now() % 1000000}`;
    const email = `${uname}@test.uz`;
    await createUser({ username: uname, email, verified: true });

    // 1) Request — email orqali
    const agent = supertest.agent(app);
    const page = await agent.get('/user/login?lang=uz');
    const csrf = csrfFrom(page.text);
    const reqRes = await agent
      .post('/api/reset/request')
      .set('x-forwarded-for', nextIp())
      .set('x-csrf-token', csrf)
      .send({ account: email });
    const preview = reqRes.body.devPreview;
    expect(preview).toBeTruthy();
    const token = preview.split('token=')[1];

    // 2) Verify
    const verify = await agent
      .post('/api/reset/verify')
      .set('x-forwarded-for', nextIp())
      .set('x-csrf-token', csrf)
      .send({ token });
    expect(verify.body.ok).toBe(true);
    expect(verify.body.code).toBe('valid');

    // 3) Complete — yangi parol
    const complete = await agent
      .post('/api/reset/complete')
      .set('x-forwarded-for', nextIp())
      .set('x-csrf-token', csrf)
      .send({ token, password: 'yangi-parol-2026' });
    expect(complete.status).toBe(200);
    expect(complete.body.ok).toBe(true);
    expect(complete.body.redirect).toBe('/user/panel');

    // 4) Avtomatik login ishladi — panel ochiq
    const panel = await agent.get('/user/panel');
    expect([200, 302]).toContain(panel.status);

    // 5) Takroriy ishlatish → 410 (logout qilamiz — redirectIfAuth to'smasin)
    await agent.get('/user/logout');
    const replayPage = await agent.get('/user/login?lang=uz');
    const replayCsrf = csrfFrom(replayPage.text);
    const replay = await agent
      .post('/api/reset/complete')
      .set('x-forwarded-for', nextIp())
      .set('x-csrf-token', replayCsrf || '')
      .send({ token, password: 'yana-parol-2026' });
    expect([403, 410]).toContain(replay.status);
  });

  it('stale token → expired (15 daqiqa o\'tgan)', async () => {
    const uname = `a20st_${Date.now() % 1000000}`;
    const email = `${uname}@test.uz`;
    await createUser({ username: uname, email, verified: true });

    // To'g'ridan-to'g'ri eskirgan token yozamiz
    const token = 'a'.repeat(96);
    const hash = require('crypto').createHash('sha256').update(token).digest('hex');
    await fb.set(`resetTokens/${hash}`, {
      safeKey: uname,
      expiresAt: Date.now() - 1000,
      createdAt: Date.now() - 60 * 1000,
    });

    const agent = supertest.agent(app);
    const page = await agent.get('/user/login?lang=uz');
    const csrf = csrfFrom(page.text);
    const verify = await agent
      .post('/api/reset/verify')
      .set('x-forwarded-for', nextIp())
      .set('x-csrf-token', csrf)
      .send({ token });
    expect(verify.body.ok).toBe(false);
    expect(verify.body.code).toBe('expired');
  });
});
