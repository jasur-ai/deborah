/**
 * Edikit — Service Worker v2.0.0
 * Cache-first strategy for static assets, network-first for pages & API
 * 
 * Cache Strategy:
 *   Static Assets  -> Cache-First    (CSS, JS, Images, Fonts)
 *   Pages          -> Network-First  (HTML navigations with offline fallback)
 *   API            -> Network-Only   (never cache dynamic data)
 *   Google Fonts   -> Cache-First    (stylesheet + font files)
 */

const CACHE_VERSION = 'v2.0.0';
const STATIC_CACHE  = 'edikit-static-' + CACHE_VERSION;
const PAGE_CACHE    = 'edikit-pages-' + CACHE_VERSION;
const FONT_CACHE    = 'edikit-fonts-' + CACHE_VERSION;
const CURRENT_CACHES = [STATIC_CACHE, PAGE_CACHE, FONT_CACHE];

// Assets to precache on install
const PRECACHE_URLS = [
  '/',
  '/css/style.css',
  '/js/main.js',
  '/js/theme.js',
  '/images/logo-icon.svg',
  '/images/logo-text.svg',
  '/images/og-image.svg',
  '/images/pwa-icon-192.png',
  '/images/pwa-icon-512.png',
  '/manifest.json',
];

// Google Fonts origins
const FONT_ORIGINS = [
  'fonts.googleapis.com',
  'fonts.gstatic.com',
];

// Minimal offline fallback HTML
const OFFLINE_HTML = '<!DOCTYPE html><html lang="uz"><head>' +
  '<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
  '<title>Edikit — Offline</title>' +
  '<style>body{background:#0A0F1F;color:#E8EDF7;font-family:"Nunito",sans-serif;' +
  'display:flex;align-items:center;justify-content:center;height:100vh;text-align:center;padding:20px;margin:0}' +
  'h1{font-family:"Righteous",cursive;font-size:2.2rem;margin-bottom:8px;color:#38BDF8}' +
  'p{color:#8B96B3;font-size:.95rem;line-height:1.6}' +
  '.dot{width:40px;height:40px;border-radius:50%;background:linear-gradient(135deg,#3B82F6,#38BDF8);' +
  'margin:0 auto 20px;box-shadow:0 0 30px rgba(59,130,246,.4)}</style></head>' +
  '<body><div><div class="dot"></div><h1>Offline</h1>' +
  '<p>Edikit ishlashi uchun internet kerak<br>Iltimos, tarmoqqa ulaning</p></div></body></html>';


// ═══════════════════════════════════════════════════════════════
// INSTALL — Precache core assets
// ═══════════════════════════════════════════════════════════════

self.addEventListener('install', function(event) {
  self.skipWaiting();

  event.waitUntil(
    caches.open(STATIC_CACHE).then(function(cache) {
      return cache.addAll(PRECACHE_URLS);
    }).catch(function(err) {
      console.warn('[SW] Precache failed:', err.message);
    })
  );
});

// ═══════════════════════════════════════════════════════════════
// ACTIVATE — Clean old caches, take control
// ═══════════════════════════════════════════════════════════════

self.addEventListener('activate', function(event) {
  event.waitUntil(clients.claim());

  event.waitUntil(
    caches.keys().then(function(keys) {
      return Promise.all(
        keys
          .filter(function(key) {
            return key.startsWith('edikit-') && CURRENT_CACHES.indexOf(key) === -1;
          })
          .map(function(key) {
            return caches.delete(key);
          })
      );
    })
  );
});

// ═══════════════════════════════════════════════════════════════
// FETCH — Route requests
// ═══════════════════════════════════════════════════════════════

self.addEventListener('fetch', function(event) {
  var request = event.request;
  var url = new URL(request.url);

  // Skip non-GET requests
  if (request.method !== 'GET') return;

  // Skip non-http protocols (e.g. chrome-extension://)
  if (!url.protocol.startsWith('http')) return;

  // Skip socket.io
  if (url.pathname.indexOf('/socket.io/') !== -1 || url.hostname === 'cdn.socket.io') return;

  // ── Google Fonts -> Cache-First ──
  if (FONT_ORIGINS.indexOf(url.hostname) !== -1) {
    event.respondWith(fontCacheFirst(request));
    return;
  }

  // ── Static Assets -> Cache-First ──
  if (
    url.pathname.indexOf('/css/') === 0 ||
    url.pathname.indexOf('/js/') === 0 ||
    url.pathname.indexOf('/images/') === 0 ||
    url.pathname.indexOf('/characters/') === 0 ||
    url.pathname === '/manifest.json' ||
    url.pathname === '/favicon.ico'
  ) {
    event.respondWith(cacheFirst(request));
    return;
  }

  // ── Page Navigations -> Network-First ──
  if (request.mode === 'navigate') {
    event.respondWith(networkFirst(request));
    return;
  }

  // ── Everything else -> Network-First fallback ──
  event.respondWith(
    fetch(request).catch(function() {
      return caches.match(request);
    })
  );
});

// ═══════════════════════════════════════════════════════════════
// STRATEGY: Cache-First (for static assets)
// ═══════════════════════════════════════════════════════════════

function cacheFirst(request) {
  return caches.match(request).then(function(cached) {
    if (cached) return cached;

    return fetch(request).then(function(response) {
      if (response && response.ok) {
        var clone = response.clone();
        caches.open(STATIC_CACHE).then(function(cache) {
          cache.put(request, clone);
        });
      }
      return response;
    }).catch(function() {
      // Offline image fallback
      if (request.destination === 'image') {
        return new Response(
          '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200" viewBox="0 0 200 200">' +
          '<rect width="200" height="200" fill="#0E1428"/>' +
          '<text x="100" y="110" text-anchor="middle" font-family="sans-serif" font-size="14" fill="#8B96B3">Offline</text></svg>',
          { headers: { 'Content-Type': 'image/svg+xml' } }
        );
      }
      return new Response('Offline', { status: 503 });
    });
  });
}

// ═══════════════════════════════════════════════════════════════
// STRATEGY: Network-First (for page navigations)
// ═══════════════════════════════════════════════════════════════

function networkFirst(request) {
  return fetch(request).then(function(response) {
    if (response && response.ok) {
      var clone = response.clone();
      caches.open(PAGE_CACHE).then(function(cache) {
        cache.put(request, clone);
      });
    }
    return response;
  }).catch(function() {
    return caches.match(request).then(function(cached) {
      if (cached) return cached;
      // Offline fallback page
      return new Response(OFFLINE_HTML, {
        status: 503,
        headers: { 'Content-Type': 'text/html;charset=UTF-8' }
      });
    });
  });
}

// ═══════════════════════════════════════════════════════════════
// STRATEGY: Font Cache-First (separate cache for Google Fonts)
// ═══════════════════════════════════════════════════════════════

function fontCacheFirst(request) {
  return caches.open(FONT_CACHE).then(function(cache) {
    return cache.match(request).then(function(cached) {
      if (cached) return cached;
      return fetch(request).then(function(response) {
        if (response && response.ok) {
          cache.put(request, response.clone());
        }
        return response;
      });
    });
  });
}
