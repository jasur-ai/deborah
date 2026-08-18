/**
 * Edikit — AUTH A-24: OIDC hardening integration testlari
 * ---------------------------------------------------------
 * Alohida NODE server spawn qilinadi — OIDC YOQILGAN (GOOGLE_CLIENT_ID bilan).
 * Guide A-24 §08/§15:
 *  - redirect_uri EXACT — noto'g'ri Host bilan callback → 400
 *  - callback abuse monitoring — 20/15 daqiqa → 21-chisi 429
 *  - POST /auth/google/refresh — sessiyasiz → 401
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { spawn } from 'child_process';
import http from 'http';

const PORT = 3595;
const baseUrl = `http://localhost:${PORT}`;

async function waitForHealth(url, timeoutMs = 30000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`${url}/health`);
      if (res.ok) return;
    } catch { /* retry */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('Server health check timed out');
}

/** Host header'ni override qilgan GET (redirect_uri exact tekshiruvi uchun). */
function getWithHost(path, host) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: PORT, path, headers: { host } }, (res) => {
      res.resume();
      res.on('end', () => resolve({ status: res.statusCode }));
    });
    req.on('error', reject);
    req.end();
  });
}

let child = null;
let dbSnapshot = null;

beforeAll(async () => {
  await new Promise((r) => setTimeout(r, 500));
  const { execSync } = await import('child_process');
  try { execSync(`pkill -f 'node server.js' 2>/dev/null; pkill -f 'PORT=${PORT}' 2>/dev/null`); } catch {}
  await new Promise((r) => setTimeout(r, 2500));

  dbSnapshot = existsSync('data/db.json') ? readFileSync('data/db.json', 'utf8') : null;
  child = spawn('node', ['server.js'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      NODE_ENV: 'test',
      SESSION_SECRET: 'ci-secret-for-testing',
      PORT: String(PORT),
      LOG_LEVEL: 'silent',
      LOCAL_DB_FILE: '',
      GOOGLE_CLIENT_ID: 'a24-test.apps.googleusercontent.com',
      GOOGLE_CLIENT_SECRET: 'a24-test-secret',
      GOOGLE_REDIRECT_URI: `http://localhost:${PORT}/auth/google/callback`,
    },
    stdio: 'ignore',
  });

  await waitForHealth(baseUrl);
}, 90000);

afterAll(async () => {
  child?.kill('SIGTERM');
  await new Promise((r) => setTimeout(r, 500));
  if (dbSnapshot) writeFileSync('data/db.json', dbSnapshot);
});

describe('AUTH A-24 — redirect_uri EXACT match (guide §08)', () => {
  it('noto`g`ri Host bilan callback → 400 (host-header confusion blok)', async () => {
    const res = await getWithHost('/auth/google/callback?code=abc&state=xyz', 'evil.example.com');
    expect(res.status).toBe(400);
  });

  it('to`g`ri Host bilan callback → 302 (missing code handling)', async () => {
    const res = await fetch(`${baseUrl}/auth/google/callback`, { redirect: 'manual' });
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toContain('/user/login');
  });
});

describe('AUTH A-24 — callback abuse monitoring (guide §15)', () => {
  it('20 urinish o`tadi, 21-chisi 429 (oldingi test 1 ta iste`mol qilgan)', async () => {
    // Yuqoridagi "to`g`ri Host" testi 1 ta callback iste'mol qilgan (limit 20) —
    // shuning uchun 19 ta qo'shimcha o'tadi, keyingisi 429.
    let last = null;
    for (let i = 0; i < 19; i++) {
      const res = await fetch(`${baseUrl}/auth/google/callback?code=x${i}`, { redirect: 'manual' });
      last = res.status;
    }
    expect(last).toBe(302); // 20-chisi ham o'tdi
    const blocked = await fetch(`${baseUrl}/auth/google/callback?code=x20`, { redirect: 'manual' });
    expect(blocked.status).toBe(429);
  });
});

describe('AUTH A-24 — refresh token rotatsiya route (guide §11)', () => {
  it("CSRF'siz POST → 403 (sessiya-mutatsiya CSRF bilan himoyalanadi)", async () => {
    const res = await fetch(`${baseUrl}/auth/google/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: 'tok-1' }),
    });
    expect(res.status).toBe(403); // CSRF himoyasi ishlaydi
  });

  it('sessiya bor, lekin user yo`q (CSRF o`tgan) → 401', async () => {
    // 1) Sessiya + CSRF olish
    const page = await fetch(`${baseUrl}/user/login`);
    const html = await page.text();
    const m = html.match(/name="_csrf" value="([^"]+)"/);
    const cookie = (page.headers.get('set-cookie') || '').split(';')[0];
    expect(m).not.toBeNull();
    expect(cookie).toBeTruthy();

    // 2) CSRF bilan POST — sessiya bor, lekin login qilinmagan → 401
    const res = await fetch(`${baseUrl}/auth/google/refresh`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        cookie,
        'x-csrf-token': m[1],
      },
      body: JSON.stringify({ refreshToken: 'tok-1' }),
    });
    expect(res.status).toBe(401);
  });
});
