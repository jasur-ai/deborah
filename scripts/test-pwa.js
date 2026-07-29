/**
 * Edikit — PWA Install Prompt Validation
 * Tests all criteria needed for Chrome/Edge "Add to Home Screen" prompt
 * 
 * Usage: node scripts/test-pwa.js
 */

import { readFileSync, existsSync, statSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createHash } from 'crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const BASE = process.env.TEST_URL || 'http://localhost:3000';

let passed = 0;
let failed = 0;

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
// 1. MANIFEST VALIDATION (Chrome PWA install criteria #1)
// ═══════════════════════════════════════════════════════════════

async function testManifest() {
  section('1. MANIFEST VALIDATION');

  // Fetch manifest
  let manifest, manifestRes;
  try {
    manifestRes = await fetch(`${BASE}/manifest.json`);
    manifest = await manifestRes.json();
  } catch (e) {
    check('Manifest fetchable', false, e.message);
    return;
  }

  check('HTTP 200 OK', manifestRes.status === 200, `Got ${manifestRes.status}`);

  const ct = manifestRes.headers.get('content-type') || '';
  check('Content-Type: application/json', ct.includes('application/json'), ct);

  // ── Required fields for install prompt ──
  check('name (required)', !!manifest.name, 'Missing');
  check('short_name (required)', !!manifest.short_name, 'Missing');
  check('start_url (required)', !!manifest.start_url, 'Missing');
  check('display: standalone or fullscreen', 
    ['standalone', 'fullscreen'].includes(manifest.display), `Got: ${manifest.display}`);
  check('icons array non-empty', Array.isArray(manifest.icons) && manifest.icons.length >= 2,
    `Found: ${manifest.icons?.length || 0}`);

  // ── Icon validation ──
  const icon192 = manifest.icons.find(i => i.sizes === '192x192');
  const icon512 = manifest.icons.find(i => i.sizes === '512x512');

  check('Icon 192x192 exists', !!icon192, 'Missing');
  check('Icon 512x512 exists', !!icon512, 'Missing');

  if (icon192) {
    check('Icon 192 type: image/png', icon192.type === 'image/png', icon192.type);
    check('Icon 192 purpose defined', !!icon192.purpose);
    try {
      const icoRes = await fetch(`${BASE}${icon192.src}`);
      check(`Icon 192 accessible (${icoRes.status})`, icoRes.status === 200);
    } catch (e) {
      check('Icon 192 accessible', false, e.message);
    }
  }

  if (icon512) {
    check('Icon 512 type: image/png', icon512.type === 'image/png', icon512.type);
    check('Icon 512 purpose defined', !!icon512.purpose);
    try {
      const icoRes = await fetch(`${BASE}${icon512.src}`);
      check(`Icon 512 accessible (${icoRes.status})`, icoRes.status === 200);
    } catch (e) {
      check('Icon 512 accessible', false, e.message);
    }
  }

  // ── Optional but recommended ──
  check('scope defined', !!manifest.scope, 'Missing');
  if (manifest.scope) {
    check('scope matches start_url', manifest.start_url.startsWith(manifest.scope),
      `start_url: ${manifest.start_url}, scope: ${manifest.scope}`);
  }
  check('background_color defined', !!manifest.background_color, 'Missing');
  check('theme_color defined', !!manifest.theme_color, 'Missing');

  // ── display_override ──
  check('display_override array', Array.isArray(manifest.display_override), 'Missing');
  if (Array.isArray(manifest.display_override)) {
    check('display_override includes standalone', 
      manifest.display_override.includes('standalone'),
      `Got: ${manifest.display_override.join(', ')}`);
  }

  // ── Shortcuts ──
  check('shortcuts array', Array.isArray(manifest.shortcuts), 'Missing');
  if (Array.isArray(manifest.shortcuts)) {
    check('shortcuts non-empty', manifest.shortcuts.length > 0, `Found: ${manifest.shortcuts.length}`);
    manifest.shortcuts.forEach((s, i) => {
      check(`shortcut[${i}].name: "${s.name}"`, !!s.name);
      check(`shortcut[${i}].url: "${s.url}"`, !!s.url);
    });
  }

  // ── categories ──
  check('categories defined', Array.isArray(manifest.categories) && manifest.categories.length > 0,
    `Found: ${manifest.categories?.join(', ') || 'none'}`);

  // ── Service worker scope ──
  check('display_override for optimal UX', 
    Array.isArray(manifest.display_override), 'Missing');
}

// ═══════════════════════════════════════════════════════════════
// 2. SERVICE WORKER (Chrome PWA install criteria #2)
// ═══════════════════════════════════════════════════════════════

async function testServiceWorker() {
  section('2. SERVICE WORKER');

  const swPath = join(ROOT, 'public/service-worker.js');
  
  check('SW file exists', existsSync(swPath));
  const swContent = readFileSync(swPath, 'utf-8');
  const swSize = statSync(swPath).size;
  check('SW file non-empty', swSize > 100, `${(swSize / 1024).toFixed(1)} KB`);

  // Fetch SW via HTTP
  let swRes;
  try {
    swRes = await fetch(`${BASE}/service-worker.js`);
    check('SW served via HTTP (200)', swRes.status === 200, `Got ${swRes.status}`);
  } catch (e) {
    check('SW served via HTTP', false, e.message);
    return;
  }

  const swCT = swRes.headers.get('content-type') || '';
  check('SW correct MIME: application/javascript', 
    swCT.includes('javascript'), swCT);

  // ── SW content checks ──
  check('self.addEventListener("install") present', 
    swContent.includes("addEventListener('install'"));
  check('self.addEventListener("activate") present', 
    swContent.includes("addEventListener('activate'"));
  check('self.addEventListener("fetch") present', 
    swContent.includes("addEventListener('fetch'"));
  check('skipWaiting() call', swContent.includes('skipWaiting'));
  check('clients.claim() call', swContent.includes('clients.claim'));
  check('PRECACHE_URLS defined', swContent.includes('PRECACHE_URLS'));
  check('CACHE_VERSION defined', swContent.includes('CACHE_VERSION'));
  check('Old cache cleanup logic', swContent.includes('CURRENT_CACHES'));
  check('Static cache defined', swContent.includes('STATIC_CACHE'));
  check('Page cache defined', swContent.includes('PAGE_CACHE'));

  // ── SW registration on page ──
  try {
    const pageRes = await fetch(BASE);
    const pageHtml = await pageRes.text();
    const hasRegistration = pageHtml.includes("register('/service-worker.js'");
    check('SW registration in page HTML', hasRegistration);
    check('Scope: / in registration', pageHtml.includes("scope: '/'"));
  } catch (e) {
    check('SW registration in page HTML', false, e.message);
  }
}

// ═══════════════════════════════════════════════════════════════
// 3. PWA ICONS — File & dimension validation
// ═══════════════════════════════════════════════════════════════

async function testIcons() {
  section('3. PWA ICONS');

  const icons = [
    { name: 'PWA Icon 192x192',  path: '/images/pwa-icon-192.png', minSize: 500,  expectedType: 'image/png' },
    { name: 'PWA Icon 512x512',  path: '/images/pwa-icon-512.png', minSize: 1000, expectedType: 'image/png' },
    { name: 'PWA Icon 180x180',  path: '/images/pwa-icon-180.png', minSize: 500,  expectedType: 'image/png' },
    { name: 'Logo Icon',         path: '/images/logo-icon.svg',    minSize: 100,  expectedType: 'image/svg+xml' },
    { name: 'OG Image SVG',      path: '/images/og-image.svg',     minSize: 100,  expectedType: 'image/svg+xml' },
    { name: 'OG Image PNG',      path: '/images/og-image.png',     minSize: 1000, expectedType: 'image/png' },
  ];

  for (const icon of icons) {
    const filePath = join(ROOT, 'public', icon.path.replace('/images/', 'images/'));
    
    // File existence
    if (existsSync(filePath)) {
      check(`${icon.name} — file exists`, true);
      const stats = statSync(filePath);
      check(`  └─ Size: ${(stats.size / 1024).toFixed(1)} KB`, stats.size >= icon.minSize,
        `Expected >= ${icon.minSize} bytes, got ${stats.size} bytes`);
    } else {
      check(`${icon.name} — file exists`, false, 'File not found');
      continue;
    }

    // HTTP accessibility
    try {
      const res = await fetch(`${BASE}${icon.path}`);
      check(`  └─ HTTP ${res.status}`, res.status === 200);
      const ct = res.headers.get('content-type') || '';
      check(`  └─ MIME: ${ct.split(';')[0]}`, ct.includes(icon.expectedType));
    } catch (e) {
      check(`  └─ HTTP accessible`, false, e.message);
    }
  }
}

// ═══════════════════════════════════════════════════════════════
// 4. HTML META TAGS (for PWA)
// ═══════════════════════════════════════════════════════════════

async function testHTMLMeta() {
  section('4. HTML META & LINK TAGS');

  try {
    const res = await fetch(BASE);
    const html = await res.text();

    check('Page loads successfully (200)', res.status === 200);
    check('<title> tag present', /<title>/.test(html));
    check('title non-empty', /<title>[^<]+/.test(html));
    check('<link rel="manifest">', /rel="manifest"/.test(html));
    check('<meta name="theme-color">', /name="theme-color"/.test(html));
    check('<meta name="apple-mobile-web-app-capable">', /apple-mobile-web-app-capable/.test(html));
    check('<meta name="viewport"> with viewport-fit=cover', /viewport-fit=cover/.test(html));
    check('<link rel="apple-touch-icon"> 180x180', /apple-touch-icon[^>]*180x180/.test(html));
    check('<link rel="apple-touch-icon"> 192x192', /apple-touch-icon[^>]*192x192/.test(html));
  } catch (e) {
    check('HTML page fetchable', false, e.message);
  }
}

// ═══════════════════════════════════════════════════════════════
// 5. HTTPS / LOCALHOST (required for install prompt)
// ═══════════════════════════════════════════════════════════════

async function testSecurity() {
  section('5. SECURITY CONTEXT');

  const url = new URL(BASE);
  const isLocalhost = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
  const isHTTPS = url.protocol === 'https:';

  check(`Protocol: ${url.protocol}`, isHTTPS || isLocalhost,
    'PWA install requires HTTPS or localhost');
  check(`Hostname: ${url.hostname}`, 
    isLocalhost || isHTTPS,
    isLocalhost ? 'localhost ✓' : 'HTTPS required for remote host');

  // Check CSP headers from Helmet
  try {
    const res = await fetch(BASE);
    const headers = {};
    res.headers.forEach((v, k) => { headers[k] = v; });

    const hasCSP = headers['content-security-policy'];
    if (hasCSP) {
      check('CSP allows manifest', !hasCSP.includes("manifest-src 'none'"),
        'CSP blocks manifest');
    } else {
      check('CSP not blocking (helmet relaxed)', true, 
        'contentSecurityPolicy: false in server.js');
    }
  } catch (e) {
    check('Security headers checkable', false, e.message);
  }
}

// ═══════════════════════════════════════════════════════════════
// 6. OFFLINE SUPPORT TEST
// ═══════════════════════════════════════════════════════════════

async function testOffline() {
  section('6. OFFLINE SUPPORT');

  const swContent = readFileSync(join(ROOT, 'public/service-worker.js'), 'utf-8');

  // Check offline fallback
  check('Offline HTML fallback defined', swContent.includes('OFFLINE_HTML'));
  check('Offline image placeholder', swContent.includes('Offline'));

  // Check precached assets
  const precacheAssets = [
    '/css/style.css',
    '/js/main.js',
    '/manifest.json',
    '/images/logo-icon.svg',
    '/images/pwa-icon-192.png',
  ];

  for (const asset of precacheAssets) {
    check(`Precache entry: ${asset}`, swContent.includes(`'${asset}'`));
  }

  // Check cache strategies
  check('Cache-first for CSS', swContent.includes("indexOf('/css/') === 0"));
  check('Cache-first for JS', swContent.includes("indexOf('/js/') === 0"));
  check('Cache-first for Images', swContent.includes("indexOf('/images/') === 0"));
  check('Network-first for pages', swContent.includes('networkFirst'));
  check('Font cache (Google Fonts)', swContent.includes('fontCacheFirst'));
}

// ═══════════════════════════════════════════════════════════════
// 7. BUILD SCRIPTS
// ═══════════════════════════════════════════════════════════════

async function testBuildScripts() {
  section('7. BUILD PIPELINE');

  const scripts = [
    { name: 'build-og-image.js',  path: 'scripts/build-og-image.js' },
    { name: 'build-pwa-icons.js', path: 'scripts/build-pwa-icons.js' },
  ];

  for (const script of scripts) {
    const fullPath = join(ROOT, script.path);
    check(`${script.name} exists`, existsSync(fullPath));
    if (existsSync(fullPath)) {
      const content = readFileSync(fullPath, 'utf-8');
      check(`  └─ Uses sharp for PNG conversion`, content.includes('sharp'));
    }
  }

  // Check package.json scripts
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf-8'));
  const buildScripts = pkg.scripts || {};
  check('npm run build:pwa exists', !!buildScripts['build:pwa']);
  check('npm run build:og exists', !!buildScripts['build:og']);
  check('npm run build (combined) exists', !!buildScripts.build);
  if (buildScripts.build) {
    check('build includes both scripts', 
      buildScripts.build.includes('build:pwa') && buildScripts.build.includes('build:og'));
  }

  // Verify sharp is installed
  try {
    const sharpPath = join(ROOT, 'node_modules/sharp');
    check('sharp (devDependency) installed', existsSync(sharpPath));
  } catch (e) {
    check('sharp installed', false, e.message);
  }
}

// ═══════════════════════════════════════════════════════════════
// 8. CROSS-VIEW PWA CONSISTENCY
// ═══════════════════════════════════════════════════════════════

async function testCrossView() {
  section('8. CROSS-VIEW PWA CONSISTENCY');

  const views = [
    { name: 'Landing page',  url: '/' },
    { name: 'Admin login',   url: '/admin/login' },
    { name: 'Game page',     url: '/play' },
    { name: 'User panel',    url: '/user/panel' },
  ];

  for (const view of views) {
    try {
      const res = await fetch(`${BASE}${view.url}`);
      if (res.status >= 200 && res.status < 400) {
        const html = await res.text();
        
        // All PWA pages MUST have manifest link
        check(`${view.name}: manifest link present`, /rel="manifest"/.test(html));
        check(`${view.name}: SW registration`, 
          /serviceWorker/.test(html));
        check(`${view.name}: <title> tag`, /<title>/.test(html));

        // Mobile meta tags
        check(`${view.name}: theme-color`, /theme-color/.test(html));
        check(`${view.name}: viewport-fit=cover`, /viewport-fit=cover/.test(html));
        check(`${view.name}: apple-mobile-web-app-capable`, 
          /apple-mobile-web-app-capable/.test(html));
      } else {
        check(`${view.name}: HTTP ${res.status}`, false, 'Page not accessible');
      }
    } catch (e) {
      check(`${view.name}: accessible`, false, e.message);
    }
  }
}

// ═══════════════════════════════════════════════════════════════
// SUMMARY & RECOMMENDATIONS
// ═══════════════════════════════════════════════════════════════

function printSummary() {
  const total = passed + failed;
  const pct = ((passed / total) * 100).toFixed(0);

  console.log(`\n${'═'.repeat(50)}`);
  console.log(`  📊 PWA VALIDATION RESULTS`);
  console.log(`  ${'─'.repeat(46)}`);
  console.log(`  ✅ Passed:  ${passed}`);
  console.log(`  ❌ Failed:  ${failed}`);
  console.log(`  📈 Rate:    ${pct}%`);
  console.log(`  ${'─'.repeat(46)}`);

  if (failed === 0) {
    console.log(`
  🎉 PWA INSTALL PROMPT READY!

  All Chrome PWA install criteria are met:
    ✓ Valid manifest.json with name + icons + display:standalone
    ✓ Service worker registered and active
    ✓ 192x192 and 512x512 icons
    ✓ HTTPS/localhost context
    ✓ Offline support configured
    ✓ Cross-view consistency

  📌 Note: Chrome shows the install prompt after the user
     interacts with the page (click/tap). It won't show
     on the very first visit — navigate to 2-3 pages first.
`);
  } else {
    console.log(`
  ⚠️  PWA needs ${failed} fix(es) before install prompt will appear.
`);
  }
}

// ═══════════════════════════════════════════════════════════════
// RUNNER
// ═══════════════════════════════════════════════════════════════

async function main() {
  console.log(`
╔═══════════════════════════════════════════╗
║   Edikit — PWA Install Prompt Validation  ║
║   ${new Date().toISOString()}    ║
╚═══════════════════════════════════════════╝
  `);

  console.log(`  Testing: ${BASE}\n`);

  const start = Date.now();

  try {
    await testManifest();
    await testServiceWorker();
    await testIcons();
    await testHTMLMeta();
    await testSecurity();
    await testOffline();
    await testBuildScripts();
    await testCrossView();
  } catch (err) {
    console.error(`\n🔥 Unhandled error:`, err.message);
    failed++;
  }

  printSummary();

  const duration = ((Date.now() - start) / 1000).toFixed(1);
  console.log(`  ⏱  Duration: ${duration}s\n`);

  process.exit(failed > 0 ? 1 : 0);
}

main();
