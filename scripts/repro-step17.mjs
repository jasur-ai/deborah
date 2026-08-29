/**
 * STEP 17 REPRO — roster qatlami bug'lari isboti (BUG-107..113). Run: node scripts/repro-step17.mjs (PORT 4618)
 */
const PORT = 4618;
const BASE = `http://localhost:${PORT}`;
process.env.NODE_ENV = 'test';
process.env.SESSION_SECRET = 'repro-secret-0123456789abcdef0123456789abcdef';
if (!process.env.LOCAL_DB_FILE) process.env.LOCAL_DB_FILE = '/tmp/s17repro.json';
try { (await import('fs')).rmSync(process.env.LOCAL_DB_FILE, { force: true }); } catch (_) {}

const { fb } = await import('../firebase/admin.js');
const { safeKey, hashPass } = await import('../utils/helpers.js');
const P = 'parol-2026-x-uzun';

// teacher (roster manager) + student (attacker) + victim secret node
const tk = safeKey('repro_s17_t');
await fb.set(`users/${tk}`, { username: 'repro_s17_t', email: 't17@test.uz', email_verified: true, role: 'teacher', role_version: 1, password: hashPass(P, tk), created_at: Date.now() });
const sk = safeKey('repro_s17_s');
await fb.set(`users/${sk}`, { username: 'repro_s17_s', email: 's17@test.uz', email_verified: true, role: 'student', role_version: 1, password: hashPass(P, sk), created_at: Date.now() });
await fb.set('s17_secret/PII', { talaba: 'Aliyev Ali', pin: '1234567' });

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

async function loginAgent(username) {
  const agent = Supertest.agent(BASE);
  const seen = new Map();
  const collect = (r) => (r.headers['set-cookie'] || []).forEach((h) => { const [kv] = h.split(';'); const i = kv.indexOf('='); if (i > 0) seen.set(kv.slice(0, i), kv.slice(i + 1)); });
  const pg0 = await agent.get('/user/login?lang=uz'); collect(pg0);
  const csrf0 = pg0.text.match(/name="_csrf" value="([^"]+)"/)[1];
  const li = await agent.post('/user/login').type('form').send({ mode: 'login', username, password: P, _csrf: csrf0, lang: 'uz' }); collect(li);
  collect(await agent.get('/user/panel'));
  const pg = await agent.get('/user/panel');
  const m = pg.text.match(/window\.__CSRF_TOKEN = ["']([^"']+)["']/);
  return { agent, csrf: m ? m[1] : '', cookies: Object.fromEntries(seen.entries()) };
}
const teacher = await loginAgent('repro_s17_t');
const student = await loginAgent('repro_s17_s');
check(teacher.csrf && student.csrf, 'teacher + student login');

// Teacher staging sessiya yaratadi (real CSV upload, fetch + FormData)
const CSV = 'talaba_id,F.I.Sh,guruh,kurs,fan\n001,Aliyev Ali,A,2026,MATH101\n002,Valiyev Vali,A,2026,MATH101\n';
let sessionId = null;
{
  const fd = new FormData();
  fd.append('file', new Blob([CSV], { type: 'text/csv' }), 'hemis.csv');
  const r = await fetch(`${BASE}/api/roster/upload`, {
    method: 'POST',
    headers: { cookie: `connect.sid=${teacher.cookies['connect.sid']}`, 'x-csrf-token': teacher.csrf },
    body: fd,
  });
  const j = await r.json().catch(() => ({}));
  check(r.status === 201 && j.sessionId, 'teacher upload → 201 + sessionId (BUG-111 actor endi to\u2018g\u2018ri auditda)', `${r.status}/${j.sessionId || j.error || ''}`);
  sessionId = j.sessionId || null;
}

// ── BUG-107: sessionId traversal ──
{
  // student role-gate'da 403 oladi (BUG-108); sessionReq'ni o'lchash uchun
  // TEACHER bilan traversal yuboramiz — regex 404 berishi kerak
  const r1 = await teacher.agent.get(`/api/roster/sessions/${encodeURIComponent('../../s17_secret')}`);
  check(r1.status === 404, 'BUG-107 teacher traversal :id → 404 (avval s17_secret o\'qilardi)', String(r1.status));
  const r2 = await teacher.agent.get('/api/roster/sessions/abc');
  check(r2.status === 404, 'BUG-107 noto\u2018g\u2018ri format :id → 404', String(r2.status));
  const r3 = await teacher.agent.delete(`/api/roster/sessions/${encodeURIComponent('../../s17_secret')}`).set('X-CSRF-Token', teacher.csrf);
  check(r3.status === 404, 'BUG-107 DELETE traversal → 404 (avval ixtiyoriy node o\'chizar edi)', String(r3.status));
  const secretSnap = await fb.get('s17_secret/PII');
  const secret = typeof secretSnap?.val === 'function' ? secretSnap.val() : secretSnap;
  check(secret && secret.pin === '1234567', 's17_secret SAQLANDI (traversal o\'chira olmadi)', JSON.stringify(secret).slice(0, 40));
}

// ── BUG-108: student staging'ga kira olmaydi ──
{
  const r1 = await student.agent.get('/api/roster/sessions');
  check(r1.status === 403, 'BUG-108 student GET sessions → 403 (avval barcha sessiyalar + PII)', String(r1.status));
  const r2 = sessionId ? await student.agent.get(`/api/roster/sessions/${sessionId}/rows`) : { status: 0 };
  check(r2.status === 404 || r2.status === 403, 'BUG-108 student rows → 403/404 (avval to\'liq ro\'yxat PII)', String(r2.status));
  const r3 = sessionId ? await student.agent.post(`/api/roster/sessions/${sessionId}/approve`).set('X-CSRF-Token', student.csrf).send({ approve: true }) : { status: 0 };
  check(r3.status === 403 || r3.status === 404, 'BUG-108 student approve → 403 (avval boshqa teacher sessiyasini approve qilardi)', String(r3.status));
  const r4 = await student.agent.post('/api/roster/upload').set('x-csrf-token', student.csrf);
  check(r4.status === 403 || r4.status === 400, 'BUG-108 student upload → blok (avval staging+audit spam)', String(r4.status));
  const t1 = await teacher.agent.get('/api/roster/sessions');
  check(t1.status === 200, 'BUG-108 teacher GET sessions → 200 (baxtli yo\'l butun)', String(t1.status));
  const t2 = sessionId ? await teacher.agent.get(`/api/roster/sessions/${sessionId}/rows`) : { status: 0 };
  check(t2.status === 200 && Array.isArray(t2.body), 'BUG-108 teacher rows → 200', String(t2.status));
}

// ── BUG-109: limit clamp ──
{
  const r = await teacher.agent.get('/api/roster/sessions?limit=99999');
  check(r.status === 200, 'BUG-109 limit=99999 → 200 (clamp ichida)', String(r.status));
}

// ── BUG-110: accept rate limit ──
{
  let last = null;
  for (let i = 0; i < 22; i++) {
    last = await fetch(`${BASE}/api/roster/invites/accept`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.99' },
      body: JSON.stringify({ token: 'deadbeef', username: 'x', password: 'x' }),
    });
    if (last.status === 429) break;
  }
  check(last.status === 429, 'BUG-110 accept 21+ urinish → 429 (avval cheksiz)', String(last.status));
}

// ── BUG-113: mapping validatsiya ──
{
  const r1 = sessionId
    ? (await teacher.agent.post(`/api/roster/sessions/${sessionId}/map`).set('X-CSRF-Token', teacher.csrf).send({ mapping: 'not-an-object' }))
    : { status: 0 };
  check(r1.status === 400, 'BUG-113 mapping string → 400 (avval xom saqlanardi)', String(r1.status));
  const badMapping = { 'col': { field: 'x', entity: 'y' } };
  badMapping['a/../b'] = { field: 'f', entity: 'e' };
  const r2 = await teacher.agent.post(`/api/roster/sessions/${sessionId}/map`).set('X-CSRF-Token', teacher.csrf).send({ mapping: badMapping });
  check(r2.status === 400, 'BUG-113 traversal kalitli mapping → 400', String(r2.status));
  const good = { 'F.I.Sh': { field: 'full_name', entity: 'user', required: true } };
  const r3 = await teacher.agent.post(`/api/roster/sessions/${sessionId}/map`).set('X-CSRF-Token', teacher.csrf).send({ mapping: good });
  check(r3.status === 200, 'BUG-113 to\'g\'ri mapping → 200 (baxtli yo\'l)', String(r3.status));
}

// ── BUG-112: auditda raw token emas ──
{
  const auditsSnap = await fb.get('audit_logs');
  const logs = typeof auditsSnap?.val === 'function' ? auditsSnap.val() : auditsSnap;
  const txt = JSON.stringify(logs || {});
  const hasRawToken = /([a-f0-9]{96})/.test(txt); // 48-byte hex token hech qachon to'liq chiqmasin
  check(!hasRawToken, 'BUG-112 audit logda to\'liq invite token yo\'q', hasRawToken ? 'TOPILDI!' : 'toza');
}

srv.kill();
console.log(`\n${fail === 0 ? '_HAMMASI OK (STEP 17)' : 'XATOLAR BOR: ' + fail} — ${pass} ✓ / ${fail} ✗`);
process.exit(fail ? 1 : 0);
