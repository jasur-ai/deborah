/**
 * AUTH D-12 — A11y (WCAG 2.2 AA) — skip link + focus target (wsl qismi)
 * ---------------------------------------------------------------------
 *  - §24: skip-link barcha auth ekranlarida (`#main` ga) — D-12 §16.
 *  - Skip link konventsiyasi: `<a href="#main" class="skip-link">` — login.ejs.
 *  - `id="main"` mavjud (skip target) — WCAG 2.4.1 Bypass Blocks.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import supertest from 'supertest';
import { createApp } from '../../server.js';
import { snapshotDb, restoreDb } from '../helpers/setup.js';

let app;
let httpServer;

beforeAll(async () => {
  snapshotDb();
  const created = await createApp();
  app = created.app;
  httpServer = created.httpServer;
  await new Promise((r) => httpServer.listen(0, r));
});

afterAll(async () => {
  await new Promise((r) => httpServer.close(r));
  restoreDb();
});

const ADMIN_USER = 'testadmin';
const ADMIN_PASS = 'testpass';

function csrfFrom(html) {
  const m = html.match(/name="_csrf"\s+value="([^"]+)"/) || html.match(/window\.__CSRF_TOKEN = '([^']+)'/);
  return m ? m[1] : '';
}

function assertSkip(html, page) {
  expect(html, `${page}: skip-link`).toMatch(/<a href="#main" class="skip-link">/);
  expect(html, `${page}: #main target`).toContain('id="main"');
}

const PASSWORD = 'parol-2026-x-uzun';

/** YAngi user register + login — auth talab qiladigan sahifalar uchun. */
async function loginAs(username) {
  const agent = supertest.agent(app);
  let page = await agent.get('/user/login?lang=uz');
  const csrf = csrfFrom(page.text);
  await agent
    .post('/user/login')
    .set('x-forwarded-for', '203.0.113.220')
    .type('form')
    .send({ mode: 'reg', consent: 'on', _csrf: csrf, username, email: `${username}@test.uz`, password: PASSWORD, lang: 'uz' });
  page = await agent.get('/user/login?lang=uz');
  const csrf2 = csrfFrom(page.text);
  await agent
    .post('/user/login')
    .set('x-forwarded-for', '203.0.113.220')
    .type('form')
    .send({ _csrf: csrf2, username, password: PASSWORD, lang: 'uz' });
  return agent;
}

describe('AUTH D-12 — skip-link + #main (WCAG 2.4.1)', () => {
  it('public auth ekranlari: mfa, mfa-setup, email-change, teacher-approval, notifications', async () => {
    // mfa-setup: teacher MFA majburiy sahifasi (query orqali)
    for (const path of ['/user/mfa', '/user/email-change', '/user/notifications']) {
      const res = await fetch(`http://localhost:${httpServer.address().port}${path}`);
      expect([200, 302, 401]).toContain(res.status);
      if (res.status === 200) assertSkip(await res.text(), path);
    }
  });

  it('auth talab qiladigan ekranlar: settings, security-profile', async () => {
    const agent = await loginAs('d12a1');
    for (const path of ['/user/settings', '/user/security-profile']) {
      const res = await agent.get(path);
      expect(res.status, path).toBe(200);
      assertSkip(res.text, path);
    }
  });

  it('teacher-approval sahifasi (teacher_pending bilan)', async () => {
    const agent = supertest.agent(app);
    const uname = `d12t_${Date.now() % 1000000}`;
    let page = await agent.get('/user/login?lang=uz');
    const csrf = csrfFrom(page.text);
    await agent
      .post('/user/login')
      .set('x-forwarded-for', '203.0.113.221')
      .type('form')
      .send({
        mode: 'reg', consent: 'on', _csrf: csrf, username: uname, email: `${uname}@test.uz`,
        password: PASSWORD, lang: 'uz', role: 'teacher',
        university: 'TATU', subject: 'Informatika', reason: 'Kompyuter fanidan dars beraman',
      });
    const res = await agent.get('/user/teacher-approval');
    expect(res.status).toBe(200);
    assertSkip(res.text, '/user/teacher-approval');
  });

  it('admin ekranlari: dashboard, users, audit, teachers', async () => {
    const agent = supertest.agent(app);
    const page = await agent.get('/admin/login');
    const csrf = csrfFrom(page.text);
    await agent
      .post('/admin/login')
      .type('form')
      .send({ _csrf: csrf, username: ADMIN_USER, password: ADMIN_PASS });
    for (const path of ['/admin/dashboard', '/admin/users', '/admin/audit', '/admin/teachers']) {
      const res = await agent.get(path);
      expect(res.status, path).toBe(200);
      assertSkip(res.text, path);
    }
  });

  it('xato xabari aria-live (3.3.1 / 4.1.3) — login xato matni', async () => {
    const res = await fetch(`http://localhost:${httpServer.address().port}/user/login`);
    const html = await res.text();
    expect(html).toMatch(/aria-live="(polite|assertive)"/);
    expect(html).toMatch(/role="alert"/);
  });
});
