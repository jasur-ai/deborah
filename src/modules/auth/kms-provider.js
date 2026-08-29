/**
 * AUTH E-06 — Cloud KMS provider adapter (AWS KMS / UZ xususiy cloud)
 * -------------------------------------------------------------------
 * D-02 kms.js master key'ni env'dan oladi (MFA_ENCRYPTION_KEY/SESSION_SECRET
 * sha256). E-06: `KMS_KEY_ARN` + `KMS_ENCRYPTED_MASTER_KEY` (KMS bilan
 * shifrlangan 32-baytli master key, base64) bo'lsa — KMS Decrypt call.
 *
 * Dizayn:
 *   - **Lazy AWS import** — @aws-sdk/client-kms faqat KMS sozlangan bo'lsa
 *     yuklanadi (boot/test tez; webauthn lazy pattern).
 *   - **Cache + TTL (10 daqiqa)** — kms.js encrypt/decrypt SYNC API'sini
 *     buzmaslik uchun: KMS key prefetch qilinadi, in-memory cache'dan o'qiladi.
 *     `startKmsRefresher()` TTL tugashidan oldin yangilaydi (5 daqiqa interval).
 *   - **Fail-soft** — KMS down: `decryptMasterKey()` null qaytaradi, cache
 *     tozalanadi; kms.js eski (v1) env payload'larga tushadi, yangi yozuvlar
 *     v1 bilan yoziladi. KMS bilan shifrlangan (v2) payload'lar fail-closed
 *     (kalitsiz ochilmaydi — to'g'ri).
 *   - **Audit + metric** — har Decrypt: KMS_DECRYPT (latency), xato:
 *     KMS_DECRYPT_FAILED. Secret hech qachon log'da emas.
 *
 * Region: AWS'da UZ region yo'q — xususiy cloud (UZ) yoki yaqin region
 * (me-central-1 / eu-central-1). `KMS_REGION` env bilan override qilinadi.
 */

import crypto from 'crypto';
import { logAuthEvent, AUDIT_ACTIONS } from './audit.js';
import { recordMetric } from '../../telemetry/index.js';

const CACHE_TTL_MS = 10 * 60 * 1000; // 10 daqiqa
const REFRESH_INTERVAL_MS = 5 * 60 * 1000; // 5 daqiqa (TTL'dan oldin)

let cachedKey = null; // Buffer (32 bayt)
let cachedAt = 0;
let kmsClient = null; // real (lazy) yoki test injeksiyasi
let refresherTimer = null;

/** KMS sozlanganmi? (ARN + shifrlangan master key kerak) */
export function kmsConfigured() {
  return Boolean(process.env.KMS_KEY_ARN && process.env.KMS_ENCRYPTED_MASTER_KEY);
}

/** Sync cache o'qish — kms.js sync API uchun. TTL o'tgan/cache yo'q → null. */
export function getKmsKey() {
  if (!cachedKey || Date.now() - cachedAt >= CACHE_TTL_MS) return null;
  return cachedKey;
}

async function getClient() {
  if (kmsClient) return kmsClient;
  const { KMSClient } = await import('@aws-sdk/client-kms');
  kmsClient = new KMSClient({ region: process.env.KMS_REGION || 'eu-central-1' });
  return kmsClient;
}

/**
 * KMS'dan master key'ni ochadi (KMS_ENCRYPTED_MASTER_KEY → plaintext 32 bayt).
 * Natija cache'da (TTL). Muvaffaqiyatsiz → null (fail-soft) + audit.
 * @returns {Promise<Buffer|null>}
 */
export async function decryptMasterKey() {
  if (!kmsConfigured()) return null;
  if (cachedKey && Date.now() - cachedAt < CACHE_TTL_MS) return cachedKey;

  try {
    const { DecryptCommand } = await import('@aws-sdk/client-kms');
    const client = await getClient();
    const t0 = Date.now();
    const res = await client.send(new DecryptCommand({
      KeyId: process.env.KMS_KEY_ARN,
      CiphertextBlob: Buffer.from(process.env.KMS_ENCRYPTED_MASTER_KEY, 'base64'),
    }));
    const latencyMs = Date.now() - t0;
    const plain = res?.Plaintext;
    if (!plain || plain.length !== 32) {
      // noto'g'ri key uzunligi — cache'ni tozalab audit
      cachedKey = null;
      cachedAt = 0;
      logAuthEvent({
        action: AUDIT_ACTIONS.KMS_DECRYPT_FAILED || 'kms:decrypt:failed',
        outcome: 'failed',
        method: 'kms',
        actorId: 'system',
        details: { reason: 'invalid_key_length', latencyMs },
      }).catch(() => {});
      return null;
    }
    cachedKey = Buffer.from(plain);
    cachedAt = Date.now();
    logAuthEvent({
      action: AUDIT_ACTIONS.KMS_DECRYPT || 'kms:decrypt',
      outcome: 'success',
      method: 'kms',
      actorId: 'system',
      details: { latencyMs },
    }).catch(() => {});
    try {
      recordMetric('kms.decrypt', 1, { type: 'counter' });
      recordMetric('kms.decrypt_latency', latencyMs, { type: 'histogram', unit: 'ms' });
    } catch (_) { /* telemetry fail-soft */ }
    return cachedKey;
  } catch (err) {
    // KMS down / xato — fail-soft: cache tozalanadi, eski env payload'lar
    // kms.js'da v1 bilan ishlashda davom etadi.
    cachedKey = null;
    cachedAt = 0;
    logAuthEvent({
      action: AUDIT_ACTIONS.KMS_DECRYPT_FAILED || 'kms:decrypt:failed',
      outcome: 'failed',
      method: 'kms',
      actorId: 'system',
      details: { reason: String(err?.name || err?.message || 'kms_error').slice(0, 80) },
    }).catch(() => {});
    try { recordMetric('kms.decrypt_failed', 1, { type: 'counter' }); } catch (_) {}
    return null;
  }
}

/** Cache'ni majburiy yangilash (boot / rotation oldidan). */
export const refreshKmsKey = decryptMasterKey;

/**
 * Davriy yangilovchi — TTL tugashidan oldin key'ni warm saqlaydi.
 * @returns {() => void} stop funksiyasi
 */
export function startKmsRefresher() {
  if (refresherTimer) clearInterval(refresherTimer);
  refresherTimer = setInterval(() => {
    decryptMasterKey().catch(() => {});
  }, REFRESH_INTERVAL_MS);
  if (refresherTimer.unref) refresherTimer.unref();
  return () => {
    if (refresherTimer) { clearInterval(refresherTimer); refresherTimer = null; }
  };
}

/** Testlar uchun. */
export function resetKmsCache() {
  cachedKey = null;
  cachedAt = 0;
}

/** Testlar uchun: prefetch simulyatsiyasi — key'ni to'g'ridan-to'g'ri cache'ga yozish. */
export function _seedKmsKeyForTests(keyBuffer) {
  cachedKey = Buffer.isBuffer(keyBuffer) ? keyBuffer : Buffer.from(keyBuffer);
  cachedAt = Date.now();
  return cachedKey;
}
export function _setKmsClient(client) {
  kmsClient = client;
}
export function _setEnv(raw) {
  // deterministik test ciphertext yaratish uchun env o'rnatish
  process.env.KMS_KEY_ARN = raw.arn;
  process.env.KMS_ENCRYPTED_MASTER_KEY = raw.wrapped;
  if (raw.region) process.env.KMS_REGION = raw.region;
}
export { CACHE_TTL_MS };

// ── Test yordamchisi: KMS bilan shifrlangan 32-bayt key yaratadi (AES-GCM) ──
// Haqiqiy KMS'ni simulyatsiya qiladi: `wrapped` = AES-256-GCM bilan shifrlangan
// key (test master), `unwrap` mock client'da Plaintext qaytaradi.
export function _makeTestWrappedKey(rawMasterKey) {
  const key = crypto.createHash('sha256').update(String(rawMasterKey)).digest();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(key), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString('base64');
}
export function _unwrapTestWrappedKey(wrappedB64, rawMasterKey) {
  const key = crypto.createHash('sha256').update(String(rawMasterKey)).digest();
  const buf = Buffer.from(wrappedB64, 'base64');
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const enc = buf.subarray(28);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(enc), decipher.final()]);
}
