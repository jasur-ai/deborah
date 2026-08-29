/**
 * Deborah — AUTH C-06 Credential stuffing + OTP bombing — Integration tests
 * --------------------------------------------------------------------------
 *  - verify/send OTP bomb: 3+ send → 429 (per-user)
 *  - login stuffing: 10 turli account fail (bir IP) → block javob
 *  - audit: auth:abuse:* yoziladi
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { snapshotDb, restoreDb } from '../helpers/setup.js';
import { createApp } from '../../server.js';
import { fb } from '../../firebase/admin.js';
import supertest from 'supertest';

let app;
let httpServer;

beforeAll(async () => {
  await snapshotDb();
  const created = await createApp();
  app = created.app;
  httpServer = created.httpServer;
  await new Promise((r) => httpServer.listen(0, r));
});

afterAll(async () => {
  await restoreDb();
  await new Promise((r) => httpServer.close(r));
});

const PW = 'sirli-parol-2026';

function csrfFrom(html) {
  const m = html.match(/name="_csrf"\s+value="([^"]+)"/) || html.match(/window\.__CSRF_TOKEN = '([^']+)'/);
  return m ? m[1] : '';
}

async function registerUser(agent, uname, xff) {
  const page = await agent.get('/user/login');
  const csrf = csrfFrom(page.text);
  const res = await agent.post('/user/login')
    .set('x-forwarded-for', xff)
    .type('form')
    .send({
      _csrf: csrf, lang: 'uz', mode: 'reg', consent: 'on', username: uname, password: PW,
      email: `c06_${Date.now()}_${Math.floor(Math.random() * 1000000)}_a18@test.uz`,
    });
  expect(res.status).toBe(302);
}

async function authAuditEntries() {
  const snap = await fb.get('auth_audit');
  if (!snap.exists()) return [];
  const days = snap.val();
  return Object.values(days).flatMap((d) => Object.values(d));
}

describe('AUTH C-06 — credential stuffing + OTP bombing', () => {
  it('verify/send OTP bomb: 3 send o`tadi, 4-chisi 429 (per-user)', async () => {
    const uname = `c06a_${Date.now() % 1000000}`;
    const agent = supertest.agent(app);
    await registerUser(agent, uname, '203.0.113.70');

    const panel = await agent.get('/user/panel');
    const csrf = csrfFrom(panel.text);
    const statuses = [];
    for (let i = 0; i < 4; i++) {
      const r = await agent.post('/api/auth/verify/send')
        .set('x-csrf-token', csrf)
        .send({});
      statuses.push(r.status);
    }
    // Redis mavjud bo'lmasa test muhitida fail-open (barchasi 200 bo'lishi mumkin)
    if (process.env.REDIS_URL) {
      expect(statuses.slice(0, 3).every((s) => s < 400)).toBe(true);
      expect(statuses[3]).toBe(429);
      const entries = await authAuditEntries();
      const bomb = entries.filter((e) => e.action === 'auth:abuse:otp_bomb');
      expect(bomb.length).toBeGreaterThanOrEqual(1);
    } else {
      // Fail-open: hech bo'lmasa 4-chi request ham 500 bo'lmasin
      expect(statuses[3]).not.toBe(500);
    }
  });

  it('stuffing: 10 turli account fail (bir IP) → blok + auth:abuse audit', async () => {
    const xff = '203.0.113.71';
    // 10 ta turli (mavjud bo'lmagan) username'da fail — bir IP'dan
    for (let i = 0; i < 10; i++) {
      const agent = supertest.agent(app);
      const page = await agent.get('/user/login');
      const csrf = csrfFrom(page.text);
      await agent.post('/user/login')
        .set('x-forwarded-for', xff)
        .type('form')
        .send({ _csrf: csrf, lang: 'uz', username: `c06_missing_${i}_${Date.now() % 1000}`, password: 'xato-parol' });
    }
    // 11-chisi — stuffing block qaytishi kerak (Redis bo'lsa)
    const agent = supertest.agent(app);
    const page = await agent.get('/user/login');
    const csrf = csrfFrom(page.text);
    const res = await agent.post('/user/login')
      .set('x-forwarded-for', xff)
      .type('form')
      .send({ _csrf: csrf, lang: 'uz', username: 'c06_last', password: 'xato-parol' });
    if (process.env.REDIS_URL) {
      // Blok 200 (login sahifasi error bilan) yoki 429 bo'lishi mumkin
      expect([200, 403, 429]).toContain(res.status);
      const entries = await authAuditEntries();
      const abuse = entries.filter((e) => e.action === 'auth:abuse:blocked' || e.action === 'auth:abuse:stuffing');
      expect(abuse.length).toBeGreaterThanOrEqual(1);
    } else {
      expect(res.status).not.toBe(500);
    }
  });

  it('privacy: parol audit/logda emas', async () => {
    const entries = await authAuditEntries();
    const allText = JSON.stringify(entries);
    // Parol hech qachon log'da
    expect(allText).not.toContain('xato-parol');
    expect(allText).not.toContain('sirli-parol-2026');
  });
});
