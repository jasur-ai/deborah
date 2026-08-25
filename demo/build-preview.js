/**
 * Deborah — demo preview generator
 * ---------------------------------
 * EJS view'larni real server'da qanday bo'lsa, o'shanda render qilib,
 * preview/ papkasiga mustaqil HTML chiqaradi. Preview'da logo + shrift
 * base64 data-URI sifatida ichiga joylanadi — viewer'da to'liq ko'rinadi.
 *
 * Run:  node build-preview.js
 * Keyin:  preview/index.html  va  preview/cast.html  ni oching.
 */
import ejs from 'ejs';
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const viewsDir = path.join(__dirname, 'views');
const outDir = path.join(__dirname, 'preview');

// ── Assets → data URI ──
const logoData = readFileSync(path.join(__dirname, 'public', 'logo.png')).toString('base64');
const fontData = readFileSync(path.join(__dirname, 'public', 'fonts', 'cinzel-latin-400.woff2')).toString('base64');
const cormorantData = readFileSync(path.join(__dirname, 'public', 'fonts', 'cormorant-latin-400.woff2')).toString('base64');
const cormorantIData = readFileSync(path.join(__dirname, 'public', 'fonts', 'cormorant-latin-400i.woff2')).toString('base64');
const marcellusData = readFileSync(path.join(__dirname, 'public', 'fonts', 'marcellus-latin-400.woff2')).toString('base64');
const manropeData = readFileSync(path.join(__dirname, 'public', 'fonts', 'manrope-latin.woff2')).toString('base64');
const spaceData = readFileSync(path.join(__dirname, 'public', 'fonts', 'spacegrotesk-latin.woff2')).toString('base64');
const monoData = readFileSync(path.join(__dirname, 'public', 'fonts', 'jetbrains-latin.woff2')).toString('base64');

function inlineAssets(html) {
  // Viewer'da ishlashi uchun: logo + shriftlar ichiga, havolalar preview fayllar orasiga.
  let out = html
    .replace(/src="\/logo\.png"/g, `src="data:image/png;base64,${logoData}"`)
    .replace(/url\('\/fonts\/cinzel-latin-400\.woff2'\)/g, `url('data:font/woff2;base64,${fontData}')`)
    .replace(/url\("\/fonts\/cinzel-latin-400\.woff2"\)/g, `url("data:font/woff2;base64,${fontData}")`)
    .replace(/url\('\/fonts\/cormorant-latin-400\.woff2'\)/g, `url('data:font/woff2;base64,${cormorantData}')`)
    .replace(/url\("\/fonts\/cormorant-latin-400\.woff2"\)/g, `url("data:font/woff2;base64,${cormorantData}")`)
    .replace(/url\('\/fonts\/cormorant-latin-400i\.woff2'\)/g, `url('data:font/woff2;base64,${cormorantIData}')`)
    .replace(/url\("\/fonts\/cormorant-latin-400i\.woff2"\)/g, `url("data:font/woff2;base64,${cormorantIData}")`)
    .replace(/url\('\/fonts\/marcellus-latin-400\.woff2'\)/g, `url('data:font/woff2;base64,${marcellusData}')`)
    .replace(/url\("\/fonts\/marcellus-latin-400\.woff2"\)/g, `url("data:font/woff2;base64,${marcellusData}")`)
    .replace(/url\('\/fonts\/manrope-latin\.woff2'\)/g, `url('data:font/woff2;base64,${manropeData}')`)
    .replace(/url\("\/fonts\/manrope-latin\.woff2"\)/g, `url("data:font/woff2;base64,${manropeData}")`)
    .replace(/url\('\/fonts\/spacegrotesk-latin\.woff2'\)/g, `url('data:font/woff2;base64,${spaceData}')`)
    .replace(/url\("\/fonts\/spacegrotesk-latin\.woff2"\)/g, `url("data:font/woff2;base64,${spaceData}")`)
    .replace(/url\('\/fonts\/jetbrains-latin\.woff2'\)/g, `url('data:font/woff2;base64,${monoData}')`)
    .replace(/url\("\/fonts\/jetbrains-latin\.woff2"\)/g, `url("data:font/woff2;base64,${monoData}")`);
  // Preview'da bo'lmagan manzillar — qo'shni preview fayllarga (buzilmasligi uchun)
  out = out
    .replace(/href="\/dashboard/g, 'href="dashboard.html')
    .replace(/href="\/cast/g, 'href="cast.html')
    .replace(/href="\/user\/logout"/g, 'href="index.html"')
    .replace(/href="\/"/g, 'href="index.html"');
  return out;
}

const pages = [
  { file: 'index.ejs', out: 'index.html', locals: { title: 'Deborah — o\'qituvchilar uchun AI yordamchi', lang: 'uz', theme: 'dark' } },
  { file: 'cast.ejs', out: 'cast.html', locals: { title: 'Deborah — savolni sinf ekraniga uzatish', lang: 'uz', theme: 'dark' } },
  { file: 'dashboard.ejs', out: 'dashboard.html', locals: {
      title: 'Deborah — Kabinet', lang: 'uz', theme: 'dark',
      user: { name: 'User1', email: 'user1@gmail.com', role: 'student', group: 'KIB-22-1', university: 'Toshkent Axborot Texnologiyalari Universiteti' },
      curtain: '0',
  } },
  { file: 'tests.ejs', out: 'tests.html', locals: {
      title: 'Deborah — Testlar', lang: 'uz', theme: 'dark',
      user: { name: 'User1', email: 'user1@gmail.com', role: 'student', group: 'KIB-22-1', university: 'Toshkent Axborot Texnologiyalari Universiteti' },
      curtain: '0',
  } },
  { file: 'results.ejs', out: 'results.html', locals: {
      title: 'Deborah — Natijalar', lang: 'uz', theme: 'dark',
      user: { name: 'User1', email: 'user1@gmail.com', role: 'student', group: 'KIB-22-1', university: 'Toshkent Axborot Texnologiyalari Universiteti' },
      curtain: '0',
  } },
  { file: 'profile.ejs', out: 'profile.html', locals: {
      title: 'Deborah — Profil', lang: 'uz', theme: 'dark',
      user: { name: 'User1', email: 'user1@gmail.com', role: 'student', group: 'KIB-22-1', university: 'Toshkent Axborot Texnologiyalari Universiteti' },
      curtain: '0',
  } },
];

mkdirSync(outDir, { recursive: true });

for (const p of pages) {
  const src = readFileSync(path.join(viewsDir, p.file), 'utf-8');
  // filename — EJS include'lar (partials/) resolve bo'lishi uchun shart
  const html = ejs.render(src, p.locals, { filename: path.join(viewsDir, p.file) });
  writeFileSync(path.join(outDir, p.out), inlineAssets(html), 'utf-8');
  console.log(`✓ preview/${p.out}`);
}
