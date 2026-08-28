/**
 * STEP 11 — konsol/xato ovchasi (o'zim topilmalar uchun): sahifalarda pageerror,
 * console.error, failed fetch (4xx/5xx) yig'adi.
 * Run: NODE_ENV=test LOCAL_DB_FILE=/tmp/s11scan.json node scripts/scan-console.mjs
 */
const PORT = 4596;
const BASE = `http://localhost:${PORT}`;
const TEACHER = 'repro_s11_t';
const PASS = 'parol-2026-x-uzun';

process.env.NODE_ENV = 'test';
process.env.SESSION_SECRET = 'repro-secret-0123456789abcdef0123456789abcdef';
if (!process.env.LOCAL_DB_FILE) process.env.LOCAL_DB_FILE = '/tmp/s11scan.json';
try { (await import('fs')).rmSync(process.env.LOCAL_DB_FILE, { force: true }); } catch (_) {}

const { fb } = await import('../firebase/admin.js');
const { safeKey, hashPass } = await import('../utils/helpers.js');
const tk = safeKey(TEACHER);
await fb.set(`users/${tk}`, {
  username: TEACHER, email: `${TEACHER}@test.uz`, email_verified: true,
  role: 'teacher', role_version: 1, password: hashPass(PASS, tk), created_at: Date.now(),
});

const { spawn } = await import('node:child_process');
const srv = spawn('node', ['server.js'], {
  env: { ...process.env, PORT: String(PORT), ADMIN_USER: 'repro_admin', ADMIN_PASS: 'repro-pass-123', LOG_LEVEL: 'silent' },
  stdio: 'pipe',
});
srv.stdout.on('data', (d) => { const s = String(d); if (/error|Error|500/.test(s)) process.stdout.write('[SRV] ' + s.slice(0, 400)); });
srv.stderr.on('data', (d) => process.stdout.write('[SRV-ERR] ' + String(d).slice(0, 400)));
await new Promise((resolve, reject) => {
  const t = setTimeout(() => reject(new Error('timeout')), 25000);
  const check = async () => { try { const r = await fetch(`${BASE}/health`); if (r.ok) { clearTimeout(t); resolve(); } } catch (_) { setTimeout(check, 400); } };
  setTimeout(check, 1500);
  srv.on('exit', (c) => reject(new Error('exited ' + c)));
});

const { default: Supertest } = await import('supertest');
async function login(path, post, creds) {
  const agent = Supertest.agent(BASE);
  const seen = new Map();
  const track = (r) => (r.headers['set-cookie'] || []).forEach((h) => { const [kv] = h.split(';'); const i = kv.indexOf('='); if (i > 0) seen.set(kv.slice(0, i), kv.slice(i + 1)); });
  const pg = await agent.get(path); track(pg);
  const csrf = pg.text.match(/name="_csrf" value="([^"]+)"/)[1];
  const li = await agent.post(post).type('form').send({ ...creds, _csrf: csrf, lang: 'uz' }); track(li);
  return { agent, seen };
}
const T = await login('/user/login?lang=uz', '/user/login', { mode: 'login', username: TEACHER, password: PASS });
const A = await login('/admin/login?lang=uz', '/admin/login', { username: 'repro_admin', password: 'repro-pass-123' });
{
  const d = await T.agent.get('/user/panel'); d.headers['set-cookie']?.forEach((h) => { const [kv] = h.split(';'); const i = kv.indexOf('='); T.seen.set(kv.slice(0, i), kv.slice(i + 1)); });
  const d2 = await A.agent.get('/admin/dashboard'); d2.headers['set-cookie']?.forEach((h) => { const [kv] = h.split(';'); const i = kv.indexOf('='); A.seen.set(kv.slice(0, i), kv.slice(i + 1)); });
}

const { chromium } = await import('playwright');
const browser = await chromium.launch();
async function mk(cookies) {
  const ctx = await browser.newContext();
  await ctx.addCookies([...cookies.entries()].map(([name, value]) => ({ name, value, url: BASE })));
  return ctx;
}
const tctx = await mk(T.seen), actx = await mk(A.seen);

async function scan(ctx, path, label) {
  const page = await ctx.newPage();
  const errs = [], cons = [], bad = [];
  page.on('pageerror', (e) => errs.push(String(e).slice(0, 140)));
  page.on('console', (m) => { if (m.type() === 'error') cons.push(m.text().slice(0, 140)); });
  page.on('response', (r) => { if (r.status() >= 400 && !r.url().includes('/api/metrics')) bad.push(r.status() + ' ' + r.url().replace(BASE, '')); });
  await page.goto(BASE + path, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1200);
  const out = [];
  if (errs.length) out.push('PAGEERROR: ' + JSON.stringify(errs));
  if (cons.length) out.push('CONSOLE: ' + JSON.stringify(cons.slice(0, 4)));
  if (bad.length) out.push('HTTP: ' + JSON.stringify(bad.slice(0, 6)));
  console.log(`\n[${label}] ${path}${out.length ? '\n  ' + out.join('\n  ') : ' — toza'}`);
  await page.close();
}

const U = ['/user/panel', '/user/security-profile', '/user/create-test', '/user/test-arena', '/sessions', '/user/notifications', '/user/settings', '/teacher'];
const AD = ['/admin/dashboard', '/admin/canva', '/admin/teachers', '/admin/observability'];
for (const p of U) await scan(tctx, p, 'teacher');
for (const p of AD) await scan(actx, p, 'admin');

await browser.close();
srv.kill();
process.exit(0);
