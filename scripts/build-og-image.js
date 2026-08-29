#!/usr/bin/env node
/**
 * Build OG Image — Converts og-image.svg → og-image.png
 * Uses sharp for SVG rasterization
 * 
 * Font note: sharp uses librsvg which doesn't load Google Fonts.
 * The PNG text will render in system sans-serif. For production
 * with perfect font rendering, use puppeteer instead.
 * 
 * Usage:  npm run build:og
 * Output: public/images/og-image.png (1200×630)
 */

import { readFile, writeFile } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import sharp from 'sharp';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

const SVG_PATH = join(ROOT, 'public', 'images', 'og-image.svg');
const PNG_PATH = join(ROOT, 'public', 'images', 'og-image.png');

async function build() {
  console.log('🔨 Building OG Image...\n');

  // Read SVG source
  const svgBuffer = await readFile(SVG_PATH);
  const svgStr = svgBuffer.toString('utf-8');
  console.log(`  📄 Source:   og-image.svg (${(svgBuffer.length / 1024).toFixed(1)} KB)`);

  // Add fallback font-family so librsvg picks a reasonable font
  const safeSvg = svgStr.replace(
    /font-family=\"[^\"]*?\"/g,
    'font-family="system-ui, sans-serif"'
  );

  // Convert to PNG via sharp/librsvg
  const pngBuffer = await sharp(Buffer.from(safeSvg))
    .resize(1200, 630, {
      fit: 'fill',
      kernel: 'lanczos3',
      withoutEnlargement: false,
    })
    .png({ compressionLevel: 9 })
    .toBuffer();

  // Write output
  await writeFile(PNG_PATH, pngBuffer);

  const fSize = (pngBuffer.length / 1024).toFixed(1);
  console.log(`  🖼️  Output:  og-image.png (${fSize} KB)`);
  console.log(`  📐  Size:    1200×630 px, 8-bit RGBA`);
  console.log(`\n  ✅ Done!`);
  console.log(`  📍 ${PNG_PATH}`);
  console.log(`\n  ⚠️  Note: PNG uses system fonts (not Righteous/Nunito).`);
  console.log(`  💡 For perfect font rendering, use puppeteer or convert text to paths.`);
}

build().catch(err => {
  console.error('\n❌ Build failed:', err.message);
  process.exit(1);
});
