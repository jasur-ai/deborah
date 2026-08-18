#!/usr/bin/env node
/**
 * STYLE STEP 35 — Content system, localization va RTL readiness validator.
 *
 * S35.03  Term registry mavjud (data/term-registry.js + client term-utils.js)
 * S35.04  Jargon approved label'lar bilan almashtirilgan (Mock/PRE/Characters/Realtime)
 * S35.05  Apostrophe normalizatsiya qidiruv/input'da (routes/user.js + panel.ejs)
 * S35.06  Intl formatter'lar (public/js/i18n-formatters.js) head'da yuklanadi
 * S35.07  lang + dir barcha view'larda; user text uchun dir="auto" yordamchisi
 * S35.08  Pseudo-locale helper mavjud (services/i18n/catalog.js)
 * S35.10  Missing key fallback: raw internal token user'ga chiqmaydi (lookupKey + telemetry)
 */
import { readFileSync, existsSync, readdirSync } from 'fs';
import { TERMS, JARGON, termLabel, approveJargon } from '../data/term-registry.js';

let fails = 0;
const bad = (m) => { fails++; console.log('  ✗ ' + m); };
const ok = (m) => console.log('  ✓ ' + m);

console.log('STEP 35 — S35.03 Term registry');
if (TERMS.teacher && TERMS.student && TERMS.test && TERMS.session && TERMS.result) ok('S35.03: core termlar (teacher/student/test/session/result) mavjud');
else bad('S35.03: TERMS registry to\'liq emas');
if (termLabel('test') === 'Test' && termLabel('result') === 'Natija') ok('S35.03: termLabel() ishlaydi');
else bad('S35.03: termLabel() noto\'g\'ri');

console.log('STEP 35 — S35.04 Jargon approval');
for (const key of ['mock', 'pre', 'characters', 'realtime']) {
  if (JARGON[key] && JARGON[key].label && JARGON[key].jargon.length) ok(`S35.04: ${key} -> ${JARGON[key].label}`);
  else bad(`S35.04: ${key} jargon approved emas`);
}
if (approveJargon('Mock Fanlar va PRE Testlar') === 'Namuna fanlar va Tayyor testlar') ok('S35.04: approveJargon() almashtiradi');
else bad('S35.04: approveJargon() noto\'g\'ri');

console.log('STEP 35 — UI jargon cleanup');
const dash = readFileSync('views/admin/dashboard.ejs', 'utf8');
if (!/Mock Fanlar|PRE Testlar|>Mock</.test(dash)) ok('S35.04: dashboard.ejs\'da jargon yo\'q');
else bad('S35.04: dashboard.ejs\'da hali jargon bor');

console.log('STEP 35 — S35.05 Apostrophe normalization');
if (existsSync('routes/user.js')) {
  const u = readFileSync('routes/user.js', 'utf8');
  if (/u02BB/.test(u) && u.includes('canon(req.query.q)')) ok('S35.05: server search canonical apostrophe');
  else bad('S35.05: routes/user.js normalizatsiyasi yo\'q');
}
if (existsSync('views/user/panel.ejs')) {
  const p = readFileSync('views/user/panel.ejs', 'utf8');
  if (p.includes('DeborahTerms') && p.includes('searchNormalize')) ok('S35.05: panel client searchNormalize');
  else bad('S35.05: panel.ejs client normalizatsiya yo\'q');
}
if (existsSync('public/js/term-utils.js')) {
  const t = readFileSync('public/js/term-utils.js', 'utf8');
  if (t.includes('normalizeApostrophes') && t.includes('searchNormalize')) ok('S35.05: term-utils.js apostrophe + search');
  else bad('S35.05: term-utils.js to\'liq emas');
}

console.log('STEP 35 — S35.06 Intl formatters');
if (existsSync('public/js/i18n-formatters.js')) {
  const f = readFileSync('public/js/i18n-formatters.js', 'utf8');
  for (const fn of ['formatNumber', 'formatPercent', 'formatDate', 'formatDuration', 'formatList']) {
    if (f.includes(fn)) ok(`S35.06: ${fn} mavjud`);
    else bad(`S35.06: ${fn} yo\'q`);
  }
}
if (existsSync('views/partials/head.ejs')) {
  const h = readFileSync('views/partials/head.ejs', 'utf8');
  if (h.includes('i18n-formatters.js') && h.includes('term-utils.js')) ok('S35.06: head.ejs\'da scriptlar yuklanadi');
  else bad('S35.06: head.ejs script importlari yo\'q');
}

console.log('STEP 35 — S35.07 lang/dir');
const viewDirs = ['views', 'views/admin', 'views/user', 'views/role', 'views/cast', 'views/game', 'views/dev'];
let totalViews = 0;
let dirViews = 0;
for (const d of viewDirs) {
  if (!existsSync(d)) continue;
  for (const f of readdirSafe(d)) {
    if (!f.endsWith('.ejs')) continue;
    const src = readFileSync(`${d}/${f}`, 'utf8');
    if (!/<html/i.test(src)) continue; // partials hisoblanmaydi
    totalViews++;
    // `<html` dan keyin, tag ichida (tashqi `>` gacha) `dir=` bormi.
    // EJS interpolyatsiyasi (lang="<%= ... %>") ochilish tag'i ichida bo'lishi mumkin.
    const htmlIdx = src.indexOf('<html');
    let chunk = src.slice(htmlIdx + 5);
    // `%>` larni "egasiz" qilib, tashqi `>`'ni noto'g'ri topishga yo'l qo'ymaymiz:
    // interpolyatsiya ichidagi `>`'lar `<%` dan `%>` gacha blokda — ularni maskalaymiz.
    chunk = chunk.replace(/<%[\s\S]*?%>/g, '');
    const tagEnd = chunk.indexOf('>');
    const openTag = chunk.slice(0, tagEnd === -1 ? chunk.length : tagEnd + 1);
    if (/dir=/.test(openTag)) dirViews++;
  }
}
if (totalViews > 0 && dirViews === totalViews) ok(`S35.07: dir barcha ${totalViews} view'da`);
else bad(`S35.07: dir ${dirViews}/${totalViews}`);

console.log('STEP 35 — S35.08 Pseudo-locale');
if (existsSync('services/i18n/catalog.js')) {
  const c = readFileSync('services/i18n/catalog.js', 'utf8');
  if (c.includes('pseudoLocalize')) ok('S35.08: pseudoLocalize mavjud');
  else bad('S35.08: pseudoLocalize yo\'q');
}

console.log('STEP 35 — S35.10 Missing-key fallback');
if (existsSync('services/i18n/catalog.js')) {
  const c = readFileSync('services/i18n/catalog.js', 'utf8');
  if (c.includes('missing.set(key') && c.includes('takeMissingKeyStats')) ok('S35.10: missing-key telemetry mavjud (raw token emas)');
  else bad('S35.10: missing-key telemetry yo\'q');
}

console.log(fails ? `\n${fails} ta xato` : '\nPASS — STEP 35 barcha talablari bajarildi');
process.exit(fails ? 1 : 0);

function readdirSafe(dir) {
  try {
    return readdirSync(dir);
  } catch (_) {
    return [];
  }
}
