/**
 * AUTH A-22 — NIST SP 800-63B parol siyosati + HIBP + parol o'zgartirish.
 *
 * Qamrov:
 *  - Register: zaif parol (min 15) rad; faqat harfli uzun parol QABUL (complexity yo'q);
 *    Unicode (emoji) qabul.
 *  - Teacher register: zxcvbn score < 4 → passwordWeak.
 *  - Parol o'zgartirish (POST /api/password/change): auth shart, joriy parol verify,
 *    reuse rad, zaif rad, muvaffaqiyat → eski parol ishlamaydi.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import supertest from 'supertest';
import { createApp } from '../../server.js';
import { snapshotDb, restoreDb } from '../helpers/setup.js';
import { fb } from '../../firebase/admin.js';

let app;
let httpServer;
let ipCounter = 60;

function nextIp() {
  ipCounter += 1;
  return `198.51.100.${ipCounter}`;
}

function csrfFrom(html) {
  const m = html.match(/name="_csrf" value="([^"]+)"/);
  return m ? m[1] : null;
}

async function registerUser(agent, { username, password, email, role, university, subject } = {}) {
  const page = await agent.get('/user/login?mode=reg');
  const csrf = csrfFrom(page.text);
  return agent
    .post('/user/login')
    .set('x-forwarded-for', nextIp())
    .type('form')
    .send({
      _csrf: csrf,
      lang: 'uz',
      mode: 'reg', consent: 'on',
      username,
      password,
      email,
      role,
      university,
      subject,
    });
}

describe('AUTH A-22 — NIST parol siyosati + HIBP + password change', () => {
  beforeAll(async () => {
    await snapshotDb();
    ({ app, httpServer } = await createApp());
    await new Promise((r) => httpServer.listen(0, r));
  });

  afterAll(async () => {
    await restoreDb();
    await new Promise((r) => httpServer.close(r));
  });

  it('register qisqa parol (7 belgi) → passwordMin xato (min 8, 2026-08-26)', async () => {
    const agent = supertest.agent(app);
    const uname = `a22w_${Date.now() % 1000000}`;
    const res = await registerUser(agent, {
      username: uname,
      password: 'par2olx', // 7 belgi
      email: `${uname}@test.uz`,
    });
    const html = res.text;
    expect(html).toContain("Parol kamida 8 ta belgi");
    expect(html).toContain('data-field="password"');
    // User yaratilmagan
    const snap = await fb.get(`users/${uname}`);
    expect(snap.exists()).toBe(false);
  });

  it('register faqat harfli uzun parol → RAD (harf+raqam shart, 2026-08-26)', async () => {
    const agent = supertest.agent(app);
    const uname = `a22l_${Date.now() % 1000000}`;
    const res = await registerUser(agent, {
      username: uname,
      password: 'faqatharflardaniboratparol', // 27 harf, raqam yo'q
      email: `${uname}@test.uz`,
    });
    const html = res.text;
    expect(html).toContain('bitta harf va bitta raqam');
    const snap = await fb.get(`users/${uname}`);
    expect(snap.exists()).toBe(false);
  });

  it('register maxsus belgili parol → QABUL (belgi cheklovi YO\'Q)', async () => {
    const agent = supertest.agent(app);
    const uname = `a22s_${Date.now() % 1000000}`;
    const res = await registerUser(agent, {
      username: uname,
      password: 'Parol!@#2026', // harf+raqam+istalgan belgilar
      email: `${uname}@test.uz`,
    });
    expect(res.status).toBe(302);
    const snap = await fb.get(`users/${uname}`);
    expect(snap.exists()).toBe(true);
  });

  it('register Unicode parol (emoji+harf+raqam) → QABUL (code point hisobi)', async () => {
    const agent = supertest.agent(app);
    const uname = `a22u_${Date.now() % 1000000}`;
    const res = await registerUser(agent, {
      username: uname,
      password: '😀😀😀😀parol2026', // emoji + harf + raqam
      email: `${uname}@test.uz`,
    });
    expect(res.status).toBe(302);
    const snap = await fb.get(`users/${uname}`);
    expect(snap.exists()).toBe(true);
  });

  it('teacher register zaif-lekin-uzun parol → passwordWeak (zxcvbn score < 4)', async () => {
    const agent = supertest.agent(app);
    const uname = `a22t_${Date.now() % 1000000}`;
    const res = await registerUser(agent, {
      username: uname,
      password: 'aaaaaaaaaaaaaaaa1', // uzun + raqam, lekin zxcvbn juda past
      email: `${uname}@test.uz`,
      role: 'teacher',
      university: 'Toshkent Davlat Universiteti', // B-29: teacher maydonlari majburiy
      subject: 'Matematika',
    });
    const html = res.text;
    expect(html).toContain('bitta harf va bitta raqam');
    const snap = await fb.get(`users/${uname}`);
    expect(snap.exists()).toBe(false);
  });

  describe('POST /api/password/change', () => {
    let agent;
    let uname;
    const current = 'parol-2026-x-uzun';
    const fresh = 'YangiKuchliParol-2026-XX';

    // Session'dagi CSRF token'ni sahifadan ajratib olish (head.ejs window.__CSRF_TOKEN)
    async function sessionCsrf(a) {
      const page = await a.get('/user/panel');
      const m = page.text.match(/window\.__CSRF_TOKEN = '([^']+)'/);
      return m ? m[1] : null;
    }

    beforeAll(async () => {
      agent = supertest.agent(app);
      uname = `a22c_${Date.now() % 1000000}`;
      await registerUser(agent, {
        username: uname,
        password: current,
        email: `${uname}@test.uz`,
      });
    });

    it('authsiz → 401 (CSRF o\'tadi, lekin session user yo\'q)', async () => {
      // Yangi session (login'siz) — CSRF token olamiz, keyin login'siz POST
      const anon = supertest.agent(app);
      const loginPage = await anon.get('/user/login');
      const csrf = csrfFrom(loginPage.text);
      const res = await anon
        .post('/api/password/change')
        .set('x-csrf-token', csrf)
        .send({ currentPassword: current, newPassword: fresh });
      expect(res.status).toBe(401);
    });

    it('noto\'g\'ri joriy parol → 403 (OWASP abuse case)', async () => {
      const csrf = await sessionCsrf(agent);
      const res = await agent
        .post('/api/password/change')
        .set('x-csrf-token', csrf)
        .send({ currentPassword: 'noto-gri-parol', newPassword: fresh });
      expect(res.status).toBe(403);
      expect(res.body.error).toBe('current-password');
    });

    it('yangi parol eski bilan bir xil → 400 passwordReuse', async () => {
      const csrf = await sessionCsrf(agent);
      const res = await agent
        .post('/api/password/change')
        .set('x-csrf-token', csrf)
        .send({ currentPassword: current, newPassword: current });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('passwordReuse');
    });

    it('zaif yangi parol → 400 passwordMin', async () => {
      const csrf = await sessionCsrf(agent);
      const res = await agent
        .post('/api/password/change')
        .set('x-csrf-token', csrf)
        .send({ currentPassword: current, newPassword: 'qisqa' });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('passwordMin');
    });

    it('muvaffaqiyat: parol almashtiriladi — eski parol ishlamaydi', async () => {
      const csrf = await sessionCsrf(agent);
      const res = await agent
        .post('/api/password/change')
        .set('x-csrf-token', csrf)
        .send({ currentPassword: current, newPassword: fresh });
      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);

      // DB'da yangi hash — eski parol endi yaroqsiz
      const snap = await fb.get(`users/${uname}/password`);
      const storedHash = snap.val();
      expect(storedHash.startsWith('$argon2')).toBe(true);

      // Login eski parol bilan → muvaffaqiyatsiz (xato sahifa 200)
      const oldAgent = supertest.agent(app);
      const p1 = await oldAgent.get('/user/login');
      const oldCsrf = csrfFrom(p1.text);
      const badLogin = await oldAgent
        .post('/user/login')
        .set('x-forwarded-for', nextIp())
        .type('form')
        .send({ _csrf: oldCsrf, lang: 'uz', mode: 'login', username: uname, password: current });
      expect(badLogin.status).toBe(200);

      // Yangi parol bilan → muvaffaqiyatli redirect (302)
      const newAgent = supertest.agent(app);
      const p2 = await newAgent.get('/user/login');
      const newCsrf = csrfFrom(p2.text);
      const goodLogin = await newAgent
        .post('/user/login')
        .set('x-forwarded-for', nextIp())
        .type('form')
        .send({ _csrf: newCsrf, lang: 'uz', mode: 'login', username: uname, password: fresh });
      expect(goodLogin.status).toBe(302);
    });
  });
});
