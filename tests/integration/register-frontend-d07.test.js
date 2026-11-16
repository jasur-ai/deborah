/**
 * Deborah — D-07 Register frontend — Integration/contract tests
 * ------------------------------------------------------------
 *  - GET /user/register → D-07 elementlar (live check status, honeypot, rol)
 *  - POST /user/login (mode=reg) → success submit (redirect/200)
 *  - Xato → inline error (data-field + aria-invalid) sahifaga qaytadi
 *  - Email xato → data-field="email" (B-03 konventsiyasi)
 *  - CSRF talab qilinadi (403)
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import supertest from 'supertest';
import { createApp } from '../../server.js';
import { snapshotDb, restoreDb } from '../helpers/setup.js';
import { fb } from '../../firebase/admin.js';
import { safeKey } from '../../utils/helpers.js';

let ipCounter = 400;
function nextIp() {
  // IPv4 okteti <= 255 — express-rate-limit noto'g'ri IP'ni rad etadi
  ipCounter = 200 + ((ipCounter - 200 + 1) % 54);
  return `198.51.100.${ipCounter}`;
}

let app;
let httpServer;

function csrfFrom(html) {
  const m = html.match(/name="_csrf" value="([^"]+)"/);
  return m ? m[1] : null;
}

async function getRegisterPage(agent) {
  return agent.get('/user/register?lang=uz');
}

describe('D-07 — Register frontend (integration)', () => {
  beforeAll(async () => {
    await snapshotDb();
    ({ app, httpServer } = await createApp());
    await new Promise((r) => httpServer.listen(0, r));
  });
  afterAll(async () => {
    await restoreDb();
    await new Promise((r) => httpServer.close(r));
  });

  it('GET /user/register → D-07 frontend elementlari render', async () => {
    const res = await supertest(app).get('/user/register?lang=uz');
    expect(res.status).toBe(200);
    // D-07: live email check + honeypot + rol + strength
    expect(res.text).toContain('id="reg-email"');
    expect(res.text).toContain('email-status');
    expect(res.text).toContain('reg-website');
    expect(res.text).toContain('id="reg-password"');
    expect(res.text).toContain('pw-strength');
    expect(res.text).toContain('id="invite-toggle"');
    expect(res.text).toContain('role-card');
    // register.js + zxcvbn yuklanadi (defer)
    expect(res.text).toContain('/js/register.js');
    expect(res.text).toContain('/js/vendor/zxcvbn.js');
    // CSRF token bor
    expect(csrfFrom(res.text)).toBeTruthy();
  });

  it('register submit → muvaffaqiyat (mode=reg, role=student)', async () => {
    const agent = supertest.agent(app);
    const page = await getRegisterPage(agent);
    const csrf = csrfFrom(page.text);
    const username = `d07s_${Date.now() % 1000000000}`;
    const res = await agent.post('/user/login')
      .set('x-forwarded-for', nextIp())
      .type('form')
      .send({
        mode: 'reg', consent: 'on', _csrf: csrf, lang: 'uz',
        username,
        email: `${username}@test.uz`,
        password: 'parol-2026-x-uzun',
        role: '',
        name: 'D-07 Student',
      });
    expect([200, 302]).toContain(res.status);
    const snap = await fb.get(`users/${safeKey(username)}`);
    expect(snap.exists()).toBe(true);
    expect(snap.val().role || 'student').toBe('student');
  });

  it('register submit (role=teacher) → teacher_pending', async () => {
    const agent = supertest.agent(app);
    const page = await getRegisterPage(agent);
    const csrf = csrfFrom(page.text);
    const username = `d07t_${Date.now() % 1000000000}`;
    const res = await agent.post('/user/login')
      .set('x-forwarded-for', nextIp())
      .type('form')
      .send({
        mode: 'reg', consent: 'on', _csrf: csrf, lang: 'uz',
        username,
        email: `${username}@test.uz`,
        password: 'parol-2026-x-uzun',
        role: 'teacher',
        university: 'TATU',
        subject: 'Matematika',
        experience: 3,
        name: 'D-07 Teacher',
      });
    expect([200, 302]).toContain(res.status);
    const snap = await fb.get(`users/${safeKey(username)}`);
    expect(snap.exists()).toBe(true);
    const rec = snap.val();
    // B-03 konventsiyasi: role='teacher_pending' + teacher_application ariza
    expect(rec.role).toBe('teacher_pending');
    expect(rec.teacher_application).toBeDefined();
  });

  it('duplicate username → inline error (data-field="username") sahifaga qaytadi', async () => {
    const username = `d07dup_${Date.now() % 1000000000}`;
    // Birinchi register — alohida agent (B-09 konventsiyasi: har POST yangi agent)
    const a1 = supertest.agent(app);
    const p1 = await getRegisterPage(a1);
    const r1 = await a1.post('/user/login')
      .set('x-forwarded-for', nextIp())
      .type('form')
      .send({
        mode: 'reg', consent: 'on', _csrf: csrfFrom(p1.text), lang: 'uz',
        username,
        email: `${username}@test.uz`,
        password: 'parol-2026-x-uzun',
        role: '',
      });
    expect([200, 302]).toContain(r1.status);
    // Ikkinchi — shu username bilan (yangi agent, yangi CSRF)
    const a2 = supertest.agent(app);
    const p2 = await getRegisterPage(a2);
    const res = await a2.post('/user/login')
      .set('x-forwarded-for', nextIp())
      .type('form')
      .send({
        mode: 'reg', consent: 'on', _csrf: csrfFrom(p2.text), lang: 'uz',
        username,
        email: `${username}2@test.uz`,
        password: 'parol-2026-x-uzun',
        role: '',
      });
    expect(res.status).toBe(200);
    // Inline error: data-field + err-text (client register.js ko'rsatadi)
    expect(res.text).toContain('data-field="username"');
    expect(res.text).toContain('err-reg-username');
  });

  it('disposable email → inline error (data-field="email")', async () => {
    const agent = supertest.agent(app);
    const page = await getRegisterPage(agent);
    const csrf = csrfFrom(page.text);
    const res = await agent.post('/user/login')
      .set('x-forwarded-for', nextIp())
      .type('form')
      .send({
        mode: 'reg', consent: 'on', _csrf: csrf, lang: 'uz',
        username: `d07dis_${Date.now() % 1000000000}`,
        email: 'user@mailinator.com',
        password: 'parol-2026-x-uzun',
        role: '',
      });
    expect(res.status).toBe(200);
    expect(res.text).toContain('data-field="email"');
  });

  it('CSRF yo\'q → 403', async () => {
    const res = await supertest(app).post('/user/login').type('form').send({
      mode: 'reg', consent: 'on', lang: 'uz',
      username: 'nocsrf', email: 'nocsrf@test.uz',
      password: 'parol-2026-x-uzun', role: '',
    });
    expect(res.status).toBe(403);
  });

  it('honeypot website to\'ldirilgan → rad etiladi (A-21)', async () => {
    const agent = supertest.agent(app);
    const page = await getRegisterPage(agent);
    const csrf = csrfFrom(page.text);
    const username = `d07hp_${Date.now() % 1000000000}`;
    const res = await agent.post('/user/login')
      .set('x-forwarded-for', nextIp())
      .type('form')
      .send({
        mode: 'reg', consent: 'on', _csrf: csrf, lang: 'uz',
        username,
        email: `${username}@test.uz`,
        password: 'parol-2026-x-uzun',
        role: '',
        website: 'http://spam.example', // honeypot to'ldirildi
      });
    // Bot bloklanadi — account yaratilmaydi. Server silent success (redirect)
    const snap = await fb.get(`users/${safeKey(username)}`);
    expect(snap.exists()).toBe(false);
    expect([200, 302, 403]).toContain(res.status);
  });
});
