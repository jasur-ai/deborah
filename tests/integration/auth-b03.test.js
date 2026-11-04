/**
 * Deborah — AUTH B-03 Register forma — Integration tests
 * ------------------------------------------------------
 *  - GET /user/register → talaba uchun alohida sahifa (teacher tanlovi yo'q)
 *  - POST /user/login (mode=reg) → name + invite_code DB'da saqlanadi
 *  - Xatolar register sahifasiga qaytadi (login tab'iga EMAS)
 *  - Teacher arizasi faqat yashirin /ustoz oqimidan → teacher_pending
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

// Public registration is student-only. Teacher applications must first enter
// the hidden /ustoz area, which establishes the server-side session marker.
async function postRegister(agent, fields) {
  const page = fields.role === 'teacher'
    ? await agent.get('/ustoz')
    : await agent.get('/user/register?lang=uz');
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

  it('GET /user/register → student-only alohida sahifa render', async () => {
    const res = await supertest(app).get('/user/register?lang=uz');
    expect(res.status).toBe(200);
    expect(res.text).not.toContain('role-grid');
    expect(res.text).not.toContain('role-card');
    expect(res.text).not.toContain('name="role"');
    expect(res.text).not.toContain('id="reg-university"');
    expect(res.text).toContain('id="invite-toggle"');
    expect(res.text).toContain('trust--multi');
    expect(res.text).toContain('name="invite"');
    expect(res.text).toContain('name="name"');
    expect(res.text).toContain('/user/forgot?lang=uz');
    // Login tablari YO'Q (alohida sahifa)
    expect(res.text).not.toContain('tab-login');
    expect(res.text).not.toContain('auth-tabs');
    expect(csrfFrom(res.text)).toBeTruthy();
  });

  it('GET /user/register?role=teacher without /ustoz entry redirects to student form', async () => {
    const agent = supertest.agent(app);
    const res = await agent.get('/user/register?role=teacher&lang=uz');
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/user/register?lang=uz');
    const page = await agent.get('/user/register?lang=uz');
    expect(page.text).not.toContain('id="reg-university"');
  });

  it('/ustoz session is required to access the full teacher form', async () => {
    const agent = supertest.agent(app);
    const legacyAlias = await agent.get('/ustoz-landing');
    expect(legacyAlias.status).toBe(302);
    expect(legacyAlias.headers.location).toBe('/ustoz');
    const portal = await agent.get('/ustoz');
    expect(portal.status).toBe(200);
    const registerForm = portal.text.match(/<form id="fReg"[\s\S]*?<\/form>/);
    expect(registerForm).toBeTruthy();
    expect(registerForm[0]).toContain('name="role" value="teacher"');
    expect(registerForm[0]).toContain('/user/forgot?lang=uz');

    const fullForm = await agent.get('/user/register?role=teacher&lang=uz');
    expect(fullForm.status).toBe(200);
    expect(fullForm.text).toContain('id="reg-university"');
    expect(fullForm.text).toContain('/user/forgot?lang=uz');
  });

  it('direct role=teacher POST without /ustoz entry is rejected server-side', async () => {
    const agent = supertest.agent(app);
    const page = await agent.get('/user/register?lang=uz');
    const username = `b03deny_${Date.now()}`;
    const res = await agent.post('/user/login')
      .set('x-forwarded-for', nextIp())
      .type('form')
      .send({
        mode: 'reg', consent: 'on', _csrf: csrfFrom(page.text), lang: 'uz',
        username, email: `${username}@test.uz`, password: 'parol-2026-x-uzun',
        role: 'teacher', university: 'Toshkent Davlat Universiteti', subject: 'Matematika',
      });
    expect(res.status).toBe(403);
    expect(res.text).toContain('yuqori o&#39;ngdagi');
    expect(res.text).not.toContain('id="reg-university"');
    const snap = await fb.get(`users/${safeKey(username)}`);
    expect(snap.exists()).toBe(false);
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
    // Public registration remains student-only on validation errors.
    expect(res.text).not.toContain('role-grid');
    expect(res.text).not.toContain('id="reg-university"');
    expect(res.text).not.toContain('tab-login');
    // Xato marker + data-field=invite
    expect(res.text).toContain('auth-alert');
    expect(res.text).toContain('data-field="invite"');
    // User yaratilmadi
    const snap = await fb.get(`users/${safeKey(username)}`);
    expect(snap.exists()).toBe(false);
  });

  it('teacher xatoda hidden /ustoz ariza oqimi saqlanadi', async () => {
    const username = `b03pr_${Date.now()}`;
    const res = await postRegister(supertest.agent(app), {
      username,
      email: `${username}@test.uz`,
      role: 'teacher',
      invite: 'bad<code>!',
    });
    expect(res.status).toBe(200);
    expect(res.text).toContain('id="reg-university"');
    expect(res.text).toMatch(/name="role" value="teacher"/);
    expect(res.text).not.toContain('role-grid');
  });

  it('qisqa ism → xato name maydoniga tegishli', async () => {
    const username = `b03n_${Date.now()}`;
    const res = await postRegister(supertest.agent(app), {
      username,
      email: `${username}@test.uz`,
      name: 'A',
    });
    expect(res.status).toBe(200);
    expect(res.text).not.toContain('role-grid'); // student-only register sahifasi
    expect(res.text).toContain('data-field="name"');
    // data-field marker register validation error ekanini ko'rsatadi.
    const snap = await fb.get(`users/${safeKey(username)}`);
    expect(snap.exists()).toBe(false);
  });
});
