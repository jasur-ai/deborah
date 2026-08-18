#!/usr/bin/env node
/**
 * Deborah — HTTP Smoke + Landmark Gate (STEP 02 / S02.07–S02.09)
 * --------------------------------------------------------------
 * Server'ni o'zi ishga tushiradi (NODE_ENV=test, lokal DB) va:
 *   - Ochiq sahifalar: /, /play, /user/login, /user/forgot → 200
 *   - Himoyalangan: /user/panel, /admin/dashboard → login'siz redirect
 *   - CSRF'li admin login → dashboard 200 + heading/landmark
 *   - Register → login → user panel 200 + heading/landmark
 *   - Yo'q route → error.ejs render (404/500, HTML bilan)
 *
 * S02.08: seed credential test-only fixture orqali (ADMIN_USER/ADMIN_PASS
 * env), production credential hech qayerda hardcode qilinmaydi.
 *
 * Ishga tushirish: node scripts/test-views-http.js (yoki npm run test:views:http)
 * Exit: 0 = hammasi OK; 1 = xato bor.
 */
process.env.NODE_ENV = 'test';
process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'ci-secret-for-testing-0123';
process.env.ADMIN_USER = process.env.ADMIN_USER || 'admin-test';
process.env.ADMIN_PASS = process.env.ADMIN_PASS || 'admin-pass-2026';

const { createApp } = await import('../server.js');

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? '  ✅' : '  ❌'} ${name}${detail ? ' — ' + detail : ''}`);
}

async function get(url, cookie = '') {
  const res = await fetch(url, {
    redirect: 'manual',
    headers: cookie ? { cookie } : {},
  });
  const text = await res.text();
  return { status: res.status, location: res.headers.get('location') || '', text, setCookie: res.headers.get('set-cookie') || '' };
}

/** CSRF token + cookie (sessiya bilan bog'langan). */
async function getCsrf(url) {
  const res = await fetch(url, { redirect: 'manual' });
  const html = await res.text();
  const m = html.match(/name="_csrf" value="([^"]+)"/);
  const cookie = (res.headers.get('set-cookie') || '').split(';')[0];
  return { csrf: m ? m[1] : null, cookie, html, res };
}

async function postForm(url, cookie, body) {
  return fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      cookie,
    },
    redirect: 'manual',
    body: new URLSearchParams(body).toString(),
  });
}

// ── Landmark tekshiruvi (S02.09) ──
function checkLandmarks(name, html) {
  const h1 = /<h1[\s>]/i.test(html);
  const main = /<main[\s>]/i.test(html);
  const nav = /<nav[\s>]/i.test(html);
  check(`${name} — <h1>`, h1, h1 ? '' : 'h1 topilmadi');
  check(`${name} — <main> landmark`, main, main ? '' : 'main topilmadi');
  check(`${name} — <nav>`, nav, nav ? '' : 'nav topilmadi');
}

const app = await createApp();
const httpServer = app.httpServer;
const port = await new Promise((resolve, reject) => {
  httpServer.listen(0, () => resolve(httpServer.address().port));
  httpServer.on('error', reject);
});
const base = `http://localhost:${port}`;

console.log(`\nHTTP smoke — ${base}\n`);

// ── 1. Ochiq sahifalar ──
for (const [path, name] of [
  ['/', 'GET /'],
  ['/play', 'GET /play'],
  ['/user/login', 'GET /user/login'],
  ['/user/forgot', 'GET /user/forgot'],
]) {
  const r = await get(`${base}${path}`);
  check(name, r.status === 200, `status=${r.status}`);
}

// ── 2. Himoyalangan sahifalar (login'siz redirect) ──
const panel = await get(`${base}/user/panel`);
check('GET /user/panel (login qilinmagan) — redirect', [302, 401].includes(panel.status), `status=${panel.status}`);

const dash = await get(`${base}/admin/dashboard`);
check('GET /admin/dashboard (login qilinmagan) — redirect', [302, 401].includes(dash.status), `status=${dash.status}`);

// ── 3. Admin login (CSRF) → dashboard 200 + landmark ──
const { csrf, cookie } = await getCsrf(`${base}/admin/login`);
check('Admin login formada CSRF bor', Boolean(csrf), csrf ? '' : 'csrf topilmadi');
if (csrf) {
  const loginRes = await postForm(`${base}/admin/login`, cookie, {
    _csrf: csrf,
    username: process.env.ADMIN_USER,
    password: process.env.ADMIN_PASS,
  });
  check('POST /admin/login — 302', loginRes.status === 302, `status=${loginRes.status}`);
  const setCookie = loginRes.headers.get('set-cookie') || '';
  const adminCookie = setCookie.split(';')[0];
  if (loginRes.status === 302 && adminCookie) {
    const dash2 = await get(`${base}/admin/dashboard`, adminCookie);
    check('GET /admin/dashboard (admin) — 200', dash2.status === 200, `status=${dash2.status}`);
    if (dash2.status === 200) checkLandmarks('dashboard (admin)', dash2.text);
  }
}

// ── 4. User: register → login → panel 200 + landmark (S02.08 test-only fixture) ──
const { fb } = await import('../firebase/admin.js');
const uname = `smoke_${Date.now() % 1000000}`;
const pw = 'smoke-parol-2026';
try {
  const reg = await getCsrf(`${base}/user/login`);
  if (reg.csrf) {
    const regRes = await postForm(`${base}/user/login`, reg.cookie, {
      _csrf: reg.csrf, lang: 'uz', mode: 'reg', username: uname, password: pw,
    });
    check('POST /user/login (register) — 302', regRes.status === 302, `status=${regRes.status}`);
    // Yangi sessiya (regenerate) cookie'si
    const regCookie = (regRes.headers.get('set-cookie') || '').split(';')[0] || reg.cookie;
    const log = await getCsrf(`${base}/user/login`);
    const logRes = await postForm(`${base}/user/login`, log.cookie, {
      _csrf: log.csrf, lang: 'uz', mode: 'login', username: uname, password: pw,
    });
    check('POST /user/login (login) — 302', logRes.status === 302, `status=${logRes.status}`);
    const loginCookie = (logRes.headers.get('set-cookie') || '').split(';')[0] || regCookie;
    if (logRes.status === 302 && loginCookie) {
      const panel2 = await get(`${base}/user/panel`, loginCookie);
      check('GET /user/panel (user) — 200', panel2.status === 200, `status=${panel2.status}`);
      if (panel2.status === 200) checkLandmarks('panel (user)', panel2.text);
    }
  }
} finally {
  // Cleanup (S02.11): smoke user'ni DB'dan o'chiramiz — xato/Ctrl+C da ham
  // ishga tushadi, working tree toza qoladi.
  await fb.remove(`users/${uname}`).catch(() => {});
}

// ── 5. Yo'q route → error sahifa (error.ejs ishlayaptimi) ──
const nf = await get(`${base}/bunday-route-98765`);
check('GET /bunday-route-98765 — error render', nf.status >= 400 && nf.status <= 500, `status=${nf.status}`);
check('error sahifasi HTML', /<html[\s>]/i.test(nf.text), '');

// ── 6. Static assetlar ──
const css = await get(`${base}/css/style.css`);
check('GET /css/style.css', css.status === 200, `status=${css.status}`);

// ── Natija ──
const failed = results.filter((r) => !r.ok);
console.log(`\n═══════════════════════════════════════════`);
console.log(`   📊 Natijalar: ${results.length - failed.length} ✅ | ${failed.length} ❌ | Jami: ${results.length}`);
console.log(`═══════════════════════════════════════════\n`);

await new Promise((resolve) => httpServer.close(resolve));
process.exit(failed.length ? 1 : 0);
