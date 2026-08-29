/**
 * Deborah — Auth Lockout & Rate Limit service (AUTH A-03)
 * -------------------------------------------------------------------
 * Login brute-force himoyasi:
 *   - per-IP:  `AUTH_LOCKOUT_IP_FAILURES` xato / 15 daqiqa → `AUTH_LOCKOUT_IP_MS` lock
 *              (in-memory counter — kampus NAT'da yumshoq, barcha talaba bir IP)
 *   - per-user: `AUTH_LOCKOUT_USER_FAILURES` xato / 15 daqiqa → `AUTH_LOCKOUT_USER_MS`
 *              (users.{key}.failed_attempts + locked_until — qattiq, DB'da)
 *   - Jitter: login xatosida tasodifiy kechikish (brute force sekinlashtirish)
 *   - 429: Retry-After header + error code RATE_LIMITED
 *   - Reset: 3/soat per account (in-memory); Register: 5/15 daqiqa per IP
 *
 * Kampus NAT e'tibori: per-IP limit yumshoq (qisqa), per-user limit qattiq —
 * `req.ip` `trust proxy` orqali to'g'ri hisoblanadi (server.js `trust proxy 1`).
 *
 * Storage: per-user DB (persistent), per-IP in-memory (Redis upgrade P2).
 */
import { fb } from '../../../firebase/admin.js';
import CONFIG from '../../config/env.js';
import { AUDIT_ACTIONS, logAuthEvent } from './audit.js';
import { startSpan, endSpan } from '../../telemetry/tracer.js'; // AUTH D-05: risk span
import { recordMetric } from '../../telemetry/index.js'; // AUTH D-06: auth_lockout_total

// ── Konfiguratsiya (env'dan, default'lar bilan) ──
const IP_FAILURES = CONFIG.AUTH_LOCKOUT_IP_FAILURES || 5;
const IP_WINDOW_MS = 15 * 60 * 1000; // 15 daqiqa oyna
const IP_LOCK_MS = CONFIG.AUTH_LOCKOUT_IP_MS || 5 * 60 * 1000; // 5 daqiqa
const USER_FAILURES = CONFIG.AUTH_LOCKOUT_USER_FAILURES || 10;
const USER_LOCK_MS = CONFIG.AUTH_LOCKOUT_USER_MS || 15 * 60 * 1000; // 15 daqiqa
// AUTH C-02 §08/§11 — progressive penalty: har blokdan keyin uzayadi.
// strike 1 → 15 daqiqa (A-03 kontrakti: 10 xato → retryAfter 900);
// strike 2 → 1 soat; strike 3+ → 2 soat + support (UI'da support havola).
const LOCK_STRIKE_DURATIONS_MS = [
  USER_LOCK_MS,
  CONFIG.AUTH_LOCKOUT_STRIKE2_MS || 60 * 60 * 1000,
  CONFIG.AUTH_LOCKOUT_STRIKE3_MS || 2 * 60 * 60 * 1000,
];
const JITTER_MAX_MS = CONFIG.AUTH_JITTER_MAX_MS || 600;
const RESET_WINDOW_MS = 60 * 60 * 1000; // 1 soat
// AUTH A-03: env'dan sozlanadi (0 = o'chirilgan); default 3 ta / soat / account
const RESET_MAX = CONFIG.AUTH_RESET_MAX ?? 3;
const REGISTER_WINDOW_MS = 15 * 60 * 1000;
// AUTH A-03: env'dan sozlanadi (0 = o'chirilgan); default 5 ta / 15 daqiqa / IP
const REGISTER_MAX = CONFIG.AUTH_REGISTER_MAX ?? 5;

// ── Per-IP in-memory store (Redis upgrade P2) ──
const ipFailures = new Map(); // ip -> { count, windowStart, lockedUntil }
const resetRequests = new Map(); // username -> number[] (timestamp'lar)
const registerIps = new Map(); // ip -> number[] (timestamp'lar)

export const LOCKOUT_ERROR_CODE = 'RATE_LIMITED';

/** Oynadan chiqqan eski yozuvlarni tozalash. */
function pruneWindow(arr, windowMs, now = Date.now()) {
  const cutoff = now - windowMs;
  const next = arr.filter((t) => t > cutoff);
  arr.length = 0;
  arr.push(...next);
  return next.length;
}

/** sleep helper (jitter uchun). */
export function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// ── Per-user failure mutex ──
// recordFailure failed_attempts read-modify-write qiladi (fb.get → +1 → fb.set).
// Parallel xato login'lar bir-birini kesib o'tib counter'ni kamaytirishi mumkin
// (ikkalasi ham N o'qiydi, N+1 yozadi) — shu chain ularni serializatsiya qiladi.
const userFailureLocks = new Map(); // userKey -> tail Promise

async function withUserFailureLock(userKey, fn) {
  const prev = userFailureLocks.get(userKey) || Promise.resolve();
  let release;
  const gate = new Promise((r) => { release = r; });
  const next = prev.catch(() => {}).then(() => gate);
  userFailureLocks.set(userKey, next);
  await prev.catch(() => {}); // oldingi operatsiya tugashini kutamiz
  try {
    return await fn();
  } finally {
    release();
    // Tail shu `next` bo'lsa tozalaymiz — navbat bo'lmasa Map o'sib ketmaydi
    if (userFailureLocks.get(userKey) === next) userFailureLocks.delete(userKey);
  }
}

/** Jitter — login xatosida tasodifiy kechikish (test'da o'chirilgan, CI tez). */
export function jitterDelayMs(attempts = 0) {
  if (CONFIG.NODE_ENV === 'test') return 0;
  const base = Math.min(attempts, 10) * 40; // urinishlar soniga qarab o'sadi
  const cap = Math.max(50, JITTER_MAX_MS);
  return Math.min(base + Math.floor(Math.random() * 150), cap);
}

// ── Per-user lockout (DB — qattiq) ──

/**
 * User lockout holatini tekshiradi.
 * AUTH C-02: `permanent` — users.status === 'blocked' (admin qarori §10);
 * `strike` — joriy progressive blok raqami (1/2/3+).
 * @param {string} userKey
 * @param {object} [existingUser] — route allaqachon o'qigan user snap.val();
 *   berilsa qo'shimcha DB read qilinmaydi (har login'da 2-o'qish yo'q).
 * @returns {Promise<{locked: boolean, permanent: boolean, retryAfterSeconds: number, failedAttempts: number, strike: number}>}
 */
export async function checkUserLockout(userKey, existingUser) {
  if (!userKey) return { locked: false, permanent: false, retryAfterSeconds: 0, failedAttempts: 0, strike: 0 };
  const now = Date.now();
  let user = existingUser || null;
  if (!user) {
    const snap = await fb.get(`users/${userKey}`);
    user = snap.exists() ? snap.val() : {};
  }
  const failedAttempts = user.failed_attempts || 0;
  // §10: permanent blok (admin) — vaqt limiti yo'q, support hal qiladi
  if (user.status === 'blocked') {
    return { locked: true, permanent: true, retryAfterSeconds: 0, failedAttempts, strike: (user.lock_strikes || 0) };
  }
  const lockedUntil = typeof user.locked_until === 'number' ? user.locked_until : 0;
  if (lockedUntil > now) {
    return {
      locked: true,
      permanent: false,
      retryAfterSeconds: Math.ceil((lockedUntil - now) / 1000),
      failedAttempts,
      strike: user.lock_strikes || 1,
    };
  }
  return { locked: false, permanent: false, retryAfterSeconds: 0, failedAttempts, strike: user.lock_strikes || 0 };
}

/**
 * Muvaffaqiyatsiz urinishni qayd etadi — user + IP.
 * Lockout chegarasi oshsa → locked_until o'rnatiladi + audit.
 * @param {{ userKey?: string, ip: string, method?: string }} params
 * @returns {Promise<{ locked: boolean, retryAfterSeconds: number, userFailedAttempts: number }>}
 */
export async function recordFailure({ userKey, ip, method = 'password' }) {
  const now = Date.now();
  let userLocked = false;
  let retryAfter = 0;
  let userFailedAttempts = 0;

  // ── Per-user (qattiq) — mutex ichida (parallel xato login'lar race qilmasin) ──
  if (userKey) {
    await withUserFailureLock(userKey, async () => {
      const snap = await fb.get(`users/${userKey}`);
      const user = snap.exists() && typeof snap.val() === 'object' ? snap.val() : {};
      const prev = typeof user.failed_attempts === 'number' ? user.failed_attempts : 0;
      userFailedAttempts = prev + 1;
      await fb.set(`users/${userKey}/failed_attempts`, userFailedAttempts);
      if (userFailedAttempts >= USER_FAILURES) {
        // AUTH C-02 §11: progressive — lock_strikes oshishi bilan davomiylik uzayadi
        const strike = (typeof user.lock_strikes === 'number' ? user.lock_strikes : 0) + 1;
        const lockMs = LOCK_STRIKE_DURATIONS_MS[Math.min(strike, 3) - 1];
        const lockedUntil = now + lockMs;
        await fb.set(`users/${userKey}/locked_until`, lockedUntil);
        await fb.set(`users/${userKey}/lock_strikes`, strike);
        userLocked = true;
        retryAfter = Math.ceil(lockMs / 1000);
        // AUTH D-05 §08: risk.lockout span (user scope)
        try {
          endSpan(startSpan('risk.lockout', {
            attributes: {
              'risk.scope': 'user',
              'risk.strike': strike,
              'risk.failures': userFailedAttempts,
              'auth.outcome': 'blocked',
            },
          }), { status: 'error', statusMessage: 'user_locked' });
        } catch (_) { /* fail-soft */ }
        // auth_audit'ga (logAuthEvent) — A-03 kontrakti bilan bir xil joy
        logAuthEvent({
          action: AUDIT_ACTIONS.LOCKOUT_TRIGGERED,
          outcome: 'blocked',
          method,
          actorId: userKey,
          ipAddress: ip,
          details: { scope: 'user', failures: userFailedAttempts, lockMs, strike },
        }).catch(() => {});
        // AUTH D-06 §06: auth_lockout_total{scope} (lockout spike alert)
        try { recordMetric('auth_lockout_total', 1, { type: 'counter', labels: { scope: 'user' } }); } catch (_) {}
      }
    });
  }

  // ── Per-IP (yumshoq) ──
  const entry = ipFailures.get(ip) || { count: 0, windowStart: now, lockedUntil: 0 };
  if (entry.windowStart < now - IP_WINDOW_MS) {
    entry.count = 0;
    entry.windowStart = now;
  }
  if (entry.lockedUntil > now) {
    // allaqachon IP lockda
    if (!userLocked) retryAfter = Math.ceil((entry.lockedUntil - now) / 1000);
  } else {
    entry.count += 1;
    if (entry.count >= IP_FAILURES) {
      entry.lockedUntil = now + IP_LOCK_MS;
      entry.count = 0;
      if (!userLocked) {
        retryAfter = Math.ceil(IP_LOCK_MS / 1000);
        logAuthEvent({
          action: AUDIT_ACTIONS.LOCKOUT_TRIGGERED,
          outcome: 'blocked',
          method: method || 'password',
          actorId: null,
          ipAddress: ip,
          details: { scope: 'ip', failures: IP_FAILURES, lockMs: IP_LOCK_MS },
        }).catch(() => {});
        // AUTH D-06 §06: auth_lockout_total{scope:'ip'}
        try { recordMetric('auth_lockout_total', 1, { type: 'counter', labels: { scope: 'ip' } }); } catch (_) {}
        // AUTH D-05 §08: risk.lockout span (IP scope)
        try {
          endSpan(startSpan('risk.lockout', {
            attributes: {
              'risk.scope': 'ip',
              'risk.failures': IP_FAILURES,
              'auth.outcome': 'blocked',
            },
          }), { status: 'error', statusMessage: 'ip_locked' });
        } catch (_) { /* fail-soft */ }
      }
    }
  }
  ipFailures.set(ip, entry);

  return { locked: userLocked || (ipFailures.get(ip)?.lockedUntil > Date.now()), retryAfterSeconds: retryAfter, userFailedAttempts };
}

/**
 * Muvaffaqiyatli login — hisoblagichlar tozalanadi.
 * AUTH C-02 §09: success → counter=0 + lock_strikes reset (legit foydalanuvchi;
 * progressive faqat muvaffaqiyatsiz sikl zanjirida kuchayadi).
 * @param {{ userKey?: string, ip: string }} params
 */
export async function recordSuccess({ userKey, ip }) {
  if (userKey) {
    await fb.set(`users/${userKey}/failed_attempts`, 0);
    await fb.remove(`users/${userKey}/locked_until`).catch(() => {});
    await fb.remove(`users/${userKey}/lock_strikes`).catch(() => {});
  }
  ipFailures.delete(ip);
}

// ── AUTH C-02 §09: Support manual unlock / admin block (§10) ──

/**
 * Support manual unlock — lockout'ni erta olib tashlaydi (audit bilan).
 * Permanent (status='blocked') HOLMAYDI — u alohida hal qilinadi.
 * @param {string} userKey
 * @param {{ ip?: string, actorId?: string, userAgent?: string }} [meta]
 */
export async function supportUnlock(userKey, meta = {}) {
  if (!userKey) return { ok: false, error: 'userKey required' };
  const snap = await fb.get(`users/${userKey}/status`);
  if (snap.exists() && snap.val() === 'blocked') {
    return { ok: false, error: 'permanent_blocked', code: 'ACCOUNT_BLOCKED' };
  }
  await fb.set(`users/${userKey}/failed_attempts`, 0);
  await fb.remove(`users/${userKey}/locked_until`).catch(() => {});
  await fb.remove(`users/${userKey}/lock_strikes`).catch(() => {});
  logAuthEvent({
    action: AUDIT_ACTIONS.LOCKOUT_RELEASED,
    outcome: 'success',
    method: 'support',
    actorId: userKey,
    ipAddress: meta.ip,
    userAgent: meta.userAgent,
    details: { scope: 'user', actor: meta.actorId || 'support' },
  }).catch(() => {});
  return { ok: true };
}

/**
 * Admin permanent blok — users.status = 'blocked' (§10).
 * @param {string} userKey
 * @param {{ ip?: string, actorId?: string, userAgent?: string, reason?: string }} [meta]
 */
export async function adminBlockUser(userKey, meta = {}) {
  if (!userKey) return { ok: false, error: 'userKey required' };
  await fb.set(`users/${userKey}/status`, 'blocked');
  await fb.set(`users/${userKey}/blocked_at`, Date.now());
  if (meta.reason) await fb.set(`users/${userKey}/blocked_reason`, meta.reason);
  logAuthEvent({
    action: AUDIT_ACTIONS.ACCOUNT_BLOCKED,
    outcome: 'blocked',
    method: 'admin',
    actorId: userKey,
    ipAddress: meta.ip,
    userAgent: meta.userAgent,
    details: { reason: meta.reason || null, actor: meta.actorId || 'admin' },
  }).catch(() => {});
  return { ok: true };
}

/** Admin permanent blokni olib tashlash (unblock). */
export async function adminUnblockUser(userKey, meta = {}) {
  if (!userKey) return { ok: false, error: 'userKey required' };
  await fb.remove(`users/${userKey}/status`).catch(() => {});
  await fb.remove(`users/${userKey}/blocked_at`).catch(() => {});
  await fb.remove(`users/${userKey}/blocked_reason`).catch(() => {});
  await fb.set(`users/${userKey}/failed_attempts`, 0);
  await fb.remove(`users/${userKey}/locked_until`).catch(() => {});
  await fb.remove(`users/${userKey}/lock_strikes`).catch(() => {});
  logAuthEvent({
    action: AUDIT_ACTIONS.ACCOUNT_UNBLOCKED,
    outcome: 'success',
    method: 'admin',
    actorId: userKey,
    ipAddress: meta.ip,
    userAgent: meta.userAgent,
    details: { actor: meta.actorId || 'admin' },
  }).catch(() => {});
  return { ok: true };
}

/**
 * 429 javob — Retry-After header + RATE_LIMITED code.
 * HTML so'rovda login sahifasini render qiladi (lockout UX), API/XHR'da JSON.
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {{ retryAfterSeconds: number, copy?: object, lang?: string, render?: Function, message?: string }} opts
 */
export function lockoutResponse(req, res, { retryAfterSeconds, copy, lang = 'uz', render, message }) {
  const retryAfter = Math.max(1, Math.ceil(retryAfterSeconds || 0));
  res.set('Retry-After', String(retryAfter));
  const isApi = req.originalUrl.startsWith('/api/') || req.path.startsWith('/api/');
  if (isApi || req.xhr || req.accepts('json')) {
    return res.status(429).json({
      error: message || 'Ko\'p urinish — birozdan keyin qayta urinib ko\'ring',
      code: LOCKOUT_ERROR_CODE,
      retryAfter,
    });
  }
  // HTML: login sahifasi 429 status bilan (countdown UX view'da)
  res.status(429);
  if (typeof render === 'function') {
    return render({ retryAfter, lockout: true });
  }
  return res.sendStatus(429);
}

// ── Reset limit (3/soat per account) ──

/**
 * Reset so'rovi limiti — 3/soat per account.
 * @returns {{ allowed: boolean, retryAfterSeconds: number }}
 */
export function checkResetLimit(username) {
  const key = String(username || '').toLowerCase();
  const now = Date.now();
  if (RESET_MAX <= 0) return { allowed: true, retryAfterSeconds: 0 }; // o'chirilgan
  const arr = resetRequests.get(key) || [];
  pruneWindow(arr, RESET_WINDOW_MS, now);
  if (arr.length >= RESET_MAX) {
    const oldest = arr[0];
    return { allowed: false, retryAfterSeconds: Math.ceil((oldest + RESET_WINDOW_MS - now) / 1000) };
  }
  return { allowed: true, retryAfterSeconds: 0 };
}

export function recordResetRequest(username) {
  const key = String(username || '').toLowerCase();
  const now = Date.now();
  const arr = resetRequests.get(key) || [];
  pruneWindow(arr, RESET_WINDOW_MS, now);
  arr.push(now);
  resetRequests.set(key, arr);
}

// ── Register limit (5/15 daqiqa per IP) ──

export function checkRegisterLimit(ip) {
  const now = Date.now();
  if (REGISTER_MAX <= 0) return { allowed: true, retryAfterSeconds: 0 }; // o'chirilgan
  const arr = registerIps.get(ip) || [];
  pruneWindow(arr, REGISTER_WINDOW_MS, now);
  if (arr.length >= REGISTER_MAX) {
    const oldest = arr[0];
    return { allowed: false, retryAfterSeconds: Math.ceil((oldest + REGISTER_WINDOW_MS - now) / 1000) };
  }
  return { allowed: true, retryAfterSeconds: 0 };
}

export function recordRegister(ip) {
  const now = Date.now();
  const arr = registerIps.get(ip) || [];
  pruneWindow(arr, REGISTER_WINDOW_MS, now);
  arr.push(now);
  registerIps.set(ip, arr);
}

/** Testlar uchun in-memory store tozalash. */
export function _resetStores() {
  ipFailures.clear();
  resetRequests.clear();
  registerIps.clear();
  userFailureLocks.clear();
}

// Export audit helper re-export (routes/auth.js qulayligi uchun)
export { logAuthEvent };
