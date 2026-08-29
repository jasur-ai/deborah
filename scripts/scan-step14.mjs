/**
 * STEP 14 SCANNER — i18n qatlamlar: 4 til (uz, uz-cyrl, ru, en) render-level
 * tarjima tekshiruvi + html lang attr + cookie davomiyligi + hreflang +
 * cast.json/landing/roster lug'at pariteti.
 * Run: node scripts/scan-step14.mjs  (PORT 4608)
 */
const PORT = 4608;
const BASE = `http://localhost:${PORT}`;
const TEACHER = 'repro_s14_t';
const PASS = 'parol-2026-x-uzun';

process.env.NODE_ENV = 'test';
process.env.SESSION_SECRET = 'repro-secret-0123456789abcdef0123456789abcdef';
if (!process.env.LOCAL_DB_FILE) process.env.LOCAL_DB_FILE = '/tmp/s14scan.json';
try { (await import('fs')).rmSync(process.env.LOCAL_DB_FILE, { force: true }); } catch (_) {}

const { fb } = await import('../firebase/admin.js');
const { safeKey, hashPass } = await import('../utils/helpers.js');
const tk = safeKey(TEACHER);
await fb.set(`users/${tk}`, {
  username: TEACHER, email: `${TEACHER}@test.uz`, email_verified: true,
  role: 'teacher', role_version: 1, password: hashPass(PASS, tk), created_at: Date.now(),
});
const { createSession } = await import('../services/cast/session-store.js');
const SID = 's14cast' + Date.now().toString(36);
const CODE = 'S14CST';
await createSession({
  sessionId: SID, joinCode: CODE,
  meta: { title: 'S14 audit' },
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

const { default: Supertest } = await import('supertest');
const collect = (seen, r) => (r.headers['set-cookie'] || []).forEach((h) => { const [kv] = h.split(';'); const i = kv.indexOf('='); if (i > 0) seen.set(kv.slice(0, i), kv.slice(i + 1)); });
const agent = Supertest.agent(BASE);
const tseen = new Map();
const pg = await agent.get('/user/login?lang=uz'); collect(tseen, pg);
const csrf = pg.text.match(/name="_csrf" value="([^"]+)"/)[1];
const li = await agent.post('/user/login').type('form').send({ mode: 'login', username: TEACHER, password: PASS, _csrf: csrf, lang: 'uz' });
collect(tseen, li);
collect(tseen, await agent.get('/user/panel'));
console.log('teacher login OK');

const { chromium } = await import('playwright');
const browser = await chromium.launch();

// ── matn yig'ish ──
const GRAB = `() => {
  const lines = new Set();
  const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let n;
  while ((n = walk.nextNode())) {
    const pn = n.parentElement;
    if (pn && ['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEXTAREA'].includes(pn.tagName)) continue; // S14: FP manbai
    const t = n.textContent.replace(/\\s+/g, ' ').trim();
    if (t.length >= 3 && t.match(/[a-zA-Z\\u0400-\\u04FF]/)) lines.add(t);
  }
  return { lines: Array.from(lines).slice(0, 600), lang: document.documentElement.getAttribute('lang') || '(yoq)' };
}`;
async function grab(ctx, path) {
  const page = await ctx.newPage();
  await page.goto(BASE + path, { waitUntil: 'domcontentloaded', timeout: 20000 });
  await page.waitForTimeout(350);
  const r = await page.evaluate("(" + GRAB + ")()");
  await page.close();
  return r;
}

// texno-so'zlar whitelist (tillar orasida bir xil bo'lishi normal)
const WHITELIST = /^(deborah|email|cast|pdf|api|id|totp|fido2|webauthn|csrf|http|https|seo|ui|ok|x|ai|google|canva|telegram|vip|qr|mfa|oidc|oauth|smtp|lms|jwt|q(a|r)?code|v\\d|[\\d\\s\\p{P}]+|product|teachers|ready tests|resources|o\u2018zbek|o\u2018zbekcha|english|password|cookie|uz-cyrl|initial version|status|admin|login|username|.*@deborah\\.uz.*)$/iu;
const UZ_MARKERS = /( bilan | uchun | va | emas |yubor|saqla|kirish|parol|tilni|eslab|yangi|eski|ruxsat|xato|muvaffaq|tasdiq|bekor|profil|sozl|hisob|joriy|qurilm|sessiy|bildirish|testlar|topshir|natij|fan |semestr|bahol|iqtisod|matemat|fizik|tarix|informat|o'|g'|ʻ|ʼ|sh chir|chegara)/iu;

const mkCtx = async (cookies) => {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  if (cookies) await ctx.addCookies([...cookies.entries()].map(([name, value]) => ({ name, value, url: BASE })));
  return ctx;
};

const PUB = [['/user/login', 'login'], ['/user/register', 'register'], ['/user/forgot', 'forgot'], ['/user/reset', 'reset'], ['/privacy', 'privacy'], ];
const USER = [['/sessions', 'sessions'], ['/user/notifications', 'notifications'], ['/user/email-change', 'email-change'], ['/user/portfolio', 'portfolio'], ['/onboarding', 'onboarding']];
// (panel/teacher/assignments — uz-kontentli workspace; settings/tapproval — DB-lang dizayni: ?lang= FP)

const findings = [];
const scanPage = async (label, path, authed) => {
  const ctx = await mkCtx(authed ? tseen : null);
  const langs = {};
  for (const [tag, q] of [['uz', 'uz'], ['cyrl', 'uz-cyrl'], ['ru', 'ru'], ['en', 'en']]) {
    try { langs[tag] = await grab(ctx, path + (path.includes('?') ? '&' : '?') + 'lang=' + q); }
    catch (e) { console.log(`  ! ${label}[${tag}] yuklanmadi: ${String(e).slice(0, 60)}`); return; }
  }
  await ctx.close();
  const uzSet = new Set(langs.uz.lines);
  // 1) ru sahifada uz bilan BIR XIL lotin matn -> tarjima qilinmagan
  for (const tag of ['ru', 'cyrl']) {
    const same = langs[tag].lines.filter((l) => uzSet.has(l) && l.match(/[a-z]{4,}/i) && !WHITELIST.test(l));
    if (same.length >= 3) findings.push({ t: `${label}[${tag}] TARJIMASIZ (${same.length} ta uz-lotin matn bir xil)`, s: same.slice(0, 4) });
  }
  // 2) en sahifada o'zbekcha markerlar
  const uzInEn = langs.en.lines.filter((l) => UZ_MARKERS.test(l) && !WHITELIST.test(l));
  if (uzInEn.length >= 2) findings.push({ t: `${label}[en] O'ZBEKCHA QOLDI (${uzInEn.length} ta)`, s: uzInEn.slice(0, 4) });
  // 3) html lang atributi
  const exp = { uz: /^uz(-Latn)?$/, cyrl: /^uz(-Cyrl)?$/i, ru: /^ru$/, en: /^en$/ };
  for (const tag of ['uz', 'cyrl', 'ru', 'en']) {
    if (!exp[tag].test(langs[tag].lang)) findings.push({ t: `${label}[${tag}] html lang="${langs[tag].lang}" NOTO'G'RI` });
  }
};

// ── landing path-based i18n: / , /ru, /en, /uz-cyrl — html lang + kirill/lotin nisbati ──
{
  const ctx = await mkCtx(null);
  for (const [path, expLang, wantCyr] of [['/', 'uz', false], ['/ru', 'ru', true], ['/en', 'en', false], ['/uz-cyrl', 'uz-Cyrl', true]]) {
    const page = await ctx.newPage();
    await page.goto(BASE + path, { waitUntil: 'domcontentloaded' });
    const r = await page.evaluate(() => {
      const t = document.body.innerText || '';
      const cyr = (t.match(/[\u0400-\u04FF]/g) || []).length;
      const lat = (t.match(/[a-zA-Z]/g) || []).length;
      return { lang: document.documentElement.getAttribute('lang') || '(yoq)', cyr, lat };
    });
    const okLang = r.lang.toLowerCase() === expLang.toLowerCase();
    const okScript = wantCyr ? r.cyr > r.lat * 0.8 : r.cyr < r.lat * 0.5;
    console.log(`  ${okLang && okScript ? '✓' : '✗'} landing ${path || '/'}: lang=${r.lang} (kutilgan ${expLang}), cyr=${r.cyr} lat=${r.lat}`);
    if (!okLang) findings.push({ t: `landing ${path} html lang="${r.lang}" (kutilgan ${expLang})` });
    if (!okScript) findings.push({ t: `landing ${path} skript noto'g'ri (cyr=${r.cyr} lat=${r.lat})` });
    await page.close();
  }
  await ctx.close();
}

console.log('── PUB sahifalar ──');
for (const [p, l] of PUB) await scanPage(l, p, false);
console.log('── USER sahifalar ──');
for (const [p, l] of USER) await scanPage(l, p, true);

// ── cookie davomiyligi: ?lang=ru keyin query'siz -> hali ham ru ──
{
  const ctx = await mkCtx(null);
  const p1 = await ctx.newPage();
  await p1.goto(BASE + '/user/login?lang=ru', { waitUntil: 'domcontentloaded' });
  const c = await ctx.cookies();
  const langCookie = c.find((x) => x.name === 'lang');
  await p1.goto(BASE + '/user/login', { waitUntil: 'domcontentloaded' });
  const lang2 = await p1.evaluate(() => document.documentElement.getAttribute('lang'));
  const ruStay = await p1.evaluate(() => document.body.innerText.includes('Вход') || document.body.innerText.includes('войти'));
  console.log(`COOKIE lang=${langCookie ? langCookie.value : '(yo\'q)'}; query'siz keyin html lang=${lang2}, rus matni=${ruStay}`);
  if (lang2 !== 'ru' || !ruStay) findings.push({ t: `COOKIE davomiyligi BUZILGAN (lang=${lang2}, ru matn yo'q)` });
  await p1.close(); await ctx.close();
}

// ── hreflang: landing ──
{
  const ctx = await mkCtx(null);
  const p = await ctx.newPage();
  await p.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  const hr = await p.evaluate(() => Array.from(document.querySelectorAll('link[rel=alternate][hreflang], a[hreflang]')).map((x) => x.getAttribute('hreflang') || x.outerHTML.slice(0, 60)));
  console.log('HREFLANG landing:', hr.length ? hr.join(', ') : '(yo\'q)');
  await p.close(); await ctx.close();
}

// ── cast participant locale=ru: /play join.title ruscha? ──
{
  const ctx = await mkCtx(null);
  const p = await ctx.newPage();
  await p.goto(BASE + '/play?code=' + CODE, { waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(900);
  const t = await p.evaluate(() => {
    const el = document.querySelector('[data-i18n="join.btn"]');
    return { title: el ? el.textContent.trim() : '(yo\'q)', htmlLang: document.documentElement.getAttribute('lang') };
  });
  console.log(`CAST /play (locale=ru): join.title="${t.title}" html lang=${t.htmlLang}`);
  if (!/[\u0400-\u04FF]/.test(t.title)) findings.push({ t: `CAST /play locale=ru TARJIMASIZ: "${t.title}"` });
  await p.close(); await ctx.close();
}

await browser.close();

// ── statik: cast.json / landing / roster pariteti ──
{
  const fs = await import('node:fs');
  const flat = (o, p) => { let r = []; for (const k of Object.keys(o || {})) { const np = p ? p + '.' + k : k; if (o[k] && typeof o[k] === 'object') r = r.concat(flat(o[k], np)); else r.push(np); } return r; };
  const L = ['en', 'ru', 'uz-Cyrl', 'uz-Latn'];
  const dicts = {};
  for (const l of L) dicts[l] = JSON.parse(fs.readFileSync(`locales/${l}/cast.json`, 'utf8'));
  const base = new Set(flat(dicts[L[0]]));
  for (const l of L.slice(1)) {
    const s = new Set(flat(dicts[l]));
    const miss = [...base].filter((k) => !s.has(k));
    if (miss.length) findings.push({ t: `cast.json ${l}: ${miss.length} ta kalit yo'q`, s: miss.slice(0, 5) });
  }
  console.log(`cast.json pariteti: uz-Latn ${base.size} kalit`);
  const same = [...base].filter((k) => {
    const g = (d) => k.split('.').reduce((a, x) => a && a[x], d);
    return typeof g(dicts[L[3]]) === 'string' && g(dicts[L[3]]) === g(dicts.ru) && /[\u0400-\u04FF]/.test(g(dicts.ru)) === false && g(dicts[L[3]]).match(/[a-z]{4,}/i);
  });
  if (same.length >= 3) findings.push({ t: `cast.json ru: ${same.length} ta qiymat uz bilan bir xil (tarjimasiz)`, s: same.slice(0, 4) });
}

console.log(`\n_TOPILDI: ${findings.length} ta i18n topilma:`);
for (const f of findings) console.log('  ✗ ' + f.t + (f.s ? ' | ' + JSON.stringify(f.s) : ''));
srv.kill();
process.exit(findings.length ? 1 : 0);
