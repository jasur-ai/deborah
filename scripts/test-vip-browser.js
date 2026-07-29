/**
 * Edikit — VIP Tizimi Brauzer Test Skripti
 *
 * HTTP session (cookie) orqali to'liq VIP funksionallikni test qiladi.
 * Serverni avtomatik import qiladi (PORT env orqali).
 * CSRF tokenni avtomatik extract qiladi.
 *
 * Testlar:
 *   1. Admin login → VIP grant (sardor)
 *   2. VIP user (sardor) login → Mock/PRE ko'rinadi
 *   3. Non-VIP user (user) login → Mock/PRE yashirin
 *   4. Non-VIP user → /host?source=mock → 404
 */

import http from 'http';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Set port BEFORE dynamic import (static import hoists — can't use it!)
const PORT = process.env.TEST_PORT || '3457';
process.env.PORT = PORT;
const BASE = `http://localhost:${PORT}`;

let passed = 0;
let failed = 0;

// ── Cookie jar + CSRF token ──
const jar = {};
let csrfToken = '';

function setCookies(res) {
  const c = res.headers['set-cookie'];
  if (c) {
    c.forEach(h => {
      const m = h.match(/^([^=]+)=([^;]+)/);
      if (m) jar[m[1]] = m[2];
    });
  }
}

function cookieHeader() {
  return Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ');
}

function request(method, path, body) {
  return new Promise((resolve, reject) => {
    const u = new URL(BASE + path);
    const headers = {
      'Cookie': cookieHeader(),
      'Content-Type': 'application/json',
    };
    // Add CSRF token for non-GET, non-API requests
    if (csrfToken && method !== 'GET' && !path.startsWith('/admin/api/') && !path.startsWith('/user/api/') && !path.startsWith('/api/')) {
      headers['x-csrf-token'] = csrfToken;
    }

    const opts = {
      hostname: u.hostname, port: u.port, path: u.pathname + u.search,
      method, headers,
    };
    const req = http.request(opts, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        setCookies(res);
        let json;
        try { json = JSON.parse(data); } catch { json = null; }
        resolve({ status: res.statusCode, headers: res.headers, body: data, json });
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

/** Extract CSRF token from HTML hidden input */
function extractCsrf(body) {
  const m = body.match(/name="_csrf"\s+value="([^"]+)"/);
  return m ? m[1] : '';
}

/** Log in as a user — GET login page, extract CSRF, POST with token */
async function loginAs(username, password, admin = false) {
  // Clear jar first
  Object.keys(jar).forEach(k => delete jar[k]);
  csrfToken = '';

  // GET login page → gets session cookie + CSRF token
  const loginPage = admin ? '/admin/login' : '/user/login';
  const page = await request('GET', loginPage);

  // Extract CSRF token from the page
  csrfToken = extractCsrf(page.body);

  if (!csrfToken) {
    console.log(`  ⚠️  CSRF token not found on ${loginPage}`);
    return false;
  }

  // POST login with CSRF token via header
  const r = await request('POST', loginPage, { username, password });
  // 302 = redirect to dashboard/panel → login succeeded
  // 200 = login page re-rendered → login failed (wrong credentials, etc.)
  return r.status === 302;
}

function test(name, fn) {
  return fn().then(ok => {
    if (ok) { passed++; console.log(`  ✅ ${name}`); }
    else { failed++; console.log(`  ❌ ${name}`); }
  }).catch(e => {
    failed++;
    console.log(`  ❌ ${name} — ${e.message}`);
  });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function main() {
  console.log('\n══════════════════════════════════════════════');
  console.log('   🧪 VIP Tizimi — To\'liq Test');
  console.log('══════════════════════════════════════════════\n');

  // ── Dynamic import (process.env.PORT already set) ──
  console.log(`📡 Server http://localhost:${PORT} da ishga tushirilmoqda...`);
  const serverModule = await import(resolve(__dirname, '..', 'server.js'));
  await sleep(1500);

  try {
    // ── 1. Admin Login & VIP Grant ──
    console.log('\n┌─ 1. Admin Login & VIP Grant');

    await test('Admin login — admin/admin', async () => {
      return await loginAs('admin', 'admin', true);
    });

    await test('GET /admin/dashboard — 200', async () => {
      const r = await request('GET', '/admin/dashboard');
      return r.status === 200 && r.body.includes('Admin');
    });

    await test('Sidebar VIP tab mavjud', async () => {
      const r = await request('GET', '/admin/dashboard');
      return r.body.includes("switchTab('vip')");
    });

    await test('GET /admin/api/users — JSON', async () => {
      const r = await request('GET', '/admin/api/users');
      return r.json && Array.isArray(r.json.users);
    });

    await test('GET /admin/vip — VIP sahifasi', async () => {
      const r = await request('GET', '/admin/vip');
      return r.status === 200 && r.body.includes('VIP');
    });

    await test('VIP berish: sardor (parol o\'zgarmaydi)', async () => {
      const r = await request('POST', '/admin/api/vip/grant', { username: 'sardor' });
      return r.json && r.json.success === true && r.json.plainPassword;
    });

    console.log('└─');

    // ── 2. VIP User (sardor) — original password works! ──
    console.log('\n┌─ 2. VIP User — Sardor (isVip: true, original parol: 1234)');

    await test('Login — sardor/1234 (original parol)', async () => {
      return await loginAs('sardor', '1234', false);
    });

    await test('GET /user/panel — 200', async () => {
      const r = await request('GET', '/user/panel');
      return r.status === 200;
    });

    await test('VIP user: Mock bo\'limi HTML da bor', async () => {
      const r = await request('GET', '/user/panel');
      // VIP user: isVip=true, fans.length>0 → "Mock" section renders
      return r.body.includes('Mock') || r.body.includes('PRE Test');
    });

    console.log('└─');

    // ── 3. Non-VIP User (user) ──
    console.log('\n┌─ 3. Non-VIP User — user (isVip: false)');

    await test('Login — user/user', async () => {
      return await loginAs('user', 'user', false);
    });

    await test('GET /user/panel — 200', async () => {
      const r = await request('GET', '/user/panel');
      return r.status === 200;
    });

    await test('Non-VIP: Mock bo\'limi HTML da YO\'Q', async () => {
      const r = await request('GET', '/user/panel');
      // Non-VIP user: isVip=false → Mock/PRE bloklari render qilinmaydi
      const hasMockText = r.body.includes('Mock Fanlar') || r.body.includes('PRE Test');
      return !hasMockText;
    });

    console.log('└─');

    // ── 4. Non-VIP → Direct URL access to Mock/PRE ──
    console.log('\n┌─ 4. Non-VIP → Direct URL (requireVip 404 test)');

    await test('GET /host?source=mock — 404 (requireVip)', async () => {
      const r = await request('GET', '/host?source=mock&key=fizika_mexanika');
      // Non-VIP user: requireVip middleware 404 qaytaradi
      return r.status === 404;
    });

    await test('GET /host?source=pre — 404 (requireVip)', async () => {
      const r = await request('GET', '/host?source=pre&key=test_pre');
      return r.status === 404;
    });

    await test('GET /host?source=user — ishlaydi (user test)', async () => {
      const r = await request('GET', '/host?source=user&key=ut1');
      // Non-VIP user o'z testiga kira oladi
      return r.status === 200 || r.status === 302;
    });

    console.log('└─\n');

    // ── Results ──
    console.log('══════════════════════════════════════════════');
    console.log(`   📊 Natijalar: ${passed} ✅  |  ${failed} ❌  |  Jami: ${passed + failed}`);
    console.log('══════════════════════════════════════════════\n');

  } finally {
    process.exit(failed > 0 ? 1 : 0);
  }
}

main().catch(e => {
  console.error('❌ Test script xatosi:', e.message);
  process.exit(1);
});
