/**
 * REPRO (2026-08-27): Profilim — zaxira kodlar brauzer oqimi (TEACHER)
 * ---------------------------------------------------------
 * Foydalanuvchi xabarlagani: to'g'ri parol → 403; "Bekor qilish" ishlamaydi.
 * Sabablar (topilgan): 1) CSRF header duplikati (x-csrf-token + wrapper'ning
 * X-CSRF-Token → "token,token") 403; 2) .modal-back display:flex hidden'ni
 * bosib yuborardi → modal yopilmagan.
 *
 * Skript: pre-seed DB (teacher + LEGACY sha256 parol + MFA) → server →
 * API login (MFA verify bilan, cookie jar) → brauzerga cookie → UI tekshiruv:
 *   A. /user/profile ochilganda modal KO'RINMASLIGI (parol so'ralmaydi)
 *   B. "Zaxira kodlarni ko'rsatish" → modal ochiladi
 *   C. "Bekor qilish" → modal yopiladi
 *   D. LEGACY parol → 200 + 12 kod chiplari
 * Run: NODE_ENV=test LOCAL_DB_FILE=/tmp/rp.json node scripts/repro-profile.mjs
 */
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';

const PORT = 4571;
const BASE = `http://localhost:${PORT}`;
const UNAME = `repro_t${Date.now() % 1000000}`;
const PASS = 'parol-2026-x-uzun';

// ── 1) Pre-seed (serverdan OLDIN — boot'da faylni yuklaydi) ──
process.env.NODE_ENV = 'test';
process.env.SESSION_SECRET = 'repro-secret-0123456789abcdef0123456789abcdef';
if (!process.env.LOCAL_DB_FILE) process.env.LOCAL_DB_FILE = '/tmp/repro-profile-db.json';
try { (await import('fs')).rmSync(process.env.LOCAL_DB_FILE, { force: true }); } catch (_) {}
const { fb } = await import('../firebase/admin.js');
const { safeKey, hashPass } = await import('../utils/helpers.js');
const { setupTotp, enableTotp } = await import('../src/modules/auth/mfa-totp.js');
const { generate } = await import('otplib');

const userKey = safeKey(UNAME);
await fb.set(`users/${userKey}`, {
  username: UNAME,
  email: `${UNAME}@test.uz`,
  email_verified: true,
  role: 'teacher',
  role_version: 1,
  password: hashPass(PASS, userKey), // LEGACY sha256 — foydalanuvchi holati
  created_at: Date.now(),
});
const setup = await setupTotp(userKey, { accountName: UNAME });
const en = await enableTotp(userKey, await generate({ secret: setup.secret }));
if (!en.ok) { console.log('FAIL: MFA enable', en.error); process.exit(1); }
console.log('seed OK (teacher + legacy sha256 + MFA active)');

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

// ── 3) API login supertest.agent bilan (cookie'ni u boshqaradi) ──
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
if (!loc.includes('/user/mfa')) { console.log('FAIL: login →', loginRes.status, loc); srv.kill(); process.exit(1); }
const mfaPage = await agent.get(loc); track(mfaPage);
const csrf2 = (mfaPage.text.match(/window\.__CSRF_TOKEN\s*=\s*["']([a-f0-9]+)["']/) || [])[1];
const code = await generate({ secret: setup.secret });
const ver = await agent.post('/api/mfa/verify')
  .set('X-CSRF-Token', csrf2)
  .send({ challengeId: loc.split('challenge=')[1], code }); track(ver);
if (ver.status !== 200) { console.log('FAIL: mfa verify →', ver.status, ver.text.slice(0, 140)); srv.kill(); process.exit(1); }
console.log('API login OK (teacher, legacy parol + MFA)');

// agent cookie'larini brauzerga
const jar = seen;
console.log('cookies:', [...jar.keys()]);

// ── 4) Brauzer: cookie in'ektsiya → UI tekshiruv ──
const browser = await chromium.launch();
const context = await browser.newContext();
await context.addCookies([...jar.entries()].map(([name, value]) => ({
  name, value, url: BASE,
})));
const page = await context.newPage();
const results = [];
const check = (name, ok, extra = '') => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'} — ${name}${extra ? ' (' + extra + ')' : ''}`);
};
let apiAnswer = null;
page.on('response', async (res) => {
  if (res.url().includes('/api/profile/backup-codes')) {
    try { apiAnswer = { status: res.status(), body: await res.json() }; } catch (_) {}
  }
});

try {
  await page.goto(`${BASE}/user/profile`);
  await page.waitForTimeout(700);
  check('0: Profilim ochildi (parol so\u2018ralmadi)', page.url().includes('/user/profile'));

  const modalVisibleOnLoad = await page.locator('#reauth-modal').isVisible();
  check('A: kirishda modal YO\u2018Q', !modalVisibleOnLoad);

  await page.click('#bc-open');
  await page.waitForTimeout(300);
  check('B: tugma → modal ochiq', await page.locator('#reauth-modal').isVisible());

  await page.click('#reauth-cancel');
  await page.waitForTimeout(300);
  check('C: Bekor qilish → modal yopildi', !(await page.locator('#reauth-modal').isVisible()));

  await page.click('#bc-open');
  await page.fill('#reauth-pass', PASS);
  await page.click('#reauth-submit');
  await page.waitForTimeout(4000);
  const chips = await page.locator('.code-chip').count();
  check('D: legacy parol → 200', apiAnswer && apiAnswer.status === 200,
    apiAnswer ? `status=${apiAnswer.status} err=${apiAnswer.body && apiAnswer.body.error}` : 'javob yo\u2018q');
  check('D2: 12 ta kod ko\u2018rsatildi', chips === 12, `chips=${chips}`);
} catch (e) {
  check('oqim xatosiz', false, e.message);
}

await browser.close();
srv.kill();
const fails = results.filter((x) => !x.ok).length;
console.log(fails === 0 ? '\nHAMMASI PASS \u2705' : `\n${fails} ta FAIL \u274c`);
process.exit(fails === 0 ? 0 : 1);
