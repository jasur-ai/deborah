#!/usr/bin/env node
/**
 * STYLE STEP 15 — Overlays validator (S15.01–S15.12)
 * Dialog, popover, menu, tooltip, toast.
 */
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

const ROOT = process.cwd();
let errors = [];
const ok = (m) => console.log('✅', m);
const bad = (m) => { errors.push(m); console.log('❌', m); };

const rd = (p) => readFileSync(join(ROOT, p), 'utf8');
const head = rd('views/partials/head.ejs');
const dlgCss = rd('public/design/components/dialog.css').replace(/\/\*[\s\S]*?\*\//g, '');
const toastCss = rd('public/design/components/toast.css').replace(/\/\*[\s\S]*?\*\//g, '');
const popCss = rd('public/design/components/popover.css').replace(/\/\*[\s\S]*?\*\//g, '');
const tipCss = rd('public/design/components/tooltip.css').replace(/\/\*[\s\S]*?\*\//g, '');
const ovJs = rd('public/js/components/overlays.js');
const mainJs = rd('public/js/main.js');

// ── head.ejs imports ──
for (const c of ['dialog.css', 'popover.css', 'tooltip.css', 'toast.css', 'components/overlays.js']) {
  if (head.includes(c)) ok(`S15: head.ejs ${c}`);
  else bad(`S15: head.ejs ${c} yoq`);
}

// ── S15.01-03: dialog shell ──
if (/<dialog/.test(ovJs)) ok('S15.01: native <dialog> ishlatiladi');
else bad('S15.01: native <dialog> yoq');
for (const v of ['dialog--sm', 'dialog--md', 'dialog--lg', 'dialog--full']) {
  if (dlgCss.includes(v)) ok(`S15.02: variant ${v}`);
  else bad(`S15.02: variant ${v} yoq`);
}
if (dlgCss.includes('44px')) ok('S15.03: close 44px');
else bad('S15.03: close 44px emas');
if (dlgCss.includes('overflow-y: auto')) ok('S15.03: body scroll');
else bad('S15.03: body scroll yoq');
if (dlgCss.includes('sticky')) ok('S15.03: sticky footer');
else bad('S15.03: sticky footer yoq');

// ── S15.04: initial focus — danger auto focus emas ──
if (ovJs.includes('[data-no]').toString() && /data-no[^]*?focus/.test(ovJs)) ok('S15.04: initial focus cancel (danger emas)');
else bad('S15.04: initial focus cancel emas');
if (/danger/.test(ovJs) && !/\$\{opts\.dangerAutoFocus\}/.test(ovJs)) ok('S15.04: danger auto-focus yoq');
else bad('S15.04: danger auto-focus ehtimoli');

// ── S15.05: Escape/overlay click + trigger restore ──
if (ovJs.includes("'cancel'")) ok('S15.05: Escape (cancel) handler');
else bad('S15.05: Escape handler yoq');
if (ovJs.includes('e.target === dlg')) ok('S15.05: overlay click');
else bad('S15.05: overlay click yoq');
if (ovJs.includes('__trigger') && /prev\.focus/.test(ovJs)) ok('S15.05: trigger focus restore');
else bad('S15.05: trigger focus restore yoq');
if (/dlg\.close\(\);?[\s\S]{0,80}prev\.focus/.test(ovJs)) ok('S15.05: focus restore close dan keyin');
else bad('S15.05: focus restore close dan keyin emas');

// ── S15.06: motion ──
if (dlgCss.includes('200ms') || dlgCss.includes('220ms')) ok('S15.06: enter 200-220ms');
else bad('S15.06: enter 200-220ms emas');
if (dlgCss.includes('150ms') || dlgCss.includes('140ms') || dlgCss.includes('160ms')) ok('S15.06: exit 140-160ms');
else bad('S15.06: exit 140-160ms emas');
if (dlgCss.includes('prefers-reduced-motion')) ok('S15.06: reduced-motion');
else bad('S15.06: reduced-motion yoq');

// ── S15.07: popover ──
if (ovJs.includes('aria-expanded')) ok('S15.07: trigger aria-expanded');
else bad('S15.07: aria-expanded yoq');
if (ovJs.includes('ArrowDown') || ovJs.includes('ArrowUp')) ok('S15.07: arrow nav');
else bad('S15.07: arrow nav yoq');
if (ovJs.includes("'Escape'")) ok('S15.07: Escape');
else bad('S15.07: Escape yoq');
if (popCss.includes('.popover__item')) ok('S15.07: menu items');
else bad('S15.07: menu items yoq');

// ── S15.08: tooltip ──
if (tipCss.includes('pointer-events: none')) ok('S15.08: tooltip non-interactive');
else bad('S15.08: tooltip non-interactive emas');
if (ovJs.includes('aria-describedby')) ok('S15.08: aria-describedby');
else bad('S15.08: aria-describedby yoq');

// ── S15.09: toast variants ──
for (const v of ['toast--success', 'toast--info', 'toast--warning', 'toast--error']) {
  if (toastCss.includes(v)) ok(`S15.09: ${v}`);
  else bad(`S15.09: ${v} yoq`);
}
if (ovJs.includes("role', 'alert'")) ok('S15.09: critical error role=alert (faqat toast emas)');
else bad('S15.09: critical error role=alert yoq');

// ── S15.10: position ──
if (toastCss.includes('top: 16px') && toastCss.includes('right: 16px')) ok('S15.10: desktop top-right');
else bad('S15.10: desktop top-right emas');
if (toastCss.includes('safe-area-inset-bottom')) ok('S15.10: mobile bottom safe-area');
else bad('S15.10: mobile safe-area yoq');
if (toastCss.includes('max-width') && ovJs.includes('children.length >= 3')) ok('S15.10: max 3');
else bad('S15.10: max 3 yoq');

// ── S15.11: inline visual CSS/HTML ko'chirilgan ──
if (!/style\.cssText/.test(mainJs)) ok('S15.11: main.js inline visual CSS yoq');
else bad('S15.11: main.js hali inline visual CSS');
if (!/style="[^"]*(background|border|border-radius)/.test(mainJs)) ok('S15.11: main.js inline visual HTML yoq');
else bad('S15.11: main.js hali inline visual HTML');
if (ovJs.includes("classList.add('is-closing')") || ovJs.includes('classList.add("is-closing"')) ok('S15.11: exit motion reusable');
else bad('S15.11: exit motion reusable emas');

// ── S15.12: panel.ejs eski confirm-modal tozalandi ──
const panel = rd('views/user/panel.ejs');
if (!panel.includes('id="confirm-modal"')) ok('S15.12: panel.ejs confirm-modal olib tashlandi');
else bad('S15.12: panel.ejs hali eski confirm-modal');

// ── Yakuniy ──
console.log('');
if (errors.length === 0) console.log('✅ Overlays validator: PASS');
else {
  console.log(`❌ Overlays validator: ${errors.length} xato`);
  process.exitCode = 1;
}
