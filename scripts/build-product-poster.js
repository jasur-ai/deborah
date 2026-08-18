#!/usr/bin/env node
/**
 * Build Product Poster — STEP 22 S22.07
 * Three-view product stage static poster: SVG → WebP + AVIF (sharp).
 *
 * Usage:  node scripts/build-product-poster.js
 * Output: public/images/product/poster.webp (1200×760)
 *         public/images/product/poster.avif (1200×760)
 */
import { readFile, writeFile } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import sharp from 'sharp';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const OUT = join(ROOT, 'public', 'images', 'product');
const SVG = join(OUT, 'poster.svg');

async function build() {
  const svg = await readFile(SVG);
  const img = sharp(svg, { density: 144 }).resize(1200, 760);
  await Promise.all([
    img.clone().webp({ quality: 82 }).toFile(join(OUT, 'poster.webp')),
    img.clone().avif({ quality: 60 }).toFile(join(OUT, 'poster.avif')),
  ]);
  console.log('✅ poster.webp + poster.avif yaratildi (1200×760)');
}

build().catch((e) => {
  console.error('❌ Poster build xatosi:', e.message);
  process.exit(1);
});
