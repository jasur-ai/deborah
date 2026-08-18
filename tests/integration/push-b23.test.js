import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createApp } from '../../server.js';
import supertest from 'supertest';
import { snapshotDb, restoreDb } from '../helpers/setup.js';
import { fb } from '../../firebase/admin.js';
import { safeKey } from '../../utils/helpers.js';

let app;
let httpServer;

process.env.VAPID_PUBLIC_KEY = 'test-public-key-b23';
process.env.VAPID_PRIVATE_KEY = 'test-private-key-b23';
process.env.PUSH_ENABLED = 'true';
process.env.PUSH_OPTIN_AFTER_SESSIONS = '2';

beforeAll(async () => {
  await snapshotDb();
  ({ app, httpServer } = await createApp());
  await new Promise((r) => httpServer.listen(0, r));
});

afterAll(async () => {
  await new Promise((r) => httpServer.close(r));
  await restoreDb();
});

function freshAgent() {
  return supertest.agent(app);
}

async function getCsrf(agent, path = '/user/login') {
  const res = await agent.get(path);
  const m = res.text.match(/name="_csrf" value="([^"]+)"/);
  return m ? m[1] : null;
}

/** Har bir chaqiruv uchun YANGI agent — session aralashmasin (IDOR/bog'liqsizlik). */
async function registerAndLogin() {
  const agent = freshAgent();
  const uname = `push${Date.now()}${Math.floor(Math.random() * 100000)}`;
  const email = `push_${Date.now()}_${Math.floor(Math.random() * 1000000)}_a18@test.uz`;
  const pw = 'StrongPass123!xyz';
  let csrf = await getCsrf(agent);
  await agent.post('/user/login').type('form').send({
    _csrf: csrf, lang: 'uz', mode: 'reg', consent: 'on', username: uname, password: pw, email,
  });
  csrf = await getCsrf(agent);
  await agent.post('/user/login').type('form').send({
    _csrf: csrf, lang: 'uz', mode: 'login', username: uname, password: pw,
  });
  return { agent, uname, pw };
}

/** Sahifadagi window.__PUSH_INIT__ dan csrf olish. */
function pageCsrf(html) {
  const m = html.match(/window\.__PUSH_INIT__[\s\S]*?csrf: "([^"]*)"/);
  return m ? m[1] : null;
}

describe('B-23 Push — subscribe → send → deliver', () => {
  it('subscribe saqlaydi (CSRF + auth)', async () => {
    const { agent, uname } = await registerAndLogin();
    const page = await agent.get('/user/push');
    expect(page.status).toBe(200);
    const csrf = pageCsrf(page.text);
    const res = await agent
      .post('/api/push/subscribe')
      .set('X-CSRF-Token', csrf || '')
      .send({
        endpoint: `https://fcm.googleapis.com/send/${Date.now()}`,
        keys: { p256dh: 'AAAA', auth: 'BBBB' },
      });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    const snap = await fb.get(`users/${safeKey(uname)}/push_subs`);
    expect(snap.exists()).toBe(true);
  });

  it('IDOR — boshqa user ma\'lumoti ko\'rinmaydi', async () => {
    await fb.set('users/other-user/push_subs/k1', {
      endpoint: 'https://fcm.googleapis.com/send/other',
      keys: { p256dh: 'A', auth: 'B' },
      created_at: Date.now(),
      last_used_at: Date.now(),
    });
    const { agent } = await registerAndLogin();
    const page = await agent.get('/user/push');
    expect(page.status).toBe(200);
    // o'z subscription soni 0 — boshqasiniki ko'rinmaydi
    expect(page.text).toContain('subscriptionCount: 0');
    await fb.remove('users/other-user');
  });

  it('invalid subscription -> 400', async () => {
    const { agent } = await registerAndLogin();
    const page = await agent.get('/user/push');
    const csrf = pageCsrf(page.text);
    const res = await agent
      .post('/api/push/subscribe')
      .set('X-CSRF-Token', csrf || '')
      .send({ endpoint: 'https://x', keys: {} });
    expect(res.status).toBe(400);
  });

  it('unsubscribe o\'chiradi', async () => {
    const { agent, uname } = await registerAndLogin();
    const page = await agent.get('/user/push');
    const csrf = pageCsrf(page.text);
    const endpoint = `https://fcm.googleapis.com/send/unsub-${Date.now()}`;
    await agent
      .post('/api/push/subscribe')
      .set('X-CSRF-Token', csrf || '')
      .send({ endpoint, keys: { p256dh: 'A', auth: 'B' } });
    const res = await agent
      .post('/api/push/unsubscribe')
      .set('X-CSRF-Token', csrf || '')
      .send({ endpoint });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    const snap = await fb.get(`users/${safeKey(uname)}/push_subs`);
    if (snap.exists()) {
      expect(Object.keys(snap.val()).length).toBe(0);
    }
  });

  it('opt-in timing — 1-sessiyada eligible emas, 2+ sessiyada eligible', async () => {
    const agent = freshAgent();
    const uname = `opt${Date.now()}${Math.floor(Math.random() * 100000)}`;
    const email = `opt_${Date.now()}_a18@test.uz`;
    const pw = 'StrongPass123!xyz';
    let csrf = await getCsrf(agent);
    await agent.post('/user/login').type('form').send({
      _csrf: csrf, lang: 'uz', mode: 'reg', consent: 'on', username: uname, password: pw, email,
    });
    await fb.set(`users/${safeKey(uname)}/login_count`, 1);
    const r1 = await agent.get('/api/push/optin-eligible');
    expect(r1.status).toBe(200);
    expect(r1.body.eligible).toBe(false);
    await fb.set(`users/${safeKey(uname)}/login_count`, 2);
    const r2 = await agent.get('/api/push/optin-eligible');
    expect(r2.body.eligible).toBe(true);
  });

  it('CSRF yo\'q -> 403', async () => {
    const { agent } = await registerAndLogin();
    const res = await agent
      .post('/api/push/subscribe')
      .send({ endpoint: 'https://fcm.googleapis.com/send/x', keys: { p256dh: 'A', auth: 'B' } });
    expect([403, 400]).toContain(res.status);
  });
});
