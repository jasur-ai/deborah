/**
 * STEP 08 — Typography/font validator (S08.01-12 tekshiruvlari)
 * -------------------------------------------------------------
 * 1. Self-hosted woff2 fayllar mavjud + hajmi minimal (S08.01)
 * 2. Google Fonts CDN hech qaysi view'da emas (S08.01)
 * 3. Nunito / Righteous operational CSS/views'da yo'q (S08.12)
 *    (exceptions: docs/, public/images/brand/*.svg wordmark artwork)
 * 4. Weight disiplina: operational CSS/views'da 800/900 yo'q (S08.08)
 * 5. typography.css @font-face font-display: swap bor (S08.03)
 * 6. Metadata min 14px (0.875rem) — body 16px/1.55+ (S08.07)
 * Exit: 0 = pass.
 */
import { readFileSync, readdirSync, existsSync } from 'fs';
import { join } from 'path';

const ROOT = process.cwd();
let fails = 0;
const fail = (msg) => { fails++; console.log(`❌ ${msg}`); };
const pass = (msg) => console.log(`✅ ${msg}`);

// 1) Font fayllar
const FONTS_DIR = join(ROOT, 'public/fonts');
const REQUIRED = [
  'source-sans-3-latin-200.woff2',
  'source-sans-3-latinext-200.woff2',
  'source-sans-3-cyrillic-200.woff2',
  'source-sans-3-cyrillicext-200.woff2',
  'manrope-latin-200.woff2',
  'manrope-latinext-200.woff2',
  'manrope-cyrillic-200.woff2',
  'manrope-cyrillicext-200.woff2',
  'ibm-plex-mono-latin-400.woff2',
  'ibm-plex-mono-latin-700.woff2',
];
let missing = 0;
for (const f of REQUIRED) {
  const p = join(FONTS_DIR, f);
  if (!existsSync(p) || readFileSync(p).length < 2048) {
    missing++; fail(`Font yetishmayapti yoki kichik: ${f}`);
  }
}
if (!missing) pass(`Font fayllar mavjud (${REQUIRED.length} required)`);

// 2) Google CDN ban
import { execSync } from 'child_process';
let cdnOut = '';
try {
  cdnOut = execSync(`grep -rlE 'fonts\\.google(apis|static)' views/ 2>/dev/null || true`, { encoding: 'utf8' });
} catch (e) { /* grep exit 1 = topilmadi */ }
if (cdnOut.trim()) fail(`Google Fonts CDN hali ishlatilmoqda: ${cdnOut.trim()}`);
else pass('Google Fonts CDN views\'da yo\'q');

// 3) Nunito/Righteous operational ban
let legacy = '';
try {
  legacy = execSync(
    `grep -rlE "'Nunito'|'Righteous'|Nunito|Righteous" views/ public/css/ public/design/foundations/ public/design/brand.css 2>/dev/null || true`,
    { encoding: 'utf8' }
  );
} catch (e) {}
if (legacy.trim()) fail(`Eski fontlar (Nunito/Righteous) hali bor: ${legacy.trim().split('\n').slice(0, 4).join(', ')}`);
else pass('Nunito/Righteous operational UI\'da yo\'q (S08.12)');

// 4) Weight disiplina
let w800 = '';
try {
  w800 = execSync(
    `grep -rnE 'font-weight:\\s*?(800|900)' views/ public/css/ public/design/foundations/ public/design/brand.css 2>/dev/null | grep -v generated || true`,
    { encoding: 'utf8' }
  );
} catch (e) {}
if (w800.trim()) fail(`Weight 800/900 hali ishlatilmoqda: ${w800.trim().split('\n').slice(0, 3).join(' | ')}`);
else pass('Weight disiplina 400-700 (S08.08)');

// 5) font-display: swap
const typeCss = readFileSync(join(ROOT, 'public/design/foundations/typography.css'), 'utf8');
const faceCount = (typeCss.match(/@font-face\s*\{/g) || []).length;
const swapCount = (typeCss.match(/@font-face[^{]*\{[^}]*?font-display:\s*swap/g) || []).length;
if (faceCount === 0 || swapCount !== faceCount) fail(`@font-face swap: ${swapCount}/${faceCount}`);
else pass(`font-display: swap barcha @font-face'da (${faceCount})`);

// 6) Body 16px / metadata 14px+ (token tekshiruvi)
const typo = JSON.parse(readFileSync(join(ROOT, 'public/design/tokens/typography.json'), 'utf8'));
const fs = typo.edikit.typography['font-size'];
if (fs.base.$value !== '1rem') fail('Body base 1rem emas');
else pass('Body base 16px (1rem)');
if (fs.sm.$value !== '0.875rem') fail('Metadata sm 0.875rem emas');
else pass('Metadata 14px+ (0.875rem)');
if (typo.edikit.typography['line-height'].normal.$value < 1.55) fail('Body line-height < 1.55');
else pass('Body line-height 1.55+');

console.log(fails === 0 ? `\n✅ Font/typography validator: PASS` : `\n❌ Font/typography validator: ${fails} xato`);
process.exit(fails === 0 ? 0 : 1);
