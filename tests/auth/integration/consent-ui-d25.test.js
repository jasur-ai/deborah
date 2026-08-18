/**
 * AUTH D-25 §10/§11/§12 — Consent UI (wsl qismi): grant/re-consent + settings + banner
 * ---------------------------------------------------------------------------
 *  - POST /api/consent/grant (re-consent, D-25 §12) — yangi endpoint.
 *  - /user/settings → consent accordion (5 purpose, status + revoke/grant).
 *  - /user/panel → re-consent banner (privacy revoke/eskirgan bo'lsa) → grant → yo'qoladi.
 *  - HERMETIC: LOCAL_DB_FILE=/tmp — data/db.json'ga TEGMAYDI (parallel-safe).
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn } from 'node:child_process';
import { rmSync } from 'node:fs';

const PORT = 3594; // unique port
const BASE = `http://localhost:${PORT}`;
const PW = 'sirli-parol-2026';
const XFF = '203.0.113.95';
const DB_FILE = '/tmp/edikit-consent-d25-db.json';

let child;

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
  rmSync(DB_FILE, { force: true });
  child = spawn('node', ['server.js'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      NODE_ENV: 'test',
      SESSION_SECRET: 'ci-secret-for-consent-d25-ui',
      PORT: String(PORT),
      LOCAL_DB_FILE: DB_FILE,
      LOG_LEVEL: 'silent',
      CONSENT_DBG: process.env.CONSENT_DBG || '',
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
  const setCookies = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [];
  const sid = setCookies.find((c) => c.startsWith('connect.sid=')) || '';
  const cookieOut = (sid || res.headers.get('set-cookie') || '').split(';')[0];
  return { status: res.status, html, csrf: m ? m[1] : null, cookie: cookieOut };
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

// Banner ELEMENTI `id="btn-consent-grant"` tugmasi bilan aniqlandi
// (data-testid string'i JS selector'da ham bor — noto'g'ri musbat bermasin).
// Local JSON DB yozuvi async file write — poll bilan yozuv race'sidan o'tamiz.
async function waitForBanner(session, shouldShow, timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const { html } = await getPage('/user/panel', session);
    const has = html.includes('id="btn-consent-grant"');
    if (has === shouldShow) return;
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`banner ${shouldShow ? 'ko\u2018rinmadi' : 'yo\u2018qolmadi'} (${timeoutMs}ms ichida)`);
}

async function registerAndLogin() {
  const uname = `d25u_${stamp}_${Math.floor(Math.random() * 100000)}`;
  const email = `d25_${Date.now()}_${Math.floor(Math.random() * 1000000)}@test.uz`;
  const { csrf, cookie } = await getPage('/user/login');
  const res = await fetch(`${BASE}/user/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-forwarded-for': XFF, cookie },
    redirect: 'manual',
    body: new URLSearchParams({ _csrf: csrf, lang: 'uz', mode: 'reg', username: uname, password: PW, email, consent: 'on' }).toString(),
  });
  expect([302, 303]).toContain(res.status);
  return (res.headers.get('set-cookie') || '').split(';')[0];
}

describe('AUTH D-25 §10/§12 — consent UI (wsl)', () => {
  it('1) /user/settings → consent accordion: privacy granted + revoke tugma', async () => {
    const session = await registerAndLogin();
    const { status, html } = await getPage('/user/settings', session);
    expect(status).toBe(200);
    // Accordion bor
    expect(html).toContain('data-acc="consent"');
    expect(html).toContain('id="acc-consent"');
    // privacy_policy_v1 granted → revoke tugma; boshqalar grant tugma
    expect(html).toContain('data-consent-revoke="privacy_policy_v1"');
    expect(html).toContain('data-consent-grant="telegram"');
    expect(html).toContain('data-consent-grant="camera"');
    // Status badge
    expect(html).toContain('consent-status');
    expect(html).toContain('v1.0.0');
  });

  it('2) POST /api/consent/grant — invalid purpose 400, authsiz 401', async () => {
    const session = await registerAndLogin();
    const { csrf } = await getPage('/user/panel', session);
    const bad = await postJson('/api/consent/grant', session, { _csrf: csrf, purpose: 'unknown' });
    expect(bad.status).toBe(400);
    // Authsiz POST — global CSRF (x-csrf-token yo'q) yoki 401 bloklaydi
    const anon = await postJson('/api/consent/grant', undefined, { _csrf: 'x', purpose: 'privacy_policy_v1' });
    expect([401, 403]).toContain(anon.status);
  });

  it('3) re-consent journey: revoke → panel banner → grant → banner yo\'qoladi', async () => {
    const session = await registerAndLogin();
    const { csrf } = await getPage('/user/panel', session);

    // Reauth (revoke sensitive amal)
    const reauth = await postJson('/api/auth/reauth', session, { _csrf: csrf, password: PW });
    expect(reauth.status).toBe(200);

    // Revoke privacy → re-consent kerak
    const revoke = await postJson('/api/consent/revoke', session, { _csrf: csrf, purpose: 'privacy_policy_v1' });
    expect(revoke.status).toBe(200);
    expect((await revoke.json()).ok).toBe(true);

    // Panel → consent-banner ko'rinadi (write race — poll)
    await waitForBanner(session, true);

    // Grant (re-consent) — reauth talab qilinmaydi (oddiy rozilik)
    const grant = await postJson('/api/consent/grant', session, { _csrf: csrf, purpose: 'privacy_policy_v1' });
    expect(grant.status).toBe(200);
    expect((await grant.json()).ok).toBe(true);
    const stRes = await fetch(`${BASE}/api/consent/status`, {
      headers: { cookie: session, 'x-forwarded-for': XFF, 'x-csrf-token': csrf },
    });
    const stJson = await stRes.json();
    expect(stJson.consents.privacy_policy_v1.revokedAt).toBeNull();

    // Panel → banner yo'qoladi (poll); settings → granted qaytdi
    await waitForBanner(session, false);
    const settings = await getPage('/user/settings', session);
    expect(settings.html).toContain('data-consent-revoke="privacy_policy_v1"');
  });

  it('4) telegram grant → status granted + settings da grant tugma emas, revoke tugma', async () => {
    const session = await registerAndLogin();
    const { csrf } = await getPage('/user/panel', session);
    const grant = await postJson('/api/consent/grant', session, { _csrf: csrf, purpose: 'telegram' });
    expect(grant.status).toBe(200);

    const statusRes = await fetch(`${BASE}/api/consent/status`, {
      headers: { cookie: session, 'x-forwarded-for': XFF, 'x-csrf-token': csrf },
    });
    const sjson = await statusRes.json();
    expect(sjson.consents.telegram.granted).toBe(true);
    expect(sjson.consents.telegram.revokedAt).toBeNull();

    const settings = await getPage('/user/settings', session);
    expect(settings.html).toContain('data-consent-revoke="telegram"');
    expect(settings.html).not.toContain('data-consent-grant="telegram"');
  });
});
