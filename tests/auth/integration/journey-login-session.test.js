/**
 * AUTH D-17 §06/§11 — Journey: register → login → session → logout (A-04/A-05)
 * ---------------------------------------------------------------------------
 * End-to-end backend oqimi (auth-a04 pattern — child server + fetch):
 *  1. Register (mode=reg) → muvaffaqiyat (parol >= 15 NIST).
 *  2. Login to'g'ri parol → 302 redirect + session cookie.
 *  3. Session cookie bilan /user/panel → 200 (auth talab).
 *  4. Logout → session o'chadi → /user/panel 302 (authsiz).
 *  5. Xato parol → xato (enumeration emas, field=password).
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const PORT = 3591; // unique port — boshqa integration bilan to'qnashmasin
const BASE = `http://localhost:${PORT}`;
const PW = 'sirli-parol-2026';
const XFF = '203.0.113.91';

let child;
let dbSnapshot;

async function waitForHealth(url) {
  const deadline = Date.now() + 60000;
  let lastErr;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.ok || res.status < 500) return;
    } catch (e) { lastErr = e; }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`Server health check timed out: ${lastErr?.message || ''}`);
}

beforeAll(async () => {
  dbSnapshot = existsSync('data/db.json') ? readFileSync('data/db.json', 'utf8') : null;
  child = spawn('node', ['server.js'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      NODE_ENV: 'test',
      SESSION_SECRET: 'ci-secret-for-journey-d17',
      PORT: String(PORT),
      LOG_LEVEL: 'silent',
    },
    stdio: 'ignore',
  });
  await waitForHealth(BASE);
}, 90000);

afterAll(async () => {
  if (child) child.kill('SIGTERM');
  await new Promise((r) => setTimeout(r, 500));
  if (dbSnapshot !== null) writeFileSync('data/db.json', dbSnapshot, 'utf8');
});

async function getCsrf(path = '/user/login') {
  const res = await fetch(`${BASE}${path}`);
  const html = await res.text();
  const m = html.match(/name="_csrf" value="([^"]+)"/) || html.match(/window\.__CSRF_TOKEN = '([^']+)'/);
  const cookie = (res.headers.get('set-cookie') || '').split(';')[0];
  return { csrf: m ? m[1] : null, cookie, html };
}

async function postForm(path, cookie, body, xff = XFF) {
  return fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      'x-forwarded-for': xff,
      cookie,
    },
    redirect: 'manual',
    body: new URLSearchParams(body).toString(),
  });
}

const uname = `d17u_${Date.now() % 1000000}`;
const email = `d17_${Date.now()}_${Math.floor(Math.random() * 1000000)}@test.uz`;

describe('AUTH D-17 §06 — journey: register → login → session → logout', () => {
  it('1) register (mode=reg) → avtomatik login → 302 /user/panel', async () => {
    const { csrf, cookie } = await getCsrf();
    expect(csrf).toBeTruthy();
    const res = await postForm('/user/login', cookie, {
      _csrf: csrf, lang: 'uz', mode: 'reg', consent: 'on',
      username: uname, password: PW, email,
      consent: 'on', // AUTH D-24 §10: qonuniy rozilik majburiy
    });
    // Muvaffaqiyatli register → avtomatik login (302 redirect /user/panel)
    expect([302, 303]).toContain(res.status);
    const location = res.headers.get('location') || '';
    expect(location).toContain('/user/panel');
  }, 30000);

  it('2) login to\'g\'ri parol → 302 redirect + session cookie (A-04)', async () => {
    const { csrf, cookie } = await getCsrf();
    const res = await postForm('/user/login', cookie, {
      _csrf: csrf, lang: 'uz', mode: 'login',
      username: uname, password: PW,
    });
    expect([302, 303]).toContain(res.status);
    const setCookie = res.headers.get('set-cookie') || '';
    expect(setCookie).toContain('connect.sid'); // sessiya cookie
  });

  it('3) session cookie bilan /user/panel → 200 (auth talab)', async () => {
    const { csrf, cookie } = await getCsrf();
    const login = await postForm('/user/login', cookie, {
      _csrf: csrf, lang: 'uz', mode: 'login',
      username: uname, password: PW,
    });
    const sessionCookie = (login.headers.get('set-cookie') || '').split(';')[0];
    expect(sessionCookie).toContain('connect.sid');

    const panel = await fetch(`${BASE}/user/panel`, {
      headers: { cookie: sessionCookie, 'x-forwarded-for': XFF },
      redirect: 'manual',
    });
    expect(panel.status).toBe(200);
  });

  it('4) logout (GET) → sessiya o\'chadi → /user/panel 302 (authsiz)', async () => {
    const { csrf, cookie } = await getCsrf();
    const login = await postForm('/user/login', cookie, {
      _csrf: csrf, lang: 'uz', mode: 'login',
      username: uname, password: PW,
    });
    const sessionCookie = (login.headers.get('set-cookie') || '').split(';')[0];
    expect(sessionCookie).toContain('connect.sid');

    // Logout GET (auth-a09 pattern)
    const logout = await fetch(`${BASE}/user/logout`, {
      headers: { cookie: sessionCookie, 'x-forwarded-for': XFF },
      redirect: 'manual',
    });
    expect([302, 303]).toContain(logout.status);

    const panel = await fetch(`${BASE}/user/panel`, {
      headers: { cookie: sessionCookie, 'x-forwarded-for': XFF },
      redirect: 'manual',
    });
    // sessiya o'chgan — login'ga redirect (302) yoki 401
    expect([302, 401]).toContain(panel.status);
  }, 30000);

  it('5) xato parol → xato ko\'rinadi, field=password (A-05 enumeration emas)', async () => {
    const { csrf, cookie } = await getCsrf();
    const res = await postForm('/user/login', cookie, {
      _csrf: csrf, lang: 'uz', mode: 'login',
      username: uname, password: 'noto-gri-parol-12345',
    }, '203.0.113.95'); // boshqa IP — limiter buzilmasin
    const html = await res.text();
    expect(html).toContain('data-field="password"');
  });
});
