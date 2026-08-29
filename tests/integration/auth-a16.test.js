/**
 * AUTH A-16 — Telegram OTP (P3) — integration
 * -------------------------------------------------------------------
 * Qamrov (guide §23-24):
 *  - start → 6-kod + start havolasi (dev preview)
 *  - verify → login/link round-trip; account_required branch
 *  - Replay (single-use) → 410
 *  - Hijack guard (callback id ≠ verify id) → 409
 *  - Bot callback HMAC signature → bad → 403
 *  - Unique telegram_id → 409
 *  - Rate limit verify → 429
 *  - Unlink → mapping yo'qoladi
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import crypto from 'crypto';
import { snapshotDb, restoreDb } from '../helpers/setup.js';
import { fb } from '../../firebase/admin.js';
import { safeKey } from '../../utils/helpers.js';

let CONFIG;
let httpServer;
let supertest;

beforeAll(async () => {
  snapshotDb();
  // CONFIG buildConfig import vaqtida o'qiydi. Test fayl yuqorisidagi
  // import'lar env.js ni allaqachon yuklagan bo'lishi mumkin — resetModules
  // bilan toza module graph yaratamiz, keyin env qo'yib server'ni import qilamiz.
  vi.resetModules();
  process.env.TELEGRAM_BOT_TOKEN = 'a16-test-bot-token-0123456789';
  process.env.TELEGRAM_BOT_USERNAME = 'DeborahTestBot';
  const envMod = await import('../../src/config/env.js');
  CONFIG = envMod.default;
  const serverMod = await import('../../server.js');
  const result = await serverMod.createApp();
  httpServer = result.httpServer;
  await new Promise((resolve) => httpServer.listen(0, resolve));
  supertest = (await import('supertest')).default;
}, 90000);

afterAll(async () => {
  await new Promise((resolve) => httpServer.close(resolve));
  delete process.env.TELEGRAM_BOT_TOKEN;
  delete process.env.TELEGRAM_BOT_USERNAME;
  restoreDb();
});

const csrfFrom = (html) => {
  const m = html.match(/name="_csrf"\s+value="([^"]+)"/) || html.match(/__CSRF_TOKEN\s*=\s*'([^']+)'/);
  return m ? m[1] : '';
};

/** Register (auto-login) → yangi agent + CSRF. */
async function registerAndLogin(username, pw, xff) {
  const a = supertest.agent(httpServer);
  const page = await a.get('/user/login').set('X-Forwarded-For', xff);
  await a
    .post('/user/login')
    .set('X-Forwarded-For', xff)
    .type('form')
    .send({
      _csrf: csrfFrom(page.text), lang: 'uz', mode: 'reg', consent: 'on', username, password: pw,
      // AUTH A-18: email majburiy (A-21 checkpoint regression fix)
      email: `a16_${Date.now()}_${Math.floor(Math.random() * 1000000)}@test.uz`,
    });
  const panel = await a.get('/user/panel').set('X-Forwarded-For', xff);
  if (panel.status !== 200) throw new Error(`register failed: ${panel.status}`);
  return { agent: a, csrf: csrfFrom(panel.text) };
}

const tg = (agent, path, body, xff, csrf) => {
  const r = agent.post(path).set('X-Forwarded-For', xff);
  if (csrf) r.set('x-csrf-token', csrf);
  return r.send(body);
};

/** Anon sessiya uchun CSRF + cookie (login sahifasidan). */
async function freshCsrf(xff) {
  const a = supertest.agent(httpServer);
  const page = await a.get('/user/login').set('X-Forwarded-For', xff);
  return { agent: a, csrf: csrfFrom(page.text) };
}

const sign = (payload) =>
  crypto.createHmac('sha256', CONFIG.TELEGRAM_BOT_TOKEN).update(payload).digest('hex');

describe('AUTH A-16 — Telegram OTP flow', () => {
  it('start (anon) → 200, 6-kod preview + start havolasi', async () => {
    const { agent: a, csrf } = await freshCsrf('203.0.113.41');
    const res = await tg(a, '/api/auth/telegram/start', { phone: '+998901111111' }, '203.0.113.41', csrf);
    expect(res.status).toBe(200);
    expect(/^\d{6}$/.test(res.body.previewCode)).toBe(true);
    expect(res.body.previewLink).toContain('start=');
    expect(res.body.botUsername).toBe('DeborahTestBot');
  });

  it('invalid phone → 400', async () => {
    const { agent: a, csrf } = await freshCsrf('203.0.113.42');
    const res = await tg(a, '/api/auth/telegram/start', { phone: 'not-a-phone' }, '203.0.113.42', csrf);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_phone');
  });

  it('verify — noto\'g\'ri kod → 401; account bo\'lmasa → account_required', async () => {
    const { agent: a, csrf } = await freshCsrf('203.0.113.43');
    // noto'g'ri kod
    const bad = await tg(a, '/api/auth/telegram/verify', { telegram_id: '777043', code: '000000' }, '203.0.113.43', csrf);
    expect(bad.status).toBe(401);
    expect(bad.body.error).toBe('invalid_code');

    // to'g'ri kod, lekin user yo'q (anon start)
    const { agent: a2, csrf: csrf2 } = await freshCsrf('203.0.113.44');
    const start = await tg(a2, '/api/auth/telegram/start', { phone: '+998902222222' }, '203.0.113.44', csrf2);
    const res = await tg(a2, '/api/auth/telegram/verify', { telegram_id: '777044', code: start.body.previewCode }, '203.0.113.44', csrf2);
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('account_required');
  });

  it('to\'liq flow: register → start → verify → link + mapping', async () => {
    const uname = `tg_a_${Date.now() % 1000000}`;
    const { agent: a, csrf } = await registerAndLogin(uname, 'sirli-parol-2026', '203.0.113.45');
    const start = await tg(a, '/api/auth/telegram/start', { phone: '+998903333333' }, '203.0.113.45', csrf);
    expect(start.status).toBe(200);

    const res = await tg(
      a,
      '/api/auth/telegram/verify',
      { telegram_id: '777045', code: start.body.previewCode },
      '203.0.113.45',
      csrf
    );
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.linked).toBe(true);
    expect(res.body.login).toBe(false); // allaqachon kirgan

    // DB mapping
    const snap = await fb.get(`users/${safeKey(uname)}/telegram`);
    expect(snap.exists()).toBe(true);
    expect(snap.val().telegramId).toBe('777045');
    const idx = await fb.get('users_telegram_index/777045');
    expect(idx.exists()).toBe(true);
    expect(idx.val()).toBe(safeKey(uname));

    // Replay — kod bitta foydalanish
    const replay = await tg(
      a,
      '/api/auth/telegram/verify',
      { telegram_id: '777045', code: start.body.previewCode },
      '203.0.113.45',
      csrf
    );
    expect(replay.status).toBe(410);
    expect(replay.body.error).toBe('already_used');
  });

  it('hijack guard — bot callback id ≠ verify id → 409', async () => {
    const uname = `tg_b_${Date.now() % 1000000}`;
    const { agent: a, csrf } = await registerAndLogin(uname, 'sirli-parol-2026', '203.0.113.46');
    const start = await tg(a, '/api/auth/telegram/start', { phone: '+998904444444' }, '203.0.113.46', csrf);
    const token = start.body.previewLink.split('start=')[1];

    // Signed bot callback — telegramId 777046 biriktiradi
    const canonical = `start_token=${encodeURIComponent(token)}&id=777046&auth_date=1700000000`;
    const cb = await a
      .post('/webhooks/telegram')
      .set('X-Forwarded-For', '203.0.113.46')
      .send({ start_token: token, id: 777046, first_name: 'Test', auth_date: 1700000000, signature: sign(canonical) });
    expect(cb.status).toBe(200);

    // Verify boshqa id bilan → 409
    const res = await tg(
      a,
      '/api/auth/telegram/verify',
      { telegram_id: '999046', code: start.body.previewCode },
      '203.0.113.46',
      csrf
    );
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('telegram_mismatch');
  });

  it('bot callback — noto\'g\'ri signature → 403 (CSRF talab qilinmaydi — HMAC)', async () => {
    const a = supertest.agent(httpServer);
    // Webhook CSRF'dan ozod (server.js exclusion) — HMAC o'zi himoya
    const res = await a
      .post('/webhooks/telegram')
      .set('X-Forwarded-For', '203.0.113.47')
      .send({ start_token: 'x', id: 1, auth_date: 1, signature: 'deadbeef' });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('bad_signature');
  });

  it('unique telegram_id — boshqa user link qilolmaydi → 409', async () => {
    // user A link qiladi
    const ua = `tg_c_${Date.now() % 1000000}`;
    const { agent: a1, csrf: c1 } = await registerAndLogin(ua, 'sirli-parol-2026', '203.0.113.48');
    const s1 = await tg(a1, '/api/auth/telegram/start', { phone: '+998905555555' }, '203.0.113.48', c1);
    const v1 = await tg(a1, '/api/auth/telegram/verify', { telegram_id: '777048', code: s1.body.previewCode }, '203.0.113.48', c1);
    expect(v1.status).toBe(200);

    // user B xuddi shu telegram_id bilan → 409
    const ub = `tg_d_${Date.now() % 1000000}`;
    const { agent: a2, csrf: c2 } = await registerAndLogin(ub, 'sirli-parol-2026', '203.0.113.49');
    const s2 = await tg(a2, '/api/auth/telegram/start', { phone: '+998906666666' }, '203.0.113.49', c2);
    const v2 = await tg(a2, '/api/auth/telegram/verify', { telegram_id: '777048', code: s2.body.previewCode }, '203.0.113.49', c2);
    expect(v2.status).toBe(409);
    expect(v2.body.error).toBe('telegram_already_linked');
  });

  it('verify rate limit — 6-chi urinish → 429', async () => {
    const uname = `tg_e_${Date.now() % 1000000}`;
    const { agent: a, csrf } = await registerAndLogin(uname, 'sirli-parol-2026', '203.0.113.50');
    let last;
    for (let i = 0; i < 6; i++) {
      last = await tg(
        a,
        '/api/auth/telegram/verify',
        { telegram_id: '777050', code: '000000' },
        '203.0.113.50',
        csrf
      );
    }
    expect(last.status).toBe(429);
    expect(last.body.error).toBe('too_many_attempts');
  });

  it('unlink — mapping olib tashlanadi', async () => {
    const uname = `tg_f_${Date.now() % 1000000}`;
    const { agent: a, csrf } = await registerAndLogin(uname, 'sirli-parol-2026', '203.0.113.51');
    const start = await tg(a, '/api/auth/telegram/start', { phone: '+998907777777' }, '203.0.113.51', csrf);
    const v = await tg(a, '/api/auth/telegram/verify', { telegram_id: '777051', code: start.body.previewCode }, '203.0.113.51', csrf);
    expect(v.status).toBe(200);

    const un = await tg(a, '/api/auth/telegram/unlink', {}, '203.0.113.51', csrf);
    expect(un.status).toBe(200);
    expect(un.body.removed).toBe(true);
    const snap = await fb.get(`users/${safeKey(uname)}/telegram`);
    expect(snap.exists()).toBe(false);
    const idx = await fb.get('users_telegram_index/777051');
    expect(idx.exists()).toBe(false);
  });
});
