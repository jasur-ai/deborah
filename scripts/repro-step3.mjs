/**
 * REPRO STEP 3 (debugging branch): admin navigatsiya — server verify
 * ---------------------------------------------------------------
 * Buglar: BUG-006 (4 ta buzilgan nav href), BUG-007 (mavjud bo'lmagan
 * footer-scripts.ejs include → /admin/camera-review 500).
 *
 * Tekshiruvlar (admin sessiyada):
 *   A. /admin/camera-review → 200 (oldin 500 — BUG-007)
 *   B. /admin/ai-question-gen → 200 (nav /admin/question-gen → 404 edi)
 *   C. /admin/presentations → 200 (nav /admin/presentation → 404 edi)
 *   D. /admin/interventions → 200 (nav /admin/intervention → 404 edi)
 *   E. /admin/api-contracts → 200 (nav /admin/contracts → 404 edi)
 *   F. /admin/dashboard HTML'da 4 ta yangi href + /user/camera-pilot (student) → 200
 * Run: NODE_ENV=test LOCAL_DB_FILE=/tmp/repro-step3-db.json node scripts/repro-step3.mjs
 */
import { spawn } from 'node:child_process';

const PORT = 4575;
const BASE = `http://localhost:${PORT}`;
const STAMP = Date.now() % 1000000;
const STUDENT = `repro_s3_${STAMP}`;
const PASS = 'parol-2026-x-uzun';

process.env.NODE_ENV = 'test';
process.env.SESSION_SECRET = 'repro-secret-0123456789abcdef0123456789abcdef';
if (!process.env.LOCAL_DB_FILE) process.env.LOCAL_DB_FILE = '/tmp/repro-step3-db.json';
try { (await import('fs')).rmSync(process.env.LOCAL_DB_FILE, { force: true }); } catch (_) {}
const { fb } = await import('../firebase/admin.js');
const { safeKey, hashPass } = await import('../utils/helpers.js');
await fb.set(`users/${safeKey(STUDENT)}`, {
  username: STUDENT, email: `${STUDENT}@test.uz`, email_verified: true,
  role: 'student', role_version: 1, password: hashPass(PASS, safeKey(STUDENT)), created_at: Date.now(),
});
console.log('seed OK (student)');

const env = {
  ...process.env, PORT: String(PORT),
  SESSION_SECRET: 'repro-secret-0123456789abcdef0123456789abcdef',
  ADMIN_USER: 'repro_admin', ADMIN_PASS: 'repro-pass-123', LOG_LEVEL: 'silent',
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

const { default: Supertest } = await import('supertest');
async function loginForm(path, post, creds) {
  const agent = Supertest.agent(BASE);
  const page = await agent.get(path);
  const csrf = page.text.match(/name="_csrf" value="([^"]+)"/)[1];
  const res = await agent.post(post).type('form').send({ _csrf: csrf, ...creds });
  return { agent, res };
}

const results = [];
const check = (name, ok, extra = '') => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'} — ${name}${extra ? ' (' + extra + ')' : ''}`);
};

// ── Admin sessiya ──
const admin = await loginForm('/admin/login?lang=uz', '/admin/login', {
  username: 'repro_admin', password: 'repro-pass-123', lang: 'uz',
});
const adminLoc = admin.res.headers.location || '';
check('admin login → dashboard', adminLoc.includes('/admin/dashboard'), adminLoc);

const pages = [
  ['A: /admin/camera-review (BUG-007, oldin 500)', '/admin/camera-review'],
  ['B: /admin/ai-question-gen (BUG-006)', '/admin/ai-question-gen'],
  ['C: /admin/presentations (BUG-006)', '/admin/presentations'],
  ['D: /admin/interventions (BUG-006)', '/admin/interventions'],
  ['E: /admin/api-contracts (BUG-006)', '/admin/api-contracts'],
];
for (const [label, path] of pages) {
  const r = await admin.agent.get(path);
  check(label, r.status === 200, `status=${r.status}`);
}

// ── F: dashboard nav href'lari + sidebar ──
const dash = await admin.agent.get('/admin/dashboard');
const html = dash.text;
for (const href of ['/admin/ai-question-gen', '/admin/presentations', '/admin/interventions', '/admin/api-contracts']) {
  check(`F: nav href ${href} HTML'da bor`, html.includes(`href="${href}"`));
}
check('F: eski href /admin/question-gen QOLMAGAN', !html.includes('href="/admin/question-gen"'));
// sidebar'ni ishlatuvchi sahifa (marking sidebar ishlatmaydi — question-gen ishlatadi)
const qg = await admin.agent.get('/admin/ai-question-gen');
check('F: sidebar (question-gen) yangi href bor', qg.text.includes('href="/admin/presentations"'));
check('F: sidebar eski href QOLMAGAN', !qg.text.includes('href="/admin/presentation"'));

// ── G: student /user/camera-pilot (BUG-007 ikkinchi view) ──
const student = await loginForm('/user/login?lang=uz', '/user/login', {
  mode: 'login', lang: 'uz', username: STUDENT, password: PASS,
});
check('student login → panel', (student.res.headers.location || '').includes('/user/panel'), student.res.headers.location || '');
const pilot = await student.agent.get('/user/camera-pilot');
check('G: /user/camera-pilot → 200 (BUG-007)', pilot.status === 200, `status=${pilot.status}`);

const fails = results.filter((r) => !r.ok).length;
console.log(fails ? `\n${fails} ta FAIL ❌` : '\nHAMMASI PASS ✅');
srv.kill();
process.exit(fails ? 1 : 0);
