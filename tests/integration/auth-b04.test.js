/**
 * Deborah — AUTH B-04 Username validatsiya — Integration tests
 * -------------------------------------------------------------
 *  - Case-insensitive unique: 'Smith' → 'smith'; 'smith' qayta bloklanadi
 *  - Dots/dash usernames register + login
 *  - Rezerv so'z ('admin', 'test') register bloklanadi (error sahifada)
 *  - Leet/confusable ('4dm1n') bloklanadi
 *  - Login case-insensitive (NFKC)
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

async function registerPage(agent) {
  return agent.get('/user/register?lang=uz');
}

async function postRegister(agent, username, extra = {}) {
  const page = await registerPage(agent);
  const csrf = csrfFrom(page.text);
  return agent.post('/user/login').set('x-forwarded-for', nextIp()).type('form').send({
    mode: 'reg', consent: 'on', _csrf: csrf, lang: 'uz',
    username,
    email: extra.email || `${Date.now()}-${username.replace(/[^a-z0-9]/gi, '')}@test.uz`,
    password: 'parol-2026-x-uzun',
    ...extra,
  });
}

async function login(agent, username, password = 'parol-2026-x-uzun') {
  const page = await agent.get('/user/login?lang=uz');
  const csrf = csrfFrom(page.text);
  return agent.post('/user/login').set('x-forwarded-for', nextIp()).type('form').send({
    _csrf: csrf, username, password, lang: 'uz',
  });
}

describe('AUTH B-04 — Username validatsiya', () => {
  beforeAll(async () => {
    await snapshotDb();
    ({ app, httpServer } = await createApp());
    await new Promise((r) => httpServer.listen(0, r));
  });
  afterAll(async () => {
    await restoreDb();
    await new Promise((r) => httpServer.close(r));
  });

  it('case-insensitive unique: "Smith" ro\'yxatdan o\'tsa, "smith" bloklanadi', async () => {
    const r1 = await postRegister(supertest.agent(app), 'Smith');
    expect([200, 302]).toContain(r1.status);

    // Canonical 'smith' saqlangan
    const snap = await fb.get(`users/${safeKey('smith')}`);
    expect(snap.exists()).toBe(true);
    expect(snap.val().username).toBe('smith');

    // "smith" (boshqa IP) — band
    const r2 = await postRegister(supertest.agent(app), 'smith', { email: `x${Date.now()}@test.uz` });
    expect(r2.status).toBe(200);
    expect(r2.headers.location).toBeUndefined();
    expect(r2.text).toContain('role-grid'); // register xato-sahifasi (panel emas)
  });

  it('dots/dash username register + case-insensitive login', async () => {
    const username = `john.doe_${Date.now() % 100000}`;
    await postRegister(supertest.agent(app), username);

    // Login boshqa case'da ham ishlaydi
    const agent = supertest.agent(app);
    const res = await login(agent, username.toUpperCase());
    expect([200, 302]).toContain(res.status);
    expect(res.headers.location || '').toContain('/user/panel');
  });

  it('rezerv so\'z "admin" → blok, error register sahifasida', async () => {
    const res = await postRegister(supertest.agent(app), 'admin');
    expect(res.status).toBe(200);
    expect(res.text).toContain('role-grid'); // register sahifasi
    expect(res.text).toContain('data-field="username"');
    // User yaratilmadi
    expect((await fb.get('users/admin')).exists()).toBe(false);
  });

  it('leet/confusable "4dm1n" → blok', async () => {
    const res = await postRegister(supertest.agent(app), '4dm1n');
    expect(res.status).toBe(200);
    expect(res.text).toContain('data-field="username"');
    expect((await fb.get(`users/${safeKey('4dm1n')}`)).exists()).toBe(false);
  });

  it('kirill username "аdmin" → format orqali blok', async () => {
    const res = await postRegister(supertest.agent(app), 'аdmin');
    expect(res.status).toBe(200);
    expect(res.text).toContain('data-field="username"');
  });
});
