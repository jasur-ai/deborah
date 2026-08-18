#!/usr/bin/env node
/**
 * ═══════════════════════════════════════════════════════════════════════
 * STEP 40 — Legacy usage inventory (S40.03)
 * ═══════════════════════════════════════════════════════════════════════
 *
 * Legacy variable aliases (--accent, --bg, --text, --card, --surf, --muted,
 * --border, --gold, --green, --success, --danger va h.k.) ishlatilishini
 * hisoblaydi va trend'ni `design-audit/legacy-usage.json` da saqlaydi.
 *
 * Har release'da bu raqam KAMAYISHI kerak — final major cleanup'da legacy
 * aliases olib tashlanadi.
 *
 * Run:
 *   node scripts/legacy-usage.js            # hisob + trend + PASS/FAIL
 *   node scripts/legacy-usage.js --json     # faqat JSON
 */
import { readFileSync, readdirSync, existsSync, statSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const TREND_FILE = join(ROOT, 'design-audit/legacy-usage.json');

// Legacy alias'lar — semantic token'larga ko'chiriladiganlar (S40.03)
export const LEGACY_ALIASES = [
  '--accent', '--accent-dark', '--accent-deep', '--accent-glow', '--accent-bright', '--accent-purple', '--accent-amber',
  '--bg', '--bg-primary', '--bg-surface', '--bg-card', '--surf', '--card',
  '--text', '--text-primary', '--text-secondary', '--text-muted', '--text-disabled',
  '--muted', '--border', '--border-light', '--border-medium', '--border-strong',
  '--success', '--danger', '--warning', '--info', '--green', '--gold',
];

/** CSS fayllarini yig'ish (public/css + public/design). */
function cssFiles() {
  const out = [];
  for (const d of ['public/css', 'public/design', 'public/design/components', 'public/design/contexts', 'public/design/foundations', 'public/design/generated']) {
    if (!existsSync(join(ROOT, d))) continue;
    for (const f of readdirSync(join(ROOT, d))) {
      if (f.endsWith('.css')) out.push(`${d}/${f}`);
    }
  }
  return out;
}

/** EJS view'lardagi inline legacy var() ishlatilishi. */
function viewInlineUsage() {
  let count = 0;
  const perFile = {};
  const walk = (d) => {
    const abs = join(ROOT, d);
    if (!existsSync(abs)) return;
    for (const f of readdirSync(abs)) {
      const rel = `${d}/${f}`;
      if (statSync(join(abs, f)).isDirectory()) walk(rel);
      else if (f.endsWith('.ejs')) {
        const src = readFileSync(join(abs, f), 'utf8');
        const n = (src.match(/var\(--(accent|bg|surf|card|text|muted|border|gold|green|success|danger|warning|info)[ ,)]/g) || []).length;
        if (n > 0) { perFile[rel] = n; count += n; }
      }
    }
  };
  walk('views');
  return { count, perFile };
}

/** Umumiy legacy alias ishlatilishini hisoblash (CSS + views). */
export function countLegacyUsage() {
  const cssTotal = {};
  let cssSum = 0;
  for (const f of cssFiles()) {
    const src = readFileSync(join(ROOT, f), 'utf8');
    let fileSum = 0;
    for (const alias of LEGACY_ALIASES) {
      // var(--alias) ishlatilishi + :root override ta'rifi alohida hisoblanadi
      const esc = alias.replace(/-/g, '\\-');
      const uses = (src.match(new RegExp(`var\\(${esc}[ ,)]`, 'g')) || []).length;
      const defs = (src.match(new RegExp(`${esc}\\s*:`)) || []).length;
      const n = uses + defs;
      if (n > 0) {
        cssTotal[alias] = (cssTotal[alias] || 0) + n;
        fileSum += n;
      }
    }
    cssSum += fileSum;
  }
  const views = viewInlineUsage();
  return {
    cssSum,
    viewInline: views.count,
    viewPerFile: views.perFile,
    perAlias: cssTotal,
    total: cssSum + views.count,
  };
}

/** Trend'ni saqlash va regressionni aniqlash. */
export function recordTrend(usage, trendFile = TREND_FILE) {
  const prev = existsSync(trendFile) ? JSON.parse(readFileSync(trendFile, 'utf8')) : null;
  const entry = {
    date: new Date().toISOString().slice(0, 10),
    total: usage.total,
    cssSum: usage.cssSum,
    viewInline: usage.viewInline,
  };
  const history = prev?.history || [];
  history.push(entry);
  // Oxirgi 10 ta yozuvni saqlash
  const trimmed = history.slice(-10);
  writeFileSync(trendFile, JSON.stringify({ current: entry, history: trimmed }, null, 2));

  // Regression tekshiruv: oldingi yozuvdan ko'paygan bo'lsa — warning
  const last = prev?.current;
  const regression = last ? usage.total - last.total : 0;
  return { entry, regression, prevTotal: last?.total ?? null };
}

/* ── CLI ────────────────────────────────────────────────────────────── */
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop()) && !process.argv[1].includes('vitest')) {
  const usage = countLegacyUsage();
  if (process.argv.includes('--json')) {
    // --json: faqat hisob — trend fayl O'ZGARTIRILMAYDI (side effect yo'q)
    console.log(JSON.stringify({ usage }, null, 2));
    process.exit(0);
  }
  if (process.argv.includes('--check')) {
    // --check: trend faylga YOZMAYDI, faqat regression tekshiradi (CI gate uchun)
    const prev = existsSync(TREND_FILE) ? JSON.parse(readFileSync(TREND_FILE, 'utf8')).current : null;
    const regression = prev ? usage.total - prev.total : 0;
    console.log(`── Legacy usage check (STEP 40 / S40.03) ──`);
    console.log(`  TOTAL: ${usage.total}${prev ? ` (oldingi ${prev.total})` : ' (baseline yoq)'}`);
    const pass = regression <= 0;
    if (regression > 0) console.log(`  ⚠ REGRESSION +${regression} — yangi legacy qo'shilmadi`);
    console.log(pass ? '\nPASS — legacy usage regression yo\'q' : '\nFAIL — legacy usage oshdi');
    process.exit(pass ? 0 : 1);
  }
  const trend = recordTrend(usage);
  console.log('── Legacy usage inventory (STEP 40 / S40.03) ──');
  console.log(`  Legacy aliases (CSS): ${usage.cssSum}`);
  console.log(`  Inline legacy var (views): ${usage.viewInline}`);
  console.log(`  TOTAL: ${usage.total}`);
  const topAliases = Object.entries(usage.perAlias).sort((a, b) => b[1] - a[1]).slice(0, 8);
  for (const [alias, n] of topAliases) console.log(`    ${alias}: ${n}`);
  if (trend.prevTotal != null) {
    const dir = trend.regression > 0 ? `↑ +${trend.regression}` : trend.regression < 0 ? `↓ ${trend.regression}` : '→ 0';
    console.log(`  Trend: ${dir} (oldingi ${trend.prevTotal} → joriy ${usage.total})`);
    if (trend.regression > 0) console.log('  ⚠ REGRESSION — legacy usage ortib ketdi (yangi legacy qo\'shilmasin)');
  }
  const pass = trend.regression <= 0;
  console.log(pass ? '\nPASS — legacy usage regression yo\'q' : '\nFAIL — legacy usage oshdi');
  process.exit(pass ? 0 : 1);
}
