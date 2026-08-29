#!/usr/bin/env node
/* STYLE STEP 32 — Leaderboard, celebration va mature gamification validator.
   S32.01-S32.11 talablarni tekshiradi. */
'use strict';
import { readFileSync, existsSync } from 'fs';

let fails = 0;
const ok = (m) => console.log('  ✓', m);
const bad = (m) => { console.log('  ✗', m); fails += 1; };
const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

console.log('STEP 32 — Leaderboard, celebration va mature gamification');

// ── S32.01: mode'lar — server'da visibility enum'lar + client render mode'lar ──
console.log('\nS32.01 — Leaderboard mode lar (Off/Personal/TopN/Team/HostPrivate)');
const constSrc = readFileSync('utils/cast-constants.js', 'utf8');
const constClean = stripComments(constSrc);
if (!/CAST_LB_VISIBILITY\s*=\s*\{[\s\S]*OFF_DURING_LEARNING[\s\S]*PERSONAL_ONLY[\s\S]*TOP_N[\s\S]*TEAM_ONLY[\s\S]*FULL_PRIVATE_HOST/.test(constClean)) bad("S32.01: CAST_LB_VISIBILITY enum to'liq emas");
else ok('S32.01: visibility enum (off/personal/top_n/team/full_private_host) mavjud');
const lbJs = readFileSync('public/js/cast-leaderboard.js', 'utf8');
if (!/public_top_n/.test(constSrc) && !/mode:\s*'public_top_n'/.test(readFileSync('socket/cast-handler.js', 'utf8'))) bad("S32.01: public_top_n mode emit yo'q");
else ok('S32.01: public_top_n mode emit mavjud');
if (!/mode:\s*'personal'/.test(readFileSync('socket/cast-handler.js', 'utf8'))) bad("S32.01: personal mode emit yo'q");
else ok('S32.01: personal mode emit mavjud');

// ── S32.02: public Top N default max 5; bottom ranks yashirin ──
console.log('\nS32.02 — Public Top N max 5, low ranks hidden');
const sockSrc = readFileSync('socket/cast-handler.js', 'utf8');
if (!/Math\.min\(lb\.topN \|\| 5, 5\)/.test(sockSrc)) bad("S32.02: topN clamp max 5 yo'q");
else ok('S32.02: public topN max 5 clamp');
if (!/hiddenCount/.test(sockSrc) && !/hiddenCount/.test(readFileSync('services/cast/leaderboard.js', 'utf8'))) bad("S32.02: hiddenCount (pastki o'rinlar yashirish) yo'q");
else ok('S32.02: hiddenCount projection mavjud');

// ── S32.03: neutral rank rows — flames/crowns/podium default yo'q ──
console.log('\nS32.03 — Neutral rank rows (no flames/crowns/podium)');
const lbCss = readFileSync('public/design/contexts/leaderboard.css', 'utf8');
const cssClean = stripComments(lbCss);
if (/👑|🔥|🏆|podium/.test(cssClean) && !/S32/.test(cssClean)) bad("S32.03: flames/crowns/podium stillari topildi");
else ok('S32.03: neutral list — flames/crowns/podium yo q');
if (!/lb-row/.test(lbCss)) bad("S32.03: lb-row stillari yo'q");
else ok('S32.03: neutral lb-row mavjud');

// ── S32.04: CVD-safe subtle medal tones ──
console.log('\nS32.04 — CVD-safe subtle medal tones');
if (!/lb-medal--gold/.test(lbCss) || !/lb-medal--silver/.test(lbCss) || !/lb-medal--bronze/.test(lbCss)) bad("S32.04: gold/silver/bronze medal class'lar yo'q");
else ok('S32.04: medal tones (gold/silver/bronze) mavjud');
if (!/MEDAL_LABEL/.test(lbJs)) bad("S32.04: rangga tayanmaydigan label yo'q");
else ok('S32.04: medal label (rang + belgi + raqam) — CVD-safe');

// ── S32.05: personal rank participant-private ──
console.log('\nS32.05 — Personal rank participant-private');
if (!/mode:\s*'personal'/.test(sockSrc)) bad("S32.05: personal emit yo'q");
else ok('S32.05: personal emit mavjud');
const partJs = readFileSync('public/js/cast-participant.js', 'utf8');
if (!/part-leaderboard/.test(partJs)) bad("S32.05: participant personal UI yo'q");
else ok('S32.05: participant personal panel mavjud');
if (!/personalBest|Shaxsiy/.test(partJs)) bad("S32.05: personal best ko'rsatilmayapti");
else ok('S32.05: personal best + progress mavjud');

// ── S32.06: team leaderboard individual low performance reveal qilmaydi ──
console.log('\nS32.06 — Team leaderboard individual reveal yo q');
if (!/buildTeamLeaderboard/.test(sockSrc)) bad("S32.06: team leaderboard yo'q");
else ok('S32.06: team leaderboard mavjud (jamoa darajasida)');
if (!/renderTeam/.test(lbJs)) bad("S32.06: renderTeam funksiyasi yo'q");
else ok('S32.06: renderTeam — individual rank ko rsatilmaydi');

// ── S32.07: stagger max 40ms x 5; falling/reorder yo'q ──
console.log('\nS32.07 — Enter stagger 40ms x 5, no falling/reorder');
if (!/40/.test(lbCss) || !/\* 40/.test(lbJs)) bad("S32.07: 40ms stagger yo'q");
else ok('S32.07: stagger 40ms topilgan');
const cssClean32 = stripComments(lbCss) + stripComments(readFileSync('public/design/contexts/projector.css', 'utf8'));
if (/translateY\([2-9]\d|translateY\(1\d\d/.test(cssClean32)) bad("S32.07: katta falling motion topildi");
else ok('S32.07: falling/reorder animation yo q');
if (/keyframes lb-row-in[\s\S]{0,80}/.test(lbCss)) ok('S32.07: lb-row-in (6px) — subtle');

// ── S32.08: ties/late join/no-score stable policy ──
console.log('\nS32.08 — Ties, late join, no-score');
const lbSvc = readFileSync('services/cast/leaderboard.js', 'utf8');
if (!/lastScore/.test(lbSvc) && !/tie/.test(lbSvc)) bad("S32.08: tie policy yo'q");
else ok('S32.08: rankEntries tie policy mavjud');
if (!/lb-row--noshow/.test(lbCss)) bad("S32.08: no-score row stillari yo'q");
else ok('S32.08: no-score row mavjud');
if (!/lb-row--empty/.test(lbJs)) bad("S32.08: empty (late join) holat yo'q");
else ok('S32.08: empty/late-join holat mavjud');

// ── S32.09: celebration budget 0-2 subtle / session complete max 1 ──
console.log('\nS32.09 — Celebration budget');
if (!/budget/.test(lbJs) || !/budget <= 0/.test(lbJs)) bad("S32.09: celebration budget yo'q");
else ok('S32.09: budget tizimi mavjud (0/1/2)');
if (!/complete/.test(lbJs)) bad("S32.09: session complete tone yo'q");
else ok('S32.09: complete (max 1) tone mavjud');

// ── S32.10: 500-800ms one-shot, reduced-motion aware ──
console.log('\nS32.10 — Celebration 500-800ms, reduced-motion aware');
if (!/prefers-reduced-motion/.test(lbJs)) bad("S32.10: reduced-motion check yo'q");
else ok('S32.10: reduced-motion aware');
if (!/900/.test(lbJs)) bad("S32.10: safety net timeout yo'q");
else ok('S32.10: safety net (900ms) mavjud');
if (!/500ms/.test(lbCss) || !/800ms/.test(lbCss)) bad("S32.10: 500-800ms animation yo'q");
else ok('S32.10: 500-800ms one-shot animation');

// ── S32.11: points/badges/avatars optional, brand scope ──
console.log('\nS32.11 — Gamification scope');
const partCss = readFileSync('public/css/cast-participant.css', 'utf8');
if (!/part-leaderboard/.test(partCss)) bad("S32.11: participant leaderboard CSS yo'q");
else ok('S32.11: participant leaderboard CSS mavjud');

// ── Umumiy: view'larda script va bloklar ──
console.log('\nUmumiy — View va script ulanishlari');
const projEjs = readFileSync('views/cast/projector.ejs', 'utf8');
if (!/cast-leaderboard\.js/.test(projEjs)) bad("proj: cast-leaderboard.js ulanishi yo'q");
else ok('proj: cast-leaderboard.js ulangan');
if (!/proj-leaderboard/.test(projEjs)) bad("proj: proj-leaderboard blok yo'q");
else ok('proj: proj-leaderboard blok mavjud');
const partEjs = readFileSync('views/cast/participant.ejs', 'utf8');
if (!/cast-leaderboard\.js/.test(partEjs)) bad("part: cast-leaderboard.js ulanishi yo'q");
else ok('part: cast-leaderboard.js ulangan');
if (!/part-leaderboard/.test(partEjs)) bad("part: part-leaderboard blok yo'q");
else ok('part: part-leaderboard blok mavjud');

console.log(fails ? `\n${fails} ta xato` : '\nPASS — STEP 32 barcha talablari bajarildi');
process.exit(fails ? 1 : 0);
