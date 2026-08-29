/**
 * Deborah — AUTH A-06: Parol tiklash flow (API + to'liq oqim)
 * ----------------------------------------------------------
 * Guide A-06 §25-27:
 *  - Unit: token uzunlik/unique; expiry; bitta foydalanish; Zod.
 *  - Integration: request→verify→complete→avtomatik login;
 *    eski sessiya revoke; stale token 410.
 *  - Security: takroriy ishlatish blok; enumeration-safe request.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import crypto from 'crypto';
import { snapshotDb, restoreDb, startServer, stopServer } from '../helpers/setup.js';
import { fb } from '../../firebase/admin.js';
import {
  parseResetRequest,
  parseResetComplete,
} from '../../src/modules/auth/validation.js';

let serverUrl;

beforeAll(async () => {
  snapshotDb();
  serverUrl = await startServer();
}, 90000);

afterAll(async () => {
  await stopServer();
  restoreDb();
});

/** CSRF token + cookie'ni olish (sessiya bilan bog'langan). */
async function getCsrf(path = '/user/login') {
  const res = await fetch(`${serverUrl}${path}`);
  const html = await res.text();
  const m = html.match(/name="_csrf" value="([^"]+)"/);
  const cookie = (res.headers.get('set-cookie') || '').split(';')[0];
  return { csrf: m ? m[1] : null, cookie };
}

async function postForm(path, cookie, body, xff) {
  return fetch(`${serverUrl}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      cookie,
      ...(xff ? { 'x-forwarded-for': xff } : {}),
    },
    redirect: 'manual',
    body: new URLSearchParams(body).toString(),
  });
}

async function postJson(path, cookie, csrf, body, xff) {
  return fetch(`${serverUrl}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      cookie,
      'x-csrf-token': csrf || '',
      ...(xff ? { 'x-forwarded-for': xff } : {}),
    },
    redirect: 'manual',
    body: JSON.stringify(body),
  });
}

/** Yangi user yaratadi (login formasi orqali) → { username, password }. */
async function registerUser(xff) {
  const uname = `a06u_${Date.now() % 1000000}_${Math.floor(Math.random() * 1000)}`;
  const password = 'eski-parol-2026';
  const { csrf, cookie } = await getCsrf('/user/login');
  const res = await postForm('/user/login', cookie, {
    _csrf: csrf, lang: 'uz', mode: 'reg', consent: 'on', username: uname, password,
      email: `r8_${Date.now()}_${Math.floor(Math.random() * 1000000)}_a18@test.uz`,
  }, xff);
  expect(res.status).toBe(302);
  // AUTH A-20: reset token faqat email_verified=true userlarga — A-06 testlari
  // reset flow'ni tekshiradi (verify emas), shuning uchun verified qilamiz.
  await fb.set(`users/${uname}/email_verified`, true);
  return { username: uname, password };
}

/** DB'ga to'g'ridan-to'g'ri reset token yozadi (forgot logikasi bilan bir xil). */
async function createToken(userKey) {
  const token = crypto.randomBytes(48).toString('hex');
  const hash = crypto.createHash('sha256').update(token).digest('hex');
  await fb.set(`resetTokens/${hash}`, {
    safeKey: userKey,
    expiresAt: Date.now() + 15 * 60 * 1000,
    createdAt: Date.now(),
  });
  await fb.set(`resetTokensByUser/${userKey}/${hash}`, true);
  return { token, hash };
}

describe('AUTH A-06 — Zod validatsiya (unit)', () => {
  it('resetRequestSchema: yaroqli account o\'tadi', () => {
    const r = parseResetRequest({ account: 'alisher', lang: 'uz' });
    expect(r.ok).toBe(true);
    expect(r.account).toBe('alisher');
  });

  it('resetRequestSchema: bo\'sh/uzun account rad etiladi', () => {
    expect(parseResetRequest({}).ok).toBe(false);
    expect(parseResetRequest({ account: '' }).ok).toBe(false);
    expect(parseResetRequest({ account: 'a'.repeat(101) }).ok).toBe(false);
  });

  it('resetCompleteSchema: token 96 belgi hex; parol min schema-level + complexity yo\'q (NIST A-22)', () => {
    // AUTH A-22: schema'da complexity talabi YO'Q — faqat required + max.
    // Haqiqiy min (15) va zxcvbn tekshiruvi password-policy da (route darajasida).
    const good = parseResetComplete({
      token: crypto.randomBytes(48).toString('hex'),
      password: 'YangiParol123-uzun',
    });
    expect(good.ok).toBe(true);

    // Faqat harfli (raqamsiz) uzun parol — NIST bo'yicha QABUL (complexity yo'q)
    const lettersOnly = parseResetComplete({
      token: crypto.randomBytes(48).toString('hex'),
      password: 'faqatharflardaniboratparol',
    });
    expect(lettersOnly.ok).toBe(true);

    // Token qisqa → rad
    expect(parseResetComplete({ token: 'short', password: 'YangiParol123-uzun' }).ok).toBe(false);
    // Parol bo'sh → rad
    expect(parseResetComplete({ token: crypto.randomBytes(48).toString('hex'), password: '' }).ok).toBe(false);
  });
});

describe('AUTH A-06 — API reset flow (request→verify→complete)', () => {
  const xff = '203.0.113.40';
  let user;

  beforeAll(async () => {
    user = await registerUser(xff);
  });

  it('POST /api/reset/request — enumeration-safe: mavjud bo\'lmagan ham bir xil javob', async () => {
    const { csrf, cookie } = await getCsrf('/user/login');
    const existsRes = await postJson('/api/reset/request', cookie, csrf, { account: user.username, lang: 'uz' }, xff);
    expect(existsRes.status).toBe(200);
    const existsBody = await existsRes.json();
    expect(existsBody.ok).toBe(true);
    expect(existsBody.message).toBe('reset.sent');

    const missingRes = await postJson('/api/reset/request', cookie, csrf, { account: 'bunday_akkaunt_yoq_999', lang: 'uz' }, '203.0.113.41');
    const missingBody = await missingRes.json();
    expect(missingBody.ok).toBe(true);
    expect(missingBody.message).toBe('reset.sent'); // bir xil javob
  });

  it('POST /api/reset/verify — valid | invalid | expired holatlari', async () => {
    const { token } = await createToken(user.username);
    const { csrf, cookie } = await getCsrf('/user/login');

    const validRes = await postJson('/api/reset/verify', cookie, csrf, { token }, xff);
    expect(validRes.status).toBe(200);
    expect(await validRes.json()).toEqual({ ok: true, code: 'valid' });

    const invalidRes = await postJson('/api/reset/verify', cookie, csrf, { token: 'bogus-token' }, xff);
    expect((await invalidRes.json()).code).toBe('invalid');

    // Eskirgan token
    const oldToken = crypto.randomBytes(48).toString('hex');
    const oldHash = crypto.createHash('sha256').update(oldToken).digest('hex');
    await fb.set(`resetTokens/${oldHash}`, {
      safeKey: user.username,
      expiresAt: Date.now() - 1000,
      createdAt: Date.now() - 20 * 60 * 1000,
    });
    const expiredRes = await postJson('/api/reset/verify', cookie, csrf, { token: oldToken }, xff);
    expect((await expiredRes.json()).code).toBe('expired');
  });

  it('POST /api/reset/complete — to\'liq oqim: yangi parol + avtomatik login + eski parol o\'ladi', async () => {
    const { token } = await createToken(user.username);
    const { csrf, cookie } = await getCsrf('/user/login');
    const newPw = 'yangi-parol-2026';

    const completeRes = await postJson('/api/reset/complete', cookie, csrf, { token, password: newPw }, xff);
    expect(completeRes.status).toBe(200);
    const body = await completeRes.json();
    expect(body.ok).toBe(true);
    expect(body.redirect).toBe('/user/panel');

    // Token iste'mol qilingan (bitta foydalanish)
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const snap = await fb.get(`resetTokens/${tokenHash}`);
    expect(snap.exists()).toBe(false);
    const userIdx = await fb.get(`resetTokensByUser/${user.username}`);
    expect(userIdx.exists()).toBe(false);

    // Yangi parol bilan login
    const { csrf: c1, cookie: ck1 } = await getCsrf('/user/login');
    const loginOk = await postForm('/user/login', ck1, {
      _csrf: c1, lang: 'uz', mode: 'login', username: user.username, password: newPw,
    }, xff);
    expect(loginOk.status).toBe(302);
    expect(loginOk.headers.get('location')).toBe('/user/panel');

    // Eski parol endi ishlamaydi
    const { csrf: c2, cookie: ck2 } = await getCsrf('/user/login');
    const loginOld = await postForm('/user/login', ck2, {
      _csrf: c2, lang: 'uz', mode: 'login', username: user.username, password: user.password,
    }, xff);
    expect(loginOld.status).toBe(200); // xato sahifa, redirect emas
  });

  it('Takroriy ishlatish blok — ishlatilgan token 410 qaytaradi', async () => {
    const { token } = await createToken(user.username);
    const { csrf, cookie } = await getCsrf('/user/login');
    const newPw = 'yana-yangi-2026';

    const first = await postJson('/api/reset/complete', cookie, csrf, { token, password: newPw }, xff);
    expect(first.status).toBe(200);

    // Complete'dan keyin sessiya regenerate bo'ldi — yangi cookie + CSRF olamiz.
    // Token yo'qolgan → 410
    const { csrf: cs2, cookie: ck2 } = await getCsrf('/user/login');
    const second = await postJson('/api/reset/complete', ck2, cs2, { token, password: newPw }, xff);
    expect(second.status).toBe(410);
    expect((await second.json()).code).toBe('RESET_TOKEN_INVALID');
  });

  it('BARCHA eski tokenlar invalid — bitta complete qolganlarini ham o\'ldiradi (guide §14)', async () => {
    const { token: t1 } = await createToken(user.username);
    const { token: t2 } = await createToken(user.username);
    const { csrf, cookie } = await getCsrf('/user/login');

    // t1 bilan complete → t2 ham o'ladi
    const res = await postJson('/api/reset/complete', cookie, csrf, { token: t1, password: 'boshqa-parol-2026' }, xff);
    expect(res.status).toBe(200);

    // Complete'dan keyin yangi sessiya — yangi cookie + CSRF olamiz
    const { csrf: cs2, cookie: ck2 } = await getCsrf('/user/login');
    const t2Res = await postJson('/api/reset/verify', ck2, cs2, { token: t2 }, xff);
    expect(t2Res.status).toBe(200);
    expect((await t2Res.json()).code).toBe('invalid');
  });
});

describe('AUTH A-06 — eski sessiya revoke (guide §15)', () => {
  const xff = '203.0.113.42';

  it('Reset dan keyin eski sessiya /user/panel ga kira olmaydi', async () => {
    const user = await registerUser(xff);

    // Eski sessiya: login qilamiz — login success'da session regenerate bo'ladi,
    // shuning uchun response'dagi YANGI cookie'ni olamiz.
    const { csrf, cookie } = await getCsrf('/user/login');
    const loginRes = await postForm('/user/login', cookie, {
      _csrf: csrf, lang: 'uz', mode: 'login', username: user.username, password: user.password,
    }, xff);
    expect(loginRes.status).toBe(302);
    const newCookie = (loginRes.headers.get('set-cookie') || '').split(';')[0] || cookie;
    const panelRes = await fetch(`${serverUrl}/user/panel`, { headers: { cookie: newCookie }, redirect: 'manual' });
    expect(panelRes.status).toBe(200); // eski sessiya ishlaydi

    // Reset complete (yangi cookie bilan)
    const { token } = await createToken(user.username);
    const { csrf: cs2, cookie: ck2 } = await getCsrf('/user/login');
    const complete = await postJson('/api/reset/complete', ck2, cs2, {
      token, password: 'revoke-parol-2026',
    }, xff);
    expect(complete.status).toBe(200);

    // Eski cookie'li sessiya revoke qilingan → /user/panel'ga kira olmaydi
    // (302 login'ga redirect yoki 401 unauthorized — route middleware'iga qarab;
    //  ikkalasi ham sessiya o'lganini isbotlaydi)
    const afterRes = await fetch(`${serverUrl}/user/panel`, { headers: { cookie: newCookie }, redirect: 'manual' });
    expect([302, 401]).toContain(afterRes.status);
  });
});

describe('AUTH A-06 — HTML flow (to\'liq, regression)', () => {
  const xff = '203.0.113.43';

  it('GET verify → POST complete → success ekrani → role redirect', async () => {
    const user = await registerUser(xff);
    const { token } = await createToken(user.username);

    const verifyRes = await fetch(`${serverUrl}/user/reset?token=${token}`, { redirect: 'manual' });
    const verifyHtml = await verifyRes.text();
    expect(verifyHtml).toContain('id="form-reset"');
    expect(verifyHtml).toContain(`value="${token}"`);

    const { csrf, cookie } = await getCsrf(`/user/reset?token=${token}`);
    const postRes = await postForm('/user/reset', cookie, {
      _csrf: csrf, lang: 'uz', token, password: 'html-yangi-2026',
    }, xff);
    expect(postRes.status).toBe(200);
    const successHtml = await postRes.text();
    expect(successHtml).toContain('Parol yangilandi');
    expect(successHtml).toContain('/user/panel');
  });
});
