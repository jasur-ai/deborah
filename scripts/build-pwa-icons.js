#!/usr/bin/env node
/**
 * Build PWA Icons — Generates pwa-icon-{180,192,512}.png from logo-icon.svg
 * Uses sharp for SVG rasterization
 * 
 * Usage:  npm run build:pwa
 * Output: public/images/pwa-icon-{180,192,512}.png
 */

import { readFile, writeFile } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import sharp from 'sharp';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

const SVG_PATH = join(ROOT, 'public', 'images', 'logo-icon.svg');
const SIZES = [180, 192, 512];

async function build() {
  console.log('🔨 Building PWA Icons...\n');

  const svgBuffer = await readFile(SVG_PATH);
  console.log(`  Source:  logo-icon.svg (${(svgBuffer.length / 1024).toFixed(1)} KB)`);

  for (const size of SIZES) {
    const pngBuffer = await sharp(svgBuffer)
      .resize(size, size, {
        fit: 'contain',
        kernel: 'lanczos3',
        background: { r: 10, g: 15, b: 31, alpha: 0 },
      })
      .png({ compressionLevel: 9 })
      .toBuffer();

    const outPath = join(ROOT, 'public', 'images', `pwa-icon-${size}.png`);
    await writeFile(outPath, pngBuffer);
    console.log(`  pwa-icon-${size}.png — ${(pngBuffer.length / 1024).toFixed(1)} KB`);
  }

  console.log(`\n  ✅ PWA icons built!`);
}

build().catch(err => {
  console.error('\nBuild failed:', err.message);
  process.exit(1);
});
