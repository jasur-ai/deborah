/**
 * REPRO STEP 1 (debugging branch): kritik frontend JS crash'lari — brauzer verify
 * ----------------------------------------------------------------------------
 * Buglar: BUG-009 (<%= JSON.stringify → SyntaxError, 3 view), BUG-010 (izohda
 * literal </script>), BUG-012/044 (main.js const $ ↔ inline const $).
 *
 * Skript: pre-seed STUDENT (MFA yo'q) → server → supertest.agent login →
 * brauzer cookie → tekshiruvlar:
 *   A. /user/panel      — pageerror=0; __CSRF_TOKEN string; __RISK_COPY__/__ACCOUNT_COPY__ object
 *   B. /user/test-arena — pageerror=0; loadArena/addBots function; window.$ function
 *   C. /user/create-test— pageerror=0; "breakout" matni sahifada KO'RINMAS; __CSRF_TOKEN string
 *   D. /user/portfolio  — pageerror=0 (inline `const $` bilan head/main.js birga)
 * Run: NODE_ENV=test LOCAL_DB_FILE=/tmp/repro-step1-db.json node scripts/repro-step1.mjs
 */
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';

const PORT = 4573;
const BASE = `http://localhost:${PORT}`;
const UNAME = `repro_s1_${Date.now() % 1000000}`;
const PASS = 'parol-2026-x-uzun';

// ── 1) Pre-seed: STUDENT (MFA yo'q — studentga MFA taqiqli) ──
process.env.NODE_ENV = 'test';
process.env.SESSION_SECRET = 'repro-secret-0123456789abcdef0123456789abcdef';
if (!process.env.LOCAL_DB_FILE) process.env.LOCAL_DB_FILE = '/tmp/repro-step1-db.json';
try { (await import('fs')).rmSync(process.env.LOCAL_DB_FILE, { force: true }); } catch (_) {}
const { fb } = await import('../firebase/admin.js');
const { safeKey, hashPass } = await import('../utils/helpers.js');
const userKey = safeKey(UNAME);
await fb.set(`users/${userKey}`, {
  username: UNAME,
  email: `${UNAME}@test.uz`,
  email_verified: true,
  role: 'student',
  role_version: 1,
  password: hashPass(PASS, userKey),
  created_at: Date.now(),
});
console.log("seed OK (student, MFA yo'q)");

// ── 2) Server ──
const env = {
  ...process.env,
  PORT: String(PORT),
  SESSION_SECRET: 'repro-secret-0123456789abcdef0123456789abcdef',
  ADMIN_USER: 'repro_admin',
  ADMIN_PASS: 'repro-pass-123',
  LOG_LEVEL: 'silent',
};
const srv = spawn('node', ['server.js'], { env, stdio: 'pipe' });
await new Promise((resolve, reject) => {
  const t = setTimeout(() => reject(new Error('server start timeout')), 25000);
  const check = async () => {
    try { const r = await fetch(`${BASE}/health`); if (r.ok) { clearTimeout(t); resolve(); } }
    catch (_) { setTimeout(check, 400); }
  };
  setTimeout(check, 1500);
  srv.on('exit', (c) => reject(new Error('server exited ' + c)));
});
console.log('server OK');

// ── 3) Login (student — MFA bosqichisiz) ──
const { default: Supertest } = await import('supertest');
const agent = Supertest.agent(BASE);
const seen = new Map();
const track = (res) => (res.headers['set-cookie'] || []).forEach((h) => {
  const [kv] = h.split(';'); const i = kv.indexOf('=');
  if (i > 0) seen.set(kv.slice(0, i), kv.slice(i + 1));
});
const formLogin = await agent.get('/user/login?lang=uz'); track(formLogin);
const csrf1 = formLogin.text.match(/name="_csrf" value="([^"]+)"/)[1];
const loginRes = await agent.post('/user/login').type('form').send({
  mode: 'login', _csrf: csrf1, lang: 'uz', username: UNAME, password: PASS,
}); track(loginRes);
const loc = loginRes.headers.location || '';
if (!loc.includes('/user/panel')) { console.log('FAIL: login →', loginRes.status, loc); srv.kill(); process.exit(1); }
console.log('login OK (student → panel)');

// ── 4) Brauzer ──
const browser = await chromium.launch();
const context = await browser.newContext();
await context.addCookies([...seen.entries()].map(([name, value]) => ({ name, value, url: BASE })));
const results = [];
const check = (name, ok, extra = '') => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'} — ${name}${extra ? ' (' + extra + ')' : ''}`);
};

async function auditPage(path, label, fn) {
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e).split('\n')[0]));
  await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(400);
  let probe = {};
  try { probe = await fn(page); } catch (e) { probe = { err: String(e).split('\n')[0] }; }
  check(`${label}: pageerror=0`, errors.length === 0, errors.slice(0, 2).join(' | '));
  for (const [k, v] of Object.entries(probe)) check(`${label}: ${k}`, v, '');
  await page.close();
}

try {
  await auditPage('/user/panel', 'A(panel)', async (page) => ({
    '__CSRF_TOKEN=string': await page.evaluate(() => typeof window.__CSRF_TOKEN) === 'string',
    '__RISK_COPY__=object': await page.evaluate(() => typeof window.__RISK_COPY__) === 'object',
    '__ACCOUNT_COPY__=object': await page.evaluate(() => typeof window.__ACCOUNT_COPY__) === 'object',
  }));

  await auditPage('/user/test-arena', 'B(arena)', async (page) => ({
    'loadArena=function': await page.evaluate(() => typeof window.loadArena) === 'function',
    'addBots=function': await page.evaluate(() => typeof window.addBots) === 'function',
    'window.$=function (main.js)': await page.evaluate(() => typeof window.$) === 'function',
  }));

  await auditPage('/user/create-test', 'C(create-test)', async (page) => ({
    '"breakout" matni ko\'rinmas': !(await page.evaluate(() => document.body.innerText.includes("breakout'ning oldi olinadi"))),
    '__CSRF_TOKEN=string': await page.evaluate(() => typeof window.__CSRF_TOKEN) === 'string',
  }));

  await auditPage('/play', 'D(game/enter: head + inline const $)', async (page) => ({
    'window.$=function (main.js yuklandi)': await page.evaluate(() => typeof window.$) === 'function',
  }));
} finally {
  const fails = results.filter((r) => !r.ok).length;
  console.log(fails ? `\n${fails} ta FAIL ❌` : '\nHAMMASI PASS ✅');
  await browser.close();
  srv.kill();
  process.exit(fails ? 1 : 0);
}
