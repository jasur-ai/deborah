#!/usr/bin/env node
/**
 * STEP 34 — Error pages, system states, PWA va service worker visuals validator.
 * Run: node scripts/check-error-pwa.js
 */
import { readFileSync, existsSync } from 'fs';
let fails = 0;
const ok = (m) => console.log('  ✓ ' + m);
const bad = (m) => { console.log('  ✗ ' + m); fails += 1; };
const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

console.log('STEP 34 — Error pages, system states, PWA va service worker visuals');

// ── S34.01: state-specific holatlar ──
console.log('\nS34.01 — State-specific error copy (404/403/500/maintenance)');
const errEjs = readFileSync('views/error.ejs', 'utf8');
if (!/errStatus === 404/.test(errEjs) || !/errStatus === 403/.test(errEjs) || !/errStatus === 503/.test(errEjs)) bad('S34.01: 404/403/503 state-specific copy yo q');
else ok('S34.01: 404/403/503 state-specific copy');
if (!/Bosh sahifaga qaytish/.test(errEjs)) bad('S34.01: primary recovery yo q');
else ok('S34.01: recovery action');

// ── S34.02: status title + plain explanation + recovery + secondary ──
console.log('\nS34.02 — Status title, explanation, recovery, secondary');
if (!/error-title/.test(errEjs) || !/error-desc/.test(errEjs)) bad('S34.02: title/explanation yo q');
else ok('S34.02: title + plain explanation');
if (!/btn btn-primary/.test(errEjs)) bad('S34.02: primary btn-component yo q');
else ok('S34.02: btn btn-primary component');
if (!/btn btn-secondary/.test(errEjs)) bad('S34.02: secondary link yo q');
else ok('S34.02: btn btn-secondary');

// ── S34.03: prod'da stack yashirilgan + opaque reference ID ──
console.log('\nS34.03 — No production stack leak, opaque ref ID');
const errMw = readFileSync('middleware/error.js', 'utf8');
if (!/refId/.test(errMw)) bad('S34.03: opaque reference ID yo q');
else ok('S34.03: opaque refId middleware da');
if (!/NODE_ENV === 'production' \? null : err\.stack/.test(errMw)) bad('S34.03: prod stack guard yo q');
else ok('S34.03: stack faqat dev da');
if (!/isDev/.test(errEjs) || !/faqat rivojlantirish rejimida/.test(errEjs)) bad('S34.03: view da dev-only guard yo q');
else ok('S34.03: view dev-only stack guard');

// ── S34.04: Evidence Mark, giant emoji/mascot yo'q ──
console.log('\nS34.04 — Evidence Mark illustration (no giant emoji/mascot)');
if (!/evidence-mark\.svg/.test(errEjs)) bad('S34.04: Evidence Mark yo q');
else ok('S34.04: Evidence Mark');
const errBody = stripComments(errEjs);
if (/😱|🙈|🛠️|🤖|👾|🎭/.test(errBody)) bad('S34.04: playful mascot emoji topildi');
else ok('S34.04: playful mascot emoji yo q');

// ── S34.05: reusable button component (inline gradient yo'q) ──
console.log('\nS34.05 — Reusable button component');
const errBody2 = stripComments(errEjs);
if (/linear-gradient/.test(errBody2)) bad('S34.05: inline gradient qoldiq');
else ok('S34.05: inline gradient yo q');
if (!/btn-primary/.test(errEjs)) bad('S34.05: btn-primary component');
else ok('S34.05: btn-primary component');

// ── S34.06: offline page cached actions + reconnect + retry ──
console.log('\nS34.06 — Offline page');
if (!existsSync('views/offline.ejs')) bad('S34.06: views/offline.ejs yo q');
else {
  const offEjs = readFileSync('views/offline.ejs', 'utf8');
  if (!/offline-retry/.test(offEjs)) bad('S34.06: retry button yo q');
  else ok('S34.06: retry button');
  if (!/navigator\.onLine/.test(offEjs)) bad('S34.06: reconnect status yo q');
  else ok('S34.06: reconnect status');
  if (!/offline-cached/.test(offEjs)) bad('S34.06: cached actions yo q');
  else ok('S34.06: cached available actions');
}

// ── S34.07: cache version hash ──
console.log('\nS34.07 — Cache version hash');
const sw = readFileSync('public/service-worker.js', 'utf8');
if (!/CACHE_VERSION = 'v[\d.]+-[0-9a-f]{8}'/.test(sw)) bad('S34.07: cache version da asset hash yo q');
else ok('S34.07: cache version + asset hash');

// ── S34.08: update banner nonblocking ──
console.log('\nS34.08 — Update banner');
if (!existsSync('public/js/update-banner.js')) bad('S34.08: update-banner.js yo q');
else {
  const ub = readFileSync('public/js/update-banner.js', 'utf8');
  if (!/EDIKIT_UPDATE_AVAILABLE/.test(ub)) bad('S34.08: update message handler yo q');
  else ok('S34.08: update message handler');
  if (!/location\.reload/.test(ub)) bad('S34.08: reload action yo q');
  else ok('S34.08: manual reload action');
}
const headEjs = readFileSync('views/partials/head.ejs', 'utf8');
if (!/update-banner\.js/.test(headEjs)) bad('S34.08: head da update-banner.js yo q');
else ok('S34.08: update-banner.js head da');

// ── S34.09: manifest final tokens ──
console.log('\nS34.09 — Manifest Ink/Paper tokens');
const manifest = readFileSync('public/manifest.json', 'utf8');
if (!/"theme_color": "#0C1426"/.test(manifest) || !/"background_color": "#080C1A"/.test(manifest)) bad('S34.09: manifest tokenlar final emas');
else ok('S34.09: manifest Ink/Paper final');

// ── S34.10: pwa icons evidence-mark + maskable safe area ──
console.log('\nS34.10 — PWA icons maskable-safe');
for (const s of [192, 512]) {
  if (!existsSync(`public/images/pwa-icon-${s}.png`)) bad(`S34.10: pwa-icon-${s}.png yo q`);
}
const buildIcons = readFileSync('scripts/build-pwa-icons.js', 'utf8');
if (!/MASKABLE_PAD/.test(buildIcons)) bad('S34.10: maskable safe-area pad yo q');
else ok('S34.10: maskable safe-area (10% pad)');
if (!/logo-icon\.svg/.test(buildIcons)) bad('S34.10: evidence-mark manbasi emas');
else ok('S34.10: logo-icon.svg (evidence-mark) manbasi');

// ── S34.11: offline fallback SW'da ──
console.log('\nS34.11 — Offline/stale SW test hooks');
if (!/caches\.match\('\/offline'\)/.test(sw)) bad('S34.11: SW offline page fallback yo q');
else ok('S34.11: SW offline page fallback');

// ── S34.12: reduced motion + keyboard ──
console.log('\nS34.12 — Keyboard + reduced motion');
const offEjs2 = existsSync('views/offline.ejs') ? readFileSync('views/offline.ejs', 'utf8') : '';
if (!/prefers-reduced-motion/.test(offEjs2)) bad('S34.12: offline reduced-motion yo q');
else ok('S34.12: offline reduced-motion');
const ub2 = existsSync('public/js/update-banner.js') ? readFileSync('public/js/update-banner.js', 'utf8') : '';
if (!/button/.test(ub2)) bad('S34.12: banner button keyboard yo q');
else ok('S34.12: banner button (keyboard accessible)');

console.log(fails ? `\n${fails} ta xato` : '\nPASS — STEP 34 barcha talablari bajarildi');
process.exit(fails ? 1 : 0);
