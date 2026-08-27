/**
 * REPRO STEP 2 (debugging branch): auth/session backend buglari — brauzer verify
 * ----------------------------------------------------------------------------
 * Buglar: BUG-011 (student security-profile'da mfa-settings.js TypeError),
 * BUG-041 (/user/teacher-approval guest'ga xom 401 JSON), BUG-016 (unit'da isbot).
 *
 * Tekshiruvlar:
 *   A. STUDENT /user/security-profile — pageerror=0; /js/mfa-settings.js SO'RALMAYDI
 *      (role-shartli yuklash); #mfa-card YO'Q (MFA faqat admin/teacher)
 *   B. TEACHER /user/security-profile — pageerror=0; mfa-settings.js yuklandi;
 *      #mfa-card bor; #mfa-enable-btn bor (IIFE to'liq ishlaydi)
 *   C. GUEST GET /user/teacher-approval (brauzer Accept) → 302 login redirect
 *      (xom JSON emas); Accept: application/json → 401 JSON (API klientlari uchun)
 * Run: NODE_ENV=test LOCAL_DB_FILE=/tmp/repro-step2-db.json node scripts/repro-step2.mjs
 */
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';

const PORT = 4574;
const BASE = `http://localhost:${PORT}`;
const STAMP = Date.now() % 1000000;
const STUDENT = `repro_s2stu_${STAMP}`;
const TEACHER = `repro_s2tea_${STAMP}`;
const PASS = 'parol-2026-x-uzun';

// ── 1) Pre-seed: student (MFA yo'q) + teacher (MFA yo'q — enable oqimi ko'rinadi) ──
process.env.NODE_ENV = 'test';
process.env.SESSION_SECRET = 'repro-secret-0123456789abcdef0123456789abcdef';
if (!process.env.LOCAL_DB_FILE) process.env.LOCAL_DB_FILE = '/tmp/repro-step2-db.json';
try { (await import('fs')).rmSync(process.env.LOCAL_DB_FILE, { force: true }); } catch (_) {}
const { fb } = await import('../firebase/admin.js');
const { safeKey, hashPass } = await import('../utils/helpers.js');
for (const [uname, role] of [[STUDENT, 'student'], [TEACHER, 'teacher']]) {
  await fb.set(`users/${safeKey(uname)}`, {
    username: uname,
    email: `${uname}@test.uz`,
    email_verified: true,
    role,
    role_version: 1,
    password: hashPass(PASS, safeKey(uname)),
    created_at: Date.now(),
  });
}
console.log('seed OK (student + teacher, MFA yo‘q)');

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

// ── 3) Supertest login (2 akkaunt) ──
const { default: Supertest } = await import('supertest');
async function login(uname) {
  const agent = Supertest.agent(BASE);
  const seen = new Map();
  const track = (res) => (res.headers['set-cookie'] || []).forEach((h) => {
    const [kv] = h.split(';'); const i = kv.indexOf('=');
    if (i > 0) seen.set(kv.slice(0, i), kv.slice(i + 1));
  });
  const page = await agent.get('/user/login?lang=uz'); track(page);
  const csrf = page.text.match(/name="_csrf" value="([^"]+)"/)[1];
  const res = await agent.post('/user/login').type('form').send({
    mode: 'login', _csrf: csrf, lang: 'uz', username: uname, password: PASS,
  }); track(res);
  return seen;
}
const studentJar = await login(STUDENT);
const teacherJar = await login(TEACHER);
console.log('login OK (student + teacher)');

// ── 4) C: GUEST teacher-approval — kontent muzokarasi (BUG-041) ──
const results = [];
const check = (name, ok, extra = '') => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'} — ${name}${extra ? ' (' + extra + ')' : ''}`);
};
const guestHtml = await fetch(`${BASE}/user/teacher-approval`, {
  headers: { Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8' },
  redirect: 'manual',
});
check('C: guest + brauzer Accept → 302 (JSON emas)', guestHtml.status === 302, `status=${guestHtml.status}`);
check('C: redirect → /user/login', (guestHtml.headers.get('location') || '').startsWith('/user/login'), guestHtml.headers.get('location') || '');
const guestJson = await fetch(`${BASE}/user/teacher-approval`, {
  headers: { Accept: 'application/json' },
});
const gj = await guestJson.json().catch(() => ({}));
check('C: guest + Accept:application/json → 401 JSON (API saqlanadi)', guestJson.status === 401 && !!gj.error, `status=${guestJson.status}`);

// ── 5) A/B: brauzer ──
const browser = await chromium.launch();
try {
  // A: student
  {
    const ctx = await browser.newContext();
    await ctx.addCookies([...studentJar.entries()].map(([name, value]) => ({ name, value, url: BASE })));
    const page = await ctx.newPage();
    const errors = [];
    const requested = [];
    page.on('pageerror', (e) => errors.push(String(e).split('\n')[0]));
    page.on('request', (r) => requested.push(r.url()));
    await page.goto(`${BASE}/user/security-profile`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(400);
    check('A(student): pageerror=0 (BUG-011 fix)', errors.length === 0, errors.slice(0, 2).join(' | '));
    check('A(student): mfa-settings.js SO‘RALMADI', !requested.some((u) => u.includes('mfa-settings.js')));
    check('A(student): #mfa-card yo‘q (MFA faqat admin/teacher)', (await page.locator('#mfa-card').count()) === 0);
    await ctx.close();
  }
  // B: teacher
  {
    const ctx = await browser.newContext();
    await ctx.addCookies([...teacherJar.entries()].map(([name, value]) => ({ name, value, url: BASE })));
    const page = await ctx.newPage();
    const errors = [];
    const requested = [];
    page.on('pageerror', (e) => errors.push(String(e).split('\n')[0]));
    page.on('request', (r) => requested.push(r.url()));
    await page.goto(`${BASE}/user/security-profile`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(600);
    check('B(teacher): pageerror=0', errors.length === 0, errors.slice(0, 2).join(' | '));
    check('B(teacher): mfa-settings.js yuklandi', requested.some((u) => u.includes('mfa-settings.js')));
    check('B(teacher): #mfa-card bor', (await page.locator('#mfa-card').count()) === 1);
    check('B(teacher): #mfa-enable-btn bor (IIFE to‘liq ishlaydi)', (await page.locator('#mfa-enable-btn').count()) === 1);
    await ctx.close();
  }
} finally {
  const fails = results.filter((r) => !r.ok).length;
  console.log(fails ? `\n${fails} ta FAIL ❌` : '\nHAMMASI PASS ✅');
  await browser.close();
  srv.kill();
  process.exit(fails ? 1 : 0);
}
