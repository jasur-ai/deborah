#!/usr/bin/env node
/**
 * Deborah — HEMIS OAuth2 LIVE TEST HARNESS (xavfsiz)
 * -------------------------------------------------
 * .env fayldan credential'larni o'qiydi (chat orqali emas).
 * Oqim: authorize -> login (CSRF + cookie) -> code -> access-token -> api/user.
 * OUTPUT: hech qachon password/secret/token ko'rinmaydi (redacted).
 *
 * .env format (scripts/hemis-test.env — .gitignore'da):
 *   HEMIS_CLIENT_ID=8
 *   HEMIS_CLIENT_SECRET=...
 *   HEMIS_REDIRECT_URI=http://hemis-oauth-test.lc/index.php
 *   HEMIS_USERNAME=test_login
 *   HEMIS_PASSWORD=test_password
 *
 * Rejimlar:
 *   node scripts/hemis-live-test.mjs          → live OAuth2 test (6 bosqich)
 *   node scripts/hemis-live-test.mjs --check  → faqat config tekshiruvi (hech qanday tarmoq so'rovi yo'q)
 *
 * DIQQAT (A-14 xulosasi): bu harness faqat DEMO instance (student.hemis.uz,
 * client_id=8) uchun to'liq ishlaydi. talaba.tsue.uz (TSUE prod) da OAuth client
 * ro'yxatdan o'tmagan (authorize 401) — TSUE uchun REST API yo'li ishlaydi:
 *   node scripts/hemis-rest-probe.mjs   (POST /rest/v1/auth/login → JWT → account/me)
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ENV_PATH = process.env.HEMIS_TEST_ENV || path.join(__dirname, 'hemis-test.env');

export const REDACT = (v) =>
  v ? `${String(v).slice(0, 4)}…${String(v).slice(-3)} (${String(v).length} belgi)` : '(bo\'sh)';

const REQUIRED_KEYS = ['HEMIS_CLIENT_ID', 'HEMIS_CLIENT_SECRET', 'HEMIS_REDIRECT_URI', 'HEMIS_USERNAME', 'HEMIS_PASSWORD'];
const SECRET_KEYS = new Set(['HEMIS_CLIENT_SECRET', 'HEMIS_PASSWORD']);

export function parseEnv(text) {
  const cfg = {};
  for (const line of String(text).split('\n')) {
    // `\r$` — Windows (CRLF) env fayllarida qiymat oxiridagi \r ni olib tashlaydi
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/);
    if (m) cfg[m[1]] = m[2].replace(/\r$/, '').replace(/^["']|["']$/g, '');
  }
  return cfg;
}

export function validateCfg(cfg) {
  const errors = [];
  for (const k of REQUIRED_KEYS) if (!cfg[k]) errors.push(`${k} bo'sh`);
  if (cfg.HEMIS_REDIRECT_URI && !/^https?:\/\//.test(cfg.HEMIS_REDIRECT_URI)) {
    errors.push('HEMIS_REDIRECT_URI http(s) emas');
  }
  return { ok: errors.length === 0, errors };
}

/** Test'da client qabul qilinadimi — authorize URL qurish (secret ishtirok etmaydi) */
export function buildAuthUrl({ clientId, redirectUri, state }) {
  return `https://student.hemis.uz/oauth/authorize?client_id=${encodeURIComponent(clientId)}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&state=${encodeURIComponent(state)}`;
}

/** Relative Location header'larini base'ga nisbatan absolute qiladi (login redirect holatlari) */
export function resolveUrl(base, loc) {
  if (!loc) return null;
  try {
    return new URL(loc, base).href;
  } catch {
    return null;
  }
}

function loadEnv() {
  if (!fs.existsSync(ENV_PATH)) {
    console.error('XATO: hemis-test.env topilmadi. Iltimos, scripts/ hemis-test.env nomli fayl yuklang.');
    console.error('Talab qilinadi: ' + REQUIRED_KEYS.join(', '));
    process.exit(1);
  }
  return parseEnv(fs.readFileSync(ENV_PATH, 'utf8'));
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
  const { ok, errors } = validateCfg(cfg);
  if (!ok) {
    console.error('XATO: config noto\'g\'ri —', errors.join('; '));
    process.exit(1);
  }
  if (process.argv.includes('--check')) {
    console.log('✅ Config OK (redacted):');
    console.log('  client_id:', REDACT(cfg.HEMIS_CLIENT_ID));
    console.log('  client_secret:', REDACT(cfg.HEMIS_CLIENT_SECRET));
    console.log('  redirect_uri:', cfg.HEMIS_REDIRECT_URI);
    console.log('  username:', REDACT(cfg.HEMIS_USERNAME));
    console.log('  password:', REDACT(cfg.HEMIS_PASSWORD));
    console.log('  authorize:', buildAuthUrl({ clientId: cfg.HEMIS_CLIENT_ID, redirectUri: cfg.HEMIS_REDIRECT_URI, state: 'check' }));
    process.exit(0);
  }

  const jar = new CookieJar();
  const base = 'https://student.hemis.uz';
  const ua = 'Deborah-HemIS-LiveTest/1.0 (educational test, own test account)';
  const step = (n, msg) => console.log(`\n── [${n}] ${msg} ──`);

  // 1. authorize (redirectsiz — Location ushlanadi)
  step(1, 'authorize (client qabul qilinadimi?)');
  const authUrl = buildAuthUrl({ clientId: cfg.HEMIS_CLIENT_ID, redirectUri: cfg.HEMIS_REDIRECT_URI, state: `deborah_test_${Date.now()}` });
  const r1 = await fetch(authUrl, { redirect: 'manual', headers: { 'user-agent': ua } });
  const loc1 = resolveUrl(authUrl, r1.headers.get('location'));
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
  const loc3 = resolveUrl(`${base}/dashboard/login`, r3.headers.get('location'));
  console.log(`HTTP ${r3.status} | Location: ${loc3 ? loc3.slice(0, 110) : '(yo\'q)'} | Set-Cookie: ${(r3.headers.getSetCookie?.() || []).length} ta`);
  jar.set(r3);
  if (r3.status === 451) { console.log('XULOSA: GEOFENCE — login POST 451 (xorijiy IP)'); return; }
  if (r3.status !== 302 || !loc3 || /login/i.test(loc3)) {
    const body3 = r3.status === 302 ? await fetch(resolveUrl(`${base}/dashboard/login`, loc3), { redirect: 'manual', headers: { 'user-agent': ua, cookie: jar.header() } }).then((r) => r.text()).catch(() => '') : await r3.text();
    const err = body3.match(/alert[^>]*>([^<]{5,140})/i) || body3.match(/error[^>]*>([^<]{5,140})/i) || body3.match(/help-block[^>]*>([^<]{3,140})/i);
    console.log(`XULOSA: LOGIN FAIL — HTTP ${r3.status}${err ? ' | xabar: ' + err[1].trim().slice(0, 120) : ' | xabar topilmadi'}`);
    return;
  }

  // 4. callback (redirect:manual — code olinadi)
  step(4, 'callback — authorization code');
  const r4 = await fetch(loc3, { redirect: 'manual', headers: { 'user-agent': ua, cookie: jar.header() } });
  jar.set(r4);
  const loc4 = resolveUrl(loc3, r4.headers.get('location')) || '';
  const code = loc4.match(/[?&]code=([^&]+)/)?.[1] || null;
  console.log(`HTTP ${r4.status} | code: ${code ? `olinmadi→${code.slice(0, 8)}… (${code.length} belgi)` : 'YO\'Q'}`);
  if (!code) { console.log('XULOSA: CODE OLINMADI — callback geofence/anti-bot bo\'lishi mumkin'); return; }

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
  if (!at) { console.log('XULOSA: TOKEN OLINMADI — server xatosi:', JSON.stringify({ error: tokJson.error, error_description: tokJson.error_description, message: tokJson.message }).slice(0, 220)); return; }

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

// To'g'ridan-to'g'ri chaqirilgandagina ishga tushadi (test'da import qilinadi)
const isDirectRun = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isDirectRun) {
  main().catch((e) => { console.error('FATAL:', e.message); process.exit(1); });
}
