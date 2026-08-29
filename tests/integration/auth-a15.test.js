/**
 * AUTH A-15 — HEMIS identity (REST-first linking) — integration
 * -------------------------------------------------------------------
 * Qamrov (guide §15, 24-26):
 *  - Link: HEMIS login/parol → REST login (mock) → profil → bog'lash
 *  - Parol HECH QACHON saqlanmaydi (DB'da yo'qligi tekshiriladi)
 *  - Unique hemis_id: ikkinchi akkauntga link → 409
 *  - Noto'g'ri parol → 401 (silent emas — HEMIS'dan farqli)
 *  - Rate limit: 10/15 daqiqa → 429
 *  - CSRF: token yo'q → 403
 *  - OAuth gating: client sozlanmagan → /auth/hemis 404
 *  - Unlink: mapping olib tashlanadi; qayta link ishlaydi
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { createApp } from '../../server.js';
import CONFIG from '../../src/config/env.js';
import { snapshotDb, restoreDb } from '../helpers/setup.js';
import { fb } from '../../firebase/admin.js';
import { safeKey } from '../../utils/helpers.js';

let httpServer;
let supertest;

const HEMIS_ID = '324251103717';
// Har test o'z hemis_id bilan ishlashi uchun — mock login'dan id'ni oladi.
let lastLoginId = HEMIS_ID;
const REAL_ACCOUNT_ME = {
  success: true,
  error: null,
  data: {
    id: 12345,
    student_id_number: HEMIS_ID,
    full_name: 'URISHBOYEV SHOHJAHON',
    first_name: 'SHOHJAHON',
    second_name: 'URISHBOYEV',
    university: 'Toshkent davlat iqtisodiyot universiteti',
    specialty: { name: 'Axborot xavfsizligi' },
    group: { name: 'AT-85/25' },
    semester: 2,
    email: 's@tsue.uz',
  },
};
// iss=hemis.324 → universityId 324
const FAKE_JWT =
  'eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJpc3MiOiJoZW1pcy4zMjQiLCJhdWQiOiJzdHVkZW50IiwianRpIjoiMSJ9.sig';

const jsonRes = (status, body) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

beforeAll(async () => {
  snapshotDb();
  const result = await createApp();
  httpServer = result.httpServer;
  await new Promise((resolve) => httpServer.listen(0, resolve));
  supertest = (await import('supertest')).default;

  // HEMIS tarmoq so'rovlarini mock'laymiz; qolgan fetch'lar real ishlaydi.
  const realFetch = globalThis.fetch;
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, opts) => {
    const u = String(url);
    if (u.includes('/rest/v1/auth/login')) {
      const body = JSON.parse(opts?.body || '{}');
      if (body.password === 'wrong-password') {
        return jsonRes(401, { success: false, error: 'Login yoki parol xato', code: 401 });
      }
      lastLoginId = String(body.login || HEMIS_ID);
      return jsonRes(200, { success: true, error: null, data: { token: FAKE_JWT } });
    }
    if (u.includes('/rest/v1/account/me')) {
      return jsonRes(200, {
        ...REAL_ACCOUNT_ME,
        data: { ...REAL_ACCOUNT_ME.data, student_id_number: lastLoginId },
      });
    }
    return realFetch(url, opts);
  });
}, 90000);

afterAll(async () => {
  await new Promise((resolve) => httpServer.close(resolve));
  vi.restoreAllMocks();
  restoreDb();
});

const csrfFrom = (html) => {
  const m = html.match(/name="_csrf"\s+value="([^"]+)"/) || html.match(/__CSRF_TOKEN\s*=\s*'([^']+)'/);
  return m ? m[1] : '';
};

/**
 * Yangi akkaunt register (auto-login) → yangi AGENT + shu sessiyaning CSRF'i.
 * Muhim: har test uchun fresh agent — aks holda oldingi sessiya qayta
 * ishlatilib, register redirectIfAuth tufayli bajarilmay qoladi.
 */
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
      email: `a15_${Date.now()}_${Math.floor(Math.random() * 1000000)}@test.uz`,
    });
  const panel = await a.get('/user/panel').set('X-Forwarded-For', xff);
  if (panel.status !== 200) throw new Error(`register/login failed: ${panel.status}`);
  return { agent: a, csrf: csrfFrom(panel.text) };
}

describe('AUTH A-15 — HEMIS account linking (REST)', () => {
  it('GET /api/auth/hemis/status — authsiz 401/302, auth bilan linked:false', async () => {
    const anon = supertest.agent(httpServer);
    const anonRes = await anon.get('/api/auth/hemis/status');
    expect([302, 401]).toContain(anonRes.status);

    const { agent: a } = await registerAndLogin(
      `hemis_a_${Date.now() % 1000000}`, 'sirli-parol-2026', '203.0.113.31'
    );
    const res = await a.get('/api/auth/hemis/status').set('X-Forwarded-For', '203.0.113.31');
    expect(res.status).toBe(200);
    const data = res.body;
    expect(data.linked).toBe(false);
    expect(data.restEnabled).toBe(true);
    expect(data.oauthConfigured).toBe(false);
  });

  it('POST /api/auth/hemis/link — muvaffaqiyat; parol HECH QAYERDA saqlanmaydi', async () => {
    const uname = `hemis_b_${Date.now() % 1000000}`;
    const pw = 'hemis-parol-2026';
    const { agent: a, csrf } = await registerAndLogin(uname, pw, '203.0.113.32');

    const res = await a
      .post('/api/auth/hemis/link')
      .set('X-Forwarded-For', '203.0.113.32')
      .set('x-csrf-token', csrf)
      .send({ login: '201', password: pw });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.profile.fullName).toBe('URISHBOYEV SHOHJAHON');
    expect(res.body.profile.university).toContain('Toshkent davlat');

    // DB: hemis mapping saqlangan
    const snap = await fb.get(`users/${safeKey(uname)}/hemis`);
    expect(snap.exists()).toBe(true);
    const h = snap.val();
    expect(h.hemisId).toBe('201');
    expect(h.universityId).toBe('324');
    expect(h.source).toBe('rest');
    // Parol YO'Q
    expect(h.password).toBeUndefined();
    expect(h.pass).toBeUndefined();
    const userRec = await fb.get(`users/${safeKey(uname)}`);
    expect(JSON.stringify(userRec.val())).not.toContain(pw);
  });

  it('Unique hemis_id — boshqa akkaunt bilan link → 409', async () => {
    // Avval user A hemis_id (202) ni bog'lasin
    const { agent: a1, csrf: c1 } = await registerAndLogin(
      `hemis_p_${Date.now() % 1000000}`, 'sirli-parol-2026', '203.0.113.43'
    );
    const first = await a1
      .post('/api/auth/hemis/link')
      .set('X-Forwarded-For', '203.0.113.43')
      .set('x-csrf-token', c1)
      .send({ login: '202', password: 'hemis-parol-2026' });
    expect(first.status).toBe(200);

    // Boshqa user shu hemis_id ni bog'lay olmaydi
    const unameB = `hemis_c_${Date.now() % 1000000}`;
    const { agent: a2, csrf: c2 } = await registerAndLogin(unameB, 'sirli-parol-2026', '203.0.113.33');
    const res = await a2
      .post('/api/auth/hemis/link')
      .set('X-Forwarded-For', '203.0.113.33')
      .set('x-csrf-token', c2)
      .send({ login: '202', password: 'hemis-parol-2026' });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('hemis_already_linked');
  });

  it('Noto\'g\'ri parol → 401 (silent emas)', async () => {
    const unameD = `hemis_d_${Date.now() % 1000000}`;
    const { agent: a, csrf } = await registerAndLogin(unameD, 'sirli-parol-2026', '203.0.113.34');
    const res = await a
      .post('/api/auth/hemis/link')
      .set('X-Forwarded-For', '203.0.113.34')
      .set('x-csrf-token', csrf)
      .send({ login: HEMIS_ID, password: 'wrong-password' });
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('invalid_credentials');
  });

  it('CSRF token yo\'q → 403', async () => {
    const unameE = `hemis_e_${Date.now() % 1000000}`;
    const { agent: a } = await registerAndLogin(unameE, 'sirli-parol-2026', '203.0.113.35');
    const res = await a
      .post('/api/auth/hemis/link')
      .set('X-Forwarded-For', '203.0.113.35')
      .send({ login: HEMIS_ID, password: 'hemis-parol-2026' });
    expect(res.status).toBe(403);
  });

  it('Rate limit — HEMIS_LINK_MAX/15 daqiqa; limit+1-chi urinish → 429', async () => {
    const unameF = `hemis_f_${Date.now() % 1000000}`;
    const { agent: a, csrf } = await registerAndLogin(unameF, 'sirli-parol-2026', '203.0.113.36');
    const max = CONFIG.HEMIS_LINK_MAX;
    expect(max).toBeGreaterThan(0);
    let last;
    for (let i = 0; i <= max; i++) {
      last = await a
        .post('/api/auth/hemis/link')
        .set('X-Forwarded-For', '203.0.113.36')
        .set('x-csrf-token', csrf)
        .send({ login: HEMIS_ID, password: 'wrong-password' });
    }
    expect(last.status).toBe(429);
    expect(last.body.error).toBe('too_many_attempts');
    expect(last.body.retryAfterSeconds).toBeGreaterThan(0);
  });

  it('POST /api/auth/hemis/unlink — mapping olib tashlanadi; qayta link ishlaydi', async () => {
    const unameG = `hemis_g_${Date.now() % 1000000}`;
    const pw = 'hemis-parol-2026';
    const { agent: a, csrf } = await registerAndLogin(unameG, pw, '203.0.113.37');
    const linkRes = await a
      .post('/api/auth/hemis/link')
      .set('X-Forwarded-For', '203.0.113.37')
      .set('x-csrf-token', csrf)
      .send({ login: '203', password: pw });
    // C-10 §12: link session'ni aylantiradi — yangi CSRF token response'dan olinadi
    const csrfAfterLink = linkRes.body.csrfToken || csrf;
    // Boshqa user bu orada link qilolmasin (index'dan tozalash tekshiruvi)
    const unameG2 = `hemis_h_${Date.now() % 1000000}`;
    const { agent: a2, csrf: t2 } = await registerAndLogin(unameG2, 'sirli-parol-2026', '203.0.113.38');
    const conflict = await a2
      .post('/api/auth/hemis/link')
      .set('X-Forwarded-For', '203.0.113.38')
      .set('x-csrf-token', t2)
      .send({ login: '203', password: pw });
    expect(conflict.status).toBe(409);

    // Unlink
    const unlink = await a
      .post('/api/auth/hemis/unlink')
      .set('X-Forwarded-For', '203.0.113.37')
      .set('x-csrf-token', csrfAfterLink);
    expect(unlink.status).toBe(200);
    const snap = await fb.get(`users/${safeKey(unameG)}/hemis`);
    expect(snap.exists()).toBe(false);
    const idx = await fb.get(`users_hemis_index/${safeKey('203')}`);
    expect(idx.exists()).toBe(false);

    // Qayta link (endi bo'sh) — muvaffaqiyat
    const relink = await a
      .post('/api/auth/hemis/link')
      .set('X-Forwarded-For', '203.0.113.37')
      .set('x-csrf-token', csrfAfterLink)
      .send({ login: '203', password: pw });
    expect(relink.status).toBe(200);
  });

  it('OAuth gating — client sozlanmagan → /auth/hemis 404', async () => {
    const anon = supertest.agent(httpServer);
    const res = await anon.get('/auth/hemis').set('X-Forwarded-For', '203.0.113.39');
    expect(res.status).toBe(404);
    const cb = await anon.get('/auth/hemis/callback?code=x&state=y');
    expect(cb.status).toBe(404);
  });
});
