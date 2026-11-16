/**
 * AUTH B-10 — Google register + rol modal (to'liq)
 * ------------------------------------------------------------
 *  Flow: /auth/google → callback → YANGI user (needsSetup) →
 *        session.pendingGoogle → /user/google-setup (rol modal) →
 *        POST role → account yaratiladi → role bo'yicha redirect.
 *
 *  completeOidcLogin mock'lanadi (token exchange/network'siz) — callback
 *  qolgan qismi (pendingGoogle sessiyasi, redirect) REAL ishlaydi.
 *
 *  Testlar:
 *   1. callback → /user/google-setup redirect; sahifa welcome + role kartalar + prefill
 *   2. POST role=student → 302 /user/panel; account (google:{sub}) yaratilgan + verified
 *   3. POST role=teacher → 302 /user/teacher-approval; account teacher_pending
 *   4. POST role=admin → rad (rol allowlist) — account yaratilmaydi
 *   5. pendingGoogle yo'q → /user/google-setup 302 /user/login
 *   6. Bekor qilish (cancel) → 302 /user/login + pending tozalanadi
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { snapshotDb, restoreDb } from '../helpers/setup.js';

// Google OIDC konfiguratsiyasi — fixed port (redirect_uri EXACT match uchun).
// vi.hoisted: env.js'ga import (setup.js → server.js → env.js hoisted bo'ladi)
// BURUN ishlashi uchun env'lar eng balandga ko'tariladi.
const PORT = vi.hoisted(() => 34770);
vi.hoisted(() => {
  process.env.GOOGLE_CLIENT_ID = 'b10-test.apps.googleusercontent.com';
  process.env.GOOGLE_CLIENT_SECRET = 'b10-test-secret';
  process.env.GOOGLE_REDIRECT_URI = 'http://localhost:34770/auth/google/callback';
});

// Yangi Google user — account YARATILMAYDI, needsSetup → rol modal
let mockGoogleUser = {
  sub: 'gsub-b10-1', email: 'b10-1@test.uz', emailVerified: true,
  name: 'B10 User', picture: '',
};
vi.mock('../../src/modules/auth/oidc.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    completeOidcLogin: vi.fn(async () => ({
      success: true,
      needsSetup: true,
      googleUser: mockGoogleUser,
    })),
  };
});

let app;
let httpServer;
let base;

beforeAll(async () => {
  await snapshotDb();
  const { createApp } = await import('../../server.js');
  const created = await createApp();
  app = created.app;
  httpServer = created.httpServer;
  await new Promise((r) => httpServer.listen(PORT, r));
  base = `http://localhost:${PORT}`;
});

afterAll(async () => {
  await restoreDb();
  await new Promise((r) => httpServer.close(r));
});

function freshGoogle(tag) {
  const stamp = Date.now() % 1000000;
  mockGoogleUser = {
    sub: `gsub-${tag}-${stamp}`,
    email: `b10-${tag}-${stamp}@test.uz`,
    emailVerified: true,
    name: `User ${tag}`,
    picture: '',
  };
  return mockGoogleUser;
}

async function runCallback(agent) {
  // A-24 §8 redirect_uri EXACT match — Host header GOOGLE_REDIRECT_URI'ga mos bo'lishi kerak
  return agent
    .get('/auth/google/callback?code=test-code&state=test-state')
    .set('Host', `localhost:${PORT}`);
}

async function setupCsrf(agent) {
  const page = await agent.get('/user/google-setup');
  const m = page.text.match(/name="_csrf"\s+value="([^"]+)"/);
  return { page, csrf: m ? m[1] : '' };
}

describe('AUTH B-10 — Google rol modal (2-qadam)', () => {
  it('callback → /user/google-setup; sahifa welcome + role kartalar + email prefill', async () => {
    const agent = (await import('supertest')).default.agent(app);
    freshGoogle('flow');

    const cb = await runCallback(agent);
    expect(cb.status).toBe(302);
    expect(cb.headers.location).toContain('/user/google-setup');

    const page = await agent.get('/user/google-setup');
    expect(page.status).toBe(200);
    expect(page.text).toContain('Xush kelibsiz');
    expect(page.text).toContain(mockGoogleUser.email);
    expect(page.text).toContain('name="role" value="student"');
    expect(page.text).toContain('name="role" value="teacher"');
    // invite field mavjud
    expect(page.text).toContain('id="gs-invite"');
  });

  it('POST role=student → 302 /user/panel; account yaratilgan + verified', async () => {
    const supertest = await import('supertest');
    const agent = supertest.default.agent(app);
    freshGoogle('stu');
    await runCallback(agent);
    const { csrf } = await setupCsrf(agent);

    const post = await agent
      .post('/user/google-setup')
      .type('form')
      .send({ _csrf: csrf, lang: 'uz', role: 'student', invite: '' });
    expect(post.status).toBe(302);
    expect(post.headers.location).toContain('/user/panel');

    // Account yaratilganligini tekshiramiz
    const { fb } = await import('../../firebase/admin.js');
    const { safeKey } = await import('../../utils/helpers.js');
    const snap = await fb.get(`users/${safeKey(`google:${mockGoogleUser.sub}`)}`);
    expect(snap.exists()).toBe(true);
    expect(snap.val().role).toBe('student');
    expect(snap.val().email_verified).toBe(true);
    expect(snap.val().google_sub).toBe(mockGoogleUser.sub);
  });

  it('POST role=teacher → 302 teacher-approval; account teacher_pending', async () => {
    const supertest = await import('supertest');
    const agent = supertest.default.agent(app);
    freshGoogle('tea');
    await runCallback(agent);
    const { csrf } = await setupCsrf(agent);

    const post = await agent
      .post('/user/google-setup')
      .type('form')
      .send({ _csrf: csrf, lang: 'uz', role: 'teacher', invite: '' });
    expect(post.status).toBe(302);
    expect(post.headers.location).toContain('/user/teacher-approval');

    const { fb } = await import('../../firebase/admin.js');
    const { safeKey } = await import('../../utils/helpers.js');
    const snap = await fb.get(`users/${safeKey(`google:${mockGoogleUser.sub}`)}`);
    expect(snap.exists()).toBe(true);
    expect(snap.val().role).toBe('teacher_pending');
  });

  it('POST role=admin → rad (rol allowlist); account yaratilmaydi', async () => {
    const supertest = await import('supertest');
    const agent = supertest.default.agent(app);
    freshGoogle('adm');
    await runCallback(agent);
    const { csrf } = await setupCsrf(agent);

    const post = await agent
      .post('/user/google-setup')
      .type('form')
      .send({ _csrf: csrf, lang: 'uz', role: 'admin', invite: '' });
    expect(post.status).toBe(200); // re-render — xato ko'rsatiladi
    expect(post.text).toContain('id="form-gs"');

    const { fb } = await import('../../firebase/admin.js');
    const { safeKey } = await import('../../utils/helpers.js');
    const snap = await fb.get(`users/${safeKey(`google:${mockGoogleUser.sub}`)}`);
    expect(snap.exists()).toBe(false); // account yaratilmadi
  });

  it('pendingGoogle yo\'q bo\'lsa → /user/google-setup 302 /user/login', async () => {
    const supertest = await import('supertest');
    const agent = supertest.default.agent(app);
    const page = await agent.get('/user/google-setup');
    expect(page.status).toBe(302);
    expect(page.headers.location).toContain('/user/login');
  });

  it('Bekor qilish (cancel) → 302 /user/login + pending tozalanadi', async () => {
    const supertest = await import('supertest');
    const agent = supertest.default.agent(app);
    freshGoogle('cnl');
    await runCallback(agent);

    const page = await agent.get('/user/google-setup');
    const m = page.text.match(/name="_csrf"\s+value="([^"]+)"/);
    const csrf = m ? m[1] : '';
    const cancel = await agent
      .post('/user/google-setup/cancel')
      .type('form')
      .send({ _csrf: csrf });
    expect(cancel.status).toBe(302);
    expect(cancel.headers.location).toContain('/user/login');

    // pending tozalandi → keyingi GET login'ga qaytadi
    const after = await agent.get('/user/google-setup');
    expect(after.status).toBe(302);
  });
});
