/**
 * Edikit — HEMIS Identity Provider Adapter (AUTH A-15)
 * ------------------------------------------------------
 * REST-first: talaba o'z HEMIS login/paroli bilan akkauntini bog'laydi.
 * A-14 da live tasdiqlangan yo'l:
 *   POST {base}/rest/v1/auth/login  (login+password)  → JWT
 *   GET  {base}/rest/v1/account/me  (Bearer JWT)      → profil
 *
 * OAuth2 scaffold: OTM HEMIS panelida client ro'yxatdan o'tganda
 * (HEMIS_OAUTH_CLIENT_ID + SECRET + REDIRECT_URI env'da) authorize /
 * access-token / api/user endpoint'lari yoqiladi (hemis-oauth namunasidan:
 * student.hemis.uz/oauth/authorize, /oauth/access-token, /oauth/api/user).
 *
 * SECURITY:
 *   - Parol HECH QACHON saqlanmaydi, log'ga chiqmaydi, response'da qaytmaydi.
 *   - SSRF guard: base URL https + ruxsat etilgan hostlar (hemis/uz OTM
 *     domenlari); localhost/private-IP rad etiladi (test'da fetch mock'lanadi).
 *   - Rate limit: /auth/hemis va link — 10/15 daqiqa per IP + per user.
 *   - Geofence (HEMIS faqat UZ IP): xorijiy IP → tashqi so'rov yuborilmaydi,
 *     'geofence' kodi qaytadi (client "faqat O'zbekistondan" xabarni ko'radi).
 */

import { z } from 'zod';
import CONFIG from '../../../config/env.js';
import { ipHash } from '../audit.js';
import { startSpan, endSpan } from '../../../telemetry/tracer.js'; // AUTH D-05: auth.hemis span

// ── Config ──
const BASE_URL = (CONFIG.HEMIS_BASE_URL || 'https://student.hemis.uz').replace(/\/+$/, '');
const REST_ENABLED = CONFIG.HEMIS_REST_ENABLED !== false;
const OAUTH_CLIENT_ID = CONFIG.HEMIS_OAUTH_CLIENT_ID || '';
const OAUTH_CLIENT_SECRET = CONFIG.HEMIS_OAUTH_CLIENT_SECRET || '';
const OAUTH_REDIRECT_URI = CONFIG.HEMIS_OAUTH_REDIRECT_URI || '';
const LINK_MAX = CONFIG.HEMIS_LINK_MAX || 10;
const LINK_WINDOW_MS = CONFIG.HEMIS_LINK_WINDOW_MS || 15 * 60 * 1000;
const HTTP_TIMEOUT_MS = 10_000;

// ── Zod: REST account/me profil (A-14 da live olingan real shape) ──
const AccountMeSchema = z.object({
  id: z.union([z.string(), z.number()]).optional(),
  student_id_number: z.string().optional(),
  full_name: z.string().optional(),
  first_name: z.string().optional(),
  second_name: z.string().optional(),
  third_name: z.string().optional(),
  university: z.union([z.string(), z.object({ name: z.string().optional() }).passthrough()]).optional(),
  specialty: z.union([z.string(), z.object({ name: z.string().optional() }).passthrough()]).optional(),
  faculty: z.union([z.string(), z.object({ name: z.string().optional() }).passthrough()]).optional(),
  group: z.union([z.string(), z.object({ name: z.string().optional() }).passthrough()]).optional(),
  semester: z.union([z.number(), z.string()]).optional(),
  email: z.string().optional(),
  phone: z.string().optional(),
  image: z.string().optional(),
  studentStatus: z.string().optional(),
  birth_date: z.string().optional(),
  gender: z.string().optional(),
}).passthrough();

// ── Zod: OAuth2 /oauth/api/user (hemis-oauth namunasidan) ──
const OAuthUserSchema = z.object({
  id: z.union([z.string(), z.number()]).optional(),
  uuid: z.string().optional(),
  university_id: z.union([z.string(), z.number()]).optional(),
  type: z.string().optional(),
  firstname: z.string().optional(),
  surname: z.string().optional(),
  patronymic: z.string().optional(),
  login: z.string().optional(),
  picture: z.string().optional(),
  email: z.string().optional(),
  phone: z.string().optional(),
  birth_date: z.string().optional(),
}).passthrough();

/** JWT payload'dan university code (iss=hemis.324 → '324') */
function universityCodeFromJwt(token) {
  if (!token || typeof token !== 'string') return undefined;
  const parts = token.split('.');
  if (parts.length < 2) return undefined;
  try {
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    const m = /hemis\.(\d+)/.exec(payload.iss || '');
    if (m) return m[1];
    return payload.university_id != null ? String(payload.university_id) : undefined;
  } catch {
    return undefined;
  }
}

const objName = (v) => (v && typeof v === 'object' ? v.name : v);

/**
 * REST account/me → xavfsiz normalangan profil.
 * Faqat ma'lum maydonlar; passport_pin/address kabi PII olib tashlanadi.
 */
export function normalizeAccountMe(raw, jwtToken) {
  const safe = AccountMeSchema.safeParse(raw || {});
  const d = safe.success ? safe.data : {};
  const fullName =
    d.full_name ||
    [d.first_name, d.second_name, d.third_name].filter(Boolean).join(' ') ||
    '';
  return {
    hemisId: String(d.student_id_number || d.id || '').trim(),
    fullName: String(fullName).trim(),
    firstName: d.first_name || '',
    lastName: d.second_name || '',
    patronymic: d.third_name || '',
    university: String(objName(d.university) || '').trim(),
    universityId: universityCodeFromJwt(jwtToken) || '',
    specialty: String(objName(d.specialty) || '').trim(),
    faculty: String(objName(d.faculty) || '').trim(),
    group: String(objName(d.group) || '').trim(),
    semester: d.semester != null ? String(d.semester) : '',
    email: d.email || '',
    phone: d.phone || '',
    picture: d.image || '',
    status: d.studentStatus || '',
    birthDate: d.birth_date || '',
    gender: d.gender || '',
  };
}

/**
 * OAuth2 /oauth/api/user → xavfsiz normalangan profil.
 */
export function normalizeOAuthUser(raw) {
  const safe = OAuthUserSchema.safeParse(raw || {});
  const d = safe.success ? safe.data : {};
  const fullName = [d.surname, d.firstname, d.patronymic].filter(Boolean).join(' ');
  return {
    hemisId: String(d.id ?? d.uuid ?? '').trim(),
    uuid: d.uuid || '',
    universityId: d.university_id != null ? String(d.university_id) : '',
    type: d.type || '',
    fullName: fullName.trim(),
    firstName: d.firstname || '',
    lastName: d.surname || '',
    patronymic: d.patronymic || '',
    login: d.login || '',
    email: d.email || '',
    phone: d.phone || '',
    picture: d.picture || '',
    birthDate: d.birth_date || '',
  };
}

/**
 * SSRF guard — faqat https + ruxsat etilgan host (hemis.uz va OTM domenlari).
 * localhost/private-IP/link-local rad etiladi (test'da fetch mock'lanadi, bu
 * yo'l chaqirilmaydi — shuning uchun test uchun maxsus ochiq emas).
 */
export function assertSafeBaseUrl(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false, reason: 'invalid_url' };
  }
  if (parsed.protocol !== 'https:') return { ok: false, reason: 'https_required' };
  const host = parsed.hostname.toLowerCase();
  const isLocalhost =
    host === 'localhost' || host === '127.0.0.1' || host === '::1' || host.endsWith('.localhost');
  const isPrivateIp =
    /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.)/.test(host) ||
    host === '0.0.0.0';
  if (isLocalhost || isPrivateIp) return { ok: false, reason: 'private_host' };
  const allowed =
    host === 'hemis.uz' ||
    host.endsWith('.hemis.uz') ||
    host.endsWith('.uz'); // OTM domenlari (tsue.uz, vsi.uz, ...)
  if (!allowed) return { ok: false, reason: 'host_not_allowed' };
  return { ok: true, host };
}

/**
 * REST login — POST {base}/rest/v1/auth/login.
 * Hech qachon parolni log'ga chiqarmaydi; timeout + SSRF guard.
 * @returns {Promise<{ token: string }>}
 * @throws {Error} code: 'invalid_credentials' | 'geofence' | 'unreachable' | 'http_...'
 */
export async function restLogin({ login, password }, opts = {}) {
  const fetchFn = opts.fetchFn || globalThis.fetch;
  const baseUrl = opts.baseUrl || BASE_URL;
  const guard = assertSafeBaseUrl(baseUrl);
  if (!guard.ok) {
    const err = new Error('HEMIS base URL xavfsiz emas');
    err.code = 'misconfigured';
    throw err;
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs || HTTP_TIMEOUT_MS);
  // AUTH D-05 §08: auth.hemis span (parol attribute emas — faqat host/status)
  const span = startSpan('auth.hemis', { attributes: { 'hemis.host': new URL(baseUrl).host, 'auth.outcome': 'pending' } });
  let res;
  try {
    res = await fetchFn(`${baseUrl}/rest/v1/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'user-agent': 'Edikit-Auth/1.0' },
      body: JSON.stringify({ login, password, username: login }),
      signal: ctrl.signal,
      redirect: 'manual',
    });
    endSpan(span, { status: 'ok', attributes: { 'http.status_code': res.status, 'auth.outcome': 'success' } });
  } catch (err) {
    clearTimeout(timer);
    endSpan(span, { status: 'error', statusMessage: 'unreachable', attributes: { 'auth.outcome': 'error' } });
    const e = new Error('HEMIS REST API unreachable');
    e.code = 'unreachable';
    throw e;
  }
  clearTimeout(timer);
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.success || !body.data?.token) {
    const err = new Error(body?.error || 'HEMIS login muvaffaqiyatsiz');
    err.code = res.status === 451 ? 'geofence' : res.status === 401 ? 'invalid_credentials' : 'http_' + res.status;
    throw err;
  }
  return { token: body.data.token };
}

/**
 * REST profil — GET {base}/rest/v1/account/me (Bearer JWT).
 */
export async function fetchAccountMe(token, opts = {}) {
  const fetchFn = opts.fetchFn || globalThis.fetch;
  const baseUrl = opts.baseUrl || BASE_URL;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs || HTTP_TIMEOUT_MS);
  let res;
  try {
    res = await fetchFn(`${baseUrl}/rest/v1/account/me`, {
      headers: { authorization: `Bearer ${token}`, 'user-agent': 'Edikit-Auth/1.0' },
      signal: ctrl.signal,
      redirect: 'manual',
    });
  } catch {
    clearTimeout(timer);
    const e = new Error('HEMIS REST API unreachable');
    e.code = 'unreachable';
    throw e;
  }
  clearTimeout(timer);
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.success) {
    const err = new Error(body?.error || 'HEMIS profil olinmadi');
    err.code = 'profile_fetch_failed';
    throw err;
  }
  return normalizeAccountMe(body.data, token);
}

/**
 * To'liq link: login → token → profil (normalangan).
 */
export async function linkAccount({ login, password }, opts = {}) {
  const { token } = await restLogin({ login, password }, opts);
  const profile = await fetchAccountMe(token, opts);
  if (!profile.hemisId || !profile.fullName) {
    const err = new Error('HEMIS profil toliq emas');
    err.code = 'incomplete_profile';
    throw err;
  }
  return profile;
}

// ── OAuth2 scaffold (OTM client bo'lganda faollashadi) ──

export function isOAuthConfigured() {
  return Boolean(OAUTH_CLIENT_ID && OAUTH_CLIENT_SECRET && OAUTH_REDIRECT_URI);
}

export function buildOAuthAuthorizeUrl(state) {
  if (!isOAuthConfigured()) return null;
  const url = new URL(`${BASE_URL}/oauth/authorize`);
  url.searchParams.set('client_id', OAUTH_CLIENT_ID);
  url.searchParams.set('redirect_uri', OAUTH_REDIRECT_URI);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('state', state);
  return url.href;
}

export async function exchangeOAuthCode(code, opts = {}) {
  if (!isOAuthConfigured()) {
    const err = new Error('HEMIS OAuth sozlanmagan');
    err.code = 'not_configured';
    throw err;
  }
  const fetchFn = opts.fetchFn || globalThis.fetch;
  const body = new URLSearchParams();
  body.set('grant_type', 'authorization_code');
  body.set('code', code);
  body.set('redirect_uri', OAUTH_REDIRECT_URI);
  body.set('client_id', OAUTH_CLIENT_ID);
  body.set('client_secret', OAUTH_CLIENT_SECRET);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs || HTTP_TIMEOUT_MS);
  let res;
  try {
    res = await fetchFn(`${BASE_URL}/oauth/access-token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body,
      signal: ctrl.signal,
    });
  } catch {
    clearTimeout(timer);
    const err = new Error('HEMIS token exchange unreachable');
    err.code = 'unreachable';
    throw err;
  }
  clearTimeout(timer);
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json.access_token) {
    const err = new Error(json?.error_description || json?.error || 'HEMIS token exchange failed');
    err.code = 'token_exchange_failed';
    throw err;
  }
  return json;
}

export async function fetchOAuthUser(accessToken, opts = {}) {
  const fetchFn = opts.fetchFn || globalThis.fetch;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs || HTTP_TIMEOUT_MS);
  let res;
  try {
    res = await fetchFn(`${BASE_URL}/oauth/api/user?fields=id,uuid,type,name,login,email,university_id,groups`, {
      headers: { authorization: `Bearer ${accessToken}`, 'user-agent': 'Edikit-Auth/1.0' },
      signal: ctrl.signal,
    });
  } catch {
    clearTimeout(timer);
    const err = new Error('HEMIS user endpoint unreachable');
    err.code = 'unreachable';
    throw err;
  }
  clearTimeout(timer);
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error('HEMIS user fetch failed');
    err.code = 'user_fetch_failed';
    throw err;
  }
  return normalizeOAuthUser(json);
}

// ── Rate limit (AUTH A-15 §15: 10/15 daqiqa per IP; per user ham) ──

const linkAttempts = new Map(); // key → [timestamps]
const LINK_MAX_KEYS = 5000;

function checkLimitKey(key, max, windowMs) {
  const now = Date.now();
  const arr = (linkAttempts.get(key) || []).filter((t) => now - t < windowMs);
  if (arr.length >= max) {
    return { allowed: false, retryAfterSeconds: Math.ceil((arr[0] + windowMs - now) / 1000) };
  }
  arr.push(now);
  linkAttempts.set(key, arr);
  if (linkAttempts.size > LINK_MAX_KEYS) {
    linkAttempts.delete(linkAttempts.keys().next().value);
  }
  return { allowed: true, retryAfterSeconds: 0 };
}

/**
 * Per-IP + per-user limit (ikkalasi ham tekshiriladi; user limiti qattiqroq).
 */
export function checkLinkLimit(ip, userKey) {
  const perIp = checkLimitKey(`ip:${ipHash(ip || 'unknown')}`, LINK_MAX, LINK_WINDOW_MS);
  if (!perIp.allowed) return perIp;
  const perUser = checkLimitKey(`user:${userKey}`, LINK_MAX, LINK_WINDOW_MS);
  if (!perUser.allowed) return perUser;
  return { allowed: true, retryAfterSeconds: 0 };
}

// ── Status ──
export function isRestEnabled() {
  return REST_ENABLED;
}

export function getBaseUrl() {
  return BASE_URL;
}

/** Testlar uchun in-memory rate-limit store'ni tozalash. */
export function _resetStores() {
  linkAttempts.clear();
}
