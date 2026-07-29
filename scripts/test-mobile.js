/**
 * Edikit — Mobile Optimization Test Suite
 * Automated testing: meta tags, manifest, service worker, responsive checks
 * 
 * Usage: node scripts/test-mobile.js
 */

import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const BASE = process.env.TEST_URL || 'http://localhost:3000';

let passed = 0;
let failed = 0;
let skipped = 0;

function check(name, condition, detail = '') {
  if (condition) {
    passed++;
    console.log(`  ✅ ${name}`);
  } else {
    failed++;
    console.log(`  ❌ ${name}${detail ? ' — ' + detail : ''}`);
  }
}

function section(title) {
  console.log(`\n╔══════════════════════════════════════════╗`);
  console.log(`║  ${title.padEnd(38)}`);
  console.log(`╚══════════════════════════════════════════╝`);
}

// ═══════════════════════════════════════════════════════════════
// 1. META TAGS — via HTTP
// ═══════════════════════════════════════════════════════════════

async function testMetaTags() {
  section('META TAGS');

  const res = await fetch(BASE);
  const html = await res.text();

  check('viewport-fit=cover', /viewport-fit=cover/.test(html));
  check('theme-color meta tag', /theme-color/.test(html) && /id="meta-theme-color"/.test(html));
  check('apple-mobile-web-app-capable', /apple-mobile-web-app-capable/.test(html));
  check('apple-mobile-web-app-status-bar-style', /black-translucent/.test(html));
  check('mobile-web-app-capable', /mobile-web-app-capable/.test(html));
  check('format-detection=telephone=no', /format-detection[^>]*telephone=no/.test(html));
  check('handheldfriendly', /handheldfriendly/.test(html));
  check('OG image absolute URL', /og:image[^>]*http:\/\/localhost:3000/.test(html));
  check('OG url absolute', /og:url[^>]*http:\/\/localhost:3000\//.test(html));
  check('Twitter card', /twitter:card/.test(html));

  // Link tags
  check('Manifest link', /rel="manifest"/.test(html));
  check('Favicon link', /rel="icon"/.test(html));
  check('Apple touch icon 180x180', /apple-touch-icon[^>]*180x180/.test(html));
  check('Apple touch icon 192x192', /apple-touch-icon[^>]*192x192/.test(html));
}

// ═══════════════════════════════════════════════════════════════
// 2. THEME-JS — Dynamic theme-color update
// ═══════════════════════════════════════════════════════════════

async function testThemeJS() {
  section('THEME.JS — Dynamic Theme-Color Update');

  const themeJSPath = join(ROOT, 'public/js/theme.js');
  const content = readFileSync(themeJSPath, 'utf-8');

  check('meta-theme-color update exists', /meta-theme-color/.test(content));
  check('Dark color #0A0F1F set', /#0A0F1F/.test(content));
  check('Light color #F4F6FB set', /#F4F6FB/.test(content));
  check('setAttribute used for update', /setAttribute/.test(content));
}

// ═══════════════════════════════════════════════════════════════
// 3. INLINE THEME INIT
// ═══════════════════════════════════════════════════════════════

async function testInlineThemeInit() {
  section('INLINE THEME INIT (head.ejs + layouts)');

  const res = await fetch(BASE);
  const html = await res.text();

  // Check inline init sets both data-theme AND theme-color
  check('data-theme set in inline init', /setAttribute\('data-theme'/.test(html));
  check('theme-color set in inline init', /document\.getElementById\('meta-theme-color'\)/.test(html));
  check('Light/dark switch in init: #F4F6FB for light, #0A0F1F for dark', /F4F6FB.*0A0F1F/.test(html));
}

// ═══════════════════════════════════════════════════════════════
// 4. MANIFEST.JSON
// ═══════════════════════════════════════════════════════════════

async function testManifest() {
  section('MANIFEST.JSON (PWA)');

  const res = await fetch(`${BASE}/manifest.json`);
  const manifest = await res.json();

  check('Valid JSON manifest', !!manifest);
  check('name: "Edikit"', manifest.name === 'Edikit');
  check('short_name present', !!manifest.short_name);
  check('start_url: "/"', manifest.start_url === '/');
  check('scope: "/"', manifest.scope === '/');
  check('id field present', /\/\?source=pwa/.test(manifest.id));
  check('display: standalone', manifest.display === 'standalone');
  check('display_override present', Array.isArray(manifest.display_override));
  check('background_color set', !!manifest.background_color);
  check('theme_color set', !!manifest.theme_color);
  check('categories present', Array.isArray(manifest.categories));
  check('Icons array exists', Array.isArray(manifest.icons));
  check('Icon 192x192 exists', manifest.icons.some(i => i.sizes === '192x192'));
  check('Icon 512x512 exists', manifest.icons.some(i => i.sizes === '512x512'));
  check('Icon 180x180 exists', manifest.icons.some(i => i.sizes === '180x180'));
  check('Shortcuts present', Array.isArray(manifest.shortcuts) && manifest.shortcuts.length > 0);
}

// ═══════════════════════════════════════════════════════════════
// 5. SERVICE WORKER
// ═══════════════════════════════════════════════════════════════

async function testServiceWorker() {
  section('SERVICE WORKER');

  const swPath = join(ROOT, 'public/service-worker.js');
  const sw = readFileSync(swPath, 'utf-8');

  check('SW file exists', existsSync(swPath));
  check('Precache list defined', /PRECACHE_URLS/.test(sw));
  check('CURRENT_CACHES sentinel', /CURRENT_CACHES/.test(sw));
  check('Cache versioning', /CACHE_VERSION/.test(sw));
  check('Install event handler', /addEventListener\('install'/.test(sw));
  check('Activate event handler', /addEventListener\('activate'/.test(sw));
  check('Fetch event handler', /addEventListener\('fetch'/.test(sw));
  check('skipWaiting() call', /skipWaiting/.test(sw));
  check('clients.claim() call', /clients\.claim/.test(sw));
  check('Old cache cleanup', /CURRENT_CACHES\.indexOf/.test(sw));
  check('Cache-first for CSS/JS/Images', /cacheFirst\(request\)/.test(sw));
  check('Network-first for pages', /networkFirst/.test(sw));
  check('Google Fonts caching', /fontCacheFirst/.test(sw));
  check('Offline fallback HTML', /OFFLINE_HTML/.test(sw));
  check('Offline image fallback SVG', /image\/svg\+xml/.test(sw));
  check('Socket.io skip', /socket\.io/.test(sw));

  // Check SW is accessible via HTTP
  const swRes = await fetch(`${BASE}/service-worker.js`);
  check('SW served via HTTP (200)', swRes.status === 200);
  const swContentType = swRes.headers.get('content-type') || '';
  check('SW correct MIME type', swContentType.includes('javascript'));
}

// ═══════════════════════════════════════════════════════════════
// 6. PWA ICONS & OG IMAGE
// ═══════════════════════════════════════════════════════════════

async function testAssets() {
  section('PWA ICONS & ASSETS');

  const assets = [
    ['PWA 192x192 icon', '/images/pwa-icon-192.png', 'image/png'],
    ['PWA 512x512 icon', '/images/pwa-icon-512.png', 'image/png'],
    ['PWA 180x180 icon', '/images/pwa-icon-180.png', 'image/png'],
    ['OG Image SVG', '/images/og-image.svg', 'image/svg+xml'],
    ['Logo icon SVG', '/images/logo-icon.svg', 'image/svg+xml'],
    ['Logo text SVG', '/images/logo-text.svg', 'image/svg+xml'],
    ['OG Image PNG', '/images/og-image.png', 'image/png'],
  ];

  for (const [name, path, expectedType] of assets) {
    try {
      const res = await fetch(`${BASE}${path}`);
      check(`${name} (${res.status})`, res.status === 200);
      if (res.status === 200) {
        const ct = res.headers.get('content-type') || '';
        check(`  └─ MIME: ${ct.split(';')[0]}`, ct.includes(expectedType));
      }
    } catch (e) {
      check(`${name}`, false, `Fetch failed: ${e.message}`);
    }
  }
}

// ═══════════════════════════════════════════════════════════════
// 7. CSS DESIGN TOKENS
// ═══════════════════════════════════════════════════════════════

async function testCSS() {
  section('CSS — DESIGN TOKENS & RESPONSIVE');

  const cssPath = join(ROOT, 'public/css/style.css');
  const css = readFileSync(cssPath, 'utf-8');

  check('CSS file exists and non-empty', css.length > 10000);
  check(':root custom properties', /:root\s*\{[^}]*--/.test(css));
  check('--bg-primary defined', /--bg-primary/.test(css));
  check('--accent defined', /--accent/.test(css));
  check('--text-primary defined', /--text-primary/.test(css));
  check('--font-display defined', /--font-display/.test(css));
  check('Light theme overrides', /\[data-theme="light"\]/.test(css));
  check('Reduced motion query', /prefers-reduced-motion/.test(css));
  check('Clamp font sizes (responsive)', /clamp\(/.test(css));
  check('Animations library present', /@keyframes/.test(css));
  check('Card system defined', /\.card\s*\{/.test(css));
  check('Button system defined', /\.btn\s*\{/.test(css));
  check('Modal system defined', /\.modal/.test(css));
  check('Toast component defined', /\.toast/.test(css));
  check('Skeleton loading defined', /\.skeleton/.test(css));
}

// ═══════════════════════════════════════════════════════════════
// 8. SW REGISTRATION IN VIEWS
// ═══════════════════════════════════════════════════════════════

async function testSWRegistration() {
  section('SW REGISTRATION SCRIPTS');

  const views = [
    ['Landing page (layout)', '/'],
    ['Admin login', '/admin/login'],
    ['Game page', '/play'],
    ['404 page', '/nonexistent'],
  ];

  for (const [name, url] of views) {
    try {
      const res = await fetch(`${BASE}${url}`);
      const html = await res.text();
    const hasSW = /serviceWorker/.test(html) || /service-worker\.js/.test(html);
    check(`${name} — SW registration script present`, hasSW);
    } catch (e) {
      check(`${name}`, false, `Fetch failed: ${e.message}`);
    }
  }
}

// ═══════════════════════════════════════════════════════════════
// TEST RUNNER
// ═══════════════════════════════════════════════════════════════

async function main() {
  console.log(`
╔═══════════════════════════════════════════╗
║   Edikit — Mobile Optimization Test Suite ║
║   ${new Date().toISOString()}       ║
╚═══════════════════════════════════════════╝
  `);

  const start = Date.now();

  try {
    await testMetaTags();
    await testThemeJS();
    await testInlineThemeInit();
    await testManifest();
    await testServiceWorker();
    await testAssets();
    await testCSS();
    await testSWRegistration();
  } catch (err) {
    console.error('\n🔥 Fatal error:', err.message);
    failed++;
  }

  // Summary
  const total = passed + failed;
  const duration = ((Date.now() - start) / 1000).toFixed(1);

  console.log(`\n${'═'.repeat(46)}`);
  console.log(`  📊 RESULTS:  ${passed} passed  |  ${failed} failed  |  ${total} total`);
  console.log(`  ⏱  Duration: ${duration}s`);
  console.log(`${'═'.repeat(46)}`);

  console.log(`\n${failed === 0 ? '✅ ALL TESTS PASSED!' : `❌ ${failed} test(s) failed!`}\n`);

  process.exit(failed > 0 ? 1 : 0);
}

main();
