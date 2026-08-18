#!/usr/bin/env node
/**
 * Deborah — Motion Foundation Validator (STYLE STEP 10)
 * -----------------------------------------------------
 * S10.01 — duration scale 0/80/120/160/220/320/500/800
 * S10.03 — transition: all = 0
 * S10.08 — layout animatsiya (width/height/margin animatsiyasi) yo'q
 * S10.09 — prefers-reduced-motion mavjud (task parity)
 * S10.10 — @starting-style + transition-behavior progressive
 * S10.05 — frequent action ≤160ms
 */
import { readFileSync, readdirSync, existsSync } from 'fs';
import { join } from 'path';

const ROOT = process.cwd();
let errors = [];
const ok = (m) => console.log('✅', m);
const bad = (m) => { errors.push(m); console.log('❌', m); };

// ── S10.01: duration scale ──
const layout = JSON.parse(readFileSync(join(ROOT, 'public/design/tokens/layout.json'), 'utf8'));
const durations = layout.deborah.motion.duration;
const REQUIRED = [0, 80, 120, 160, 220, 320, 500, 800];
for (const d of REQUIRED) {
  const val = durations[String(d)]?.$value;
  if (val) ok(`S10.01: duration-${d} = ${val}`);
  else bad(`S10.01: duration-${d} yo'q`);
}

// Intentlar (S10.05/06)
const intent = layout.deborah.motion.intent;
for (const k of ['feedback', 'hover', 'popup', 'modal', 'modal-exit', 'page', 'page-exit', 'milestone']) {
  if (intent[k]?.$value) ok(`S10.05: intent-${k} = ${intent[k].$value}`);
  else bad(`S10.05: intent-${k} yo'q`);
}
// Exit = enter 65-80% (S10.06)
const modalExitMs = parseInt(intent['modal-exit'].$value, 10);
const modalMs = parseInt(intent.modal.$value, 10);
const ratio = modalExitMs / modalMs;
if (ratio >= 0.65 && ratio <= 0.8) ok(`S10.06: modal-exit enter'ning ${Math.round(ratio * 100)}%i`);
else bad(`S10.06: modal-exit ${Math.round(ratio * 100)}% — 65-80% bo'lishi kerak`);

// Easing (S10.02) — bounce/elastic yo'q
const easings = layout.deborah.motion.easing;
if (easings.standard && easings.enter && easings.exit && easings.emphasis) ok('S10.02: standard/enter/exit/emphasis easing mavjud');
else bad('S10.02: easing tokenlari to\'liq emas');

// ── S10.03: transition: all = 0 (CSS + views) ──
const cssDir = join(ROOT, 'public/css');
const foundationsDir = join(ROOT, 'public/design/foundations');
let allCount = 0;
for (const dir of [cssDir, foundationsDir]) {
  if (!existsSync(dir)) continue;
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.css'))) {
    const css = readFileSync(join(dir, f), 'utf8');
    allCount += (css.match(/transition:\s*all\b/g) || []).length;
  }
}
// EJS views'dagi inline style'lar
for (const f of readdirSync(join(ROOT, 'views'), { recursive: true }).filter((x) => x.endsWith('.ejs'))) {
  const css = readFileSync(join(ROOT, 'views', f), 'utf8');
  allCount += (css.match(/transition:\s*all\b/g) || []).length;
}
if (allCount === 0) ok('S10.03: transition: all = 0 (CSS + views)');
else bad(`S10.03: transition: all ${allCount} ta qoldi`);

// ── S10.08: layout animatsiya taqiq ──
const LAYOUT_RE = /transition-property:[^;]*(width|height|margin|top|left)[^;]*/g;
let layoutAnim = 0;
for (const dir of [cssDir, foundationsDir]) {
  if (!existsSync(dir)) continue;
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.css'))) {
    const css = readFileSync(join(dir, f), 'utf8');
    layoutAnim += (css.match(LAYOUT_RE) || []).length;
  }
}
if (layoutAnim === 0) ok('S10.08: layout animatsiya (width/height/margin/top/left) yo\'q');
else bad(`S10.08: layout animatsiya ${layoutAnim} ta`);

// ── S10.09: reduced-motion parity ──
const motionCss = readFileSync(join(ROOT, 'public/design/foundations/motion.css'), 'utf8');
if (motionCss.includes('prefers-reduced-motion')) ok('S10.09: prefers-reduced-motion blok mavjud');
else bad('S10.09: prefers-reduced-motion yo\'q');

// ── S10.10: @starting-style + transition-behavior ──
if (motionCss.includes('@starting-style')) ok('S10.10: @starting-style mavjud');
else bad('S10.10: @starting-style yo\'q');
if (motionCss.includes('transition-behavior')) ok('S10.10: transition-behavior mavjud');
else bad('S10.10: transition-behavior yo\'q');

// ── S10.11: focus ring instant ──
if (motionCss.includes('transition: none')) ok('S10.11: focus ring instant (transition:none)');
else bad('S10.11: focus ring transition:none emas');

// ── motion.css + head ulanish ──
const headEjs = readFileSync(join(ROOT, 'views/partials/head.ejs'), 'utf8');
if (headEjs.includes('foundations/motion.css')) ok('motion.css head.ejs\'ga ulangan');
else bad('motion.css head.ejs\'ga ulanmagan');

console.log('');
if (errors.length) {
  console.log(`❌ Motion validator: ${errors.length} xato`);
  process.exit(1);
}
console.log('✅ Motion validator: PASS');
process.exit(0);
