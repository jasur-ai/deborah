/**
 * Edikit — Server Smoke Test
 *
 * Starts the server with `node server.js`, tests ALL routes,
 * health endpoints, and API endpoints with proper cookie + CSRF handling.
 *
 * Usage:  node scripts/smoke-test.js
 */

import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

const BASE = 'http://localhost:3000';
const PASS = [];
const FAIL = [];

let server = null;

function pass(label, detail = '') {
  PASS.push({ label, detail });
}

function fail(label, detail = '') {
  FAIL.push({ label, detail });
}

// ── Cookie jar (manually tracks connect.sid) ──
let _cookieJar = '';

function saveCookies(res) {
  const setCookie = res.headers.get('set-cookie');
  if (setCookie) {
    const match = setCookie.match(/(connect\.sid=[^;]+)/);
    if (match) _cookieJar = match[1];
  }
}

// ── Fetch with timeout + cookies ──
async function fetchWithTimeout(url, opts = {}, timeout = 5000) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeout);
  try {
    const headers = { ...(opts.headers || {}) };
    if (_cookieJar) {
      headers['Cookie'] = _cookieJar;
    }
    const res = await fetch(url, { ...opts, headers, signal: controller.signal });
    clearTimeout(id);
    saveCookies(res);
    return res;
  } catch (err) {
    clearTimeout(id);
    throw err;
  }
}

// ── GET → status check ──
async function testGet(label, path, expectStatus = 200) {
  try {
    const res = await fetchWithTimeout(BASE + path);
    if (res.status === expectStatus) {
      pass(label, `HTTP ${res.status}`);
    } else {
      fail(label, `Expected ${expectStatus}, got ${res.status}`);
    }
    return res;
  } catch (err) {
    fail(label, err.message);
    return null;
  }
}

// ── POST with CSRF token (extracted from cookie jar) ──
async function testPost(label, path, body = {}, expectStatus = 200) {
  try {
    const res = await fetchWithTimeout(BASE + path, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRF-Token': _csrfToken || 'no-token',
      },
      body: JSON.stringify(body),
      redirect: 'manual',
    });
    const isRedirect = res.status === 302 || res.status === 0;
    const ok = isRedirect ? true : res.status === expectStatus;
    if (ok) {
      pass(label, `HTTP ${isRedirect ? '302 (redirect)' : res.status}`);
    } else {
      fail(label, `Expected ${expectStatus}, got ${res.status}`);
    }
    return res;
  } catch (err) {
    fail(label, err.message);
    return null;
  }
}

// ── Extract CSRF token from HTML ──
function extractCsrfToken(html) {
  // Try window.__CSRF_TOKEN = '...';
  const m1 = html.match(/window\.__CSRF_TOKEN\s*=\s*'([^']+)'/);
  if (m1) return m1[1];
  // Try <input name="_csrf" value="...">
  const m2 = html.match(/<input[^>]*name=["']_csrf["'][^>]*value=["']([^"']+)["']/);
  if (m2) return m2[1];
  return null;
}

let _csrfToken = null;

// ── Login: GET login page → extract CSRF → POST credentials ──
async function loginFlow(username, password, loginPath) {
  try {
    // Step 1: GET login page to establish session + get CSRF token
    _cookieJar = '';
    const loginPage = await fetchWithTimeout(BASE + loginPath, { redirect: 'manual' });
    const html = await loginPage.text();
    const csrf = extractCsrfToken(html);
    _csrfToken = csrf;

    if (!_cookieJar) {
      fail(`GET ${loginPath} (session start)`, 'No session cookie received');
      return null;
    }

    // Step 2: POST with session cookie + CSRF token
    const res = await fetchWithTimeout(BASE + loginPath, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRF-Token': csrf || '',
      },
      body: JSON.stringify({ username, password }),
      redirect: 'manual',
    });

    // Node.js undici returns status 0 for opaque redirects
    const isRedirect = res.status === 302 || res.status === 0;
    if (isRedirect && _cookieJar) {
      pass(`POST ${loginPath} (${username})`, 'Logged in successfully');
      return _cookieJar;
    } else {
      fail(`POST ${loginPath} (${username})`, `Status ${res.status}, cookie: ${!!_cookieJar}, csrf: ${!!csrf}`);
      return null;
    }
  } catch (err) {
    fail(`POST ${loginPath} (${username})`, err.message);
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════

function cleanup() {
  if (server) {
    server.kill('SIGTERM');
    setTimeout(() => {
      if (server && !server.killed) server.kill('SIGKILL');
    }, 2000);
    server = null;
  }
}

// ═══════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════

async function main() {
  console.log('\n╔═══════════════════════════════════════════╗');
  console.log('║   🔥 Edikit — Server Smoke Test        ║');
  console.log('╚═══════════════════════════════════════════╝\n');

  // ── Step 1: Start server ──
  console.log('🚀 Starting server...');
  server = spawn('npm', ['start'], {
    cwd: ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      NODE_ENV: 'development',
      PORT: '3000',
      HOST: '0.0.0.0',
      LOG_LEVEL: 'silent',
    },
  });

  let serverOutput = '';
  server.stdout.on('data', (d) => { serverOutput += d.toString(); });
  server.stderr.on('data', (d) => { serverOutput += d.toString(); });

  // Retry loop: ping /health up to 20 times (10s max)
  let serverUp = false;
  for (let i = 0; i < 20; i++) {
    await new Promise((r) => setTimeout(r, 500));
    try {
      const hc = await fetch(BASE + '/health', { signal: AbortSignal.timeout(1000) });
      if (hc.status === 200) {
        serverUp = true;
        break;
      }
    } catch (_) {
      // Server not ready yet
    }
  }

  if (!serverUp) {
    console.error('❌ Server failed to start after 10s');
    console.error('Server output:', serverOutput.slice(-500));
    cleanup();
    process.exit(1);
  }

  console.log(`✅ Server is UP (PID: ${server.pid})\n`);

  try {
    // ═════════════════════════════════════════════════════
    // ROUTE MAP
    // ═════════════════════════════════════════════════════
    // From server.js:        GET /health, /ready, /favicon.ico
    // From routes/index.js:  GET /
    // From routes/auth.js:   GET /admin/login, POST /admin/login, GET /admin/logout
    //                        GET /user/login,  POST /user/login,  GET /user/logout
    // From routes/user.js:   GET /user/panel, /user/create-test, /user/test-arena
    //                        GET /user/api/tests/search
    //                        POST /user/api/tests/save, /delete, /rename, /toggle-public
    // From routes/admin.js:  GET /admin/dashboard, /admin/vip
    //                        GET /admin/api/fans, /pre-groups, /results, /stats, /users
    //                        POST /admin/api/fans/save, /delete, /update
    //                        POST /admin/api/pre-groups/save, /delete
    //                        POST /admin/api/users/delete, /api/results/delete
    //                        POST /admin/api/vip/grant, /revoke
    // From routes/game.js:   GET /host, /play, /host/:code
    // From routes/arena.js:  GET /arena, /arena/api/check-session
    //                        POST /arena/api/add-bots, /cleanup-bots

    // ═════════════════════════════════════════════════════
    // SECTION 1: PUBLIC ROUTES
    // ═════════════════════════════════════════════════════
    console.log('📄 ── PUBLIC ROUTES ──');

    await testGet('GET  / (landing)', '/');
    await testGet('GET  /health', '/health');
    await testGet('GET  /ready', '/ready');
    await testGet('GET  /favicon.ico', '/favicon.ico');
    await testGet('GET  /play', '/play');
    await testGet('GET  /arena', '/arena');
    await testGet('GET  /user/login', '/user/login');
    await testGet('GET  /admin/login', '/admin/login');

    // ═════════════════════════════════════════════════════
    // SECTION 2: HEALTH ENDPOINTS (detailed JSON checks)
    // ═════════════════════════════════════════════════════
    console.log('\n❤️  ── HEALTH ENDPOINTS ──');

    // /health JSON body
    try {
      const healthRes = await fetchWithTimeout(BASE + '/health');
      if (healthRes.status === 200) {
        const body = await healthRes.json();
        [
          ['status=ok', body.status === 'ok'],
          ['has uptime (number)', typeof body.uptime === 'number'],
          ['has timestamp (number)', typeof body.timestamp === 'number'],
          ['has node version (string)', typeof body.node === 'string'],
          ['has env (string)', typeof body.env === 'string'],
          ['has features (object)', typeof body.features === 'object'],
          ['features.vip.enabled=true', body.features?.vip?.enabled === true],
        ].forEach(([label, ok]) => {
          ok ? pass(`/health → ${label}`) : fail(`/health → ${label}`);
        });
      } else {
        fail('/health', `HTTP ${healthRes.status}`);
      }
    } catch (err) {
      fail('/health', err.message);
    }

    // /ready JSON body
    try {
      const readyRes = await fetchWithTimeout(BASE + '/ready');
      if (readyRes.status === 200) {
        const body = await readyRes.json();
        body.status === 'ready' ? pass('/ready → status=ready') : fail('/ready → status=ready');
        typeof body.uptime === 'number' ? pass('/ready → has uptime') : fail('/ready → has uptime');
        typeof body.timestamp === 'number' ? pass('/ready → has timestamp') : fail('/ready → has timestamp');
      } else {
        fail('/ready', `HTTP ${readyRes.status}`);
      }
    } catch (err) {
      fail('/ready', err.message);
    }

    // ═════════════════════════════════════════════════════
    // SECTION 3: 404 HANDLING
    // ═════════════════════════════════════════════════════
    console.log('\n🔍 ── 404 HANDLING ──');
    await testGet('GET  /nonexistent-route', '/nonexistent-route', 404);
    await testGet('GET  /api/nonexistent', '/api/nonexistent', 404);

    // ═════════════════════════════════════════════════════
    // SECTION 4: USER AUTH FLOW
    // ═════════════════════════════════════════════════════
    console.log('\n👤 ── USER AUTH FLOW ──');

    // Login as regular user
    _csrfToken = null;
    const userCookie = await loginFlow('user', 'user', '/user/login');

    // Login as admin
    _csrfToken = null;
    const adminCookie = await loginFlow('admin', 'admin', '/admin/login');

    // ═════════════════════════════════════════════════════
    // SECTION 5: AUTH-PROTECTED ROUTES
    // ═════════════════════════════════════════════════════
    console.log('\n🔒 ── AUTH PROTECTED ROUTES ──');

    // Without auth → fetch sends JSON-accepting headers → middleware returns 401
    _cookieJar = '';
    await testGet('GET  /user/panel (unauth → 401)', '/user/panel', 401);
    await testGet('GET  /user/create-test (unauth → 401)', '/user/create-test', 401);
    await testGet('GET  /host (unauth → 401)', '/host', 401);

    // With user auth
    if (userCookie) {
      _cookieJar = userCookie;
      await testGet('GET  /user/panel (auth)', '/user/panel');
      await testGet('GET  /user/create-test (auth)', '/user/create-test');
      await testGet('GET  /user/test-arena', '/user/test-arena');
      await testGet('GET  /user/test-arena?source=mock&key=test', '/user/test-arena?source=mock&key=test');
      await testGet('GET  /host (auth)', '/host');
      await testGet('GET  /user/api/tests/search?q=test', '/user/api/tests/search?q=test');
      await testGet('GET  /user/api/tests/search (empty q)', '/user/api/tests/search?q=');
    }

    // With admin auth
    if (adminCookie) {
      _cookieJar = adminCookie;
      await testGet('GET  /admin/dashboard (admin auth)', '/admin/dashboard');
      await testGet('GET  /admin/vip (admin auth)', '/admin/vip');
      await testGet('GET  /admin/api/fans (admin auth)', '/admin/api/fans');
      await testGet('GET  /admin/api/pre-groups (admin auth)', '/admin/api/pre-groups');
      await testGet('GET  /admin/api/results (admin auth)', '/admin/api/results');
      await testGet('GET  /admin/api/stats (admin auth)', '/admin/api/stats');
      await testGet('GET  /admin/api/users (admin auth)', '/admin/api/users');
    }

    // ═════════════════════════════════════════════════════
    // SECTION 6: CSRF PROTECTION
    // ═════════════════════════════════════════════════════
    console.log('\n🛡️  ── CSRF PROTECTION ──');

    // POST without CSRF token → should reject with 403
    _cookieJar = '';
    _csrfToken = null;
    const noCsrf1 = await fetch(BASE + '/user/api/tests/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'x', questions: [] }),
      redirect: 'manual',
    });
    noCsrf1.status >= 400
      ? pass('POST /user/api/tests/save (no CSRF) → rejected', `HTTP ${noCsrf1.status}`)
      : fail('POST /user/api/tests/save (no CSRF)', `Expected reject, got ${noCsrf1.status}`);

    const noCsrf2 = await fetch(BASE + '/admin/api/vip/grant', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'test' }),
      redirect: 'manual',
    });
    noCsrf2.status >= 400
      ? pass('POST /admin/api/vip/grant (no CSRF) → rejected', `HTTP ${noCsrf2.status}`)
      : fail('POST /admin/api/vip/grant (no CSRF)', `Expected reject, got ${noCsrf2.status}`);

    // ═════════════════════════════════════════════════════
    // SECTION 7: STATIC FILES
    // ═════════════════════════════════════════════════════
    console.log('\n📦 ── STATIC FILES ──');
    await testGet('GET  /css/style.css', '/css/style.css');
    await testGet('GET  /js/main.js', '/js/main.js');
    await testGet('GET  /images/logo-icon.svg', '/images/logo-icon.svg');
    await testGet('GET  /images/logo-text.svg', '/images/logo-text.svg');
    await testGet('GET  /service-worker.js', '/service-worker.js');
    await testGet('GET  /manifest.json', '/manifest.json');

    // ═════════════════════════════════════════════════════
    // SECTION 8: CHARACTER IMAGES
    // ═════════════════════════════════════════════════════
    console.log('\n🎨 ── CHARACTER IMAGES ──');
    await testGet('GET  /characters/white-fury.png', '/characters/white-fury.png');
    await testGet('GET  /characters/black-fury.png', '/characters/black-fury.png');
    await testGet('GET  /characters/dark-blade.png', '/characters/dark-blade.png');
    await testGet('GET  /characters/dark-wolf.png', '/characters/dark-wolf.png');
    await testGet('GET  /characters/tigress.png', '/characters/tigress.png');
    await testGet('GET  /characters/nick-wilde.png', '/characters/nick-wilde.png');

    // ═════════════════════════════════════════════════════
    // SECTION 9: ARENA API
    // ═════════════════════════════════════════════════════
    console.log('\n🎪 ── ARENA API ──');
    await testGet('GET  /arena/api/check-session (no code)', '/arena/api/check-session');
    await testGet('GET  /arena/api/check-session (fake)', '/arena/api/check-session?code=FAKE123');

    // ═════════════════════════════════════════════════════
    // SECTION 10: LOGOUT ROUTES
    // ═════════════════════════════════════════════════════
    console.log('\n🚪 ── LOGOUT ROUTES ──');
    // For logout routes, use redirect: 'manual' to prevent fetch from following the redirect
    if (userCookie) {
      _cookieJar = userCookie;
      try {
        const res = await fetchWithTimeout(BASE + '/user/logout', { method: 'GET', redirect: 'manual' });
        if (res.status === 302 || res.status === 0) {
          pass('GET  /user/logout (→ redirect)', 'HTTP 302');
        } else {
          fail('GET  /user/logout (→ redirect)', `Expected 302, got ${res.status}`);
        }
      } catch (err) { fail('GET  /user/logout (→ redirect)', err.message); }
    }
    if (adminCookie) {
      _cookieJar = adminCookie;
      try {
        const res = await fetchWithTimeout(BASE + '/admin/logout', { method: 'GET', redirect: 'manual' });
        if (res.status === 302 || res.status === 0) {
          pass('GET  /admin/logout (→ redirect)', 'HTTP 302');
        } else {
          fail('GET  /admin/logout (→ redirect)', `Expected 302, got ${res.status}`);
        }
      } catch (err) { fail('GET  /admin/logout (→ redirect)', err.message); }
    }

    // ═════════════════════════════════════════════════════
    // SECTION 11: RESPONSE CONTENT-TYPE CHECKS
    // ═════════════════════════════════════════════════════
    console.log('\n📋 ── CONTENT-TYPE CHECKS ──');
    try {
      const css = await fetchWithTimeout(BASE + '/css/style.css');
      const ct = css.headers.get('content-type') || '';
      ct.includes('text/css')
        ? pass('GET  /css/style.css → text/css')
        : fail('GET  /css/style.css', `Content-Type: ${ct}`);
    } catch (err) {
      fail('GET  /css/style.css → content-type', err.message);
    }

    try {
      const json = await fetchWithTimeout(BASE + '/health');
      const ct = json.headers.get('content-type') || '';
      ct.includes('application/json')
        ? pass('GET  /health → application/json')
        : fail('GET  /health', `Content-Type: ${ct}`);
    } catch (err) {
      fail('GET  /health → content-type', err.message);
    }

  } finally {
    cleanup();
  }

  // ═════════════════════════════════════════════════════
  // RESULTS
  // ═════════════════════════════════════════════════════
  const total = PASS.length + FAIL.length;

  console.log(`\n╔═══════════════════════════════════════════╗`);
  console.log(`║   📊 SMOKE TEST RESULTS                ║`);
  console.log(`╠═══════════════════════════════════════════╣`);
  console.log(`║   ✅ Passed:  ${String(PASS.length).padStart(3)}/${total}                    ║`);
  console.log(`║   ❌ Failed:  ${String(FAIL.length).padStart(3)}/${total}                    ║`);
  console.log(`╚═══════════════════════════════════════════╝`);

  if (PASS.length > 0) {
    console.log('\n✅ PASSED:');
    PASS.forEach((p) => console.log(`   ✓ ${p.label}${p.detail ? ' — ' + p.detail : ''}`));
  }

  if (FAIL.length > 0) {
    console.log('\n❌ FAILED:');
    FAIL.forEach((f) => console.log(`   ✗ ${f.label}${f.detail ? ' — ' + f.detail : ''}`));
  }

  console.log('');

  if (FAIL.length > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('\n💥 Smoke test crashed:', err.message);
  cleanup();
  process.exit(1);
});
