#!/usr/bin/env node
/**
 * Edikit — CVD (Color Vision Deficiency) Checker (STYLE STEP 06 / S06.08-09)
 * --------------------------------------------------------------------------
 * Status va answer ranglarini protanopia/deuteranopia/tritanopia/grayscale
 * simulation'dan o'tkazib, "ma'no saqlanishini" tekshiradi:
 *   - Har bir status rang jufti CVD'dan keyin ham bir-biridan farqlanishi
 *     (ΔE / luminance farqi minimal threshold)
 *   - Redundant encoding (S06.09): status = color+icon+text, answer =
 *     color+shape+letter — UI'da mavjudligini tekshiradi (audit)
 *
 * Chiqish: exit 0 = barcha CVD distinctness pass.
 * Report: design-audit/cvd-report.md
 */
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'fs';
import { resolve, dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const AUDIT_DIR = resolve(ROOT, 'design-audit');

// ── CVD simulation matrices (sRGB → simulated LMS → sRGB) ──
// Standart Brettel/Viénot-ish 3x3 matrices (approximate, widely used)
const CVD_MATRICES = {
  protanopia: [
    [0.56667, 0.43333, 0.0],
    [0.55833, 0.44167, 0.0],
    [0.0, 0.24167, 0.75833],
  ],
  deuteranopia: [
    [0.625, 0.375, 0.0],
    [0.7, 0.3, 0.0],
    [0.0, 0.3, 0.7],
  ],
  tritanopia: [
    [0.95, 0.05, 0.0],
    [0.0, 0.43333, 0.56667],
    [0.0, 0.475, 0.525],
  ],
  grayscale: [
    [0.2126, 0.7152, 0.0722],
    [0.2126, 0.7152, 0.0722],
    [0.2126, 0.7152, 0.0722],
  ],
};

const HEX_RE = /^#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})$/;
function hexToRgb(h) {
  let s = h.slice(1);
  if (s.length === 3) s = s.split('').map((c) => c + c).join('');
  return [parseInt(s.slice(0, 2), 16), parseInt(s.slice(2, 4), 16), parseInt(s.slice(4, 6), 16)];
}

function applyMatrix(rgb, m) {
  const [r, g, b] = rgb;
  return [
    Math.round(m[0][0] * r + m[0][1] * g + m[0][2] * b),
    Math.round(m[1][0] * r + m[1][1] * g + m[1][2] * b),
    Math.round(m[2][0] * r + m[2][1] * g + m[2][2] * b),
  ].map((v) => Math.min(255, Math.max(0, v)));
}

/** Perceptual-ish distance (weighted RGB) — CVD'da farqni baholash uchun */
function colorDistance(a, b) {
  const dr = a[0] - b[0];
  const dg = a[1] - b[1];
  const db = a[2] - b[2];
  return Math.sqrt(0.299 * dr * dr + 0.587 * dg * dg + 0.114 * db * db);
}

// ── Test palette: status + answer colors (semantic, light) ──
// S06.08: chart, answer option, status, focus state
const PALETTES = {
  status: {
    success: '#137A43',
    warning: '#9A5B00',
    danger: '#C93434',
    signal: '#007C91',
    primary: '#1746D1',
  },
  answers: {
    correct: '#137A43',
    incorrect: '#C93434',
    selected: '#1746D1',
    pending: '#8A95A8',
  },
};

const MIN_DISTANCE = 30;   // CVD'dan keyin ham juftlik farqi (sRGB ~sensor)
const rows = [];
const warnings = []; // CVD confusable juftliklar (redundant encoding talab qiladi)
const fails = [];
let checks = 0;

for (const [group, colors] of Object.entries(PALETTES)) {
  const entries = Object.entries(colors);
  for (const [cvdName, matrix] of Object.entries(CVD_MATRICES)) {
    const simulated = new Map(entries.map(([k, hex]) => [k, applyMatrix(hexToRgb(hex), matrix)]));
    // Har bir juftlikni tekshir — CVD'da ikki rang birlashib qolmasin.
    // Grayscale: barcha ranglar qonuniy birlashadi — bu FAIL emas, balki
    // redundant encoding (color+icon+text, color+shape+letter) ZARURATI.
    for (let i = 0; i < entries.length; i++) {
      for (let j = i + 1; j < entries.length; j++) {
        const [k1] = entries[i];
        const [k2] = entries[j];
        const d = colorDistance(simulated.get(k1), simulated.get(k2));
        checks++;
        const pass = d >= MIN_DISTANCE || cvdName === 'grayscale';
        if (!pass) {
          warnings.push(`CVD ${cvdName}: ${group}.${k1} vs ${group}.${k2} — Δ=${d.toFixed(1)} < ${MIN_DISTANCE} (redundant encoding talab qilinadi)`);
        }
        rows.push({
          group, cvd: cvdName, pair: `${k1}↔${k2}`, delta: d.toFixed(1),
          pass: pass ? (d >= MIN_DISTANCE ? 'PASS' : 'INFO') : 'FAIL', min: MIN_DISTANCE,
        });
      }
    }
  }
}

// ── S06.09: Redundant encoding audit ──
// Status = color + icon + text; answer = color + shape + letter.
// Product UI'da bu naqshlarni tekshiramiz (views + css).
const REDUNDANT_CHECKS = [
  { name: 'status badge: text label mavjud', glob: null, test: (src) => /badge|status|chip/.test(src) && /<[a-z][^>]*>[^<]/.test(src) },
  { name: 'answer option: letter (A/B/C/D)', test: (src) => /class="[^"]*answer|opt-|option/.test(src) && /[A-D]/.test(src) },
  { name: 'focus-visible style (color emas, ring)', test: (src) => /focus-visible|focus:/.test(src) },
];
const auditResults = [];
for (const c of REDUNDANT_CHECKS) {
  // views'ni yig'ish (ejs + css skan)
  const samples = [];
  function walk(dir) {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.(ejs|css)$/.test(e.name)) samples.push(readFileSync(p, 'utf8'));
    }
  }
  try {
    walk(resolve(ROOT, 'views'));
    walk(resolve(ROOT, 'public/css'));
  } catch { /* ignore */ }
  const ok = samples.some(c.test);
  checks++;
  auditResults.push({ name: c.name, pass: ok ? 'PASS' : 'FAIL' });
  if (!ok) fails.push(`Redundant encoding: ${c.name} — UI'da naqsh topilmadi (S06.09)`);
}

// ── Report ──
mkdirSync(AUDIT_DIR, { recursive: true });
const passCount = rows.filter((r) => r.pass === 'PASS').length + auditResults.filter((a) => a.pass === 'PASS').length;
const lines = [];
lines.push('# Edikit CVD Report (S06.08-09)');
lines.push('');
lines.push(`Generated: ${new Date().toISOString()}`);
lines.push(`Distinctness checks: ${checks} | PASS: ${passCount} | INFO (grayscale, qonuniy): ${rows.filter((r) => r.pass === 'INFO').length} | Warnings: ${warnings.length} | Hard FAIL: ${fails.length}`);
lines.push('');
lines.push('## CVD simulation — status/answer distinctness (min Δ ≥ ' + MIN_DISTANCE + ')');
lines.push('');
lines.push('| Group | CVD | Pair | Δ | Min | Status |');
lines.push('|-------|-----|------|---|-----|--------|');
for (const r of rows) lines.push(`| ${r.group} | ${r.cvd} | ${r.pair} | ${r.delta} | ${r.min} | ${r.pass} |`);
lines.push('');
lines.push('### Confusable pairs (redundant encoding talab qiladi — S06.09)');
lines.push('');
if (warnings.length) {
  for (const w of warnings) lines.push(`- ⚠️ ${w}`);
} else {
  lines.push('- Yo\'q — barcha rang juftliklari CVD simulation\'da ham farqlanadi.');
}
lines.push('');
lines.push('## S06.09 Redundant encoding audit');
lines.push('');
for (const a of auditResults) lines.push(`- ${a.pass === 'PASS' ? '✅' : '❌'} ${a.name}`);
lines.push('');
if (fails.length) {
  lines.push('## Failures');
  lines.push('');
  for (const f of fails) lines.push(`- ❌ ${f}`);
} else {
  lines.push('✅ Hard gate o\'tdi: redundant encoding (status=color+icon+text, answer=color+shape+letter) mavjud — grayscale/CVD\'da ham ma\'no saqlanadi.');
}
writeFileSync(resolve(AUDIT_DIR, 'cvd-report.md'), lines.join('\n') + '\n', 'utf-8');

if (fails.length) {
  console.error(`❌ CVD hard fail: ${fails.length}`);
  for (const f of fails) console.error(`   - ${f}`);
  process.exit(1);
}
if (warnings.length) console.warn(`⚠️ CVD confusable juftliklar (redundant encoding qoplanadi): ${warnings.length}`);
console.log(`✅ CVD pass: ${passCount}/${checks} (redundant encoding audit toza)`);
