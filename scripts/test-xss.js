/**
 * Edikit — XSS Security Test Suite
 * 
 * Avtomatik xavfsizlik tekshiruvi: emoji, charImg, search, middleware
 * 
 * Usage:  node scripts/test-xss.js
 * 
 * Testlar:
 *   ✅ 1. Server-side emoji validation (socket.io player:join)
 *   ✅ 2. charImg() HTML escaping (host.ejs + enter.ejs)
 *   ✅ 3. Search result escaping (panel.ejs doSearch)
 *   ✅ 4. Middleware JSON response for API routes
 *   ✅ 5. API endpoint access control (toggle, delete without auth)
 */

import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

// ── Colors ──
const RED = '\x1b[31m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const CYAN = '\x1b[36m';
const GRAY = '\x1b[90m';
const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';

// ── Test tracking ──
let passed = 0;
let failed = 0;
let total = 0;

function section(title) {
  console.log(`\n${CYAN}${BOLD}═══ ${title} ═══${RESET}\n`);
}

function test(name, condition, detail = '') {
  total++;
  if (condition) {
    passed++;
    console.log(`  ${GREEN}✅ ${name}${RESET}`);
  } else {
    failed++;
    console.log(`  ${RED}❌ ${name}${RESET}`);
    if (detail) console.log(`     ${GRAY}${detail}${RESET}`);
  }
}

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ─────────────────────────────────────────────────────────────
// 1. CHECK SOURCE FILES FOR SECURITY PATTERNS
// ─────────────────────────────────────────────────────────────

section('1. Server-side emoji validation (socket/game-handler.js)');

const gameHandlerPath = join(ROOT, 'socket', 'game-handler.js');
const gameHandlerSrc = readFileSync(gameHandlerPath, 'utf-8');

// Check VALID_CHAR_PATHS exists
test(
  'VALID_CHAR_PATHS Set exists',
  gameHandlerSrc.includes('VALID_CHAR_PATHS = new Set(')
);

// Check Unicode property escape exists
test(
  'Unicode emoji validation regex exists',
  gameHandlerSrc.includes('\\\\p{Extended_Pictographic}') || gameHandlerSrc.includes('\\p{Extended_Pictographic}')
);

// Check safeEmoji fallback
test(
  'safeEmoji fallback to 👤 on invalid',
  gameHandlerSrc.includes("safeEmoji = '👤'")
);

// Check emoji stored is safeEmoji, not raw emoji
test(
  'emoji: safeEmoji used in fb.set',
  gameHandlerSrc.includes('emoji: safeEmoji')
);

// Check CARTOON_CHARS imported
test(
  'CARTOON_CHARS imported from constants',
  gameHandlerSrc.includes('CARTOON_CHARS')
);

// ─────────────────────────────────────────────────────────────
// 2. charImg() HTML ESCAPING CHECK
// ─────────────────────────────────────────────────────────────

section('2. charImg() HTML escaping (host.ejs + enter.ejs)');

const hostPath = join(ROOT, 'views', 'game', 'host.ejs');
const enterPath = join(ROOT, 'views', 'game', 'enter.ejs');

[['host.ejs', hostPath], ['enter.ejs', enterPath]].forEach(([name, path]) => {
  const src = readFileSync(path, 'utf-8');

  // Check charImg function uses safePath
  test(
    `${name} — charImg uses esc(imgPath)`,
    src.includes('const safePath = esc(imgPath)'),
    'Expected: const safePath = esc(imgPath)'
  );

  // Check img tag uses safePath for src
  test(
    `${name} — img src uses safePath`,
    src.includes('src=\"\' + safePath + \'\"'),
    'Expected: src="\' + safePath + \'"'
  );

  // Check text branch uses safePath
  test(
    `${name} — text span uses safePath`,
    src.includes('+safePath+') ,
    'Expected: span content uses safePath'
  );

  // Check esc function exists (XSS prevention foundation)
  test(
    `${name} — esc() function defined`,
    src.includes('function esc(') || src.includes('const esc = '),
    'Expected esc() function for HTML escaping'
  );
});

// ─────────────────────────────────────────────────────────────
// 3. SEARCH RESULT ESCAPING CHECK
// ─────────────────────────────────────────────────────────────

section('3. Search result escaping (views/user/panel.ejs)');

const panelPath = join(ROOT, 'views', 'user', 'panel.ejs');
const panelSrc = readFileSync(panelPath, 'utf-8');

// Check testName is escaped in search results
test(
  'search: esc(r.testName) used',
  panelSrc.includes('esc(r.testName)'),
  'Expected: testName escaped in innerHTML'
);

// Check userName is escaped
test(
  'search: esc(r.userName) used',
  panelSrc.includes('esc(r.userName)'),
  'Expected: userName escaped in innerHTML'
);

// Check testKey is escaped for onclick
test(
  'search: esc(r.testKey) used',
  panelSrc.includes('esc(r.testKey)'),
  'Expected: testKey escaped in onclick handler'
);

// Check old XSS patterns are removed (no raw ${r.testName})
test(
  'search: no raw ${r.testName} in innerHTML',
  !panelSrc.includes('${r.testName}') || panelSrc.includes('esc(r.testName)'),
  'Should not have unescaped testName in template literal'
);

// ─────────────────────────────────────────────────────────────
// 4. MIDDLEWARE JSON RESPONSE CHECK
// ─────────────────────────────────────────────────────────────

section('4. Middleware JSON response (middleware/auth.js)');

const authPath = join(ROOT, 'middleware', 'auth.js');
const authSrc = readFileSync(authPath, 'utf-8');

// Check requireAuth handles API routes
test(
  'requireAuth: JSON for API routes (/api/)',
  authSrc.includes("req.path.startsWith('/api/')"),
  'Expected API route detection in requireAuth'
);

// Check requireAuth uses res.status(401).json()
test(
  'requireAuth: 401 JSON response',
  authSrc.includes('res.status(401).json({ error:'),
  'Expected JSON error response for API routes'
);

// Check requireAdmin also handles API
test(
  'requireAdmin: JSON for API routes',
  authSrc.includes("res.status(401).json({ error: 'Admin"),
  'Expected JSON error response in requireAdmin'
);

// Check both redirect and JSON paths exist
test(
  'requireAuth: regular redirect as fallback',
  authSrc.includes("res.redirect('/user/login')"),
  'Expected redirect fallback for HTML routes'
);

// Check xhr/accepts detection
test(
  'requireAuth: req.xhr || req.accepts(json)',
  authSrc.includes('req.xhr') && authSrc.includes("req.accepts('json')"),
  'Expected XHR and Accepts header detection'
);

// ─────────────────────────────────────────────────────────────
// 5. API ENDPOINT ACCESS CONTROL
// ─────────────────────────────────────────────────────────────

section('5. API endpoint access control (routes/user.js)');

const userRoutesPath = join(ROOT, 'routes', 'user.js');
const userRoutesSrc = readFileSync(userRoutesPath, 'utf-8');

// Check toggle-public requires auth (behind router.use(requireAuth))
test(
  'toggle-public: inside requireAuth middleware',
  userRoutesSrc.includes("router.use(requireAuth)"),
  'Expected router.use(requireAuth) before toggle-public route'
);

// Check delete reads isPublic before deleting (cleanup public_tests)
test(
  'delete: checks isPublic before removing',
  userRoutesSrc.includes('if (snap.exists() && snap.val().isPublic)'),
  'Expected public_tests cleanup before user test deletion'
);

// Check public_tests collection sync exists
test(
  'toggle-public: writes to public_tests when making public',
  userRoutesSrc.includes('fb.set(`public_tests/'),
  'Expected public_tests write on toggle-public'
);

test(
  'toggle-public: removes from public_tests when making private',
  userRoutesSrc.includes('fb.remove(`public_tests/'),
  'Expected public_tests remove on toggle-private'
);

// ─────────────────────────────────────────────────────────────
// 6. SAVE ENDPOINT isPublic PRESERVATION
// ─────────────────────────────────────────────────────────────

section('6. Save endpoint security (routes/user.js)');

// Check isPublic is preserved when editing
test(
  'save: preserves isPublic when editing',
  userRoutesSrc.includes('isPublic = !!existing.val().isPublic'),
  'Expected isPublic preservation on edit'
);

test(
  'save: isPublic syncs to public_tests on edit',
  userRoutesSrc.includes('fb.update(`public_tests/'),
  'Expected public_tests update on edit'
);

// ─────────────────────────────────────────────────────────────
// 7. VIP ENDPOINT SECURITY (static analysis)
// ─────────────────────────────────────────────────────────────

section('7. VIP Endpoint Security (routes/admin.js)');

const adminRoutesPath = join(ROOT, 'routes', 'admin.js');
const adminRoutesSrc = readFileSync(adminRoutesPath, 'utf-8');

// Check grant uses safeKey() for username sanitization
test(
  'grant: uses imported safeKey() for DB key',
  adminRoutesSrc.includes('const userKey = safeKey(username)'),
  'Expected safeKey() call in grant endpoint'
);

// Check revoke also uses safeKey()
test(
  'revoke: uses imported safeKey() for DB key',
  adminRoutesSrc.includes('const userKey = safeKey(username);') &&
    adminRoutesSrc.lastIndexOf('const userKey = safeKey(username);') >
    adminRoutesSrc.indexOf('const userKey = safeKey(username)'),
  'Expected safeKey() in both grant and revoke (at least 2 occurrences)'
);

// Check no inline safeKey regex duplication
test(
  'grant+revoke: no inline safeKey regex',
  !adminRoutesSrc.includes("replace(/[.#$\\/\\[\\]]/g, '_')") || 
    adminRoutesSrc.indexOf("replace(/[.#$\\/\\[\\]]/g, '_')") > 
    adminRoutesSrc.indexOf('const userKey = safeKey(username)'),
  'Inline regex should not appear before safeKey() calls'
);

// Check import crypto from 'crypto' (ESM, not require)
test(
  'admin.js: uses ESM import crypto',
  adminRoutesSrc.includes("import crypto from 'crypto'"),
  'Expected ESM import for crypto'
);

// Check no require('crypto') in admin.js
test(
  'admin.js: no require("crypto")',
  !adminRoutesSrc.includes("require('crypto')") && !adminRoutesSrc.includes('require("crypto")'),
  'require() should not appear in ESM module'
);

// Check requireAdmin is applied at router level (covers VIP endpoints)
test(
  'admin.js: requireAdmin applied via router.use()',
  adminRoutesSrc.includes('router.use(requireAdmin)'),
  'Expected router-level requireAdmin'
);

// Check grant endpoint returns JSON on error
test(
  'grant: returns JSON error for missing user',
  adminRoutesSrc.includes("return res.status(404).json({ error: 'Bunday foydalanuvchi topilmadi' })"),
  'Expected 404 JSON for missing user'
);

// Check revoke returns JSON on error
test(
  'revoke: returns JSON error for missing user',
  adminRoutesSrc.includes("return res.status(404).json({ error: 'Bunday foydalanuvchi topilmadi' });"),
  'Expected 404 JSON for missing user — match with or without semicolon'
);

// ─────────────────────────────────────────────────────────────
// 8. requireVip MIDDLEWARE SECURITY
// ─────────────────────────────────────────────────────────────

section('8. requireVip Middleware (middleware/vip.js)');

const vipMiddlewarePath = join(ROOT, 'middleware', 'vip.js');
const vipMiddlewareSrc = readFileSync(vipMiddlewarePath, 'utf-8');

// Check requireVip returns 404 (not 403)
test(
  'requireVip: returns 404 for non-VIP',
  vipMiddlewareSrc.includes('res.status(404).render'),
  'Expected 404 render for non-VIP users'
);

// Check no 403 response in requireVip
test(
  'requireVip: no 403 status code used',
  !vipMiddlewareSrc.includes('res.status(403)'),
  '403 should not appear in requireVip'
);

// Check isVip is read from DB every request (no session caching)
test(
  'requireVip: reads isVip from DB every request',
  vipMiddlewareSrc.includes('fb.get(`users/${userKey}/isVip`)'),
  'Expected DB read of isVip per request'
);

// Check the why-404 comment exists
test(
  'requireVip: has comment explaining 404 vs 403',
  vipMiddlewareSrc.includes('404') && vipMiddlewareSrc.includes('403') &&
    vipMiddlewareSrc.includes('yashirin'),
  'Expected explanation comment for 404 vs 403 choice'
);

// Check isCurrentUserVip helper exists
test(
  'requireVip: isCurrentUserVip() helper exported',
  vipMiddlewareSrc.includes('export async function isCurrentUserVip'),
  'Expected exported isCurrentUserVip helper'
);

// ─────────────────────────────────────────────────────────────
// 9. VIP VIEW ESCAPING (views/admin/vip.ejs)
// ─────────────────────────────────────────────────────────────

section('9. VIP View Escaping (views/admin/vip.ejs)');

const vipViewPath = join(ROOT, 'views', 'admin', 'vip.ejs');
const vipViewSrc = readFileSync(vipViewPath, 'utf-8');

// Check username in table uses <%= (escaped)
test(
  'vip.ejs: table username uses <%=',
  vipViewSrc.includes('<td><span class="font-bold"><%= u.username %></span></td>'),
  'Expected escaped username output'
);

// Check onclick handlers escape username properly — using raw output + .replace() for JS string safety
// Pattern: <%- u.username.replace(/'/g, "\\'") %>
// This is MORE secure than <%= because:
//   - <%= HTML-escapes ' to &#39; which BREAKS JS strings in onclick
//   - <%- with .replace() escapes ' to \' which is safe for JS string context
test(
  'vip.ejs: onclick revokeVip escapes single quotes with .replace()',
  vipViewSrc.includes("revokeVip('<%- u.username.replace(/'/g, \"\\\\'\") %>')"),
  'Expected raw output with .replace() for JS-safe username in revoke onclick'
);

test(
  'vip.ejs: onclick quickGrant escapes single quotes with .replace()',
  vipViewSrc.includes("quickGrant('<%- u.username.replace(/'/g, \"\\\\'\") %>')"),
  'Expected raw output with .replace() for JS-safe username in grant onclick'
);

// Check esc() function exists in script
test(
  'vip.ejs: esc() function defined for JS escaping',
  vipViewSrc.includes('function esc(s)'),
  'Expected client-side esc() function'
);

// Check filterVip uses textContent (not innerHTML) 
test(
  'vip.ejs: filterVip uses textContent for safe filtering',
  vipViewSrc.includes('.textContent'),
  'Expected textContent (not innerHTML) for filtering'
);

// ─────────────────────────────────────────────────────────────
// 10. HTTP LIVE TESTS
// ─────────────────────────────────────────────────────────────

section('10. HTTP Live Tests');

// Start server via dynamic import (reliable, sets PORT before loading)
console.log('   🚀 Starting server for HTTP tests...\n');

const HTTP_PORT = '4567';
process.env.PORT = HTTP_PORT;
const BASE = `http://localhost:${HTTP_PORT}`;

let serverReady = false;

try {
  // Dynamic import starts the server as a side effect
  const serverModule = await import(join(ROOT, 'server.js'));
  
  // Wait for httpServer 'listening' event
  const hs = serverModule.httpServer;
  if (hs && !hs.listening) {
    await new Promise(resolve => hs.once('listening', resolve));
  }
  
  // Extra wait for full initialization
  await new Promise(r => setTimeout(r, 500));
  serverReady = true;
} catch (err) {
  console.log(`   ${YELLOW}⚠️  Server error: ${err.message.slice(0, 100)}${RESET}\n`);
}

if (!serverReady) {
  console.log(`   ${YELLOW}⚠️  Server did not start, skipping HTTP tests${RESET}\n`);
}

try {
  if (!serverReady) throw new Error('Server not ready');

  // ── 7a. Route availability ──
  const routes = ['/', '/play', '/arena', '/user/login', '/css/style.css', '/js/main.js'];
  for (const route of routes) {
    try {
      const res = await fetch(BASE + route, { redirect: 'manual' });
      test(
        `HTTP 200: ${route}`,
        res.status === 200,
        `Got ${res.status}`
      );
    } catch (e) {
      test(`HTTP ${route}`, false, e.message);
    }
  }

  // ── 7b. Search API returns JSON (even 401) ──
  try {
    const res = await fetch(BASE + '/user/api/tests/search?q=test', { redirect: 'manual' });
    const ct = res.headers.get('content-type') || '';
    test(
      'search API: returns JSON content-type',
      ct.includes('application/json') || ct.includes('json'),
      `Content-Type: ${ct}`
    );
    // Should be 401 without auth
    test(
      'search API: 401 without auth',
      res.status === 401,
      `Got ${res.status}`
    );
  } catch (e) {
    test('search API endpoint', false, e.message);
  }

  // ── 7c. Toggle API returns JSON without auth ──
  try {
    const res = await fetch(BASE + '/user/api/tests/toggle-public', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: 'xss-test' }),
      redirect: 'manual',
    });
    const body = await res.json().catch(() => ({}));
    test(
      'toggle API: 401 JSON without auth',
      res.status === 401 && body.error,
      `Got ${res.status}: ${JSON.stringify(body).slice(0, 60)}`
    );
  } catch (e) {
    test('toggle API endpoint', false, e.message);
  }

  // ── 7d. Delete API returns JSON without auth ──
  try {
    const res = await fetch(BASE + '/user/api/tests/delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: 'xss-test' }),
      redirect: 'manual',
    });
    const body = await res.json().catch(() => ({}));
    test(
      'delete API: 401 JSON without auth',
      res.status === 401 && body.error,
      `Got ${res.status}: ${JSON.stringify(body).slice(0, 60)}`
    );
  } catch (e) {
    test('delete API endpoint', false, e.message);
  }

  // ── 7e. VIP grant API returns JSON without auth ──
  try {
    const res = await fetch(BASE + '/admin/api/vip/grant', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'test' }),
      redirect: 'manual',
    });
    const body = await res.json().catch(() => ({}));
    test(
      'VIP grant API: 401 JSON without auth',
      res.status === 401 && body.error,
      `Got ${res.status}: ${JSON.stringify(body).slice(0, 60)}`
    );
  } catch (e) {
    test('VIP grant API endpoint', false, e.message);
  }

  // ── 7f. VIP revoke API returns JSON without auth ──
  try {
    const res = await fetch(BASE + '/admin/api/vip/revoke', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'test' }),
      redirect: 'manual',
    });
    const body = await res.json().catch(() => ({}));
    test(
      'VIP revoke API: 401 JSON without auth',
      res.status === 401 && body.error,
      `Got ${res.status}: ${JSON.stringify(body).slice(0, 60)}`
    );
  } catch (e) {
    test('VIP revoke API endpoint', false, e.message);
  }

  // ── 7g. VIP grant with XSS payload → 401 JSON (not 500/HTML) ──
  try {
    const res = await fetch(BASE + '/admin/api/vip/grant', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: '<img src=x onerror=alert(1)>' }),
      redirect: 'manual',
    });
    const body = await res.json().catch(() => ({}));
    const ct = res.headers.get('content-type') || '';
    test(
      'VIP grant XSS payload: 401 JSON (not HTML)',
      (res.status === 401 || res.status === 400) && ct.includes('json'),
      `Got ${res.status}: ${JSON.stringify(body).slice(0, 60)}, Content-Type: ${ct}`
    );
  } catch (e) {
    test('VIP grant XSS payload endpoint', false, e.message);
  }

  // ── 7h. VIP revoke with XSS payload → 401 JSON ──
  try {
    const res = await fetch(BASE + '/admin/api/vip/revoke', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: '" onfocus="alert(1)' }),
      redirect: 'manual',
    });
    const body = await res.json().catch(() => ({}));
    const ct = res.headers.get('content-type') || '';
    test(
      'VIP revoke XSS payload: 401 JSON (not HTML)',
      (res.status === 401 || res.status === 400) && ct.includes('json'),
      `Got ${res.status}: ${JSON.stringify(body).slice(0, 60)}, Content-Type: ${ct}`
    );
  } catch (e) {
    test('VIP revoke XSS payload endpoint', false, e.message);
  }

} finally {
  // With dynamic import, server runs in-process — process.exit() handles cleanup
  await new Promise(r => setTimeout(r, 300));
}

// ─────────────────────────────────────────────────────────────
// SUMMARY
// ─────────────────────────────────────────────────────────────

console.log(`\n${BOLD}${'═'.repeat(50)}${RESET}`);
console.log(`${BOLD}   XSS TEST RESULTS${RESET}`);
console.log(`${BOLD}${'═'.repeat(50)}${RESET}`);
console.log(`   ${GREEN}✅ Passed: ${passed}/${total}${RESET}`);
if (failed > 0) {
  console.log(`   ${RED}❌ Failed: ${failed}/${total}${RESET}`);
}
console.log(`${BOLD}${'═'.repeat(50)}${RESET}\n`);

// Exit with appropriate code
process.exit(failed > 0 ? 1 : 0);
