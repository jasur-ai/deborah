/**
 * STEP 08 — Font downloader (S08.01)
 * ----------------------------------
 * Google Fonts CSS2 API'dan woff2 subset'larni curl orqali yuklab oladi
 * (Node fetch proxy'da ETIMEDOUT beradi — curl ishlaydi).
 * public/fonts/{family}-{subset}-{weight}.woff2
 *
 * Kerakli subsetlar: latin, latin-ext, cyrillic, cyrillic-ext
 * (greek/vietnamese skip — Edikit uchun kerak emas).
 */
import { execFileSync } from 'child_process';
import { writeFileSync, mkdirSync } from 'fs';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';

const families = [
  ['source-sans-3', 'Source+Sans+3:wght@200..900'],
  ['manrope', 'Manrope:wght@200..800'],
  ['ibm-plex-mono', 'IBM+Plex+Mono:wght@400;500;600;700'],
];

const KEEP = new Set(['latin', 'latin-ext', 'cyrillic', 'cyrillic-ext']);

function curl(url) {
  return execFileSync('curl', ['-s', '--max-time', '40', '-A', UA, url], { encoding: 'utf8' });
}

mkdirSync('public/fonts', { recursive: true });

for (const [name, spec] of families) {
  const css = curl(`https://fonts.googleapis.com/css2?family=${spec}&display=swap`);
  // /* subset */ @font-face { ... }
  const re = /\/\* ([a-z-]+) \*\/\s*@font-face\s*\{([^}]*)\}/g;
  let m;
  let count = 0;
  while ((m = re.exec(css))) {
    const subset = m[1].replace(/-/g, '');
    if (!KEEP.has(m[1])) continue;
    const body = m[2];
    const url = (body.match(/src:\s*url\(([^)]+\.woff2)\)/) || [])[1];
    const w = (body.match(/font-weight:\s*([\d ]+)/) || [])[1] || '400';
    const weight = w.trim().split(' ')[0]; // variable range → birinchi qiymat
    if (!url) continue;
    const bytes = execFileSync('curl', ['-s', '--max-time', '60', '-A', UA, url]);
    const fname = `${name}-${subset}-${weight}.woff2`;
    writeFileSync(`public/fonts/${fname}`, bytes);
    count++;
    console.log(`OK ${fname} (${(bytes.length / 1024).toFixed(0)}KB)`);
  }
  console.log(`--- ${name}: ${count} files`);
}
console.log('ALL DONE');
