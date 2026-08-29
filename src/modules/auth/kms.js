/**
 * AUTH D-02 — Secrets management (KMS abstraction)
 * -------------------------------------------------------------------
 * Local/provider-agnostic KMS: AES-256-GCM, per-record 96-bit IV, key
 * versioning. Production'da master key KMS'da (KMS_KEY_ARN), local/dev'da
 * env'dan (MFA_ENCRYPTION_KEY yoki SESSION_SECRET sha256). Xuddi shu
 * interfeys cloud KMS'ga (AWS KMS / UZ private cloud) o'zgartirilishi mumkin
 * — D-32 provider pattern.
 *
 * Payload format: `v{version}:{iv}:{tag}:{ciphertext}` (base64url).
 *   - version — qaysi key bilan shifrlangan (rotation uchun)
 *   - iv — per-record 96-bit (takrorlanishi mumkin emas)
 *   - tag — GCM auth tag (integrity + tamper detection)
 *
 * Rotation: `rotateMasterKey()` yangi version yaratadi; `reEncryptField()`
 * eski version bilan decrypt → yangisi bilan encrypt (atomic, downtime yo'q).
 * Eski version'lar `activeVersion` dan boshqa bo'lsa ham decrypt uchun
 * `keyVersions` map'ida saqlanadi (downgrade qarshi: faqat ma'lum eski
 * version'lar).
 *
 * Security guard: secret hech qachon log/trace/error'da — audit'da faqat
 * user_hash + key_scope (secret qiymat emas).
 */
import crypto from 'crypto';
import CONFIG from '../../config/env.js';
// AUTH E-06: cloud KMS adapter — KMS_KEY_ARN bo'lsa v2 kalit KMS'dan (sync cache)
import { kmsConfigured, getKmsKey, resetKmsCache } from './kms-provider.js';

// ── Audit (dinamik import — kms moduli yengil bo'lishi uchun) ──
async function auditEvent(event, details = {}) {
  try {
    const { logAuthEvent, AUDIT_ACTIONS } = await import('./audit.js');
    await logAuthEvent({ action: AUDIT_ACTIONS[event], outcome: 'success', ...details });
  } catch { /* audit muhim emas — secret oqib chiqmasin */ }
}

/** Joriy key version (rotation hisoblagichi). */
export const CURRENT_KEY_VERSION = 2;

/** Ruxsat etilgan (downgrade qarshi) key version'lar. */
const ALLOWED_VERSIONS = new Set([1, 2]);

/**
 * Aktiv version: KMS sozlangan + key cache'da → 2 (KMS), aks holda 1 (env).
 * Fail-soft: KMS down bo'lsa yangi yozuvlar v1 (env) bilan yoziladi —
 * hech narsa buzilmaydi; eski v1 payload'lar ochilishda davom etadi.
 */
export function activeKeyVersion() {
  return kmsConfigured() && getKmsKey() ? 2 : 1;
}

/**
 * Legacy (A-26) key derivation: `sha256(raw)` — version prefix'siz.
 * Eski saqlangan payload'lar (v1: 3-qismli format) shu bilan ochiladi.
 */
function legacyKey() {
  const raw = CONFIG.MFA_ENCRYPTION_KEY || CONFIG.SESSION_SECRET;
  return crypto.createHash('sha256').update(String(raw)).digest();
}

/** Master key derivation — KMS_KEY_ARN bo'lsa cloud (E-06), aks holda env. */
function masterKey(version = CURRENT_KEY_VERSION) {
  if (!ALLOWED_VERSIONS.has(version)) return null;
  if (version === 2) {
    // E-06: v2 = KMS kaliti (prefetch qilingan, sync cache). Cache yo'q/expired
    // → null (fail-closed: KMS kalitsiz v2 ochilmaydi — to'g'ri).
    return getKmsKey();
  }
  // v1: env master key yoki SESSION_SECRET sha256 (dev/test + fail-soft fallback).
  const raw = CONFIG.MFA_ENCRYPTION_KEY || CONFIG.SESSION_SECRET;
  return crypto.createHash('sha256').update(`${version}:${String(raw)}`).digest();
}

/**
 * AES-256-GCM encrypt → `v{ver}:{iv}:{tag}:{ct}` (base64url).
 * Har yozuv uchun yangi 96-bit IV — bir xil plaintext turli ciphertext.
 */
export function encryptSecret(plaintext, scope = 'generic') {
  const iv = crypto.randomBytes(12);
  const ver = activeKeyVersion();
  const key = masterKey(ver);
  if (!key) return null; // kalitsiz yozib bo'lmaydi (fail-closed)
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ['v' + ver, iv, tag, enc].map((b) => Buffer.isBuffer(b) ? b.toString('base64url') : b).join(':');
}

/**
 * Decrypt — eski version bilan ham ishlaydi (rotation davomida), lekin faqat
 * ALLOWED_VERSIONS ichida (downgrade qarshi). Xato → null.
 */
export function decryptSecret(payload, scope = 'generic') {
  if (typeof payload !== 'string') return null;
  // E-06: KMS kaliti cache TTL'da — kms-provider refresher warm saqlaydi;
  const parts = payload.split(':');
  // E-06: KMS kaliti cache TTL'da — kms-provider refresher warm saqlaydi;
  // decrypt paytida cache expired bo'lsa sync qilib ololmaymiz. Faqat v2
  // payload'larda audit (v1 env payload cache'siz ham ochiladi — audit shovqini yo'q).
  const isV2Payload = parts.length === 4 && parts[0] === 'v2';
  if (isV2Payload && kmsConfigured() && !getKmsKey()) {
    auditEvent('SECRET_DECRYPT_FAILED', {
      keyScope: scope,
      details: { reason: 'kms_cache_expired', version: 'v2' },
    }).catch(() => {});
  }

  // Legacy (A-26) format: `iv:tag:ct` (3 qism, version'siz) — eski saqlangan
  // TOTP/secret'lar bilan backward-compat.
  if (parts.length === 3) {
    try {
      const [ivB64, tagB64, ctB64] = parts;
      const decipher = crypto.createDecipheriv('aes-256-gcm', legacyKey(), Buffer.from(ivB64, 'base64url'));
      decipher.setAuthTag(Buffer.from(tagB64, 'base64url'));
      return Buffer.concat([decipher.update(Buffer.from(ctB64, 'base64url')), decipher.final()]).toString('utf8');
    } catch {
      auditEvent('SECRET_DECRYPT_FAILED', { keyScope: scope, details: { reason: 'legacy_auth_failed' } }).catch(() => {});
      return null;
    }
  }

  // Versioned (D-02) format: `v{ver}:{iv}:{tag}:{ct}` (4 qism)
  if (parts.length !== 4) return null;
  const [verStr, ivB64, tagB64, ctB64] = parts;
  const version = Number(verStr.slice(1));
  if (!Number.isInteger(version)) return null;
  const key = masterKey(version);
  if (!key) return null; // noma'lum/eski version → decrypt qilinmaydi
  try {
    const iv = Buffer.from(ivB64, 'base64url');
    const tag = Buffer.from(tagB64, 'base64url');
    const data = Buffer.from(ctB64, 'base64url');
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    const out = Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
    return out;
  } catch {
    auditEvent('SECRET_DECRYPT_FAILED', {
      keyScope: scope,
      actorId: null,
      details: { reason: 'auth_tag_failed' },
    }).catch(() => {});
    return null;
  }
}

/**
 * Re-encrypt (rotation): eski version bilan decrypt → yangi bilan encrypt.
 * Atomic emas (ikki step), lekin har step mustaqil muvaffaqiyatli — agar
 * ikkinchisi failsa, eski payload o'zgarishsiz qoladi (caller qayta urinadi).
 * @returns {string|null} yangi payload yoki decrypt failsa null
 */
export function reEncryptSecret(payload, scope = 'generic') {
  const plain = decryptSecret(payload, scope);
  if (plain === null) return null;
  return encryptSecret(plain, scope);
}

/**
 * Master key rotatsiyasi. D-02 §09: har 90 kun. Yangi version'ni aktiv qilish
 * ALTERNATIV: bu yerda version'lar deterministik (env key o'zgarishi bilan).
 * Operator MFA_ENCRYPTION_KEY'ni yangilaganda — eski version 1 bilan decrypt
 * ishlamaydi (key 2 bilan yangi hash). Shuning uchun rotation rejasi:
 *   1) Yangi MFA_ENCRYPTION_KEY set qilinadi (faqat yangi yozuvlar uchun)
 *   2) `rotateMasterKey()` barcha foydalanuvchi secret'larini re-encrypt qiladi
 *   3) Eski key arxivlanadi
 * Bu funksiya re-encrypt batch uchun yangi version raqamini qaytaradi.
 */
export async function rotateMasterKey(store, listKeysFn, decryptFn, encryptFn, scope) {
  const rotated = [];
  const failed = [];
  const keys = await listKeysFn();
  for (const key of keys) {
    try {
      const enc = await store.get(key);
      if (!enc || typeof enc !== 'string') continue;
      const re = reEncryptSecret(enc, scope);
      if (re === null) { failed.push(key); continue; }
      await store.set(key, re);
      rotated.push(key);
    } catch { failed.push(key); }
  }
  await auditEvent('SECRET_ROTATED', {
    actorId: 'system',
    details: { keyScope: scope, rotated: rotated.length, failed: failed.length },
  }).catch(() => {});
  return { rotated: rotated.length, failed: failed.length };
}

/** Unit test'lar uchun: deterministik test key bilan qayta qurish. */
export function _setMasterKeyForTests(raw) {
  const orig = CONFIG.MFA_ENCRYPTION_KEY;
  Object.defineProperty(CONFIG, 'MFA_ENCRYPTION_KEY', { value: raw, configurable: true });
  return () => Object.defineProperty(CONFIG, 'MFA_ENCRYPTION_KEY', { value: orig, configurable: true });
}

// E-06 test helper — kms-provider cache seed (prefetch simulyatsiyasi)
export { _seedKmsKeyForTests } from './kms-provider.js';
export { kmsConfigured, resetKmsCache };

/** Testlar uchun: KMS down holatini simulyatsiya qilish (cache tozalash). */
export function _clearKmsForTests() {
  resetKmsCache();
}
