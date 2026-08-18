/**
 * AUTH A-03 — Rate limit + lockout + auth audit
 * -------------------------------------------------------------------
 * Alohida fayl — o'z server jarayoni. Har test o'z X-Forwarded-For IP'sini
 * ishlatadi (trust proxy 1) — loginLimiter (20 POST/15min) bucket'lari ham,
 * lockout per-IP hisoblagichlari ham bir-biriga aralashmaydi.
 *
 *  1. Xato parol → failed_attempts oshadi + auth_audit yozuvi (PII minimal)
 *  2. 5 xato → login sahifasida lockout UI (IP yumshoq lock, Retry-After)
 *  3. 10 xato → per-user hard lock → 11-si 429 + Retry-After + RATE_LIMITED
 *  4. Muvaffaqiyatli login → hisoblagichlar tozalanadi
 *  5. Forgot reset limit: 3/soat per account → 4-si 429
 *  6. Register limit: 5/15 daqiqa per IP → 6-chi 429
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { snapshotDb, restoreDb, startServer, stopServer } from '../helpers/setup.js';
import { fb } from '../../firebase/admin.js';

let serverUrl;

beforeAll(async () => {
  snapshotDb();
  serverUrl = await startServer();
});

afterAll(async () => {
  await stopServer();
  restoreDb();
});

const PW = 'sirli-parol-2026';

async function getCsrf(path = '/user/login') {
  const res = await fetch(`${serverUrl}${path}`);
  const html = await res.text();
  const m = html.match(/name="_csrf" value="([^"]+)"/) || html.match(/window\.__CSRF_TOKEN = '([^']+)'/);
  const cookie = (res.headers.get('set-cookie') || '').split(';')[0];
  return { csrf: m ? m[1] : null, cookie, res, html };
}

async function postForm(path, cookie, body, xff = '127.0.0.1', headers = {}) {
  return fetch(`${serverUrl}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      'x-forwarded-for': xff,
      cookie,
      ...headers,
    },
    redirect: 'manual',
    body: new URLSearchParams(body).toString(),
  });
}

async function registerUser(username, xff) {
  const { csrf, cookie } = await getCsrf();
  const res = await postForm('/user/login', cookie, {
    _csrf: csrf, lang: 'uz', mode: 'reg', consent: 'on', username, password: PW,
      email: `r3_${Date.now()}_${Math.floor(Math.random() * 1000000)}_a18@test.uz`,
  }, xff);
  expect(res.status).toBe(302);
  return res;
}

/** Mavjud user bilan xato login urinishi (parol noto'g'ri). */
async function wrongLogin(username, xff, acceptJson = false) {
  const { csrf, cookie } = await getCsrf();
  const headers = acceptJson ? { accept: 'application/json' } : {};
  return postForm('/user/login', cookie, {
    _csrf: csrf, lang: 'uz', mode: 'login', username, password: 'noto-gri-parol',
  }, xff, headers);
}

async function authAuditEntries() {
  const snap = await fb.get('auth_audit');
  if (!snap.exists()) return [];
  const days = snap.val();
  return Object.values(days).flatMap((d) => Object.values(d));
}

describe('Auth — AUTH A-03 (lockout + rate limit + audit)', () => {
  it('xato parol → failed_attempts oshadi + auth_audit yozuvi (PII minimal, ip_hash)', async () => {
    const uname = `a03f_${Date.now() % 1000000}`;
    const xff = '203.0.113.5';
    await registerUser(uname, xff);

    await wrongLogin(uname, xff);
    await wrongLogin(uname, xff);

    const snap = await fb.get(`users/${uname}/failed_attempts`);
    expect(snap.val()).toBe(2);

    const entries = await authAuditEntries();
    const fails = entries.filter((e) => e.action === 'auth.login.failed');
    expect(fails.length).toBeGreaterThanOrEqual(2);
    const last = fails[fails.length - 1];
    expect(last.outcome).toBe('failed');
    expect(last.method).toBe('password');
    expect(last.actor_id).toBe(uname);
    expect(last.ip_hash).toMatch(/^[0-9a-f]{64}$/); // to'liq IP emas
    expect(last.ua).toBeTruthy();
    expect(last.detail).not.toHaveProperty('password'); // redaction
    expect(JSON.stringify(last)).not.toContain('noto-gri-parol');
  });

  it('5 xato → login sahifasida lockout UI (IP yumshoq lock, data-seconds=300)', async () => {
    const uname = `a03f_${Date.now() % 1000000}`;
    const xff = '203.0.113.51';
    await registerUser(uname, xff);

    for (let i = 0; i < 4; i++) await wrongLogin(uname, xff); // jami 5 xato
    const last = await wrongLogin(uname, xff);
    const html = await last.text();
    expect(html).toContain('data-lockout="1"');
    expect(html).toContain('data-seconds="300"');
    expect(html).toContain('data-copy=');
    expect(html).toContain('support@edikit.uz'); // 4-til copy
  });

  it('brauzer Accept header bilan ham HTML lockout UI render bo\'ladi (JSON emas)', async () => {
    // Brauzer form-navigatsiyasi kabi Accept header (text/html birinchi o'rinda)
    const browserAccept =
      'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8';
    const uname = `a03f_${Date.now() % 1000000}`;
    const xff = '203.0.113.53';
    await registerUser(uname, xff);

    for (let i = 0; i < 4; i++) await wrongLogin(uname, xff); // 4 xato
    // 5-xato browser Accept bilan — countdown UI, JSON emas
    const { csrf, cookie } = await getCsrf();
    const fifth = await postForm('/user/login', cookie, {
      _csrf: csrf, lang: 'uz', mode: 'login', username: uname, password: 'noto-gri-parol',
    }, xff, { accept: browserAccept });
    const html = await fifth.text();
    expect(fifth.headers.get('content-type') || '').toContain('text/html');
    expect(html).toContain('data-lockout="1"');
    expect(html).toContain('data-seconds="300"');
  });

  it('10 xato → per-user hard lock → 11-urinish 429 + Retry-After + RATE_LIMITED', async () => {
    const uname = `a03f_${Date.now() % 1000000}`;
    const xff = '203.0.113.52';
    await registerUser(uname, xff);

    for (let i = 0; i < 10; i++) await wrongLogin(uname, xff); // jami 10 xato

    // 10-xato: user hard lock'ka tushdi (locked_until DB'da)
    const snap = await fb.get(`users/${uname}/locked_until`);
    expect(snap.exists()).toBe(true);

    // 11-urinish: pre-check user lock → 429
    const blocked = await wrongLogin(uname, xff, true);
    expect(blocked.status).toBe(429);
    const retryAfter = parseInt(blocked.headers.get('retry-after') || '0', 10);
    expect(retryAfter).toBeGreaterThan(0);
    expect(retryAfter).toBeLessThanOrEqual(900);
    const body = await blocked.json();
    expect(body.code).toBe('RATE_LIMITED');
    expect(body.retryAfter).toBe(retryAfter);

    // audit: blocked outcome yozildi
    const entries = await authAuditEntries();
    const blockedEntries = entries.filter((e) => e.action === 'auth.login' && e.outcome === 'blocked');
    expect(blockedEntries.length).toBeGreaterThanOrEqual(1);
  });

  it('muvaffaqiyatli login → hisoblagichlar tozalanadi (failed_attempts=0, locked_until yo\'q)', async () => {
    const uname = `a03f_${Date.now() % 1000000}`;
    const xff = '203.0.113.6';
    await registerUser(uname, xff);

    for (let i = 0; i < 3; i++) await wrongLogin(uname, xff);
    const snap = await fb.get(`users/${uname}/failed_attempts`);
    expect(snap.val()).toBe(3);

    // To'g'ri parol bilan login
    const { csrf, cookie } = await getCsrf();
    const res = await postForm('/user/login', cookie, {
      _csrf: csrf, lang: 'uz', mode: 'login', username: uname, password: PW,
    }, xff);
    expect(res.status).toBe(302);

    const after = await fb.get(`users/${uname}/failed_attempts`);
    expect(after.val()).toBe(0);
    const lu = await fb.get(`users/${uname}/locked_until`);
    expect(lu.exists()).toBe(false);

    // audit: success yozildi
    const entries = await authAuditEntries();
    const ok = entries.filter((e) => e.action === 'auth.login' && e.outcome === 'success' && e.actor_id === uname);
    expect(ok.length).toBeGreaterThanOrEqual(1);
  });

  it('forgot reset limit: 3/soat per account → 4-so\'rov 429', async () => {
    const username = `a03r_${Date.now() % 1000000}`;
    for (let i = 0; i < 3; i++) {
      const { csrf, cookie } = await getCsrf('/user/forgot');
      const res = await postForm('/user/forgot', cookie, {
        _csrf: csrf, lang: 'uz', username,
      });
      expect(res.status).toBe(200);
    }
    const { csrf, cookie } = await getCsrf('/user/forgot');
    const blocked = await postForm('/user/forgot', cookie, {
      _csrf: csrf, lang: 'uz', username,
    }, '127.0.0.1', { accept: 'application/json' });
    expect(blocked.status).toBe(429);
    const retryAfter = parseInt(blocked.headers.get('retry-after') || '0', 10);
    expect(retryAfter).toBeGreaterThan(0);
    const body = await blocked.json();
    expect(body.code).toBe('RATE_LIMITED');
  });

  it('register limit: 5/15 daqiqa per IP → 6-registratsiya 429', async () => {
    const xff = '203.0.113.7'; // alohida IP — boshqa testlarga ta'sir qilmaydi
    for (let i = 0; i < 5; i++) {
      await registerUser(`a03g_${Date.now() % 1000000}_${i}`, xff);
    }
    const { csrf, cookie } = await getCsrf();
    const blocked = await postForm('/user/login', cookie, {
      _csrf: csrf, lang: 'uz', mode: 'reg', consent: 'on', username: `a03g_${Date.now() % 1000000}_x`, password: PW,
      email: `r4_${Date.now()}_${Math.floor(Math.random() * 1000000)}_a18@test.uz`,
    }, xff, { accept: 'application/json' });
    expect(blocked.status).toBe(429);
    const body = await blocked.json();
    expect(body.code).toBe('RATE_LIMITED');
  });
});
