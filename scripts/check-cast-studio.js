#!/usr/bin/env node
/**
 * STEP 28 — Cast Setup Studio validator (S28.01-12)
 * Run: node scripts/check-cast-studio.js
 */
import { readFileSync, existsSync } from 'fs';

let fails = 0;
const ok = (msg) => console.log('✅ ' + msg);
const bad = (msg) => { console.log('❌ ' + msg); fails++; };

for (const f of ['views/partials/cast-studio.ejs', 'public/css/cast-studio.css', 'public/js/cast-studio.js']) {
  if (!existsSync(f)) { console.log(`❌ ${f} yo‘q`); process.exit(1); }
}
const view = readFileSync('views/user/panel.ejs', 'utf8');
const partial = readFileSync('views/partials/cast-studio.ejs', 'utf8');
const css = readFileSync('public/css/cast-studio.css', 'utf8');
const js = readFileSync('public/js/cast-studio.js', 'utf8');

console.log('STEP 28 — Cast Setup Studio');

// ── S28.01: desktop 880–960px dialog + mobile full-screen sheet ──
console.log('— S28.01 dialog sizing');
if (!css.includes('max-width: 960px')) bad('S28.01: dialog max-width 960px yo‘q');
else ok('S28.01: desktop dialog 960px');
if (!css.includes('@media (max-width: 640px)')) bad('S28.01: mobile media query yo‘q');
else ok('S28.01: mobile media query mavjud');
if (!css.includes('92dvh') && !css.includes('100dvh')) bad('S28.01: mobile full-screen sheet (dvh) yo‘q');
else ok('S28.01: mobile full-screen sheet mavjud');

// ── S28.02: native radio mode cards ──
console.log('— S28.02 mode radio cards');
if (!js.includes('type="radio"') || !js.includes('name="cs-mode"')) bad('S28.02: native radio mode cards yo‘q');
else ok('S28.02: native radio cards mavjud');
if (!js.includes('role="radiogroup"')) bad('S28.02: radiogroup ARIA yo‘q');
else ok('S28.02: radiogroup mavjud');
if (!view.includes('../partials/cast-studio')) bad('S28.02: panel partial include qilmaydi');
else ok('S28.02: panel partial include qiladi');

// ── S28.03: neutral cards, no rainbow ──
console.log('— S28.03 neutral cards');
if (!css.includes('--deborah-semantic-color-action-primary-soft')) bad('S28.03: token-based selected state yo‘q');
else ok('S28.03: token selected state mavjud');
if (/[#][0-9a-fA-F]{3,6}\b/.test(css)) { bad('S28.03/S28.11: raw hex color topildi'); } else ok('S28.03/S28.11: raw hex yo‘q (hammasi token)');

// ── S28.04: Essentials + Advanced accordion ──
console.log('— S28.04 essentials + advanced');
for (const [label, needle] of [
  ['pace', 'cs-pace-chips'], ['think', 'cs-think-chips'], ['timer', 'cs-timer-chips'],
  ['scoring', 'cs-scoring'], ['leaderboard', 'cs-lb-chips'], ['join', 'cs-join-chips'],
]) {
  if (!js.includes(needle)) bad(`S28.04: ${label} maydoni yo‘q (${needle})`);
  else ok(`S28.04: ${label} mavjud`);
}
if (!js.includes('cs-advanced-toggle') || !js.includes('aria-expanded')) bad('S28.04: advanced accordion yo‘q');
else ok('S28.04: advanced accordion mavjud');

// ── S28.05: preset summary + customized badge + reset ──
console.log('— S28.05 preset summary');
for (const needle of ['cast-summary', 'cs-customized', 'cs-reset']) {
  if (!js.includes(needle)) bad(`S28.05: ${needle} yo‘q`);
  else ok(`S28.05: ${needle} mavjud`);
}

// ── S28.06: preflight summaries before footer (privacy + a11y) ──
console.log('— S28.06 preflight summaries');
if (!js.includes('cs-preflight')) bad('S28.06: cs-preflight bo‘limi yo‘q');
else ok('S28.06: cs-preflight mavjud');
for (const [label, needle] of [['privacy', 'Maxfiylik'], ['a11y', 'Qulaylik (a11y)'], ['duration', 'Kutilgan davomiylik']]) {
  if (!js.includes(needle)) bad(`S28.06: ${label} summary yo‘q`);
  else ok(`S28.06: ${label} summary mavjud`);
}

// ── S28.07: severity classes + icon+title ──
console.log('— S28.07 severity');
for (const cls of ['--danger', '--warning', '--info']) {
  if (!css.includes(`cs-summary-item${cls}`)) bad(`S28.07: ${cls} class yo‘q`);
  else ok(`S28.07: ${cls} class mavjud`);
}
if (!js.includes('cs-title')) bad('S28.07: title qatori yo‘q');
else ok('S28.07: icon+title structure mavjud');

// ── S28.08: governance lock markers (hidden emas) ──
console.log('— S28.08 governance locks');
for (const needle of ['cs-locked', 'cs-gov-banner', 'lockMark']) {
  if (!js.includes(needle)) bad(`S28.08: ${needle} yo‘q`);
  else ok(`S28.08: ${needle} mavjud`);
}
if (!js.includes('cs-locked-chip')) bad('S28.08: locked chip style yo‘q');
else ok('S28.08: locked chip mavjud');

// ── S28.09: dirty + escape confirm + focus trap + restore ──
console.log('— S28.09 focus/dirty');
for (const needle of ['focusTrap', 'requestClose', 'showConfirm', 'is-dirty', 'focusedBeforeOpen']) {
  if (!js.includes(needle)) bad(`S28.09: ${needle} yo‘q`);
  else ok(`S28.09: ${needle} mavjud`);
}
if (!css.includes('is-dirty .cs-dirty-dot')) bad('S28.09: dirty dot CSS yo‘q');
else ok('S28.09: dirty dot CSS mavjud');

// ── S28.10: submit request-id + pending label saqlanadi ──
console.log('— S28.10 submit pending');
for (const needle of ['requestId', 'studioState.submitting', 'aria-busy', 'data-cs-launch-label']) {
  if (!js.includes(needle)) bad(`S28.10: ${needle} yo‘q`);
  else ok(`S28.10: ${needle} mavjud`);
}

// ── S28.11: external files; no transition:all ──
console.log('— S28.11 external css/js');
if (!/transition:\s*all/i.test(css)) ok('S28.11: transition:all yo‘q');
else bad('S28.11: transition:all topildi');
if (view.includes('.cast-studio-overlay{') || view.includes('cast-studio-overlay{')) bad('S28.11: panel inline cast-studio CSS qoldig‘i');
else ok('S28.11: panel inline CSS olib tashlangan');

console.log(fails ? `\n${fails} ta xato` : '\nPASS — STEP 28 barcha talablari bajarildi');
process.exit(fails ? 1 : 0);
