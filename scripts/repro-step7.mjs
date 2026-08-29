/**
 * REPRO STEP 7 (debugging branch): DARK MODE kontrast — WCAG skaner
 * ----------------------------------------------------------------
 * Buglar: BUG-023 (.btn.green ~1.04), BUG-024 (arena inputlar 1.17),
 * BUG-025 (/admin/teachers badge/link 1.58/1.81) + skan topilmalari.
 *
 * Usul: har sahifa dark rejimda (localStorage deborah-theme-state=dark)
 * ochiladi → barcha KO'RINADIGAN text elementlarida fond ustidagi
 * haqiqiy kompozit kontrast WCAG 2.2 formulasi bilan o'lchanadi.
 * Normal text < 4.5:1, large/bold text < 3.0:1 → buzilish.
 * Run: NODE_ENV=test LOCAL_DB_FILE=/tmp/repro-step7-db.json node scripts/repro-step7.mjs
 */
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';

const PORT = 4584;
const BASE = `http://localhost:${PORT}`;
const STAMP = Date.now() % 1000000;
const TEACHER = `repro_s7_${STAMP}`;
const PASS = 'parol-2026-x-uzun';

process.env.NODE_ENV = 'test';
process.env.SESSION_SECRET = 'repro-secret-0123456789abcdef0123456789abcdef';
if (!process.env.LOCAL_DB_FILE) process.env.LOCAL_DB_FILE = '/tmp/repro-step7-db.json';
try { (await import('fs')).rmSync(process.env.LOCAL_DB_FILE, { force: true }); } catch (_) {}
const { fb } = await import('../firebase/admin.js');
const { safeKey, hashPass } = await import('../utils/helpers.js');
const tk = safeKey(TEACHER);
await fb.set(`users/${tk}`, {
  username: TEACHER, email: `${TEACHER}@test.uz`, email_verified: true,
  role: 'teacher', role_version: 1, password: hashPass(PASS, tk), created_at: Date.now(),
});
console.log('seed OK (teacher)');

const srv = spawn('node', ['server.js'], {
  env: { ...process.env, PORT: String(PORT),
    SESSION_SECRET: 'repro-secret-0123456789abcdef0123456789abcdef',
    ADMIN_USER: 'repro_admin', ADMIN_PASS: 'repro-pass-123', LOG_LEVEL: 'silent' },
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

// login (teacher — user sahifalar) + admin login
const { default: Supertest } = await import('supertest');
async function login(path, post, creds) {
  const agent = Supertest.agent(BASE);
  const seen = new Map();
  const track = (res) => (res.headers['set-cookie'] || []).forEach((h) => {
    const [kv] = h.split(';'); const i = kv.indexOf('=');
    if (i > 0) seen.set(kv.slice(0, i), kv.slice(i + 1));
  });
  const pg = await agent.get(path); track(pg);
  const csrf = pg.text.match(/name="_csrf" value="([^"]+)"/)[1];
  const li = await agent.post(post).type('form').send({ ...creds, _csrf: csrf, lang: 'uz' }); track(li);
  return { agent, seen };
}
const T = await login('/user/login?lang=uz', '/user/login', { mode: 'login', username: TEACHER, password: PASS });
const A = await login('/admin/login?lang=uz', '/admin/login', { username: 'repro_admin', password: 'repro-pass-123' });
// admin cookielarini ham olish (dashboard so'rovidan)
{
  const d = await A.agent.get('/admin/dashboard');
  d.headers['set-cookie']?.forEach((h) => {
    const [kv] = h.split(';'); const i = kv.indexOf('=');
    if (i > 0) A.seen.set(kv.slice(0, i), kv.slice(i + 1));
  });
  const d2 = await T.agent.get('/user/panel');
  d2.headers['set-cookie']?.forEach((h) => {
    const [kv] = h.split(';'); const i = kv.indexOf('=');
    if (i > 0) T.seen.set(kv.slice(0, i), kv.slice(i + 1));
  });
}
console.log('login OK (teacher + admin)');

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
  if (!page.url().includes(path.split('?')[0])) console.log(`  ! ${label}: redirect → ${page.url()}`);
  const res = await page.evaluate(`(${AUDIT})()`);
  await page.close();
  return res.slice(0, 60).map((v) => `${label}: "${v.t}" ${v.s} = ${v.r}:1 fg=${v.fg} ${v.bg}`);
}

const mkCtx = async (cookies) => { const c = await browser.newContext(); await c.addCookies([...cookies.entries()].map(([name, value]) => ({ name, value, url: BASE }))); return c; };
const darkInit = () => { try { localStorage.setItem('deborah-theme-state', 'dark'); localStorage.setItem('deborah-theme', 'dark'); } catch (_) {} };
const lightInit = () => { try { localStorage.setItem('deborah-theme-state', 'light'); localStorage.setItem('deborah-theme', 'light'); } catch (_) {} };
const tctx = await mkCtx(T.seen); await tctx.addInitScript(darkInit);
const actx = await mkCtx(A.seen); await actx.addInitScript(darkInit);
const tctxL = await mkCtx(T.seen); await tctxL.addInitScript(lightInit);
const actxL = await mkCtx(A.seen); await actxL.addInitScript(lightInit);

const PAGES_USER = [
  ['/user/panel', 'panel'], ['/user/test-arena', 'arena'], ['/user/create-test', 'create-test'],
  ['/user/profile', 'profile'], ['/user/security-profile', 'security'], ['/teacher', 'teacher'],
];
const PAGES_ADMIN = [
  ['/admin/dashboard', 'dashboard'], ['/admin/marking', 'marking'], ['/admin/grading', 'grading'],
  ['/admin/board', 'board'], ['/admin/teachers', 'teachers'], ['/admin/users', 'users'],
  ['/admin/consideration', 'consideration'], ['/admin/seating', 'seating'], ['/admin/scan', 'scan'],
  ['/admin/scheduler', 'scheduler'], ['/admin/paper', 'paper'], ['/admin/command-center', 'command'],
];

let all = [];
for (const [p, l] of PAGES_USER) all = all.concat(await audit(tctx, p, l));
for (const [p, l] of PAGES_ADMIN) all = all.concat(await audit(actx, p, l));
for (const [p, l] of PAGES_USER) all = all.concat((await audit(tctxL, p, l + '[light]')).map((x) => x));
for (const [p, l] of PAGES_ADMIN) all = all.concat(await audit(actxL, p, l + '[light]'));

console.log(`\n_TOPILDI: ${all.length} ta kontrast buzilishi (dark+light rejim):`);
for (const v of all) console.log('  ✗ ' + v);
await browser.close();
srv.kill();
process.exit(all.length ? 1 : 0);
