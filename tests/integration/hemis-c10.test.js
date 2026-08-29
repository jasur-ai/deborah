/**
 * AUTH C-10 — HEMIS account link (REST) integration
 * --------------------------------------------------
 * REST-first yo'l (talaba.hemis.uz/OTM endpoint — A-14 da live tasdiqlangan):
 *   POST /api/auth/hemis/link → success + session rotation (yangi csrfToken)
 *   POST /api/auth/hemis/unlink
 *   GET  /api/auth/hemis/status
 *
 * fetch() global'da mock'lanadi (provider `globalThis.fetch` ishlatadi va
 * server test jarayonida ishlaydi). Mock faqat HEMIS endpoint'larini tutadi,
 * qolgan so'rovlar (test server'ning o'zi) real fetch'ga o'tadi.
 *
 * Muhim: link muvaffaqiyatli bo'lgach server SESSIYANI AYLANTIRADI (yangi
 * cookie) — testlar keyingi so'rovlarda yangi set-cookie'ni ishlatadi.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { snapshotDb, restoreDb, startServer, stopServer } from '../helpers/setup.js';
import { fb } from '../../firebase/admin.js';
import { safeKey } from '../../utils/helpers.js';
import { _resetStores } from '../../src/modules/auth/providers/hemis.js';
import { _resetStores as resetLockoutStores } from '../../src/modules/auth/lockout.js';

let serverUrl;

beforeAll(async () => {
  snapshotDb();
  serverUrl = await startServer();
});

afterAll(async () => {
  await stopServer();
  restoreDb();
  vi.unstubAllGlobals();
});

// ── HEMIS mock (A-14 real shape asosida) — hemisId har testda unikal ──
let hemisId = '324251103717';
let hemisFailLogin = false;
const realFetch = globalThis.fetch.bind(globalThis);
function installHemisMock() {
  vi.stubGlobal('fetch', async (url, opts = {}) => {
    const u = String(url);
    if (u.includes('/rest/v1/auth/login')) {
      if (hemisFailLogin) {
        return new Response(JSON.stringify({ success: false, error: 'login failed', data: null, code: 401 }), {
          status: 401,
          headers: { 'content-type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({ success: true, data: { token: 'fake.jwt.sig' } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (u.includes('/rest/v1/account/me')) {
      const me = {
        id: 12345,
        first_name: 'SHOHJAHON',
        second_name: 'URISHBOYEV',
        third_name: 'JASUR O\u2018G\u2018LI',
        full_name: 'URISHBOYEV SHOHJAHON JASUR O\u2018G\u2018LI',
        student_id_number: hemisId,
        image: 'https://cdn.hemis.uz/img/123.png',
        birth_date: '2004-05-12',
        email: 's.urishboyev@tsue.uz',
        phone: '+998901234567',
        university: 'Toshkent davlat iqtisodiyot universiteti',
        specialty: { id: 525, name: 'Axborot xavfsizligi' },
        studentStatus: 'active',
        group: { id: 8551, name: 'AT-85/25', educationLang: 'uz' },
        faculty: { id: 7, name: 'Axborot texnologiyalari' },
        semester: 2,
      };
      return new Response(JSON.stringify({ success: true, data: me }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    return realFetch(url, opts);
  });
}

// ── Auth helpers (A-01 pattern) ──
async function getCsrf(cookie, xff) {
  const headers = cookie ? { cookie } : {};
  if (xff) headers['x-forwarded-for'] = xff;
  const res = await fetch(`${serverUrl}/user/login`, { headers });
  const html = await res.text();
  const m = html.match(/name="_csrf" value="([^"]+)"/);
  const m2 = html.match(/window\.__CSRF_TOKEN = '([^']+)'/);
  const csrf = m ? m[1] : m2 ? m2[1] : null;
  const c = cookie || sidFrom(res);
  return { csrf, cookie: c };
}

async function postForm(path, cookie, body, xff) {
  return fetch(`${serverUrl}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', cookie, ...(xff ? { 'x-forwarded-for': xff } : {}) },
    redirect: 'manual',
    body: new URLSearchParams(body).toString(),
  });
}

/** To'g'ri connect.sid olish — undici .get() ko'p set-cookie'ni vergul bilan
 *  birlashtirib cookie header'ni buzadi (CSRF 403 cascade manbai). */
function sidFrom(res) {
  const list = res.headers.getSetCookie ? res.headers.getSetCookie() : [res.headers.get('set-cookie') || ''];
  const flat = [].concat(list).flat();
  const sid = flat.map((c) => String(c).split(';')[0]).find((c) => c.startsWith('connect.sid='));
  return sid || (flat[0] ? String(flat[0]).split(';')[0] : '');
}

// AUTH C-01 izolyatsiyasi: har registerAndLogin noyob IP dan (XFF — auth.test.js
// patterni; register burst 5/s per-IP backstop) + register/login javoblari
// TEKSHIRILADI va transient xatoda 1 marta qayta uriniladi.
let ipSeq = 0;
async function registerAndLogin() {
  let lastErr = '';
  for (let attempt = 0; attempt < 2; attempt++) {
    const ip = `198.51.100.${(ipSeq++ % 150) + 3}`;
    const uname = `hemis_${Date.now() % 1000000}_${Math.floor(Math.random() * 1000)}_${attempt}`;
    const { csrf: csrfR, cookie: cookieR } = await getCsrf(null, ip);
    const reg = await postForm('/user/login', cookieR, {
      _csrf: csrfR, lang: 'uz', mode: 'reg', consent: 'on', username: uname, password: 'sirli-parol-2026',
      email: `hemis_c10_${Date.now()}_${Math.floor(Math.random() * 1000000)}@test.uz`,
    }, ip);
    if (reg.status !== 302) { lastErr = `register ${reg.status}`; continue; }
    const { csrf, cookie } = await getCsrf(null, ip);
    // Login javobidagi set-cookie — session regenerate'dan keyingi YANGI sessiya
    const loginRes = await postForm('/user/login', cookie, {
      _csrf: csrf, lang: 'uz', mode: 'login', username: uname, password: 'sirli-parol-2026',
    }, ip);
    const cookieL = sidFrom(loginRes);
    if (!cookieL || loginRes.status !== 302) { lastErr = `login ${loginRes.status}`; continue; }
    // Login'dan keyin sessiya CSRF token'i
    const g = await getCsrf(cookieL, ip);
    if (!g.csrf) { lastErr = 'csrf yoq'; continue; }
    const key = safeKey(uname.toLowerCase());
    return { uname, userKey: key, cookie: cookieL, csrf: g.csrf, ip };
  }
  throw new Error(`registerAndLogin failed: ${lastErr}`);
}

async function apiPost(cookie, csrf, path, body, xff) {
  return fetch(`${serverUrl}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie, 'x-csrf-token': csrf || '', ...(xff ? { 'x-forwarded-for': xff } : {}) },
    redirect: 'manual',
    body: JSON.stringify(body || {}),
  });
}

/** Link'dan keyin sessiya aylanadi — yangi cookie + csrf'ni qaytaradi. */
function nextSession(res) {
  const sid = sidFrom(res);
  return sid.startsWith('connect.sid=') ? sid : null;
}

describe('AUTH C-10 — HEMIS REST link flow', () => {
  // Per-IP rate limiter in-memory — har test oldidan tozalanadi (rate-limit
  // testi o'z ichida 11 urinishni to'playdi, qolgan testlar toza boshlaydi).
  beforeEach(() => {
    _resetStores();
    resetLockoutStores();
  });

  it('link success → 200, session rotation (yangi csrfToken), DB + index yoziladi', async () => {
    installHemisMock();
    hemisFailLogin = false;
    hemisId = `3241${String(Date.now()).slice(-8)}`;
    const { userKey, cookie, csrf, ip } = await registerAndLogin();

    // status — hali bog'lanmagan
    let st = await fetch(`${serverUrl}/api/auth/hemis/status`, { headers: { cookie } });
    let stj = await st.json();
    expect(stj.linked).toBe(false);
    expect(stj.restEnabled).toBe(true);

    const res = await apiPost(cookie, csrf, '/api/auth/hemis/link', {
      login: hemisId, password: 'top-secret',
    }, ip);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.csrfToken).toBeTruthy();
    expect(body.csrfToken).toMatch(/^[a-f0-9]{64}$/);
    expect(body.profile.fullName).toContain('URISHBOYEV');

    // Session rotation: yangi cookie + yangi CSRF
    const newCookie = nextSession(res);
    expect(newCookie).toBeTruthy();
    expect(newCookie).not.toBe(cookie);

    // DB: users/{key}/hemis + hemis_index
    const hSnap = await fb.get(`users/${userKey}/hemis`);
    expect(hSnap.exists()).toBe(true);
    expect(hSnap.val().hemisId).toBe(hemisId);
    const idx = await fb.get(`users_hemis_index/${safeKey(hemisId)}`);
    expect(idx.exists()).toBe(true);
    expect(idx.val()).toBe(userKey);

    // status endi linked (yangi sessiya bilan)
    st = await fetch(`${serverUrl}/api/auth/hemis/status`, { headers: { cookie: newCookie } });
    stj = await st.json();
    expect(stj.linked).toBe(true);
    expect(stj.profile.university).toContain('iqtisodiyot');

    // Audit: auth_audit'da hemis:linked success (C-02 qarori)
    const aSnap = await fb.get('auth_audit');
    let found = false;
    if (aSnap.exists()) {
      const days = aSnap.val();
      for (const dayKey of Object.keys(days)) {
        for (const k of Object.keys(days[dayKey])) {
          const e = days[dayKey][k];
          if (e?.action === 'hemis:linked' && e?.outcome === 'success') found = true;
        }
      }
    }
    expect(found).toBe(true);
  });

  it('noto\u2018g\u2018ri HEMIS parol → 401 invalid_credentials', async () => {
    installHemisMock();
    hemisFailLogin = true;
    hemisId = `4101${String(Date.now()).slice(-8)}`;
    const { cookie, csrf, ip } = await registerAndLogin();
    const res = await apiPost(cookie, csrf, '/api/auth/hemis/link', {
      login: hemisId, password: 'noto-ri',
    }, ip);
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe('invalid_credentials');
  });

  it('bir xil hemis_id boshqa akkauntga bog\u2018langan → 409', async () => {
    installHemisMock();
    hemisFailLogin = false;
    hemisId = `5022${String(Date.now()).slice(-8)}`;
    const a = await registerAndLogin();
    const b = await registerAndLogin();
    // A birinchi bog'laydi
    let res = await apiPost(a.cookie, a.csrf, '/api/auth/hemis/link', { login: hemisId, password: 'x' }, a.ip);
    expect(res.status).toBe(200);
    // B bog'lashga urinadi → 409
    res = await apiPost(b.cookie, b.csrf, '/api/auth/hemis/link', { login: hemisId, password: 'x' }, b.ip);
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toBe('hemis_already_linked');
    // B'ga yozilmagan
    const bSnap = await fb.get(`users/${b.userKey}/hemis`);
    expect(bSnap.exists()).toBe(false);
  });

  it('rate limit — 10+ urinish → 429', async () => {
    installHemisMock();
    // Fail login — har urinish checkLinkLimit'ga yetadi (session aylanmaydi),
    // aks holda 1-urinish sessiyani aylantirib qolganlarini CSRF 403'ga tashlar edi.
    hemisFailLogin = true;
    hemisId = `6033${String(Date.now()).slice(-8)}`;
    const { cookie, csrf, ip } = await registerAndLogin();
    let lastStatus = 0;
    // checkLinkLimit per-user 10/15 daqiqa — 11-urinish 429
    for (let i = 0; i < 11; i++) {
      const res = await apiPost(cookie, csrf, '/api/auth/hemis/link', {
        login: hemisId, password: 'x',
      }, ip);
      lastStatus = res.status;
    }
    expect(lastStatus).toBe(429);
  });

  it('unlink → 200, DB va index tozalanadi', async () => {
    installHemisMock();
    hemisFailLogin = false;
    hemisId = `7044${String(Date.now()).slice(-8)}`;
    const { userKey, cookie, csrf, ip } = await registerAndLogin();
    const linkRes = await apiPost(cookie, csrf, '/api/auth/hemis/link', { login: hemisId, password: 'x' }, ip);
    expect(linkRes.status).toBe(200);
    // Rotation'dan keyingi sessiya + csrf
    const newCookie = nextSession(linkRes);
    const g = await getCsrf(newCookie);

    const res = await apiPost(newCookie, g.csrf, '/api/auth/hemis/unlink', {}, ip);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);

    const hSnap = await fb.get(`users/${userKey}/hemis`);
    expect(hSnap.exists()).toBe(false);
    const idx = await fb.get(`users_hemis_index/${safeKey(hemisId)}`);
    expect(idx.exists()).toBe(false);

    // status linked=false (yangi sessiya bilan)
    const st = await fetch(`${serverUrl}/api/auth/hemis/status`, { headers: { cookie: newCookie } });
    const stj = await st.json();
    expect(stj.linked).toBe(false);
  });

  it('security-profile sahifasida HEMIS UI YO‘Q (2026-08-27: butunlay olib tashlandi)', async () => {
    installHemisMock();
    hemisFailLogin = false;
    hemisId = `8055${String(Date.now()).slice(-8)}`;
    const { cookie, csrf, ip } = await registerAndLogin();
    const linkRes = await apiPost(cookie, csrf, '/api/auth/hemis/link', { login: hemisId, password: 'x' }, ip);
    expect(linkRes.status).toBe(200);
    const newCookie = nextSession(linkRes);

    const res = await fetch(`${serverUrl}/user/security-profile`, { headers: { cookie: newCookie } });
    expect(res.status).toBe(200);
    const html = await res.text();
    // Link API orqali bog'langan bo'lsa ham sahifada HEMIS bloki KO'RINMASLIGI kerak
    expect(html).not.toContain('hemis-card');
    expect(html).not.toContain('/js/hemis-link.js');
    expect(html).not.toContain('HEMIS');
  });
});
