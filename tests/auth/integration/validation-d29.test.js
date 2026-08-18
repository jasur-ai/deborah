/**
 * AUTH D-29 §18/§19/§26 — validation-rules endpoint + server double-validation.
 * ---------------------------------------------------------------------------
 *  - GET /api/auth/validation-rules → contracts.js'dan (single source) — authsiz.
 *  - Login/register sahifalari auth-validation.js ni yuklaydi (client UX).
 *  - Server double validation: client o'chirilgan bo'lsa ham server rad etadi
 *    (invalid username/email → 400/redirect-error; §11/§19).
 *  - HERMETIC: LOCAL_DB_FILE=/tmp — data/db.json'ga TEGMAYDI (parallel-safe).
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn } from 'node:child_process';
import { rmSync } from 'node:fs';

const PORT = 3598; // unique port
const BASE = `http://localhost:${PORT}`;
const XFF = '203.0.113.97';
const DB_FILE = '/tmp/edikit-validation-d29-db.json';

let child;

async function waitForHealth(url) {
  const deadline = Date.now() + 120000;
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
  rmSync(DB_FILE, { force: true });
  child = spawn('node', ['server.js'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      NODE_ENV: 'test',
      SESSION_SECRET: 'ci-secret-for-validation-d29',
      PORT: String(PORT),
      LOCAL_DB_FILE: DB_FILE,
      LOG_LEVEL: 'silent',
    },
    stdio: 'ignore',
  });
  await waitForHealth(BASE);
}, 90000);

afterAll(async () => {
  if (child) child.kill('SIGTERM');
  await new Promise((r) => setTimeout(r, 500));
  rmSync(DB_FILE, { force: true });
});

async function getHtml(path, cookie) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { cookie, 'x-forwarded-for': XFF },
    redirect: 'manual',
  });
  const html = await res.text();
  const m = html.match(/name="_csrf" value="([^"]+)"/) || html.match(/window\.__CSRF_TOKEN = '([^']+)'/) || html.match(/window\.__CSRF_TOKEN = "([^"]+)"/);
  return { status: res.status, html, csrf: m ? m[1] : null, cookie: (res.headers.get('set-cookie') || '').split(';')[0] };
}

describe('AUTH D-29 §18/§19/§26 — validation rules (wsl)', () => {
  it('1) GET /api/auth/validation-rules → contracts.js qoidalari (authsiz)', async () => {
    const res = await fetch(`${BASE}/api/auth/validation-rules`, {
      headers: { 'x-forwarded-for': XFF },
    });
    expect(res.status).toBe(200);
    const j = await res.json();
    expect(j.ok).toBe(true);
    expect(j.version).toBe('1.0.0');
    // login identifier + register username/email (contracts.js'dan — app B-04 bilan izchil)
    expect(j.forms.login.identifier.minLength).toBe(1);
    expect(j.forms.login.identifier.maxLength).toBe(100);
    expect(j.forms.register.username.pattern).toBe('^[a-zA-Z0-9_.-]+$');
    expect(j.forms.register.email.format).toBe('email');
    expect(j.forms.register.password.minLength).toBe(8);
    expect(j.forms.mfa).toBeTruthy();
  });

  it('2) login/register sahifalari auth-validation.js yuklaydi (client UX)', async () => {
    const login = await getHtml('/user/login');
    expect(login.status).toBe(200);
    expect(login.html).toContain('/js/auth-validation.js');
    const register = await getHtml('/user/register');
    expect(register.status).toBe(200);
    expect(register.html).toContain('/js/auth-validation.js');
  });

  it('3) SERVER double-validation: client bypass qilinsa ham server rad etadi', async () => {
    // Bitta registr muvaffaqiyatli (valid) — server qoidalari ishlaydi
    const uname = `d29_${Date.now() % 1000000}_${Math.floor(Math.random() * 1000)}`;
    const email = `d29_${Date.now()}_${Math.floor(Math.random() * 100000)}@test.uz`;
    const pw = 'parol-uzun-2026-x';
    const { csrf, cookie } = await getHtml('/user/login');
    const okRes = await fetch(`${BASE}/user/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-forwarded-for': XFF, cookie },
      redirect: 'manual',
      body: new URLSearchParams({ _csrf: csrf, lang: 'uz', mode: 'reg', username: uname, password: pw, email, consent: 'on' }).toString(),
    });
    expect([302, 303]).toContain(okRes.status);

    // Invalid username (1 belgi — app B-04 min 2) — client bo'lmasa ham server 200 (xato bilan) qaytaradi, muvaffaqiyat EMAS
    const { csrf: c2, cookie: c2c } = await getHtml('/user/login');
    const badRes = await fetch(`${BASE}/user/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-forwarded-for': XFF, cookie: c2c },
      redirect: 'manual',
      body: new URLSearchParams({ _csrf: c2, lang: 'uz', mode: 'reg', username: 'a', password: pw, email: `bad_${Date.now()}@test.uz`, consent: 'on' }).toString(),
    });
    expect(badRes.status).toBe(200); // forma xato bilan qayta render (302 EMAS)
    const badHtml = await badRes.text();
    expect(badHtml).toContain('_csrf'); // hali login/register sahifasida

    // Invalid email (format yo'q) — server rad etadi
    const { csrf: c3, cookie: c3c } = await getHtml('/user/login');
    const badEmail = await fetch(`${BASE}/user/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-forwarded-for': XFF, cookie: c3c },
      redirect: 'manual',
      body: new URLSearchParams({ _csrf: c3, lang: 'uz', mode: 'reg', username: `d29b_${Date.now() % 1000000}`, password: pw, email: 'not-an-email', consent: 'on' }).toString(),
    });
    expect(badEmail.status).toBe(200); // xato bilan qayta render
  });
});
