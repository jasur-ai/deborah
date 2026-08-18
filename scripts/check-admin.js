#!/usr/bin/env node
/**
 * STEP 33 — Admin dashboard redesign va security-sensitive UI cleanup validator.
 * Run: node scripts/check-admin.js
 */
import { readFileSync, existsSync } from 'fs';
let fails = 0;
const ok = (m) => console.log('  ✓ ' + m);
const bad = (m) => { console.log('  ✗ ' + m); fails += 1; };
const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

console.log('STEP 33 — Admin dashboard redesign va security-sensitive UI cleanup');

// ── S33.01: 64px topbar, 220px sidebar, main max 1440px ──
console.log('\nS33.01 — Admin layout (64px topbar, 220px sidebar, max 1440px)');
const adminCss = readFileSync('public/css/admin.css', 'utf8');
const cssBody = stripComments(adminCss);
if (!/height: 64px/.test(cssBody)) bad("S33.01: navbar 64px emas");
else ok('S33.01: navbar 64px');
if (!/width: 220px/.test(cssBody)) bad("S33.01: sidebar 220px emas");
else ok('S33.01: sidebar 220px');
if (!/max-width: 1440px/.test(cssBody)) bad("S33.01: main max 1440px emas");
else ok('S33.01: main max 1440px');

// ── S33.02: mobile drawer (display:none emas) ──
console.log('\nS33.02 — Mobile drawer/bottom nav');
if (!/admin-nav-hamburger/.test(cssBody) || !/translateX\(-104%\)/.test(cssBody)) bad("S33.02: mobile drawer off-canvas yo'q");
else ok('S33.02: mobile drawer off-canvas');
if (!/toggleAdminDrawer/.test(readFileSync('views/admin/dashboard.ejs', 'utf8'))) bad("S33.02: drawer toggle funksiyasi yo'q");
else ok('S33.02: drawer toggle mavjud');

// ── S33.03: password UI'dan butunlay chiqdi ──
console.log('\nS33.03 — Password hash/plain password UI dan chiqdi');
for (const f of ['views/admin/dashboard.ejs', 'views/admin/vip.ejs']) {
  const src = readFileSync(f, 'utf8');
  if (/plainPassword|Parol \(hash\)|u\.password|data\.plainPassword/.test(src)) bad(`S33.03: ${f} da password qoldiq`);
  else ok(`S33.03: ${f} toza`);
}
const adminRoute = readFileSync('routes/admin.js', 'utf8');
if (/password:/.test(adminRoute) && !/S33\.03/.test(adminRoute)) bad("S33.03: routes/admin.js da password payload qoldiq");
else ok('S33.03: routes/admin.js password payload olib tashlandi');
if (/plainPassword:/.test(adminRoute) && !/never|S33\.03/.test(adminRoute)) bad("S33.03: routes/admin.js plainPassword qaytadi");
else ok('S33.03: routes/admin.js plainPassword chiqarilmadi');

// ── S33.04: task-based section guruhlash ──
console.log('\nS33.04 — Task-based sections');
const dashSrc = readFileSync('views/admin/dashboard.ejs', 'utf8');
const labels = (dashSrc.match(/admin-side-label[^>]*>([^<]+)</g) || []).length;
if (labels < 5) bad('S33.04: sidebar section guruhlari kam');
else ok(`S33.04: ${labels} ta section guruhlari`);

// ── S33.05: tables STEP 18 (dt/density/filters) ──
console.log('\nS33.05 — Tables (dt-wrap/dt/density)');
if (!/class="dt"/.test(readFileSync('views/admin/vip.ejs', 'utf8'))) bad("S33.05: vip table dt emas");
else ok('S33.05: vip table dt');
if (!/dt-row/.test(readFileSync('views/admin/vip.ejs', 'utf8'))) bad("S33.05: vip dt-row yo'q");
else ok('S33.05: vip dt-row');

// ── S33.06: inline styles keskin kamaygan ──
console.log('\nS33.06 — Inline styles kamaygan');
const inlineDash = (readFileSync('views/admin/dashboard.ejs', 'utf8').match(/style="/g) || []).length;
const inlineVip = (readFileSync('views/admin/vip.ejs', 'utf8').match(/style="/g) || []).length;
if (inlineDash >= 100) bad(`S33.06: dashboard inline style ${inlineDash} (>=100)`);
else ok(`S33.06: dashboard inline ${inlineDash} (<100)`);
if (inlineVip >= 25) bad(`S33.06: vip inline style ${inlineVip} (>=25)`);
else ok(`S33.06: vip inline ${inlineVip} (<25)`);

// ── S33.07: stats actionable ──
console.log('\nS33.07 — Stats actionable');
if (!/data-go=/.test(dashSrc)) bad("S33.07: stat-card data-go yo'q");
else ok('S33.07: stat-card actionable (data-go)');
if (!/\.stat-card/.test(cssBody)) bad("S33.07: stat-card CSS yo'q");
else ok('S33.07: stat-card CSS');

// ── S33.08: status ranglar ──
console.log('\nS33.08 — Status colors (signal cyan / warning amber / danger)');
if (!/admin-status--info/.test(cssBody) || !/admin-status--warn/.test(cssBody) || !/admin-status--danger/.test(cssBody)) bad("S33.08: status class'lar yo'q");
else ok('S33.08: info/warn/danger status class lar');

// ── S33.09: VIP grant/revoke searchable + confirm + pending ──
console.log('\nS33.09 — VIP grant/revoke flow');
if (!/vip-user-list/.test(dashSrc)) bad("S33.09: searchable datalist yo'q");
else ok('S33.09: searchable user picker (datalist)');
if (!/aria-busy/.test(dashSrc)) bad("S33.09: pending state yo'q");
else ok('S33.09: pending (aria-busy) state');
if (!/showConfirm\(/.test(dashSrc)) bad("S33.09: confirmation yo'q");
else ok('S33.09: confirmation');

// ── S33.10: upload keyboard + dropzone ──
console.log('\nS33.10 — Upload keyboard/dropzone');
if (!/e\.key === 'Enter'/.test(dashSrc)) bad("S33.10: keyboard Enter yo'q");
else ok('S33.10: keyboard Enter');
if (!/setAttribute\('tabindex', '0'\)/.test(dashSrc)) bad("S33.10: tabindex yo'q");
else ok('S33.10: dropzone tabindex');

// ── S33.11: light/dark/high-contrast support ──
console.log('\nS33.11 — Theme support');
if (!/data-theme=|theme-light|prefers-color-scheme/.test(adminCss)) bad("S33.11: theme var qo'llab-quvvatlamaydi");
else ok('S33.11: theme token lari mavjud');

console.log(fails ? `\n${fails} ta xato` : '\nPASS — STEP 33 barcha talablari bajarildi');
process.exit(fails ? 1 : 0);
