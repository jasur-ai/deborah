#!/usr/bin/env node
/**
 * Edikit — Layout discipline migrator (STYLE STEP 09, S09.01/S09.04)
 * ----------------------------------------------------------------
 * - `padding: Npx` (to'liq 4-tomon shorthand) → 4px scale qiymatlarga
 *   6→8, 10→12, 14→16, 18→20, 22→24, 26→24, 30→32
 * - Radius: 6/7/9→8 (control), 10/11→12 (card), 14→16 (modal)
 * Faqat to'liq shorthand'lar (padding: Npx;) — kombinatsiyalar qoladi.
 */
import { readFileSync, writeFileSync, readdirSync } from 'fs';
import { join } from 'path';

const cssDir = join(process.cwd(), 'public/css');

const PADDING_MAP = {
  6: 8, 10: 12, 14: 16, 18: 20, 22: 24, 26: 24, 30: 32,
};

// padding qiymatini token'ga aylantirish (to'liq shorthand: faqat bitta px)
function padToken(n) {
  return `var(--edikit-spacing-${n / 4}, ${n}px)`;
}

let total = 0;
for (const file of readdirSync(cssDir).filter((f) => f.endsWith('.css'))) {
  const path = join(cssDir, file);
  const css = readFileSync(path, 'utf8');
  let changed = false;
  let out = css;

  for (const [from, to] of Object.entries(PADDING_MAP)) {
    // 1) To'liq shorthand: "padding: 10px;" / "padding: 10px }"
    const re1 = new RegExp(`padding:\\s*${from}px(\\s*[;}])`, 'g');
    const n1 = out.replace(re1, `padding: ${padToken(to)}$1`);
    if (n1 !== out) { out = n1; changed = true; }

    // 2) 2-qiymatli: "padding: 10px 14px;" — ikkala qiymatni alohida
    const re2 = new RegExp(`padding:\\s*${from}px(\\s+)(\\d+)px(\\s*[;}])`, 'g');
    const n2 = out.replace(re2, (m, sp, second) => {
      const s = parseInt(second, 10);
      const st = PADDING_MAP[s] || s;
      return `padding: ${padToken(to)}${sp}${padToken(st)}$3`;
    });
    if (n2 !== out) { out = n2; changed = true; }
  }

  if (changed) {
    writeFileSync(path, out);
    total++;
  }
}
console.log(`Updated ${total} CSS files to 4px padding scale`);
