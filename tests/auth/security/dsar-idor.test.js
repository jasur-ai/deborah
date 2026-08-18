/**
 * AUTH D-23 §21 — DSAR IDOR / reauth / delete-login-blok security testlari.
 * ---------------------------------------------------------------------------
 * User DSAR endpointlarida IDOR yo'qligi (userKey session'dan olinadi —
 * body/path ishonilmaydi), reauth shart (delete/correct), confirm shart,
 * delete'dan keyin login blok. Child server pattern (auth-a04).
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const PORT = 3592; // unique port
const BASE = `http://localhost:${PORT}`;
const PW = 'sirli-parol-2026';
const XFF = '203.0.113.92';

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
      SESSION_SECRET: 'ci-secret-for-dsar-d23',
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

async function postJson(path, cookie, body, xff = XFF) {
  return fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-forwarded-for': xff,
      cookie,
    },
    redirect: 'manual',
    body: JSON.stringify(body),
  });
}

const stamp = Date.now() % 1000000;
const unameA = `d23a_${stamp}`;
const unameB = `d23b_${stamp}`;
const emailA = `d23a_${stamp}_${Math.floor(Math.random() * 100000)}@test.uz`;
const emailB = `d23b_${stamp}_${Math.floor(Math.random() * 100000)}@test.uz`;

async function registerUser(uname, email, xff) {
  const { csrf, cookie } = await getCsrf();
  expect(csrf).toBeTruthy();
  const res = await postForm('/user/login', cookie, {
    _csrf: csrf, lang: 'uz', mode: 'reg', consent: 'on',
    username: uname, password: PW, email,
    consent: 'on', // AUTH D-24 §10: qonuniy rozilik majburiy
  }, xff);
  expect([302, 303]).toContain(res.status);
  // Register → avtomatik login → session cookie
  return (res.headers.get('set-cookie') || '').split(';')[0];
}

async function loginUser(uname, xff) {
  const { csrf, cookie } = await getCsrf();
  const res = await postForm('/user/login', cookie, {
    _csrf: csrf, lang: 'uz', mode: 'login',
    username: uname, password: PW,
  }, xff);
  expect([302, 303]).toContain(res.status);
  return (res.headers.get('set-cookie') || '').split(';')[0];
}

describe('AUTH D-23 §21 — DSAR IDOR va himoya', () => {
  it('1) authsiz POST /api/privacy/dsar/export → 401 (requireAuth)', async () => {
    // CSRF token sessiya bilan birga keladi (global middleware avval ishlaydi)
    const { csrf, cookie } = await getCsrf();
    expect(csrf).toBeTruthy();
    const res = await postJson('/api/privacy/dsar/export', cookie, { _csrf: csrf }, XFF);
    // Authsiz API → 401 (requireAuth — JSON, API route)
    expect(res.status).toBe(401);
  });

  it('2) CSRF tokensiz POST export → 403 (global validateCsrf)', async () => {
    // A user session (register orqali)
    const sessionA = await registerUser(unameA, emailA, XFF);
    const res = await postJson('/api/privacy/dsar/export', sessionA, {}, XFF);
    expect(res.status).toBe(403);
  });

  it('3) export o\'z ma\'lumotlarini qaytaradi (email + username)', async () => {
    const sessionA = await loginUser(unameA, XFF);
    // CSRF token — shu session bilan GET /user/panel (token session'ga bog'liq)
    const panelRes = await fetch(`${BASE}/user/panel`, {
      headers: { cookie: sessionA, 'x-forwarded-for': XFF },
      redirect: 'manual',
    });
    const html = await panelRes.text();
    const m = html.match(/name="_csrf" value="([^"]+)"/) || html.match(/window\.__CSRF_TOKEN = '([^']+)'/);
    const csrf = m ? m[1] : null;
    expect(csrf).toBeTruthy();
    const res = await postJson('/api/privacy/dsar/export', sessionA, {
      _csrf: csrf,
    }, XFF);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.data.username).toBe(unameA);
    expect(json.data.email).toBe(emailA);
  });

  it('4) IDOR: body\'dagi boshqa user key ishonilmaydi — o\'z ma\'lumotlari qaytadi', async () => {
    // B user mavjud bo'lsin (A ning eksportida B ma'lumotlari chiqmasligi kerak)
    await registerUser(unameB, emailB, '203.0.113.93');

    const sessionA = await loginUser(unameA, XFF);
    // CSRF token — session bilan GET /user/panel
    const panelRes = await fetch(`${BASE}/user/panel`, {
      headers: { cookie: sessionA, 'x-forwarded-for': XFF },
      redirect: 'manual',
    });
    const html = await panelRes.text();
    const m = html.match(/name="_csrf" value="([^"]+)"/) || html.match(/window\.__CSRF_TOKEN = '([^']+)'/);
    const csrf = m ? m[1] : null;
    expect(csrf).toBeTruthy();

    // IDOR urinish: boshqa user key body'da
    const res = await postJson('/api/privacy/dsar/export', sessionA, {
      _csrf: csrf,
      userKey: `d23b_${stamp}`,
    }, XFF);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    // Faqat o'z (A) ma'lumotlari — B email/user YO'Q (userKey body'dan olinmaydi)
    expect(json.data.username).toBe(unameA);
    expect(JSON.stringify(json.data)).not.toContain(emailB);
    expect(JSON.stringify(json.data)).not.toContain(unameB);
  });

  it('5) delete: reauth shart (403 reauth_required) → reauth → confirm=true → 200 + grace', async () => {
    const sessionA = await loginUser(unameA, XFF);
    // CSRF token session bilan
    const panelRes = await fetch(`${BASE}/user/panel`, {
      headers: { cookie: sessionA, 'x-forwarded-for': XFF },
      redirect: 'manual',
    });
    const html = await panelRes.text();
    const m = html.match(/name="_csrf" value="([^"]+)"/) || html.match(/window\.__CSRF_TOKEN = '([^']+)'/);
    const csrf = m ? m[1] : null;
    expect(csrf).toBeTruthy();

    // 5a) Reauth YO'Q — delete rad (login session'ida reauthedAt yo'q)
    const noReauth = await postJson('/api/privacy/dsar/delete', sessionA, {
      _csrf: csrf, confirm: true, reason: 'test',
    }, XFF);
    expect(noReauth.status).toBe(403);
    const noReauthJson = await noReauth.json();
    expect(noReauthJson.error).toBe('reauth_required');

    // 5b) Reauth (to'g'ri parol)
    const reauth = await postJson('/api/auth/reauth', sessionA, {
      _csrf: csrf, password: PW,
    }, XFF);
    expect(reauth.status).toBe(200);
    const reauthJson = await reauth.json();
    expect(reauthJson.ok).toBe(true);

    // 5c) confirm=true → delete 200 + graceUntil (30 kun)
    const del = await postJson('/api/privacy/dsar/delete', sessionA, {
      _csrf: csrf, confirm: true, reason: 'test',
    }, XFF);
    expect(del.status).toBe(200);
    const delJson = await del.json();
    expect(delJson.ok).toBe(true);
    expect(delJson.graceUntil).toBeGreaterThan(Date.now());

    // 5d) confirm=false → 400 confirmation_required (ikkilamchi tasdiq shart)
    const sessionB = await loginUser(unameB, '203.0.113.93');
    const panelB = await fetch(`${BASE}/user/panel`, {
      headers: { cookie: sessionB, 'x-forwarded-for': '203.0.113.93' },
      redirect: 'manual',
    });
    const htmlB = await panelB.text();
    const mB = htmlB.match(/name="_csrf" value="([^"]+)"/) || htmlB.match(/window\.__CSRF_TOKEN = '([^']+)'/);
    const csrfB = mB ? mB[1] : null;
    const reauthB = await postJson('/api/auth/reauth', sessionB, {
      _csrf: csrfB, password: PW,
    }, '203.0.113.93');
    expect(reauthB.status).toBe(200);
    const noConfirm = await postJson('/api/privacy/dsar/delete', sessionB, {
      _csrf: csrfB, confirm: false, reason: 'test',
    }, '203.0.113.93');
    expect(noConfirm.status).toBe(400);
    const noConfirmJson = await noConfirm.json();
    expect(noConfirmJson.error).toBe('confirmation_required');
  });

  it('6) delete\'dan keyin login blok (soft-deleted user kirish olmaydi)', async () => {
    // A user delete qilingan — qayta login blok (D-23 §09)
    const { csrf, cookie } = await getCsrf();
    const res = await postForm('/user/login', cookie, {
      _csrf: csrf, lang: 'uz', mode: 'login',
      username: unameA, password: PW,
    }, XFF);
    // Generic blok xabari (enumeration yo'q) — login muvaffaqiyatsiz,
    // login sahifasi qaytadi (302 redirect EMAS)
    expect(res.status).toBe(200);
    const html = await res.text();
    // deleted user: status='blocked' → checkUserLockout permanent blok →
    // login sahifasi xato bilan qaytadi (riskBlocked/locked — generic)
    expect(html).toContain('_csrf');
  });
});
