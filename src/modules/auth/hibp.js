/**
 * AUTH A-22 — HIBP Pwned Passwords integrasiyasi (k-anonymity)
 *
 * Parol plaintext API'ga YUBORILMAYDI:
 *   SHA-1(password) → 5-belgi prefix → api.pwnedpasswords.com/range/{prefix}
 *   → javobda to'liq hash suffix'lar ro'yxati → o'zimiznikini solishtiramiz.
 *
 * Offline fallback: API ishlamasa — fail-open (signup davom etadi, log yoziladi).
 * Test rejimida tarmoqqa chiqmaydi (NODE_ENV=test → skip, fail-open).
 */

import crypto from 'crypto';
import CONFIG from '../../../src/config/env.js';

// D-01: endpoint env'dan (default rasmiy API). Test'da tarmoqqa chiqmaydi —
// NODE_ENV=test → skip, fail-open (quyida tekshiriladi).
const HIBP_API = CONFIG.HIBP_API_URL || 'https://api.pwnedpasswords.com/range/';
const HIBP_TIMEOUT_MS = 4000;

// AUTH A-22 review: k-anonymity prefix cache — 5-hex prefix bo'yicha javob
// in-memory'da saqlanadi (bir xil prefix'ni ko'p userlar bo'lishadi, shuning
// uchun samaradorlik yuqori). HIBP ma'lumotlari tez-tez o'zgarmaydi — 1 soat TTL.
const CACHE_TTL_MS = 60 * 60 * 1000;
const cache = new Map(); // prefix -> { suffixSet: Set<string>, at: number }

function cacheGet(prefix) {
  const hit = cache.get(prefix);
  if (!hit) return null;
  if (Date.now() - hit.at > CACHE_TTL_MS) {
    cache.delete(prefix);
    return null;
  }
  return hit.suffixSet;
}

function cacheSet(prefix, suffixSet) {
  // DoS himoyasi: cache cheksiz o'smasin
  if (cache.size >= 2000) cache.clear();
  cache.set(prefix, { suffixSet, at: Date.now() });
}

/** Test'lar orasida cache'ni tozalash (global Map test izolyatsiyasi). */
export function _hibpCacheResetForTests() {
  cache.clear();
}

export function sha1Hex(input) {
  return crypto.createHash('sha1').update(input).digest('hex').toUpperCase();
}

/**
 * @param {string} password
 * @param {{fetchImpl?: typeof fetch}} [deps] — test'da mock uchun.
 * @returns {Promise<{breached: boolean, checked: boolean, error?: string}>}
 *   breached — parol breach ro'yxatida.
 *   checked — HIBP'ga muvaffaqiyatli murojaat qilindi (offline bo'lsa false).
 */
export async function isPasswordBreached(password, deps = {}) {
  if (!password || typeof password !== 'string') {
    return { breached: false, checked: false, error: 'no-password' };
  }
  return isSha1Breached(sha1Hex(password), deps);
}

/**
 * B-27: inline HIBP check — client parolni EMAS, SHA-1 hash'ini yuboradi.
 * (Parol network trace'da bo'lmasin — B-27 §14; hash qaytarilmas — hash.
 *  k-anonymity: server ham faqat 5-belgi prefix'ni HIBP'ga yuboradi.)
 *
 * @param {string} sha1 — katta harfli 40-belgi SHA-1 hex.
 * @param {{fetchImpl?: typeof fetch}} [deps]
 * @returns {Promise<{breached: boolean, checked: boolean, error?: string}>}
 */
export async function isSha1Breached(sha1, deps = {}) {
  const { fetchImpl = globalThis.fetch } = deps;
  if (!sha1 || typeof sha1 !== 'string' || !/^[0-9A-F]{40}$/i.test(sha1)) {
    return { breached: false, checked: false, error: 'no-sha1' };
  }
  sha1 = sha1.toUpperCase();

  // Test rejimi: tarmoqqa chiqmaymiz — fail-open (registratsiya buzilmaydi).
  if (process.env.NODE_ENV === 'test') {
    return { breached: false, checked: false, error: 'test-mode-skip' };
  }

  const prefix = sha1.slice(0, 5); // k-anonymity: faqat prefix yuboriladi
  const suffix = sha1.slice(5);

  try {
    // Cache hit — tarmoqqa chiqmaymiz
    const cached = cacheGet(prefix);
    if (cached) {
      return { breached: cached.has(suffix), checked: true, cached: true };
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), HIBP_TIMEOUT_MS);
    const res = await fetchImpl(`${HIBP_API}${prefix}`, {
      headers: { 'Add-Padding': 'true' },
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (!res.ok) {
      // Fail-open: API xatosi signup'ni buzmasin
      console.warn(`[hibp] API error ${res.status}, fail-open`);
      return { breached: false, checked: false, error: `http-${res.status}` };
    }
    const body = await res.text();
    const suffixSet = new Set(
      body.split(/\r?\n/)
        .map((line) => line.split(':')[0])
        .filter(Boolean)
        .map((s) => s.toUpperCase()),
    );
    cacheSet(prefix, suffixSet);
    return { breached: suffixSet.has(suffix), checked: true };
  } catch (err) {
    // Offline fallback — fail-open (NIST: signup davom etadi, log yoziladi)
    console.warn(`[hibp] check failed, fail-open: ${err?.message || err}`);
    return { breached: false, checked: false, error: 'offline' };
  }
}
