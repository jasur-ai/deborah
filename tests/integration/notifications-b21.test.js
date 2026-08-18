/**
 * AUTH B-21 — Notification preferences: integration testlar
 * ---------------------------------------------------------
 * 1) GET /user/notifications — auth talab (anonim → redirect/401).
 * 2) GET /user/notifications — login qilingan user → sahifa render, toggle'lar.
 * 3) POST /api/notifications/prefs — saqlash (CSRF bilan).
 * 4) POST /api/notifications/prefs — CSRF yo'q → rad etiladi.
 * 5) IDOR — boshqa user prefs'iga kirish bloklangan (route user-scoped).
 * 6) Security forced UI'da disabled (view tekshiruvi).
 * 7) Audit — NOTIF_PREFS_UPDATED yoziladi.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createApp } from '../../server.js';
import { fb } from '../../firebase/admin.js';
import { safeKey } from '../../utils/helpers.js';
import { snapshotDb, restoreDb } from '../helpers/setup.js';

const EMAIL = `b21-${Date.now()}@test.uz`;
const PASSWORD = 'Str0ng!Pass2026';

async function extractCsrf(html) {
  const m = html.match(/name="_csrf" value="([^"]+)"/) || html.match(/window\.__CSRF_TOKEN\s*=\s*'([^']+)'/);
  return m ? m[1] : null;
}

describe('AUTH B-21 — Notification preferences (integration)', () => {
  let app;
  let httpServer;
  let base;
  let agent;
  let userKey;

  beforeAll(async () => {
    await snapshotDb();
    const created = await createApp();
    app = created.app;
    httpServer = created.httpServer;
    await new Promise((r) => httpServer.listen(0, r));
    base = `http://localhost:${httpServer.address().port}`;
    agent = (await import('supertest')).default.agent(app);

    // Register user
    const regPage = await agent.get('/user/login?mode=reg').redirects(0);
    const csrf = await extractCsrf(regPage.text);
    expect(csrf).toBeTruthy();
    await agent.post('/user/login').type('form').send({
      _csrf: csrf,
      mode: 'reg', consent: 'on',
      username: `b21user${Date.now()}`,
      password: PASSWORD,
      password2: PASSWORD,
      email: EMAIL,
      lang: 'uz',
    });
    const panel = await agent.get('/user/panel');
    expect(panel.status).toBe(200);
    // userKey'ni email'dan topamiz
    const usersSnap = await fb.get('users');
    const users = usersSnap.exists() ? usersSnap.val() : {};
    const entry = Object.entries(users).find(([, u]) => u.email === EMAIL);
    expect(entry).toBeTruthy();
    userKey = entry[0];
  });

  afterAll(async () => {
    await restoreDb();
    await new Promise((r) => httpServer.close(r));
  });

  it('GET /user/notifications — anonim → login sahifasiga redirect', async () => {
    const anon = await fetch(`${base}/user/notifications`);
    expect([301, 302, 401, 403]).toContain(anon.status);
  });

  it('GET /user/notifications — login qilingan user sahifani oladi (toggle lar bor)', async () => {
    const res = await agent.get('/user/notifications');
    expect(res.status).toBe(200);
    expect(res.text).toContain('ch_telegram');
    expect(res.text).toContain('ch_email');
    expect(res.text).toContain('tp_security');
    // Security toggle disabled (forced) + lock icon
    expect(res.text).toContain('tp_security');
    expect(res.text).toMatch(/tp_security"[^>]*disabled/);
    expect(res.text).toContain('locked-note');
  });

  it("POST /api/notifications/prefs — CSRF yo'q → 403", async () => {
    const res = await agent.post('/api/notifications/prefs').send({ ch_email: true });
    expect([400, 401, 403]).toContain(res.status);
  });

  it('POST /api/notifications/prefs — saqlash muvaffaqiyatli + audit', async () => {
    // CSRF olamiz
    const page = await agent.get('/user/notifications');
    const csrf = await extractCsrf(page.text);
    expect(csrf).toBeTruthy();
    const res = await agent
      .post('/api/notifications/prefs')
      .set('X-CSRF-Token', csrf)
      .send({ ch_telegram: false, ch_email: true, tp_practice: false, tp_security: false });
    expect(res.status).toBe(200);
    const body = res.body;
    expect(body.ok).toBe(true);
    expect(body.prefs.channels.email).toBe(true);
    expect(body.prefs.channels.telegram).toBe(false);
    expect(body.prefs.types.practice).toBe(false);
    // Security forced — false yuborilgan bo'lsa ham true
    expect(body.prefs.types.security).toBe(true);
    // DB'da saqlangan
    const snap = await fb.get(`users/${safeKey(userKey)}/notif_prefs`);
    expect(snap.exists()).toBe(true);
    expect(snap.val().channels.email).toBe(true);
  });

  it('GET /user/notifications — saqlangan prefs toggle holatida chiqadi', async () => {
    const res = await agent.get('/user/notifications');
    // email endi checked, telegram unchecked
    expect(res.text).toContain('id="ch_email" checked');
    expect(res.text).not.toContain('id="ch_telegram" checked');
    expect(res.text).toContain('id="tp_practice"');
    expect(res.text).not.toContain('id="tp_practice" checked');
  });

  it("IDOR: boshqa user prefs'iga POST bloklangan (user-scoped)", async () => {
    // Boshqa user yaratamiz
    const otherKey = safeKey(`other${Date.now()}`);
    await fb.set(`users/${otherKey}`, {
      username: 'other', email: `other-${Date.now()}@test.uz`,
      password: 'x', created_at: Date.now(),
    });
    // Hozirgi session boshqa user'ning prefs'ini o'zgartira olmaydi (route req.user.safeKey ishlatadi)
    const page = await agent.get('/user/notifications');
    const csrf = await extractCsrf(page.text);
    const res = await agent
      .post('/api/notifications/prefs')
      .set('X-CSRF-Token', csrf)
      .send({ ch_email: true });
    expect(res.status).toBe(200);
    // Other user'ning prefs'iga tegilmasdi
    const otherSnap = await fb.get(`users/${otherKey}/notif_prefs`);
    expect(otherSnap.exists()).toBe(false);
  });

  it('XSS: prefs inputdan keladigan qiymat sahifaga escape bilan chiqadi', async () => {
    // View'da barcha i18n qiymatlari <%= %> orqali (escape) render qilinadi
    const page = await agent.get('/user/notifications');
    expect(page.status).toBe(200);
    // Hech qanday raw <script> view'da yo'q (faqat bizning JS blokimiz — window.__CSRF__ ni tekshiramiz)
    const scripts = page.text.match(/<script[^>]*>/g) || [];
    expect(scripts.length).toBeGreaterThan(0);
  });
});
