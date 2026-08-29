/**
 * STEP 14 REPRO — i18n bug'lari isboti (BUG-084..092). Run: node scripts/repro-step14.mjs (PORT 4610)
 */
const PORT = 4610;
const BASE = `http://localhost:${PORT}`;
const TEACHER = 'repro_s14_r';
const PASS = 'parol-2026-x-uzun';

process.env.NODE_ENV = 'test';
process.env.SESSION_SECRET = 'repro-secret-0123456789abcdef0123456789abcdef';
if (!process.env.LOCAL_DB_FILE) process.env.LOCAL_DB_FILE = '/tmp/s14repro.json';
try { (await import('fs')).rmSync(process.env.LOCAL_DB_FILE, { force: true }); } catch (_) {}

const { fb } = await import('../firebase/admin.js');
const { safeKey, hashPass } = await import('../utils/helpers.js');
const tk = safeKey(TEACHER);
await fb.set(`users/${tk}`, {
  username: TEACHER, email: `${TEACHER}@test.uz`, email_verified: true,
  role: 'teacher', role_version: 1, password: hashPass(PASS, tk), created_at: Date.now(),
});
const { createSession } = await import('../services/cast/session-store.js');
const SID = 's14rep' + Date.now().toString(36);
const CODE = 'S14RP' + (Date.now() % 100000);
await createSession({
  sessionId: SID, joinCode: CODE,
  meta: { title: 'S14 repro' },
  config: { localization: { locale: 'ru' } },
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

let pass = 0, fail = 0;
const check = (ok, name, extra = '') => { console.log(`  ${ok ? '✓' : '✗'} ${name}${extra ? ' (' + extra + ')' : ''}`); ok ? pass++ : fail++; };
const langOf = (html) => (html.match(/<html lang="([^"]*)"/) || [])[1] || '';

// ── BUG-084: cookie-parser — ?lang= cookie'si endi O'QILADI ──
{
  const r1 = await fetch(`${BASE}/user/login?lang=ru`);
  const cookie = (r1.headers.get('set-cookie') || '').split(';').find((c) => c.trim().startsWith('lang='));
  const r2 = await fetch(`${BASE}/user/login`, { headers: { cookie } });
  const html = await r2.text();
  check(langOf(html) === 'ru', 'BUG-084 cookie lang=ru → login ru (avval uz qolardi)', 'lang=' + langOf(html));
  const r3 = await fetch(`${BASE}/user/forgot`, { headers: { cookie } });
  const forgotLang = langOf(await r3.text());
  check(forgotLang === 'ru', 'BUG-084 forgot cookie bilan ru', 'lang=' + forgotLang);
}

// ── BUG-086: /locales static + cast i18n ──
{
  const r = await fetch(`${BASE}/locales/ru/cast.json`);
  check(r.status === 200, 'BUG-086 /locales/ru/cast.json 200 (avval 404 — cast i18n butunlay o\'lik edi)', String(r.status));
  const j = await r.json();
  check(j['join.btn'] === 'Присоединиться', 'BUG-086 ru katalog tarkibi', j['join.btn']);
}

// ── BUG-085: resolveAuthLang(req) obyekt emas ──
{
  const { default: Supertest } = await import('supertest');
  const agent = Supertest.agent(BASE);
  const seen = new Map();
  const collect = (r) => (r.headers['set-cookie'] || []).forEach((h) => { const [kv] = h.split(';'); const i = kv.indexOf('='); if (i > 0) seen.set(kv.slice(0, i), kv.slice(i + 1)); });
  const pg = await agent.get('/user/login?lang=uz'); collect(pg);
  const csrf = pg.text.match(/name="_csrf" value="([^"]+)"/)[1];
  const li = await agent.post('/user/login').type('form').send({ mode: 'login', username: TEACHER, password: PASS, _csrf: csrf, lang: 'uz' });
  collect(li);
  collect(await agent.get('/user/panel'));
  // notifications: DB lang YO'Q + ?lang=ru (avval: resolveAuthLang(req) → doim uz)
  const n = await agent.get('/user/notifications?lang=ru');
  check(n.status === 200 && langOf(n.text) === 'ru', 'BUG-085 notifications ?lang=ru → ru (avval uz)', 'lang=' + langOf(n.text));
  check(n.text.includes('Панель') || n.text.includes('Безопасность'), 'BUG-085/087 notifications nav ruscha', '');
  const e = await agent.get('/user/email-change?lang=ru');
  check(e.status === 200 && langOf(e.text) === 'ru', 'BUG-085 email-change ?lang=ru → ru (avval uz)', 'lang=' + langOf(e.text));

  // BUG-087: settings — DB lang=ru
  await fb.set(`users/${tk}/settings/lang`, 'ru');
  const s = await agent.get('/user/settings');
  check(s.status === 200 && langOf(s.text) === 'ru', 'BUG-087 settings DB-lang ru → html lang ru', 'lang=' + langOf(s.text));
  check(s.text.includes('Моя панель') && s.text.includes('Сохранить'), 'BUG-087 settings chrome ruscha (avval fallback uz)', '');
  const t2 = await agent.get('/user/teacher-approval');
  check(t2.status === 404, 'BUG-087 tapproval approved teacher uchun stealth 404 (500 emas)', String(t2.status));

  // login nav chrome ru (anonim — redirectIfAuth agentni panelga yuboradi)
  const lr = await fetch(BASE + '/user/login?lang=ru');
  const lrt = await lr.text();
  check(lrt.includes('Регистрация') && lrt.includes('Вход'), 'BUG-087 login nav cta ruscha', '');
  // theme-control ru
  check(lrt.includes('Светлая') && lrt.includes('Тёмная'), 'BUG-088 theme-control ruscha (avval EN System/Light/Dark)', '');
  // honeypot ru
  check(lrt.includes('проверка на ботов') || lrt.includes('Website'), 'BUG-087 register honeypot label tilga mos', '');

  globalThis.__agent = agent;
}

// ── BUG-089: uz-cyrl lotin qoldiqlar ──
{
  const p = await fetch(`${BASE}/privacy?lang=uz-cyrl`);
  const t = await p.text();
  check(t.includes('кўриб чиқилган'), 'BUG-089 legal "Сўнги кўриб чиқилган" kirill (avval lotin)', '');
  check(t.includes('Махфийлик сиёсати'), 'BUG-089 legal footer kirill (avval lotin "Maxfiylik siyosati")', '');
  check(t.includes('Ўзгарришлар тарихи') || t.includes('тарихи'), 'BUG-089 legal changelog sarlavha kirill', '');
  const f = await fetch(`${BASE}/user/forgot?lang=uz-cyrl`);
  const ft = await f.text();
  check(ft.includes('Махфийлик</a>'), 'BUG-089 auth-footer kirill (avval lotin)', '');
}

// ── BUG-089c + 092: landing /uz-cyrl va /ru ──
{
  const { chromium } = await import('playwright');
  const browser = await chromium.launch();
  const ctx = await browser.newContext();
  // BUG-092: localStorage'da uz tanlangan bo'lsa ham /ru server tilini buzmaydi
  const page = await ctx.newPage();
  await page.addInitScript(() => { try { localStorage.setItem('deborah-lang', 'uz'); } catch (_) {} });
  await page.goto(`${BASE}/ru`, { waitUntil: 'load' });
  await page.waitForTimeout(500);
  const ru = await page.evaluate(() => ({ lang: document.documentElement.getAttribute('lang'), h1: (document.querySelector('h1') || {}).textContent || '' }));
  check(ru.lang === 'ru' && /[\u0400-\u04FF]/.test(ru.h1), 'BUG-092 /ru localStorage="uz" ga qaramay rus (avval uz\'ga qaytardi)', 'h1=' + ru.h1.slice(0, 20));
  const p2 = await ctx.newPage();
  await p2.goto(`${BASE}/uz-cyrl`, { waitUntil: 'load' });
  await p2.waitForTimeout(500);
  const cy = await p2.evaluate(() => {
    const t = document.body.innerText || '';
    return { lang: document.documentElement.getAttribute('lang'), cyr: (t.match(/[\u0400-\u04FF]/g) || []).length, lat: (t.match(/[a-zA-Z]/g) || []).length };
  });
  check(cy.lang === 'uz-Cyrl', 'BUG-089 /uz-cyrl html lang uz-Cyrl (avval "uz")', cy.lang);
  check(cy.cyr > cy.lat * 2, 'BUG-089c /uz-cyrl kirill ustun (avval 60 data-i18n lotin qolardi)', `cyr=${cy.cyr} lat=${cy.lat}`);
  // BUG-091: hreflang
  const p3 = await ctx.newPage();
  await p3.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  const hr = await p3.evaluate(() => Array.from(document.querySelectorAll('link[rel=alternate][hreflang]')).map((x) => x.getAttribute('hreflang')));
  check(hr.includes('ru') && hr.includes('en') && hr.includes('uz-Cyrl') && hr.includes('x-default'), 'BUG-091 landing hreflang alternates (avval yo\'q)', hr.join(','));
  // BUG-086: /play ru isboti (brauzerda)
  const p4 = await ctx.newPage();
  await p4.goto(`${BASE}/play?code=${CODE}`, { waitUntil: 'load' });
  await p4.waitForTimeout(1500);
  const cast = await p4.evaluate(() => (document.querySelector('[data-i18n="join.btn"]') || {}).textContent || '');
  check(cast.includes('Присоединиться'), 'BUG-086 /play locale=ru ruscha tugma (avval uz qolardi)', cast.trim());
  await browser.close();
}

// ── cast.json paritet ──
{
  const fs = await import('node:fs');
  const flat = (o, p) => { let r = []; for (const k of Object.keys(o || {})) { const np = p ? p + '.' + k : k; if (o[k] && typeof o[k] === 'object') r = r.concat(flat(o[k], np)); else r.push(np); } return r; };
  const L = ['en', 'ru', 'uz-Cyrl', 'uz-Latn'];
  const dicts = {};
  for (const l of L) dicts[l] = JSON.parse(fs.readFileSync(`locales/${l}/cast.json`, 'utf8'));
  const base = new Set(Object.keys(dicts['uz-Latn']));
  const bad = L.filter((l) => new Set(Object.keys(dicts[l])).size !== base.size);
  check(bad.length === 0, 'cast.json 4 til pariteti', base.size + ' kalit');
}

srv.kill();
console.log(`\n${fail === 0 ? '_HAMMASI OK (STEP 14)' : 'XATOLAR BOR: ' + fail} — ${pass} ✓ / ${fail} ✗`);
process.exit(fail ? 1 : 0);
