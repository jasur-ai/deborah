/**
 * Deborah — AUTH B-03 Register forma — Integration tests
 * ------------------------------------------------------
 *  - GET /user/register → alohida universitar sahifa (rol kartalari, invite)
 *  - POST /user/login (mode=reg) → name + invite_code DB'da saqlanadi
 *  - Xatolar register sahifasiga qaytadi (login tab'iga EMAS)
 *  - Teacher rol tanlanganda → teacher_pending
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

// Register sahifasidan CSRF olib POST qiladi (B-03: POST /user/login mode=reg)
async function postRegister(agent, fields) {
  const page = await agent.get('/user/register?lang=uz');
  const csrf = csrfFrom(page.text);
  return agent.post('/user/login').set('x-forwarded-for', nextIp()).type('form').send({
    mode: 'reg', consent: 'on', _csrf: csrf, lang: 'uz',
    password: 'parol-2026-x-uzun',
    ...fields,
  });
}

describe('AUTH B-03 — Register forma', () => {
  beforeAll(async () => {
    await snapshotDb();
    ({ app, httpServer } = await createApp());
    await new Promise((r) => httpServer.listen(0, r));
  });
  afterAll(async () => {
    await restoreDb();
    await new Promise((r) => httpServer.close(r));
  });

  it('GET /user/register → alohida universitar sahifa render', async () => {
    const res = await supertest(app).get('/user/register?lang=uz');
    expect(res.status).toBe(200);
    // B-03 elementlar
    expect(res.text).toContain('role-grid');
    expect(res.text).toContain('role-card');
    expect(res.text).toContain('invite-toggle');
    expect(res.text).toContain('trust--multi');
    expect(res.text).toContain('name="role"');
    expect(res.text).toContain('name="invite"');
    expect(res.text).toContain('name="name"');
    // Login tablari YO'Q (alohida sahifa)
    expect(res.text).not.toContain('tab-login');
    expect(res.text).not.toContain('auth-tabs');
    // CSRF token bor
    expect(csrfFrom(res.text)).toBeTruthy();
  });

  it('register name + invite → DB canonical record saqlaydi', async () => {
    const username = `b03u1_${Date.now()}`;
    const res = await postRegister(supertest.agent(app), {
      username,
      email: `${username}@test.uz`,
      name: 'Aziza Karimova',
      invite: 'INV-2026-DEBORAH',
    });
    expect([200, 302]).toContain(res.status);

    const snap = await fb.get(`users/${safeKey(username)}`);
    expect(snap.exists()).toBe(true);
    const rec = snap.val();
    expect(rec.name).toBe('Aziza Karimova');
    expect(rec.invite_code).toBe('INV-2026-DEBORAH');
    // B-03 review fix: invite B-12 gacha ishonchsiz marker bilan saqlanadi
    expect(rec.invite_status).toBe('unverified');
    expect(rec.role).toBe('student');
  });

  it('teacher roli tanlansa → teacher_pending + ariza', async () => {
    const username = `b03t_${Date.now()}`;
    const res = await postRegister(supertest.agent(app), {
      username,
      email: `${username}@test.uz`,
      role: 'teacher',
      name: 'Bekzod Toshmatov',
      // B-29: teacher application uchun majburiy
      university: 'Toshkent Davlat Universiteti',
      subject: 'Matematika',
    });
    expect([200, 302]).toContain(res.status);

    const snap = await fb.get(`users/${safeKey(username)}`);
    expect(snap.exists()).toBe(true);
    const rec = snap.val();
    expect(rec.role).toBe('teacher_pending');
    expect(rec.teacher_application).toBeDefined();
  });

  it('noto\'g\'ri invite → xato register sahifasida ko\'rinadi (login EMAS)', async () => {
    const username = `b03bad_${Date.now()}`;
    const res = await postRegister(supertest.agent(app), {
      username,
      email: `${username}@test.uz`,
      invite: 'bad<code>!',
    });
    expect(res.status).toBe(200);
    // Register sahifasi render (login tab emas)
    expect(res.text).toContain('role-grid');
    expect(res.text).not.toContain('tab-login');
    // Xato marker + data-field=invite
    expect(res.text).toContain('auth-alert');
    expect(res.text).toContain('data-field="invite"');
    // User yaratilmadi
    const snap = await fb.get(`users/${safeKey(username)}`);
    expect(snap.exists()).toBe(false);
  });

  it('teacher xatoda rol tanlovini yo\'qotmaydi (prevRole)', async () => {
    const username = `b03pr_${Date.now()}`;
    const res = await postRegister(supertest.agent(app), {
      username,
      email: `${username}@test.uz`,
      role: 'teacher',
      invite: 'bad<code>!',
    });
    expect(res.status).toBe(200);
    expect(res.text).toContain('role-grid');
    // Teacher radio hali checked + student emas
    expect(res.text).toMatch(/value="teacher"\s+checked/);
    expect(res.text).not.toMatch(/value=""\s+checked/);
  });

  it('qisqa ism → xato name maydoniga tegishli', async () => {
    const username = `b03n_${Date.now()}`;
    const res = await postRegister(supertest.agent(app), {
      username,
      email: `${username}@test.uz`,
      name: 'A',
    });
    expect(res.status).toBe(200);
    expect(res.text).toContain('role-grid'); // register sahifasi
    expect(res.text).toContain('data-field="name"');
    expect(res.text).not.toContain('/user/panel');
    const snap = await fb.get(`users/${safeKey(username)}`);
    expect(snap.exists()).toBe(false);
  });
});
