/**
 * STEP 20 REPRO — assessment qatlami bug'lari isboti (BUG-122..129). Run: node scripts/repro-step20-assess.mjs (PORT 4624)
 * DIQQAT: assessment moduli PostgreSQL talab qiladi (lokal'da yo'q) — service qatlam
 * 'PostgreSQL required' beradi. Repro AUTH/ROL GATE tartibini isbotlaydi: anonim/student
 * so'rov handlerga YETMASLIGI kerak (401/403), staff esa yetadi (400 PostgreSQL required).
 */
const PORT = 4624;
const BASE = `http://localhost:${PORT}`;
process.env.NODE_ENV = 'test';
process.env.SESSION_SECRET = 'repro-secret-0123456789abcdef0123456789abcdef';
if (!process.env.LOCAL_DB_FILE) process.env.LOCAL_DB_FILE = '/tmp/s20repro.json';
try { (await import('fs')).rmSync(process.env.LOCAL_DB_FILE, { force: true }); } catch (_) {}

const { fb } = await import('../firebase/admin.js');
const { safeKey, hashPass } = await import('../utils/helpers.js');
const P = 'parol-2026-x-uzun';
for (const [u, role] of [['repro_s20_t', 'teacher'], ['repro_s20_s', 'student']]) {
  const k = safeKey(u);
  await fb.set(`users/${k}`, { username: u, email: u + '@test.uz', email_verified: true, role, role_version: 1, password: hashPass(P, k), created_at: Date.now() });
}

const { spawn } = await import('node:child_process');
const srv = spawn('node', ['server.js'], {
  env: { ...process.env, PORT: String(PORT), ADMIN_USER: 'repro_admin', ADMIN_PASS: 'repro-pass-123', LOG_LEVEL: 'silent' },
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
let pass = 0, fail = 0;
const check = (ok, name, extra = '') => { console.log(`  ${ok ? '✓' : '✗'} ${name}${extra ? ' (' + extra + ')' : ''}`); ok ? pass++ : fail++; };

async function login(username) {
  const agent = Supertest.agent(BASE);
  const pg0 = await agent.get('/user/login?lang=uz');
  const csrf0 = pg0.text.match(/name="_csrf" value="([^"]+)"/)[1];
  await agent.post('/user/login').type('form').send({ mode: 'login', username, password: P, _csrf: csrf0, lang: 'uz' });
  const pg = await agent.get('/user/panel');
  const m = pg.text.match(/window\.__CSRF_TOKEN = ["']([^"']+)["']/);
  return { agent, csrf: m ? m[1] : '' };
}
const teacher = await login('repro_s20_t');
const student = await login('repro_s20_s');
check(!!teacher.csrf && !!student.csrf, 'teacher + student login');

const PG_ERR = /PostgreSQL/i;

// ── BUG-122: auth umuman yo'q edi ──
{
  const r1 = await fetch(`${BASE}/api/assessments`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title: 'x' }) });
  check([401, 403].includes(r1.status), 'BUG-122 anonim POST /api/assessments → blok (avval handlerga yetib, yozuv yaratilardi)', String(r1.status));
  const r2 = await fetch(`${BASE}/api/assessments`);
  check(r2.status === 401, 'BUG-122 anonim GET list → 401 (avval barcha draftlar o\'qilardi)', String(r2.status));
  const r3 = await fetch(`${BASE}/api/assessment-templates`);
  check(r3.status === 401, 'BUG-122 anonim GET templates → 401', String(r3.status));
  const r4 = await fetch(`${BASE}/api/assessments/5`, { method: 'DELETE' });
  check([401, 403].includes(r4.status), 'BUG-122 anonim DELETE → blok (avval ixtiyoriy draft o\'chirilardi)', String(r4.status));
  const r5 = await fetch(`${BASE}/api/assessments/5/publish`, { method: 'POST' });
  check([401, 403].includes(r5.status), 'BUG-122 anonim publish → blok', String(r5.status));
}

// ── BUG-122/128: student rollari ──
{
  const r1 = await student.agent.get('/api/assessments');
  check(r1.status === 403, 'BUG-128 student GET list → 403 (avval draft+item bank o\'qilardi)', String(r1.status));
  const r2 = await student.agent.get('/api/assessments/7/items');
  check(r2.status === 403, 'BUG-128 student GET items → 403 (javob kalitlari xavfi)', String(r2.status));
  const r3 = await student.agent.post('/api/assessment-templates').set('X-CSRF-Token', student.csrf).send({ name: 'x' });
  check(r3.status === 403, 'BUG-122 student template create → 403', String(r3.status));
}

// ── staff gate o'tadi (handlerga yetadi — PG gating kutiladi) ──
{
  const r1 = await teacher.agent.post('/api/assessments').set('X-CSRF-Token', teacher.csrf).send({ title: 'S20 test', created_by: 'SPOOFED', tenant_id: 'SPOOFED' });
  check(r1.status === 400 && PG_ERR.test(JSON.stringify(r1.body)), 'BUG-126 teacher create handlerga yetdi (created_by/tenant spoof pick\'da tashlanadi)', String(r1.status));
  const r2 = await teacher.agent.get('/api/assessments?limit=99999&offset=-5');
  check(r2.status === 200 && Array.isArray(r2.body), 'BUG-125 teacher list → 200, clamp ichki (graceful empty)', String(r2.status));
}

// ── student preview: rol gate'dan mustasno, lekin include_private yopiq ──
{
  const r1 = await student.agent.get('/api/assessments/3/preview');
  check(r1.status !== 403, 'student preview rol gate\'dan mustasno (200/40x — lekin 403 emas)', String(r1.status));
  const r2 = await student.agent.get('/api/assessments/3/preview?include_private=1');
  check(r2.status === 403, 'BUG-123 student include_private=1 → 403 (avval identity buzilardi: .id yo\'q)', String(r2.status));
  const r3 = await teacher.agent.get('/api/assessments/3/preview?include_private=1');
  check(r3.status === 403, 'BUG-123/124 muallif EMAS (yoki PG yo\'q) → fail-closed 403', String(r3.status));
}

// ── ownership/nested struktura: teacher boshqa id'ni patch qilishi gate'dan keyin ──
{
  const r1 = await teacher.agent.patch('/api/assessments/42').set('X-CSRF-Token', teacher.csrf).send({ title: 'hack' });
  // getAssessment graceful null → ownership gate 404 beradi (PG'da yozuvlar bilan to'liq ishlaydi)
  check(r1.status === 404, 'BUG-124 PATCH ownership gate: mavjud bo\'lmagan/yot assessment → 404 (avval to\'g\'ridan-to\'g\'ri update)', String(r1.status));
  const r2 = await teacher.agent.delete('/api/assessments/42/sections/99').set('X-CSRF-Token', teacher.csrf);
  check(r2.status === 404, 'BUG-127 nested section delete gate (ota-ona tekshiruvi)', String(r2.status));
}

// ── sof helperlar public qolgan (distribution) — regression yo'q ──
{
  const r = await fetch(`${BASE}/api/assessment/distribution?total=10`);
  const j = await r.json();
  check(r.status === 200 && j && j.total === 10, 'sof helper distribution public ishlaydi', String(r.status));
}

srv.kill();
console.log(`\n${fail === 0 ? '_HAMMASI OK (STEP 20)' : 'XATOLAR BOR: ' + fail} — ${pass} ✓ / ${fail} ✗`);
process.exit(fail ? 1 : 0);
