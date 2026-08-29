/**
 * STEP 15 REPRO — test-yaratish qatlami bug'lari isboti (BUG-093..099). Run: node scripts/repro-step15.mjs (PORT 4614)
 */
const PORT = 4614;
const BASE = `http://localhost:${PORT}`;
const U = 'repro_s15_r';
const V = 'repro_s15_victim';
const P = 'parol-2026-x-uzun';

process.env.NODE_ENV = 'test';
process.env.SESSION_SECRET = 'repro-secret-0123456789abcdef0123456789abcdef';
if (!process.env.LOCAL_DB_FILE) process.env.LOCAL_DB_FILE = '/tmp/s15repro.json';
try { (await import('fs')).rmSync(process.env.LOCAL_DB_FILE, { force: true }); } catch (_) {}

const { fb } = await import('../firebase/admin.js');
const { safeKey, hashPass } = await import('../utils/helpers.js');
const tk = safeKey(U);
const vk = safeKey(V);
await fb.set(`users/${tk}`, { username: U, email: U + '@test.uz', email_verified: true, role: 'teacher', role_version: 1, password: hashPass(P, tk), created_at: Date.now() });
await fb.set(`users/${vk}`, { username: V, email: 'v@test.uz', email_verified: true, role: 'student', role_version: 1, password: hashPass(P, vk), created_at: Date.now() });
await fb.set(`users/${vk}/tests/vtest1`, { name: 'VIKTIM MAXFIY TESTI', count: 1, created_at: 1, isPublic: false, questions: [{ text: '2+2=?', options: ['3', '4'], correct: 1, type: 'single_choice', explanation: '', tags: [], timing: 0 }] });
await fb.set(`users/${tk}/tests/arch1`, { name: 'Arxiv test', count: 1, created_at: 5, archived: true, isPublic: false, questions: [{ text: 'q', options: ['a', 'b'], correct: 0, type: 'single_choice', explanation: '', tags: [], timing: 0 }] });

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
const agent = Supertest.agent(BASE);
const seen = new Map();
const collect = (r) => (r.headers['set-cookie'] || []).forEach((h) => { const [kv] = h.split(';'); const i = kv.indexOf('='); if (i > 0) seen.set(kv.slice(0, i), kv.slice(i + 1)); });
let pass = 0, fail = 0;
const check = (ok, name, extra = '') => { console.log(`  ${ok ? '✓' : '✗'} ${name}${extra ? ' (' + extra + ')' : ''}`); ok ? pass++ : fail++; };

const pg = await agent.get('/user/login?lang=uz'); collect(pg);
const csrf0 = pg.text.match(/name="_csrf" value="([^"]+)"/)[1];
const li = await agent.post('/user/login').type('form').send({ mode: 'login', username: U, password: P, _csrf: csrf0, lang: 'uz' }); collect(li);
collect(await agent.get('/user/panel'));
const ct = await agent.get('/user/create-test');
const csrf = ct.text.match(/window.__CSRF_TOKEN = "([^"]+)"/)[1];
check(li.status === 302 && csrf, 'login + csrf', csrf ? 'ok' : 'yo\'q');

// ── BUG-093: traversal/IDOR bloklanadi ──
{
  const trav = `../../users/${vk}/tests/vtest1`;
  const s1 = await agent.post('/user/api/tests/save').set('X-CSRF-Token', csrf).send({ name: 'HAQORAT', questions: [{ text: '?', options: ['a', 'b'], correct: 0 }], editKey: trav });
  check(s1.status === 400, 'BUG-093 save editKey traversal → 400 (avval 200 + yozib olardi)', String(s1.status));
  const s1b = await agent.post('/user/api/tests/save').set('X-CSRF-Token', csrf).send({ name: 'OWNED', questions: [{ text: '?', options: ['a', 'b'], correct: 0 }], editKey: `../../users/${vk}` });
  check(s1b.status === 400, 'BUG-093 save user-overwrite traversal → 400', String(s1b.status));
  const g1 = await agent.get('/user/create-test?edit=' + encodeURIComponent(trav));
  check(g1.status === 400, 'BUG-093 GET ?edit traversal → 400 (avval maxfiy kontent oqardi)', String(g1.status));
  const d1 = await agent.post('/user/api/tests/delete').set('X-CSRF-Token', csrf).send({ key: trav });
  check(d1.status === 400, 'BUG-093 delete traversal → 400', String(d1.status));
  for (const ep of [['duplicate', { key: trav }], ['archive', { key: trav, archived: true }], ['rename', { key: trav, name: 'x' }], ['toggle-public', { key: trav }]]) {
    const r = await agent.post(`/user/api/tests/${ep[0]}`).set('X-CSRF-Token', csrf).send(ep[1]);
    check(r.status === 400, `BUG-093 ${ep[0]} traversal → 400`, String(r.status));
  }
  const e1 = await agent.get('/user/api/tests/export?key=' + encodeURIComponent(trav));
  check(e1.status === 400, 'BUG-093 export traversal → 400', String(e1.status));
  // victim ping — server hot-read (o'z cookie'siz bilib bo'lmaydi; to'g'ridan fb orqali emas —
  // server jarayoni bilan bir fayl; baribir 400 luiq himoya isboti)
}

// ── BUG-094: rename bounds + ghost ──
{
  const r1 = await agent.post('/user/api/tests/rename').set('X-CSRF-Token', csrf).send({ key: 'ghost99', name: 'Yangi nom' });
  check(r1.status === 404, 'BUG-094 rename mavjud emas → 404 (avval ghost yozuv yaratardi)', String(r1.status));
  const r2 = await agent.post('/user/api/tests/rename').set('X-CSRF-Token', csrf).send({ key: 'arch1', name: 'x'.repeat(301) });
  check(r2.status === 400, 'BUG-094 rename 301 belgi → 400 (avval 5000 ham o\'tdi)', String(r2.status));
  const r3 = await agent.post('/user/api/tests/rename').set('X-CSRF-Token', csrf).send({ key: 'arch1', name: 'Arxiv test (yangilangan)' });
  check(r3.status === 200, 'BUG-094 rename oddiy → 200', String(r3.status));
}

// ── BUG-095: correct clamp ──
{
  const s = await agent.post('/user/api/tests/save').set('X-CSRF-Token', csrf).send({ name: 'bounds test', questions: [{ text: 't', options: ['a', 'b', 'c'], correct: 999 }] });
  check(s.status === 200 && s.body.key, 'BUG-095 save correct=999 qabul (clamp ichida)', s.body.key || s.body.error);
  const back = await agent.get(`/user/create-test?edit=${s.body.key}`);
  const m = back.text.match(/"correct":(\d+)/);
  check(m && m[1] === '2', 'BUG-095 correct 999 → 2 (oxirgi variantga clamp)', m ? m[1] : '?');
}

// ── BUG-096: explanation/options/tags bounds ──
{
  const s1 = await agent.post('/user/api/tests/save').set('X-CSRF-Token', csrf).send({ name: 'b1', questions: [{ text: 't', options: ['a', 'b'], correct: 0, explanation: 'E'.repeat(2001) }] });
  check(s1.status === 400, 'BUG-096 explanation 2001 → 400', String(s1.status));
  const s2 = await agent.post('/user/api/tests/save').set('X-CSRF-Token', csrf).send({ name: 'b2', questions: [{ text: 't', options: ['a', 'x'.repeat(501)], correct: 0 }] });
  check(s2.status === 400, 'BUG-096 variant 501 belgi → 400', String(s2.status));
  const s3 = await agent.post('/user/api/tests/save').set('X-CSRF-Token', csrf).send({ name: 'b3', questions: [{ text: 't', options: ['a', 'b'], correct: 0, tags: Array.from({ length: 11 }, () => 't') }] });
  check(s3.status === 400, 'BUG-096 11 ta teg → 400', String(s3.status));
}

// ── BUG-097: edit arxiv/updated_at saqlanadi ──
{
  const s = await agent.post('/user/api/tests/save').set('X-CSRF-Token', csrf).send({ name: 'Arxiv test (edit)', questions: [{ text: 'q2', options: ['a', 'b'], correct: 1 }], editKey: 'arch1' });
  check(s.status === 200, 'BUG-097 arxiv testni edit → 200', String(s.status));
  const db = JSON.parse((await import('node:fs')).readFileSync(process.env.LOCAL_DB_FILE, 'utf8'));
  const rec = db?.users?.[tk]?.tests?.arch1;
  check(rec && rec.archived === true, 'BUG-097 archived=true SAQLANDI (avval jim yo\'qolardi)', rec ? String(rec.archived) : 'yo\'q');
  check(rec && typeof rec.updated_at === 'number', 'BUG-097 updated_at yozildi', rec && rec.updated_at ? 'ok' : 'yo\'q');
}

// ── BUG-098 + UI oqimi ──
{
  const { chromium } = await import('playwright');
  const browser = await chromium.launch();
  const ctx = await browser.newContext();
  await ctx.addCookies([...seen.entries()].map(([name, value]) => ({ name, value, url: BASE })));
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message.slice(0, 60)));
  await page.goto(`${BASE}/user/create-test`, { waitUntil: 'load' });
  await page.waitForTimeout(500);
  await page.click('#tb-add-question');
  await page.waitForTimeout(300);
  const junk = await page.evaluate(() => document.body.innerText.includes('<%-'));
  check(!junk, 'BUG-098 <%- EJS chiqindisi ko\'rinmaydi (8 joyda edi)', junk ? 'bor' : 'toza');
  await page.fill('#tb-name', 'S15 repro test');
  await page.fill('#tb-q-text', '2+2 nechchi?');
  await page.fill('[data-opt="0"]', '3');
  await page.fill('[data-opt="1"]', '4');
  await page.check('[data-correct="1"]');
  await page.click('#tb-save-btn');
  await page.waitForTimeout(1000);
  const st = await page.evaluate(() => document.getElementById('tb-status').dataset.save);
  check(st === 'saved', 'UI save oqimi ishlaydi', st);
  // xlsx lokal
  const x = await page.evaluate(() => Array.from(document.scripts).map((s) => s.src).filter((u) => u.includes('xlsx')));
  check(x.length === 1 && x[0].includes('/js/vendor/xlsx.full.min.js'), 'BUG-099 xlsx lokal vendor\'dan (cdnjs emas)', x[0] || 'yo\'q');
  check(errs.length === 0, 'UI pageerror yo\'q', errs.slice(0, 2).join('; '));
  await browser.close();
}

// ── BUG-099: vendor fayl 200 ──
{
  const r = await fetch(`${BASE}/js/vendor/xlsx.full.min.js`);
  const body = await r.text();
  check(r.status === 200 && body.length > 500000, 'BUG-099 /js/vendor/xlsx.full.min.js 200 (to\u2018liq tana)', r.status + ' / ' + body.length);
}

srv.kill();
console.log(`\n${fail === 0 ? '_HAMMASI OK (STEP 15)' : 'XATOLAR BOR: ' + fail} — ${pass} ✓ / ${fail} ✗`);
process.exit(fail ? 1 : 0);
