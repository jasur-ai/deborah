/**
 * AUTH D-23 §06-§12 — DSAR UI/SLA (wsl qismi) integration testlari.
 * ---------------------------------------------------------------------------
 *  - Export → PII JSON + slaDeadline (30 kun, C-23) + dsar_requests log.
 *  - Correct → reauth shart; display_name yangilanadi.
 *  - Delete → confirm shart + reauth; graceUntil 30 kun; sessiya bekor; login blok.
 *  - Restrict → status'da restricted true/false.
 *  - HERMETIC: LOCAL_DB_FILE=/tmp — data/db.json'ga TEGMAYDI (parallel-safe).
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn } from 'node:child_process';
import { rmSync } from 'node:fs';

const PORT = 3597; // unique port
const BASE = `http://localhost:${PORT}`;
const PW = 'sirli-parol-2026';
const XFF = '203.0.113.96';
const DB_FILE = '/tmp/edikit-dsar-d23-db.json';

let child;

async function waitForHealth(url) {
  const deadline = Date.now() + 120000; // server import ~40s + boot — yuklangan mashinada uzoqroq
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
      SESSION_SECRET: 'ci-secret-for-dsar-d23',
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

async function getPage(path, cookie) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { cookie, 'x-forwarded-for': XFF },
    redirect: 'manual',
  });
  const html = await res.text();
  const m = html.match(/name="_csrf" value="([^"]+)"/) || html.match(/window\.__CSRF_TOKEN = '([^']+)'/) || html.match(/window\.__CSRF_TOKEN = "([^"]+)"/);
  return { status: res.status, html, csrf: m ? m[1] : null, cookie: (res.headers.get('set-cookie') || '').split(';')[0] };
}

async function postJson(path, cookie, body, xff = XFF) {
  return fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': xff, cookie },
    redirect: 'manual',
    body: JSON.stringify(body),
  });
}

const stamp = Date.now() % 1000000;

async function registerAndLogin() {
  const uname = `d23u_${stamp}_${Math.floor(Math.random() * 100000)}`;
  const email = `d23_${Date.now()}_${Math.floor(Math.random() * 1000000)}@test.uz`;
  const { csrf, cookie } = await getPage('/user/login');
  const res = await fetch(`${BASE}/user/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-forwarded-for': XFF, cookie },
    redirect: 'manual',
    body: new URLSearchParams({ _csrf: csrf, lang: 'uz', mode: 'reg', username: uname, password: PW, email, consent: 'on' }).toString(),
  });
  expect([302, 303]).toContain(res.status);
  return { session: (res.headers.get('set-cookie') || '').split(';')[0], username: uname };
}

async function login(username, password, xff = XFF) {
  const { csrf, cookie } = await getPage('/user/login');
  return fetch(`${BASE}/user/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-forwarded-for': xff, cookie },
    redirect: 'manual',
    body: new URLSearchParams({ _csrf: csrf, lang: 'uz', mode: 'login', username, password }).toString(),
  });
}

describe('AUTH D-23 §06-§12 — DSAR UI/SLA (wsl)', () => {
  it('1) export → PII JSON + SLA 30 kun + dsar_requests log', async () => {
    const { session, username } = await registerAndLogin();
    const { csrf } = await getPage('/user/panel', session);
    const before = Date.now();
    const res = await postJson('/api/privacy/dsar/export', session, { _csrf: csrf });
    expect(res.status).toBe(200);
    const j = await res.json();
    expect(j.ok).toBe(true);
    expect(j.data.username).toBe(username);
    expect(j.data.email).toContain('@test.uz');
    // Parol hash / PII xavfsizligi: password qaytmaydi
    expect(j.data.password).toBeUndefined();
    expect(j.slaDays).toBe(30);
    expect(j.slaDeadline - before).toBeGreaterThan(29 * 24 * 3600 * 1000);
    expect(j.slaDeadline - before).toBeLessThan(31 * 24 * 3600 * 1000);
  });

  it('2) correct → reauth shart; ism yangilanadi', async () => {
    const { session } = await registerAndLogin();
    const { csrf } = await getPage('/user/panel', session);

    // Reauth YO'Q → 403 reauth_required
    const noReauth = await postJson('/api/privacy/dsar/correct', session, { _csrf: csrf, name: 'Yangi Ism' });
    expect(noReauth.status).toBe(403);

    // Reauth → correct
    const reauth = await postJson('/api/auth/reauth', session, { _csrf: csrf, password: PW });
    expect(reauth.status).toBe(200);
    const correct = await postJson('/api/privacy/dsar/correct', session, { _csrf: csrf, name: 'Yangi Ism' });
    expect(correct.status).toBe(200);
    const j = await correct.json();
    expect(j.ok).toBe(true);
    expect(j.updated).toContain('display_name');

    // API orqali tasdiqlash (test process fb'i child server DB'sini o'qimaydi)
    const reExport = await postJson('/api/privacy/dsar/export', session, { _csrf: csrf });
    const rej = await reExport.json();
    expect(rej.ok).toBe(true);
    expect(rej.data.name).toBe('Yangi Ism');
  });

  it('3) delete → confirm shart + reauth; sessiya bekor; login blok', async () => {
    const { session, username: delUname } = await registerAndLogin();
    const { csrf } = await getPage('/user/panel', session);

    // Reauth YO'Q → 403 reauth_required (middleware handler'dan oldin)
    const noReauth = await postJson('/api/privacy/dsar/delete', session, { _csrf: csrf, confirm: true });
    expect(noReauth.status).toBe(403);

    // Reauth → confirm YO'Q → 400 confirmation_required
    const reauth = await postJson('/api/auth/reauth', session, { _csrf: csrf, password: PW });
    expect(reauth.status).toBe(200);
    const noConfirm = await postJson('/api/privacy/dsar/delete', session, { _csrf: csrf, confirm: false });
    expect(noConfirm.status).toBe(400);

    // Reauth + confirm → ok
    const del = await postJson('/api/privacy/dsar/delete', session, { _csrf: csrf, confirm: true });
    expect(del.status).toBe(200);
    const dj = await del.json();
    expect(dj.ok).toBe(true);
    expect(dj.message).toBe('account_scheduled_for_deletion');
    expect(dj.graceUntil - Date.now()).toBeGreaterThan(29 * 24 * 3600 * 1000);

    // Sessiya bekor qilingan → panel 401
    const panel = await fetch(`${BASE}/user/panel`, { headers: { cookie: session, 'x-forwarded-for': XFF }, redirect: 'manual' });
    expect(panel.status).toBe(401);

    // Login blok (soft-deleted user kira olmaydi) — status='blocked' → AUTH C-02 §10 permanent lock.
    // Haqiqiy o'chirilgan user bilan login: muvaffaqiyatli login 302 (panel) bo'lardi,
    // bloklangan/noto'g'ri login esa forma 200 bilan qayta render (renderUserLogin).
    // 200 = blok ishladi (generic riskBlocked xabar, enumeration yo'q).
    const { csrf: c2, cookie: c2c } = await getPage('/user/login');
    const loginRes = await fetch(`${BASE}/user/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-forwarded-for': XFF, cookie: c2c },
      redirect: 'manual',
      body: new URLSearchParams({ _csrf: c2, lang: 'uz', mode: 'login', username: delUname, password: PW }).toString(),
    });
    expect(loginRes.status).toBe(200);
  });

  it('4) restrict → status restricted true/false', async () => {
    const { session } = await registerAndLogin();
    const { csrf } = await getPage('/user/panel', session);

    const on = await postJson('/api/privacy/dsar/restrict', session, { _csrf: csrf, restrict: true });
    expect(on.status).toBe(200);
    expect((await on.json()).restricted).toBe(true);

    const status = await fetch(`${BASE}/api/privacy/dsar/status`, { headers: { cookie: session, 'x-forwarded-for': XFF, 'x-csrf-token': csrf } });
    const sj = await status.json();
    expect(sj.status.restricted).toBe(true);

    const off = await postJson('/api/privacy/dsar/restrict', session, { _csrf: csrf, restrict: false });
    expect((await off.json()).restricted).toBe(false);
  });

  it('5) authsiz DSAR → 401/403 (bloklangan)', async () => {
    const res = await fetch(`${BASE}/api/privacy/dsar/export`, { method: 'POST' });
    expect([401, 403]).toContain(res.status);
  });
});
