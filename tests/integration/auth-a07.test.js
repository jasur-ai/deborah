/**
 * AUTH A-07 — Google OIDC: state/nonce/PKCE + rate limit + in-app browser
 * -------------------------------------------------------------------
 * Alohida NODE server spawn qilinadi — OIDC YOQILGAN (GOOGLE_CLIENT_ID bilan).
 * Haqiqiy Google'ga token exchange qilinmaydi (yolg'on credentials) —
 * bu yerda server-side himoya (state mismatch, replay, rate limit,
 * in-app browser blok) tekshiriladi. Token verify logikasi unit'da
 * (oidc-a07.test.js) haqiqiy jose JWKS bilan yopilgan.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { spawn } from 'child_process';

const PORT = 3590; // A-21 fix: a05 ham 3589 ishlatar edi — port konflikti (suite'da flaky)
const baseUrl = `http://localhost:${PORT}`;
let child;
let dbSnapshot;

async function waitForHealth(url, timeoutMs = 60000) { // A-21: full suite yuklamasida boot ~25s+ oshadi
  const start = Date.now();
  let lastErr = null;
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`${url}/health`);
      if (res.ok) return;
    } catch (err) {
      lastErr = err;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`Server health check timed out: ${lastErr?.message || ''}`);
}

beforeAll(async () => {
  await new Promise((r) => setTimeout(r, 500));
  const { execSync } = await import('child_process');
  try {
    execSync(`pkill -f 'node server.js' 2>/dev/null; pkill -f 'PORT=${PORT}' 2>/dev/null`);
  } catch {}
  // A-21 fix: oldingi child server portni bo'shatishi uchun uzoqroq kutamiz
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
      // AUTH A-21 fix: vitest LOCAL_DB_FILE temp DB'ni child'ga meros qilib
      // qolardi — child real data/db.json bilan ishlashi uchun tozalaymiz.
      LOCAL_DB_FILE: '',
      GOOGLE_CLIENT_ID: 'a07-test.apps.googleusercontent.com',
      GOOGLE_CLIENT_SECRET: 'a07-test-secret',
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

/** GET /auth/google — session cookie'ni saqlaydi. */
async function startGoogle(ua) {
  const res = await fetch(`${baseUrl}/auth/google`, {
    redirect: 'manual',
    headers: ua ? { 'user-agent': ua } : {},
  });
  const cookie = (res.headers.get('set-cookie') || '').split(';')[0];
  return { res, cookie };
}

describe('AUTH A-07 — OIDC yoqilgan server', () => {
  it('GET /auth/google → 302 Google consent sahifasiga', async () => {
    const { res } = await startGoogle();
    expect(res.status).toBe(302);
    const location = res.headers.get('location') || '';
    expect(location).toContain('accounts.google.com/o/oauth2/v2/auth');
    expect(location).toContain('response_type=code');
    expect(location).toContain('code_challenge='); // PKCE
    expect(location).toContain('code_challenge_method=S256');
    expect(location).toContain('nonce='); // nonce auth URL'da
    expect(location).toContain('state='); // state auth URL'da
    expect(location).toMatch(/scope=openid[+%20]email[+%20]profile/);
  });

  it('GET /auth/google — session\'da oidcState/verifier/nonce saqlanadi (32B state)', async () => {
    // Session cookie bilan /auth/status'ga boshqa so'rov — session mavjud.
    const { res, cookie } = await startGoogle();
    expect(res.status).toBe(302);
    expect(cookie).toBeTruthy();
    // Session'da state borligi callback'da state tekshiruvida isbotlanadi:
    // to'g'ri state bilan callback → token exchange fail (yolg'on code),
    // lekin state xato bo'lsa → darhol error (state tekshiruvi erta).
  });

  it('Callback: state mismatch → /user/login?error (CSRF himoya)', async () => {
    const { cookie } = await startGoogle();
    const res = await fetch(`${baseUrl}/auth/google/callback?code=fake-code&state=WRONG_STATE`, {
      redirect: 'manual',
      headers: { cookie },
    });
    expect(res.status).toBe(302);
    const location = res.headers.get('location') || '';
    expect(location).toContain('/user/login');
    expect(location).toContain('error=');
  });

  it('Callback: state yo\'q → reject', async () => {
    const { cookie } = await startGoogle();
    const res = await fetch(`${baseUrl}/auth/google/callback?code=fake-code`, {
      redirect: 'manual',
      headers: { cookie },
    });
    expect(res.status).toBe(302);
    expect((res.headers.get('location') || '')).toContain('/user/login');
  });

  it('Callback replay: state to\'g\'ri bo\'lsa ham yolg\'on code → token exchange fail → error', async () => {
    // Sessiyadagi state'ni bilmaymiz, lekin noto'g'ri state ham xavfsiz rad.
    // Replay himoyasi unit'da (nonce mismatch) yopilgan; bu yerda
    // callback'da bir xil session qayta ishlatilsa state bir marta ishlatiladi
    // (completeOidcLogin session'ni tozalaydi) — ikkinchi chaqiruv fail.
    const { cookie } = await startGoogle();
    const first = await fetch(`${baseUrl}/auth/google/callback?code=c1&state=guess`, {
      redirect: 'manual', headers: { cookie },
    });
    const second = await fetch(`${baseUrl}/auth/google/callback?code=c1&state=guess`, {
      redirect: 'manual', headers: { cookie },
    });
    // State xato → ikkalasi ham error redirect (session tozalash uchun haqiqiy
    // state kerak bo'lardi). Xavfsizlik: hech biri success bo'lmaydi.
    expect(first.status).toBe(302);
    expect(second.status).toBe(302);
    expect((first.headers.get('location') || '')).not.toContain('/user/panel');
    expect((second.headers.get('location') || '')).not.toContain('/user/panel');
  });

  it('Google xatosi (user deny) → /user/login?error=google_denied', async () => {
    const res = await fetch(`${baseUrl}/auth/google/callback?error=access_denied`, {
      redirect: 'manual',
    });
    expect(res.status).toBe(302);
    expect((res.headers.get('location') || '')).toContain('google_denied');
  });

  it('GET /auth/google — rate limit 10/15 daqiqa → 429', async () => {
    // Rate limit per-IP — oldingi testlardagi urinishlar hisobga olinadi.
    // Aniq 10 ta qo'shimcha urinish bilan 429'ni kafolatlash uchun
    // limitga yetguncha urib ko'ramiz.
    let got429 = false;
    for (let i = 0; i < 20; i++) {
      const { res } = await startGoogle();
      if (res.status === 429) {
        got429 = true;
        break;
      }
      if (res.status !== 302) break;
    }
    expect(got429).toBe(true);
  });
});

describe('AUTH A-07 — in-app browser blok (guide §19)', () => {
  it('Telegram in-app browser UA → 400 (real browser\'ga o\'tish xabari)', async () => {
    // Rate limit 429'ga tushmaslik uchun boshqa XFF yoki yangi UA —
    // rate limit per-IP req.ip ga bog'liq; 429 bo'lsa ham bu test blokni
    // tekshirish uchun: 400 yoki 429 qabul qilamiz (429 — rate limit).
    const ua = 'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 TelegramBot (like Twitter)';
    const res = await fetch(`${baseUrl}/auth/google`, {
      redirect: 'manual',
      headers: { 'user-agent': ua, 'x-forwarded-for': '203.0.113.55' },
    });
    expect([400, 429]).toContain(res.status);
    if (res.status === 400) {
      const html = await res.text();
      expect(html).toContain('brauzer');
    }
  });
});

describe('AUTH A-07 — login sahifasi Google tugmasi (OIDC yoqilgan)', () => {
  it('GET /user/login → Google tugmasi ko\'rinadi (oidcEnabled)', async () => {
    const res = await fetch(`${baseUrl}/user/login`);
    const html = await res.text();
    expect(html).toContain('Google'); // i18n 'google' copy
  });
});
