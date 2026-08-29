#!/usr/bin/env node
/**
 * Deborah — Layout Foundation Validator (STYLE STEP 09)
 * -----------------------------------------------------
 * S09.01 — spacing faqat 4px scale (0,4,8,12,16,20,24,32,40,48,64,80,96)
 * S09.04 — radius grammar: control 8 / card 12 / modal 16 / pill faqat status
 * S09.02 — container tokenlari mavjud
 * S09.06 — z-index semantic qatlamlar
 * S09.05 — 22-32px bubble cards yo'q
 *
 * Exit code: 0 = PASS, 1 = FAIL
 */
import { readFileSync, readdirSync, existsSync } from 'fs';
import { join } from 'path';

const ROOT = process.cwd();
let errors = [];
const ok = (msg) => console.log('✅', msg);
const bad = (msg) => { errors.push(msg); console.log('❌', msg); };

// ── S09.01: 4px spacing scale ──
const layoutJson = join(ROOT, 'public/design/tokens/layout.json');
const layout = JSON.parse(readFileSync(layoutJson, 'utf8'));
const spacing = layout.deborah?.spacing || {};
const SPACING_SCALE = [0, 4, 8, 12, 16, 20, 24, 32, 40, 48, 64, 80, 96];
const spacingValues = Object.values(spacing)
  .filter((v) => v && v.$value && String(v.$value).endsWith('px'))
  .map((v) => parseInt(String(v.$value), 10))
  .filter((n) => !isNaN(n));

const nonScale = spacingValues.filter((n) => !SPACING_SCALE.includes(n));
if (nonScale.length === 0) ok('S09.01: spacing faqat 4px scale (0-96)');
else bad(`S09.01: 4px scale'dan tashqari spacing: ${nonScale.join(', ')}`);

// S09.01b: 80 va 96 mavjud
for (const v of [80, 96]) {
  if (spacingValues.includes(v)) ok(`S09.01: spacing-${v / 4} (${v}px) mavjud`);
  else bad(`S09.01: ${v}px spacing token yo'q`);
}

// ── S09.02: container tokenlari ──
const containers = layout.deborah?.container || {};
const REQUIRED_CONTAINERS = ['landing', 'workspace', 'reading', 'auth', 'studio'];
for (const c of REQUIRED_CONTAINERS) {
  if (containers[c]?.$value) ok(`S09.02: container-${c} = ${containers[c].$value}`);
  else bad(`S09.02: container-${c} token yo'q`);
}

// ── S09.04: radius grammar ──
const radius = layout.deborah?.radius || {};
const R = {
  sm: 8, md: 12, lg: 16, xl: 20, pill: 999,
};
for (const [k, expected] of Object.entries(R)) {
  const actual = radius[k] ? parseInt(String(radius[k].$value), 10) : null;
  if (actual === expected) ok(`S09.04: radius-${k} = ${actual}px`);
  else bad(`S09.04: radius-${k} = ${actual}px (kutilgan ${expected}px)`);
}

// ── S09.06: elevation + z-index qatlamlari ──
const elevation = layout.deborah?.elevation || {};
for (const layer of ['canvas', 'surface', 'sticky', 'modal', 'toast']) {
  if (elevation[layer]) ok(`S09.06: elevation-${layer} mavjud`);
  else bad(`S09.06: elevation-${layer} yo'q`);
}
const zidx = layout.deborah?.['z-index'] || {};
for (const layer of ['base', 'sticky', 'dropdown', 'modal', 'toast', 'system']) {
  if (zidx[layer]) ok(`S09.06: z-index-${layer} mavjud`);
  else bad(`S09.06: z-index-${layer} yo'q`);
}

// ── S09.09: density ──
const density = layout.deborah?.density || {};
if (density.comfortable && density.compact) ok('S09.09: density comfortable + compact mavjud');
else bad('S09.09: density tokenlari to\'liq emas');

// ── S09.05: 22-32px bubble cards CSS'da yo'q ──
const cssDir = join(ROOT, 'public/css');
const cssFiles = readdirSync(cssDir).filter((f) => f.endsWith('.css'));
const bubbleRe = /border-radius:\s*(2[2-9]|3[0-2])px/g;
let bubbleCount = 0;
for (const f of cssFiles) {
  const css = readFileSync(join(cssDir, f), 'utf8');
  const matches = css.match(bubbleRe) || [];
  if (matches.length) {
    bubbleCount += matches.length;
    bad(`S09.05: ${f} — bubble radius ${matches.join(', ')}`);
  }
}
if (bubbleCount === 0) ok('S09.05: 22-32px bubble cards yo\'q');

// ── layout.css mavjud va head'ga ulangan ──
if (existsSync(join(ROOT, 'public/design/foundations/layout.css'))) {
  ok('layout.css mavjud');
} else {
  bad('layout.css yo\'q');
}
const headEjs = readFileSync(join(ROOT, 'views/partials/head.ejs'), 'utf8');
if (headEjs.includes('foundations/layout.css')) ok('layout.css head.ejs\'ga ulangan');
else bad('layout.css head.ejs\'ga ulanmagan');

console.log('');
if (errors.length) {
  console.log(`❌ Layout validator: ${errors.length} xato`);
  process.exit(1);
}
console.log('✅ Layout validator: PASS');
process.exit(0);
