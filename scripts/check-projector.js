#!/usr/bin/env node
/**
 * STEP 30 — Projector classroom display validator (S30.01-11).
 * Run: node scripts/check-projector.js
 */
import { readFileSync, existsSync } from 'fs';
let fails = 0;
const ok = (m) => console.log('  ✓ ' + m);
const bad = (m) => { fails++; console.log('  ✗ ' + m); };

const has = (file, re, msg) => {
  if (!existsSync(file)) { bad(file + ' topilmadi'); return false; }
  const src = readFileSync(file, 'utf8');
  if (typeof re === 'string' ? src.includes(re) : re.test(src)) ok(msg); else bad(msg);
  return true;
};

console.log('STEP 30 — S30.01 projector-only view (no private DOM)');
const ejs = readFileSync('views/cast/projector.ejs', 'utf8');
// HTML comment'lar va EJS qoidalarini strip — faqat haqiqiy DOM elementlarini tekshiramiz
const ejsBody = ejs.replace(/<!--[\s\S]*?-->/g, '').replace(/<%[\s\S]*?%>/g, '');
if (!/dir-|roster|coHost|host-control|data-participant/i.test(ejsBody)) ok('S30.01: private DOM/controls yo\'q');
else bad('S30.01: private DOM elementi topildi');

console.log('STEP 30 — S30.02 QR + join code + short link + count');
if (/id="proj-qr"/.test(ejs)) ok('S30.02: QR img mavjud'); else bad('S30.02: QR img yo\'q');
if (/id="proj-code"/.test(ejs) && /id="proj-link"/.test(ejs)) ok('S30.02: join code + short link'); else bad('S30.02: code/link yo\'q');
if (/proj-qr/.test(readFileSync('public/design/contexts/projector.css', 'utf8'))) ok('S30.02: QR CSS'); else bad('S30.02: QR CSS yo\'q');

console.log('STEP 30 — S30.03 kod minimize chip + teacher qayta ko\'rsatish');
if (/id="proj-code-chip"/.test(ejs)) ok('S30.03: kod chip mavjud'); else bad('S30.03: kod chip yo\'q');
const js = readFileSync('public/js/cast-projector.js', 'utf8');
if (/showCodeChip/.test(js) && /codeChip\.addEventListener/.test(js)) ok('S30.03: chip show + click qayta ko\'rsatish'); else bad('S30.03: chip JS yo\'q');

console.log('STEP 30 — S30.04 font-size floor (question 40-64, option 28-40, meta 24+, code 72-120)');
const pcss = readFileSync('public/design/contexts/projector.css', 'utf8');
if (/\-\-proj-qsize: clamp\(40px/.test(pcss)) ok('S30.04: question floor 40px'); else bad('S30.04: question floor yo\'q');
if (/\-\-proj-osize: clamp\(28px/.test(pcss)) ok('S30.04: option floor 28px'); else bad('S30.04: option floor yo\'q');
if (/\-\-proj-msize: clamp\(24px/.test(pcss)) ok('S30.04: meta floor 24px'); else bad('S30.04: meta floor yo\'q');
if (/\-\-proj-csize: clamp\(72px/.test(pcss)) ok('S30.04: code floor 72px'); else bad('S30.04: code floor yo\'q');

console.log('STEP 30 — S30.05 solid options + shape + letter (no shimmer)');
if (/opt-letter/.test(pcss) && /opt-letter/.test(js)) ok('S30.05: option letter mavjud'); else bad('S30.05: option letter yo\'q');
const pcssBody = pcss.replace(/\/\*[\s\S]*?\*\//g, '');
if (!/shimmer|sweep/.test(pcssBody)) ok('S30.05: shimmer/sweep yo\'q'); else bad('S30.05: shimmer/sweep topildi');

console.log('STEP 30 — S30.06 timer number + label + ring (no flashing, no color-only)');
if (/proj-timer-num/.test(ejs) && /proj-timer-label/.test(ejs) && /proj-timer-ring/.test(ejs)) ok('S30.06: num+label+ring'); else bad('S30.06: timer tuzilmasi yo\'q');
if (/is-critical/.test(pcss) && /vaqt tugayapti/.test(pcss)) ok('S30.06: critical label (color-only emas)'); else bad('S30.06: critical label yo\'q');
if (!/animation: pulse|pulse 1s infinite/.test(pcss)) ok('S30.06: pulse flashing yo\'q'); else bad('S30.06: pulse hali bor');

console.log('STEP 30 — S30.07 distribution max 5 bar + reveal keyin');
if (/proj-dist-bars/.test(ejs)) ok('S30.07: distribution kontayner'); else bad('S30.07: dist kontayner yo\'q');
if (/slice\(0, 5\)/.test(js)) ok('S30.07: max 5 bar'); else bad('S30.07: max 5 yo\'q');
const handler = readFileSync('socket/cast-handler.js', 'utf8');
if (/reveal\.distribution/.test(handler) && /slice\(0, 5\)/.test(handler)) ok('S30.07: server public distribution (max 5)'); else bad('S30.07: server distribution yo\'q');

console.log('STEP 30 — S30.08 classroom profillari');
if (/data-proj-mode/.test(ejs)) ok('S30.08: data-proj-mode body'); else bad('S30.08: data-proj-mode yo\'q');
if (/classroom_dark/.test(pcss) && /classroom_light/.test(pcss) && /high_contrast/.test(pcss)) ok('S30.08: 3 profil token'); else bad('S30.08: profillar yetarli emas');

console.log('STEP 30 — S30.09 safe area 4vw/3vh + 16:9/4:3');
if (/\-\-proj-safe-x: max\(4vw/.test(pcss) && /\-\-proj-safe-y: max\(3vh/.test(pcss)) ok('S30.09: safe area'); else bad('S30.09: safe area yo\'q');
if (/max-aspect-ratio: 4\/3/.test(pcss)) ok('S30.09: 4:3 overscan'); else bad('S30.09: 4:3 reflow yo\'q');

console.log('STEP 30 — S30.10 long question font floor (no ellipsis)');
if (/applyFontFloor/.test(js)) ok('S30.10: font floor JS'); else bad('S30.10: font floor yo\'q');
if (/ellipsis/.test(ejs) && !/proj-q-text/.test(ejs)) bad('S30.10: ellipsis topildi'); else ok('S30.10: ellipsis yo\'q');

console.log('STEP 30 — S30.11 reduced motion');
if (/prefers-reduced-motion: reduce/.test(pcss)) ok('S30.11: reduced motion'); else bad('S30.11: reduced motion yo\'q');

console.log('STEP 30 — QR endpoint');
const routes = readFileSync('routes/cast.js', 'utf8');
if (/router\.get\('.cast.qr./.test(routes) && /qrcode/.test(routes)) ok('S30.02: QR SVG endpoint'); else bad('S30.02: QR endpoint yo\'q');

console.log(fails ? '\n' + fails + ' ta xato' : '\nPASS — STEP 30 barcha talablari bajarildi');
process.exit(fails ? 1 : 0);
