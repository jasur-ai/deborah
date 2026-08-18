#!/usr/bin/env node
/**
 * Edikit — Selection validator (STYLE STEP 14)
 * ----------------------------------------------
 * S14.01 — radio/checkbox/switch usage rules documented in CSS
 * S14.02 — selectable card: hidden native radio + label + marker
 * S14.03 — selected: 2px cobalt border + fill + marker (scale anim YO'Q)
 * S14.04 — disabled: aria-describedby inline explanation (opacity-only EMAS)
 * S14.05 — forced-colors system color
 * S14.06 — switch pending status
 * S14.07 — tabs: tablist/tab/tabpanel + arrow-nav + Home/End (JS)
 * S14.08 — no auto-rotate
 * S14.09 — accordion button + aria-expanded/controls; no div onclick
 * S14.10 — grid-rows motion 180-220ms + reduced-motion instant
 * S14.11 — no nested interactive link inside selectable card label
 */
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

const ROOT = process.cwd();
let errors = [];
const ok = (m) => console.log('✅', m);
const bad = (m) => { errors.push(m); console.log('❌', m); };
const rd = (p) => readFileSync(join(ROOT, p), 'utf8');

// ── S14.01-05: selection.css ──
// comment'larni tekshiruvdan chiqarish (so'z ehtiyotkorlik):
const sel = rd('public/design/components/selection.css').replace(/\/\*[\s\S]*?\*\//g, '');
for (const c of ['.choice', '.choice__input', '.choice__mark', '.switch', '.select-card']) {
  if (sel.includes(c)) ok(`S14.01/02: ${c}`);
  else bad(`S14.01/02: ${c} yoq`);
}
if (sel.includes('.choice--radio') && sel.includes('.choice--checkbox')) ok('S14.01: radio + checkbox variantlar');
else bad('S14.01: radio/checkbox variantlar yoq');
if (sel.includes('.choice__input:checked + .choice__mark')) ok('S14.01: native :checked semantics');
else bad('S14.01: :checked semantics yoq');
if (/border:\s*2px solid var\(--edikit-semantic-color-action-primary\)|border-color:\s*var\(--edikit-semantic-color-action-primary\)/.test(sel)) ok('S14.03: selected 2px cobalt border');
else bad('S14.03: 2px cobalt border yoq');
if (!/transform:\s*scale|scale\s*:\s*[0-9]/.test(sel)) ok('S14.03: scale animatsiya yoq');
else bad('S14.03: scale animatsiya bor');
if (sel.includes('aria-describedby') || sel.includes('.choice__disabled-note')) ok('S14.04: disabled inline explanation');
else bad('S14.04: disabled explanation yoq');
if (sel.includes('forced-colors')) ok('S14.05: forced-colors system color');
else bad('S14.05: forced-colors yoq');
if (sel.includes('.switch.is-pending')) ok('S14.06: switch pending state');
else bad('S14.06: switch pending yoq');
if (rd('public/js/components/switch.js').includes('is-pending')) ok('S14.06: switch pending JS driver');
else bad('S14.06: switch pending JS driver yoq');

// ── S14.07-08: tabs ──
const tabsCss = rd('public/design/components/tabs.css');
const tabsJs = rd('public/js/components/tabs.js');
if (tabsCss.includes('[role="tabpanel"]') || tabsCss.includes('.tabpanel')) ok('S14.07: tabpanel CSS');
else bad('S14.07: tabpanel CSS yoq');
if (tabsJs.includes('ArrowRight') && tabsJs.includes('Home') && tabsJs.includes('End')) ok('S14.07: arrow-nav + Home/End');
else bad('S14.07: arrow-nav/Home/End JS yoq');
if (tabsJs.includes('tabIndex = on ? 0 : -1') || tabsJs.includes('t.tabIndex')) ok('S14.07: roving tabindex (focus/selection separation)');
else bad('S14.07: roving tabindex yoq');
if (!tabsJs.includes('setInterval') && !tabsJs.includes('auto-rotate')) ok('S14.08: auto-rotate yoq');
else bad('S14.08: auto-rotate bor');

// ── S14.09-10: accordion ──
const accCss = rd('public/design/components/accordion.css');
const accJs = rd('public/js/components/accordion.js');
if (accJs.includes('aria-expanded')) ok('S14.09: accordion aria-expanded');
else bad('S14.09: aria-expanded yoq');
if (accCss.includes('grid-template-rows')) ok('S14.10: grid-rows motion');
else bad('S14.10: grid-rows motion yoq');
if (accCss.includes('200ms') || accCss.includes('180ms')) ok('S14.10: 180-220ms motion');
else bad('S14.10: motion duration 180-220ms emas');
if (accCss.includes('prefers-reduced-motion')) ok('S14.10: reduced-motion instant');
else bad('S14.10: reduced-motion yoq');

// ── S14.09: no div onclick accordion pattern (view'lar) ──
let divOnclick = 0;
(function walk(p) {
  for (const e of readdirSync(join(ROOT, p), { withFileTypes: true })) {
    const fp = join(p, e.name);
    if (e.isDirectory()) walk(fp);
    else if (e.name.endsWith('.ejs')) {
      const c = rd(fp);
      divOnclick += (c.match(/<div[^>]*onclick=[^>]*acc/gi) || []).length;
    }
  }
})('views');
if (divOnclick === 0) ok('S14.09: div[onclick] accordion pattern yoq');
else bad(`S14.09: ${divOnclick} ta div onclick accordion qoldi`);

// ── S14.11: nested interactive link in select-card label ──
const dev = rd('views/dev/components.ejs');
// label ichidagi interactive elementlar (keyingi <button>lar emas):
const cardBlocks = dev.match(/<label class="select-card">[\s\S]*?<\/label>/g) || [];
if (cardBlocks.length === 0) bad('S14.11: select-card topilmadi (regex mos emas)');
else {
  const nestedInteractive = cardBlocks.filter((b) => /<a\b|<button\b/.test(b)).length;
  if (nestedInteractive === 0) ok('S14.11: select-card ichida nested link/button yoq');
  else bad(`S14.11: ${nestedInteractive} ta select-card ichida nested interactive element`);
}

// ── head.ejs imports ──
const head = rd('views/partials/head.ejs');
for (const c of ['selection.css', 'tabs.css', 'accordion.css', 'components/tabs.js', 'components/accordion.js']) {
  if (head.includes(c)) ok(`S14: head.ejs ${c}`);
  else bad(`S14: head.ejs ${c} yoq`);
}

console.log('');
if (errors.length) {
  console.log(`❌ Selection validator: ${errors.length} xato`);
  process.exit(1);
}
console.log('✅ Selection validator: PASS');
process.exit(0);
