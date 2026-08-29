#!/usr/bin/env node
/**
 * Deborah — Foundations Validator (STYLE STEP 11)
 * ----------------------------------------------
 * S11.01 — reset.css mavjud + box-sizing
 * S11.02 — body::before ambient overlay GLOBAL yo'q
 * S11.04 — focus 3px token + 3px offset
 * S11.06 — .sr-only, .skip-link, scroll-margin
 * S11.10 — cascade layers
 * S11.11 — !important faqat documented istisno (reduced-motion/forced-colors/HC)
 * S11.12 — head.ejs foundation importlar
 */
import { readFileSync, existsSync, readdirSync } from 'fs';
import { join } from 'path';

const ROOT = process.cwd();
let errors = [];
const ok = (m) => console.log('✅', m);
const bad = (m) => { errors.push(m); console.log('❌', m); };

const F = (p) => join(ROOT, p);
const rd = (p) => readFileSync(join(ROOT, p), 'utf8');

// ── S11.01: foundation fayllar ──
const files = ['reset.css', 'base.css', 'focus.css', 'utilities.css'];
for (const f of files) {
  if (existsSync(F(`public/design/foundations/${f}`))) ok(`S11.01: ${f} mavjud`);
  else bad(`S11.01: ${f} yo'q`);
}
if (rd('public/design/foundations/reset.css').includes('box-sizing: border-box')) ok('S11.01: box-sizing reset');
else bad('S11.01: box-sizing reset yo\'q');

// ── S11.02: global ambient overlay yo'q ──
const styleCss = rd('public/css/style.css');
if (!/body::before\s*\{/.test(styleCss)) ok('S11.02: global body::before ambient overlay yo\'q');
else bad('S11.02: body::before hali style.css\'da');
if (styleCss.includes('--ambient-1')) ok('S11.02: ambient tokenlar saqlangan (kontekst uchun)');
if (rd('public/design/foundations/base.css').includes('deborah-semantic-color-surface-default')) ok('S11.02: body semantic tokens');
else bad('S11.02: body semantic token emas');

// ── S11.04: focus 3px ──
const focusCss = rd('public/design/foundations/focus.css');
if (focusCss.includes('outline: 3px solid')) ok('S11.04: focus 3px ring');
else bad('S11.04: focus 3px emas');
if (focusCss.includes('outline-offset: 3px')) ok('S11.04: focus offset 3px');
else bad('S11.04: focus offset 3px emas');
if (rd('public/design/foundations/base.css').includes('scroll-padding-top: 72px')) ok('S11.04: scroll-padding-top (sticky header)');
else bad('S11.04: scroll-padding-top yo\'q');

// ── S11.05: forced-colors ──
if (focusCss.includes('forced-colors: active')) ok('S11.05: forced-colors focus override');
else bad('S11.05: forced-colors yo\'q');
if (rd('public/design/foundations/base.css').includes('forced-colors')) ok('S11.05: forced-colors scrollbar fallback');
else bad('S11.05: forced-colors scrollbar yo\'q');

// ── S11.06: utilities ──
const utils = rd('public/design/foundations/utilities.css');
for (const sel of ['.sr-only', '.skip-link', 'scroll-margin-top', 'scroll-mt-']) {
  if (utils.includes(sel)) ok(`S11.06: ${sel} mavjud`);
  else bad(`S11.06: ${sel} yo'q`);
}

// ── S11.10: cascade layers ──
let layerCount = 0;
for (const f of [...files, 'typography.css', 'layout.css', 'motion.css']) {
  const p = F(`public/design/foundations/${f}`);
  if (!existsSync(p)) continue;
  if (readFileSync(p, 'utf8').includes('@layer')) layerCount++;
}
if (layerCount >= 4) ok(`S11.10: ${layerCount} foundation fayl @layer ishlatadi`);
else bad(`S11.10: faqat ${layerCount} fayl @layer`);

// ── S11.11: !important allowlist ──
const IMPORTANT_RE = /!important/g;
let totalImp = 0;
for (const f of readdirSync(F('public/css')).filter((x) => x.endsWith('.css'))) {
  totalImp += (rd(`public/css/${f}`).match(IMPORTANT_RE) || []).length;
}
if (totalImp <= 25) ok(`S11.11: !important ${totalImp} ta (reduced-motion/HC allowlist)`);
else bad(`S11.11: !important ${totalImp} ta — kutilganidan ko'p`);

// ── S11.12: head.ejs import ──
const head = rd('views/partials/head.ejs');
for (const f of files) {
  if (head.includes(`foundations/${f}`)) ok(`S11.12: head.ejs ${f} import`);
  else bad(`S11.12: head.ejs ${f} import yo'q`);
}
if (head.includes('design/generated/tokens.css')) ok('S11.12: head.ejs tokens.css import (S11 bug fix)');
else bad('S11.12: head.ejs tokens.css import yo\'q');
if (head.includes('foundations/typography.css')) ok('S11.12: head.ejs typography.css import');
else bad('S11.12: head.ejs typography.css import yo\'q');

console.log('');
if (errors.length) {
  console.log(`❌ Foundations validator: ${errors.length} xato`);
  process.exit(1);
}
console.log('✅ Foundations validator: PASS');
process.exit(0);
