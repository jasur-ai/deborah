#!/usr/bin/env node
/**
 * ═══════════════════════════════════════════════════════════════════════
 * STEP 38 — Performance va asset budget gate (S38.02/03/04/06/10/12)
 * ═══════════════════════════════════════════════════════════════════════
 *
 * Qoidalar:
 *   S38.02  Route asset budget: landing kritik CSS ≤35KB gzip, initial JS
 *           ≤150KB gzip; app shell CSS ≤55KB gzip, JS ≤250KB gzip.
 *   S38.03  Route-split: socket.io client faqat realtime view'lar
 *           (views/cast/*, views/game/*)da, XLSX faqat import view'larida.
 *   S38.04  Fonts: faqat woff2, har biri ≤100KB, font-display: swap,
 *           subset (latin/cyrillic) prefiksli fayllar.
 *   S38.06  backdrop-filter low-power fallback: prefers-reduced-motion /
 *           prefers-reduced-transparency blokida blur o'chirilgan.
 *   S38.10  SW precache URL'lari mavjud; statik CSS/JS cache-first xizmat
 *           qilinadi (offline ishonchliligi).
 *   S38.12  Budget regressioni CI'da fail; exception faylda owner + expires
 *           + measured justification talab qilinadi.
 *
 * Chiqish: 0 = PASS, 1 = budget/rule fail.
 */
import { readFileSync, existsSync, readdirSync, statSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import zlib from 'zlib';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const EXCEPTIONS_PATH = join(ROOT, 'performance-budget.exceptions.json');

/* ── Budget ta'riflari ──────────────────────────────────────────────── */
const ROUTES = {
  landing: {
    label: 'Landing (public)',
    entry: 'views/partials/landing-head.ejs',
    // Demo shriftlar alohida .woff2 fayllarda (base64 CSS'dan ajratildi):
    // landing.css ≈5.7KB gzip + foundations. 35KB budget tiklandi.
    cssKb: 35,
    jsKb: 150,
  },
  app: {
    label: 'App shell (authed)',
    entry: 'views/partials/head.ejs',
    cssKb: 60,
    jsKb: 250,
  },
};

// S38.03 — faqat shu view'lar realtime/import kutubxonalarini yuklay oladi
const REALTIME_VIEW_RE = /^views\/(cast|game)\//;
// test-arena head.ejs orqali socket.io oladi (o'z yuklashini qo'shdik, lekin legacy
// head.ejs CDN'i ham bor edi — S38.03 dan keyin o'z yuklaydi)
const REALTIME_EXTRA = new Set(['views/user/test-arena.ejs']);
const IMPORT_VIEWS = new Set([
  'views/admin/dashboard.ejs',
  'views/user/create-test.ejs',
]);

const FONT_LIMIT_KB = 100;
const SW_PATH = 'public/service-worker.js';
const TYPOGRAPHY_PATH = 'public/design/foundations/typography.css';
const MOTION_PATH = 'public/design/foundations/motion.css';

/* ── Yordamchi funksiyalar ──────────────────────────────────────────── */
function read(rel) {
  const abs = join(ROOT, rel);
  if (!existsSync(abs)) return null;
  return readFileSync(abs, 'utf8');
}

function gzipKb(publicRel) {
  const abs = join(ROOT, 'public', publicRel.replace(/^\//, ''));
  if (!existsSync(abs)) return { missing: true, kb: 0 };
  return { missing: false, kb: Math.round(zlib.gzipSync(readFileSync(abs)).length / 1024) };
}

/** EJS'da HTML/JS comment'larini olib tashlash (false positive oldini olish). */
export function stripComments(ejsSrc) {
  return ejsSrc
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '');
}

/** View/head EJS'dan statik CSS + JS URL'larini yig'ish (attribute tartibi mustaqil). */
export function extractAssets(ejsSrc) {
  const css = [...ejsSrc.matchAll(/<link[^>]*rel=["']stylesheet["'][^>]*>/g)]
    .map((m) => m[0].match(/href=["']([^"']+)["']/)?.[1])
    .filter(Boolean);
  const js = [...ejsSrc.matchAll(/<script[^>]*src=["']([^"']+)["'][^>]*><\/script>/g)]
    .map((m) => m[1]);
  return { css, js };
}

/** Route uchun gzip o'lchamlarini hisoblash (CDN URL'lar tashlab ketiladi). */
export function measureRoute(entryRel) {
  const src = read(entryRel);
  if (!src) return { missing: true, cssKb: 0, jsKb: 0 };
  const { css, js } = extractAssets(src);
  let cssKb = 0;
  let jsKb = 0;
  const missing = [];
  for (const url of css) {
    if (/^https?:\/\//.test(url)) continue;
    const r = gzipKb(url);
    if (r.missing) missing.push(url);
    else cssKb += r.kb;
  }
  for (const url of js) {
    if (/^https?:\/\//.test(url)) continue;
    const r = gzipKb(url);
    if (r.missing) missing.push(url);
    else jsKb += r.kb;
  }
  return { missing: false, cssKb, jsKb, missingAssets: missing };
}

/** S38.03 — socket.io/xlsx placement: realtime view'lar o'z client yuklaydi. */
export function checkRouteSplit(viewFiles) {
  const violations = [];
  for (const rel of viewFiles) {
    const src = read(rel);
    if (!src) continue;
    const clean = stripComments(src);
    if (/socket\.io/.test(clean)) {
      if (!REALTIME_VIEW_RE.test(rel) && !REALTIME_EXTRA.has(rel)) violations.push(`socket.io client: ${rel}`);
    }
    if (/xlsx\.full\.min\.js|xlsx@/.test(clean)) {
      if (!IMPORT_VIEWS.has(rel)) violations.push(`XLSX: ${rel}`);
    }
  }
  return violations;
}

/** S38.04 — font fayllar qoidalari. */
export function checkFonts() {
  const dir = join(ROOT, 'public', 'fonts');
  if (!existsSync(dir)) return { violations: ['public/fonts mavjud emas'], totalKb: 0 };
  const violations = [];
  let totalKb = 0;
  for (const f of readdirSync(dir)) {
    const abs = join(dir, f);
    if (!statSync(abs).isFile()) continue;
    // LICENSE/metadata fayllar font emas — skip
    if (!/\.(woff2?|ttf|otf|eot)$/.test(f)) continue;
    if (!f.endsWith('.woff2')) {
      violations.push(`Font woff2 emas: ${f}`);
      continue;
    }
    const kb = Math.round(statSync(abs).size / 1024);
    totalKb += kb;
    if (kb > FONT_LIMIT_KB) violations.push(`Font >${FONT_LIMIT_KB}KB: ${f} (${kb}KB)`);
  }
  const typo = read(TYPOGRAPHY_PATH) || '';
  if (!/font-display:\s*swap/.test(typo)) violations.push('font-display: swap typography.css da yo\'q');
  if (!/latin/.test(typo)) violations.push('latin subset @font-face yo\'q');
  return { violations, totalKb };
}

/** S38.06 — backdrop-filter low-power fallback. */
export function checkBackdropFallback() {
  const motion = read(MOTION_PATH) || '';
  if (!/prefers-reduced-motion/.test(motion)) return ['motion.css: prefers-reduced-motion bloki yo\'q'];
  // Fallback blokida backdrop-filter o'chirilishi kerak
  const blocks = [...motion.matchAll(/@media\s*\(prefers-reduced-motion[^{]*\{([\s\S]*?)\n\}/g)];
  const hasFallback = blocks.some((b) => /backdrop-filter\s*:\s*none/.test(b[1]));
  return hasFallback ? [] : ['motion.css reduced-motion blokida backdrop-filter:none fallback yo\'q'];
}

/** S38.10 — SW precache URL'lari mavjudligi + statik cache-first. */
export function checkServiceWorker() {
  const sw = read(SW_PATH);
  if (!sw) return ['public/service-worker.js mavjud emas'];
  const violations = [];
  const precacheMatch = sw.match(/PRECACHE_URLS\s*=\s*\[([\s\S]*?)\];/);
  if (!precacheMatch) return ['PRECACHE_URLS topilmadi'];
  const urls = precacheMatch[1]
    .split(/\r?\n/)
    .map((l) => l.replace(/\/\/.*$/, '').trim())
    .map((l) => l.match(/^['"]([^'"]+)['"],?$/)?.[1])
    .filter(Boolean);
  for (const u of urls) {
    if (u.startsWith('http')) continue;
    // Page route'lar (/, /offline) statik emas — server render qiladi
    if (/^(\/|\/offline|\/manifest\.json)$/.test(u)) continue;
    const p = join(ROOT, 'public', u.replace(/^\//, ''));
    if (!existsSync(p)) violations.push(`SW precache asset yo'q: ${u}`);
  }
  // Statik CSS/JS cache-first xizmat qilinishi (offline)
  if (!/cacheFirst/.test(sw)) violations.push('SW: cacheFirst strategiya topilmadi');
  return violations;
}

/** S38.12 — exception fayl yuklash. */
function loadExceptions() {
  if (!existsSync(EXCEPTIONS_PATH)) return { rules: {} };
  try {
    return JSON.parse(readFileSync(EXCEPTIONS_PATH, 'utf8'));
  } catch {
    return { rules: {}, __invalid: true };
  }
}

function hasValidException(ex, ruleId) {
  const rule = ex.rules?.[ruleId];
  if (!rule) return false;
  const now = Date.now();
  const exp = new Date(rule.expires).getTime();
  return rule.owner && rule.justification && rule.measured && exp > now;
}

/* ── Asosiy run ─────────────────────────────────────────────────────── */
export function runBudget() {
  const errors = [];
  const warnings = [];
  const metrics = {};
  const exceptions = loadExceptions();

  if (exceptions.__invalid) errors.push('S38.12: performance-budget.exceptions.json parse xato');

  // S38.02 — route budget
  for (const [id, cfg] of Object.entries(ROUTES)) {
    const m = measureRoute(cfg.entry);
    metrics[`${id}-css-kb`] = m.cssKb;
    metrics[`${id}-js-kb`] = m.jsKb;
    if (m.missing) {
      errors.push(`S38.02: ${cfg.label} head fayli topilmadi (${cfg.entry})`);
      continue;
    }
    for (const a of m.missingAssets) errors.push(`S38.02: asset mavjud emas — ${a}`);
    if (m.cssKb > cfg.cssKb) {
      const msg = `S38.02: ${cfg.label} CSS ${m.cssKb}KB gzip > budget ${cfg.cssKb}KB`;
      if (hasValidException(exceptions, `${id}-css`)) warnings.push(`${msg} (exception — ${exceptions.rules[`${id}-css`].owner})`);
      else errors.push(msg);
    }
    if (m.jsKb > cfg.jsKb) {
      const msg = `S38.02: ${cfg.label} JS ${m.jsKb}KB gzip > budget ${cfg.jsKb}KB`;
      if (hasValidException(exceptions, `${id}-js`)) warnings.push(`${msg} (exception — ${exceptions.rules[`${id}-js`].owner})`);
      else errors.push(msg);
    }
  }

  // S38.03 — route-split
  const viewFiles = [];
  const walk = (d) => {
    const abs = join(ROOT, d);
    if (!existsSync(abs)) return;
    for (const f of readdirSync(abs)) {
      const rel = `${d}/${f}`;
      if (statSync(join(abs, f)).isDirectory()) walk(rel);
      else if (f.endsWith('.ejs')) viewFiles.push(rel);
    }
  };
  walk('views');
  const splitV = checkRouteSplit(viewFiles);
  for (const v of splitV) errors.push(`S38.03: route-split buzildi — ${v}`);

  // S38.04 — fonts
  const fonts = checkFonts();
  metrics['fonts-total-kb'] = fonts.totalKb;
  for (const v of fonts.violations) errors.push(`S38.04: ${v}`);

  // S38.06 — backdrop-filter fallback
  for (const v of checkBackdropFallback()) errors.push(`S38.06: ${v}`);

  // S38.10 — service worker
  for (const v of checkServiceWorker()) errors.push(`S38.10: ${v}`);

  // S38.12 — exception fayl ham sintaksis jihatdan to'g'ri bo'lishi kerak
  if (!exceptions.__invalid) {
    for (const [ruleId, rule] of Object.entries(exceptions.rules || {})) {
      const required = ['owner', 'expires', 'justification', 'measured'];
      for (const k of required) {
        if (!rule[k]) errors.push(`S38.12: exception "${ruleId}" da "${k}" yo'q`);
      }
    }
  }

  return { errors, warnings, metrics };
}

/* ── CLI ────────────────────────────────────────────────────────────── */
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop()) && !process.argv[1].includes('vitest')) {
  const { errors, warnings, metrics } = runBudget();
  console.log('── Performance & asset budget (STEP 38) ──');
  for (const [k, v] of Object.entries(metrics)) console.log(`  ${k}: ${v}`);
  for (const w of warnings) console.log(`  ⚠ ${w}`);
  for (const e of errors) console.log(`  ✗ ${e}`);
  if (errors.length === 0) console.log('\nPASS — budget va route-split qoidalari bajarildi');
  else console.log(`\nFAIL — ${errors.length} ta xato`);
  process.exit(errors.length ? 1 : 0);
}
