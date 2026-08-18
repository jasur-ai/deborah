/**
 * AUTH A-04 — Login sahifasi qayta qurish (Google birinchi, trust, inline xatolar)
 * -------------------------------------------------------------------
 * Alohida NODE server spawn qilinadi — OIDC YOQILGAN (GOOGLE_CLIENT_ID bilan).
 * OIDC-o'chiq (graceful) holat auth.test.js + oidc.test.js'da yopilgan.
 *
 * Qamrov: Google birinchi + /auth/google 302, trust microcopy, footer,
 * autofill, inline error elementlar, field-level error (data-field),
 * parol min 8 (Zod), XSS escaping, 44px tugma.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { spawn } from 'child_process';

const PORT = 3588;
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
  // Orphan server xavfi: avvalgi run'da qolib ketgan jarayon 3588'ni egallagan
  // bo'lsa, test eski serverga ulanishi mumkin (noto'g'ri natija). Pkill guard.
  await new Promise((r) => setTimeout(r, 500));
  const { execSync } = await import('child_process');
  try {
    execSync(`pkill -f 'node server.js' 2>/dev/null; pkill -f 'PORT=${PORT}' 2>/dev/null`);
  } catch {}
  await new Promise((r) => setTimeout(r, 800));

  dbSnapshot = existsSync('data/db.json') ? readFileSync('data/db.json', 'utf8') : null;
  child = spawn('node', ['server.js'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      NODE_ENV: 'test',
      SESSION_SECRET: 'ci-secret-for-testing',
      PORT: String(PORT),
      LOG_LEVEL: 'silent',
      GOOGLE_CLIENT_ID: 'a04-test.apps.googleusercontent.com',
      GOOGLE_CLIENT_SECRET: 'a04-test-secret',
      GOOGLE_REDIRECT_URI: `http://localhost:${PORT}/auth/google/callback`,
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

describe('AUTH A-04 — login sahifasi (OIDC yoqilgan server)', () => {
  it('Google tugmasi birinchi va ko\'rinadigan (display:none yo\'q)', async () => {
    const { html } = await getCsrf();
    expect(html).toContain('class="btn-google"');
    expect(html).toContain('href="/auth/google"');
    // Google blokida display:none yo'q
    expect(html).not.toMatch(/btn-google[^>]*style="[^"]*display:\s*none/);
    // Google username maydonidan OLDIN keladi (tartib: Google → yoki → forma)
    const googleIdx = html.indexOf('btn-google');
    const userIdx = html.indexOf('login-username');
    expect(googleIdx).toBeGreaterThan(-1);
    expect(userIdx).toBeGreaterThan(googleIdx);
    // Divider "yoki" mavjud
    expect(html).toContain('oidc-divider');
  });

  it('register rejimida ham Google tugmasi ko\'rinadi', async () => {
    const { html } = await getCsrf('/user/login?mode=reg');
    expect(html).toContain('class="btn-google"');
  });

  it('GET /auth/google → Google authorization URL (302)', async () => {
    const res = await fetch(`${baseUrl}/auth/google`, { redirect: 'manual' });
    expect(res.status).toBe(302);
    const loc = res.headers.get('location') || '';
    expect(loc).toContain('accounts.google.com');
    expect(loc).toContain('client_id=a04-test');
  });

  it('trust microcopy + footer linklari (4 til copy bank)', async () => {
    const { html } = await getCsrf();
    // Trust bloki mavjud + matn apostrof'siz qismi orqali (brittle emas).
    expect(html).toContain('class="trust"');
    expect(html).toContain('xavfsiz saqlanadi');
    // EJS <%= %> apostrofni &#39; ga escape qiladi (XSS himoyasi) —
    // bu aslida escape'ning ishlashini isbotlaydi.
    expect(html).toContain('O&#39;zbekistonda');
    expect(html).toContain('footer-link--admin');
    expect(html).toContain('href="/privacy"');
    expect(html).toContain('href="/terms"');
    // 4 til copy bank: uz (yuqorida) + en + ru + kk
    const en = await (await fetch(`${baseUrl}/user/login?lang=en`)).text();
    expect(en).toContain('stored securely in Uzbekistan');
    expect(en).toContain('Remember me'); // en'da yo'qolgan kalit qayta tiklandi
    const ru = await (await fetch(`${baseUrl}/user/login?lang=ru`)).text();
    expect(ru).toContain('Ваши данные надёжно защищены');
    // 4-til: uz-cyrl (kirill oʻzbekcha) — AUTH_LANGS = [uz, uz-cyrl, ru, en]
    const cyrl = await (await fetch(`${baseUrl}/user/login?lang=uz-cyrl`)).text();
    expect(cyrl).toContain('хавфсиз сақланади');
  });

  it('autofill atributlari: username/current-password/autocapitalize', async () => {
    const { html } = await getCsrf();
    expect(html).toContain('autocomplete="username"');
    expect(html).toContain('autocomplete="current-password"');
    expect(html).toContain('autocapitalize="off"');
    expect(html).toContain('autocomplete="new-password"'); // register
  });

  it('inline error elementlar: 4 maydon uchun err-text div\'lari', async () => {
    const { html } = await getCsrf();
    for (const id of ['err-username', 'err-login-password', 'err-reg-username', 'err-reg-password']) {
      expect(html).toContain(`id="${id}"`);
    }
    expect(html).toContain('role="alert"');
  });

  it('44px tugma: .btn-google min-height >= 44px', () => {
    const css = readFileSync('public/design/contexts/auth.css', 'utf8');
    const block = css.slice(css.indexOf('.btn-google {'));
    expect(block).toMatch(/min-height:\s*(4[4-9]|5\d)px/);
  });

  it('register qisqa parol → passwordMin xato + field="password"', async () => {
    const { csrf, cookie } = await getCsrf();
    const res = await postForm('/user/login', cookie, {
      _csrf: csrf, lang: 'uz', mode: 'reg', consent: 'on',
      email: `r5_${Date.now()}_${Math.floor(Math.random() * 1000000)}_a18@test.uz`,
      username: `a04r_${Date.now() % 100000}`, password: 'abc1',
    });
    const html = await res.text();
    // AUTH A-22 (NIST): min 8 → 15
    expect(html).toContain('Parol kamida 15 ta belgi');
    expect(html).toContain('data-field="password"');
    expect(html).toContain('err-reg-password');
  });

  it('noto\'g\'ri parol login → data-field="password" (inline reveal)', async () => {
    const uname = `a04l_${Date.now() % 1000000}`;
    // register
    const { csrf: c1, cookie: k1 } = await getCsrf();
    const reg = await postForm('/user/login', k1, {
      _csrf: c1, lang: 'uz', mode: 'reg', consent: 'on', username: uname, password: PW,
      email: `r6_${Date.now()}_${Math.floor(Math.random() * 1000000)}_a18@test.uz`,
    });
    expect(reg.status).toBe(302);
    // xato login
    const { csrf, cookie } = await getCsrf();
    const bad = await postForm('/user/login', cookie, {
      _csrf: csrf, lang: 'uz', mode: 'login', username: uname, password: 'noto-gri-parol',
    });
    const html = await bad.text();
    expect(html).toContain('Parol noto');
    expect(html).toContain('data-field="password"');
    // input saqlanadi (tozalanmaydi)
    expect(html).toContain(`value="${uname}"`);
  });

  it('XSS: username script payload escape qilinadi', async () => {
    const { csrf, cookie } = await getCsrf();
    const res = await postForm('/user/login', cookie, {
      _csrf: csrf, lang: 'uz', mode: 'reg', consent: 'on',
      email: `r7_${Date.now()}_${Math.floor(Math.random() * 1000000)}_a18@test.uz`,
      username: '<script>alert(1)</script>', password: PW,
    });
    const html = await res.text();
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toContain('value="<script>');
  });

  it('lockout UX elementlar (A-03): data-lockout/data-seconds/data-copy', async () => {
    const { html } = await getCsrf();
    expect(html).toContain('id="lockout-countdown"');
    expect(html).toContain('data-seconds=');
    expect(html).toContain('data-lockout=');
    expect(html).toContain('data-copy=');
  });
});
