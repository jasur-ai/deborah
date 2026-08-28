/**
 * STEP 13 SCANNER — Mobil qatlam: gorizontal overflow (390 + 320), touch targetlar
 * (WCAG 2.5.8 ≥24px), iOS input auto-zoom (<16px font), fixed/sticky offscreen,
 * atayin-kesilmagan clipped matn.
 * Run: node scripts/scan-step13.mjs  (PORT 4604)
 */
const PORT = 4604;
const BASE = `http://localhost:${PORT}`;
const TEACHER = 'repro_s13_t';
const PASS = 'parol-2026-x-uzun';

process.env.NODE_ENV = 'test';
process.env.SESSION_SECRET = 'repro-secret-0123456789abcdef0123456789abcdef';
if (!process.env.LOCAL_DB_FILE) process.env.LOCAL_DB_FILE = '/tmp/s13scan.json';
try { (await import('fs')).rmSync(process.env.LOCAL_DB_FILE, { force: true }); } catch (_) {}

const { fb } = await import('../firebase/admin.js');
const { safeKey, hashPass } = await import('../utils/helpers.js');
const tk = safeKey(TEACHER);
await fb.set(`users/${tk}`, {
  username: TEACHER, email: `${TEACHER}@test.uz`, email_verified: true,
  role: 'teacher', role_version: 1, password: hashPass(PASS, tk), created_at: Date.now(),
});
const { createSession } = await import('../services/cast/session-store.js');
const SID = 's13cast' + Date.now().toString(36);
const CODE = 'S13CST';
await createSession({
  sessionId: SID, joinCode: CODE,
  meta: { title: 'S13 audit darsi' },
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
const collectCookies = (seen, r) => (r.headers['set-cookie'] || []).forEach((h) => { const [kv] = h.split(';'); const i = kv.indexOf('='); if (i > 0) seen.set(kv.slice(0, i), kv.slice(i + 1)); });

// teacher cookie
const agent = Supertest.agent(BASE);
const tseen = new Map();
const pg = await agent.get('/user/login?lang=uz'); collectCookies(tseen, pg);
const csrf = pg.text.match(/name="_csrf" value="([^"]+)"/)[1];
const li = await agent.post('/user/login').type('form').send({ mode: 'login', username: TEACHER, password: PASS, _csrf: csrf, lang: 'uz' });
collectCookies(tseen, li);
await agent.get('/user/panel');
collectCookies(tseen, await agent.get('/user/panel'));
console.log('teacher login OK');

// admin cookie
const adm = Supertest.agent(BASE);
const aseen = new Map();
const ap = await adm.get('/admin/login?lang=uz'); collectCookies(aseen, ap);
const ac = ap.text.match(/name="_csrf" value="([^"]+)"/)[1];
const ali = await adm.post('/admin/login').type('form').send({ username: 'repro_admin', password: 'repro-pass-123', _csrf: ac, lang: 'uz' });
collectCookies(aseen, ali);
const dash = await adm.get('/admin/dashboard');
collectCookies(aseen, dash);
if (dash.status !== 200) { console.log('admin login FAIL', dash.status, ali.status); }
console.log('admin login OK');

const { chromium } = await import('playwright');
const browser = await chromium.launch();

// ── sahifadagi mobil audit (evaluate) ──
async function pageAudit(page) {
  return page.evaluate(() => {
    const iw = window.innerWidth;
    const d = document.scrollingElement || document.documentElement;
    const vis = (el) => { if (el.offsetParent === null && el.tagName !== 'BODY') return false; const cs = getComputedStyle(el); return cs.visibility !== 'hidden' && cs.display !== 'none' && +cs.opacity !== 0; };
    const tag = (el) => el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + '.' + String(el.className && typeof el.className === 'string' ? el.className.split(' ').slice(0, 2).join('.') : '');
    const out = { ow: d.scrollWidth - iw, offenders: [], targets: [], inputs: [], fixed: [], clipped: [] };
    // 1) gorizontal overflow offenderlari (chapga/chapga+o'ngga chiqqan leaf/box)
    for (const el of document.querySelectorAll('body *')) {
      if (!vis(el) || ['SCRIPT', 'STYLE', 'SVG', 'PATH', 'NOSCRIPT', 'TEMPLATE'].includes(el.tagName)) continue;
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.right > iw + 2 && out.offenders.length < 4) out.offenders.push(tag(el) + ` →right +${Math.round(r.right - iw)}`);
    }
    // 2) touch targetlar (WCAG 2.5.8): tugma/tanlov nazoratchilari ≥24px; icon-linklar
    const TSEL = 'button, input[type=submit], input[type=button], input[type=checkbox], input[type=radio], input[type=file], select, [role=button], summary';
    for (const el of document.querySelectorAll(TSEL)) {
      if (!vis(el)) continue;
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) continue;
      const m = Math.min(r.width, r.height);
      if (m < 22 && out.targets.length < 10) out.targets.push({ t: (el.textContent || el.value || el.getAttribute('aria-label') || el.getAttribute('title') || '').trim().slice(0, 18), s: tag(el), w: +r.width.toFixed(0), h: +r.height.toFixed(0) });
    }
    for (const el of document.querySelectorAll('a[href]')) {
      if (!vis(el)) continue;
      const txt = (el.textContent || '').trim();
      const iconOnly = !txt || txt.length <= 2 || el.querySelector('img, svg');
      if (!iconOnly) continue;
      const im = el.querySelector('img');
      if (im && !im.naturalWidth) continue; // rasm hali yuklanmagan — vaqtinchalik o'lchov, FP
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) continue;
      if (Math.min(r.width, r.height) < 22 && out.targets.length < 10) out.targets.push({ t: txt || (el.getAttribute('aria-label') || 'icon-link'), s: tag(el), w: +r.width.toFixed(0), h: +r.height.toFixed(0), html: el.outerHTML.slice(0, 100).replace(/\s+/g, ' ') });
    }
    // 3) iOS auto-zoom: input/textarea/select font-size < 16px
    for (const el of document.querySelectorAll('input, textarea, select')) {
      if (['checkbox', 'radio', 'hidden', 'submit', 'button', 'file', 'range', 'color', 'image'].includes(el.type || '')) continue;
      if (!vis(el)) continue;
      const fs = parseFloat(getComputedStyle(el).fontSize);
      if (fs < 15.5 && out.inputs.length < 8) out.inputs.push({ t: el.id || el.name || el.placeholder || 'input', s: tag(el), fs });
    }
    // 4) fixed/sticky element viewportdan chiqqan
    for (const el of document.querySelectorAll('body *')) {
      const cs = getComputedStyle(el);
      if (cs.position !== 'fixed' && cs.position !== 'sticky') continue;
      if (!vis(el)) continue;
      const r = el.getBoundingClientRect();
      if (cs.transform !== 'none') continue; // atayin off-canvas drawer (translateX) — FP emas
      if ((r.left < -1 || r.right > iw + 1) && out.fixed.length < 4) out.fixed.push(tag(el) + ` L${Math.round(r.left)} R${Math.round(r.right)} iw=${iw}`);
    }
    // 5) atayin bo'lmagan kesilgan matn (interactive + sarlavha tablar)
    for (const el of document.querySelectorAll('button, a, th, .tab, [role=tab], label, h1, h2, h3')) {
      if (!vis(el)) continue;
      const cs = getComputedStyle(el);
      if (cs.position === 'absolute' && (parseFloat(cs.width) <= 2 || cs.clip !== 'none' || cs.clipPath !== 'none')) continue; // sr-only pattern — FP emas
      if (cs.overflowX !== 'hidden' && cs.overflow !== 'hidden') continue;
      if (cs.textOverflow === 'ellipsis') continue;
      const direct = Array.from(el.childNodes).some((n) => n.nodeType === 3 && n.textContent.trim().length > 1);
      if (!direct) continue;
      if (el.scrollWidth > el.clientWidth + 3 && out.clipped.length < 6) out.clipped.push(tag(el) + ` sw${el.scrollWidth}>cw${el.clientWidth}`);
    }
    return out;
  });
}

async function scan(ctx, path, label, mode) {
  const page = await ctx.newPage();
  try {
    await page.goto(`${BASE}${path}`, { waitUntil: 'load', timeout: 25000 });
    await page.waitForTimeout(400);
    // lazy img'lar to'liq yuklansin (nomutanosib o'lchov FP'siga qarshi)
    await page.evaluate(() => Promise.race([
      Promise.all(Array.from(document.images).map((i) => i.complete ? 1 : new Promise((r) => { i.onload = i.onerror = () => r(1); }))),
      new Promise((r) => setTimeout(r, 2500)),
    ]));
    if (mode === 'full') {
      const a = await pageAudit(page);
      if (a.ow > 1) console.log(`  ✗ ${label} [390] OVERFLOW +${a.ow}px ${JSON.stringify(a.offenders)}`);
      for (const t of a.targets) console.log(`  ✗ ${label} [390] TARGET <24px "${t.t}" ${t.s} ${t.w}×${t.h} ${t.html || ""}`);
      for (const t of a.inputs) console.log(`  ✗ ${label} [390] INPUT-ZOOM ${t.s} "${t.t}" fs=${t.fs}px`);
      for (const f of a.fixed) console.log(`  ✗ ${label} [390] FIXED-OFF ${f}`);
      for (const c of a.clipped) console.log(`  ✗ ${label} [390] CLIPPED ${c}`);
      if (a.ow <= 1 && !a.targets.length && !a.inputs.length && !a.fixed.length && !a.clipped.length) console.log(`  ✓ ${label} [390]`);
    } else {
      const ow = await page.evaluate(() => (document.scrollingElement || document.documentElement).scrollWidth - window.innerWidth);
      if (ow > 1) console.log(`  ✗ ${label} [320] OVERFLOW +${ow}px`);
    }
  } catch (e) {
    console.log(`  ! ${label} [${mode}] ${String(e).slice(0, 80)}`);
  }
  await page.close();
}

const mkCtx = async (w, h, cookies) => {
  const ctx = await browser.newContext({ viewport: { width: w, height: h } });
  await ctx.addCookies([...cookies.entries()].map(([name, value]) => ({ name, value, url: BASE })));
  await ctx.addInitScript(() => { try { localStorage.setItem('deborah-theme-state', 'light'); } catch (_) {} });
  return ctx;
};

const PUB = process.env.S13_ONLY ? [] : [['/', 'landing'], ['/user/login?lang=uz', 'login'], ['/user/register?lang=uz', 'register'], ['/user/forgot?lang=uz', 'forgot'], ['/user/reset?lang=uz', 'reset'], ['/privacy', 'privacy'], ['/admin/login?lang=uz', 'admin-login'], ['/play?code=' + CODE, 'play-enter'], ['/verify', 'credential-verify']];
const USER = process.env.S13_ONLY ? [['/user/portfolio', 'portfolio']] : [['/user/panel', 'panel'], ['/sessions', 'sessions'], ['/user/notifications', 'notifications'], ['/user/settings', 'settings'], ['/user/email-change', 'email-change'], ['/user/assignments', 'assignments'], ['/user/portfolio', 'portfolio'], ['/onboarding', 'onboarding'], ['/teacher', 'teacher'], ['/user/camera', 'camera'], ['/user/telegram/link', 'telegram-link']];
const CAST = process.env.S13_ONLY ? [] : [['/cast/' + SID + '/director', 'cast-director'], ['/cast/' + SID + '/projector', 'cast-projector'], ['/cast/' + SID + '/results', 'cast-results'], ['/cast/' + SID + '/quality-lab', 'cast-quality']];
const ADMIN = process.env.S13_ONLY ? [] : [['/admin/dashboard', 'adm-dash'], ['/admin/users', 'adm-users'], ['/admin/audit', 'adm-audit'], ['/admin/email', 'adm-email'], ['/admin/roster', 'adm-roster'], ['/admin/vip', 'adm-vip'], ['/admin/accessibility', 'adm-a11y'], ['/admin/acceptance', 'adm-acceptance'], ['/admin/canva', 'adm-canva'], ['/admin/camera', 'adm-camera'], ['/admin/consideration', 'adm-consideration'], ['/admin/credentials', 'adm-credentials'], ['/admin/board', 'adm-board'], ['/student', 'role-student'], ['/board', 'role-board']];

console.log('\n── FULL AUDIT 390×844 ──');
const pubC = await mkCtx(390, 844, new Map());
const tC = await mkCtx(390, 844, tseen);
const aC = await mkCtx(390, 844, aseen);
for (const [p, l] of PUB) await scan(pubC, p, l, 'full');
for (const [p, l] of USER) await scan(tC, p, l, 'full');
for (const [p, l] of CAST) await scan(tC, p, l, 'full');
for (const [p, l] of ADMIN) await scan(aC, p, l, 'full');

console.log('\n── OVERFLOW-ONLY 320×568 ──');
const pubC320 = await mkCtx(320, 568, new Map());
const tC320 = await mkCtx(320, 568, tseen);
const aC320 = await mkCtx(320, 568, aseen);
if (!process.env.S13_ONLY) for (const [p, l] of PUB) await scan(pubC320, p, l, '320');
if (!process.env.S13_ONLY) for (const [p, l] of USER) await scan(tC320, p, l, '320');
if (!process.env.S13_ONLY) for (const [p, l] of CAST) await scan(tC320, p, l, '320');
if (!process.env.S13_ONLY) for (const [p, l] of ADMIN) await scan(aC320, p, l, '320');

// viewport meta — zoom blokirovkasi (a11y)
{
  const page = await pubC.newPage();
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  const meta = await page.evaluate(() => { const m = document.querySelector('meta[name=viewport]'); return m ? m.content : '(yo\'q)'; });
  console.log(`\nVIEWPORT meta: ${meta}${/maximum-scale=1|user-scalable=no/.test(meta) ? ' ✗ ZOOM BLOKLANGAN' : ' ✓ zoom ochiq'}`);
  await page.close();
}

await browser.close();
srv.kill();
process.exit(0);
