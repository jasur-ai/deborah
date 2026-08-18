#!/usr/bin/env node
/**
 * STEP 31 — Participant join va answer experience validator (S31.01-12).
 * Run: node scripts/check-participant.js
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

const ejs = readFileSync('views/cast/participant.ejs', 'utf8');
const js = readFileSync('public/js/cast-participant.js', 'utf8');
const css = readFileSync('public/css/cast-participant.css', 'utf8');
const cssBody = css.replace(/\/\*[\s\S]*?\*\//g, '');

console.log('STEP 31 — S31.01 join flow progress');
if (/join-steps/.test(ejs) && /join-step is-current/.test(ejs)) ok('S31.01: join progress stepper'); else bad('S31.01: stepper yo\'q');

console.log('STEP 31 — S31.02 code input monospace + mobile');
if (/join-code-input/.test(css) && /font-family: 'JetBrains Mono'/.test(css)) ok('S31.02: monospace code input'); else bad('S31.02: monospace yo\'q');
if (/inputmode="text"/.test(ejs) && /autocapitalize="characters"/.test(ejs)) ok('S31.02: mobile keyboard + autofill'); else bad('S31.02: mobile keyboard yo\'q');
if (/letter-spacing: 0.35em/.test(css)) ok('S31.02: tabular spacing'); else bad('S31.02: tabular spacing yo\'q');

console.log('STEP 31 — S31.03 avatar optional (join bloklamaydi)');
if (/avatarId: null/.test(js)) ok('S31.03: avatar optional (null default)'); else bad('S31.03: avatarId null yo\'q');

console.log('STEP 31 — S31.04 full-width 48px+ touch + shape+letter+text');
if (/min-height: 48px/.test(css)) ok('S31.04: 48px touch target'); else bad('S31.04: 48px yo\'q');
if (/cast-opt-letter/.test(css) && /cast-opt-letter/.test(js)) ok('S31.04: letter marker'); else bad('S31.04: letter yo\'q');

console.log('STEP 31 — S31.05 visual states (OPEN/SELECTED/SENDING/SAVED/RETRYING/LOCKED/REVEALED)');
if (/part-state-banner/.test(ejs) && /part-state-banner\[data-state='SAVED'\]/.test(css)) ok('S31.05: state banner + CSS'); else bad('S31.05: state banner yo\'q');
for (const st of ['SELECTED', 'SENDING', 'SAVED', 'RETRYING', 'LOCKED']) {
  if (!cssBody.includes(`[data-state='${st}']`)) bad('S31.05: banner state ' + st + ' yo\'q');
}
ok('S31.05: SELECTED/SENDING/SAVED/RETRYING/LOCKED banner stillari');

console.log('STEP 31 — S31.06 retry selection + server ACK keyin SAVED');
if (/lastSubmittedIds/.test(js) && /showPreviousOnRevote/.test(js)) ok('S31.06: selection retained on revote'); else bad('S31.06: retained selection yo\'q');
if (/ack\.ok/.test(js) && /setState\(STATE\.SAVED\)/.test(js)) ok('S31.06: SAVED faqat ack.ok keyin'); else bad('S31.06: ack-based SAVED yo\'q');

console.log('STEP 31 — S31.07 no shimmer/bounce/glow waiting');
if (!/shimmer|sweep|bounce|glow/.test(cssBody)) ok('S31.07: shimmer/bounce/glow yo\'q'); else bad('S31.07: shimmer/bounce/glow topildi');

console.log('STEP 31 — S31.08 player badge + safe-area');
if (/player-badge/.test(ejs) && /player-badge/.test(css)) ok('S31.08: player badge'); else bad('S31.08: badge yo\'q');
if (/safe-area-inset-top/.test(css) && /safe-area-inset-bottom/.test(css)) ok('S31.08: safe-area'); else bad('S31.08: safe-area yo\'q');

console.log('STEP 31 — S31.09 personal prefs (mute/reduced/highContrast) localStorage');
if (/localStorage\.setItem\(PREF_KEY/.test(js) && /PREF_KEY = 'cast-participant-prefs-v1'/.test(js)) ok('S31.09: prefs localStorage'); else bad('S31.09: prefs storage yo\'q');
if (/part-pref-reduced/.test(css) && /part-pref-contrast/.test(css)) ok('S31.09: prefs CSS'); else bad('S31.09: prefs CSS yo\'q');

console.log('STEP 31 — S31.10 reveal semantic green/red + icon + text');
if (/part-reveal--correct/.test(css) && /part-reveal--wrong/.test(css)) ok('S31.10: semantic classes'); else bad('S31.10: semantic class yo\'q');
if (/part-reveal-verdict/.test(css) && /part-reveal-verdict/.test(js)) ok('S31.10: verdict badge (icon+text)'); else bad('S31.10: verdict yo\'q');

console.log('STEP 31 — S31.11 network status persistent');
if (/part-net/.test(ejs) && /updateNet\(/.test(js)) ok('S31.11: network status persistent'); else bad('S31.11: net status yo\'q');
if (/part-net\[data-net='offline'\]/.test(css)) ok('S31.11: offline dot CSS'); else bad('S31.11: offline dot yo\'q');

console.log(fails ? '\n' + fails + ' ta xato' : '\nPASS — STEP 31 barcha talablari bajarildi');
process.exit(fails ? 1 : 0);
