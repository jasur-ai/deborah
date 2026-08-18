#!/usr/bin/env node
/**
 * STEP 29 — Cast Director private cockpit validator.
 * Tekshiradi: layout 7/5 + rail, phase badge, status chips, overflow menu,
 * metrics bar, Add Time menu, pending spinner, S29.10 (glow/shimmer/trophy/rainbow yo'q).
 */
import { readFileSync, existsSync } from 'fs';
let fails = 0;
const ok = (m) => console.log('  ✓ ' + m);
const bad = (m) => { fails++; console.log('  ✗ ' + m); };

const has = (file, re, msg) => {
  if (!existsSync(file)) { bad(file + ' topilmadi'); return false; }
  const src = readFileSync(file, 'utf8');
  const found = typeof re === 'string' ? src.includes(re) : re.test(src);
  if (found) ok(msg); else bad(msg);
  return found;
};

console.log('STEP 29 — S29.01 layout 7/5 grid');
const ejs = readFileSync('views/cast/director.ejs', 'utf8');
if (/class="dir-layout"/.test(ejs)) ok('S29.01: .dir-layout mavjud');
else bad('S29.01: .dir-layout topilmadi');

console.log('STEP 29 — S29.02 phase badge + status chips + overflow');
if (/id="dir-phase-badge"/.test(ejs)) ok('S29.02a: dir-phase-badge mavjud'); else bad('S29.02a: dir-phase-badge yo\'q');
if (/id="dir-projector-status"/.test(ejs)) ok('S29.02b: dir-projector-status chip mavjud'); else bad('S29.02b: dir-projector-status yo\'q');
if (/id="dir-role-chip"/.test(ejs)) ok('S29.02c: dir-role-chip mavjud'); else bad('S29.02c: dir-role-chip yo\'q');
if (/id="btn-overflow"/.test(ejs) && /id="dir-overflow-menu"/.test(ejs)) ok('S29.02d: overflow menu mavjud'); else bad('S29.02d: overflow menu yo\'q');

console.log('STEP 29 — S29.03 evidence pane -> dir-pane');
if (/class="dir-pane"/.test(ejs)) ok('S29.03: .dir-pane (teacher evidence) mavjud'); else bad('S29.03: .dir-pane yo\'q');

console.log('STEP 29 — S29.04 metrics bar');
if (/id="dir-metrics"/.test(ejs) && /id="dir-metric-answered"/.test(ejs) && /id="dir-metric-correct"/.test(ejs) && /id="dir-metric-distractor"/.test(ejs) && /id="dir-metric-issue"/.test(ejs)) {
  ok('S29.04: 4 ta dir-metric element mavjud');
} else bad('S29.04: dir-metrics elementi to\'liq emas');

console.log('STEP 29 — S29.05/06 rail primary + phase disable');
if (/rail-group rail-primary/.test(ejs)) ok('S29.05: .rail-primary mavjud'); else bad('S29.05: .rail-primary yo\'q');
if (/id="btn-close"/.test(ejs) && /id="btn-reveal"/.test(ejs) && /id="btn-next"/.test(ejs)) ok('S29.06: primary tugmalar (close/reveal/next) mavjud'); else bad('S29.06: primary tugmalar yo\'q');

console.log('STEP 29 — S29.07 command pending spinner');
const js = readFileSync('public/js/cast-director.js', 'utf8');
if (/setCmdPending/.test(js) && /is-loading/.test(js)) ok('S29.07: pending spinner (setCmdPending/is-loading)'); else bad('S29.07: pending spinner yo\'q');
const css = readFileSync('public/css/cast-director.css', 'utf8');
if (/\.cast-btn\.is-loading/.test(css)) ok('S29.07: .cast-btn.is-loading CSS'); else bad('S29.07: .cast-btn.is-loading CSS yo\'q');

console.log('STEP 29 — S29.09 Add Time menu');
if (/data-addtime/.test(ejs) && /data-sec="5"/.test(ejs) && /data-sec="30"/.test(ejs)) ok('S29.09: Add Time menu (+5..+30s)'); else bad('S29.09: Add Time menu yo\'q');
if (/rail-addtime-menu/.test(css)) ok('S29.09: Add Time menu CSS'); else bad('S29.09: Add Time menu CSS yo\'q');

console.log('STEP 29 — S29.10 cast css tozaligi');
const castCss = readFileSync('public/css/cast-tokens.css', 'utf8') + '\n' + readFileSync('public/css/cast-director.css', 'utf8');
const banned = /glow|shimmer|trophy|rainbow/;
if (banned.test(castCss)) bad('S29.10: glow/shimmer/trophy/rainbow topildi');
else ok('S29.10: cast css da glow/shimmer/trophy/rainbow yo\'q');

console.log('STEP 29 — S29.11 topbar restructure + metrics update JS');
if (/renderPhaseBadge/.test(js)) ok('S29.11a: renderPhaseBadge JS'); else bad('S29.11a: renderPhaseBadge yo\'q');
if (/dir-metric-answered/.test(js) && /dir-metric-distractor/.test(js)) ok('S29.11b: metrics update JS'); else bad('S29.11b: metrics update JS yo\'q');
if (/overflowBtn\.addEventListener/.test(js)) ok('S29.11c: overflow menu JS'); else bad('S29.11c: overflow menu JS yo\'q');

console.log('STEP 29 — HTML balance');
const VOID = new Set(['meta', 'link', 'input', 'br', 'img', 'hr', 'source', 'area', 'base', 'col', 'embed', 'track', 'wbr']);
const re = /<(\/?)([a-zA-Z][a-zA-Z0-9-]*)([^>]*)>/g;
const stack = [];
let m;
let errs = 0;
while ((m = re.exec(ejs))) {
  const close = m[1];
  const tag = m[2];
  if (VOID.has(tag) || tag === '!doctype') continue;
  if (!close) stack.push(tag);
  else {
    const top = stack.pop();
    if (!top) { bad('HTML: extra </' + tag + '>'); errs++; }
    else if (top !== tag) { bad('HTML mismatch: </' + tag + '> vs <' + top + '>'); errs++; stack.push(top); }
  }
}
if (!errs && stack.length === 0) ok('S29: HTML teg balansi toza');
else if (stack.length) bad('HTML: yopilmagan: ' + stack.slice(-3).join(','));

console.log(fails ? '\n' + fails + ' ta xato' : '\nPASS — STEP 29 barcha talablari bajarildi');
process.exit(fails ? 1 : 0);
