/**
 * Deborah — MFA/TOTP Service (AUTH A-26)
 *
 * Production-grade TOTP MFA:
 *   - ikki fazali enrollment: setup (secret yaratish) → enable (birinchi kod)
 *   - login challenge: parol to'g'ri → pending_mfa (session BERILMAYDI) →
 *     faqat MFA kod/backup code to'g'ri bo'lsa session beriladi
 *   - TOTP verify valid_window=1 (90s), 5 xato → 15 daqiqa lockout
 *   - backup codes: 10 ta, HMAC-SHA256 hash bilan saqlanadi (plaintext YO'Q),
 *     ishlatilganda used (replay yo'q), rotate imkoniyati
 *   - challenge: single-use, 5 daqiqa TTL, consumed (reuse yo'q)
 *   - step-up: mfaAt — sensitive amallar uchun 30 daqiqa
 *   - MFA reset: backup code → yo'q bo'lsa support ticket + 72 soat delay
 *
 * Xavfsizlik:
 *   - secret AES-256-GCM bilan encrypt (key SESSION_SECRET sha256'dan yoki
 *     MFA_ENCRYPTION_KEY'dan) — DB'da plaintext YO'Q
 *   - backup code hash — DB'da plaintext YO'Q
 *   - kod hech qachon log'ga tushmaydi
 *   - lockout counters per-user + per-IP
 *
 * @module mfa-totp
 */

import crypto from 'crypto';
import { generateSecret, generate, verify } from 'otplib';
import { fb } from '../../../firebase/admin.js';
import { safeKey } from '../../../utils/helpers.js';
import { audit, AUDIT_ACTIONS } from './audit.js';
import CONFIG from '../../../src/config/env.js';
// D-02: versioned KMS service (mfa scope) — legacy 3-qismli + versioned 4-qismli
import { encryptSecret as kmsEncrypt, decryptSecret as kmsDecrypt } from './kms.js';

// ── Constants ──
const MFA_TOTP_PATH = 'mfa_totp';
const MFA_BACKUP_PATH = 'mfa_backup_codes';
const MFA_CHALLENGE_PATH = 'mfa_challenges';

const TOTP_WINDOW = 1; // ±1 step
const TOTP_STEP_SECONDS = 30; // otplib default period (RFC 6238)
const CHALLENGE_TTL_MS = 5 * 60 * 1000; // 5 daqiqa
const LOCKOUT_MAX_FAILS = 5;
const LOCKOUT_WINDOW_MS = 15 * 60 * 1000; // 15 daqiqa
const STEP_UP_TTL_MS = 30 * 60 * 1000; // 30 daqiqa
const BACKUP_CODE_COUNT = 10;
const RESET_DELAY_MS = 72 * 60 * 60 * 1000; // 72 soat

// In-memory lockout (per-user + per-IP) — qayta ishga tushganda tozalanadi,
// lekin DB'da `last_failed_at` yozuvi persist qilinadi (multi-node uchun).
const lockoutMap = new Map(); // key → { fails, until }

/** Encryption key — MFA_ENCRYPTION_KEY yoki SESSION_SECRET sha256'si. */
function encryptionKey() {
  const raw = CONFIG.MFA_ENCRYPTION_KEY || CONFIG.SESSION_SECRET;
  return crypto.createHash('sha256').update(String(raw)).digest();
}

/** AES-256-GCM encrypt — D-02: versioned KMS service (mfa scope). */
export function encryptSecret(plaintext) {
  return kmsEncrypt(plaintext, 'mfa_totp');
}

/** AES-256-GCM decrypt — D-02: legacy 3-qismli + versioned 4-qismli format. */
export function decryptSecret(payload) {
  return kmsDecrypt(payload, 'mfa_totp');
}

/** Backup code hash (HMAC-SHA256, key = encryption key). */
export function hashBackupCode(code) {
  return crypto.createHmac('sha256', encryptionKey()).update(String(code)).digest('hex');
}

/**
 * MFA holatini o'qiydi.
 * @param {string} userId
 * @returns {Promise<{status: 'none'|'pending'|'active', enabledAt: number|null, lastUsedAt: number|null}>}
 */
export async function getMfaStatus(userId) {
  const snap = await fb.get(`${MFA_TOTP_PATH}/${safeKey(userId)}`);
  if (!snap.exists()) return { status: 'none', enabledAt: null, lastUsedAt: null };
  const rec = snap.val();
  return {
    status: rec.status === 'active' ? 'active' : 'pending',
    enabledAt: rec.enabledAt || null,
    lastUsedAt: rec.lastUsedAt || null,
  };
}

/** Foydalanuvchida faol MFA bormi? */
export async function hasActiveMfa(userId) {
  const s = await getMfaStatus(userId);
  return s.status === 'active';
}

/**
 * Setup (faza 1): secret yaratadi, encrypt qilib pending holatda saqlaydi.
 * Secret plaintext FAQAT shu javobda qaytadi.
 * @returns {Promise<{ok: boolean, secret: string, otpauth: string, error?: string}>}
 */
export async function setupTotp(userId, { accountName, issuer = CONFIG.MFA_ISSUER || 'Deborah' } = {}) {
  const existing = await getMfaStatus(userId);
  if (existing.status === 'active') {
    return { ok: false, error: 'mfa_already_active' };
  }
  const secret = generateSecret(); // base32
  const encrypted = encryptSecret(secret);
  const otpauth = `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(accountName || userId)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;

  await fb.set(`${MFA_TOTP_PATH}/${safeKey(userId)}`, {
    secretEnc: encrypted,
    status: 'pending',
    createdAt: Date.now(),
    // Eski pending setup'ni qayta boshlashda qolgan lockout'ni tozalaymiz
    fails: 0,
    lockoutUntil: 0,
  });

  await audit({
    action: AUDIT_ACTIONS.MFA_SETUP,
    userId,
    resourceType: 'mfa',
    details: { phase: 'setup' },
  }).catch(() => {});

  return { ok: true, secret, otpauth };
}

/**
 * Enable (faza 2): birinchi kod verify → status active → 10 ta backup code.
 * @returns {Promise<{ok: boolean, backupCodes?: string[], error?: string}>}
 */
export async function enableTotp(userId, token) {
  const recSnap = await fb.get(`${MFA_TOTP_PATH}/${safeKey(userId)}`);
  if (!recSnap.exists() || recSnap.val().status !== 'pending') {
    return { ok: false, error: 'no_pending_setup' };
  }
  const secret = decryptSecret(recSnap.val().secretEnc);
  if (!secret) return { ok: false, error: 'secret_corrupt' };

  if (!isTotpCode(token) || !(await verifyTotpCode(secret, token))) {
    await recordFailedAttempt(userId, 'enable');
    return { ok: false, error: 'invalid_code' };
  }

  // Backup code'lar yaratiladi (HMAC hash — plaintext FAQAT hozir ko'rsatiladi)
  const backupCodes = [];
  const hashes = [];
  for (let i = 0; i < BACKUP_CODE_COUNT; i += 1) {
    const code = crypto.randomBytes(5).toString('hex'); // 10 belgi
    backupCodes.push(code);
    hashes.push({ h: hashBackupCode(code), usedAt: 0 });
  }
  await fb.set(`${MFA_BACKUP_PATH}/${safeKey(userId)}`, { codes: hashes, rotatedAt: Date.now() });

  await fb.set(`${MFA_TOTP_PATH}/${safeKey(userId)}`, {
    ...recSnap.val(),
    status: 'active',
    enabledAt: Date.now(),
    lastUsedAt: Date.now(),
    fails: 0,
    lockoutUntil: 0,
  });

  await audit({
    action: AUDIT_ACTIONS.MFA_ENABLE,
    userId,
    resourceType: 'mfa',
    details: { backupCodeCount: BACKUP_CODE_COUNT },
  }).catch(() => {});

  return { ok: true, backupCodes };
}

/** TOTP kod format: 6 xona raqam. */
export function isTotpCode(token) {
  return typeof token === 'string' && /^\d{6}$/.test(token);
}

/** Backup code format: 10 belgi hex. */
export function isBackupCodeFormat(code) {
  return typeof code === 'string' && /^[0-9a-f]{10}$/.test(code);
}

/** TOTP verify (valid_window=1). @returns {Promise<boolean>} */
export async function verifyTotpCode(secret, token) {
  try {
    // otplib v13: `window` option'ini IGNORE qiladi (v12-era) — to'g'ri
    // option `epochTolerance` (sekund). window:1 bilan ±1 step rad etilardi
    // (har 30s step chegarasida va clock drift'da login buzilardi).
    // D-15 wsl topilmasi — totp-window-d15 testi fosh qildi.
    const r = await verify({
      secret,
      token,
      epochTolerance: TOTP_WINDOW * TOTP_STEP_SECONDS, // ±1 step (30s har tomonda)
    });
    return r && r.valid === true;
  } catch (_) {
    return false;
  }
}

/**
 * Backup code verify — mos kelsa shu zahoti used (replay yo'q).
 * @returns {Promise<boolean>}
 */
export async function consumeBackupCode(userId, code) {
  if (!isBackupCodeFormat(code)) return false;
  const key = safeKey(userId);
  const snap = await fb.get(`${MFA_BACKUP_PATH}/${key}`);
  if (!snap.exists()) return false;
  const { codes } = snap.val();
  if (!Array.isArray(codes)) return false;
  const target = hashBackupCode(code);
  const idx = codes.findIndex((c) => c && c.h === target && !c.usedAt);
  if (idx < 0) return false;
  codes[idx] = { ...codes[idx], usedAt: Date.now() };
  await fb.set(`${MFA_BACKUP_PATH}/${key}`, { codes, rotatedAt: snap.val().rotatedAt || Date.now() });
  return true;
}

/** Lockout tekshiruvi — DB persist (multi-node) + in-memory tezlik. */
export async function isLockedOut(userId, ip) {
  const now = Date.now();
  // In-memory
  const mem = lockoutMap.get(`u:${userId}`);
  if (mem && now < mem.until) return mem.until - now;
  const memIp = lockoutMap.get(`ip:${ip}`);
  if (memIp && now < memIp.until) return memIp.until - now;
  // DB persist
  const rec = await fb.get(`${MFA_TOTP_PATH}/${safeKey(userId)}`);
  if (rec.exists() && rec.val().lockoutUntil > now) {
    lockoutMap.set(`u:${userId}`, { until: rec.val().lockoutUntil });
    return rec.val().lockoutUntil - now;
  }
  return 0;
}

/** Muvaffaqiyatsiz urinishni qayd qiladi → 5 da lockout. */
async function recordFailedAttempt(userId, ip) {
  const now = Date.now();
  const key = safeKey(userId);
  const recSnap = await fb.get(`${MFA_TOTP_PATH}/${key}`);
  const rec = recSnap.exists() ? recSnap.val() : {};
  const fails = (rec.fails || 0) + 1;
  const lockoutUntil = fails >= LOCKOUT_MAX_FAILS ? now + LOCKOUT_WINDOW_MS : rec.lockoutUntil || 0;
  const resetFails = lockoutUntil > 0 ? 0 : fails;
  await fb.set(`${MFA_TOTP_PATH}/${key}`, {
    ...rec,
    fails: resetFails,
    lockoutUntil,
    lastFailedAt: now,
  });
  if (lockoutUntil > 0) {
    lockoutMap.set(`u:${userId}`, { until: lockoutUntil });
  }
  // Per-IP: faqat 5-chi xatodan keyin blok (1-xatodayoq emas)
  const ipPrev = lockoutMap.get(`ip:${ip}`) || { fails: 0 };
  const ipFails = ipPrev.fails + 1;
  lockoutMap.set(`ip:${ip}`, {
    fails: ipFails,
    until: ipFails >= LOCKOUT_MAX_FAILS ? now + LOCKOUT_WINDOW_MS : ipPrev.until || 0,
  });
  return { locked: lockoutUntil > 0, retryAfterSeconds: lockoutUntil > 0 ? Math.ceil((lockoutUntil - now) / 1000) : 0 };
}

/** Muvaffaqiyat → fails/lockout tozalanadi. */
async function clearFailedAttempts(userId) {
  lockoutMap.delete(`u:${userId}`);
  const rec = await fb.get(`${MFA_TOTP_PATH}/${safeKey(userId)}`);
  if (rec.exists()) {
    await fb.set(`${MFA_TOTP_PATH}/${safeKey(userId)}`, { ...rec.val(), fails: 0, lockoutUntil: 0 });
  }
}

/**
 * MFA kodini verify qiladi (TOTP yoki backup code).
 * @returns {Promise<{ok: boolean, method: 'totp'|'backup'|null, error?: string, retryAfterSeconds?: number}>}
 */
export async function verifyMfaCode(userId, code, ip) {
  const locked = await isLockedOut(userId, ip);
  if (locked > 0) {
    return { ok: false, error: 'locked', retryAfterSeconds: Math.ceil(locked / 1000) };
  }

  const rec = await fb.get(`${MFA_TOTP_PATH}/${safeKey(userId)}`);
  if (!rec.exists() || rec.val().status !== 'active') {
    return { ok: false, error: 'mfa_not_active' };
  }

  // 1) Backup code (format mos bo'lsa birinchi sinab ko'riladi)
  if (isBackupCodeFormat(code)) {
    const used = await consumeBackupCode(userId, code);
    if (used) {
      await clearFailedAttempts(userId);
      await fb.set(`${MFA_TOTP_PATH}/${safeKey(userId)}`, { ...rec.val(), lastUsedAt: Date.now() });
      await audit({
        action: AUDIT_ACTIONS.MFA_VERIFY,
        userId,
        resourceType: 'mfa',
        details: { method: 'backup' },
        ipAddress: ip,
      }).catch(() => {});
      return { ok: true, method: 'backup' };
    }
  }

  // 2) TOTP
  const secret = decryptSecret(rec.val().secretEnc);
  if (secret && isTotpCode(code) && (await verifyTotpCode(secret, code))) {
    await clearFailedAttempts(userId);
    await fb.set(`${MFA_TOTP_PATH}/${safeKey(userId)}`, { ...rec.val(), lastUsedAt: Date.now() });
    await audit({
      action: AUDIT_ACTIONS.MFA_VERIFY,
      userId,
      resourceType: 'mfa',
      details: { method: 'totp' },
      ipAddress: ip,
    }).catch(() => {});
    return { ok: true, method: 'totp' };
  }

  // 3) Xato → lockout qaydi
  const fail = await recordFailedAttempt(userId, ip);
  await audit({
    action: AUDIT_ACTIONS.MFA_VERIFY,
    outcome: 'failed',
    userId,
    resourceType: 'mfa',
    details: { method: code ? 'unknown' : 'missing' },
    ipAddress: ip,
  }).catch(() => {});
  return { ok: false, error: 'invalid_code', ...(fail.locked ? { locked: true, retryAfterSeconds: fail.retryAfterSeconds } : {}) };
}

/** Yangi challenge yaratadi (single-use). @returns {Promise<string>} challengeId */
export async function createMfaChallenge(userId) {
  const challengeId = crypto.randomBytes(24).toString('hex');
  await fb.set(`${MFA_CHALLENGE_PATH}/${challengeId}`, {
    userId,
    createdAt: Date.now(),
    used: false,
  });
  return challengeId;
}

/**
 * Challenge'ni tekshiradi (consumed qilmaydi). Verify'dan OLDIN o'qiladi,
 * muvaffaqiyatdan KEYIN consumeMfaChallenge chaqiriladi — xato kod urinishi
 * challenge'ni yo'qotmasligi uchun (A-26 §12).
 * @returns {Promise<{userId: string, valid: boolean}|null>}
 */
export async function readMfaChallenge(challengeId) {
  if (typeof challengeId !== 'string' || !/^[0-9a-f]{48}$/.test(challengeId)) return null;
  const snap = await fb.get(`${MFA_CHALLENGE_PATH}/${challengeId}`);
  if (!snap.exists()) return null;
  const rec = snap.val();
  if (rec.used) return { userId: rec.userId, valid: false };
  if (Date.now() - rec.createdAt > CHALLENGE_TTL_MS) return { userId: rec.userId, valid: false };
  return { userId: rec.userId, valid: true };
}

/** Challenge'ni ishlatadi (consumed). @returns {Promise<string|null>} userId */
export async function consumeMfaChallenge(challengeId) {
  if (typeof challengeId !== 'string' || !/^[0-9a-f]{48}$/.test(challengeId)) return null;
  const snap = await fb.get(`${MFA_CHALLENGE_PATH}/${challengeId}`);
  if (!snap.exists()) return null;
  const rec = snap.val();
  if (rec.used) return null; // reuse yo'q
  if (Date.now() - rec.createdAt > CHALLENGE_TTL_MS) return null;
  await fb.set(`${MFA_CHALLENGE_PATH}/${challengeId}/used`, true);
  return rec.userId;
}

/** MFA'ni o'chiradi (reauth'dan keyin). */
export async function disableMfa(userId) {
  await fb.remove(`${MFA_TOTP_PATH}/${safeKey(userId)}`);
  await fb.remove(`${MFA_BACKUP_PATH}/${safeKey(userId)}`);
  lockoutMap.delete(`u:${userId}`);
  await audit({
    action: AUDIT_ACTIONS.MFA_DISABLE,
    userId,
    resourceType: 'mfa',
  }).catch(() => {});
  return { ok: true };
}

/** Backup code'larni rotate qiladi (eskilari invalid). */
export async function rotateBackupCodes(userId) {
  const backupCodes = [];
  const hashes = [];
  for (let i = 0; i < BACKUP_CODE_COUNT; i += 1) {
    const code = crypto.randomBytes(5).toString('hex');
    backupCodes.push(code);
    hashes.push({ h: hashBackupCode(code), usedAt: 0 });
  }
  await fb.set(`${MFA_BACKUP_PATH}/${safeKey(userId)}`, { codes: hashes, rotatedAt: Date.now() });
  await audit({
    action: AUDIT_ACTIONS.MFA_BACKUP_ROTATE,
    userId,
    resourceType: 'mfa',
  }).catch(() => {});
  return { ok: true, backupCodes };
}

/** Qolgan (ishlatilmagan) backup code soni. */
export async function backupCodesRemaining(userId) {
  const snap = await fb.get(`${MFA_BACKUP_PATH}/${safeKey(userId)}`);
  if (!snap.exists()) return 0;
  const { codes } = snap.val();
  if (!Array.isArray(codes)) return 0;
  return codes.filter((c) => c && !c.usedAt).length;
}

/** MFA reset (support ticket + 72 soat delay) — eng zaif nuqta himoyasi. */
export async function requestMfaReset(userId, { reason }) {
  const now = Date.now();
  await fb.set(`mfa_resets/${safeKey(userId)}`, {
    status: 'pending',
    reason: typeof reason === 'string' ? reason.slice(0, 500) : '',
    requestedAt: now,
    releaseAt: now + RESET_DELAY_MS,
    cancelled: false,
  });
  await audit({
    action: AUDIT_ACTIONS.MFA_RESET_REQUEST,
    userId,
    resourceType: 'mfa',
    details: { delayHours: 72 },
  }).catch(() => {});
  return { ok: true, releaseAt: now + RESET_DELAY_MS };
}

/** 72 soat o'tgan reset'ni bajaradi. */
export async function executeMfaReset(userId) {
  const snap = await fb.get(`mfa_resets/${safeKey(userId)}`);
  if (!snap.exists() || snap.val().status !== 'pending') return { ok: false, error: 'no_pending_reset' };
  if (Date.now() < snap.val().releaseAt) return { ok: false, error: 'delay_not_elapsed' };
  await fb.remove(`${MFA_TOTP_PATH}/${safeKey(userId)}`);
  await fb.remove(`${MFA_BACKUP_PATH}/${safeKey(userId)}`);
  await fb.set(`mfa_resets/${safeKey(userId)}/status`, 'executed');
  await audit({
    action: AUDIT_ACTIONS.MFA_RESET_EXECUTED,
    userId,
    resourceType: 'mfa',
  }).catch(() => {});
  return { ok: true };
}

/** Step-up tekshiruvi: mfaAt 30 daqiqa ichida bo'lsa → fresh. */
export function isMfaStepUpFresh(session) {
  const at = session?.user?.mfaAt || 0;
  return typeof at === 'number' && at > 0 && Date.now() - at < STEP_UP_TTL_MS;
}
