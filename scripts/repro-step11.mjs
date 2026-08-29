/**
 * STEP 11 REPRO — qolgan hisobot buglari + konsol-scan topilmalari
 *
 * 1. BUG-013 security-profile teacher'da student API chaqirmaydi (401 console noise yo'q)
 * 2. BUG-015 MFA xatolar amalga yo'naltirilgan (expiredChallenge/invalidHint ×4 til; JS handler)
 * 3. BUG-022 Canva status = isCanvaConfigured (CLIENT_ID yolg'iz bo'lsa configured:false)
 * 4. BUG-045 /sessions: brauzersiz so'rov aniq belgilanadi + dublikatlar guruhlanadi
 * 5. BUG-068 (o'zim) /user/settings 'profile is not defined' crash'i yo'q
 * 6. BUG-069 (o'zim) /admin/teachers teacher_application'siz teacher'da 500 (S10 TDZ regress)
 *
 * Run: NODE_ENV=test LOCAL_DB_FILE=/tmp/repro-step11-db.json node scripts/repro-step11.mjs
 */
const PORT = 4598;
const BASE = `http://localhost:${PORT}`;
const PASS = 'parol-2026-x-uzun';

process.env.NODE_ENV = 'test';
process.env.SESSION_SECRET = 'repro-secret-0123456789abcdef0123456789abcdef';
if (!process.env.LOCAL_DB_FILE) process.env.LOCAL_DB_FILE = '/tmp/repro-step11-db.json';
try { (await import('fs')).rmSync(process.env.LOCAL_DB_FILE, { force: true }); } catch (_) {}

const { fb } = await import('../firebase/admin.js');
const { safeKey, hashPass } = await import('../utils/helpers.js');
const T = 'repro_s11_teach', S = 'repro_s11_stud';
for (const [n, role] of [[T, 'teacher'], [S, 'student']]) {
  const k = safeKey(n);
  await fb.set(`users/${k}`, {
    username: n, email: `${n}@test.uz`, email_verified: true,
    role, role_version: 1, password: hashPass(PASS, k), created_at: Date.now(),
  });
}
// BUG-069 senariysi: teacher roli, teacher_application Yo'Q (inline appliedAt yo'q → TDZ yo'lida edi)
// BUG-045 senariysi: student sessiyalari — 2 xil qurilma + dublikat + brauzersiz
{
  const k = safeKey(S), now = Date.now();
  await fb.set(`sessions/${k}`, {
    a: { sessionId: 'sess-a', userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0 Safari/537.36', ipHash: 'aaaa1111bbbb2222', authMethod: 'password', remember: false, createdAt: now - 3600e3, lastActiveAt: now - 60e3, role: 'student' },
    b: { sessionId: 'sess-b', userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0 Safari/537.36', ipHash: 'aaaa1111bbbb2222', authMethod: 'password', remember: false, createdAt: now - 3200e3, lastActiveAt: now - 1800e3, role: 'student' },
    c: { sessionId: 'sess-c', userAgent: '', ipHash: 'cccc3333dddd4444', authMethod: 'password', remember: false, createdAt: now - 7200e3, lastActiveAt: now - 3600e3, role: 'student' },
    d: { sessionId: 'sess-d', userAgent: 'node-fetch/1.0', ipHash: 'cccc3333dddd4444', authMethod: 'password', remember: false, createdAt: now - 8000e3, lastActiveAt: now - 4000e3, role: 'student' },
  });
}
console.log('seed OK');

const { spawn } = await import('node:child_process');
const srv = spawn('node', ['server.js'], {
  env: { ...process.env, PORT: String(PORT), ADMIN_USER: 'repro_admin', ADMIN_PASS: 'repro-pass-123', LOG_LEVEL: 'silent', CANVA_CLIENT_ID: 'fake-id-only' },
  stdio: 'pipe',
});
await new Promise((resolve, reject) => {
  const t = setTimeout(() => reject(new Error('timeout')), 25000);
  const check = async () => { try { const r = await fetch(`${BASE}/health`); if (r.ok) { clearTimeout(t); resolve(); } } catch (_) { setTimeout(check, 400); } };
  setTimeout(check, 1500);
  srv.on('exit', (c) => reject(new Error('exited ' + c)));
});
console.log('server OK');

const { default: Supertest } = await import('supertest');
async function login(path, post, creds) {
  const agent = Supertest.agent(BASE);
  const pg = await agent.get(path);
  const csrf = pg.text.match(/name="_csrf" value="([^"]+)"/)[1];
  await agent.post(post).type('form').send({ ...creds, _csrf: csrf, lang: 'uz' });
  return agent;
}
const TA = await login('/user/login?lang=uz', '/user/login', { mode: 'login', username: T, password: PASS });
const SA = await login('/user/login?lang=uz', '/user/login', { mode: 'login', username: S, password: PASS });
const AD = await login('/admin/login?lang=uz', '/admin/login', { username: 'repro_admin', password: 'repro-pass-123' });
const admDash = await AD.get('/admin/dashboard');
const ADM_CSRF = (admDash.text.match(/__CSRF_TOKEN = '([^']+)'/) || admDash.text.match(/name="_csrf" value="([^"]+)"/) || [])[1] || '';

const fails = [];
const ok = (cond, name) => { console.log(`  ${cond ? '✓' : '✗ FAIL'} ${name}`); if (!cond) fails.push(name); };

// ── 1. BUG-013 ──
{
  const t = await TA.get('/user/security-profile');
  const s = await SA.get('/user/security-profile');
  ok(t.status === 200 && s.status === 200, 'BUG-013 sahifalar 200');
  ok(!t.text.includes('id="assign-pick"'), 'BUG-013 teacher: Assessment picker render QILINMAYDI');
  ok(s.text.includes('id="assign-pick"'), 'BUG-013 student: Assessment picker bor');
  const js = await (await fetch(`${BASE}/js/security-profile.js`)).text();
  ok(js.includes("if (pick)") && js.indexOf('loadAssignments();') > js.indexOf("pick.addEventListener"), 'BUG-013 JS role-aware yuklaydi (pick guard ichida)');
}

// ── 2. BUG-015 ──
{
  const { AUTH_COPY } = await import('../data/auth-i18n.js');
  const langs = ['uz', 'uz-cyrl', 'ru', 'en'];
  ok(langs.every((l) => AUTH_COPY[l].mfaLogin.expiredChallenge && AUTH_COPY[l].mfaLogin.invalidHint), 'BUG-015 i18n kalitlar 4 til');
  const js = await (await fetch(`${BASE}/js/mfa.js`)).text();
  ok(js.includes('no_pending_challenge'), 'BUG-015 JS: expired challenge handler');
  const pg = await fetch(`${BASE}/user/login?lang=uz`); // mfa view login-gated — data attr manbadan tekshiramiz
  const { readFileSync } = await import('fs');
  const view = readFileSync('views/user/mfa.ejs', 'utf8');
  ok(view.includes('data-expired='), 'BUG-015 view data-expired attr');
}

// ── 3. BUG-022 ──
{
  const r = await AD.get('/api/admin/canva/status');
  const j = r.body || {};
  ok(r.status === 200 && j.configured === false, `BUG-022 faqat CLIENT_ID bilan configured:false (${JSON.stringify(j).slice(0, 60)})`);
  const link = await AD.post('/api/admin/canva/link').set('X-CSRF-Token', ADM_CSRF);
  ok(link.status === 400 && String((link.body || {}).error || '').toLowerCase().includes('not configured'), `BUG-022 link ham not configured (${link.status})`);
}

// ── 4. BUG-045 ──
{
  const r = await SA.get('/sessions');
  const h = r.text;
  ok(r.status === 200, 'BUG-045 /sessions 200');
  ok(h.includes('Brauzersiz so'), 'BUG-045 brauzersiz so\'rov aniq belgida');
  ok((h.match(/Shu qurilmadan yana bir sessiya/g) || []).length >= 1, 'BUG-045 dublikat guruh ko\'rsatkichi');
  ok((h.match(/class="sess-sep"/g) || []).length >= 1, 'BUG-045 guruh ajratgichi (separator)');
  ok(!h.includes("Noma'lum qurilma"), 'BUG-045 "Noma\'lum qurilma" yo\'q (bu senariyda)');
}

// ── 5. BUG-068 — settings pageerror 0 (Playwright) ──
{
  const seen = new Map();
  const pg2 = await SA.get('/user/settings');
  (pg2.headers['set-cookie'] || []).forEach((h) => { const [kv] = h.split(';'); const i = kv.indexOf('='); seen.set(kv.slice(0, i), kv.slice(i + 1)); });
  const li = await SA.post('/user/login').type('form').send({ mode: 'login', username: S, password: PASS }); // cookie yangilash shart emas
  const { chromium } = await import('playwright');
  const browser = await chromium.launch();
  const ctx = await browser.newContext();
  await ctx.addCookies([...seen.entries()].map(([name, value]) => ({ name, value, url: BASE })));
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e).slice(0, 100)));
  await page.goto(`${BASE}/user/settings`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(900);
  ok(errs.length === 0, `BUG-068 settings pageerror=0 (${JSON.stringify(errs)})`);
  await browser.close();
}

// ── 6. BUG-069 — teacher_application'siz teacher bilan /admin/teachers 200 ──
{
  const r = await AD.get('/admin/teachers');
  ok(r.status === 200, `BUG-069 /admin/teachers 200 (oldin: TDZ 500) — ${r.status}`);
  ok(r.text.includes('t-stats'), 'BUG-069 statistika strip hali ishlaydi');
}

console.log(`\n_${fails.length ? 'XATO: ' + fails.length : 'HAMMASI OK'} (STEP 11)`);
srv.kill();
process.exit(fails.length ? 1 : 0);
