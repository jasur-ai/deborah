#!/usr/bin/env node
/**
 * Deborah — Motion discipline for EJS views (STYLE STEP 10, S10.03)
 * ---------------------------------------------------------------
 * `transition:all .2s` → `transition:color .2s,background-color .2s,
 * border-color .2s,box-shadow .2s,transform .2s,opacity .2s`
 * Layout props chiqariladi (S10.08).
 */
import { readFileSync, writeFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

const PROPS = 'color,background-color,border-color,box-shadow,transform,opacity';
const viewsDir = join(process.cwd(), 'views');

function walk(dir) {
  const out = [];
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (f.endsWith('.ejs')) out.push(p);
  }
  return out;
}

let total = 0;
for (const file of walk(viewsDir)) {
  const src = readFileSync(file, 'utf8');
  if (!/transition:\s*all\b/.test(src)) continue;
  const out = src.replace(
    /transition:\s*all\s+([^;,}\s]+(?:\s[^;,}\s]+)*)/g,
    (m, timing) => {
      const t = timing.trim();
      return `transition:${PROPS.split(',').map((p) => `${p} ${t}`).join(',')}`;
    }
  );
  if (out !== src) {
    writeFileSync(file, out);
    total++;
  }
}
console.log(`Updated ${total} EJS views: transition:all → property-specific`);
