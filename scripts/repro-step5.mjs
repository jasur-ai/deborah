/**
 * REPRO STEP 5 (debugging branch): registratsiya oqimi — brauzer verify
 * ------------------------------------------------------------------
 * Buglar: BUG-035 (landing'da rol tanlash yo'q), BUG-036 (consent hidden avto-on),
 * BUG-040 (/user/register havolasi yo'q), BUG-039 (SMTP — unit/provider darajasida).
 *
 * Tekshiruvlar:
 *   A. Landing fReg: rol radio (Talaba/O'qituvchi), consent checkbox REQUIRED +
 *      unchecked, /user/register havolasi bor
 *   B. i18n: ru tiliga o'tganda rol matnlari ruscha
 *   C. Oqim: consent'siz submit → brauzer validatsiya to'sadi (form submit bo'lmaydi)
 *   D. Oqim: teacher rol + consent → server to'liq /user/register formaga
 *      prefilled (username/email) + tushuntirish xatosi bilan tushadi
 *   E. Oqim: student + consent → registratsiya muvaffaqiyatli (login sahifasiga/
 *      verify banner — responsiga qarab)
 * Run: NODE_ENV=test LOCAL_DB_FILE=/tmp/repro-step5-db.json node scripts/repro-step5.mjs
 */
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';

const PORT = 4577;
const BASE = `http://localhost:${PORT}`;
const STAMP = Date.now() % 1000000;

process.env.NODE_ENV = 'test';
process.env.SESSION_SECRET = 'repro-secret-0123456789abcdef0123456789abcdef';
if (!process.env.LOCAL_DB_FILE) process.env.LOCAL_DB_FILE = '/tmp/repro-step5-db.json';
try { (await import('fs')).rmSync(process.env.LOCAL_DB_FILE, { force: true }); } catch (_) {}

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

const browser = await chromium.launch();
const results = [];
const check = (name, ok, extra = '') => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'} — ${name}${extra ? ' (' + extra + ')' : ''}`);
};
try {
  const page = await (await browser.newContext()).newPage();
  await page.goto(`${BASE}/?lang=uz#auth`, { waitUntil: 'networkidle' });

  // A: forma elementlari
  await page.locator('.tabs button[data-tab="reg"]').click(); // Ro'yxatdan o'tish tab
  await page.waitForTimeout(300);
  check('A: rol radio Talaba bor', (await page.locator('input[name="role"][value=""]').count()) === 1);
  check('A: rol radio O‘qituvchi bor', (await page.locator('input[name="role"][value="teacher"]').count()) === 1);
  const consent = page.locator('#rConsent');
  check('A: consent checkbox bor', (await consent.count()) === 1);
  check('A: consent REQUIRED + unchecked', await consent.evaluate((el) => el.required && !el.checked));
  check('A: consent hidden EMAS (faol)', await consent.evaluate((el) => el.type === 'checkbox'));
  check('A: /user/register havolasi bor', (await page.locator('a[href="/user/register"]').count()) >= 1);

  // B: i18n (ru)
  await page.locator('.lang button[data-lang="ru"]').click();
  await page.waitForTimeout(300);
  const roleTxt = await page.locator('#fReg label[data-i18n="auth.role"]').textContent().catch(() => '');
  check('B: i18n ru — rol matni ruscha', /Рол|роль/i.test(roleTxt || ''), roleTxt);

  // C: consent'siz submit — brauzer to'sadi (sahifa o'zgarmaydi)
  await page.locator('.tabs button[data-tab="reg"]').click();
  await page.fill('#rName', 'Test Talaba');
  await page.fill('#rEmail', `stu_${STAMP}@test.uz`);
  await page.fill('#rUser', `stu_${STAMP}`);
  await page.fill('#rPass', 'parol-2026-x-uzun');
  const urlBefore = page.url();
  await page.locator('#fReg button[type="submit"]').click();
  await page.waitForTimeout(900);
  check('C: consent‘siz submit bloklandi (URL o‘zgarmadi)', page.url() === urlBefore, page.url());

  // D: teacher roli → to'liq forma (prefilled)
  await page.locator('input[name="role"][value="teacher"]').check();
  await page.locator('#rConsent').check();
  await Promise.all([
    page.waitForNavigation({ timeout: 15000 }).catch(() => {}),
    page.locator('#fReg button[type="submit"]').click(),
  ]);
  await page.waitForTimeout(600);
  // Server to'liq register formani /user/login URL'ida render qiladi (redirect emas) —
  // kontentga qaraymiz: university maydoni + prefilled username + teacher roller
  const hasUniversity = (await page.locator('input[name="university"]').count()) === 1;
  check('D: teacher → to‘liq ariza formasi (university maydoni)', hasUniversity);
  const prefilledUser = await page.locator('input[name="username"]').inputValue().catch(() => '');
  check('D2: username prefilled', prefilledUser === `stu_${STAMP}`, prefilledUser);
  const teacherChecked = await page.locator('input[name="role"][value="teacher"]').isChecked().catch(() => false);
  check('D3: teacher roli saqlangan', teacherChecked);

  // E: yangi kontekst — student to'liq registratsiya (consent bilan)
  const p2 = await (await browser.newContext()).newPage();
  await p2.goto(`${BASE}/?lang=uz#auth`, { waitUntil: 'networkidle' });
  await p2.locator('.tabs button[data-tab="reg"]').click();
  await p2.fill('#rName', 'Test Student');
  await p2.fill('#rEmail', `stud2_${STAMP}@test.uz`);
  await p2.fill('#rUser', `stud2_${STAMP}`);
  await p2.fill('#rPass', 'parol-2026-x-uzun');
  await p2.locator('#rConsent').check();
  await Promise.all([
    p2.waitForNavigation({ timeout: 20000 }).catch(() => {}),
    p2.locator('#fReg button[type="submit"]').click(),
  ]);
  await p2.waitForTimeout(800);
  const ok = p2.url().includes('/user/login') || p2.url().includes('verify') || (await p2.locator('#doneReg').textContent().catch(() => '')).length > 0 || p2.url().includes('/user/panel');
  check('E: student + consent → registratsiya o‘tdi', ok, p2.url());
} finally {
  const fails = results.filter((r) => !r.ok).length;
  console.log(fails ? `\n${fails} ta FAIL ❌` : '\nHAMMASI PASS ✅');
  await browser.close();
  srv.kill();
  process.exit(fails ? 1 : 0);
}
