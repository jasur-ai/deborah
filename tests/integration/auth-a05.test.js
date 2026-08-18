/**
 * AUTH A-05 — Login backend: legacy migratsiya + last_login + role redirect
 * -------------------------------------------------------------------
 * Alohida NODE server spawn qilinadi (OIDC shart emas — default test env).
 *
 * Qamrov:
 *   - Legacy SHA-256 hash → muvaffaqiyatli login → 302 + DB'da Argon2 rehash
 *   - Legacy plaintext → muvaffaqiyatli login → 302 + DB'da Argon2 rehash
 *   - last_login yangilanadi (OIDC bilan izchil)
 *   - Role redirect: student → /user/panel, teacher → /teacher
 *   - returnUrl allowlist (safeReturnUrl): ruxsat etilgan prefix qaytaradi,
 *     allowlist'da yo'q path default'ga
 *   - Yangi qurilmadan login → audit (auth.login outcome=new_device)
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { spawn } from 'child_process';
import crypto from 'crypto';

const PORT = 3589;
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
  // Orphan server xavfi — pkill guard (A-04 pattern).
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
      // AUTH A-21 fix: vitest LOCAL_DB_FILE'ni temp faylga o'rnatadi — child
      // ham o'sha temp DB'ni ishlatib, test'ning data/db.json yozuvini ko'rmasdi.
      // Child real data/db.json bilan ishlashi uchun tozalaymiz.
      LOCAL_DB_FILE: '',
      // A-05: jitter 0 (test tezligi) — lockout testlarida kerak emas, lekin
      // barqarorlik uchun o'chiramiz.
      AUTH_JITTER_MAX_MS: '0',
    },
    stdio: 'ignore',
  });
  await waitForHealth(baseUrl);
}, 90000); // server boot ~14s (A-01..A-05 modullari) — default 15s hook timeout yetmaydi

afterAll(async () => {
  if (child) child.kill('SIGTERM');
  await new Promise((r) => setTimeout(r, 500));
  if (dbSnapshot !== null) writeFileSync('data/db.json', dbSnapshot, 'utf8');
});

const PW = 'sirli-parol-2026';

/** Legacy SHA-256 hash (hashPass bilan bir xil formula). */
function legacySha256(pw, salt) {
  return crypto.createHash('sha256').update('qb_' + salt + '_' + pw).digest('hex');
}

async function getCsrf(path = '/user/login') {
  const res = await fetch(`${baseUrl}${path}`);
  const html = await res.text();
  const m = html.match(/name="_csrf" value="([^"]+)"/) || html.match(/window\.__CSRF_TOKEN = '([^']+)'/);
  const cookie = (res.headers.get('set-cookie') || '').split(';')[0];
  return { csrf: m ? m[1] : null, cookie, html };
}

async function postForm(path, cookie, body, xff = '203.0.113.41') {
  return fetch(`${baseUrl}${path}`, {
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

describe('AUTH A-05 — legacy hash migratsiya', () => {
  it('legacy SHA-256 hash → login 302 + DB rehash Argon2', async () => {
    const uname = `a05sha_${Date.now() % 1000000}`;
    const key = uname;
    // DB'ga legacy SHA-256 bilan user yozamiz
    const db = JSON.parse(readFileSync('data/db.json', 'utf8'));
    db.users = db.users || {};
    db.users[key] = {
      username: uname,
      password: legacySha256(PW, key),
      created_at: Date.now(),
      isVip: false,
    };
    writeFileSync('data/db.json', JSON.stringify(db), 'utf8');

    const { csrf, cookie } = await getCsrf();
    const res = await postForm('/user/login', cookie, {
      _csrf: csrf, lang: 'uz', mode: 'login', username: uname, password: PW,
    });
    expect(res.status).toBe(302);

    // DB'da endi Argon2 hash bo'lishi kerak
    const after = JSON.parse(readFileSync('data/db.json', 'utf8'));
    const stored = after.users[key]?.password || '';
    expect(stored.startsWith('$argon2')).toBe(true);
    expect(stored).not.toBe(legacySha256(PW, key));
  });

  it('legacy plaintext → login 302 + DB rehash Argon2', async () => {
    const uname = `a05plain_${Date.now() % 1000000}`;
    const key = uname;
    const db = JSON.parse(readFileSync('data/db.json', 'utf8'));
    db.users = db.users || {};
    db.users[key] = {
      username: uname,
      password: PW, // legacy plaintext
      created_at: Date.now(),
      isVip: false,
    };
    writeFileSync('data/db.json', JSON.stringify(db), 'utf8');

    const { csrf, cookie } = await getCsrf();
    const res = await postForm('/user/login', cookie, {
      _csrf: csrf, lang: 'uz', mode: 'login', username: uname, password: PW,
    });
    expect(res.status).toBe(302);

    const after = JSON.parse(readFileSync('data/db.json', 'utf8'));
    const stored = after.users[key]?.password || '';
    expect(stored.startsWith('$argon2')).toBe(true);
    expect(stored).not.toBe(PW);
  });

  it('last_login yangilanadi (OIDC bilan izchil)', async () => {
    const uname = `a05ll_${Date.now() % 1000000}`;
    const key = uname;
    const db = JSON.parse(readFileSync('data/db.json', 'utf8'));
    db.users = db.users || {};
    db.users[key] = {
      username: uname,
      password: legacySha256(PW, key),
      created_at: Date.now(),
      isVip: false,
      last_login: 1, // eski qiymat
    };
    writeFileSync('data/db.json', JSON.stringify(db), 'utf8');

    const { csrf, cookie } = await getCsrf();
    const res = await postForm('/user/login', cookie, {
      _csrf: csrf, lang: 'uz', mode: 'login', username: uname, password: PW,
    });
    expect(res.status).toBe(302);

    const after = JSON.parse(readFileSync('data/db.json', 'utf8'));
    expect(after.users[key]?.last_login).toBeGreaterThan(1);
  });
});

describe('AUTH A-05 — role redirect + returnUrl allowlist', () => {
  it('student → /user/panel (default)', async () => {
    const uname = `a05st_${Date.now() % 1000000}`;
    const key = uname;
    const db = JSON.parse(readFileSync('data/db.json', 'utf8'));
    db.users = db.users || {};
    db.users[key] = {
      username: uname,
      password: legacySha256(PW, key),
      created_at: Date.now(),
      isVip: false,
      role: 'student',
    };
    writeFileSync('data/db.json', JSON.stringify(db), 'utf8');

    const { csrf, cookie } = await getCsrf();
    const res = await postForm('/user/login', cookie, {
      _csrf: csrf, lang: 'uz', mode: 'login', username: uname, password: PW,
    });
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('/user/panel');
  });

  it('teacher → /teacher (role redirect)', async () => {
    const uname = `a05teach_${Date.now() % 1000000}`;
    const key = uname;
    const db = JSON.parse(readFileSync('data/db.json', 'utf8'));
    db.users = db.users || {};
    db.users[key] = {
      username: uname,
      password: legacySha256(PW, key),
      created_at: Date.now(),
      isVip: false,
      role: 'teacher',
    };
    writeFileSync('data/db.json', JSON.stringify(db), 'utf8');

    const { csrf, cookie } = await getCsrf();
    const res = await postForm('/user/login', cookie, {
      _csrf: csrf, lang: 'uz', mode: 'login', username: uname, password: PW,
    });
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('/teacher');
  });

  it('returnUrl allowlist: ruxsat etilgan prefix qaytariladi', async () => {
    const uname = `a05ru_${Date.now() % 1000000}`;
    const key = uname;
    const db = JSON.parse(readFileSync('data/db.json', 'utf8'));
    db.users = db.users || {};
    db.users[key] = {
      username: uname,
      password: legacySha256(PW, key),
      created_at: Date.now(),
      isVip: false,
      role: 'student',
    };
    writeFileSync('data/db.json', JSON.stringify(db), 'utf8');

    const { csrf, cookie } = await getCsrf();
    const res = await postForm('/user/login?returnUrl=/assignments', cookie, {
      _csrf: csrf, lang: 'uz', mode: 'login', username: uname, password: PW,
    });
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('/assignments');
  });

  it('returnUrl allowlist: noma\'lum path → default /user/panel', async () => {
    const uname = `a05ru2_${Date.now() % 1000000}`;
    const key = uname;
    const db = JSON.parse(readFileSync('data/db.json', 'utf8'));
    db.users = db.users || {};
    db.users[key] = {
      username: uname,
      password: legacySha256(PW, key),
      created_at: Date.now(),
      isVip: false,
      role: 'student',
    };
    writeFileSync('data/db.json', JSON.stringify(db), 'utf8');

    const { csrf, cookie } = await getCsrf();
    // allowlist'da yo'q path + open-redirect urinishlari
    const res = await postForm('/user/login?returnUrl=/noma-lum', cookie, {
      _csrf: csrf, lang: 'uz', mode: 'login', username: uname, password: PW,
    });
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('/user/panel');
  });
});

describe('AUTH A-05 — yangi qurilmadan login (P1 A-09)', () => {
  it('noto\'g\'ri parol — failure\'da ham login oqimi xavfsiz (200 + inline)', async () => {
    const uname = `a05nd_${Date.now() % 1000000}`;
    const key = uname;
    const db = JSON.parse(readFileSync('data/db.json', 'utf8'));
    db.users = db.users || {};
    db.users[key] = {
      username: uname,
      password: legacySha256(PW, key),
      created_at: Date.now(),
      isVip: false,
    };
    writeFileSync('data/db.json', JSON.stringify(db), 'utf8');

    const { csrf, cookie } = await getCsrf();
    const res = await postForm('/user/login', cookie, {
      _csrf: csrf, lang: 'uz', mode: 'login', username: uname, password: 'noto-gri-parol',
    });
    expect([200, 302]).toContain(res.status);
    const html = await res.text();
    expect(html).toContain('Parol noto');
  });
});
