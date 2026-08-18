#!/usr/bin/env node
/**
 * STYLE STEP 16 — UI states validator (S16.01–S16.12)
 * Loading, progress, empty, error, offline.
 */
import { readFileSync } from 'fs';
import { join } from 'path';

const ROOT = process.cwd();
let errors = [];
const ok = (m) => console.log('✅', m);
const bad = (m) => { errors.push(m); console.log('❌', m); };

const rd = (p) => readFileSync(join(ROOT, p), 'utf8');
const head = rd('views/partials/head.ejs');
const skCss = rd('public/design/components/skeleton.css').replace(/\/\*[\s\S]*?\*\//g, '');
const prCss = rd('public/design/components/progress.css').replace(/\/\*[\s\S]*?\*\//g, '');
const esCss = rd('public/design/components/empty-state.css').replace(/\/\*[\s\S]*?\*\//g, '');
const msgCss = rd('public/design/components/message.css').replace(/\/\*[\s\S]*?\*\//g, '');
const offCss = rd('public/design/components/offline.css').replace(/\/\*[\s\S]*?\*\//g, '');
const mainJs = rd('public/js/main.js');
const offJs = rd('public/js/components/offline-banner.js');
const errView = rd('views/error.ejs');
const errMw = rd('middleware/error.js');

// ── head.ejs imports ──
for (const c of ['skeleton.css', 'progress.css', 'empty-state.css', 'message.css', 'offline.css', 'components/offline-banner.js']) {
  if (head.includes(c)) ok(`S16: head.ejs ${c}`);
  else bad(`S16: head.ejs ${c} yoq`);
}

// ── S16.01: loader durationga mos (spinner + determinate progress) ──
if (prCss.includes('.spinner')) ok('S16.01: inline spinner');
else bad('S16.01: inline spinner yoq');
if (prCss.includes('.progress__bar')) ok('S16.01: determinate progressbar');
else bad('S16.01: determinate progressbar yoq');

// ── S16.02-03: skeleton — structured contexts only ──
if (skCss.includes('skeleton--card') && skCss.includes('skeleton--list-item') && skCss.includes('skeleton--table-row')) ok('S16.02: structured contexts (card/list/table)');
else bad('S16.02: structured contexts yoq');
if (skCss.includes('prefers-reduced-motion')) ok('S16.03: shimmer reduced-motion off');
else bad('S16.03: reduced-motion shimmer off emas');

// ── S16.04: button pending — label/width saqlanadi, duplicate block ──
if (mainJs.includes('function setPending') && mainJs.includes('minWidth') && mainJs.includes('disabled = true')) ok('S16.04: setPending — width stable + disable');
else bad('S16.04: setPending yoq');
if (mainJs.includes('dataset.__pending')) ok('S16.04: duplicate submit block');
else bad('S16.04: duplicate submit block yoq');

// ── S16.05-07: empty states ──
for (const v of ['no-results', 'permission', 'system-error', 'completion']) {
  if (esCss.includes(v)) ok(`S16.05: empty-state--${v}`);
  else bad(`S16.05: empty-state--${v} yoq`);
}
// first-use — default variant (o'ziga xos tonalite yo'q)
if (esCss.includes('.empty-state')) ok('S16.05: empty-state--first-use (default)');
else bad('S16.05: empty-state yoq');
if (esCss.includes('empty-state__actions')) ok('S16.06: first-use primary action');
else bad('S16.06: action yoq');
if (esCss.includes('empty-state__query')) ok('S16.07: no-results query summary');
else bad('S16.07: query summary yoq');

// ── S16.08: error message format — raw stack yo'q ──
if (msgCss.includes('message__title') && msgCss.includes('message__actions')) ok('S16.08: error format nima bol' + 'di + nima qilish');
else bad('S16.08: error format yoq');
if (errView.includes('isDev') && errView.includes('stack')) ok('S16.08: stack faqat dev');
else bad('S16.08: stack dev guard yoq');
if (errMw.includes("process.env.NODE_ENV === 'production' ? null : err.stack")) ok('S16.08: prod' + 'da stack null');
else bad('S16.08: prod stack null emas');

// ── S16.09-10: offline — data saqlanadi, reconnect progress, retry/cancel ──
if (offJs.includes('pendingOps')) ok('S16.09: offline pending ops saqlanadi');
else bad('S16.09: pending saqlash yoq');
if (offJs.includes('setProgress') && offJs.includes('progress(')) ok('S16.09: reconnect progress');
else bad('S16.09: reconnect progress yoq');
if (offJs.includes('retry') && offJs.includes('cancel')) ok('S16.09: retry/cancel action');
else bad('S16.09: retry/cancel yoq');
if (!offJs.includes('fullscreen') && offCss.includes('position: fixed')) ok('S16.10: banner (full-screen overlay emas)');
else bad('S16.10: banner yoki fullscreen muammo');

// ── S16.11: aria-busy, live status, progress semantics ──
if (mainJs.includes("aria-busy")) ok('S16.11: aria-busy');
else bad('S16.11: aria-busy yoq');
if (prCss.includes('.progress') && (prCss.includes('width') || prCss.includes('progress__bar'))) ok('S16.11: progressbar semantics');
else bad('S16.11: progressbar semantics yoq');
if (offJs.includes("'role', 'status'") || offJs.includes('setAttribute(\'role\'')) ok('S16.11: live status');
else bad('S16.11: live status yoq');

// ── Yakuniy ──
console.log('');
if (errors.length === 0) console.log('✅ States validator: PASS');
else {
  console.log(`❌ States validator: ${errors.length} xato`);
  process.exitCode = 1;
}
