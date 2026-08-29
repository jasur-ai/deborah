/**
 * REPRO STEP 4 (debugging branch): logout-CSRF + ko'rinadigan Chiqish — brauzer verify
 * --------------------------------------------------------------------------------
 * Buglar: BUG-008/032 (GET logout CSRF'siz), BUG-037 (Chiqish desktop'da fold ortida).
 *
 * Tekshiruvlar (student, brauzer):
 *   A. /user/panel sidebar'da "Akkaunt" bo'limida Chiqish TUGMASI ko'rinadi
 *      (offsetParent !== null — BUG-037)
 *   B. Tugma → GET /user/logout emas, POST (fetch/xhr bo'lmaydi, navigatsiya)
 *   C. /user/logout to'g'ridan-to'g'ri → 200 tasdiq sahifasi (sessiya TIRIK)
 *   D. "Ha, chiqish" → bosh sahifa + sessiya o'lgan (/user/panel → login redirect)
 * Run: NODE_ENV=test LOCAL_DB_FILE=/tmp/repro-step4-db.json node scripts/repro-step4.mjs
 */
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';

const PORT = 4576;
const BASE = `http://localhost:${PORT}`;
const UNAME = `repro_s4_${Date.now() % 1000000}`;
const PASS = 'parol-2026-x-uzun';

process.env.NODE_ENV = 'test';
process.env.SESSION_SECRET = 'repro-secret-0123456789abcdef0123456789abcdef';
if (!process.env.LOCAL_DB_FILE) process.env.LOCAL_DB_FILE = '/tmp/repro-step4-db.json';
try { (await import('fs')).rmSync(process.env.LOCAL_DB_FILE, { force: true }); } catch (_) {}
const { fb } = await import('../firebase/admin.js');
const { safeKey, hashPass } = await import('../utils/helpers.js');
await fb.set(`users/${safeKey(UNAME)}`, {
  username: UNAME, email: `${UNAME}@test.uz`, email_verified: true,
  role: 'student', role_version: 1, password: hashPass(PASS, safeKey(UNAME)), created_at: Date.now(),
});
console.log('seed OK (student)');

const srv = spawn('node', ['server.js'], {
  env: { ...process.env, PORT: String(PORT),
    SESSION_SECRET: 'repro-secret-0123456789abcdef0123456789abcdef',
    ADMIN_USER: 'repro_admin', ADMIN_PASS: 'repro-pass-123', LOG_LEVEL: 'silent' },
  stdio: 'pipe',
});
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

const { default: Supertest } = await import('supertest');
const agent = Supertest.agent(BASE);
const seen = new Map();
const track = (res) => (res.headers['set-cookie'] || []).forEach((h) => {
  const [kv] = h.split(';'); const i = kv.indexOf('=');
  if (i > 0) seen.set(kv.slice(0, i), kv.slice(i + 1));
});
const lp = await agent.get('/user/login?lang=uz'); track(lp);
const csrf = lp.text.match(/name="_csrf" value="([^"]+)"/)[1];
const li = await agent.post('/user/login').type('form').send({
  mode: 'login', _csrf: csrf, lang: 'uz', username: UNAME, password: PASS }); track(li);
console.log('login OK');

const browser = await chromium.launch();
const results = [];
const check = (name, ok, extra = '') => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'} — ${name}${extra ? ' (' + extra + ')' : ''}`);
};
try {
  const ctx = await browser.newContext();
  await ctx.addCookies([...seen.entries()].map(([name, value]) => ({ name, value, url: BASE })));
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e).split('\n')[0]));
  await page.goto(`${BASE}/user/panel`, { waitUntil: 'networkidle' });

  // A: ko'rinadigan Chiqish tugmasi (BUG-037)
  const btn = page.locator('form[action="/user/logout"] button').first();
  check('A: sidebar Chiqish tugmasi bor', (await btn.count()) === 1);
  check('A: tugma KO‘RINADI (offsetParent)', await btn.evaluate((el) => el.offsetParent !== null));

  // C: GET /user/logout (sessiya tirik) -> 200 TASDIQ sahifasi, sessiya o'lmaydi
  await page.goto(`${BASE}/user/logout`, { waitUntil: 'networkidle' });
  const confirmBtn = page.locator('#logout-confirm-btn');
  check('C: GET /user/logout -> tasdiq sahifasi', (await confirmBtn.count()) === 1);
  await page.goto(`${BASE}/user/panel`, { waitUntil: 'networkidle' });
  check('C2: GET tasdiqdan keyin panel HALI OCHIQ (sessiya tirik)', new URL(page.url()).pathname === '/user/panel', page.url());

  // B/D: sidebar tugmasi = POST form -> bir bosishda chiqish (CSRF bilan) -> /
  const btn2 = page.locator('form[action="/user/logout"] button').first();
  await Promise.all([page.waitForNavigation(), btn2.click()]);
  check('B: sidebar tugma (POST+CSRF) -> bosh sahifa', new URL(page.url()).pathname === '/', page.url());
  await page.goto(`${BASE}/user/panel`, { waitUntil: 'domcontentloaded' });
  check("D2: panel endi login'ga redirect (sessiya o'lgan)", new URL(page.url()).pathname.startsWith('/user/login'), page.url());
  check('E: pageerror=0', errors.length === 0, errors.slice(0, 2).join(' | '));
} finally {
  const fails = results.filter((r) => !r.ok).length;
  console.log(fails ? `\n${fails} ta FAIL ❌` : '\nHAMMASI PASS ✅');
  await browser.close();
  srv.kill();
  process.exit(fails ? 1 : 0);
}
