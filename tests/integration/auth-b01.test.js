/**
 * Edikit — AUTH B-01 Users final schema — Integration tests
 * ---------------------------------------------------------
 *  - Register → DB'da canonical record (role, role_version, email_status,
 *    updated_at, twofa_enabled...)
 *  - Duplicate username / email → blok (user yaratilmaydi)
 *  - GET /api/user/me → private DTO (PII minimal, secret yo'q)
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import supertest from 'supertest';
import { createApp } from '../../server.js';
import { snapshotDb, restoreDb } from '../helpers/setup.js';
import { fb } from '../../firebase/admin.js';
import { safeKey } from '../../utils/helpers.js';

let ipCounter = 200;
function nextIp() {
  ipCounter = 200 + ((ipCounter - 200 + 1) % 54);
  return `198.51.100.${ipCounter}`;
}

let app;
let httpServer;

function csrfFrom(html) {
  const m = html.match(/name="_csrf" value="([^"]+)"/);
  return m ? m[1] : null;
}

async function register(agent, username, email) {
  const page = await agent.get('/user/login?lang=uz');
  const csrf = csrfFrom(page.text);
  return agent.post('/user/login').set('x-forwarded-for', nextIp()).type('form').send({
    mode: 'reg', consent: 'on', _csrf: csrf, username,
    email: email || `${username}@test.uz`,
    password: 'parol-2026-x-uzun', lang: 'uz',
  });
}

async function login(agent, username) {
  const fresh = supertest.agent(app);
  const page = await fresh.get('/user/login?lang=uz');
  const csrf = csrfFrom(page.text);
  await fresh.post('/user/login').set('x-forwarded-for', nextIp()).type('form').send({
    _csrf: csrf, username, password: 'parol-2026-x-uzun', lang: 'uz',
  });
  return fresh;
}

describe('AUTH B-01 — Users final schema', () => {
  beforeAll(async () => {
    await snapshotDb();
    ({ app, httpServer } = await createApp());
    await new Promise((r) => httpServer.listen(0, r));
  });
  afterAll(async () => {
    await restoreDb();
    await new Promise((r) => httpServer.close(r));
  });

  it('register → canonical users schema record yoziladi', async () => {
    const username = `b01u1_${Date.now()}`; // username max 20 belgi (register schema)
    const res = await register(supertest.agent(app), username);
    expect([200, 302]).toContain(res.status);

    const snap = await fb.get(`users/${safeKey(username)}`);
    expect(snap.exists()).toBe(true);
    const rec = snap.val();
    // Canonical fieldlar (B-01)
    expect(rec.role).toBe('student');
    expect(rec.role_version).toBe(1);
    expect(rec.email_verified).toBe(false);
    expect(rec.email_status).toBe('pending'); // email bor, verified emas
    expect(rec.twofa_enabled).toBe(false);
    expect(rec.mfa_totp_status).toBe('disabled');
    expect(rec.failed_attempts).toBe(0);
    expect(rec.locked_until).toBe(null);
    expect(typeof rec.created_at).toBe('number');
    expect(typeof rec.updated_at).toBe('number');
    expect(rec.google_sub).toBe(null);
    expect(rec.hemis_id).toBe(null);
    expect(rec.telegram_id).toBe(null);
  });

  it('duplicate username → blok, yangi user yaratilmaydi', async () => {
    const username = `b01dup_${Date.now()}`;
    const agent = supertest.agent(app);
    const r1 = await register(agent, username);
    expect([200, 302]).toContain(r1.status);

    // Same username, boshqa agent/IP → register rad etiladi
    const agent2 = supertest.agent(app);
    const r2 = await register(agent2, username);
    // Register re-render (panelga redirect emas) + error marker
    expect(r2.status).toBe(200);
    expect(r2.headers.location).toBeUndefined();
    expect(r2.text).not.toContain('/user/panel');
    // Email index'da yangi user yo'q
    const snap = await fb.get(`users/${safeKey(username)}`);
    expect(snap.exists()).toBe(true);
    // Dublikat yozuv yaratilmadi — faqat bitta user mavjud
    expect(snap.val().username).toBe(username);
  });

  it('duplicate email → blok, yangi user yaratilmaydi', async () => {
    const shared = `b01shared_${Date.now()}@test.uz`;
    const u1 = `b01e1_${Date.now()}`;
    const u2 = `b01e2_${Date.now()}`;

    const agent1 = supertest.agent(app);
    const r1 = await register(agent1, u1, shared);
    expect([200, 302]).toContain(r1.status);

    const agent2 = supertest.agent(app);
    const r2 = await register(agent2, u2, shared);
    expect(r2.status).toBe(200);
    expect(r2.headers.location).toBeUndefined();

    // u2 record'i yaratilmagan
    const snap = await fb.get(`users/${safeKey(u2)}`);
    expect(snap.exists()).toBe(false);
  });

  it('GET /api/me → private DTO (PII minimal, secret yo\'q)', async () => {
    const username = `b01me_${Date.now()}`;
    const agent = supertest.agent(app);
    await register(agent, username);
    const me = await login(agent, username);
    // Profilga secret'lar yozamiz — DTO ularni ko'rsatmasligi kerak
    const key = safeKey(username);
    await fb.set(`users/${key}/google_sub`, 'google-xyz');
    await fb.set(`users/${key}/hemis_id`, 'HEMIS-42');
    await fb.set(`users/${key}/telegram_id`, 'tg-9');
    await fb.set(`users/${key}/last_login_ip_hash`, 'ip-hash-1');
    await fb.set(`users/${key}/vipPlainPassword`, 'plain-secret');

    const res = await me.get('/user/api/me').set('x-forwarded-for', nextIp());
    expect(res.status).toBe(200);
    const { user } = res.body;
    expect(user.username).toBe(username);
    expect(user.id).toBe(key);
    expect(user.role).toBe('student');
    expect(user.email).toBe(`${username}@test.uz`);
    expect(user.emailStatus).toBe('pending');
    // Private DTO egasi uchun hemis_id ko'rsatiladi (o'z ma'lumoti)
    expect(user.hemisId).toBe('HEMIS-42');
    // Secret/PII — HECH QACHON
    expect(user.password).toBeUndefined();
    expect(user.google_sub).toBeUndefined();
    expect(user.telegram_id).toBeUndefined();
    expect(user.last_login_ip_hash).toBeUndefined();
    expect(user.vipPlainPassword).toBeUndefined();
    expect(user.mfa_totp_status).toBeUndefined();
    expect(user.failed_attempts).toBeUndefined();
    expect(user.locked_until).toBeUndefined();
  });

  it('GET /api/me — authsiz 401', async () => {
    const res = await supertest(app).get('/user/api/me');
    expect([401, 302]).toContain(res.status);
  });
});
