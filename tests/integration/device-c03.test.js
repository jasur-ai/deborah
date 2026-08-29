/**
 * AUTH C-03 — Device fingerprint schema + integration
 * -------------------------------------------------------------------
 *  1. Login (device_fp bilan) → user_devices upsert (first_seen/last_seen)
 *  2. POST /api/auth/device/register — idempotent (first_seen o'zgarmaydi)
 *  3. Privacy: device record'da FAQAT hash — raw canvas/WebGL/plugins YO'Q
 *  4. Audit: auth:device:registered yozildi (fingerprint hash bilan)
 *  5. Trust flow: /api/auth/device/trust → trusted=true (reauth bilan)
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
const FP = 'a3f0c9d1e2b4a7f8c3d5e6f0a1b2c3d4'; // 32 hex — FNV-1a v2

function csrfFrom(html) {
  const m = html.match(/name="_csrf"\s+value="([^"]+)"/) || html.match(/window\.__CSRF_TOKEN = '([^']+)'/);
  return m ? m[1] : '';
}

async function registerWithDevice(agent, uname, fp, xff) {
  const page = await agent.get('/user/login');
  const csrf = csrfFrom(page.text);
  const res = await agent.post('/user/login')
    .set('x-forwarded-for', xff)
    .type('form')
    .send({
      _csrf: csrf, lang: 'uz', mode: 'reg', consent: 'on', username: uname, password: PW,
      email: `c03_${Date.now()}_${Math.floor(Math.random() * 1000000)}_a18@test.uz`,
      device_fp: fp,
    });
  expect(res.status).toBe(302); // register → logged-in (panel)

  // C-03 §08: explicit device register — record'ni kafolatlaydi (idempotent upsert)
  const panel = await agent.get('/user/panel');
  const csrf2 = csrfFrom(panel.text);
  const reg = await agent.post('/api/auth/device/register')
    .set('x-csrf-token', csrf2)
    .send({ fingerprint: fp });
  expect(reg.status).toBe(200);
}

async function authAuditEntries() {
  const snap = await fb.get('auth_audit');
  if (!snap.exists()) return [];
  const days = snap.val();
  return Object.values(days).flatMap((d) => Object.values(d));
}

describe('AUTH C-03 — device fingerprint', () => {
  it('login (device_fp) → user_devices upsert; register idempotent (first_seen saqlanadi)', async () => {
    const uname = `c03a_${Date.now() % 1000000}`;
    const xff = '203.0.113.80';
    const agent = supertest.agent(app);
    await registerWithDevice(agent, uname, FP, xff);

    // Register login'da risk flow device'ni touch qilgan bo'lishi kerak
    const dev1 = await fb.get(`users/${uname}/devices/${FP}`);
    expect(dev1.exists()).toBe(true);
    const r1 = dev1.val();
    expect(r1.first_seen).toBeGreaterThan(0);
    expect(r1.last_seen).toBeGreaterThan(0);

    // Explicit register endpoint — idempotent upsert
    await new Promise((r) => setTimeout(r, 20)); // last_seen farqlanishi uchun
    const csrf = csrfFrom((await agent.get('/user/panel')).text) || csrfFrom((await agent.get('/user/login')).text);
    const reg = await agent.post('/api/auth/device/register')
      .set('x-csrf-token', csrf)
      .send({ fingerprint: FP });
    expect(reg.status).toBe(200);
    expect(reg.body.ok).toBe(true);
    expect(reg.body.device.trusted).toBe(false);

    const dev2 = await fb.get(`users/${uname}/devices/${FP}`);
    const r2 = dev2.val();
    expect(r2.first_seen).toBe(r1.first_seen); // idempotent
    expect(r2.last_seen).toBeGreaterThanOrEqual(r1.last_seen);
  });

  it('privacy: device record\'da FAQAT hash — raw telemetry yo\'q', async () => {
    const uname = `c03b_${Date.now() % 1000000}`;
    const agent = supertest.agent(app);
    await registerWithDevice(agent, uname, FP, '203.0.113.81');

    const snap = await fb.get(`users/${uname}/devices`);
    const record = JSON.stringify(snap.val() || {});
    // Raw komponentlar log/DB'da bo'lmasligi kerak (§20 stop-condition)
    expect(record).not.toMatch(/canvas|webgl|plugins|fonts|audio/i);
    expect(record).not.toContain('{"c'); // component dict emas — faqat hash
    // Faqat kutilgan PII-minimal maydonlar
    const dev = Object.values(snap.val())[0];
    expect(Object.keys(dev).sort()).toEqual(
      ['first_seen', 'last_city', 'last_ip_hash', 'last_seen', 'risk_events', 'trusted', 'user_agent'].sort()
    );
  });

  it('audit: auth:device:registered yozildi (hash bilan, raw emas)', async () => {
    const uname = `c03c_${Date.now() % 1000000}`;
    const agent = supertest.agent(app);
    await registerWithDevice(agent, uname, FP, '203.0.113.82');

    const entries = await authAuditEntries();
    const regs = entries.filter((e) => e.action === 'auth:device:registered');
    expect(regs.length).toBeGreaterThanOrEqual(1);
    const last = regs[regs.length - 1];
    expect(last.detail.fingerprint).toBe(FP);
    expect(JSON.stringify(last.detail)).not.toMatch(/canvas|webgl|plugins/i);
    expect(last.ip_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('trust flow: /api/auth/device/trust → trusted=true (reauth bilan)', async () => {
    const uname = `c03d_${Date.now() % 1000000}`;
    const xff = '203.0.113.83';
    const agent = supertest.agent(app);
    await registerWithDevice(agent, uname, FP, xff);

    // reauth (requireRecentAuth talab qiladi)
    const page = await agent.get('/user/panel');
    const csrf = csrfFrom(page.text);
    const ra = await agent.post('/api/auth/reauth').send({ password: PW }).set('x-csrf-token', csrf);
    expect(ra.status).toBe(200);

    const tr = await agent.post('/api/auth/device/trust').set('x-csrf-token', csrf).send({});
    expect(tr.status).toBe(200);
    expect(tr.body.ok).toBe(true);

    const dev = await fb.get(`users/${uname}/devices/${FP}`);
    expect(dev.val().trusted).toBe(true);
    expect(dev.val().trustedAt).toBeGreaterThan(0);
  });
});
