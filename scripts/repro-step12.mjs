/**
 * STEP 12 REPRO — Faza B: mavzu qatlamlari (landing/auth/cast/sessions/rol) 
 *
 * 1. BUG-071/072 sessions dark: skip-link + lang-link.on → on-action (≥4.5:1)
 * 2. BUG-073 cast director .cast-btn-danger → to'q matn (≥4.5:1)
 * 3. BUG-074 /cast/:id/projector ticket'siz brauzer → 302 /play (xom JSON emas)
 * 4. BUG-075 /play enter .btn-red → accent + on-action (gradient worst-stop 2.32 edi)
 * 5. BUG-076 rol sahifalari (/student /proctor /marker /board /teacher) anonim brauzer →
 *    302 login (xom 401 JSON emas); Accept:json → 401 JSON saqlanadi
 * 6. BUG-077 hc-light/hc-dark (va OS prefers-contrast) → mavjud bazaga graceful resolve
 *    (data-theme="high-contrast" CSS'siz buzilardi)
 * + FOUC: saqlangan light birinchi DOMContentLoaded'da qo'llanadi
 *
 * Run: NODE_ENV=test LOCAL_DB_FILE=/tmp/repro-step12-db.json node scripts/repro-step12.mjs
 */
const PORT = 4602;
const BASE = `http://localhost:${PORT}`;
const TEACHER = 'repro_s12r_t';
const PASS = 'parol-2026-x-uzun';

process.env.NODE_ENV = 'test';
process.env.SESSION_SECRET = 'repro-secret-0123456789abcdef0123456789abcdef';
if (!process.env.LOCAL_DB_FILE) process.env.LOCAL_DB_FILE = '/tmp/repro-step12-db.json';
try { (await import('fs')).rmSync(process.env.LOCAL_DB_FILE, { force: true }); } catch (_) {}

const { fb } = await import('../firebase/admin.js');
const { safeKey, hashPass } = await import('../utils/helpers.js');
const tk = safeKey(TEACHER);
await fb.set(`users/${tk}`, {
  username: TEACHER, email: `${TEACHER}@test.uz`, email_verified: true,
  role: 'teacher', role_version: 1, password: hashPass(PASS, tk), created_at: Date.now(),
});
const { createSession } = await import('../services/cast/session-store.js');
const SID = 's12r' + Date.now().toString(36);
await createSession({
  sessionId: SID, joinCode: 'S12RCODE',
  meta: { title: 'S12 repro' }, config: { localization: { locale: 'uz' } },
  state: { phase: 'lobby', revision: 1 }, privateQuestions: [], publicQuestions: [],
});
await fb.set(`cast_sessions/${SID}/roles/${encodeURIComponent('user:' + tk)}`, { actorId: 'user:' + tk, role: 'owner' });
console.log('seed OK');

const { spawn } = await import('node:child_process');
const srv = spawn('node', ['server.js'], {
  env: { ...process.env, PORT: String(PORT), LOG_LEVEL: 'silent' },
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
const track = (r) => (r.headers['set-cookie'] || []).forEach((h) => { const [kv] = h.split(';'); const i = kv.indexOf('='); if (i > 0) seen.set(kv.slice(0, i), kv.slice(i + 1)); });
const pg = await agent.get('/user/login?lang=uz'); track(pg);
const csrf = pg.text.match(/name="_csrf" value="([^"]+)"/)[1];
const li = await agent.post('/user/login').type('form').send({ mode: 'login', username: TEACHER, password: PASS, _csrf: csrf, lang: 'uz' }); track(li);
await agent.get('/user/panel');
console.log('login OK');

const fails = [];
const ok = (cond, name) => { console.log(`  ${cond ? '✓' : '✗ FAIL'} ${name}`); if (!cond) fails.push(name); };
const HTML = 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8';

// ── 1-2. sessions dark: skip-link + lang-link.on ──
// ── 4. enter btn-red ── ── FOUC ──
{
  const { chromium } = await import('playwright');
  const browser = await chromium.launch();
  const ctx = await browser.newContext();
  await ctx.addCookies([...seen.entries()].map(([name, value]) => ({ name, value, url: BASE })));
  await ctx.addInitScript(() => { try { localStorage.setItem('deborah-theme-state', 'dark'); } catch (_) {} });

  const s = await ctx.newPage();
  await s.goto(`${BASE}/sessions`, { waitUntil: 'domcontentloaded' });
  await s.waitForTimeout(500);
  const c1 = await s.evaluate(() => {
    const r = (el) => { if (!el) return null; const cs = getComputedStyle(el); return cs.color; };
    return { skip: r(document.querySelector('.skip-link')), lang: r(document.querySelector('.lang-link.on')) };
  });
  ok(c1.skip && c1.skip !== 'rgb(255, 255, 255)', `BUG-071 skip-link matn oq emas (${c1.skip})`);
  ok(c1.lang && c1.lang !== 'rgb(255, 255, 255)', `BUG-072 lang-link.on matn oq emas (${c1.lang})`);
  await s.close();

  const d = await ctx.newPage();
  await d.goto(`${BASE}/cast/${SID}/director`, { waitUntil: 'domcontentloaded' });
  await d.waitForTimeout(600);
  const c2 = await d.evaluate(() => {
    const b = document.querySelector('.cast-btn-danger');
    return b ? getComputedStyle(b).color : null;
  });
  ok(c2 && c2 !== 'rgb(255, 255, 255)', `BUG-073 cast-btn-danger matn oq emas (${c2})`);
  await d.close();

  const p = await ctx.newPage();
  await p.goto(`${BASE}/play`, { waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(500);
  const c3 = await p.evaluate(() => {
    const b = document.querySelector('.btn-red');
    if (!b) return null;
    const cs = getComputedStyle(b);
    return { color: cs.color, bg: cs.backgroundImage.slice(0, 40) };
  });
  ok(c3 && c3.color !== 'rgb(255, 255, 255)', `BUG-075 btn-red matn oq emas (${c3 && c3.color})`);
  ok(c3 && !c3.bg.includes('gradient'), `BUG-075 btn-red gradient olib tashlangan (${c3 && c3.bg})`);
  await p.close();

  // FOUC + BUG-077: hc-dark graceful
  const lctx = await browser.newContext();
  await lctx.addInitScript(() => {
    try { localStorage.setItem('deborah-theme-state', 'light'); } catch (_) {}
    document.addEventListener('DOMContentLoaded', function () { try { window.__et = document.documentElement.getAttribute('data-theme'); } catch (_) {} });
  });
  const lp = await lctx.newPage();
  await lp.goto(`${BASE}/`, { waitUntil: 'load' });
  const et = await lp.evaluate(() => window.__et);
  ok(et === 'light', `FOUC landing: birinchi DCL'da theme=light (${et})`);
  await lp.close();

  const hctx = await browser.newContext();
  await hctx.addInitScript(() => { try { localStorage.setItem('deborah-theme-state', 'hc-dark'); } catch (_) {} });
  const hp = await hctx.newPage();
  await hp.goto(`${BASE}/user/login?lang=uz`, { waitUntil: 'domcontentloaded' });
  await hp.waitForTimeout(400);
  const hc = await hp.evaluate(() => ({ theme: document.documentElement.getAttribute('data-theme'), state: document.documentElement.getAttribute('data-theme-state') }));
  ok(hc.theme === 'dark' && hc.state === 'hc-dark', `BUG-077 hc-dark → dark'ga graceful (theme=${hc.theme}, state=${hc.state})`);
  const bbg = await hp.evaluate(() => getComputedStyle(document.body).backgroundColor);
  ok(bbg !== 'rgba(0, 0, 0, 0)', `BUG-077 sahifa stilli saqlangan (body bg=${bbg})`);
  await hp.close();
  await browser.close();
}

// ── 3. BUG-074: projector ticket'siz ──
{
  const r = await fetch(`${BASE}/cast/${SID}/projector`, { redirect: 'manual', headers: { Accept: HTML } });
  ok(r.status === 302 && (r.headers.get('location') || '') === '/play', `BUG-074 projector → 302 /play (${r.status})`);
  const jr = await fetch(`${BASE}/cast/${SID}/projector`, { redirect: 'manual', headers: { Accept: 'application/json' } });
  ok([302, 403].includes(jr.status), `BUG-074 JSON client ham izchil (${jr.status})`);
}

// ── 5. BUG-076: rol sahifalari anonim brauzer ──
{
  const anon = Supertest(BASE);
  for (const p of ['/student', '/proctor', '/marker', '/board', '/teacher']) {
    const r = await anon.get(p).set('Accept', HTML);
    ok(r.status === 302 && (r.headers.location || '').includes('/user/login'), `BUG-076 anon ${p} → 302 login (${r.status} ${r.headers.location || ''})`);
  }
  const rj = await anon.get('/student').set('Accept', 'application/json');
  ok(rj.status === 401 && rj.body?.error, `BUG-076 API/json → 401 JSON saqlanadi (${rj.status})`);
}

console.log(`\n_${fails.length ? 'XATO: ' + fails.length : 'HAMMASI OK'} (STEP 12)`);
srv.kill();
process.exit(fails.length ? 1 : 0);
