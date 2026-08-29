#!/usr/bin/env node
/**
 * Deborah — Design Audit: UI File Inventory (STEP 01 / S01.04)
 * -----------------------------------------------------------
 * Har UI fayl uchun: line count, inline <style> bloklari, inline style=
 * atributlari, <script> bloklari va !important soni.
 *
 * Chiqish: design-audit/file-inventory.md + JSON konsolga.
 * Ishga tushirish: node scripts/design-file-inventory.js
 */
import { readdirSync, readFileSync, statSync, writeFileSync, mkdirSync } from 'fs';
import { join, relative } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

// Plan S01.04: public, views, routes va scripts — faqat shu papkalar skanerlanadi
// (substring match o'rniga prefix match — `test-views-mobile.js` kabi false
// positive'lar bo'lmaydi).
const TARGETS = ['views', 'public/css', 'public/js', 'routes', 'scripts'];
const EXCLUDE = /node_modules|\.git/;

function isTarget(rel) {
  return TARGETS.some((t) => rel === t || rel.startsWith(t + '/'));
}

function collectFiles(dir, rel, acc = []) {
  let entries;
  try { entries = readdirSync(dir); } catch { return acc; }
  for (const e of entries) {
    const full = join(dir, e);
    const relPath = rel ? `${rel}/${e}` : e;
    let st;
    try { st = statSync(full); } catch { continue; }
    if (st.isDirectory()) {
      if (EXCLUDE.test(full)) continue;
      if (!isTarget(relPath) && !TARGETS.includes(relPath)) continue; // faqat target papkalar
      collectFiles(full, relPath, acc);
    } else if ((e.endsWith('.ejs') || e.endsWith('.css') || e.endsWith('.js')) && isTarget(relPath)) {
      acc.push(full);
    }
  }
  return acc;
}

function countOccurrences(text, pattern) {
  const m = text.match(pattern);
  return m ? m.length : 0;
}

const files = collectFiles(ROOT, '');
const rows = [];

for (const f of files) {
  const text = readFileSync(f, 'utf-8');
  const lines = text.split('\n');
  const rel = relative(ROOT, f);
  rows.push({
    file: rel,
    lines: lines.length,
    inlineStyleBlocks: countOccurrences(text, /<style[\s>]/g),
    inlineStyleAttrs: countOccurrences(text, /\bstyle="/g),
    scripts: countOccurrences(text, /<script[\s>]/g),
    important: countOccurrences(text, /!important/g),
  });
}

rows.sort((a, b) => b.lines - a.lines);

// ── MD chiqish ──
const md = [];
md.push('# UI File Inventory (STEP 01 / S01.04)\n');
md.push('| # | Fayl | Qator | <style> | style= | <script> | !important |');
md.push('|---|------|------:|--------:|-------:|---------:|-----------:|');
rows.forEach((r, i) => {
  md.push(`| ${i + 1} | \`${r.file}\` | ${r.lines} | ${r.inlineStyleBlocks} | ${r.inlineStyleAttrs} | ${r.scripts} | ${r.important} |`);
});

const totalLines = rows.reduce((s, r) => s + r.lines, 0);
const totalImportant = rows.reduce((s, r) => s + r.important, 0);
md.push('');
md.push(`**Jami fayl:** ${rows.length} | **Jami qator:** ${totalLines} | **Jami !important:** ${totalImportant}`);
md.push('');

// Eng katta inline style fayllar (STEP 02 uchun ko'rsatkich)
const topInline = rows.filter((r) => r.inlineStyleBlocks > 0).sort((a, b) => b.inlineStyleBlocks - a.inlineStyleBlocks).slice(0, 12);
if (topInline.length) {
  md.push('### Eng ko\'p inline <style> bloklari (STEP 02: EJS compile gate uchun)');
  md.push('');
  topInline.forEach((r, i) => {
    md.push(`${i + 1}. \`${r.file}\` — ${r.inlineStyleBlocks} blok, ${r.lines} qator`);
  });
}

mkdirSync(join(ROOT, 'design-audit'), { recursive: true });
writeFileSync(join(ROOT, 'design-audit/file-inventory.md'), md.join('\n') + '\n');

console.log(JSON.stringify({ files: rows.length, totalLines, totalImportant, topInline: topInline.length }, null, 2));
