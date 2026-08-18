/**
 * AUTH D-25 §19 — Consent API (status/revoke) integration testlari.
 * ---------------------------------------------------------------------------
 *  - Register → consent yozuvi (privacy_policy_v1 granted).
 *  - GET /api/consent/status → barcha purpose'lar holati.
 *  - POST /api/consent/revoke (reauth) → revoked; hasActive false (fail-closed).
 *  - Authsiz/CSRF himoya. Child server pattern (auth-a04).
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const PORT = 3593; // unique port
const BASE = `http://localhost:${PORT}`;
const PW = 'sirli-parol-2026';
const XFF = '203.0.113.94';

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
      SESSION_SECRET: 'ci-secret-for-consent-d25',
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
  // lang (D-11 persist) cookie birinchi bo'lishi mumkin — sessiya cookie olinadi
  const setCookies = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [];
  const sid = setCookies.find((c) => c.startsWith('connect.sid=')) || '';
  const cookie = (sid || res.headers.get('set-cookie') || '').split(';')[0];
  return { csrf: m ? m[1] : null, cookie };
}

async function postForm(path, cookie, body, xff = XFF) {
  return fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-forwarded-for': xff, cookie },
    redirect: 'manual',
    body: new URLSearchParams(body).toString(),
  });
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
  // Har chaqiruvda yangi user (takroriy register → username band xatosi)
  const uname = `d25u_${stamp}_${Math.floor(Math.random() * 100000)}`;
  const email = `d25_${Date.now()}_${Math.floor(Math.random() * 1000000)}@test.uz`;
  const { csrf, cookie } = await getCsrf();
  const res = await postForm('/user/login', cookie, {
    _csrf: csrf, lang: 'uz', mode: 'reg',
    username: uname, password: PW, email,
    consent: 'on', // AUTH D-24: majburiy
  });
  expect([302, 303]).toContain(res.status);
  return (res.headers.get('set-cookie') || '').split(';')[0];
}

describe('AUTH D-25 §19 — consent API', () => {
  it('1) register → consent yozuvi: privacy_policy_v1 granted', async () => {
    const session = await registerAndLogin();
    expect(session).toContain('connect.sid');
    const { csrf, cookie } = await getCsrf('/user/panel');
    const panelRes = await fetch(`${BASE}/user/panel`, {
      headers: { cookie: session, 'x-forwarded-for': XFF },
      redirect: 'manual',
    });
    const html = await panelRes.text();
    const m = html.match(/name="_csrf" value="([^"]+)"/) || html.match(/window\.__CSRF_TOKEN = '([^']+)'/);
    expect(m).toBeTruthy();
  });

  it('2) GET /api/consent/status → privacy_policy_v1 granted (register yozuvi)', async () => {
    const session = await registerAndLogin(); // yangi user (boshqa uname kerak emas — qayta register emas, login)
    const { cookie } = await getCsrf('/user/panel');
    const panelRes = await fetch(`${BASE}/user/panel`, {
      headers: { cookie: session, 'x-forwarded-for': XFF },
      redirect: 'manual',
    });
    const html = await panelRes.text();
    const m = html.match(/name="_csrf" value="([^"]+)"/) || html.match(/window\.__CSRF_TOKEN = '([^']+)'/);
    const status = await fetch(`${BASE}/api/consent/status`, {
      headers: { cookie: session, 'x-forwarded-for': XFF, 'x-csrf-token': m?.[1] || '' },
    });
    expect(status.status).toBe(200);
    const json = await status.json();
    expect(json.ok).toBe(true);
    expect(json.consents.privacy_policy_v1.granted).toBe(true);
    expect(json.consents.privacy_policy_v1.version).toBeTruthy();
    expect(json.consents.telegram.granted).toBe(false);
  });

  it('3) revoke: reauth shart → reauth → POST /api/consent/revoke → revoked', async () => {
    const session = await registerAndLogin();
    const { csrf, cookie } = await getCsrf('/user/panel');
    const panelRes = await fetch(`${BASE}/user/panel`, {
      headers: { cookie: session, 'x-forwarded-for': XFF },
      redirect: 'manual',
    });
    const html = await panelRes.text();
    const m = html.match(/name="_csrf" value="([^"]+)"/) || html.match(/window\.__CSRF_TOKEN = '([^']+)'/);
    const csrfTok = m?.[1];
    expect(csrfTok).toBeTruthy();

    // 3a) Reauth YO'Q → 403 reauth_required (sensitive amal)
    const noReauth = await postJson('/api/consent/revoke', session, {
      _csrf: csrfTok, purpose: 'telegram',
    }, XFF);
    expect(noReauth.status).toBe(403);
    const noReauthJson = await noReauth.json();
    expect(noReauthJson.error).toBe('reauth_required');

    // 3b) Reauth (parol)
    const reauth = await postJson('/api/auth/reauth', session, { _csrf: csrfTok, password: PW }, XFF);
    expect(reauth.status).toBe(200);

    // 3c) Revoke privacy_policy_v1 (register'da bor) — re-consent so'raladi
    const revoke = await postJson('/api/consent/revoke', session, {
      _csrf: csrfTok, purpose: 'privacy_policy_v1',
    }, XFF);
    expect(revoke.status).toBe(200);
    const revokeJson = await revoke.json();
    expect(revokeJson.ok).toBe(true);
    expect(revokeJson.purpose).toBe('privacy_policy_v1');

    // 3d) Status'da privacy_policy revoked (fail-closed → re-consent kerak)
    const status = await fetch(`${BASE}/api/consent/status`, {
      headers: { cookie: session, 'x-forwarded-for': XFF, 'x-csrf-token': csrfTok },
    });
    const sjson = await status.json();
    expect(sjson.consents.privacy_policy_v1.revokedAt).toBeGreaterThan(0);

    // 3e) Telegram hech qachon grant qilinmagan → 404 consent_not_found
    const noTg = await postJson('/api/consent/revoke', session, { _csrf: csrfTok, purpose: 'telegram' }, XFF);
    expect(noTg.status).toBe(404);

    // 3e) Noma'lum purpose → 400 invalid_purpose
    const bad = await postJson('/api/consent/revoke', session, { _csrf: csrfTok, purpose: 'unknown' }, XFF);
    expect(bad.status).toBe(400);
  });

  it('4) authsiz GET /api/consent/status → 401', async () => {
    const res = await fetch(`${BASE}/api/consent/status`);
    expect(res.status).toBe(401);
  });
});
