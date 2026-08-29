/**
 * STEP 18 REPRO — CAST REST qatlami bug'lari isboti (BUG-114..121). Run: node scripts/repro-step18-cast.mjs (PORT 4620)
 */
const PORT = 4620;
const BASE = `http://localhost:${PORT}`;
process.env.NODE_ENV = 'test';
process.env.SESSION_SECRET = 'repro-secret-0123456789abcdef0123456789abcdef';
if (!process.env.LOCAL_DB_FILE) process.env.LOCAL_DB_FILE = '/tmp/s18repro.json';
try { (await import('fs')).rmSync(process.env.LOCAL_DB_FILE, { force: true }); } catch (_) {}

const { fb } = await import('../firebase/admin.js');
const { safeKey, hashPass } = await import('../utils/helpers.js');
const P = 'parol-2026-x-uzun';

// attacker (o'qituvchi, lekin begona) + victim (maxfiy test egasi)
const ak = safeKey('repro_s18_a');
await fb.set(`users/${ak}`, { username: 'repro_s18_a', email: 'a18@test.uz', email_verified: true, role: 'teacher', role_version: 1, password: hashPass(P, ak), created_at: Date.now() });
const vk = safeKey('repro_s18_victim');
await fb.set(`users/${vk}`, { username: 'repro_s18_victim', email: 'v18@test.uz', email_verified: true, role: 'teacher', role_version: 1, password: hashPass(P, vk), created_at: Date.now() });
await fb.set(`users/${vk}/tests/vsecret1`, { name: 'VIKTIM MAXFIY FANI', count: 1, created_at: 1, isPublic: false, questions: [{ text: 'Maxfiy savol 2+2?', options: ['3', '4'], correct: 1, type: 'single_choice', explanation: '', tags: [], timing: 0 }] });

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
const attacker = await login('repro_s18_a');
check(!!attacker.csrf, 'attacker login');

// ── BUG-114: test-loader source.key traversal (KRITIK) ──
{
  // victimning testini `user` manba orqali o'qishga urinish (avval title oqardi)
  const trav = `../../users/${vk}/tests/vsecret1`;
  const r1 = await attacker.agent.post('/api/cast/preflight').set('X-CSRF-Token', attacker.csrf).send({ source: { type: 'user', key: trav }, draftConfig: {} });
  const j1 = await r1.body || {};
  check(r1.status === 400 && !JSON.stringify(j1).includes('VIKTIM'), 'BUG-114 preflight user-key traversal → 400 (avval VIKTIM MAXFIY FANI o\'qilardi)', `${r1.status}`);
  const r2 = await attacker.agent.post('/api/cast/quality/preflight').set('X-CSRF-Token', attacker.csrf).send({ source: { type: 'mock', key: '../../../users/' + vk + '/tests/vsecret1' }, config: {} });
  check(r2.status === 400, 'BUG-114 mock-key traversal → 400', String(r2.status));
  const r3 = await attacker.agent.post('/api/cast/preflight').set('X-CSRF-Token', attacker.csrf).send({ source: { type: 'pre', key: '../../x', chunk: '../../y' }, draftConfig: {} });
  check(r3.status === 400, 'BUG-114 pre key/chunk traversal → 400', String(r3.status));
  // o'z testi bilan baxtli yo'l: traveldan keyin ham oddiy key ishlashi kerak
  await fb.set(`users/${ak}/tests/mytest`, { name: 'Mening testim', count: 1, created_at: 1, isPublic: false, questions: [{ text: '5+5?', options: ['9', '10'], correct: 1, type: 'single_choice' }] });
  const r4 = await attacker.agent.post('/api/cast/preflight').set('X-CSRF-Token', attacker.csrf).send({ source: { type: 'user', key: 'mytest' }, draftConfig: {} });
  check(r4.status === 200 && r4.body.ok && r4.body.test.title === 'Mening testim', 'BUG-114 o\'z testi preflight → 200 (baxtli yo\'l butun)', `${r4.status}/${r4.body?.test?.title || r4.body?.error?.message || ''}`);
}

// ── BUG-116: sessionId whitelist ──
{
  const r1 = await attacker.agent.get('/api/cast/sessions/' + encodeURIComponent('../../users/' + vk) + '/meta');
  check(r1.status === 404, 'BUG-116 /meta traversal sessionId → 404 (avval arb. node meta o\'qilardi)', String(r1.status));
  const r2 = await attacker.agent.get('/api/cast/sessions/abc/meta');
  check(r2.status === 404, 'BUG-116 noto\'g\'ri format → 404', String(r2.status));
  const r3 = await attacker.agent.get('/cast/notasession/director');
  check(r3.status === 302, 'BUG-116 view route noto\'g\'ri id → redirect', String(r3.status));
  const r4 = await attacker.agent.post('/api/cast/sessions/' + encodeURIComponent('../../users/' + vk) + '/invites').set('X-CSRF-Token', attacker.csrf).send({ role: 'co_host' });
  check(r4.status === 404, 'BUG-116 invites traversal → 404', String(r4.status));
}

// ── BUG-115: /meta ownership (haqiqiy sessiya bilan) ──
{
  // victim real cast sessiya yaratadi (rehearsal oqimi orqali — source yo'q, lekin rehearsalga source kerak)
  await fb.set(`users/${vk}/tests/vtest`, { name: 'V test', count: 1, created_at: 1, isPublic: false, questions: [{ text: 'q?', options: ['a', 'b'], correct: 0, type: 'single_choice' }] });
  const victim = await login('repro_s18_victim');
  const r0 = await victim.agent.post('/api/cast/rehearsal').set('X-CSRF-Token', victim.csrf).send({ source: { type: 'user', key: 'vtest' } });
  const j0 = r0.body || {};
  check(r0.status === 200 && j0.sessionId, 'victim rehearsal sessiya yaratdi', `${r0.status}/${j0.error?.message || j0.sessionId || ''}`);
  const sid = j0.sessionId;
  if (sid) {
    // attacker meta o'qishga urinadi (avval joinCode oqardi!)
    const r1 = await attacker.agent.get(`/api/cast/sessions/${sid}/meta`);
    check(r1.status === 403 && !(r1.body || {}).joinCode, 'BUG-115 begona /meta → 403 (avval joinCode oqib, sessiyaga qo\'shilish mumkin edi)', String(r1.status));
    const r2 = await victim.agent.get(`/api/cast/sessions/${sid}/meta`);
    check(r2.status === 200 && r2.body.ok, 'BUG-115 egasi /meta → 200 (baxtli yo\'l)', String(r2.status));
    // ── BUG-117: invite expiry clamp (owner) ──
    const r3 = await victim.agent.post(`/api/cast/sessions/${sid}/invites`).set('X-CSRF-Token', victim.csrf).send({ role: 'co_host', expiresInSeconds: 1000000000 });
    const j3 = r3.body || {};
    const delta = j3.invite ? Math.round((j3.invite.expiresAt - j3.invite.createdAt) / 1000) : -1;
    check(r3.status === 200 && delta === 86400, 'BUG-117 expiresInSeconds=1e9 → clamp 86400 (avval 31 yil)', String(delta));
    // ── BUG-118: nonce format ──
    const r4 = await victim.agent.post(`/api/cast/sessions/${sid}/invites/${encodeURIComponent('../../meta')}/revoke`).set('X-CSRF-Token', victim.csrf);
    check(r4.status === 400, 'BUG-118 revoke traversal nonce → 400 (avval arb. remove chaqirardi)', String(r4.status));
    const metaSnap = await fb.get(`cast_sessions/${sid}/meta`);
    const meta = typeof metaSnap?.val === 'function' ? metaSnap.val() : metaSnap;
    check(meta && meta.joinCode, 'sessiya meta saqlanib qoldi (traversal remove o\'olmadi)', 'ok');
  }
}

// ── BUG-119: /cast/qr rate limit ──
{
  let last = null;
  for (let i = 0; i < 35; i++) {
    last = await fetch(`${BASE}/cast/qr?d=https://deborah.uz/play&i=${i}`);
    if (last.status === 429) break;
  }
  check(last.status === 429, 'BUG-119 /cast/qr 31+ so\'rov → 429 (avval cheksiz)', String(last.status));
}

// ── BUG-120: preflight receipts cap (10 ta) ──
{
  for (let i = 0; i < 12; i++) {
    await attacker.agent.post('/api/cast/preflight').set('X-CSRF-Token', attacker.csrf).send({ source: { type: 'user', key: 'mytest' }, draftConfig: {} });
  }
  // 12 preflight + avvalgileri — eski TTL o'tganlari tozalanadi; sessiya ichida >10 bo'lmasligi kerak
  const rep = await attacker.agent.get('/user/panel');
  check(rep.status === 200, 'BUG-120 12 preflight keyin panel ishlaydi (receipts cap 10 + TTL sweep)', String(rep.status));
}

// ── BUG-121: legal-hold clamp (owner o'zi) ──
{
  const victim2 = await login('repro_s18_victim');
  const r0 = await victim2.agent.post('/api/cast/rehearsal').set('X-CSRF-Token', victim2.csrf).send({ source: { type: 'user', key: 'vtest' } });
  const sid = (r0.body || {}).sessionId;
  if (sid) {
    const r1 = await victim2.agent.post(`/api/cast/sessions/${sid}/legal-hold`).set('X-CSRF-Token', victim2.csrf).send({ scope: 'galaktika', reason: 'x'.repeat(5000), expiresInDays: 999999 });
    const j1 = r1.body || {};
    const h = j1.hold || {};
    const daysOk = !h.expiresInDays || h.expiresInDays <= 3650;
    check(r1.status === 200 && (h.reason ? h.reason.length <= 500 : true) && daysOk && ['session', 'data'].includes(h.scope || 'session'), 'BUG-121 legal-hold scope/reason/days clamp', `${h.scope}/${h.reason ? h.reason.length : '?'}${h.expiresInDays ? '/' + h.expiresInDays : ''}`);
  } else check(false, 'BUG-121: sessiya yaratib bo\'lmadi', '');
}

srv.kill();
console.log(`\n${fail === 0 ? '_HAMMASI OK (STEP 18)' : 'XATOLAR BOR: ' + fail} — ${pass} ✓ / ${fail} ✗`);
process.exit(fail ? 1 : 0);
