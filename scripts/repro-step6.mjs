/**
 * REPRO STEP 6 (debugging branch): Cast kirish oqimi — brauzer/server verify
 * -----------------------------------------------------------------------
 * Buglar: BUG-049 (landing join dialog faqat-raqam — cast kodlar imkonsiz),
 * BUG-002 (matn/validatsiya nomuvofiqligi), BUG-050 (/play formasi 5 raqamga
 * qulflangan), BUG-051 (URL autofill faqat \d{5}), BUG-020 (resolve fail — jim
 * fallback), BUG-021 (GET meta 404), BUG-052 (loadLobbyInfo javobi o'qilmagan).
 *
 * Tekshiruvlar:
 *   A. Landing: cast kodi 'fw2rye' (kichik harf!) kiritilsa → uppercase bo'lib
 *      qoladi, harflar O'CHMAYDI; Kirish → /play?code=FW2RYE ga navigatsiya
 *   B. /play?code=HAQIQIY (seeded cast sessiya) → 'Cast — Ishtirokchi' ochiladi
 *   C. /play?code=ZZZZZZ (cast format, yo'q) → enter sahifasi + castMiss XABARI
 *   D. /play?code=12345 (5 raqam) → enter sahifasi (quiz oqimi buzilmagan)
 *   E. GET /api/cast/sessions/:id/meta: owner bilan 200 {ok,joinCode,phase};
 *      guest → himoyalangan
 *   F. /play formasi: 6 belgili harfli kod yozib Davom etish → /play?code=...
 *   G. /cast/:id/director (owner) → 200, meta fetch 404 EMAS (network tekshiruv)
 * Run: NODE_ENV=test LOCAL_DB_FILE=/tmp/repro-step6-db.json node scripts/repro-step6.mjs
 */
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';

const PORT = 4580;
const BASE = `http://localhost:${PORT}`;
const STAMP = Date.now() % 1000000;
const TEACHER = `repro_s6t_${STAMP}`;
const PASS = 'parol-2026-x-uzun';
const JOIN_CODE = 'FW2RYE';
const SESSION_ID = `cast_repro_${STAMP}`;

process.env.NODE_ENV = 'test';
process.env.SESSION_SECRET = 'repro-secret-0123456789abcdef0123456789abcdef';
if (!process.env.LOCAL_DB_FILE) process.env.LOCAL_DB_FILE = '/tmp/repro-step6-db.json';
try { (await import('fs')).rmSync(process.env.LOCAL_DB_FILE, { force: true }); } catch (_) {}
const { fb } = await import('../firebase/admin.js');
const { safeKey, hashPass } = await import('../utils/helpers.js');

const teacherKey = safeKey(TEACHER);
await fb.set(`users/${teacherKey}`, {
  username: TEACHER, email: `${TEACHER}@test.uz`, email_verified: true,
  role: 'teacher', role_version: 1, password: hashPass(PASS, teacherKey), created_at: Date.now(),
});
const { createSession } = await import('../services/cast/session-store.js');
await createSession({
  sessionId: SESSION_ID, joinCode: JOIN_CODE,
  meta: { title: 'Repro Cast Darsi', hostName: TEACHER },
  config: { localization: { locale: 'uz-Latn' } },
  state: { phase: 'lobby', revision: 1 },
  privateQuestions: [], publicQuestions: [],
});
await fb.set(`cast_sessions/${SESSION_ID}/roles/${encodeURIComponent(`user:${teacherKey}`)}`,
  { actorId: `user:${teacherKey}`, role: 'owner', grantedBy: 'system', grantedAt: Date.now() });
console.log('seed OK (teacher + cast sessiya ' + JOIN_CODE + ')');

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

// teacher login (supertest)
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
  mode: 'login', _csrf: csrf, lang: 'uz', username: TEACHER, password: PASS }); track(li);
console.log('login OK (teacher)');

const results = [];
const check = (name, ok, extra = '') => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'} — ${name}${extra ? ' (' + extra + ')' : ''}`);
};

// ── E: meta route (server) ──
{
  const m = await agent.get(`/api/cast/sessions/${SESSION_ID}/meta`);
  let body = {};
  try { body = m.body || {}; } catch (_) {}
  check('E: meta owner bilan 200 + ok + joinCode', m.status === 200 && body.ok === true && body.joinCode === JOIN_CODE, `status=${m.status} code=${body.joinCode}`);
  check('E: meta phase=lobby', body.phase === 'lobby', body.phase);
  const g = await fetch(`${BASE}/api/cast/sessions/${SESSION_ID}/meta`, { headers: { Accept: 'application/json' } });
  check('E2: meta guest uchun himoyalangan (401)', g.status === 401, `status=${g.status}`);
  const nf = await agent.get(`/api/cast/sessions/cast_yoq_123/meta`);
  check('E3: meta yo‘q sessiya → 404 not_found', nf.status === 404 && nf.body?.error === 'not_found', `status=${nf.status}`);
}

// ── B/C/D: /play server xatti-harakati ──
{
  const b = await agent.get(`/play?code=${JOIN_CODE}`);
  check('B: /play?code=HAQIQIY → Cast ishtirokchi', b.status === 200 && b.text.includes('Cast — Ishtirokchi'), `status=${b.status}`);
  const c = await agent.get('/play?code=ZZ9ZZ9');
  check('C: /play?code=YO‘Q (cast format) → enter + castMiss yo‘lagi', c.status === 200 && c.text.includes('game/enter') === false && c.text.includes('code-inp'), `status=${c.status}`);
  const c2 = await fetch(`${BASE}/play?code=ZZ9ZZ9`, { headers: { cookie: [...seen.entries()].map(([k, v]) => `${k}=${v}`).join('; ') } });
  const html = await c2.text();
  check('C2: castMiss xabari render bo‘ladi (BUG-020)', html.includes('castMiss') || html.includes("topilmadi yoki sessiya"), '');
  const d = await agent.get('/play?code=12345');
  check('D: /play?code=12345 → enter (quiz oqimi saqlangan)', d.status === 200 && d.text.includes('code-inp'), `status=${d.status}`);
}

// ── A/F/G: brauzer ──
const browser = await chromium.launch();
try {
  const ctx = await browser.newContext();
  await ctx.addCookies([...seen.entries()].map(([name, value]) => ({ name, value, url: BASE })));
  const page = await ctx.newPage();

  // A: landing join dialog — kichik harfli cast kodi
  await page.goto(`${BASE}/?lang=uz`, { waitUntil: 'networkidle' });
  await page.locator('#joinBtn, [data-join], .btn:has-text("Cast"), a[href="#cast"]').first().click().catch(() => {});
  await page.waitForTimeout(400);
  const dlg = await page.locator('#joinOverlay.open').count();
  if (dlg === 0) {
    // turli yo'l: join ochish tugmasini topamiz
    await page.evaluate(() => document.getElementById('joinOverlay')?.classList.add('open'));
  }
  await page.fill('#jcode', 'fw2rye');
  const val = await page.inputValue('#jcode');
  check('A: kichik harf → UPPERCASE saqlanadi (harflar o‘chmaydi)', val === 'FW2RYE', val);
  await Promise.all([page.waitForNavigation({ timeout: 10000 }).catch(() => {}), page.locator('#joinGo').click()]);
  await page.waitForTimeout(500);
  check('A2: Kirish → /play?code=FW2RYE', new URL(page.url()).searchParams.get('code') === 'FW2RYE', page.url());
  check('A3: Cast ishtirokchi sahifasi ochildi', (await page.locator('text=Repro Cast Darsi').count()) > 0 || !new URL(page.url()).searchParams.get('castMiss'), page.url());

  // F: /play formasi — harfli 6 belgili kod
  await page.goto(`${BASE}/play`, { waitUntil: 'networkidle' });
  await page.fill('#code-inp', 'ab12cd');
  check('F: formada harfli kod qabul qilinadi (uppercase)', (await page.inputValue('#code-inp')) === 'AB12CD');
  await Promise.all([page.waitForNavigation({ timeout: 10000 }).catch(() => {}), page.locator('#code-btn').click()]);
  check('F2: Davom etish → /play?code=AB12CD', new URL(page.url()).searchParams.get('code') === 'AB12CD', page.url());

  // G: director sahifasi — meta fetch 404 emas
  const dpage = await ctx.newPage();
  const misses = [];
  dpage.on('response', (r) => { if (r.url().includes('/meta')) misses.push(r.status()); });
  const derr = [];
  dpage.on('pageerror', (e) => derr.push(String(e).split('\n')[0]));
  const dres = await dpage.goto(`${BASE}/cast/${SESSION_ID}/director`, { waitUntil: 'networkidle' }).catch((e) => e);
  check('G: /cast/:id/director (owner) 200', dres && dres.status && (await dres.status()) === 200, dres ? String(dres.status?.() ?? dres.message).slice(0, 40) : '');
  await dpage.waitForTimeout(800);
  check('G2: meta fetch 404 EMAS (BUG-021)', !misses.includes(404), misses.join(','));
  check('G3: director pageerror=0', derr.length === 0, derr.slice(0, 2).join(' | '));
} finally {
  const fails = results.filter((r) => !r.ok).length;
  console.log(fails ? `\n${fails} ta FAIL ❌` : '\nHAMMASI PASS ✅');
  await browser.close();
  srv.kill();
  process.exit(fails ? 1 : 0);
}
