#!/usr/bin/env node
/**
 * Edikit — HEMIS OAuth2 LIVE TEST HARNESS (xavfsiz)
 * -------------------------------------------------
 * .env fayldan credential'larni o'qiydi (chat orqali emas).
 * Oqim: authorize -> login (CSRF + cookie) -> code -> access-token -> api/user.
 * OUTPUT: hech qachon password/secret/token ko'rinmaydi (redacted).
 *
 * .env format:
 *   HEMIS_BASE_URL=https://talaba.tsue.uz     (OTM portali — student.hemis.uz emas!)
 *   HEMIS_CLIENT_ID=<OTM panelida yaratilgan klient>
 *   HEMIS_CLIENT_SECRET=...
 *   HEMIS_REDIRECT_URI=http://hemis-oauth-test.lc/index.php
 *   HEMIS_USERNAME=test_login
 *   HEMIS_PASSWORD=test_password
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ENV_PATH = path.join(__dirname, 'hemis-test.env');
const REDACT = (v) => (v ? `${String(v).slice(0, 4)}…${String(v).slice(-3)} (${String(v).length} belgi)` : '(bo\'sh)');

// ── .env o'qish ──
function loadEnv() {
  if (!fs.existsSync(ENV_PATH)) {
    console.error('XATO: hemis-test.env topilmadi. Iltimos, workspace ga "hemis-test.env" nomli fayl yuklang.');
    console.error('Talab qilinadi: HEMIS_CLIENT_ID, HEMIS_CLIENT_SECRET, HEMIS_REDIRECT_URI, HEMIS_USERNAME, HEMIS_PASSWORD');
    process.exit(1);
  }
  const cfg = {};
  for (const line of fs.readFileSync(ENV_PATH, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/);
    if (m) cfg[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  return cfg;
}

// ── Cookie jar (minimal) ──
class CookieJar {
  constructor() { this.map = new Map(); }
  set(res) {
    const setc = res.headers.getSetCookie?.() || res.headers.raw?.()?.['set-cookie'] || [];
    for (const c of setc) {
      const [pair] = String(c).split(';');
      const idx = pair.indexOf('=');
      if (idx > 0) this.map.set(pair.slice(0, idx).trim(), pair.slice(idx + 1).trim());
    }
  }
  header() { return [...this.map.entries()].map(([k, v]) => `${k}=${v}`).join('; '); }
}

async function main() {
  const cfg = loadEnv();
  const jar = new CookieJar();
  const base = (cfg.HEMIS_BASE_URL || 'https://student.hemis.uz').replace(/\/+$/, '');
  const ua = 'Edikit-HemIS-LiveTest/1.0 (educational test, own test account)';
  const step = (n, msg) => console.log(`\n── [${n}] ${msg} ──`);

  // 1. authorize (redirectsiz — Location ushlanadi)
  step(1, 'authorize (client qabul qilinadimi?)');
  const authUrl = `${base}/oauth/authorize?client_id=${encodeURIComponent(cfg.HEMIS_CLIENT_ID)}&redirect_uri=${encodeURIComponent(cfg.HEMIS_REDIRECT_URI)}&response_type=code&state=edikit_test_${Date.now()}`;
  const r1 = await fetch(authUrl, { redirect: 'manual', headers: { 'user-agent': ua } });
  const loc1 = r1.headers.get('location');
  console.log(`HTTP ${r1.status} | Location: ${loc1 ? loc1.slice(0, 90) : '(yo\'q)'}`);
  if (r1.status !== 302 || !loc1) { console.log('XULOSA: BLOCKED — authorize bosqichida muammo'); return; }

  // 2. login sahifasi (CSRF + cookie)
  step(2, 'login sahifasi (CSRF token + cookie)');
  const r2 = await fetch(loc1, { redirect: 'manual', headers: { 'user-agent': ua } });
  jar.set(r2);
  const html = await r2.text();
  const csrfMatch = html.match(/name="_csrf-frontend" value="([^"]+)"/);
  const csrf = csrfMatch ? csrfMatch[1] : null;
  console.log(`HTTP ${r2.status} | CSRF: ${csrf ? `topildi (${csrf.length} belgi)` : 'TOPI LMADI!'}`);
  if (r2.status === 451) { console.log('XULOSA: GEOFENCE — bu muhit UZ IP emas, login 451 qaytardi'); return; }
  if (!csrf) { console.log('XULOSA: BLOCKED — CSRF olinmadi (sahifa geofence/anti-bot bo\'lishi mumkin)'); return; }

  // 3. login POST
  step(3, 'login POST (test akkaunt)');
  const body = new URLSearchParams();
  body.set('FormStudentLogin[login]', cfg.HEMIS_USERNAME);
  body.set('FormStudentLogin[password]', cfg.HEMIS_PASSWORD);
  body.set('FormStudentLogin[rememberMe]', '0');
  body.set('_csrf-frontend', csrf);
  const r3 = await fetch(`${base}/dashboard/login`, {
    method: 'POST',
    redirect: 'manual',
    headers: { 'user-agent': ua, 'content-type': 'application/x-www-form-urlencoded', cookie: jar.header(), referer: loc1 },
    body,
  });
  const loc3 = r3.headers.get('location');
  console.log(`HTTP ${r3.status} | Location: ${loc3 ? loc3.slice(0, 110) : '(yo\'q)'} | Set-Cookie: ${(r3.headers.getSetCookie?.() || []).length} ta`);
  jar.set(r3);
  if (r3.status === 451) { console.log('XULOSA: GEOFENCE — login POST 451 (xorijiy IP)'); return; }
  if (r3.status !== 302) {
    console.log(`XULOSA: LOGIN FAIL — HTTP ${r3.status}`);
    return;
  }

  // 3b. Login o'tdi — ENDI authorize'ni qayta chaqiramiz (cookie bilan, redirect:manual)
  //     HEMIS: login'dan keyin authorize'ga qaytsa, code bilan redirect_uri'ga yo'naltiradi.
  step('3b', 'authorize qayta (cookie bilan — code olish)');
  const authUrl2 = `${base}/oauth/authorize?client_id=${encodeURIComponent(cfg.HEMIS_CLIENT_ID)}&redirect_uri=${encodeURIComponent(cfg.HEMIS_REDIRECT_URI)}&response_type=code&state=edikit_test_${Date.now()}`;
  const r3b = await fetch(authUrl2, { redirect: 'manual', headers: { 'user-agent': ua, cookie: jar.header() } });
  jar.set(r3b);
  const loc3b = r3b.headers.get('location') || '';
  console.log(`HTTP ${r3b.status} | Location: ${loc3b.slice(0, 120)}`);
  const code = loc3b.match(/[?&]code=([^&]+)/)?.[1] || null;
  console.log(`code: ${code ? `${code.slice(0, 8)}… (${code.length} belgi)` : 'YO\'Q'}`);
  if (!code) {
    // agar authorize qayta login sahifasiga yo'naltirsa — demo "consent" ekrani bo'lishi mumkin
    console.log('XULOSA: authorize keyin ham code bermadi — consent ekrani/anti-bot');
    return;
  }

  // 5. access-token exchange (client_id + secret — POST)
  step(5, 'access-token exchange');
  const tokBody = new URLSearchParams();
  tokBody.set('grant_type', 'authorization_code');
  tokBody.set('code', code);
  tokBody.set('redirect_uri', cfg.HEMIS_REDIRECT_URI);
  tokBody.set('client_id', cfg.HEMIS_CLIENT_ID);
  tokBody.set('client_secret', cfg.HEMIS_CLIENT_SECRET);
  const r5 = await fetch(`${base}/oauth/access-token`, {
    method: 'POST',
    headers: { 'user-agent': ua, 'content-type': 'application/x-www-form-urlencoded' },
    body: tokBody,
  });
  const tokJson = await r5.json().catch(() => ({}));
  const at = tokJson.access_token;
  console.log(`HTTP ${r5.status} | access_token: ${at ? REDACT(at) : '(yo\'q)'} | refresh: ${tokJson.refresh_token ? 'bor' : 'yo\'q'} | expires_in: ${tokJson.expires_in ?? '-'}`);
  if (!at) { console.log('XULOSA: TOKEN OLINMADI — server xatosi:', JSON.stringify(tokJson).slice(0, 200)); return; }

  // 6. api/user
  step(6, 'oauth/api/user (real javob tuzilishi)');
  const r6 = await fetch(`${base}/oauth/api/user?fields=id,uuid,type,name,login,email,university_id,groups`, {
    headers: { 'user-agent': ua, authorization: `Bearer ${at}` },
  });
  const userJson = await r6.json().catch(() => ({}));
  console.log(`HTTP ${r6.status}`);
  if (r6.ok) {
    const safe = { ...userJson, login: userJson.login ? '***' : undefined, email: userJson.email ? '***' : undefined };
    console.log('USER (redacted):', JSON.stringify(safe, null, 2).slice(0, 800));
    console.log('\nXULOSA: ✅ LIVE TEST O\'TDI — OAuth2 flow to\'liq ishladi');
    console.log('   (email bo\'sh bo\'lsa — mapping fallback login/phone kerak, research_repos 2.4)');
  } else {
    console.log('XULOSA: user endpoint xato:', JSON.stringify(userJson).slice(0, 200));
  }
}

main().catch((e) => { console.error('FATAL:', e.message); process.exit(1); });
