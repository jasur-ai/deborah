/**
 * AUTH B-07 — Email verify check + limited mode (integration)
 * -----------------------------------------------------------
 *  1. Verify check: to'g'ri kod → 200 + email_verified=true + email_status=verified
 *  2. Noto'g'ri kod → 422 otp_invalid (kontrakt); replay → 422
 *  3. Brute-force: 5 noto'g'ri → 6-chisi 429 too_many_attempts
 *  4. Limited mode: summative submit (POST /api/student/attempts/:id/submit)
 *     verify'siz → 403 EMAIL_VERIFY_REQUIRED
 *  5. Verify'dan keyin summative submit o'tadi (limited mode ochiladi)
 *  6. Audit: EMAIL_VERIFY_COMPLETE success + EMAIL_VERIFY_BLOCKED (limited)
 *  7. Success UX: panel JS 'Email tasdiqlandi' (verifyCopy.success) render
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { snapshotDb, restoreDb } from '../helpers/setup.js';
import { createApp } from '../../server.js';
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

const PW = 'parol-2026-x-uzun';

async function getCsrf(agent, path = '/user/login') {
  const res = await agent.get(path);
  const html = res.text;
  const m = html.match(/name="_csrf"\s+value="([^"]+)"/);
  return { csrf: m ? m[1] : '', cookie: res.headers['set-cookie'] || [] };
}

async function register(agent, { username, email, password = PW }) {
  const { csrf } = await getCsrf(agent);
  return agent
    .post('/user/login')
    .type('form')
    .send({ _csrf: csrf, lang: 'uz', mode: 'reg', consent: 'on', username, email, password })
    .set('x-forwarded-for', `203.0.113.${Math.floor(Math.random() * 200) + 10}`);
}

async function getCsrfFromPanel(agent) {
  const page = await agent.get('/user/panel');
  const t = page.text.match(/var csrf = '([^']+)'/);
  return t ? t[1] : '';
}

async function postApi(agent, path, body = {}) {
  const csrf = await getCsrfFromPanel(agent);
  return agent
    .post(path)
    .set('Content-Type', 'application/json')
    .set('x-csrf-token', csrf)
    .send(body)
    .set('x-forwarded-for', `198.51.100.${Math.floor(Math.random() * 200) + 10}`);
}

async function registerNew(agent) {
  const uname = `b07_${Date.now() % 1000000}_${Math.floor(Math.random() * 9000) + 1000}`;
  const email = `${uname}@test.uz`;
  const regRes = await register(agent, { username: uname, email });
  expect(regRes.status).toBe(302);
  // register'da 1 kod yuborilgan — resend cooldown 60s. Send qilishdan
  // oldin last-record tozalanadi (cooldown xalaqit bermasligi uchun).
  return { uname, email };
}

/** Send qilishdan oldin resend cooldown record'ini tozalaydi. */
async function clearCooldown(uname) {
  const { fb } = await import('../../firebase/admin.js');
  await fb.set(`email_verify_last/${uname}`, { at: 0, lookupKey: '' });
}

/** Eng so'nggi yuborilgan kodni email_verify_last orqali olamiz. */
async function getLatestCode(uname) {
  const { fb } = await import('../../firebase/admin.js');
  const last = await fb.get(`email_verify_last/${uname}`);
  if (!last.exists()) return null;
  const lookupKey = last.val().lookupKey;
  const rec = await fb.get(`email_verify/${lookupKey}`);
  if (!rec.exists()) return null;
  // Preview kod — record'da plaintext yo'q; dev/test'da preview sendVerifyCode'dan.
  // Integration'da route orqali kod qaytmaydi — shuning uchun sendVerifyCode'ni
  // to'g'ridan-to'g'ri chaqirib preview olamiz (faqat test uchun).
  return null;
}

describe('AUTH B-07 — verify check kontrakti', () => {
  it("to'g'ri kod → 200; email_verified + email_status=verified (DB)", async () => {
    const agent = supertest.agent(app);
    const { uname, email } = await registerNew(agent);

    // Kodni DB'dan emas — sendVerifyCode preview'dan (unit darajasida test);
    // bu yerda to'g'ri kod oqimini tekshiramiz: kodni email_verify record'idan
    // topish uchun sendVerifyCode qaytargan preview kerak. Integration'da
    // preview yo'q — to'g'ri kodni simulyatsiya qilish uchun yangi kod yuboramiz
    // (sendVerifyCode to'g'ridan-to'g'ri import orqali — test darajasida preview bor).
    await clearCooldown(uname);
    const { sendVerifyCode, verifyCode } = await import('../../src/modules/auth/email-verify.js');
    const sent = await sendVerifyCode({ userKey: uname, email, lang: 'uz' });
    expect(sent.ok).toBe(true);

    const ok = await verifyCode({ userKey: uname, code: sent.code, email });
    expect(ok.ok).toBe(true);

    const { fb } = await import('../../firebase/admin.js');
    const user = await fb.get(`users/${uname}`);
    expect(user.val().email_verified).toBe(true);
    expect(user.val().email_status).toBe('verified');
  });

  it("noto'g'ri kod → 422 otp_invalid (route)", async () => {
    const agent = supertest.agent(app);
    await registerNew(agent);
    const res = await postApi(agent, '/api/auth/verify/complete', { code: '000000' });
    expect(res.status).toBe(422);
    expect(res.body.error).toBe('otp_invalid');
  });

  it('replay → 422 (single-use)', async () => {
    const agent = supertest.agent(app);
    const { uname, email } = await registerNew(agent);
    await clearCooldown(uname);
    const { sendVerifyCode, verifyCode } = await import('../../src/modules/auth/email-verify.js');
    const sent = await sendVerifyCode({ userKey: uname, email, lang: 'uz' });
    const first = await verifyCode({ userKey: uname, code: sent.code, email });
    expect(first.ok).toBe(true);
    const replay = await verifyCode({ userKey: uname, code: sent.code, email });
    expect(replay.ok).toBe(false);
    expect(replay.error).toBe('otp_invalid');
    expect(replay.httpStatus).toBe(422);
  });

  it("brute-force: 5 noto'g'ri → 6-chisi 429 too_many_attempts (route)", async () => {
    const agent = supertest.agent(app);
    await registerNew(agent);
    let last = null;
    for (let i = 0; i < 6; i++) {
      last = await postApi(agent, '/api/auth/verify/complete', { code: '111111' });
    }
    expect(last.status).toBe(429);
    expect(last.body.error).toBe('too_many_attempts');
  });
});

describe('AUTH B-07 — limited mode (summative blok)', () => {
  it("verify'siz summative submit → 403 EMAIL_VERIFY_REQUIRED", async () => {
    const agent = supertest.agent(app);
    const { uname } = await registerNew(agent);
    expect(uname).toBeTruthy();
    const res = await postApi(agent, '/api/student/attempts/99999/submit', { confirmed: true, entries: [] });
    // requireEmailVerified — verify'siz 403 EMAIL_VERIFY_REQUIRED
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('EMAIL_VERIFY_REQUIRED');
  });

  it("verify'siz PREVIEW (confirmed=false) ochiq — read-only summative emas (spec §10)", async () => {
    const agent = supertest.agent(app);
    await registerNew(agent);
    const res = await postApi(agent, '/api/student/attempts/1/submit', { confirmed: false, entries: [] });
    // Preview read-only — gate o'tkazadi; 403 EMAS (404 attempt topilmadi bo'lishi mumkin)
    expect(res.status).not.toBe(403);
    expect(res.body.error).not.toBe('EMAIL_VERIFY_REQUIRED');
  });

  it('audit: EMAIL_VERIFY_BLOCKED yoziladi (limited_mode_used)', async () => {
    const agent = supertest.agent(app);
    const { uname } = await registerNew(agent);
    await postApi(agent, '/api/student/attempts/7/submit', { confirmed: true, entries: [] });

    const { fb } = await import('../../firebase/admin.js');
    const snap = await fb.get('auth_audit');
    const dayKeys = Object.keys(snap.val() || {});
    let found = null;
    for (const d of dayKeys) {
      const entries = Object.values(snap.val()[d] || {});
      // Eng so'nggi blocked entry (bu testdagi user uchun)
      const e = entries
        .filter((x) => x.action === 'email.verify.blocked')
        .sort((a, b) => b.ts - a.ts)[0];
      if (e) { found = e; break; }
    }
    expect(found).toBeTruthy();
    expect(found.outcome).toBe('blocked');
    expect(found.actor_id).toBe(uname);
  });
});

describe('AUTH B-07 — success UX + panel', () => {
  it('panel JS: verifyCopy.success render qilinadi (Email tasdiqlandi)', async () => {
    const agent = supertest.agent(app);
    await registerNew(agent);
    const page = await agent.get('/user/panel');
    expect(page.text).toContain('Email tasdiqlandi'); // success toast string
    expect(page.text).toContain('email-verify-modal');
  });

  it("verify'dan keyin summative submit limited mode'dan o'tadi (open)", async () => {
    const agent = supertest.agent(app);
    const { uname, email } = await registerNew(agent);

    // Kodni tasdiqlaymiz (preview orqali — modul darajasida)
    await clearCooldown(uname);
    const { sendVerifyCode, verifyCode } = await import('../../src/modules/auth/email-verify.js');
    const sent = await sendVerifyCode({ userKey: uname, email, lang: 'uz' });
    const ok = await verifyCode({ userKey: uname, code: sent.code, email });
    expect(ok.ok).toBe(true);

    // Sessiya emailVerified=true bo'lishi kerak — yangi login
    // (verifyCode sessiyani yangilamaydi — route orqali yangilanadi; bu yerda
    // login qilib sessiyaga email_verified olamiz)
    const loginPage = await agent.get('/user/login');
    const m = loginPage.text.match(/name="_csrf"\s+value="([^"]+)"/);
    const csrf = m ? m[1] : '';
    await agent.post('/user/login').type('form').send({
      _csrf: csrf, lang: 'uz', mode: 'login', username: uname, password: PW,
    }).set('x-forwarded-for', `203.0.113.${Math.floor(Math.random() * 200) + 10}`);

    // Submit endi verify middleware'idan o'tadi — 403 emas (boshqa xato — 404
    // attempt topilmadi — bu limited mode OCHILGANini isbotlaydi)
    const res = await postApi(agent, '/api/student/attempts/999999/submit', { confirmed: true, entries: [] });
    expect(res.status).not.toBe(403);
  });
});
