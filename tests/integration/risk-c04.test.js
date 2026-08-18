/**
 * Edikit — AUTH C-04 Risk score service — Integration/contract tests
 * --------------------------------------------------------------------
 *  - yangi qurilmada password change → requireLowRisk step-up blok (403)
 *  - trusted qurilmada (device trust) → password change o'tadi (200)
 *  - risk audit: risk_scored / risk_stepup login'da yoziladi
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { snapshotDb, restoreDb } from '../helpers/setup.js';
import { createApp } from '../../server.js';
import { fb } from '../../firebase/admin.js';
import { safeKey } from '../../utils/helpers.js';
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
const FP = 'c04'.repeat(6); // 18 hex — valid

function csrfFrom(html) {
  const m = html.match(/name="_csrf"\s+value="([^"]+)"/) || html.match(/window\.__CSRF_TOKEN = '([^']+)'/);
  return m ? m[1] : '';
}

async function registerUser(agent, uname, fp, xff) {
  const page = await agent.get('/user/login');
  const csrf = csrfFrom(page.text);
  const res = await agent.post('/user/login')
    .set('x-forwarded-for', xff)
    .type('form')
    .send({
      _csrf: csrf, lang: 'uz', mode: 'reg', consent: 'on', username: uname, password: PW,
      email: `c04_${Date.now()}_${Math.floor(Math.random() * 1000000)}_a18@test.uz`,
      device_fp: fp,
    });
  expect(res.status).toBe(302);
}

async function login(agent, uname, fp, xff) {
  const page = await agent.get('/user/login');
  const csrf = csrfFrom(page.text);
  const res = await agent.post('/user/login')
    .set('x-forwarded-for', xff)
    .type('form')
    .send({ _csrf: csrf, lang: 'uz', username: uname, password: PW, device_fp: fp });
  return res;
}

async function setUserCreatedAt(uname, createdAt) {
  await fb.set(`users/${safeKey(uname)}/created_at`, createdAt);
}

describe('AUTH C-04 — risk score service', () => {
  it('yangi qurilma (new_device) → requireLowRisk step-up: password change 403 risk_stepup_required', async () => {
    const uname = `c04a_${Date.now() % 1000000}`;
    const xff = '203.0.113.40';
    const agent = supertest.agent(app);
    await registerUser(agent, uname, FP, xff);
    await setUserCreatedAt(uname, Date.now() - 2 * 24 * 3600 * 1000); // 2 kun — account_age

    // Qayta login (yangi session) — login'da risk hisoblanadi: yangi qurilma
    // (device record yo'q) + account_age → unknown/stepup
    const agent2 = supertest.agent(app);
    const lr = await login(agent2, uname, FP, xff);
    expect(lr.status).toBe(302);
    const panel = await agent2.get('/user/panel');
    const csrf = csrfFrom(panel.text);
    const res = await agent2.post('/api/password/change')
      .set('x-csrf-token', csrf)
      .send({ currentPassword: PW, newPassword: 'yangi-parol-2026-X' });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('risk_stepup_required');
  });

  it('trusted qurilma → requireLowRisk allow: password change 200', async () => {
    const uname = `c04b_${Date.now() % 1000000}`;
    const xff = '203.0.113.41';
    const agent = supertest.agent(app);
    await registerUser(agent, uname, FP, xff);

    // Device'ni trust qilamiz (to'g'ridan-to'g'ri DB — reauth kerak emas)
    await fb.set(`users/${safeKey(uname)}/devices/${FP}`, {
      first_seen: Date.now(), last_seen: Date.now(), last_city: 'Toshkent',
      last_ip_hash: 'x', trusted: true, risk_events: [],
    });

    const panel = await agent.get('/user/panel');
    const csrf = csrfFrom(panel.text);
    const res = await agent.post('/api/password/change')
      .set('x-csrf-token', csrf)
      .send({ currentPassword: PW, newPassword: 'yangi-parol-2026-Y' });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it('risk audit: login jarayonida risk_scored / stepup yoziladi (server-side signal)', async () => {
    const uname = `c04c_${Date.now() % 1000000}`;
    const xff = '203.0.113.42';
    const agent = supertest.agent(app);
    await registerUser(agent, uname, FP, xff);
    await setUserCreatedAt(uname, Date.now() - 2 * 24 * 3600 * 1000);

    // Yangi qurilma + account_age → login risk unknown (stepup)
    const res = await login(supertest.agent(app), uname, FP, xff);
    expect(res.status).toBe(302);

    const snap = await fb.get('auth_audit');
    const days = snap.val();
    const entries = Object.values(days).flatMap((d) => Object.values(d));
    const scored = entries.filter((e) => e.action === 'auth:risk:scored' || e.action === 'auth:risk:stepup');
    expect(scored.length).toBeGreaterThanOrEqual(1);
    const last = scored[scored.length - 1];
    expect(last.outcome).toBe('success');
    // Privacy: raw telemetry yo'q
    expect(JSON.stringify(last.detail)).not.toMatch(/canvas|webgl|plugins/i);
  });
});
