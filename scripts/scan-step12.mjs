/**
 * STEP 12 SCANNER — Faza B: qamrab olinmagan qatlamlar (landing, auth, cast, sessions,
 * notifications/settings/email-change/teacher-approval/assignments/portfolio/onboarding, /play)
 * dark+light WCAG kompozit kontrast + FOUC tekshiruvi.
 * Run: NODE_ENV=test LOCAL_DB_FILE=/tmp/s12scan.json node scripts/scan-step12.mjs
 */
const PORT = 4600;
const BASE = `http://localhost:${PORT}`;
const TEACHER = 'repro_s12_t';
const PASS = 'parol-2026-x-uzun';

process.env.NODE_ENV = 'test';
process.env.SESSION_SECRET = 'repro-secret-0123456789abcdef0123456789abcdef';
if (!process.env.LOCAL_DB_FILE) process.env.LOCAL_DB_FILE = '/tmp/s12scan.json';
try { (await import('fs')).rmSync(process.env.LOCAL_DB_FILE, { force: true }); } catch (_) {}

const { fb } = await import('../firebase/admin.js');
const { safeKey, hashPass } = await import('../utils/helpers.js');
const tk = safeKey(TEACHER);
await fb.set(`users/${tk}`, {
  username: TEACHER, email: `${TEACHER}@test.uz`, email_verified: true,
  role: 'teacher', role_version: 1, password: hashPass(PASS, tk), created_at: Date.now(),
});
const { createSession } = await import('../services/cast/session-store.js');
const SID = 's12cast' + Date.now().toString(36);
const CODE = 'S12CST';
await createSession({
  sessionId: SID, joinCode: CODE,
  meta: { title: 'S12 audit darsi' },
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
const agent = Supertest.agent(BASE);
const seen = new Map();
const track = (r) => (r.headers['set-cookie'] || []).forEach((h) => { const [kv] = h.split(';'); const i = kv.indexOf('='); if (i > 0) seen.set(kv.slice(0, i), kv.slice(i + 1)); });
const pg = await agent.get('/user/login?lang=uz'); track(pg);
const csrf = pg.text.match(/name="_csrf" value="([^"]+)"/)[1];
const li = await agent.post('/user/login').type('form').send({ mode: 'login', username: TEACHER, password: PASS, _csrf: csrf, lang: 'uz' }); track(li);
await agent.get('/user/panel');
console.log('login OK');

const { chromium } = await import('playwright');
const browser = await chromium.launch();
const AUDIT = `
  () => {
    const lum = (r, g, b) => {
      const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
      return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
    };
    const parse = (s) => {
      if (!s) return null;
      if (s[0] === '#') { const h = s.slice(1, 7); if (h.length === 6) return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16), a: 1 }; return null; }
      if (s.indexOf('rgb') !== 0) return null;
      const nums = s.replace(/[^0-9.,]/g, '').split(',').map(Number).filter((x) => !isNaN(x));
      if (nums.length < 3) return null;
      return { r: nums[0], g: nums[1], b: nums[2], a: nums.length > 3 ? nums[3] : 1 };
    };
    const blend = (fg, bg) => ({ r: fg.r * fg.a + bg.r * (1 - fg.a), g: fg.g * fg.a + bg.g * (1 - fg.a), b: fg.b * fg.a + bg.b * (1 - fg.a), a: 1 });
    const stopsOf = (img) => {
      const out = [];
      const parts = String(img).split('rgb(');
      for (let k = 1; k < parts.length; k++) {
        const nums = parts[k].slice(0, parts[k].indexOf(')') + 1).replace(/[^0-9.,]/g, '').split(',').map(Number).filter((x) => !isNaN(x));
        if (nums.length >= 3) { const p = { r: nums[0], g: nums[1], b: nums[2], a: nums.length > 3 ? nums[3] : 1 }; if (p.a > 0.05) out.push(p); }
      }
      const hx = String(img).split('#');
      for (let k = 1; k < hx.length; k++) {
        const h = hx[k].slice(0, 6);
        if (/^[0-9a-fA-F]{6}$/.test(h)) out.push({ r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16), a: 1 });
      }
      return out;
    };
    const bgOf = (el) => {
      // barcha ota qatlamlarni yig'ib, body ustida to'liq kompozit qilamiz
      const layers = [];
      let gradStops = null;
      let n = el;
      while (n && n !== document.documentElement) {
        const cs2 = getComputedStyle(n);
        const img = cs2.backgroundImage || '';
        if (img && img.includes('gradient')) {
          const stops = stopsOf(img);
          if (stops.length) { gradStops = stops; break; }
        }
        const c = parse(cs2.backgroundColor);
        if (c && c.a > 0.05) layers.push(c);
        n = n.parentElement;
      }
      if (gradStops) return { stops: gradStops };
      let acc = parse(getComputedStyle(document.body).backgroundColor) || { r: 255, g: 255, b: 255, a: 1 };
      for (let i = layers.length - 1; i >= 0; i--) acc = blend(layers[i], acc);
      return { bg: acc };
    };
    const out = [];
    const els = document.querySelectorAll('body *');
    for (const el of els) {
      if (el.offsetParent === null && el.tagName !== 'BODY') continue;
      if (['SCRIPT', 'STYLE', 'SVG', 'PATH', 'NOSCRIPT', 'TEMPLATE'].includes(el.tagName)) continue;
      // faqat to'g'ridan-to'g'ri matnli elementlar
      const direct = Array.from(el.childNodes).filter((n) => n.nodeType === 3 && n.textContent.trim().length > 1);
      if (!direct.length) continue;
      const cs = getComputedStyle(el);
      if (cs.visibility === 'hidden' || cs.display === 'none' || +cs.opacity === 0) continue;
      const fg = parse(cs.color);
      if (!fg) continue;
      const ratioBetween = (a, b) => { const l1 = lum(a.r, a.g, a.b), l2 = lum(b.r, b.g, b.b); return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05); };
      const ownImg = cs.backgroundImage || '';
      const ownStops = ownImg.includes('gradient') ? stopsOf(ownImg) : [];
      let bg, ratio;
      const fill = parse(cs.webkitTextFillColor || '');
      if (fill && fill.a < 0.05 && ownStops.length) {
        // gradient matn (background-clip:text): stoplar — FG, ota-element foni — BG
        const pbr = bgOf(el.parentElement || document.body); const pb = pbr.bg || (pbr.stops ? pbr.stops[0] : { r: 255, g: 255, b: 255, a: 1 });
        ratio = Math.min(...ownStops.map((s) => ratioBetween(s, pb)));
        bg = pb;
      } else if (ownStops.length) {
        bg = ownStops[0];
        ratio = Math.min(...ownStops.map((s) => ratioBetween(fg, s)));
      } else {
        const res = bgOf(el);
        if (res.stops) { bg = res.stops[0]; ratio = Math.min(...res.stops.map((s) => ratioBetween(fg, s))); }
        else { bg = res.bg; ratio = ratioBetween(blend(fg, bg), bg); }
      }
      const size = parseFloat(cs.fontSize);
      const bold = +cs.fontWeight >= 700;
      const large = size >= 24 || (size >= 18.66 && bold);
      const need = large ? 3.0 : 4.5;
      if (ratio < need - 0.02) {
        out.push({ t: direct[0].textContent.trim().slice(0, 24), s: el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + (el.className && typeof el.className === 'string' && el.className ? '.' + el.className.split(' ').slice(0, 3).join('.') : '') + ' ←' + (el.parentElement && el.parentElement.id ? '#' + el.parentElement.id : el.parentElement ? el.parentElement.tagName.toLowerCase() : ''), r: +ratio.toFixed(2), n: need, fg: cs.color, bg: 'bg(' + Math.round(bg.r) + ',' + Math.round(bg.g) + ',' + Math.round(bg.b) + ') img=[' + ownImg.slice(0, 70) + ']' });
      }
    }
    // Form controllar: input/textarea/select — qiymat/placeholderning rangi
    for (const el of document.querySelectorAll('input, textarea, select')) {
      if (el.offsetParent === null && el.tagName !== 'BODY') continue;
      if (el.type === 'hidden') continue;
      const cs = getComputedStyle(el);
      if (cs.visibility === 'hidden' || cs.display === 'none') continue;
      if (['submit', 'button', 'checkbox', 'radio', 'file', 'hidden', 'range', 'color', 'image'].includes(el.type || '')) continue;
      const fg = parse(cs.color);
      if (!fg) continue;
      const ratioBetween = (a, b) => { const l1 = lum(a.r, a.g, a.b), l2 = lum(b.r, b.g, b.b); return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05); };
      const ownImg = cs.backgroundImage || '';
      const ownStops = ownImg.includes('gradient') ? stopsOf(ownImg) : [];
      let bg, ratio;
      if (ownStops.length) {
        bg = ownStops[0];
        ratio = Math.min(...ownStops.map((s) => ratioBetween(fg, s)));
      } else {
        const res = bgOf(el);
        if (res.stops) { bg = res.stops[0]; ratio = Math.min(...res.stops.map((s) => ratioBetween(fg, s))); }
        else { bg = res.bg; ratio = ratioBetween(blend(fg, bg), bg); }
      }
      if (ratio < 4.48) {
        out.push({ t: '[input]' + (el.id ? '#' + el.id : el.name || ''), s: '', r: +ratio.toFixed(2), n: 4.5 });
      }
    }
    return out;
  }
`;
async function audit(ctx, path, label) {
  const page = await ctx.newPage();
  await page.goto(`${BASE}${path}`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(700);
  if (!page.url().includes(path.split('?')[0].slice(0, 20))) console.log(`  ! ${label}: redirect → ${page.url()}`);
  const res = await page.evaluate(`(${AUDIT})()`);
  await page.close();
  return (res || []).slice(0, 60).map((v) => `${label}: "${v.t}" ${v.s} = ${v.r}:1 fg=${v.fg} ${v.bg || ''}`);
}

const mkCtx = async (dark) => {
  const ctx = await browser.newContext();
  await ctx.addCookies([...seen.entries()].map(([name, value]) => ({ name, value, url: BASE })));
  await ctx.addInitScript((d) => { try { localStorage.setItem('deborah-theme-state', d ? 'dark' : 'light'); localStorage.setItem('deborah-theme', d ? 'dark' : 'light'); } catch (_) {} }, dark);
  return ctx;
};
const darkCtx = await mkCtx(true), lightCtx = await mkCtx(false), pubDark = await mkCtx(true), pubLight = await mkCtx(false);

const PUB = [['/', 'landing'], ['/user/login?lang=uz', 'login'], ['/user/register?lang=uz', 'register'], ['/privacy', 'privacy'], ['/user/forgot?lang=uz', 'forgot'], ['/user/reset?lang=uz', 'reset'], ['/admin/login?lang=uz', 'admin-login']];
const USER = [['/sessions', 'sessions'], ['/user/notifications', 'notifications'], ['/user/settings', 'settings'], ['/user/email-change', 'email-change'], ['/user/teacher-approval', 'tapproval'], ['/user/assignments', 'assignments'], ['/user/portfolio', 'portfolio'], ['/onboarding', 'onboarding']];
const CAST = [['/cast/' + SID + '/director', 'cast-director'], ['/cast/' + SID + '/projector', 'cast-projector'], ['/cast/' + SID + '/results', 'cast-results'], ['/cast/' + SID + '/quality-lab', 'cast-quality'], ['/play?code=' + CODE, 'play-enter']];

let all = [];
for (const [p, l] of PUB) all = all.concat(await audit(pubDark, p, l + '[d]'));
for (const [p, l] of USER) all = all.concat(await audit(darkCtx, p, l + '[d]'));
for (const [p, l] of CAST) all = all.concat(await audit(darkCtx, p, l));
all = all.concat(await audit(darkCtx, '/user/logout', 'logout-confirm'));
// rol workspace'lari — admin superuser bypass bilan
{
  const { default: ST } = await import('supertest');
  const adm = ST.agent(BASE);
  const ap = await adm.get('/admin/login?lang=uz');
  const ac = ap.text.match(/name="_csrf" value="([^"]+)"/)[1];
  const ali = await adm.post('/admin/login').type('form').send({ username: 'repro_admin', password: 'repro-pass-123', _csrf: ac, lang: 'uz' });
  const aseen = new Map();
  [ap, ali, await adm.get('/admin/dashboard')].forEach((r) => (r.headers['set-cookie'] || []).forEach((h) => { const [kv] = h.split(';'); const i = kv.indexOf('='); aseen.set(kv.slice(0, i), kv.slice(i + 1)); }));
  const actx = await browser.newContext();
  await actx.addCookies([...aseen.entries()].map(([name, value]) => ({ name, value, url: BASE })));
  await actx.addInitScript(() => { try { localStorage.setItem('deborah-theme-state', 'dark'); } catch (_) {} });
  for (const [p, l] of [['/student', 'role-student'], ['/proctor', 'role-proctor'], ['/marker', 'role-marker'], ['/board', 'role-board']]) {
    all = all.concat(await audit(actx, p, l));
  }
}

// FOUC: saqlangan light tema birinchi DOMContentLoaded'da qo'llanganmi (head early resolver isboti)
{
  const page = await pubLight.newPage();
  await page.addInitScript(() => {
    document.addEventListener('DOMContentLoaded', function () { try { window.__earlyTheme = document.documentElement.getAttribute('data-theme'); } catch (_) {} });
  });
  await page.goto(BASE + '/', { waitUntil: 'load' });
  const early = await page.evaluate(() => window.__earlyTheme || '(yo\'q)');
  const now = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
  console.log(`FOUC landing: DOMContentLoaded'da=${early}, yakuniy=${now} (kutilgan: light/light)`);
  await page.close();
}

// Mobil gorizontal overflow (390×844): scrollWidth > innerWidth + 1px = buzilish
{
  const m = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await m.addCookies([...seen.entries()].map(([name, value]) => ({ name, value, url: BASE })));
  const MOB = [['/', 'landing'], ['/user/login?lang=uz', 'login'], ['/user/panel', 'panel'], ['/sessions', 'sessions'], ['/user/notifications', 'notifications'], ['/user/settings', 'settings'], ['/teacher', 'teacher'], ['/admin/dashboard', 'admin-dash'], ['/admin/teachers', 'admin-teachers'], ['/admin/index', 'admin-index']];
  for (const [p, l] of MOB) {
    const page = await m.newPage();
    await page.goto(BASE + p, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(500);
    const ov = await page.evaluate(() => {
      const d = document.scrollingElement || document.documentElement;
      return { sw: d.scrollWidth, iw: window.innerWidth, offenders: (function () {
        const bad = [];
        for (const el of document.querySelectorAll('body *')) {
          if (el.scrollWidth > (document.scrollingElement || document.documentElement).clientWidth + 2 && bad.length < 3) {
            const r = el.getBoundingClientRect();
            if (r.width > 0) bad.push(el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + '.' + String(el.className).split(' ')[0]);
          }
        }
        return bad;
      })() };
    });
    const diff = ov.sw - ov.iw;
    console.log(`MOB ${l}: scrollWidth=${ov.sw} innerWidth=${ov.iw} ${diff > 1 ? '✗ OVERFLOW +' + diff + 'px ' + JSON.stringify(ov.offenders) : '✓'}`);
    await page.close();
  }
}

console.log(`\n_TOPILDI: ${all.length} ta kontrast buzilishi:`);
for (const v of all) console.log('  \u2717 ' + v);
await browser.close();
srv.kill();
process.exit(all.length ? 1 : 0);
