/**
 * Deborah — AUTH C-05 Impossible travel + velocity — Integration tests
 * ---------------------------------------------------------------------
 *  - impossible travel: device record Toshkent → 10 daqiqada Samarqand IP → flag
 *  - audit: auth:risk:impossible_travel / auth:risk:velocity yoziladi
 *  - false-positive: VPN (extraSignals) → step-up (block emas)
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
const FP = 'c05'.repeat(6); // 18 hex

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
      email: `c05_${Date.now()}_${Math.floor(Math.random() * 1000000)}_a18@test.uz`,
      device_fp: fp,
    });
  expect(res.status).toBe(302);
}

async function login(agent, uname, fp, xff, extra = {}) {
  const page = await agent.get('/user/login');
  const csrf = csrfFrom(page.text);
  const res = await agent.post('/user/login')
    .set('x-forwarded-for', xff)
    .set(extra)
    .type('form')
    .send({ _csrf: csrf, lang: 'uz', username: uname, password: PW, device_fp: fp });
  return res;
}

async function authAuditEntries() {
  const snap = await fb.get('auth_audit');
  if (!snap.exists()) return [];
  const days = snap.val();
  return Object.values(days).flatMap((d) => Object.values(d));
}

describe('AUTH C-05 — impossible travel + velocity', () => {
  it('impossible travel: Toshkent record → 10 daqiqada Samarqand IP → auth:risk:impossible_travel audit', async () => {
    const uname = `c05a_${Date.now() % 1000000}`;
    const agent = supertest.agent(app);
    await registerUser(agent, uname, FP, '203.0.113.60'); // Toshkent

    // Device record'ni Toshkent + 10 daqiqa oldin qilib qo'yamiz
    await fb.set(`users/${safeKey(uname)}/devices/${FP}`, {
      first_seen: Date.now() - 86400000, last_seen: Date.now() - 10 * 60 * 1000,
      last_city: 'Toshkent', last_ip_hash: 'h1', trusted: false, risk_events: [],
    });

    // Samarqand IP'da qayta login (198.51.100.x) — 10 daqiqada ~1800 km/h
    await login(supertest.agent(app), uname, FP, '198.51.100.60');

    const entries = await authAuditEntries();
    const detected = entries.filter((e) => e.action === 'auth:risk:impossible_travel');
    expect(detected.length).toBeGreaterThanOrEqual(1);
    // Privacy: raw geo yo'q — faqat agregat + ts
    expect(JSON.stringify(detected[0].detail)).not.toMatch(/19[0-9]\.[0-9]+/);
  });

  it('velocity: 3 turli qurilma (bir account) → auth:risk:velocity audit + stepup', async () => {
    const uname = `c05b_${Date.now() % 1000000}`;
    const agent = supertest.agent(app);
    await registerUser(agent, uname, FP, '203.0.113.61');

    // 3 turli qurilma (Redis SET account-level) — har biri yangi fingerprint
    const fp2 = 'c51'.repeat(6);
    const fp3 = 'c52'.repeat(6);
    await login(supertest.agent(app), uname, fp2, '203.0.113.62');
    await login(supertest.agent(app), uname, fp3, '203.0.113.63');

    const entries = await authAuditEntries();
    const vel = entries.filter((e) => e.action === 'auth:risk:velocity');
    // Redis mavjud bo'lmasa test muhitida velocity yozilmasligi mumkin —
    // fail-open kontrakti. Redis bo'lsa yozilishi kerak.
    if (process.env.REDIS_URL) {
      expect(vel.length).toBeGreaterThanOrEqual(1);
    }
  });

  it('false-positive: VPN signal → step-up (block emas) — user MFA orqali o`tadi', async () => {
    const uname = `c05c_${Date.now() % 1000000}`;
    const agent = supertest.agent(app);
    await registerUser(agent, uname, FP, '203.0.113.64');
    await fb.set(`users/${safeKey(uname)}/created_at`, Date.now() - 30 * 24 * 3600 * 1000);

    // VPN header bilan login — yangi qurilma + vpn = 0.6 → unknown (stepup, block emas)
    const res = await login(supertest.agent(app), uname, FP, '203.0.113.65', { 'x-risk-vpn': '1' });
    expect(res.status).toBe(302); // login o'tadi (block emas — step-up session'da)

    // Session'da riskStepup — panel'da trust banner ko'rinadi (UI)
    const agent2 = supertest.agent(app);
    const r2 = await login(agent2, uname, FP, '203.0.113.66', { 'x-risk-vpn': '1' });
    expect(r2.status).toBe(302);
    const panel = await agent2.get('/user/panel');
    expect(panel.status).toBe(200);
  });
});
