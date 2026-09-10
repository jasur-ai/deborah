/**
 * Deborah — C4-10 rev.4: admin panelidan Canva/Google kalitlarini kiritish
 * ─────────────────────────────────────────────────────────────────────────
 * "Canva qismi haqiqiy ishlatilsin" talabining haqiqiy yo'li:
 *   admin /admin/canva sahifasidagi forma → POST /api/admin/canva/credentials
 *   → shifrlangan store → GET status `configured: true` → OAuth link ishlaydi.
 *
 * Bu testlar imkon qadar "haqiqiy so'rov" bo'ylab yuradi (supertest agent +
 * admin sessiya + CSRF), shuning uchun UI↔API kontrakti uzilsa CI'da ushlanadi.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { existsSync, rmSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createApp } from '../../server.js';
import CONFIG from '../../src/config/env.js';
import { snapshotDb, restoreDb } from '../helpers/setup.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const STORE = join(ROOT, 'data', 'integration-credentials.json.enc');
const TEST_SECRET = 'canva-admin-form-secret-abcdef123456';

let app;
let httpServer;
let agent;
let csrfToken;
let credentials;
let envBackup = {};

beforeAll(async () => {
  snapshotDb();
  // Deploy env'i (Render/.env) bu testda admin-panel yo'lini tekshirish uchun
  // vaqtincha o'chiriladi — env mavjud bo'lsa u ustuvor (unit testda qoplangan).
  envBackup = {
    CANVA_CLIENT_ID: process.env.CANVA_CLIENT_ID,
    CANVA_CLIENT_SECRET: process.env.CANVA_CLIENT_SECRET,
    CANVA_REDIRECT_URI: process.env.CANVA_REDIRECT_URI,
  };
  delete process.env.CANVA_CLIENT_ID;
  delete process.env.CANVA_CLIENT_SECRET;
  delete process.env.CANVA_REDIRECT_URI;
  const result = await createApp();
  app = result.app;
  httpServer = result.httpServer;
  await new Promise((resolve) => httpServer.listen(0, resolve));

  const supertest = (await import('supertest')).default;
  agent = supertest.agent(app);

  const page = await agent.get('/admin/login');
  const m = page.text.match(/name="_csrf"\s+value="([^"]+)"/);
  const res = await agent.post('/admin/login').type('form').send({
    username: CONFIG.ADMIN_USER,
    password: CONFIG.ADMIN_PASS,
    _csrf: m ? m[1] : '',
  });
  expect(res.status, 'admin login').toBeLessThan(400);

  const dash = await agent.get('/admin/canva');
  const t = dash.text.match(/const CSRF = '([^']*)'/);
  csrfToken = t ? t[1] : '';

  credentials = await import('../../src/modules/integrations/credentials.js');
  credentials.clearProviderConfig('canva');
});

afterAll(async () => {
  credentials?.clearProviderConfig('canva');
  for (const [k, v] of Object.entries(envBackup)) {
    if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
  if (existsSync(STORE)) rmSync(STORE, { force: true });
  if (httpServer && httpServer.listening) await new Promise((r) => httpServer.close(r));
  restoreDb();
});

describe('admin kalit formasi — UI kontrakti', () => {
  it('/admin/canva sahifasida kalit kiritish formasi bor', async () => {
    const res = await agent.get('/admin/canva');
    expect(res.status).toBe(200);
    for (const id of ['cred-client-id', 'cred-client-secret', 'cred-redirect-uri', 'btnSaveCreds']) {
      expect(res.text, `#${id} yo'q`).toContain(id);
    }
    // Regressiya himoyasi: sahifadagi `const CSRF` bo'sh bo'lmasligi shart,
    // aks holda forma POST'i 403 "CSRF token validation failed" beradi.
    const m = res.text.match(/const CSRF = '([0-9a-f]{32,})'/);
    expect(m, 'sahifada CSRF token render qilinmadi').toBeTruthy();
  });

  it('/admin/google-slides sahifasida ham forma bor', async () => {
    const res = await agent.get('/admin/google-slides');
    expect(res.status).toBe(200);
    for (const id of ['gs-client-id', 'gs-client-secret', 'gs-redirect-uri', 'btnSaveCredsGs']) {
      expect(res.text, `#${id} yo'q`).toContain(id);
    }
  });
});

describe('admin kalit formasi — API (haqiqiy oqim)', () => {
  it('saqlashdan oldin configured=false, keyin true bo‘ladi', async () => {
    const before = await agent.get('/api/admin/canva/status').set('x-csrf-token', csrfToken);
    expect(before.status).toBe(200);
    expect(before.body.credentials.configured).toBe(false);

    const save = await agent
      .post('/api/admin/canva/credentials')
      .set('x-csrf-token', csrfToken)
      .send({ clientId: 'OC-ADMIN-FORM-1234', clientSecret: TEST_SECRET, redirectUri: 'https://deborah-ncj.onrender.com/api/admin/canva/callback' });

    expect(save.status, JSON.stringify(save.body)).toBe(200);
    expect(save.body.ok).toBe(true);

    const after = await agent.get('/api/admin/canva/status').set('x-csrf-token', csrfToken);
    expect(after.body.credentials.configured).toBe(true);
    expect(after.body.configured).toBe(true);
    expect(after.body.credentials.source).toBe('admin');
    expect(after.body.credentials.redirectUri).toBe('https://deborah-ncj.onrender.com/api/admin/canva/callback');
  });

  it('status javobida HECH QANDAY secret ko‘rinmaydi (faqat maska)', async () => {
    const res = await agent.get('/api/admin/canva/status').set('x-csrf-token', csrfToken);
    const raw = JSON.stringify(res.body);
    expect(raw).not.toContain(TEST_SECRET);
    expect(raw).not.toContain('OC-ADMIN-FORM-1234');
    expect(res.body.credentials.clientIdMasked).toBe('••••1234');
  });

  it('saqlangan kalit bilan Canva OAuth link endpointi ishlaydi', async () => {
    const link = await agent.post('/api/admin/canva/link').set('x-csrf-token', csrfToken).send({});
    expect([200, 400, 500]).toContain(link.status);
    if (link.status === 200) {
      expect(String(link.body.url || '')).toContain('canva.com');
    } else {
      // Provider 400/500 bo'lsa ham "configured emas" xatosi BO'LMASLIGI shart
      expect(String(link.body.error || '')).not.toMatch(/configured|sozlanmagan/i);
    }
  });

  it('CSRF’siz saqlash rad etiladi (403)', async () => {
    const res = await agent
      .post('/api/admin/canva/credentials')
      .send({ clientId: 'OC-X', clientSecret: 'y' });
    expect([401, 403]).toContain(res.status);
  });

  it('admin bo‘lmagan foydalanuvchi kira olmaydi (requireAdmin)', async () => {
    const anon = (await import('supertest')).default.agent(app);
    const res = await anon.post('/api/admin/canva/credentials').send({ clientId: 'OC-X', clientSecret: 'y' });
    expect([302, 401, 403]).toContain(res.status);
  });
});
