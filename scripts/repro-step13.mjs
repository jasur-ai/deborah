/**
 * STEP 13 REPRO — mobil qatlam bug'lari isboti (BUG-078..083), 390×844.
 * Run: node scripts/repro-step13.mjs  (PORT 4606)
 */
const PORT = 4606;
const BASE = `http://localhost:${PORT}`;
const TEACHER = 'repro_s13_r';
const PASS = 'parol-2026-x-uzun';

process.env.NODE_ENV = 'test';
process.env.SESSION_SECRET = 'repro-secret-0123456789abcdef0123456789abcdef';
if (!process.env.LOCAL_DB_FILE) process.env.LOCAL_DB_FILE = '/tmp/s13repro.json';
try { (await import('fs')).rmSync(process.env.LOCAL_DB_FILE, { force: true }); } catch (_) {}

const { fb } = await import('../firebase/admin.js');
const { safeKey, hashPass } = await import('../utils/helpers.js');
const tk = safeKey(TEACHER);
await fb.set(`users/${tk}`, {
  username: TEACHER, email: `${TEACHER}@test.uz`, email_verified: true,
  role: 'teacher', role_version: 1, password: hashPass(PASS, tk), created_at: Date.now(),
});
const { createSession } = await import('../services/cast/session-store.js');
const SID = 's13rep' + Date.now().toString(36);
const CODE = 'S13RP' + (Date.now() % 100000);
await createSession({
  sessionId: SID, joinCode: CODE,
  meta: { title: 'S13 repro' },
  config: { localization: { locale: 'uz' } },
  state: { phase: 'lobby', revision: 1 },
  privateQuestions: [], publicQuestions: [],
});
await fb.set(`cast_sessions/${SID}/roles/${encodeURIComponent('user:' + tk)}`, { actorId: 'user:' + tk, role: 'owner' });

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
const collect = (seen, r) => (r.headers['set-cookie'] || []).forEach((h) => { const [kv] = h.split(';'); const i = kv.indexOf('='); if (i > 0) seen.set(kv.slice(0, i), kv.slice(i + 1)); });

// teacher cookie
const agent = Supertest.agent(BASE);
const tseen = new Map();
const pg = await agent.get('/user/login?lang=uz'); collect(tseen, pg);
const csrf = pg.text.match(/name="_csrf" value="([^"]+)"/)[1];
const li = await agent.post('/user/login').type('form').send({ mode: 'login', username: TEACHER, password: PASS, _csrf: csrf, lang: 'uz' });
collect(tseen, li);
collect(tseen, await agent.get('/user/panel'));
console.log('teacher login OK');

// admin cookie
const adm = Supertest.agent(BASE);
const aseen = new Map();
const ap = await adm.get('/admin/login?lang=uz'); collect(aseen, ap);
const ac = ap.text.match(/name="_csrf" value="([^"]+)"/)[1];
const ali = await adm.post('/admin/login').type('form').send({ username: 'repro_admin', password: 'repro-pass-123', _csrf: ac, lang: 'uz' });
collect(aseen, ali);
collect(aseen, await adm.get('/admin/dashboard'));
console.log('admin login OK');

const { chromium } = await import('playwright');
const browser = await chromium.launch();
const mkCtx = async (w, h, cookies) => {
  const ctx = await browser.newContext({ viewport: { width: w, height: h } });
  await ctx.addCookies([...cookies.entries()].map(([name, value]) => ({ name, value, url: BASE })));
  return ctx;
};
let pass = 0, fail = 0;
const check = (ok, name, extra = '') => { console.log(`  ${ok ? '✓' : '✗'} ${name}${extra ? ' (' + extra + ')' : ''}`); ok ? pass++ : fail++; };
const waitImgs = (page) => page.evaluate(() => Promise.race([
  Promise.all(Array.from(document.images).map((i) => i.complete ? 1 : new Promise((r) => { i.onload = i.onerror = () => r(1); }))),
  new Promise((r) => setTimeout(r, 2500)),
]));

// ── BUG-078: /play participant [hidden] + overflow ──
{
  const ctx = await mkCtx(390, 844, new Map());
  const page = await ctx.newPage();
  await page.goto(`${BASE}/play?code=${CODE}`, { waitUntil: 'load' });
  await waitImgs(page);
  const r = await page.evaluate(() => ({
    sw: (document.scrollingElement || document.documentElement).scrollWidth,
    iw: window.innerWidth,
    waitDisp: getComputedStyle(document.getElementById('part-waiting')).display,
    forgeDisp: getComputedStyle(document.getElementById('part-forge')).display,
    qDisp: getComputedStyle(document.getElementById('part-question')).display,
    joinDisp: getComputedStyle(document.getElementById('part-join')).display,
    cardMax: getComputedStyle(document.querySelector('.part-card')).maxWidth,
  }));
  check(r.sw <= r.iw + 1, 'BUG-078 /play 390px gorizontal overflow yo\'q', `sw=${r.sw}`);
  check(r.waitDisp === 'none' && r.forgeDisp === 'none' && r.qDisp === 'none', 'BUG-078 [hidden] screenlar haqiqatan yashirin', `waiting=${r.waitDisp}`);
  check(r.joinDisp !== 'none', 'BUG-078 join screen ko\'rinadi', r.joinDisp);
  check(r.cardMax === '100%', 'BUG-078 part-card max-width:100%', r.cardMax);
  await page.close(); await ctx.close();
}

// ── BUG-079: director topbar ──
{
  const ctx = await mkCtx(390, 844, tseen);
  const page = await ctx.newPage();
  await page.goto(`${BASE}/cast/${SID}/director`, { waitUntil: 'load' });
  await waitImgs(page);
  const r = await page.evaluate(() => ({
    sw: (document.scrollingElement || document.documentElement).scrollWidth,
    iw: window.innerWidth,
    right: document.querySelector('.dir-topbar-right') ? Math.round(document.querySelector('.dir-topbar-right').getBoundingClientRect().right) : -1,
  }));
  check(r.sw <= r.iw + 1, 'BUG-079 director 390px overflow yo\'q', `sw=${r.sw}`);
  check(r.right <= r.iw + 1, 'BUG-079 dir-topbar-right viewport ichida', `right=${r.right}/iw=${r.iw}`);
  await page.close(); await ctx.close();
}

// ── BUG-080: input font-size ≥16px (iOS auto-zoom) ──
{
  const cases = [
    [new Map(), '/user/login?lang=uz', '#login-username, input[type=text], input[type=password]', 'login'],
    [new Map(), '/', 'input#lEmail, input#lPass', 'landing'],
    [tseen, '/user/settings', '#set-name', 'settings'],
    [tseen, '/user/portfolio', '#fTitle', 'portfolio'],
    [new Map(), '/play?code=' + CODE, '#join-code', 'play'],
    [tseen, `/cast/${SID}/director`, '#goal-type', 'director'],
    [aseen, '/admin/accessibility', '#auPageUrl', 'adm-a11y'],
    [aseen, '/admin/board', '#mTitle', 'adm-board'],
  ];
  for (const [cookies, path, sel, label] of cases) {
    const ctx = await mkCtx(390, 844, cookies);
    const page = await ctx.newPage();
    await page.goto(BASE + path, { waitUntil: 'load' });
    const fs = await page.evaluate((s) => {
      for (const q of s.split(',')) { const el = document.querySelector(q.trim()); if (el) return parseFloat(getComputedStyle(el).fontSize); }
      return -1;
    }, sel);
    check(fs >= 15.95, `BUG-080 ${label} input ≥16px`, fs < 0 ? 'topilmadi' : fs.toFixed(2) + 'px');
    await page.close(); await ctx.close();
  }
}

// ── BUG-081: checkbox/radio ≥24px ──
{
  const cases = [
    [aseen, '/admin/accessibility', '#stReducedMotion', 'adm-a11y checkbox 13×13 edi'],
    [new Map(), '/user/login?lang=uz', 'input[type=checkbox]', 'login remember 15×15 edi'],
    [tseen, '/user/portfolio', '#fConsent', 'portfolio consent 13×20 edi'],
  ];
  for (const [cookies, path, sel, label] of cases) {
    const ctx = await mkCtx(390, 844, cookies);
    const page = await ctx.newPage();
    await page.goto(BASE + path, { waitUntil: 'load' });
    await waitImgs(page);
    const m = await page.evaluate((s) => { const el = document.querySelector(s); if (!el) return null; const r = el.getBoundingClientRect(); return { w: r.width, h: r.height }; }, sel);
    check(m && Math.min(m.w, m.h) >= 23.5, `BUG-081 ${label}`, m ? Math.round(m.w) + '×' + Math.round(m.h) : 'yo\'q');
    await page.close(); await ctx.close();
  }
}

// ── BUG-082: select/button ≥24px balandlik ──
{
  const cases = [
    [tseen, '/user/panel', '#lib-subject', 'panel .sel 19px edi'],
    [aseen, '/admin/accessibility', '.adm-btn', 'adm-btn 21px edi'],
    [aseen, '/admin/accessibility', '#auJourney', 'auJourney select 19px edi'],
  ];
  for (const [cookies, path, sel, label] of cases) {
    const ctx = await mkCtx(390, 844, cookies);
    const page = await ctx.newPage();
    await page.goto(BASE + path, { waitUntil: 'load' });
    await waitImgs(page);
    const m = await page.evaluate((s) => { const el = document.querySelector(s); if (!el) return null; const r = el.getBoundingClientRect(); return { w: r.width, h: r.height }; }, sel);
    check(m && m.h >= 23.5, `BUG-082 ${label}`, m ? Math.round(m.w) + '×' + Math.round(m.h) : 'yo\'q');
    await page.close(); await ctx.close();
  }
}

// ── BUG-083: nav-logo / hamburger / refresh ≥24px ──
{
  const ctx = await mkCtx(390, 844, new Map());
  const page = await ctx.newPage();
  await page.goto(`${BASE}/user/login?lang=uz`, { waitUntil: 'load' });
  await waitImgs(page);
  const m = await page.evaluate(() => { const el = document.querySelector('a.nav-logo'); const r = el.getBoundingClientRect(); return { w: r.width, h: r.height }; });
  check(Math.min(m.w, m.h) >= 23.5, 'BUG-083 login nav-logo ≥24px (16×32 edi)', Math.round(m.w) + '×' + Math.round(m.h));
  await page.close(); await ctx.close();

  const actx = await mkCtx(390, 844, aseen);
  const ap2 = await actx.newPage();
  await ap2.goto(`${BASE}/admin/dashboard`, { waitUntil: 'load' });
  await waitImgs(ap2);
  const am = await ap2.evaluate(() => {
    const ham = document.querySelector('.admin-nav-hamburger');
    const ref = document.querySelector('.admin-refresh-btn');
    return {
      ham: ham ? Math.round(Math.min(ham.getBoundingClientRect().width, 40)) : -1,
      ref: ref ? Math.round(Math.min(ref.getBoundingClientRect().width, ref.getBoundingClientRect().height)) : -1,
    };
  });
  check(am.ham >= 23.5, 'BUG-083 admin hamburger kengligi ≥24px (18px edi)', am.ham + 'px');
  check(am.ref >= 23.5, 'BUG-083 admin refresh ≥24px (14×14 edi)', am.ref + 'px');
  await ap2.close(); await actx.close();
}

// ── 320px eng kichik ──
{
  const ctx = await mkCtx(320, 568, new Map());
  const page = await ctx.newPage();
  await page.goto(`${BASE}/play?code=${CODE}`, { waitUntil: 'load' });
  const sw = await page.evaluate(() => (document.scrollingElement || document.documentElement).scrollWidth);
  check(sw <= 321, '320px /play overflow yo\'q (+554px edi)', 'sw=' + sw);
  await page.close(); await ctx.close();
}

await browser.close();
srv.kill();
console.log(`\n${fail === 0 ? '_HAMMASI OK (STEP 13)' : 'XATOLAR BOR: ' + fail} — ${pass} ✓ / ${fail} ✗`);
process.exit(fail ? 1 : 0);
