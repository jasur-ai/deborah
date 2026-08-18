/**
 * Edikit — Remember-me selector/verifier (AUTH A-25 §07)
 *
 * OWASP "remember me" pattern:
 *   - **selector** (random 16B hex) — cookie'da ochiq; DB'dagi yozuvni topish uchun.
 *   - **verifier** (random 32B hex) — cookie'da; DB'da FAQAT sha256 hash saqlanadi
 *     (bazadan sizsa ham token qalbakilashtirib bo'lmaydi).
 *   - DB: `remember_tokens/{selector}` = { userId, verifierHash, deviceHash,
 *     createdAt, lastUsedAt, revoked } — 30 kun TTL.
 *   - **Har ishlatishda rotate** — eski verifier revoke, yangi juftlik beriladi
 *     (hijack/replay window kichrayadi).
 *   - **Device-bound** — UA+IP hash; boshqa qurilmadan restore urinishi → revoke.
 *
 * Xavfsizlik: verifier taqqoslash timing-safe (crypto.timingSafeEqual);
 * selector index'da safeKey kerak emas (hex — faqat [0-9a-f]).
 */
import crypto from 'crypto';
import cookie from 'cookie';
import { fb } from '../../../firebase/admin.js';
import { REMEMBER_TTL_MS } from './session-store.js';

const REMEMBER_TOKEN_PATH = 'remember_tokens';

/** sha256 hex. */
export function sha256hex(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

/**
 * Qurilma hash (UA + IP) — device-bound tekshiruv uchun (PII saqlanmaydi).
 * @param {string|undefined} ua
 * @param {string|undefined} ip
 * @returns {string} 32 belgili hex
 */
export function deviceHash(ua, ip) {
  return sha256hex(`${String(ua || '')}|${String(ip || '')}`).slice(0, 32);
}

/** Yangi selector (16B) + verifier (32B) juftligi. */
export function createRememberPair() {
  return {
    selector: crypto.randomBytes(16).toString('hex'),
    verifier: crypto.randomBytes(32).toString('hex'),
  };
}

/** Verifier hash (DB'da saqlanadi — plaintext YO'Q). */
export function hashVerifier(verifier) {
  return sha256hex(verifier);
}

/**
 * Cookie qiymatini parse qiladi: `selector:verifier` (44B+65B).
 * Format noto'g'ri bo'lsa null (hujum urinishi — rad).
 */
export function parseRememberCookie(value) {
  if (typeof value !== 'string') return null;
  const idx = value.indexOf(':');
  if (idx <= 0) return null;
  const selector = value.slice(0, idx);
  const verifier = value.slice(idx + 1);
  if (!/^[0-9a-f]{32}$/.test(selector)) return null;
  if (!/^[0-9a-f]{64}$/.test(verifier)) return null;
  return { selector, verifier };
}

/** Cookie qiymati: `selector:verifier`. */
export function serializeRememberCookie(pair) {
  return `${pair.selector}:${pair.verifier}`;
}

/**
 * `req.headers.cookie` string'ini object'ga aylantiradi. RFC 6265 to'liq
 * parse uchun `cookie` paketi ishlatiladi (quoted values, percent-encoding,
 * escaped chars, multiple same-name cookies — qo'lda yozilgan parser'ga
 * nisbatan xavfsizroq; A-25 review fix).
 * @param {string|undefined} header
 * @returns {Record<string, string>}
 */
export function parseCookies(header) {
  if (typeof header !== 'string' || !header) return {};
  return cookie.parse(header);
}

/** Timing-safe string taqqoslash. */
function safeEqual(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

/** Yangi token DB'ga yoziladi (ikkilamchi yozuv avtomatik almashtiradi). */
export async function saveRememberToken({ userId, selector, verifierHash, deviceHash: dh }) {
  const record = {
    userId,
    verifierHash,
    deviceHash: dh,
    createdAt: Date.now(),
    lastUsedAt: Date.now(),
    revoked: false,
  };
  await fb.set(`${REMEMBER_TOKEN_PATH}/${selector}`, record);
  return record;
}

/** Selector bo'yicha DB yozuvini o'qiydi. */
export async function findRememberToken(selector) {
  if (typeof selector !== 'string' || !/^[0-9a-f]{32}$/.test(selector)) return null;
  const snap = await fb.get(`${REMEMBER_TOKEN_PATH}/${selector}`);
  if (!snap.exists()) return null;
  return snap.val();
}

/** Eski token'ni revoke qiladi (rotation/replay/teft). */
export async function revokeRememberToken(selector) {
  if (typeof selector !== 'string' || !/^[0-9a-f]{32}$/.test(selector)) return;
  try {
    await fb.set(`${REMEMBER_TOKEN_PATH}/${selector}/revoked`, true);
  } catch (_) { /* non-critical */ }
}

/**
 * Restore urinishini tekshiradi (AUTH A-25 §07):
 *  - token mavjud va revoked emas
 *  - verifier hash mos (timing-safe) — mos bo'lmasa revoke (replay hujumi)
 *  - device hash mos — mos bo'lmasa revoke (token o'g'irlangan bo'lishi mumkin)
 *  - 30 kun yoshida
 * Muvaffaqiyatda: rotate → yangi juftlik, eski revoke.
 *
 * @returns {Promise<{userId: string, newPair: {selector, verifier}}|null>}
 */
export async function restoreRememberToken({ selector, verifier, deviceHash: dh }) {
  const record = await findRememberToken(selector);
  if (!record || record.revoked) return null;
  if (!safeEqual(record.verifierHash, hashVerifier(verifier))) {
    await revokeRememberToken(selector); // replay/teft — zanjir uziladi
    return null;
  }
  if (record.deviceHash && dh && record.deviceHash !== dh) {
    await revokeRememberToken(selector); // boshqa qurilma — o'g'irlik ehtimoli
    return null;
  }
  const age = Date.now() - (record.createdAt || 0);
  if (age > REMEMBER_TTL_MS) {
    await revokeRememberToken(selector);
    return null;
  }
  // Rotation: yangi juftlik, eski revoke
  const newPair = createRememberPair();
  await saveRememberToken({
    userId: record.userId,
    selector: newPair.selector,
    verifierHash: hashVerifier(newPair.verifier),
    deviceHash: record.deviceHash,
  });
  await revokeRememberToken(selector);
  return { userId: record.userId, newPair };
}
