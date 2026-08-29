/**
 * STEP 9 REPRO — README/hujjat mosligi + SEO (BUG-005/017/018/019/047 + 065)
 *
 * 1. BUG-005  /robots.txt → 200, Disallow qoidalari joyida
 * 2. BUG-017/047  README'da o'lik yo'llar yo'q (/user/sessions, /user/onboarding, /user/mfa-setup);
 *    haqiqiy yo'llar ishlaydi: /sessions, /onboarding, /user/mfa/setup
 * 3. BUG-019  README cast bo'limi real yo'llarni ko'rsatadi; /cast/:id/director SEED bilan 200
 * 4. BUG-018  README push shartli (VAPID env) — hujjatda 'push_disabled' eslatmasi bor
 * 5. BUG-065  README §5 admin sahifa nomlari real: interventions/ai-question-gen/presentations 200;
 *    API-only modullar sahifa deb da'vo qilinmaydi
 *
 * Run: NODE_ENV=test LOCAL_DB_FILE=/tmp/repro-step9-db.json node scripts/repro-step9.mjs
 */
const PORT = 4591;
const BASE = `http://localhost:${PORT}`;
const TEACHER = 'repro_s9_teach';
const PASS = 'parol-2026-x-uzun';

process.env.NODE_ENV = 'test';
process.env.SESSION_SECRET = 'repro-secret-0123456789abcdef0123456789abcdef';
if (!process.env.LOCAL_DB_FILE) process.env.LOCAL_DB_FILE = '/tmp/repro-step9-db.json';
try { (await import('fs')).rmSync(process.env.LOCAL_DB_FILE, { force: true }); } catch (_) {}

const { fb } = await import('../firebase/admin.js');
const { safeKey, hashPass } = await import('../utils/helpers.js');
const tk = safeKey(TEACHER);
await fb.set(`users/${tk}`, {
  username: TEACHER, email: `${TEACHER}@test.uz`, email_verified: true,
  role: 'teacher', role_version: 1, password: hashPass(PASS, tk), created_at: Date.now(),
});
// Cast sessiya seed (S6 retsepti)
const { createSession } = await import('../services/cast/session-store.js');
const SID = 's9cast' + Date.now().toString(36);
await createSession({
  sessionId: SID, joinCode: 'S9CAST',
  meta: { title: 'STEP9 audit darsi' },
  config: { localization: { locale: 'uz' } },
  state: { phase: 'lobby', revision: 1 },
  privateQuestions: [], publicQuestions: [],
});
await fb.set(`cast_sessions/${SID}/roles/${encodeURIComponent('user:' + tk)}`, { actorId: 'user:' + tk, role: 'owner' });
console.log('seed OK (teacher + cast)');

const { spawn } = await import('node:child_process');
const srv = spawn('node', ['server.js'], {
  env: { ...process.env, PORT: String(PORT), ADMIN_USER: 'repro_admin', ADMIN_PASS: 'repro-pass-123', LOG_LEVEL: 'silent' },
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
async function login(path, post, creds) {
  const agent = Supertest.agent(BASE);
  const pg = await agent.get(path);
  const csrf = pg.text.match(/name="_csrf" value="([^"]+)"/)[1];
  await agent.post(post).type('form').send({ ...creds, _csrf: csrf, lang: 'uz' });
  return agent;
}
const T = await login('/user/login?lang=uz', '/user/login', { mode: 'login', username: TEACHER, password: PASS });
const A = await login('/admin/login?lang=uz', '/admin/login', { username: 'repro_admin', password: 'repro-pass-123' });
console.log('login OK');

const fails = [];
const ok = (cond, name) => { console.log(`  ${cond ? '✓' : '✗ FAIL'} ${name}`); if (!cond) fails.push(name); };

// ── 1. robots.txt (BUG-005) ──
{
  const r = await fetch(`${BASE}/robots.txt`);
  const txt = await r.text();
  ok(r.status === 200, 'BUG-005 /robots.txt → 200');
  ok(txt.includes('User-agent: *') && txt.includes('Disallow: /admin/'), 'BUG-005 Disallow /admin/ bor');
  ok(txt.includes('Disallow: /api/'), 'BUG-005 Disallow /api/ bor');
}

// ── 2. README o'lik yo'llar (BUG-017/047) + haqiqiy sahifalar ──
{
  const { readFileSync } = await import('fs');
  const rm = readFileSync('README.md', 'utf8');
  ok(!/\/user\/sessions/.test(rm), 'BUG-047 README\'da /user/sessions yo\'q');
  ok(!/\/user\/onboarding/.test(rm), 'BUG-017 README\'da /user/onboarding yo\'q');
  ok(!/\/user\/mfa-setup/.test(rm), 'BUG-017 README\'da /user/mfa-setup yo\'q');
  ok(rm.includes('`/sessions`') && rm.includes('`/onboarding`') && rm.includes('/user/mfa/setup'), 'README real yo\'llarni ko\'rsatadi');
  for (const p of ['/sessions', '/onboarding', '/user/mfa/setup', '/user/panel', '/user/notifications', '/user/settings', '/user/security-profile', '/user/email-change', '/user/assignments', '/user/portfolio']) {
    const r = await T.get(p);
    const want = p === '/user/mfa/setup' ? [200, 302] : [200]; // mfa/setup — transitional redirect
    ok(want.includes(r.status), `haqiqiy sahifa ${p} → ${want.join('/')} (${r.status})`);
  }
  const dead = await T.get('/user/sessions');
  ok(dead.status === 404, 'eski /user/sessions → 404 (hujjatda ham yo\'q)');
}

// ── 3. Cast yo'llari (BUG-019) ──
{
  const { readFileSync } = await import('fs');
  const rm = readFileSync('README.md', 'utf8');
  ok(rm.includes('/cast/:sessionId/director'), 'BUG-019 README cast real yo\'l patterni');
  ok(rm.includes('/play?code='), 'BUG-019 README talaba kirish /play?code=');
  const d = await T.get(`/cast/${SID}/director`);
  ok(d.status === 200, `BUG-019 /cast/:id/director (seed) → 200 (${d.status})`);
  const q = await fetch(`${BASE}/cast/qr`);
  ok(q.status !== 404, 'BUG-019 /cast/qr mavjud');
  const old = await T.get('/cast/director');
  ok(old.status === 404, 'BUG-019 /cast/director (sessiyasiz) → 404 — README da\'vo qilmaydi');
}

// ── 4. Push shartli hujjat (BUG-018) ──
{
  const { readFileSync } = await import('fs');
  const rm = readFileSync('README.md', 'utf8');
  ok(rm.includes('VAPID_PUBLIC_KEY') && rm.includes('push_disabled'), 'BUG-018 README push sharti hujjatlashtirilgan');
  const r = await T.get('/api/push/vapid-key');
  ok([200, 400, 401].includes(r.status), `BUG-018 /api/push/vapid-key javob beradi (${r.status})`);
}

// ── 5. Admin sahifa nomlari (BUG-065) ──
{
  const { readFileSync } = await import('fs');
  const rm = readFileSync('README.md', 'utf8');
  const d5 = rm.split('## 5')[1]?.split('## 6')[0] || '';
  ok(!/`intervention`/.test(d5) && !/`question-gen`/.test(d5) && !/`presentation`/.test(d5), 'BUG-065 noto\'g\'ri nomlar ( birlik) yo\'q');
  ok(!/`item-bank`, `rubric`/.test(d5), 'BUG-065 API-only modullar sahifa ro\'yxatida emas');
  for (const p of ['/admin/interventions', '/admin/ai-question-gen', '/admin/presentations', '/admin/dashboard', '/admin/users', '/admin/teachers', '/admin/vip', '/admin/audit', '/admin/email-cost']) {
    const r = await A.get(p);
    ok(r.status === 200, `BUG-065 ${p} → 200`);
  }
  for (const p of ['/admin/intervention', '/admin/question-gen', '/admin/presentation', '/admin/item-bank', '/admin/rubric']) {
    const r = await A.get(p);
    ok(r.status === 404, `eski noto\'g\'ri ${p} → 404 (README da\'vo qilmaydi)`);
  }
}

console.log(`\n_${fails.length ? 'XATO: ' + fails.length : 'HAMMASI OK'} (STEP 9)`);
srv.kill();
process.exit(fails.length ? 1 : 0);
