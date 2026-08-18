#!/usr/bin/env node
/**
 * STEP 26 — Test library validator (S26.01-12)
 * Run: node scripts/check-library.js
 */
import { readFileSync, existsSync } from 'fs';

let fails = 0;
const ok = (msg) => console.log('✅ ' + msg);
const bad = (msg) => { console.log('❌ ' + msg); fails++; };

const panel = readFileSync('views/user/panel.ejs', 'utf8');
const css = readFileSync('public/design/contexts/workspace.css', 'utf8');
const js = readFileSync('public/js/workspace-library.js', 'utf8');
const routes = readFileSync('routes/user.js', 'utf8');

console.log('STEP 26 — Test library');

// ── S26.01: list default + ready grid ──
console.log('— S26.01 list/grid');
if (!panel.includes('ws-lib-list')) bad('S26.01: list/table default (ws-lib-list) yoq');
else ok('S26.01: ws-lib-list mavjud');
if (!panel.includes('ws-ready-grid')) bad('S26.01: ready templates grid (ws-ready-grid) yoq');
else ok('S26.01: ws-ready-grid mavjud');

// ── S26.02: row fields ──
console.log('— S26.02 row fields');
for (const [label, needle] of [
  ['title', 'ws-lib-name'],
  ['count', 'ta savol'],
  ['subject', 'ws-lib-subject'],
  ['updated', 'ws-lib-date'],
  ['visibility', 'ws-vis'],
  ['cast', 'data-source="user"'],
]) {
  if (!panel.includes(needle)) bad(`S26.02: ${label} row'da yoq (${needle})`);
  else ok(`S26.02: ${label} mavjud`);
}

// ── S26.03: overflow menu + actions ──
console.log('— S26.03 overflow menu');
if (!panel.includes('ws-lib-overflow-btn')) bad('S26.03: overflow button yoq');
else ok('S26.03: overflow button mavjud');
for (const act of ['edit', 'practice', 'duplicate', 'visibility', 'export', 'archive', 'delete']) {
  if (!panel.includes(`data-act="${act}"`)) bad(`S26.03: overflow action "${act}" yoq`);
  else ok(`S26.03: overflow "${act}" mavjud`);
}
if (!js.includes('role="menuitem"') && !panel.includes('role="menuitem"')) bad('S26.03: menuitem ARIA yoq');
else ok('S26.03: menuitem ARIA mavjud');

// ── S26.04: danger delete + no adjacent one-click delete ──
console.log('— S26.04 danger delete');
if (!panel.includes('ws-lib-menu-danger')) bad('S26.04: danger menu item yoq');
else ok('S26.04: danger menu item mavjud');
if (panel.includes('act-del')) bad('S26.04: adjacent one-click delete (act-del) hali bor');
else ok('S26.04: one-click delete olib tashlangan');
if (!js.includes('butunlay o')) bad('S26.04: object-named confirm copy yoq');
else ok('S26.04: object-named confirm mavjud');

// ── S26.05: labeled visibility ──
console.log('— S26.05 labeled visibility');
if (!panel.includes('Ommaviy') || !panel.includes('Shaxsiy')) bad('S26.05: labeled visibility copy yoq');
else ok('S26.05: labeled visibility mavjud');
if (!css.includes('ws-vis--public')) bad('S26.05: ws-vis--public CSS yoq');
else ok('S26.05: ws-vis--public CSS mavjud');

// ── S26.06: filter bar (STEP 18 asosida) ──
console.log('— S26.06 filter bar');
for (const [label, needle] of [
  ['search', 'id="lib-search"'],
  ['subject', 'id="lib-subject"'],
  ['type', 'id="lib-type"'],
  ['sort', 'id="lib-sort"'],
  ['chips', 'ws-lib-active'],
]) {
  if (!panel.includes(needle)) bad(`S26.06: ${label} filter yoq`);
  else ok(`S26.06: ${label} filter mavjud`);
}

// ── S26.07: user-facing taxonomy, internal key yashirin ──
console.log('— S26.07 taxonomy');
if (!panel.includes('Tayyor to')) bad('S26.07: user-facing taxonomy yoq');
else ok('S26.07: user-facing taxonomy mavjud');
if (!panel.includes('Bosqichli to')) bad('S26.07: PRE taxonomy yoq');
else ok('S26.07: PRE taxonomy mavjud');
if (panel.includes('Mock Testlar')) bad('S26.07: eski internal "Mock Testlar" nomi qolgan');
else ok('S26.07: internal "Mock Testlar" nomi olib tashlangan');

// ── S26.08: upgrade/entitlement state ──
console.log('— S26.08 upgrade state');
if (!panel.includes('ws-upgrade')) bad('S26.08: upgrade state (ws-upgrade) yoq');
else ok('S26.08: upgrade state mavjud');
if (!panel.includes('VIP imkoniyati')) bad('S26.08: honest upgrade copy yoq');
else ok('S26.08: honest upgrade copy mavjud');

// ── S26.09: native accordion/ARIA (accordion olib tashlangan → section) ──
console.log('— S26.09 section model');
if (panel.includes('toggleAcc(')) bad('S26.09: eski JS accordion (toggleAcc) hali bor');
else ok('S26.09: accordion section modelga almashtirilgan');

// ── S26.10: empty / filtered-none / error / loading states ──
console.log('— S26.10 states');
if (!panel.includes('id="lib-empty"')) bad('S26.10: empty library state yoq');
else ok('S26.10: empty state mavjud');
if (!panel.includes('id="lib-none"')) bad('S26.10: filtered-none state yoq');
else ok('S26.10: filtered-none state mavjud');

// ── S26.11: mobile reflow ──
console.log('— S26.11 mobile reflow');
if (!css.includes('@media (max-width: 720px)')) bad('S26.11: mobile media query yoq');
else ok('S26.11: mobile media query mavjud');
if (!css.includes('.ws-lib-actions')) bad('S26.11: mobile actions reflow CSS yoq');
else ok('S26.11: mobile actions reflow mavjud');

// ── S26.12: keyboard/SR/perf/saved filter ──
console.log('— S26.12 a11y + perf');
if (!js.includes('ArrowDown') || !js.includes('Escape')) bad('S26.12: menu keyboard nav yoq');
else ok('S26.12: menu keyboard nav mavjud');
if (!panel.includes('aria-haspopup="menu"')) bad('S26.12: menu ARIA yoq');
else ok('S26.12: menu ARIA mavjud');
if (!js.includes('lib') || !js.includes('URLSearchParams')) bad('S26.12: saved filter return yoq');
else ok('S26.12: saved filter return mavjud');
if (!panel.includes('overflow-wrap: anywhere') && !css.includes('overflow-wrap: anywhere')) {
  if (!css.includes('overflow-wrap: anywhere')) bad('S26.12: long title wrap yoq');
  else ok('S26.12: long title wrap mavjud');
} else ok('S26.12: long title wrap mavjud');

// ── Routes: duplicate/archive/export API ──
console.log('— API endpoints');
for (const [label, needle] of [
  ['duplicate', "router.post('/api/tests/duplicate'"],
  ['archive', "router.post('/api/tests/archive'"],
  ['export', "router.get('/api/tests/export'"],
]) {
  if (!routes.includes(needle)) bad(`API: ${label} endpoint yoq`);
  else ok(`API: ${label} endpoint mavjud`);
}

console.log(fails ? `\n${fails} ta xato` : '\nPASS — STEP 26 barcha talablari bajarildi');
process.exit(fails ? 1 : 0);
