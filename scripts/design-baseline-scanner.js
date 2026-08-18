#!/usr/bin/env node
/**
 * Deborah — Design Audit: Baseline Scanner (STEP 01 / S01.05)
 * -----------------------------------------------------------
 * UI fayllar bo'ylab antikvarlik belgilarini skanerlaydi:
 *   - raw hex / rgb / rgba ranglar (token'ga olinmagan)
 *   - transition: all (perf va prediktivlikka qarshi)
 *   - infinite animatsiyalar
 *   - tiny font (10px dan kichik / .6rem)
 *   - fixed-height text containerlar
 *
 * Chiqish: design-audit/baseline-scan.json + design-audit/baseline-scan.md
 * Ishga tushirish: node scripts/design-baseline-scanner.js
 */
import { readdirSync, readFileSync, statSync, writeFileSync, mkdirSync } from 'fs';
import { join, relative } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

const SCOPES = ['views', 'public/css', 'public/js'];
const EXCLUDE = /node_modules|\.git/;

function collectFiles(dir, acc = []) {
  let entries;
  try { entries = readdirSync(dir); } catch { return acc; }
  for (const e of entries) {
    const full = join(dir, e);
    let st;
    try { st = statSync(full); } catch { continue; }
    if (st.isDirectory()) {
      if (EXCLUDE.test(full)) continue;
      collectFiles(full, acc);
    } else if (e.endsWith('.ejs') || e.endsWith('.css')) {
      acc.push(full);
    }
  }
  return acc;
}

const files = collectFiles(ROOT).filter((f) => SCOPES.some((s) => f.includes(s)));
const report = { rawColors: [], transitionAll: [], infiniteAnim: [], tinyFont: [], fixedHeight: [] };

const HEX_RE = /#[0-9a-fA-F]{3,8}\b/g;
const RGB_RE = /rgba?\([0-9.,%\s]+\)/g;
const TRANSITION_ALL_RE = /transition:\s*all|transition-property:\s*all/g;
const INFINITE_RE = /animation:[^;]+infinite|animation-iteration-count:\s*infinite/gi;
// Tiny font: <= .7rem (~11.2px) yoki <= 10px — A11y riski.
// .8rem/.9rem (13-14px) kichik lekin "tiny" emas — false positive bo'lmasligi
// uchun chegarani aniq qo'ydik (WCAG 4.5:1 contrast bilan kichik matn riski).
const TINY_RE = /font-size:\s*(?:\.(?:[0-6]\d?|7)rem|(?:0?\.[0-9]|10)px)/gi;
const FIXED_HEIGHT_RE = /(^|\s)(height|max-height):\s*\d{1,2}px[^;]*;[\s\S]{0,80}(overflow|white-space|text-overflow)/gi;

function unique(values) {
  return [...new Set(values)];
}

for (const f of files) {
  const rel = relative(ROOT, f);
  const text = readFileSync(f, 'utf-8');

  const hex = text.match(HEX_RE) || [];
  const rgb = text.match(RGB_RE) || [];
  const colors = unique([...hex, ...rgb].filter((c) => !/^#(f+)?$/i.test(c)));
  if (colors.length) report.rawColors.push({ file: rel, colors: colors.slice(0, 40), count: colors.length });

  const ta = text.match(TRANSITION_ALL_RE);
  if (ta) report.transitionAll.push({ file: rel, count: ta.length });

  const inf = text.match(INFINITE_RE);
  if (inf) report.infiniteAnim.push({ file: rel, count: inf.length });

  const tiny = text.match(TINY_RE);
  if (tiny) report.tinyFont.push({ file: rel, count: tiny.length, examples: unique(tiny).slice(0, 6) });

  const fh = text.match(FIXED_HEIGHT_RE);
  if (fh) report.fixedHeight.push({ file: rel, count: fh.length });
}

const summary = {
  scannedFiles: files.length,
  filesWithRawColors: report.rawColors.length,
  filesWithTransitionAll: report.transitionAll.length,
  filesWithInfiniteAnim: report.infiniteAnim.length,
  filesWithTinyFont: report.tinyFont.length,
  filesWithFixedHeight: report.fixedHeight.length,
};

mkdirSync(join(ROOT, 'design-audit'), { recursive: true });
writeFileSync(join(ROOT, 'design-audit/baseline-scan.json'), JSON.stringify(report, null, 2) + '\n');

// ── MD ──
const md = [];
md.push('# Baseline Scanner (STEP 01 / S01.05)\n');
md.push(`| Ko'rsatkich | Fayllar soni |`);
md.push('|---|---|');
md.push(`| Raw hex/rgb ranglar | ${summary.filesWithRawColors} |`);
md.push(`| transition: all | ${summary.filesWithTransitionAll} |`);
md.push(`| infinite animatsiya | ${summary.filesWithInfiniteAnim} |`);
md.push(`| Tiny font (<11px / .7rem) | ${summary.filesWithTinyFont} |`);
md.push(`| Fixed-height text container | ${summary.filesWithFixedHeight} |`);
md.push('');

const sect = (title, arr, limit = 8) => {
  if (!arr.length) return;
  md.push(`### ${title}`);
  md.push('');
  const top = [...arr].sort((a, b) => b.count - a.count).slice(0, limit);
  for (const r of top) {
    md.push(`- \`${r.file}\` — ${r.count}${r.examples ? ` (e.g. ${r.examples.join(', ')})` : ''}`);
  }
  md.push('');
};
sect('Raw ranglar (token emas)', report.rawColors);
sect('transition: all', report.transitionAll);
sect('Infinite animatsiya', report.infiniteAnim);
sect('Tiny font', report.tinyFont);
sect('Fixed-height text container', report.fixedHeight);

writeFileSync(join(ROOT, 'design-audit/baseline-scan.md'), md.join('\n') + '\n');
console.log(JSON.stringify(summary, null, 2));
