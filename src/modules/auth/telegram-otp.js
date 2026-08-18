/**
 * Edikit — Telegram OTP Auth Core (AUTH A-16, P3)
 * -------------------------------------------------
 * UzExam pattern — xavfsiz versiya:
 *   1. start: 20-byte start-token (t.me/EdikitBot?start=<token>) + 6-xonali kod.
 *      Kod HASH'lab saqlanadi (sha256(code:salt)), log'ga hech qachon chiqmaydi.
 *   2. Bot callback: HMAC-SHA256 (bot_token bilan) — signature verify.
 *   3. verify: kod bitta foydalanish (consume) + 5 daqiqa TTL.
 *
 * STORAGE:
 *   - telegram_auth/{hashOtp(code,'')} → record (lookup O(1); key'ning o'zi
 *     deterministik kod-hash — external enumeratsiya mumkin emas, chunki
 *     faqat rate-limited API orqali so'raladi)
 *   - telegram_auth_tokens/{sha256(token)} → lookupKey (callback uchun)
 *   - users_telegram_index/{telegramId} → userKey (UNIQUE mapping)
 *   - users/{userKey}/telegram → { telegramId, linkedAt }
 *
 * SECURITY:
 *   - Kod plaintext saqlanmaydi; single-use (withLock + re-read + used flag);
 *     timing-safe taqqoslash; hijack guard (callback id ≠ verify id → 409).
 *   - Rate limit: start 5/15, verify 5/15 (per-IP + per-phone).
 *   - Step-up qoidasi (§11): telegram_id o'zi identity EMAS — high-stakes
 *     (summative/admin) uchun qo'shimcha phone/JSHSHIR talab qilinadi
 *     (resurs darajasida; hujjatda qayd etiladi).
 */

import crypto from 'crypto';
import { fb } from '../../../firebase/admin.js';
import CONFIG from '../../config/env.js';
import { safeKey } from '../../../utils/helpers.js';
import { ipHash } from './audit.js';

// ── Config ──
const BOT_TOKEN = CONFIG.TELEGRAM_BOT_TOKEN || '';
const BOT_USERNAME = CONFIG.TELEGRAM_BOT_USERNAME || '';
const ENABLED = CONFIG.TELEGRAM_ENABLED !== false && Boolean(BOT_TOKEN);

const START_MAX = CONFIG.TELEGRAM_START_MAX || 5;
const VERIFY_MAX = CONFIG.TELEGRAM_VERIFY_MAX || 5;
const WINDOW_MS = CONFIG.TELEGRAM_WINDOW_MS || 15 * 60 * 1000;

const START_TTL_MS = 5 * 60 * 1000; // 5 daqiqa (token + kod)

// ── Rate limit store ──
const startAttempts = new Map();
const verifyAttempts = new Map();
const RATE_MAX_KEYS = 5000;

function bump(map, key, max, windowMs) {
  const now = Date.now();
  const arr = (map.get(key) || []).filter((t) => now - t < windowMs);
  if (arr.length >= max) {
    return { allowed: false, retryAfterSeconds: Math.ceil((arr[0] + windowMs - now) / 1000) };
  }
  arr.push(now);
  map.set(key, arr);
  if (map.size > RATE_MAX_KEYS) map.delete(map.keys().next().value);
  return { allowed: true, retryAfterSeconds: 0 };
}

/** start: per-IP + per-phone (5/15 daqiqa). */
export function checkStartLimit(ip, phone) {
  const perIp = bump(startAttempts, `ip:${ipHash(ip || 'unknown')}`, START_MAX, WINDOW_MS);
  if (!perIp.allowed) return perIp;
  return bump(startAttempts, `phone:${phone || 'unknown'}`, START_MAX, WINDOW_MS);
}

/** verify: per-IP + per-phone (5/15 daqiqa). */
export function checkVerifyLimit(ip, phone) {
  const perIp = bump(verifyAttempts, `ip:${ipHash(ip || 'unknown')}`, VERIFY_MAX, WINDOW_MS);
  if (!perIp.allowed) return perIp;
  return bump(verifyAttempts, `phone:${phone || 'unknown'}`, VERIFY_MAX, WINDOW_MS);
}

// ── Per-key async lock (single-use consume atomik) ──
const locks = new Map();
function withLock(key, fn) {
  const prev = locks.get(key) || Promise.resolve();
  const next = prev.then(fn, fn);
  locks.set(key, next);
  const cleanup = () => {
    if (locks.get(key) === next) locks.delete(key);
  };
  next.then(cleanup, cleanup);
  return next;
}

// ── Helpers ──
export function isTelegramEnabled() {
  return ENABLED;
}

export function getBotUsername() {
  return BOT_USERNAME;
}

export function hashValue(v) {
  return crypto.createHash('sha256').update(String(v)).digest('hex');
}

/** 6-xonali kod — crypto.randomInt (predictable emas). */
export function generateOtp() {
  return crypto.randomInt(0, 1_000_000).toString().padStart(6, '0');
}

/** Kod hash (saqlash uchun): sha256(code:salt). */
export function hashOtp(code, salt) {
  return crypto.createHash('sha256').update(`${String(code)}:${String(salt)}`).digest('hex');
}

/** Timing-safe taqqoslash. */
export function timingSafeEqual(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ba.length !== bb.length) {
    crypto.timingSafeEqual(Buffer.alloc(ba.length), Buffer.alloc(ba.length));
    return false;
  }
  return crypto.timingSafeEqual(ba, bb);
}

/**
 * Bot callback imzosini tekshirish — HMAC-SHA256 (bot_token bilan).
 * payload: "start_token=<t>&id=<n>&auth_date=<ts>" canonical string.
 */
export function verifyCallbackSignature({ payload, signature, secret }) {
  if (!secret) return false;
  try {
    const expected = crypto
      .createHmac('sha256', String(secret))
      .update(String(payload))
      .digest('hex');
    return timingSafeEqual(expected, String(signature || ''));
  } catch {
    return false;
  }
}

/**
 * Start auth yaratish.
 * @returns {Promise<{ code: string, previewLink: string, lookupKey: string }>}
 *  - token (20B) → t.me/{bot}?start=<token> havolasida
 *  - code (6-xonali) → hash'lab saqlanadi; dev/test'da preview (production'da
 *    SMS/email orqali yuboriladi — sender infra P2, new-device pattern'da).
 */
export async function createStart({ phone, userKey = null }) {
  const token = crypto.randomBytes(20).toString('base64url'); // 20B random
  const salt = crypto.randomBytes(8).toString('hex');
  // Kod collision guard: lookupKey = deterministik kod-hash (1M keyspace).
  // Birthday collision'da ikkinchi start birinchi record'ni ustiga yozib
  // qo'ymasligi uchun — band/ishlatilmagan kalitga qayta kod generatsiya.
  let code = generateOtp();
  let lookupKey = hashOtp(code, '');
  for (let attempt = 0; attempt < 8; attempt++) {
    const existing = await fb.get(`telegram_auth/${lookupKey}`);
    if (!existing.exists()) break;
    const rec = existing.val();
    // Eski/ishlatilgan record ustiga yozish xavfsiz — faqat TIRIK (active)
    // record bilan to'qnashuv bo'lsa yangi kod olamiz.
    if (!rec || rec.used || (rec.expiresAt && rec.expiresAt < Date.now())) break;
    code = generateOtp();
    lookupKey = hashOtp(code, '');
  }
  const record = {
    phone: String(phone || ''),
    tokenHash: hashValue(token),
    codeHash: hashOtp(code, salt), // "hash saqlash" — plaintext yo'q
    salt,
    telegramId: null,
    userKey,
    expiresAt: Date.now() + START_TTL_MS,
    used: false,
    createdAt: Date.now(),
  };
  await fb.set(`telegram_auth/${lookupKey}`, record);
  await fb.set(`telegram_auth_tokens/${record.tokenHash}`, lookupKey); // callback indeksi
  const previewLink = BOT_USERNAME ? `https://t.me/${BOT_USERNAME}?start=${token}` : `start=${token}`;
  return { code, previewLink, lookupKey };
}

/**
 * Bot callback: start-token bo'yicha record topib telegramId biriktirish.
 */
export async function attachTelegramId({ token, telegramId }) {
  const tokenHash = hashValue(String(token || ''));
  const linkSnap = await fb.get(`telegram_auth_tokens/${tokenHash}`);
  if (!linkSnap.exists()) return { ok: false, error: 'unknown_start_token' };
  const lookupKey = linkSnap.val();
  const recSnap = await fb.get(`telegram_auth/${lookupKey}`);
  if (!recSnap.exists()) return { ok: false, error: 'unknown_start_token' };
  const rec = recSnap.val();
  if (rec.used) return { ok: false, error: 'already_used' };
  if (rec.expiresAt && rec.expiresAt < Date.now()) return { ok: false, error: 'expired' };
  await fb.update(`telegram_auth/${lookupKey}`, { telegramId: String(telegramId) });
  return { ok: true, lookupKey };
}

/**
 * Verify: kod bo'yicha record topish + single-use consume (lock ichida).
 * @returns {Promise<{ ok: boolean, record?: object, error?: string, httpStatus?: number }>}
 */
export async function consumeByCode({ code, telegramId, phone = null }) {
  if (!code || !/^\d{6}$/.test(String(code))) {
    return { ok: false, error: 'invalid_code_format', httpStatus: 400 };
  }
  let lookupKey = hashOtp(String(code), '');
  const recSnap = await fb.get(`telegram_auth/${lookupKey}`);
  if (!recSnap.exists()) return { ok: false, error: 'invalid_code', httpStatus: 401 };

  return withLock(`consume:${lookupKey}`, async () => {
    const cur = await fb.get(`telegram_auth/${lookupKey}`);
    if (!cur.exists()) return { ok: false, error: 'invalid_code', httpStatus: 401 };
    const rec = cur.val();
    if (rec.used) return { ok: false, error: 'already_used', httpStatus: 410 };
    if (rec.expiresAt && rec.expiresAt < Date.now()) {
      return { ok: false, error: 'expired', httpStatus: 410 };
    }
    // Phone guard: start'dagi phone verify'dagi bilan mos — boshqa phone
    // kodni ishlata olmaydi (kod o'g'irlansa ham keraksiz bo'ladi).
    if (phone && rec.phone && String(phone) !== rec.phone) {
      return { ok: false, error: 'phone_mismatch', httpStatus: 409 };
    }
    // Hijack guard: callback telegram_id kelsa, verify'dagi bilan mos shart
    if (rec.telegramId && telegramId && rec.telegramId !== String(telegramId)) {
      return { ok: false, error: 'telegram_mismatch', httpStatus: 409 };
    }
    await fb.update(`telegram_auth/${lookupKey}`, { used: true });
    return { ok: true, record: { ...rec, used: true, lookupKey } };
  });
}

/**
 * users_telegram_index yozish + user mapping (UNIQUE).
 */
export async function linkTelegram(userKey, telegramId) {
  if (!userKey || !telegramId) return { ok: false, error: 'missing_fields', httpStatus: 400 };
  const key = safeKey(String(telegramId));
  return withLock(`link:${key}`, async () => {
    const existing = await fb.get(`users_telegram_index/${key}`);
    if (existing.exists() && existing.val() !== userKey) {
      return { ok: false, error: 'telegram_already_linked', httpStatus: 409 };
    }
    await fb.update(`users/${userKey}/telegram`, {
      telegramId: String(telegramId),
      linkedAt: Date.now(),
    });
    await fb.set(`users_telegram_index/${key}`, userKey);
    return { ok: true };
  });
}

export async function unlinkTelegram(userKey) {
  const snap = await fb.get(`users/${userKey}/telegram`);
  if (!snap.exists()) return { ok: true, removed: false };
  const { telegramId } = snap.val();
  await fb.remove(`users_telegram_index/${safeKey(telegramId)}`);
  await fb.remove(`users/${userKey}/telegram`);
  return { ok: true, removed: true, telegramId };
}

/** Telegram config status (UI/health uchun). */
export function getTelegramStatus() {
  return {
    enabled: ENABLED,
    botUsername: BOT_USERNAME || null,
    hasBotToken: Boolean(BOT_TOKEN),
  };
}
