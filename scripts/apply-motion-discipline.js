#!/usr/bin/env node
/**
 * Deborah — Motion discipline migrator (STYLE STEP 10, S10.03/S10.08)
 * -----------------------------------------------------------------
 * `transition: all DUR EASE` → property-specific:
 *   color, background-color, border-color, box-shadow, transform, opacity, filter
 * Layout animatsiya (width/height/margin/top/left) chiqariladi (S10.08).
 */
import { readFileSync, writeFileSync, readdirSync } from 'fs';
import { join } from 'path';

const cssDir = join(process.cwd(), 'public/css');
const PROPS = 'color, background-color, border-color, box-shadow, transform, opacity, filter';

let total = 0;
for (const file of readdirSync(cssDir).filter((f) => f.endsWith('.css'))) {
  const path = join(cssDir, file);
  const css = readFileSync(path, 'utf8');
  if (!css.includes('transition: all')) continue;
  const out = css.replace(
    /transition:\s*all\s+([^;]+);/g,
    (m, timing) => `transition: ${PROPS} ${timing.trim()};`
  );
  if (out !== css) {
    writeFileSync(path, out);
    total++;
  }
}
console.log(`Updated ${total} CSS files: transition:all → property-specific`);
