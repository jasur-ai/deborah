/**
 * AUTH B-09 — Duplicate account handling (UX + login prefill)
 * ------------------------------------------------------------
 *  1. Band username'ga register → "Akkauntingiz borga o'xshaydi" (duplicate)
 *     + [Kirish] + [Parolni unutdingizmi?] havolalari (account prefilled)
 *  2. Band email'ga register → AYNAN bir xil duplicate UX (enumeration)
 *  3. /user/login?account=... → login maydoni oldindan to'ldirilgan
 *  4. /user/forgot?account=... → forgot maydoni oldindan to'ldirilgan
 *  5. Muvaffaqiyatli login duplicate havola orqali ishlaydi
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { snapshotDb, restoreDb } from '../helpers/setup.js';
import { createApp } from '../../server.js';
import supertest from 'supertest';

let app;
let httpServer;
let base;

beforeAll(async () => {
  await snapshotDb();
  const created = await createApp();
  app = created.app;
  httpServer = created.httpServer;
  await new Promise((r) => httpServer.listen(0, r));
  base = `http://localhost:${httpServer.address().port}`;
});

afterAll(async () => {
  await restoreDb();
  await new Promise((r) => httpServer.close(r));
});

const PW = 'parol-2026-x-uzun';

function ipFor(seed) {
  return `203.0.113.${(seed % 200) + 10}`;
}

async function getCsrf(agent) {
  const res = await agent.get('/user/login');
  const m = res.text.match(/name="_csrf"\s+value="([^"]+)"/);
  return m ? m[1] : '';
}

async function postRegister(agent, { username, email, password = PW, ip = ipFor(Math.floor(Math.random() * 1000)) }) {
  const csrf = await getCsrf(agent);
  return agent
    .post('/user/login')
    .type('form')
    .send({ _csrf: csrf, lang: 'uz', mode: 'reg', consent: 'on', username, email, password })
    .set('x-forwarded-for', ip);
}

describe('AUTH B-09 — duplicate register UX', () => {
  it('band username → duplicate xabar + Kirish + Parolni unutdingizmi?', async () => {
    const stamp = Date.now() % 1000000;
    const uname = `b09u_${stamp}`;
    const email = `b09u_${stamp}@test.uz`;

    // Avval account yaratamiz
    const r1 = await postRegister(supertest.agent(app), { username: uname, email, ip: ipFor(1) });
    expect(r1.status).toBe(302);

    // Boshqa email bilan SAME username'ga register → duplicate
    const r2 = await postRegister(supertest.agent(app), {
      username: uname,
      email: `b09u_${stamp}_x@test.uz`,
      ip: ipFor(2),
    });
    expect(r2.status).toBe(200);
    // i18n duplicate matni (uz): "Bu akkaunt allaqachon mavjud — ..."
    expect(r2.text).toContain('allaqachon mavjud');
    // [Kirish] havola — account prefilled
    expect(r2.text).toContain(`/user/login?lang=uz&account=${encodeURIComponent(`b09u_${stamp}_x@test.uz`)}`);
    // [Parolni unutdingizmi?]
    expect(r2.text).toContain('/user/forgot?lang=uz&account=');
  });

  it('band email → AYNAN bir xil duplicate UX (enumeration)', async () => {
    const stamp = Date.now() % 1000000;
    const uname = `b09e_${stamp}`;
    const email = `b09e_${stamp}@test.uz`;
    await postRegister(supertest.agent(app), { username: uname, email, ip: ipFor(3) });

    // Boshqa username bilan SAME email → duplicate (emailTaken emas)
    const r2 = await postRegister(supertest.agent(app), {
      username: `b09e_${stamp}_y`,
      email,
      ip: ipFor(4),
    });
    expect(r2.status).toBe(200);
    // BIR XIL duplicate matn (username bilan bir xil — enumeration)
    expect(r2.text).toContain('allaqachon mavjud');
    expect(r2.text).toContain(`/user/login?lang=uz&account=${encodeURIComponent(email)}`);
  });

  it('duplicate havola orqali login ishlaydi (account prefilled)', async () => {
    const stamp = Date.now() % 1000000;
    const uname = `b09l_${stamp}`;
    const email = `b09l_${stamp}@test.uz`;
    await postRegister(supertest.agent(app), { username: uname, email, ip: ipFor(5) });

    // Login sahifasi ?account= bilan — maydon prefilled
    const agent = supertest.agent(app);
    const page = await agent.get(`/user/login?lang=uz&account=${encodeURIComponent(email)}`);
    expect(page.status).toBe(200);
    expect(page.text).toContain(`value="${email}"`);

    // Prefilled account bilan login POST
    const csrf = await getCsrf(agent);
    const login = await agent
      .post('/user/login')
      .type('form')
      .send({ _csrf: csrf, lang: 'uz', mode: 'login', username: email, password: PW })
      .set('x-forwarded-for', ipFor(6));
    expect(login.status).toBe(302);
  });

  it('/user/forgot?account= → forgot maydoni prefilled', async () => {
    const stamp = Date.now() % 1000000;
    const email = `b09f_${stamp}@test.uz`;
    const page = await supertest.agent(app).get(`/user/forgot?lang=uz&account=${encodeURIComponent(email)}`);
    expect(page.status).toBe(200);
    expect(page.text).toContain(`value="${email}"`);
  });
});
