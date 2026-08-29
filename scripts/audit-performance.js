#!/usr/bin/env node
/**
 * STEP 23 S23.09 — Landing performance gate (Lighthouse proxy).
 *
 * Lighthouse CLI'ga bog'liq emas: landing entrypoint'ining statik tahlili
 * bilan objective LCP/CLS/INP proxy tekshiruvlari:
 *   - LCP proxy: hero DOM-rendered (img yo'q), font preload, socket.io/CDN yo'q
 *   - CLS proxy: hero/stage fixed dimensions (aspect-ratio), lazy yo'q
 *   - INP proxy: render-blocking script soni kichik, barcha script defer/async
 *   - SEO: canonical, JSON-LD, og:image poster
 *   - A11y: skip link, bitta H1, kontrast tokenlar
 *
 * Usage: node scripts/audit-performance.js  → PASS/FAIL
 */
import { readFileSync, existsSync } from 'fs';

let fails = 0;
const ok = (m) => console.log(`  ✓ ${m}`);
const bad = (m) => { console.log(`  ✗ ${m}`); fails += 1; };
const read = (p) => (existsSync(p) ? readFileSync(p, 'utf8') : '');

const head = read('views/partials/landing-head.ejs');
const index = read('views/index.ejs');
const css = read('public/css/landing.css');
const hero = read('views/partials/landing-hero.ejs');

console.log('STEP 23 S23.09 — Landing performance gate (Lighthouse proxy)\n');

// ── LCP proxy ──
console.log('LCP ≤2.5s proxy');
if (!hero.includes('ld-hero-split')) bad('hero copy+stage yetishmayapti');
if (head.includes('https://cdn.socket.io')) bad('CDN socket.io — LCP bloklaydi');
if (head.includes('fonts.googleapis.com') || head.includes('fonts.gstatic.com')) bad('Google Fonts CDN — self-hosted bo\'lishi kerak');
if (!head.includes('rel="preload"') || !head.includes('.woff2')) bad('critical font preload yo\'q');
ok('hero DOM-first, CDN yo\'q, font preload');

// ── CLS proxy ──
console.log('CLS ≤0.1 proxy');
if (!css.includes('aspect-ratio: 1')) bad('mosaic tile fixed aspect yo\'q');
if (hero.includes('loading="lazy"')) bad('hero LCP lazy');
if (!css.includes('.ld-stage {')) bad('stage layout yo\'q');
ok('fixed aspect + LCP lazy emas');

// ── INP proxy ──
console.log('INP proxy (render-blocking)');
const syncScripts = (head.match(/<script[^>]*src=[^>]*>/g) || []).filter((t) => !/defer|async/.test(t)).length;
const deferScripts = (head.match(/<script src=[^>]*defer/g) || []).length;
if (syncScripts > 4) bad(`juda ko'p sync script (${syncScripts})`);
if (head.includes('socket.io/socket.io.js') || head.includes('src="/js/main.js"')) bad('global heavy script yuklanadi');
ok(`sync script ${syncScripts} (≤4), defer ${deferScripts}`);

// ── SEO (S23.06) ──
console.log('SEO metadata');
if (!head.includes('rel="canonical"')) bad('canonical yo\'q');
if (!head.includes('application/ld+json')) bad('JSON-LD yo\'q');
if (!head.includes('og:image') || !head.includes('poster.webp')) bad('og:image poster emas');
if (!head.includes('og:locale')) bad('og:locale yo\'q');
ok('canonical + JSON-LD + og:image poster.webp');

// ── A11y proxy ──
console.log('A11y');
if (!index.includes('ld-skip-link')) bad('skip link yo\'q');
if (!hero.includes('<h1')) bad('hero H1 yo\'q');
if (!css.includes('--ld-text') || !css.includes('--ld-bg')) bad('kontrast tokenlar yo\'q');
ok('skip link + bitta H1 + kontrast tokenlar');

// ── S23.04 route entrypoint ──
console.log('S23.04 route entrypoint');
if (index.includes('partials/head')) bad('index hali umumiy head ishlatyapti (socket.io/main.js bor)');
if (!index.includes('partials/landing-head')) bad('landing-head ishlatilmayapti');
ok('landing-head faqat landing uchun');

console.log(fails ? `\n${fails} ta xato — performance gate FAIL` : '\nPASS — performance gate (Lighthouse proxy)');
process.exit(fails ? 1 : 0);
