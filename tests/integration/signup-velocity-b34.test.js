/**
 * AUTH B-34 — Register security extra (signup velocity, review queue)
 * -------------------------------------------------------------------
 *  1. velocity_fp: bir fingerprint 10 ta account (turli IP'lar) → 11-chisi 429
 *  2. Anti-bypass: X-Forwarded-For spoof IP'ni o'zgartirmaydi — fingerprint
 *     (device) qattiq qatlam, spoof qilingan IP'lar bilan ham bloklanadi
 *  3. Yangi domain → suspicious signup → review queue (admin ko'radi)
 *  4. Admin approve → review resolved
 *  5. Admin reject → user login bloklanadi (riskBlocked, generic)
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

function csrfFrom(html) {
  const m = html.match(/name="_csrf"\s+value="([^"]+)"/);
  return m ? m[1] : '';
}

async function getCsrf(agent) {
  const res = await agent.get('/user/login');
  return csrfFrom(res.text);
}

function ipFor(seed) {
  return `203.0.113.${(seed % 200) + 10}`;
}

/** Register — har urinish uchun alohida agent (yangi sessiya+CSRF). */
async function postRegister({ username, email, fingerprint, ip, extra = {} }) {
  const agent = supertest.agent(app);
  const csrf = await getCsrf(agent);
  return agent
    .post('/user/login')
    .type('form')
    .set('x-forwarded-for', ip)
    .send({
      _csrf: csrf, lang: 'uz', mode: 'reg', consent: 'on', username, email,
      password: PW, device_fp: fingerprint, ...extra,
    });
}

/** Admin session qurish + reauth (approve/reject requireRecentAdminAuth talab qiladi). */
async function adminAgent() {
  const admin = supertest.agent(app);
  const page = await admin.get('/admin/login');
  const csrf = csrfFrom(page.text);
  const adminUser = process.env.ADMIN_USER || 'admin';
  const adminPass = process.env.ADMIN_PASS || 'admin';
  const alr = await admin.post('/admin/login').set('x-forwarded-for', '198.51.100.200').type('form').send({
    _csrf: csrf,
    username: adminUser,
    password: adminPass,
  });
  expect([302, 200]).toContain(alr.status);
  // Admin sahifasidan CSRF token (login session'ini regeneratsiya qilgan)
  const dash = await admin.get('/admin');
  const m = dash.text.match(/__CSRF_TOKEN\s*=\s*'([^']+)'/) || dash.text.match(/const CSRF = '([^']+)'/);
  const token = m ? m[1] : '';
  // A-25 §09: sensitive amal uchun yaqin reauth talab (parol qayta tasdiqlash)
  const re = await admin.post('/api/admin/reauth').send({ password: adminPass }).set('x-csrf-token', token);
  expect(re.status).toBe(200);
  expect(re.body.ok).toBe(true);
  admin.__csrfToken = token;
  return admin;
}

describe('AUTH B-34 — signup velocity (per-fingerprint qattiq)', () => {
  it('bir device (fp) 10 ta account (turli IP/email) → 11-chisi 429', async () => {
    const stamp = Date.now() % 1000000;
    const fp = `aa${String(stamp).padStart(14, '0')}`.slice(0, 16); // 16 hex belgi
    const baseName = `b34v${stamp}`;

    for (let i = 1; i <= 10; i += 1) {
      const r = await postRegister({
        username: `${baseName}_${i}`,
        email: `${baseName}_${i}@test.uz`,
        fingerprint: fp,
        ip: ipFor(i + 100),
      });
      expect(r.status).toBe(302);
    }

    // 11-chi — velocity_fp blok (429 RATE_LIMITED)
    const blocked = await postRegister({
      username: `${baseName}_11`,
      email: `${baseName}_11@test.uz`,
      fingerprint: fp,
      ip: ipFor(111),
    });
    expect(blocked.status).toBe(429);
    expect(blocked.body.code).toBe('RATE_LIMITED');
    expect(blocked.body.retryAfter).toBeGreaterThan(0);
  });

  it('anti-bypass: X-Forwarded-For spoof bilan ham fingerprint qattiq qatlam ushlaydi', async () => {
    const stamp = Date.now() % 1000000;
    const fp = `bb${String(stamp).padStart(14, '0')}`.slice(0, 16);
    const baseName = `b34x${stamp}`;

    for (let i = 1; i <= 10; i += 1) {
      // Har urinishda BOSHQA spoof IP (attacker XFF'ni o'zgartiradi)
      const r = await postRegister({
        username: `${baseName}_${i}`,
        email: `${baseName}_${i}@test.uz`,
        fingerprint: fp,
        ip: ipFor(200 + i * 7),
      });
      expect(r.status).toBe(302);
    }
    const blocked = await postRegister({
      username: `${baseName}_11`,
      email: `${baseName}_11@test.uz`,
      fingerprint: fp,
      ip: ipFor(333),
    });
    expect(blocked.status).toBe(429);
    expect(blocked.body.code).toBe('RATE_LIMITED');
  });
});

describe('AUTH B-34 — review queue (suspicious signup → admin approve/reject)', () => {
  it('yangi domain signup → review queue\'da paydo bo\'ladi → admin approve', async () => {
    const stamp = Date.now() % 1000000;
    const uname = `b34d${stamp}`;
    const domain = `brandnew-${stamp}.xyz`; // hech qachon signup ko'rmagan domen

    const r = await postRegister({
      username: uname,
      email: `${uname}@${domain}`,
      fingerprint: `cc${String(stamp).padStart(14, '0')}`.slice(0, 16),
      ip: ipFor(55),
    });
    expect(r.status).toBe(302);

    const admin = await adminAgent();
    const q = await admin.get('/admin/api/signup-reviews?status=pending');
    expect(q.status).toBe(200);
    const review = (q.body.reviews || []).find((x) => x.userId === uname);
    expect(review).toBeTruthy();
    expect(review.reason).toBe('domain');
    expect(q.body.pendingDepth).toBeGreaterThan(0);

    // Admin approve → resolved
    const appr = await admin.post(`/admin/api/signup-reviews/${review.id}/approve`).set('x-csrf-token', admin.__csrfToken);
    expect(appr.status).toBe(200);
    expect(appr.body.ok).toBe(true);
    const after = await admin.get('/admin/api/signup-reviews?status=approved');
    expect((after.body.reviews || []).some((x) => x.id === review.id)).toBe(true);
  });

  it('admin reject → user login bloklanadi (generic riskBlocked)', async () => {
    const stamp = Date.now() % 1000000;
    const uname = `b34r${stamp}`;
    const domain = `blocked-${stamp}.xyz`;

    const r = await postRegister({
      username: uname,
      email: `${uname}@${domain}`,
      fingerprint: `dd${String(stamp).padStart(14, '0')}`.slice(0, 16),
      ip: ipFor(66),
    });
    expect(r.status).toBe(302);

    const admin = await adminAgent();
    const q = await admin.get('/admin/api/signup-reviews?status=pending');
    const review = (q.body.reviews || []).find((x) => x.userId === uname);
    expect(review).toBeTruthy();
    const rej = await admin.post(`/admin/api/signup-reviews/${review.id}/reject`).set('x-csrf-token', admin.__csrfToken);
    expect(rej.status).toBe(200);

    // Login — bloklangan (302 emas; 200 + riskBlocked xabar)
    const agent = supertest.agent(app);
    const csrf = await getCsrf(agent);
    const login = await agent
      .post('/user/login')
      .type('form')
      .set('x-forwarded-for', ipFor(67))
      .send({ _csrf: csrf, lang: 'uz', mode: 'login', username: uname, password: PW });
    expect(login.status).toBe(200);
    expect(login.text).toContain('blokladi'); // riskBlocked (uz)
  });

  it('anonim admin API\'ga kira olmaydi (requireAdmin)', async () => {
    const anon = await supertest.agent(app).get('/admin/api/signup-reviews');
    expect([302, 401, 403]).toContain(anon.status);
  });
});
