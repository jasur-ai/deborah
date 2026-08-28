/**
 * STEP 10 REPRO — feature-darajadagi talablar: qaror + minimal real yechim
 *
 * 1. BUG-026  resource-reco end-user UI — QAROR: provider kalitlari yo'q = "not configured";
 *    bo'sh qobiq = fake feature — qurilmaydi. Admin API requireAdmin qoladi (buxgalter hisobi).
 * 2. BUG-027a approve/reject admin'da qoladi (governance); teacher O'Z arizasini ko'radi
 *    (/user/teacher-approval — mavjudligi tekshiriladi)
 * 3. BUG-027b /admin/teachers — haqiqiy statistika: status sonlari + 14 kunlik trend + o'rtacha
 *    qaror vaqti (seed: 3 ta ariza turli holat/vaqt bilan → raqamlar tekshiriladi)
 * 4. BUG-029  /admin/index — "Barcha funksiyalar" bir ko'rinish (grid + qidiruv), sidebar'da link,
 *    katalog dashboard sidebar'dan avto-parse (37+ havola, hammasi 200)
 * 5. BUG-030  teacher test o'chirish — reload YO'Q (qator joyida o'chadi; JS manbada
 *    location.reload delete-shoxida yo'q)
 *
 * Run: NODE_ENV=test LOCAL_DB_FILE=/tmp/repro-step10-db.json node scripts/repro-step10.mjs
 */
const PORT = 4594;
const BASE = `http://localhost:${PORT}`;
const PASS = 'parol-2026-x-uzun';

process.env.NODE_ENV = 'test';
process.env.SESSION_SECRET = 'repro-secret-0123456789abcdef0123456789abcdef';
if (!process.env.LOCAL_DB_FILE) process.env.LOCAL_DB_FILE = '/tmp/repro-step10-db.json';
try { (await import('fs')).rmSync(process.env.LOCAL_DB_FILE, { force: true }); } catch (_) {}

// Seed: teacher arizalari (turli holat/vaqt) + oddiy teacher
const { fb } = await import('../firebase/admin.js');
const { safeKey, hashPass } = await import('../utils/helpers.js');
const DAY = 86400000;
const now = Date.now();
const seedUsers = [
  { n: 'repro_s10_teach', role: 'teacher', applied: now - 5 * DAY, decided: now - 4 * DAY },       // approved 24h
  { n: 'repro_s10_pend1', role: 'teacher_pending', applied: now - 1 * DAY, decided: 0 },
  { n: 'repro_s10_pend2', role: 'teacher_pending', applied: now - 2 * DAY, decided: 0 },
  { n: 'repro_s10_rej1', role: 'teacher_rejected', applied: now - 6 * DAY, decided: now - 5 * DAY }, // rejected 24h
];
for (const s of seedUsers) {
  const k = safeKey(s.n);
  await fb.set(`users/${k}`, {
    username: s.n, email: `${s.n}@test.uz`, email_verified: true,
    role: s.role, role_version: 1, password: hashPass(PASS, k), created_at: s.applied,
    teacher_application: { appliedAt: s.applied, subject: 'Matematika', experience: '5-yil' },
    ...(s.decided ? { teacher_decision_at: s.decided, teacher_decision_by: 'repro_admin' } : {}),
  });
}
// oddiy o'qituvchi (027a — o'z arizasi yo'q, tasdiqlangan)
{
  const k = safeKey('repro_s10_teach');
  await fb.update(`users/${k}`, { role: 'teacher' });
}
console.log('seed OK (4 ariza + teacher)');

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
const A = await login('/admin/login?lang=uz', '/admin/login', { username: 'repro_admin', password: 'repro-pass-123' });
console.log('admin login OK');

const fails = [];
const ok = (cond, name) => { console.log(`  ${cond ? '✓' : '✗ FAIL'} ${name}`); if (!cond) fails.push(name); };

// ── 1. BUG-026: qaror — admin API qoladi, end-user yo'q ──
{
  const r1 = await A.get('/api/admin/resource-reco/meta');
  ok(r1.status === 200, 'BUG-026 admin resource-reco meta 200 (admin konsol qoladi)');
  const anon = await fetch(`${BASE}/api/admin/resource-reco/meta`);
  ok([401, 403, 302].includes(anon.status), 'BUG-026 anonim uchun yopiq (requireAdmin)');
  const { readFileSync } = await import('fs');
  const rm = readFileSync('README.md', 'utf8');
  ok(rm.includes('not configured') && rm.includes('BUG-026'), 'BUG-026 README qarori hujjatlangan');
}

// ── 2. BUG-027a: teacher o'z arizasi sahifasi mavjud; approve/reject admin ──
{
  const P = await login('/user/login?lang=uz', '/user/login', { mode: 'login', username: 'repro_s10_pend1', password: PASS });
  const appr = await P.get('/user/teacher-approval');
  ok(appr.status === 200, 'BUG-027a /user/teacher-approval (o\'z arizasi) 200');
  const appr2 = await P.get('/admin/teachers');
  ok(appr2.status === 403 || appr2.status === 302, 'BUG-027a approve/reject teacher uchun yopiq (governance admin\'da)');
}

// ── 3. BUG-027b: statistika raqamlari (seed: 2 pending/1 approved/1 rejected; avg 24h) ──
{
  const r = await A.get('/admin/teachers');
  const h = r.text;
  ok(r.status === 200, '/admin/teachers 200');
  ok(h.includes('t-stats'), 'BUG-027b stats strip render');
  ok(h.includes('Arizalar statistikasi'), 'BUG-027b aria label bor');
  const pend = h.match(/t-stat-pend">\s*(\d+)/)?.[1];
  const apprN = h.match(/t-stat-ok">\s*(\d+)/)?.[1];
  const rej = h.match(/t-stat-no">\s*(\d+)/)?.[1];
  ok(pend === '2', `BUG-027b kutilmoqda=2 (oldi: ${pend})`);
  ok(apprN === '1', `BUG-027b tasdiqlangan=1 (oldi: ${apprN})`);
  ok(rej === '1', `BUG-027b rad=1 (oldi: ${rej})`);
  ok(h.includes('24 soat'), 'BUG-027b o\'rtacha qaror 24 soat');
  ok((h.match(/class="t-trend-d" title=/g) || []).length === 14, 'BUG-027b 14 kunlik trend (render)');
}

// ── 4. BUG-029: Barcha funksiyalar bir ko'rinish ──
{
  const r = await A.get('/admin/index');
  const h = r.text;
  ok(r.status === 200, 'BUG-029 /admin/index 200');
  ok(h.includes('Barcha funksiyalar'), 'BUG-029 sarlavha');
  const n = (h.match(/class="ai-card"/g) || []).length;
  ok(n >= 7, `BUG-029 guruh kartalar (${n} ta ≥7)`);
  const links = [...h.matchAll(/<a href="(\/[a-z0-9/-]+)" data-name=/g)].map((m) => m[1]);
  ok(links.length >= 36, `BUG-029 katalog havolalar (${links.length} ta ≥36)`);
  ok(h.includes('id="ai-q"') && h.includes('ai-empty'), 'BUG-029 qidiruv + bo\'sh holat');
  const dash = await A.get('/admin/dashboard');
  ok(dash.text.includes('href="/admin/index"'), 'BUG-029 sidebar\'da "Barcha funksiyalar" link');
  const anon = await fetch(`${BASE}/admin/index`, { redirect: 'manual' });
  ok([301, 302, 403].includes(anon.status), 'BUG-029 /admin/index anonim yopiq');
  // katalogdagi har bir havola 200
  const uniq = [...new Set(links)];
  const bad = [];
  for (const l of uniq) {
    const lr = await A.get(l);
    if (lr.status !== 200) bad.push(l + ':' + lr.status);
  }
  ok(bad.length === 0, `BUG-029 katalog havolalari hammasi 200 (${JSON.stringify(bad)})`);
}

// ── 5. BUG-030: reload'siz o'chirish ──
{
  const { readFileSync } = await import('fs');
  const js = readFileSync('public/js/workspace-library.js', 'utf8');
  const delBlock = js.slice(js.indexOf("act === 'delete'"), js.indexOf("act === 'delete'") + 1400);
  ok(!delBlock.includes('location.reload'), 'BUG-030 delete shoxida reload yo\'q');
  ok(delBlock.includes('rows.splice') && delBlock.includes('applyFilters()'), 'BUG-030 qator joyida o\'chadi + filtrlar qayta hisoblanadi');
  ok(js.indexOf('rows.splice') > js.indexOf("act === 'delete'"), 'BUG-030 joyida (delete handlerda)');
  // API hali ham ishlaydi (brauzer fetch-patch CSRF qo'shadi)
  const P = await login('/user/login?lang=uz', '/user/login', { mode: 'login', username: 'repro_s10_teach', password: PASS });
  await fb.set(`users/${safeKey('repro_s10_teach')}/tests/s10probe`, { name: 'probe', questions: [], created_at: Date.now() });
  const panel = await P.get('/user/panel');
  const tok = (panel.text.match(/window\.__CSRF_TOKEN = "([^"]+)"/) || panel.text.match(/window\.__CSRF_TOKEN = '([^']+)'/) || [])[1];
  const del = await P.post('/user/api/tests/delete').set('Content-Type', 'application/json').set('X-CSRF-Token', tok || '').send({ key: 's10probe' });
  ok(del.status === 200 && del.body?.success === true, 'BUG-030 delete API success (CSRF bilan)');
}

console.log(`\n_${fails.length ? 'XATO: ' + fails.length : 'HAMMASI OK'} (STEP 10)`);
srv.kill();
process.exit(fails.length ? 1 : 0);
