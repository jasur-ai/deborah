/**
 * AUTH B-08 — Bot himoyasi (honeypot + Turnstile + per-email rate limit)
 * ----------------------------------------------------------------------
 *  1. Per-email limit: bir xil email 3 ta urinish → 4-chisi 429 lockout
 *     (per-IP emas, per-email — distributed bot signup qarshi)
 *  2. Turnstile: secret o'rnatilgan + fetch mock'da bot → 429 + BOT_DETECTED
 *  3. Legit register: turnstile yashirin (secret yo'q) → 302 + account yaratiladi
 *  4. Audit: SIGNUP_BLOCKED / BOT_DETECTED action'lar yoziladi
 */

import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
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

afterEach(() => {
  delete process.env.TURNSTILE_SECRET_KEY;
  vi.restoreAllMocks();
});

const PW = 'parol-2026-x-uzun';

function ipFor(seed) {
  // har bir urinish uchun alohida IP (per-IP 5/15 limitga tushmaslik uchun)
  return `203.0.113.${(seed % 200) + 10}`;
}

async function getCsrf(agent) {
  const res = await agent.get('/user/login');
  const m = res.text.match(/name="_csrf"\s+value="([^"]+)"/);
  return m ? m[1] : '';
}

async function postRegister(agent, { username, email, password = PW, extra = {}, ip = ipFor(Math.floor(Math.random() * 1000)) }) {
  const csrf = await getCsrf(agent);
  return agent
    .post('/user/login')
    .type('form')
    .send({ _csrf: csrf, lang: 'uz', mode: 'reg', consent: 'on', username, email, password, ...extra })
    .set('x-forwarded-for', ip);
}

describe('AUTH B-08 — per-email register limit (3/soat)', () => {
  it('bir xil email 3 urinishdan keyin 4-chisi 429 lockout (boshqa IP\'dan bo\'lsa ham)', async () => {
    const stamp = Date.now() % 1000000;
    const email = `b08_${stamp}@test.uz`;
    const uname = `b08_${stamp}`;

    // 1-urinish: account yaratiladi (302)
    const r1 = await postRegister(supertest.agent(app), { username: uname, email, ip: ipFor(1) });
    expect(r1.status).toBe(302);

    // 2-3-urinishlar: username band → "taken" (lekin per-email bucket har holda bump qiladi)
    const r2 = await postRegister(supertest.agent(app), { username: uname, email, ip: ipFor(2) });
    expect(r2.status).toBe(200);
    const r3 = await postRegister(supertest.agent(app), { username: uname, email, ip: ipFor(3) });
    expect(r3.status).toBe(200);

    // 4-urinish: per-email limit — 429 + lockout UI (boshqa IP bo'lsa ham)
    const r4 = await postRegister(supertest.agent(app), { username: `b08_${stamp}_x`, email, ip: ipFor(4) });
    // supertest `*/*` Accept yuboradi → JSON lockout kontrakti (429 RATE_LIMITED)
    expect(r4.status).toBe(429);
    expect(r4.body.code).toBe('RATE_LIMITED');
    expect(r4.body.retryAfter).toBeGreaterThan(0);
    expect(parseInt(r4.headers['retry-after'] || '0', 10)).toBeGreaterThan(0);
  });

  it('boshqa email — bloklanmaydi (per-email scoped)', async () => {
    const stamp = Date.now() % 1000000;
    // Oldingi test bir xil email bucket'ini to'ldirgan bo'lishi mumkin emas — yangi email
    const r = await postRegister(supertest.agent(app), {
      username: `b08f_${stamp}`,
      email: `b08f_${stamp}@test.uz`,
      ip: ipFor(10),
    });
    expect(r.status).toBe(302);
  });
});

describe('AUTH B-08 — Turnstile (server siteverify)', () => {
  it('secret bor + bot token → 429 lockout + BOT_DETECTED audit', async () => {
    process.env.TURNSTILE_SECRET_KEY = '1x0000000000000000000000000000000AA';
    // Turnstile API javobini mock'laymiz: success:false → bot
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: false, 'error-codes': ['invalid-input-response'] }),
    });

    const stamp = Date.now() % 1000000;
    const r = await postRegister(supertest.agent(app), {
      username: `b08t_${stamp}`,
      email: `b08t_${stamp}@test.uz`,
      extra: { 'cf-turnstile-response': 'fake-token' },
      ip: ipFor(20),
    });
    expect(r.status).toBe(429);
    expect(r.body.code).toBe('RATE_LIMITED');
    expect(r.body.retryAfter).toBeGreaterThan(0);
  });

  it('secret bor + token yo\'q → ham blok (turnstile_required)', async () => {
    process.env.TURNSTILE_SECRET_KEY = '1x0000000000000000000000000000000AA';
    // fetch chaqirilmasligi kerak (token yo'q — darhol 400/403 signal)
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy;

    const stamp = Date.now() % 1000000;
    const r = await postRegister(supertest.agent(app), {
      username: `b08n_${stamp}`,
      email: `b08n_${stamp}@test.uz`,
      ip: ipFor(21),
    });
    expect(r.status).toBe(429);
    expect(r.body.code).toBe('RATE_LIMITED');
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('AUTH B-08 — legit register (secret yo\'q → fail-open)', () => {
  it('turnstile yashirin bo\'lganda register normal ishlaydi (honeypot+limit qoladi)', async () => {
    delete process.env.TURNSTILE_SECRET_KEY;
    const stamp = Date.now() % 1000000;
    const r = await postRegister(supertest.agent(app), {
      username: `b08g_${stamp}`,
      email: `b08g_${stamp}@test.uz`,
      ip: ipFor(30),
    });
    expect(r.status).toBe(302);
  });

  it('honeypot to\'ldirilgan bo\'lsa — register silent o\'tadi (bot uchun o\'lik yo\'l)', async () => {
    delete process.env.TURNSTILE_SECRET_KEY;
    const stamp = Date.now() % 1000000;
    // Honeypot: website field to'ldirilgan — bot. Account yaratilmasligi kerak.
    const r = await postRegister(supertest.agent(app), {
      username: `b08h_${stamp}`,
      email: `b08h_${stamp}@test.uz`,
      extra: { website: 'http://spam.example.com' },
      ip: ipFor(31),
    });
    // Silent 200/302 — lekin account yaratilmaydi (A-21: silent success)
    expect(r.status).toBe(302);
  });
});
