#!/usr/bin/env node
/**
 * Edikit — Brand Asset Validator (STYLE STEP 05 / S05.01-02, S05.11)
 * ------------------------------------------------------------------
 * Evidence Mark variantlarini tekshiradi:
 *   - SVG well-formed (XML parse)
 *   - Gradient taqiq (product variantlari)
 *   - Monochrome: hammasi currentColor, bitta rang
 *   - High-contrast: alpha >= 0.85, faqat qora
 *   - Inverse: qorong'i fon uchun signal-cyan node + oq rail/ticks
 *   - Struktura: 1 rail + 3 tick + 1 signal node (optical grid)
 *   - Alt policy: logo alt har doim "Edikit"
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BRAND = join(ROOT, 'public', 'images', 'brand');

const FILES = [
  'evidence-mark.svg',
  'evidence-mark-monochrome.svg',
  'evidence-mark-inverse.svg',
  'evidence-mark-high-contrast.svg',
  'wordmark-horizontal.svg',
  'wordmark-compact.svg',
];

let errors = [];
let checks = 0;

function check(ok, msg) {
  checks++;
  if (!ok) errors.push(msg);
}

function svgString(html, file) {
  // Minimal XML parse: attr'lar va tag strukturasini tekshiradi
  const stack = [];
  const tagRe = /<\/?([a-zA-Z][a-zA-Z0-9-]*)((?:\s+[a-zA-Z-]+(?:\s*=\s*"[^"]*")?)*)\s*\/?>/g;
  let m;
  while ((m = tagRe.exec(html))) {
    const name = m[1];
    if (m[0].startsWith('</')) {
      const open = stack.pop();
      check(open === name, `${file}: yopilish tag mos emas </${name}> (kutilgan: ${open})`);
    } else if (!m[0].endsWith('/>')) {
      stack.push(name);
    }
  }
  check(stack.length === 0, `${file}: ochiq qolgan taglar ${stack.join(',')}`);
  check(html.trimStart().startsWith('<svg'), `${file}: <svg> root bo'lishi shart`);
}

for (const file of FILES) {
  const html = readFileSync(join(BRAND, file), 'utf8');
  svgString(html, file);

  check(html.includes('viewBox="0 0 64 64"') || html.includes('viewBox="0 0 296 64"') || html.includes('viewBox="0 0 200 64"'), `${file}: viewBox yo'q`);
  check(!html.includes('linearGradient') && !html.includes('radialGradient'), `${file}: gradient taqiqlangan (product variant)`);
  check(!html.includes('filter="'), `${file}: glow/filter taqiqlangan`);

  if (file === 'evidence-mark.svg') {
    check(html.includes('#1746D1'), `${file}: cobalt rang (final #1746D1, S06.01) bo'lishi shart`);
  }
  if (file === 'evidence-mark-monochrome.svg') {
    check((html.match(/currentColor/g) || []).length >= 5, `${file}: barcha elementlar currentColor bo'lishi shart`);
    check(!html.includes('#1746D1') && !html.includes('#FFFFFF') && !html.includes('#000000'), `${file}: monochrome bitta rang`);
  }
  if (file === 'evidence-mark-high-contrast.svg') {
    const alphas = [...html.matchAll(/opacity="([0-9.]+)"/g)].map((m) => parseFloat(m[1]));
    check(alphas.every((a) => a >= 0.85), `${file}: high-contrast alpha >= 0.85`);
    check(!html.includes('#1746D1') && !html.includes('#38BDF8') && !html.includes('#FFFFFF'), `${file}: high-contrast faqat qora`);
  }
  if (file === 'evidence-mark-inverse.svg') {
    check(html.includes('#38BDF8'), `${file}: inverse node signal-cyan`);
  }

  // Struktura: rail (1), tick (3), node (1) — mark fayllarida
  if (file.startsWith('evidence-mark')) {
    const rects = [...html.matchAll(/<rect /g)].length;
    const circles = [...html.matchAll(/<circle /g)].length;
    check(rects === 4, `${file}: 1 rail + 3 tick = 4 rect (topildi: ${rects})`);
    check(circles === 2, `${file}: signal node + detail = 2 circle (topildi: ${circles})`);
  }
}

// Alt policy (S05.11): views'dagi logo img'lar alt="Edikit".
// Order-independent parse + exception: img yonida .sr-only label bo'lsa
// alt="" to'g'ri (double-announcement oldini olish — a11y best practice).
const VIEWS = join(ROOT, 'views');
function scanViews(dir) {
  for (const name of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, name.name);
    if (name.isDirectory()) scanViews(p);
    else if (name.name.endsWith('.ejs')) {
      const src = readFileSync(p, 'utf8');
      const imgRe = /<img\b[^>]*>/g;
      let m;
      while ((m = imgRe.exec(src))) {
        const tag = m[0];
        if (!/src="[^"]*logo[^"]*"/.test(tag)) continue;
        const altMatch = /alt="([^"]*)"/.exec(tag);
        const alt = altMatch ? altMatch[1] : null;
        if (alt === 'Edikit') continue;
        if (alt === '') {
          // sr-only exception: qo'shni span.sr-only bo'lsa — dekorativ, to'g'ri
          const around = src.slice(Math.max(0, m.index - 80), m.index + tag.length + 120);
          if (/<span[^>]*class="[^"]*sr-only[^"]*">/.test(around)) continue;
        }
        check(false, `alt policy: ${name.name} — logo img alt="${alt === null ? 'yo\'q' : alt}" bo'lmasligi kerak; "Edikit" yoki sr-only label bo'lishi shart`);
      }
    }
  }
}
scanViews(VIEWS);

if (errors.length) {
  console.error(`❌ Brand assets: ${errors.length} xato`);
  for (const e of errors) console.error('   - ' + e);
  process.exit(1);
}
console.log(`✅ Brand assets valid (${checks} check, 0 xato)`);
