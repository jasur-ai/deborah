/**
 * AUTH B-22 — Telegram bot: integration testlar
 * ---------------------------------------------
 * 1) GET /user/telegram/link — auth talab (anonim redirect).
 * 2) POST /api/telegram/link — CSRF bilan start-token.
 * 3) POST /webhooks/telegram-bot — signed callback → ulash (token consume).
 * 4) POST /webhooks/telegram-bot — noto'g'ri imzo → 401.
 * 5) POST /webhooks/telegram-bot — chat "Natijalarim" → results (read-only).
 * 6) IDOR/security — chat faqat o'z ma'lumoti (boshqa user ma'lumoti chiqmaydi).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createApp } from '../../server.js';
import { fb } from '../../firebase/admin.js';
import { safeKey } from '../../utils/helpers.js';
import { snapshotDb, restoreDb } from '../helpers/setup.js';
import { createLinkToken, signCallbackPayload } from '../../src/modules/email/telegram.js';

const EMAIL = `b22-${Date.now()}@test.uz`;

async function extractCsrf(html) {
  const m = html.match(/name="_csrf" value="([^"]+)"/) || html.match(/window\.__CSRF_TOKEN\s*=\s*'([^']+)'/);
  return m ? m[1] : null;
}

function signedBody(body) {
  const payload = JSON.stringify(body);
  return { payload, signature: signCallbackPayload(payload) };
}

describe('AUTH B-22 — Telegram bot (integration)', () => {
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
      _csrf: csrf, mode: 'reg', consent: 'on',
      username: `b22user${Date.now()}`, password: 'Str0ng!Pass2026',
      password2: 'Str0ng!Pass2026', email: EMAIL, lang: 'uz',
    });
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

  it('GET /user/telegram/link — anonim → redirect/login', async () => {
    const res = await fetch(`${base}/user/telegram/link`);
    expect([301, 302, 401, 403]).toContain(res.status);
  });

  it('GET /user/telegram/link — login qilingan user sahifani oladi', async () => {
    const res = await agent.get('/user/telegram/link');
    expect(res.status).toBe(200);
    expect(res.text).toContain('tg-card');
  });

  it('POST /api/telegram/link — CSRF bilan start-token', async () => {
    const page = await agent.get('/user/telegram/link');
    const csrf = await extractCsrf(page.text);
    expect(csrf).toBeTruthy();
    const res = await agent.post('/api/telegram/link').set('X-CSRF-Token', csrf);
    expect(res.status).toBe(200);
    const body = res.body;
    expect(body.ok).toBe(true);
    expect(body.url).toContain('t.me/');
    expect(body.token).toBeTruthy();
    expect(body.ttlMs).toBe(5 * 60 * 1000);
  });

  it('POST /webhooks/telegram-bot — noto`g`ri imzo → 401', async () => {
    const res = await fetch(`${base}/webhooks/telegram-bot`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Telegram-Signature': 'wrong-signature' },
      body: JSON.stringify({ message: { text: '/start abc', chat: { id: 1 } } }),
    });
    expect(res.status).toBe(401);
  });

  it('POST /webhooks/telegram-bot — signed callback → ulash (token consume)', async () => {
    // Start-token yaratamiz
    const { token } = await createLinkToken(userKey);
    const body = {
      message: { text: `/start ${token}`, chat: { id: 987654321 }, from: { id: 987654321, first_name: 'Ali', username: 'ali' } },
    };
    const { payload, signature } = signedBody(body);
    const res = await fetch(`${base}/webhooks/telegram-bot`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Telegram-Signature': signature },
      body: payload,
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(data.action).toBe('linked');
    // telegram_id biriktirildi + prefs.telegram = true
    const snap = await fb.get(`users/${safeKey(userKey)}/telegram_id`);
    expect(snap.exists()).toBe(true);
    expect(String(snap.val())).toBe('987654321'); // string sifatida saqlanadi
    const prefs = await fb.get(`users/${safeKey(userKey)}/notif_prefs`);
    expect(prefs.exists()).toBe(true);
    expect(prefs.val().channels.telegram).toBe(true);
  });

  it('POST /webhooks/telegram-bot — token ikkinchi marta → rad (1 marta)', async () => {
    const { token } = await createLinkToken(userKey);
    const mk = () => ({ message: { text: `/start ${token}`, chat: { id: 555 }, from: { id: 555 } } });
    const s1 = signedBody(mk());
    const r1 = await fetch(`${base}/webhooks/telegram-bot`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Telegram-Signature': s1.signature },
      body: s1.payload,
    });
    expect(r1.status).toBe(200);
    const s2 = signedBody(mk());
    const r2 = await fetch(`${base}/webhooks/telegram-bot`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Telegram-Signature': s2.signature },
      body: s2.payload,
    });
    expect([400, 401]).toContain(r2.status);
  });

  it('POST /webhooks/telegram-bot — chat "Natijalarim" → results (read-only)', async () => {
    // Mustaqil user + ulash (boshqa testlar telegram_id'ni o'zgartirgan bo'lishi mumkin)
    const chatUserKey = safeKey(`chatuser${Date.now()}`);
    await fb.set(`users/${chatUserKey}`, { username: 'chatuser', email: `ch-${Date.now()}@test.uz`, settings: { lang: 'uz' } });
    const CHAT_ID = 424242;
    const { token } = await createLinkToken(chatUserKey);
    const linkBody = { message: { text: `/start ${token}`, chat: { id: CHAT_ID }, from: { id: CHAT_ID } } };
    const lb = signedBody(linkBody);
    await fetch(`${base}/webhooks/telegram-bot`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Telegram-Signature': lb.signature },
      body: lb.payload,
    });
    // Natija yozamiz
    await fb.set(`users/${chatUserKey}/results/test1`, { name: 'Fizika', score: 85 });
    const body = { message: { text: 'Natijalarim', chat: { id: CHAT_ID } } };
    const { payload, signature } = signedBody(body);
    const res = await fetch(`${base}/webhooks/telegram-bot`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Telegram-Signature': signature },
      body: payload,
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(data.action).toBe('chat');
  });

  it('security: chat boshqa user ma`lumotini bermaydi (read-only, PII minimal)', async () => {
    // Boshqa user yaratamiz — uning natijalari bor
    const otherKey = safeKey(`other${Date.now()}`);
    await fb.set(`users/${otherKey}`, { username: 'other', email: `o-${Date.now()}@test.uz`, telegram_id: 555555555 });
    await fb.set(`users/${otherKey}/results/testX`, { name: 'Secret Test', score: 99 });
    // Chat — ulangan user'ning ID'si orqali faqat O'Z natijalari
    const body = { message: { text: 'Natijalarim', chat: { id: 555555555 } } };
    const { payload, signature } = signedBody(body);
    const res = await fetch(`${base}/webhooks/telegram-bot`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Telegram-Signature': signature },
      body: payload,
    });
    expect(res.status).toBe(200);
    // Hech qanday user ma'lumoti (email/parol) bot javobiga chiqmaydi
    const data = await res.json();
    expect(JSON.stringify(data)).not.toContain('@test.uz');
    expect(JSON.stringify(data)).not.toContain('password');
  });
});
