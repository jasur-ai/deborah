#!/usr/bin/env node
/**
 * STEP 21–23 validator — Landing IA, official content, product proof, motion/SEO/perf
 * CLI: node scripts/check-landing.js   → PASS/FAIL chiqaradi.
 */
import { readFileSync, existsSync } from 'fs';
import { LANDING_LANGS, LANDING_COPY } from '../data/landing.js';

let fails = 0;
const ok = (msg) => console.log(`  ✓ ${msg}`);
const bad = (msg) => { console.log(`  ✗ ${msg}`); fails += 1; };
const read = (p) => existsSync(p) ? readFileSync(p, 'utf8') : '';

console.log('STEP 21 — Landing IA va official content validator\n');

// ── S21.01/02/07: fake claims yo'q ──
console.log('S21.01/02/07 — fake claims');
const banned = ['24/7', 'Official platform', 'Rasmiy platforma', 'Официальная платформа', 'Расмий платформа', '10,000+', '10 000+', '100,000+', '100 000+'];
for (const lang of LANDING_LANGS) {
  const raw = JSON.stringify(LANDING_COPY[lang]);
  const hits = banned.filter((b) => raw.includes(b));
  if (hits.length) bad(`${lang}: ${hits.join(', ')} topildi`);
}
if (!LANDING_LANGS.some((l) => LANDING_COPY[l].hero.proofLine === undefined)) bad('hero.proofLine olib tashlanmagan');
ok('copy da fake claim yo\'q');

// ── S21.02/03/04: hero ──
console.log('S21.02/03/04 — hero copy');
const heroIndex = read('views/index.ejs');
// S21.11 — bitta H1: faqat hero partial da, boshqa landing partial larda yo'q
const landingPartials = ['landing-hero', 'landing-demo', 'landing-how', 'landing-roles', 'landing-features', 'landing-trust', 'landing-cta'];
const h1Count = landingPartials.reduce((n, p) => n + (read(`views/partials/${p}.ejs`).match(/<h1[\s>]/g) || []).length, 0);
if (h1Count !== 1) bad(`bitta H1 bo'lishi shart (topildi: ${h1Count})`);
else ok('bitta H1 (faqat hero)');
const heroPartial = read('views/partials/landing-hero.ejs');
if (!heroPartial.includes('participantCta')) bad('hero partial da participantCta yo\'q');
if (!heroPartial.includes('/play')) bad('hero participant /play link yo\'q');
if (heroPartial.includes('proofLine')) bad('hero partial da proofLine qolgan');
ok('hero partial: participant shortcut, proof yo\'q');

// ── S21.05: IA order ──
console.log('S21.05 — IA order');
const order = ['landing-hero', 'landing-demo', 'landing-how', 'landing-roles', 'landing-features', 'landing-trust', 'landing-cta'];
let idx = -1; let orderOk = true;
for (const p of order) {
  const i = heroIndex.indexOf(`include('partials/${p}')`);
  if (i === -1) { orderOk = false; bad(`index.ejs da ${p} yo'q`); }
  else if (i < idx) { orderOk = false; bad(`${p} tartibi noto'g'ri`); }
  else idx = i;
}
if (orderOk) ok('IA: Promise→Proof→Ask/See/Adapt→Views→Features→Trust→CTA');

// ── S21.06: admin footer ──
console.log('S21.06 — admin utility');
const footerPartial = read('views/partials/landing-footer.ejs');
if (!footerPartial.includes('/admin/login')) bad('footer da /admin/login yo\'q');
else ok('admin link footer utility\'da');

// ── S21.08/09: trust + footer + doc routes ──
console.log('S21.08/09 — trust slot va doc routes');
if (!existsSync('views/partials/landing-trust.ejs')) bad('landing-trust.ejs yo\'q');
else ok('landing-trust.ejs mavjud');
const routeSrc = read('routes/index.js');
for (const p of ['/shartlar', '/privacy', '/security', '/accessibility']) {
  if (!routeSrc.includes(`'${p}'`)) bad(`routes/index.js da ${p} yo'q`);
}
if (!existsSync('views/info.ejs')) bad('views/info.ejs yo\'q');
ok('doc sahifalar: 4 route + info.ejs');

// ── S21.11: semantics ──
console.log('S21.11 — semantic headings/landmarks');
if (!heroIndex.includes('id="ld-main"')) bad('main landmark yo\'q');
if (!heroIndex.includes('ld-skip-link')) bad('skip link yo\'q');
if (!read('views/partials/landing-how.ejs').includes('aria-labelledby="how-tab-teacher"')) bad('how tab aria-labelledby fix yo\'q');
ok('main landmark, skip link, tab aria');

// ── CSS ──
console.log('S21.12 — landing.css');
const css = read('public/css/landing.css');
if (css.includes('.ld-stats')) bad('landing.css da .ld-stats qoldiq');
if (!css.includes('.ld-trust-grid')) bad('landing.css da .ld-trust-grid yo\'q');
if (!css.includes('.ld-footer-grid')) bad('landing.css da .ld-footer-grid yo\'q');
if (!css.includes('.ld-hero-participant')) bad('landing.css da .ld-hero-participant yo\'q');
ok('css: trust/footer/hero participant');

// ── STEP 22 — product proof va visual composition ──
console.log('STEP 22 — S22.01/02/03 product stage');
const heroHtml = read('views/partials/landing-hero.ejs');
const cssJs = css + read('public/js/landing.js') + read('public/js/landing-demo.js');
if (/particle|orbit|star-field|confetti/i.test(cssJs)) bad('S22.01: particles/orbit/confetti topildi');
else ok('S22.01: particles/orbit yo\'q');
if (!heroHtml.includes('ld-hero-split')) bad('S22.02: ld-hero-split yo\'q');
else ok('S22.02: hero 5+7 split');
for (const f of ['ld-frame--director', 'ld-frame--projector', 'ld-frame--phone']) {
  if (!heroHtml.includes(f)) bad(`S22.03: ${f} yo'q`);
}
if (!heroHtml.includes('ld-mosaic')) bad('S22.04: response mosaic yo\'q');
if (!heroHtml.includes('ld-rail')) bad('S22.04: signal rail yo\'q');
ok('S22.03/04: three-view + mosaic + rail');

console.log('STEP 22 — S22.05/06 demo label va teacher action');
if (!heroHtml.includes('participants')) bad('S22.05: demo participants label yo\'q');
if (!read('views/partials/landing-demo.ejs').includes('ld-demo-stage')) bad('S22.05: demo stage label yo\'q');
if (!heroHtml.includes('ld-discuss-chip')) bad('S22.06: Muhokama tavsiya yo\'q');
ok('S22.05/06: demo label + teacher action');

console.log('STEP 22 — S22.07/09 poster va LCP');
if (!existsSync('public/images/product/poster.svg')) {
  bad('S22.07: poster.svg manba yo\'q');
} else {
  if (!existsSync('public/images/product/poster.webp') || !existsSync('public/images/product/poster.avif')) {
    console.log('  ⚠ poster.webp/avif yo\'q — ishlatish: node scripts/build-product-poster.js');
  } else {
    ok('S22.07: poster.webp + poster.avif');
  }
}
if (!existsSync('public/js/landing-demo.js')) bad('S22.07: landing-demo.js yo\'q');
if (heroHtml.includes('loading="lazy"')) bad('S22.09: hero LCP lazy — mumkin emas');
else ok('S22.09: hero LCP lazy emas');

console.log('STEP 22 — S22.10/11 layout archetypes');
if (!read('views/partials/landing-how.ejs').includes('ld-how-split')) bad('S22.10: how split editorial yo\'q');
if (!read('views/partials/landing-demo.ejs').includes('ld-demo-stage')) bad('S22.10: demo full stage yo\'q');
if (!read('views/partials/landing-features.ejs').includes('ld-crop')) bad('S22.11: features product crop yo\'q');
ok('S22.10/11: split + full stage + bento crops');

console.log('STEP 22 — S22.12 brand assets');
if (!existsSync('public/images/logo-icon.svg') || !existsSync('public/images/logo-text.svg')) bad('S22.12: logo asset lar yo\'q');
else ok('S22.12: logo-icon.svg + logo-text.svg mavjud');

// ═══════════════════════ STEP 23 — motion, trust, SEO va performance ═══════════════════════
console.log('\nSTEP 23 — S23.01 enter motion (bir marta, infinite yo\'q)');
const cssKeyframes = read('public/css/landing.css');
if (!cssKeyframes.includes('@keyframes ld-enter')) bad('S23.01: ld-enter keyframes yo\'q');
else {
  if (/animation:\s*ld-enter[^;]*infinite/.test(cssKeyframes)) bad('S23.01: ld-enter infinite — mumkin emas');
  else ok('S23.01: ld-enter keyframes, infinite yo\'q');
}
if (!/\.ld-hero-copy\s*{[^}]*animation:\s*ld-enter\s+0\.22s/.test(cssKeyframes)) bad('S23.01: copy 220ms emas');
if (!/\.ld-stage\s*{[^}]*animation:\s*ld-enter\s+0\.28s/.test(cssKeyframes)) bad('S23.01: frame 280ms emas');
ok('S23.01: copy 220ms + frame 280ms');

console.log('STEP 23 — S23.03 scroll reveal: default visible, progressive');
if (!cssKeyframes.includes('@media (prefers-reduced-motion: no-preference)')) bad('S23.03: no-preference gate yo\'q');
else ok('S23.03: reveal no-preference ichida');

console.log('STEP 23 — S23.04 lean landing head (socket.io/XLSX yo\'q)');
const lhead = read('views/partials/landing-head.ejs');
if (!lhead) bad('S23.04: landing-head.ejs yo\'q');
else {
  const badScripts = ['socket.io/socket.io.js', '/xlsx', 'js/main.js'].filter((s) => lhead.includes(s));
  if (badScripts.length) bad(`S23.04: landing head da global ${badScripts.join(', ')} topildi`);
  else ok('S23.04: landing head minimal (socket.io/main.js/xlsx yo\'q)');
}
if (!heroIndex.includes('landing-head')) bad('S23.04: index.ejs landing-head ishlatmayapti');
if (heroIndex.includes('socket.io/socket.io.js')) bad('S23.04: index.ejs da socket.io script qolgan');

console.log('STEP 23 — S23.05 self-hosted fonts + preload');
if (!lhead.includes('rel="preload" href="/fonts/')) bad('S23.05: font preload yo\'q');
else ok('S23.05: critical font preload');
if (!lhead.includes('/fonts/source-sans-3')) bad('S23.05: self-hosted font link yo\'q');

console.log('STEP 23 — S23.06 SEO: canonical/OG/twitter/JSON-LD');
for (const token of ['rel="canonical"', 'property="og:image"', 'name="twitter:card"', 'application/ld+json']) {
  if (!lhead.includes(token)) bad(`S23.06: ${token} yo'q`);
}
if (!/og:image[^>]+poster\.webp/.test(lhead)) bad('S23.06: og:image poster.webp emas');
else ok('S23.06: canonical + OG + twitter + JSON-LD (poster)');

console.log('STEP 23 — S23.08 service worker version');
const sw = read('public/service-worker.js');
const vMatch = sw.match(/CACHE_VERSION\s*=\s*'([^']+)'/);
if (!vMatch) bad('S23.08: CACHE_VERSION yo\'q');
else {
  const major = parseInt(vMatch[1].replace('v', ''), 10) || 0;
  const minor = parseInt((vMatch[1].match(/\.(\d+)$/) || [])[1] || '0', 10);
  if (vMatch[1] !== 'v2.1.0' && major < 2) bad(`S23.08: SW eski (${vMatch[1]})`);
  else ok(`S23.08: SW ${vMatch[1]} — yangilangan`);
}

console.log('STEP 23 — S23.09 performance gate script');
if (!existsSync('scripts/audit-performance.js')) bad('S23.09: audit-performance.js yo\'q');
else ok('S23.09: audit-performance.js mavjud (Lighthouse proxy)');

console.log('STEP 23 — S23.10 light theme + no-JS fallback');
if (!cssKeyframes.includes("[data-theme='light']")) bad('S23.10: landing.css da light theme selector yo\'q');
if (!cssKeyframes.includes("[data-theme='light'] .ld-hero")) bad('S23.10: light theme blok yo\'q');
else ok('S23.10: light theme tokenlari mavjud');
if (!heroPartial.includes('ld-stage')) bad('S23.10: no-JS static stage yo\'q');
else ok('S23.10: no-JS statik fallback (DOM stage)');

console.log('STEP 23 — S23.11 first-click analytics (privacy-safe)');
const ljs = read('public/js/landing.js');
if (!ljs.includes('data-analytics') || !ljs.includes('firstClick')) bad('S23.11: first-click analytics yo\'q');
else {
  if (/localStorage[^;]*(email|phone|name|password)/i.test(ljs)) bad('S23.11: PII saqlanmoqda');
  else ok('S23.11: first-click analytics, PII yo\'q');
}

console.log(fails ? `\n${fails} ta xato` : '\nPASS — STEP 21/22/23 barcha talablari bajarildi');
process.exit(fails ? 1 : 0);
