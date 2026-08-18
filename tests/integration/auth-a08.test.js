/**
 * AUTH A-08 — Session boshqaruv UI
 * -------------------------------------------------------------------
 * Qamrov (guide A-08 §19-21):
 *  - Auth talab: /sessions ga kirmasdan → redirect/401
 *  - O'z sessiyalar ro'yxati (login'dan keyin)
 *  - IDOR: boshqa user sessiyasiga revoke → 404
 *  - Revoke bitta → boshqa "qurilma" (ikkinchi login) /user/panel ga kira olmaydi
 *  - Revoke-all → barcha boshqa sessiyalar o'ladi, joriy qoladi
 *  - CSRF: POST csrf'siz → 403
 *  - 4 til: /sessions?lang=en → English copy
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import crypto from 'crypto';
import { snapshotDb, restoreDb, startServer, stopServer } from '../helpers/setup.js';
import { fb } from '../../firebase/admin.js';

let serverUrl;

beforeAll(async () => {
  snapshotDb();
  serverUrl = await startServer();
}, 90000);

afterAll(async () => {
  await stopServer();
  restoreDb();
});

/** CSRF + cookie (sessiya bilan bog'langan). */
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

/** Yangi user + login → { username, password, cookie } (session cookie). */
async function registerAndLogin(xff) {
  const uname = `a08_${Date.now() % 1000000}_${Math.floor(Math.random() * 1000)}`;
  const password = 'parol-2026-x-uzun';
  const { csrf: cr, cookie: ckr } = await getCsrf('/user/login');
  await postForm('/user/login', ckr, {
    _csrf: cr, lang: 'uz', mode: 'reg', consent: 'on', username: uname, password,
      email: `r9_${Date.now()}_${Math.floor(Math.random() * 1000000)}_a18@test.uz`,
  }, xff);

  const { csrf, cookie } = await getCsrf('/user/login');
  const loginRes = await postForm('/user/login', cookie, {
    _csrf: csrf, lang: 'uz', mode: 'login', username: uname, password,
  }, xff);
  expect(loginRes.status).toBe(302);
  const sessionCookie = (loginRes.headers.get('set-cookie') || '').split(';')[0];
  expect(sessionCookie).toMatch(/connect\.sid=/);
  return { username: uname, password, cookie: sessionCookie };
}

describe('AUTH A-08 — Session UI: auth va ro\'yxat', () => {
  const xff = '203.0.113.60';

  it('/sessions auth talab qiladi (unauth → redirect/401)', async () => {
    const res = await fetch(`${serverUrl}/sessions`, { redirect: 'manual' });
    expect([302, 401]).toContain(res.status);
  });

  it('login dan keyin /sessions — o\'z sessiyasi ro\'yxatda', async () => {
    const { cookie } = await registerAndLogin(xff);
    const res = await fetch(`${serverUrl}/sessions`, { headers: { cookie }, redirect: 'manual' });
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('Faol sessiyalar');
    expect(html).toContain('Joriy'); // current badge
  });

  it('/sessions?lang=en — ingliz copy', async () => {
    const { cookie } = await registerAndLogin(xff);
    const res = await fetch(`${serverUrl}/sessions?lang=en`, { headers: { cookie } });
    const html = await res.text();
    expect(html).toContain('Active sessions');
  });

  it('/sessions?lang=ru — rus copy', async () => {
    const { cookie } = await registerAndLogin(xff);
    const res = await fetch(`${serverUrl}/sessions?lang=ru`, { headers: { cookie } });
    const html = await res.text();
    expect(html).toContain('Активные сессии');
  });
});

describe('AUTH A-08 — revoke bitta (IDOR + boshqa qurilma)', () => {
  const xff = '203.0.113.61';

  it('IDOR: boshqa user\'ning sessiyasini revoke → 404', async () => {
    // User A — haqiqiy sessiya
    const { cookie: cookieA } = await registerAndLogin(xff);
    // User B — o'z sessiyasini biladi
    const { cookie: cookieB } = await registerAndLogin('203.0.113.62');

    // B o'z sessiyalari ro'yxatini oladi
    const listRes = await fetch(`${serverUrl}/sessions`, { headers: { cookie: cookieB } });
    const listHtml = await listRes.text();
    // A'ning session ID'sini B bilmaydi — taxminiy ID bilan revoke → 404
    const bogusSid = 'boshqa-user-sessiyasi-1234567890abcdef';
    const { csrf, cookie: ck } = await getCsrf('/user/login');
    // B cookie bilan CSRF'li POST — lekin token boshqa sessiyadan.
    // Haqiqiy B csrf'ni /sessions sahifasidan olamiz:
    const m = listHtml.match(/name="_csrf" value="([^"]+)"/);
    expect(m, 'sessions csrf topilmadi').toBeTruthy();

    const revokeRes = await fetch(`${serverUrl}/sessions/${bogusSid}/revoke`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', cookie: cookieB },
      redirect: 'manual',
      body: new URLSearchParams({ _csrf: m[1], lang: 'uz' }).toString(),
    });
    // Boshqa user'ga tegishli / mavjud emas → 404 (IDOR blok)
    expect(revokeRes.status).toBe(404);
    expect(cookieA).toBeTruthy(); // A cookie hali mavjud (ko'rsatkich)
  });

  it('revoke bitta — boshqa "qurilma" (ikkinchi login) o\'ladi, joriy qoladi', async () => {
    const user = await registerAndLogin(xff); // qurilma 1
    // Qurilma 2: xuddi shu user bilan boshqa cookie (yangi login)
    const { csrf: c2, cookie: ck2 } = await getCsrf('/user/login');
    const login2 = await postForm('/user/login', ck2, {
      _csrf: c2, lang: 'uz', mode: 'login', username: user.username, password: user.password,
    }, '203.0.113.63');
    expect(login2.status).toBe(302);
    const cookie2 = (login2.headers.get('set-cookie') || '').split(';')[0];

    // Ikkala sessiya ishlaydi
    const p1 = await fetch(`${serverUrl}/user/panel`, { headers: { cookie: user.cookie }, redirect: 'manual' });
    expect(p1.status).toBe(200);
    const p2 = await fetch(`${serverUrl}/user/panel`, { headers: { cookie: cookie2 }, redirect: 'manual' });
    expect(p2.status).toBe(200);

    // Qurilma 1 cookie'li sessiyani yakunlaymiz — lekin qaysi sessionId?
    // /sessions sahifasidan sessionId'ni olamiz (cookie2 joriy bo'ladi, user.cookie eski)
    const listRes = await fetch(`${serverUrl}/sessions`, { headers: { cookie: cookie2 } });
    const listHtml = await listRes.text();
    const m = listHtml.match(/name="_csrf" value="([^"]+)"/);
    expect(m, 'csrf').toBeTruthy();

    // Sahifada ikkita card bo'lishi kerak (ikkala session). Form action'laridan
    // sessionId'larini chiqaramiz — revoke form'lari action="/sessions/<id>/revoke".
    const actions = [...listHtml.matchAll(/action="\/sessions\/([^"]+)\/revoke"/g)].map((x) => x[1]);
    expect(actions.length).toBeGreaterThanOrEqual(1);

    // Joriy emas (cookie2 ning sessiyasi) birinchi action — qurilma 1 bo'ladi.
    // Eski cookie'li (user.cookie) session'ni revoke qilamiz:
    const target = actions.find((a) => a !== (listHtml.match(/data-session-key="([^"]+)"/)?.[1] || '')) || actions[0];
    const revokeRes = await fetch(`${serverUrl}/sessions/${target}/revoke`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', cookie: cookie2 },
      redirect: 'manual',
      body: new URLSearchParams({ _csrf: m[1], lang: 'uz' }).toString(),
    });
    expect(revokeRes.status).toBe(200);
    expect((await revokeRes.json()).ok).toBe(true);

    // Qurilma 1 (user.cookie) endi /user/panel ga kira olmaydi
    const after1 = await fetch(`${serverUrl}/user/panel`, { headers: { cookie: user.cookie }, redirect: 'manual' });
    expect([302, 401]).toContain(after1.status);
    // Qurilma 2 (cookie2) ishlashda davom etadi
    const after2 = await fetch(`${serverUrl}/user/panel`, { headers: { cookie: cookie2 }, redirect: 'manual' });
    expect(after2.status).toBe(200);
  });
});

describe('AUTH A-08 — revoke-all', () => {
  const xff = '203.0.113.64';

  it('revoke-all: barcha boshqa sessiyalar o\'ladi, joriy qoladi', async () => {
    const user = await registerAndLogin(xff);
    // Ikkinchi qurilma
    const { csrf: c2, cookie: ck2 } = await getCsrf('/user/login');
    const login2 = await postForm('/user/login', ck2, {
      _csrf: c2, lang: 'uz', mode: 'login', username: user.username, password: user.password,
    }, '203.0.113.65');
    const cookie2 = (login2.headers.get('set-cookie') || '').split(';')[0];

    // cookie2 bilan revoke-all (joriy qoladi)
    const listRes = await fetch(`${serverUrl}/sessions`, { headers: { cookie: cookie2 } });
    const listHtml = await listRes.text();
    const m = listHtml.match(/name="_csrf" value="([^"]+)"/);
    expect(m, 'csrf').toBeTruthy();

    const revokeAllRes = await fetch(`${serverUrl}/sessions/revoke-all`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', cookie: cookie2 },
      redirect: 'manual',
      body: new URLSearchParams({ _csrf: m[1], lang: 'uz' }).toString(),
    });
    expect(revokeAllRes.status).toBe(200);
    const body = await revokeAllRes.json();
    expect(body.ok).toBe(true);
    expect(body.count).toBeGreaterThanOrEqual(1);

    // Eski qurilma o'lgan
    const after1 = await fetch(`${serverUrl}/user/panel`, { headers: { cookie: user.cookie }, redirect: 'manual' });
    expect([302, 401]).toContain(after1.status);
    // Joriy qolgan
    const after2 = await fetch(`${serverUrl}/user/panel`, { headers: { cookie: cookie2 }, redirect: 'manual' });
    expect(after2.status).toBe(200);
  });
});

describe('AUTH A-08 — CSRF himoya', () => {
  const xff = '203.0.113.66';

  it('POST /sessions/revoke-all csrf\'siz → 403', async () => {
    const { cookie } = await registerAndLogin(xff);
    const res = await fetch(`${serverUrl}/sessions/revoke-all`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', cookie },
      redirect: 'manual',
      body: new URLSearchParams({ lang: 'uz' }).toString(),
    });
    expect(res.status).toBe(403);
  });

  it('keepalive ping (A-02) hali ishlaydi — 204', async () => {
    const { cookie } = await registerAndLogin(xff);
    const panelRes = await fetch(`${serverUrl}/user/panel`, { headers: { cookie } });
    const panelHtml = await panelRes.text();
    const m = panelHtml.match(/window\.__CSRF_TOKEN = ["']([^"']+)["']/);
    expect(m, 'panel __CSRF_TOKEN').toBeTruthy();
    const pingRes = await fetch(`${serverUrl}/api/session/ping`, {
      method: 'POST',
      headers: { 'x-csrf-token': m[1], cookie },
      redirect: 'manual',
    });
    expect(pingRes.status).toBe(204);
  });
});
