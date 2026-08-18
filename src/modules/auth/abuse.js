/**
 * Edikit — Abuse detection (AUTH C-06)
 * -------------------------------------------------------------------
 * Credential stuffing + password spray + OTP bombing — Redis counters.
 *
 * Pattern'lar (guide §06-§07):
 *   - Stuffing:  bir IP'da 10+ turli account fail / 15 daqiqa → flag.
 *   - Spray:     bir parol 5+ turli username'da / 15 daqiqa → flag.
 *   - Device:    bir fingerprint 3+ turli account'da fail / 15 daqiqa → flag.
 *   - OTP bomb:  per-user 3/soat, per-IP 10/soat send → flag + blok.
 *
 * Response (§09): block (high), challenge (medium, Turnstile), alert (low).
 * Parol hech qachon log'da EMAS — faqat parol HASH'i counter key'da.
 *
 * Redis yo'q → fail-open (detection o'chadi, auth buzilmaydi) — C-01 §23.
 * Redis counters TTL 15 daqiqa (§25).
 */
import { logAuthEvent, AUDIT_ACTIONS } from './audit.js';
import { recordMetric } from '../../telemetry/index.js';

const WINDOW_MS = 15 * 60 * 1000; // 15 daqiqa (C-06 §25)
const OTP_USER_LIMIT = 3; // per-user 3/soat send (guide §07)
const OTP_IP_LIMIT = 10; // per-IP 10/soat send
const OTP_WINDOW_MS = 60 * 60 * 1000; // 1 soat

// Threshold'lar (config'da bo'lishi mumkin — env orqali)
const STUFFING_IP_FAILS = 10; // 10+ turli account fail → flag (guide §06)
const SPRAY_PASSWORDS = 5; // 5+ username'da bir parol → flag
const DEVICE_ACCOUNTS = 3; // 3+ account'da bir fingerprint → flag

// ── Redis key helper'lar ──
const KEY = {
  stuffingIp: (ipHash) => `auth:stuff:ip:${ipHash}`,
  sprayPass: (passHash) => `auth:spray:pass:${passHash}`,
  device: (fp) => `auth:stuff:dev:${fp}`,
  otpUser: (userId) => `auth:otp:user:${userId}`,
  otpIp: (ipHash) => `auth:otp:ip:${ipHash}`,
};

/** sha256 — parol hash (parol hech qachon log'da/Redis'da emas). */
import crypto from 'crypto';
export function passHash(password) {
  return crypto.createHash('sha256').update(String(password || '')).digest('hex');
}

/** IP → sha256 (PII minimal — to'liq IP Redis'da emas). */
export function ipHashFor(ip) {
  if (!ip) return 'unknown';
  return crypto.createHash('sha256').update(String(ip)).digest('hex');
}

/**
 * Credential stuffing / spray / device pattern — login fail'da chaqiriladi.
 * @param {{ redis: object|null, redisOk: boolean, ipAddress: string,
 *   passwordHash: string, fingerprint?: string|null, userId: string }} params
 * @returns {Promise<{ level: 'ok'|'alert'|'challenge'|'block', pattern: string|null }>}
 */
export async function detectStuffing({ redis, redisOk, ipAddress, passwordHash, fingerprint, userId }) {
  if (!redisOk || !redis) return { level: 'ok', pattern: null };
  const ipH = ipHashFor(ipAddress);
  try {
    const now = Date.now();
    // 1) Stuffing: IP'da turli account fail'lar soni (SADD — user_id'lar)
    const ipKey = KEY.stuffingIp(ipH);
    await redis.sadd(ipKey, userId);
    await redis.expire(ipKey, Math.ceil(WINDOW_MS / 1000));
    const ipAccts = await redis.scard(ipKey);

    // 2) Spray: bir parol ko'p username'da
    const sprayKey = KEY.sprayPass(passwordHash);
    await redis.sadd(sprayKey, userId);
    await redis.expire(sprayKey, Math.ceil(WINDOW_MS / 1000));
    const sprayUsers = await redis.scard(sprayKey);

    // 3) Device: bir fingerprint ko'p account
    let devAccts = 0;
    if (fingerprint) {
      const devKey = KEY.device(fingerprint);
      await redis.sadd(devKey, userId);
      await redis.expire(devKey, Math.ceil(WINDOW_MS / 1000));
      devAccts = await redis.scard(devKey);
    }

    // Level: eng og'ir pattern (block > challenge > alert)
    if (ipAccts >= STUFFING_IP_FAILS) {
      await auditAbuse('stuffing', ipAccts, 'block', { ipHash: ipH });
      return { level: 'block', pattern: 'stuffing_ip' };
    }
    if (sprayUsers >= SPRAY_PASSWORDS) {
      await auditAbuse('spray', sprayUsers, 'challenge', { passHash: passwordHash.slice(0, 8) });
      return { level: 'challenge', pattern: 'password_spray' };
    }
    if (devAccts >= DEVICE_ACCOUNTS) {
      await auditAbuse('device', devAccts, 'challenge', { fingerprint });
      return { level: 'challenge', pattern: 'device_multi_account' };
    }
    if (ipAccts >= 5 || sprayUsers >= 3 || devAccts >= 2) {
      await auditAbuse('stuffing', ipAccts, 'alert', { ipHash: ipH, spray: sprayUsers });
      return { level: 'alert', pattern: ipAccts >= 5 ? 'stuffing_ip' : 'multi_account' };
    }
    return { level: 'ok', pattern: null };
  } catch (_) {
    return { level: 'ok', pattern: null }; // fail-open
  }
}

/**
 * OTP bombing — verify/mfa send'da chaqiriladi.
 * per-user 3/soat, per-IP 10/soat → block (429-ish signal).
 * @returns {Promise<{ allowed: boolean, level: 'ok'|'block', retryAfterSeconds: number }>}
 */
export async function detectOtpBomb({ redis, redisOk, userId, ipAddress }) {
  if (!redisOk || !redis) return { allowed: true, level: 'ok', retryAfterSeconds: 0 };
  const ipH = ipHashFor(ipAddress);
  try {
    const uKey = KEY.otpUser(userId);
    const iKey = KEY.otpIp(ipH);
    const ttl = Math.ceil(OTP_WINDOW_MS / 1000);
    const uCount = await redis.incr(uKey);
    if (uCount === 1) await redis.expire(uKey, ttl);
    const iCount = await redis.incr(iKey);
    if (iCount === 1) await redis.expire(iKey, ttl);

    if (uCount > OTP_USER_LIMIT || iCount > OTP_IP_LIMIT) {
      await auditAbuse('otp_bomb', Math.max(uCount, iCount), 'block', {
        user: uCount > OTP_USER_LIMIT ? 'user' : 'ip',
        ipHash: ipH,
      });
      return { allowed: false, level: 'block', retryAfterSeconds: 3600 };
    }
    return { allowed: true, level: 'ok', retryAfterSeconds: 0 };
  } catch (_) {
    return { allowed: true, level: 'ok', retryAfterSeconds: 0 }; // fail-open
  }
}

/** Audit + metric — abuse detection event (guide §11). */
async function auditAbuse(pattern, count, level, extra = {}) {
  try {
    const action = pattern === 'otp_bomb'
      ? AUDIT_ACTIONS.OTP_BOMB_DETECTED
      : level === 'block'
        ? AUDIT_ACTIONS.ABUSE_BLOCKED
        : AUDIT_ACTIONS.STUFFING_DETECTED;
    await logAuthEvent({
      action,
      outcome: level === 'block' ? 'blocked' : 'flagged',
      method: 'abuse',
      details: { pattern, count, level, ...extra },
    }).catch(() => {});
    recordMetric(`auth.abuse.${pattern}`, 1, { type: 'counter', labels: { level } });
  } catch (_) {}
}

/** Testlar uchun — threshold'lar va oyna (read-only). */
export function _abuseConfig() {
  return { WINDOW_MS, OTP_USER_LIMIT, OTP_IP_LIMIT, STUFFING_IP_FAILS, SPRAY_PASSWORDS, DEVICE_ACCOUNTS };
}
