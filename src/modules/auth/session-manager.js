/**
 * Edikit — Session Manager & Recovery Codes
 *
 * Manages active user sessions and one-time recovery codes.
 *
 * Features:
 *   1. Track active sessions per user (store in local DB)
 *   2. View own sessions (IP, user agent, last active time)
 *   3. Revoke specific sessions (force logout)
 *   4. Generate and verify one-time recovery codes
 *   5. Helpdesk audit for recovery code usage
 *
 * Session tracking is stored in the local DB under `sessions/` paths.
 * Recovery codes are hashed with SHA-256 and stored under `recovery_codes/`.
 *
 * @module session-manager
 */

import crypto from 'crypto';
import { fb } from '../../../firebase/admin.js';
import { safeKey } from '../../../utils/helpers.js';
import CONFIG from '../../../src/config/env.js';
import { audit, AUDIT_ACTIONS } from './audit.js';
import { sessionTtlMs } from './session-store.js';

// ── AUTH B-25: server-side bulk revoke ──
// Express-session store (Redis/Memory) — `destroy(sid)` orqali real sessiya
// o'chiriladi. Client cookie'ga hech qachon ishonilmaydi (§15).
let sessionStoreRef = null;

/**
 * Express-session store'ni registratsiya qiladi (server startup'da).
 * B-25 §07: revokeByUser uchun Redis/Memory store'ga kirish.
 * @param {object} store
 */
export function setSessionStore(store) {
  sessionStoreRef = store;
}

// ── AUTH D-31 §07/§09: Redis sorted-set (parallel limit) + pub/sub revoke ──
// redis-service (Lua atomic) session-manager'ga ulangan — recordSession
// sorted-set'ni yangilaydi, revoke'lar cross-node publish qilinadi.
let redisServiceRef = null;

/**
 * Redis service'ni registratsiya qiladi (server startup'da, D-31 §07).
 * @param {object} svc — createRedisService() natijasi (parallelSessions*, publishRevoke)
 */
export function setRedisService(svc) {
  redisServiceRef = svc;
}

/** @returns {object|null} */
function getRedisService() {
  return redisServiceRef;
}

/**
 * D-31 §07 — sessiyani Express-session store'da yo'q qiladi (server-side).
 * @param {string} sid — real session ID
 */
function destroySessionInStore(sid) {
  if (!sid || !sessionStoreRef || typeof sessionStoreRef.destroy !== 'function') return;
  try {
    sessionStoreRef.destroy(sid, () => {});
  } catch (_) { /* non-critical — DB tracking qoladi */ }
}

/**
 * B-25 §07 — user'ning BARCHA sessiyalarini server-side revoke qiladi.
 * Redis/Memory store'dan destroy + local DB tracking'dan o'chirish + audit.
 *
 * @param {string} userId — user safeKey
 * @param {object} [opts]
 * @param {string|null} [opts.exceptSessionId] — joriy sessiya saqlanadi (§27)
 * @param {string} [opts.reason] — audit'da trigger sababi
 * @returns {Promise<{ok:boolean, count:number}>}
 */
export async function revokeByUser(userId, { exceptSessionId = null, reason = 'security' } = {}) {
  if (!userId) return { ok: false, count: 0 };
  const uKey = safeKey(userId);
  const sessions = await getUserSessions(uKey);
  const ids = Object.keys(sessions || {});
  if (!ids.length) return { ok: true, count: 0 };

  let revoked = 0;
  for (const sidKey of ids) {
    const rec = sessions[sidKey];
    // Real session ID — record'da saqlangan (safeKey transform'dan keyin)
    const realSid = rec && rec.sessionId ? rec.sessionId : sidKey;
    if (exceptSessionId && realSid === exceptSessionId) continue;

    // 1) Express-session store'dan destroy (Redis DEL / MemoryStore delete)
    destroySessionInStore(realSid);
    // 2) Redis sorted-set + cross-node revoke (D-31 §07/§09)
    const redisSvc = getRedisService();
    if (redisSvc) {
      try {
        await redisSvc.parallelSessionsRemove(uKey, realSid);
        await redisSvc.publishRevoke({ sessionId: realSid, userId: uKey, reason: 'bulk_revoke' });
      } catch (_) { /* fail-open */ }
    }
    // 3) Local DB tracking'dan o'chirish
    try {
      await fb.remove(`${SESSION_PATH}/${uKey}/${sidKey}`);
    } catch (_) {}
    revoked += 1;
  }

  if (revoked > 0) {
    await audit({
      action: AUDIT_ACTIONS.SESSIONS_REVOKED,
      userId: uKey,
      details: { count: revoked, reason, exceptCurrent: !!exceptSessionId },
    }).catch(() => {});
  }
  return { ok: true, count: revoked };
}

// ── Constants ──
// AUTH A-02: parallel session limit — 5; 6-chisi kelganda eng eski revoke.
// Tenant/instance config: SESSION_MAX_PARALLEL.
const MAX_SESSIONS_PER_USER = CONFIG.SESSION_MAX_PARALLEL || 5;
const RECOVERY_CODES_COUNT = 8;
const RECOVERY_CODE_LENGTH = 12; // characters
const SESSION_PATH = 'sessions';
const RECOVERY_PATH = 'recovery_codes';

// ── Session Tracking ──

/**
 * Record a new session in the database.
 * Should be called after successful login.
 *
 * @param {Object} params
 * @param {string} params.userId - User safeKey
 * @param {string} params.sessionId - Express session ID
 * @param {string} [params.ipAddress] - Client IP
 * @param {string} [params.userAgent] - User agent string
 * @param {string} [params.authMethod] - 'password' | 'google' | 'passkey'
 * @param {boolean} [params.remember] - AUTH A-01: 30 kun TTL
 * @param {string} [params.role] - user role (student/teacher/...)
 * @param {boolean} [params.isVip] - VIP status
 * @returns {Promise<boolean>}
 */
export async function recordSession({ userId, sessionId, ipAddress, userAgent, authMethod, remember, role, isVip }) {
  if (!userId || !sessionId) return false;

  const userSessionsPath = `${SESSION_PATH}/${userId}`;
  const snap = await fb.get(userSessionsPath);
  const sessions = snap.exists() ? snap.val() : {};

  // AUTH A-02: parallel session limit — cap'ga yetganda eng eski session revoke
  // (Redis sorted-set by createdAt ekvivalenti — local DB'dagi yozuvlar).
  const sessionKeys = Object.keys(sessions);
  let evictedRealSid = null;
  if (sessionKeys.length >= MAX_SESSIONS_PER_USER) {
    // Remove oldest session
    const oldestKey = sessionKeys.sort((a, b) => (sessions[a].createdAt || 0) - (sessions[b].createdAt || 0))[0];
    evictedRealSid = (sessions[oldestKey] && sessions[oldestKey].sessionId) || oldestKey;
    delete sessions[oldestKey];
    // Privileged event — audit (session:limit-reached)
    audit({
      action: AUDIT_ACTIONS.SESSION_LIMIT_REACHED,
      userId,
      resourceType: 'session',
      details: { limit: MAX_SESSIONS_PER_USER, revokedSessionId: String(oldestKey).slice(0, 12) + '...' },
    }).catch(() => {});
  }

  const now = Date.now();
  // Kalit ham safeKey — touchSession/revokeSession bilan mos (AUTH A-01).
  const key = safeKey(sessionId);
  // Record new session (AUTH A-01 schema — PII minimal: to'liq IP EMAS,
  // faqat ipHash (D-22 §09). Raw IP session record'da saqlanmaydi —
  // detectNewDevice faqat ipHash solishtiradi, raw IP kerak emas.)
  sessions[key] = {
    sessionId,
    ipHash: ipAddress ? crypto.createHash('sha256').update(ipAddress).digest('hex') : null,
    userAgent: userAgent ? userAgent.substring(0, 500) : null,
    authMethod: authMethod || 'password',
    remember: !!remember,
    role: role || null,
    isVip: !!isVip,
    createdAt: now,
    lastActiveAt: now,
    expiresAt: now + sessionTtlMs(remember),
  };

  await fb.set(userSessionsPath, sessions);

  // ── AUTH D-31 §06/§07: Redis sorted-set birlashma ──
  // DB yozuv — sessiya listesining manbai; Redis sorted-set — parallel limit
  // atomik (Lua) + cross-node ko'rinish. Redis yo'q bo'lsa (degrade) faqat DB
  // ishlaydi — login qattiq emas (§26). Xato hech qachon login'ni buzmaydi.
  const redisSvc = getRedisService();
  if (redisSvc) {
    try {
      await redisSvc.parallelSessionsAdd(userId, sessionId, { limit: MAX_SESSIONS_PER_USER });
    } catch (_) { /* fail-open: DB yetarli */ }
  }

  // Limit'dan chiqib ketgan eng eski sessiya real store'dan o'chiriladi va
  // boshqa node'larga ham xabar beriladi (cross-node revoke, §09).
  if (evictedRealSid) {
    destroySessionInStore(evictedRealSid);
    if (redisSvc) {
      try {
        await redisSvc.publishRevoke({ sessionId: evictedRealSid, userId, reason: 'parallel_limit' });
        await redisSvc.parallelSessionsRemove(userId, evictedRealSid);
      } catch (_) { /* fail-open */ }
    }
  }

  return true;
}

/**
 * Update the last active timestamp for a session.
 * Called on every authenticated request via middleware.
 *
 * @param {string} userId
 * @param {string} sessionId
 */
export async function touchSession(userId, sessionId) {
  if (!userId || !sessionId) return;

  const sessionPath = `${SESSION_PATH}/${userId}/${safeKey(sessionId)}/lastActiveAt`;
  try {
    await fb.set(sessionPath, Date.now());
  } catch (_) {
    // Non-critical — don't fail the request
  }
}

/**
 * Get all active sessions for a user.
 *
 * @param {string} userId
 * @returns {Promise<Object>} Sessions keyed by sessionId
 */
export async function getUserSessions(userId) {
  const userSessionsPath = `${SESSION_PATH}/${userId}`;
  const snap = await fb.get(userSessionsPath);
  return snap.exists() ? snap.val() : {};
}

/**
 * Revoke (remove) a specific session.
 *
 * @param {string} userId
 * @param {string} sessionId
 * @returns {Promise<Object>} { ok, error }
 */
export async function revokeSession(userId, sessionId) {
  const sessionPath = `${SESSION_PATH}/${userId}/${safeKey(sessionId)}`;
  const snap = await fb.get(sessionPath);

  if (!snap.exists()) {
    return { ok: false, error: 'Session not found.' };
  }

  await fb.remove(sessionPath);

  // D-31 §07/§09: Redis sorted-set'dan o'chirish + cross-node revoke xabari
  const redisSvc = getRedisService();
  if (redisSvc) {
    try {
      await redisSvc.parallelSessionsRemove(userId, sessionId);
      await redisSvc.publishRevoke({ sessionId, userId, reason: 'session_revoke' });
    } catch (_) { /* fail-open */ }
  }

  // Audit
  await audit({
    action: AUDIT_ACTIONS.SESSION_REVOKE,
    userId,
    details: { revokedSessionId: sessionId.substring(0, 12) + '...' },
  });

  return { ok: true };
}

/**
 * Revoke all sessions for a user except the current one.
 *
 * @param {string} userId
 * @param {string} currentSessionId
 * @returns {Promise<Object>} { ok, count }
 */
export async function revokeOtherSessions(userId, currentSessionId) {
  const userSessionsPath = `${SESSION_PATH}/${userId}`;
  const snap = await fb.get(userSessionsPath);

  if (!snap.exists()) return { ok: true, count: 0 };

  const sessions = snap.val();
  let removedCount = 0;
  const removedIds = [];

  for (const sid of Object.keys(sessions)) {
    if (sid !== currentSessionId) {
      const realSid = (sessions[sid] && sessions[sid].sessionId) || sid;
      removedIds.push(realSid);
      delete sessions[sid];
      removedCount++;
    }
  }

  await fb.set(userSessionsPath, sessions);

  // D-31 §07/§09: store'dan destroy + Redis sorted-set + cross-node revoke
  for (const realSid of removedIds) {
    destroySessionInStore(realSid);
    const redisSvc = getRedisService();
    if (redisSvc) {
      try {
        await redisSvc.parallelSessionsRemove(userId, realSid);
        await redisSvc.publishRevoke({ sessionId: realSid, userId, reason: 'revoke_others' });
      } catch (_) { /* fail-open */ }
    }
  }

  if (removedCount > 0) {
    await audit({
      action: AUDIT_ACTIONS.SESSION_REVOKE,
      userId,
      details: { revokedCount: removedCount, type: 'other_sessions' },
    });
  }

  return { ok: true, count: removedCount };
}

// ── New-device detection (AUTH A-05, guide P1 A-09) ──

/**
 * Yangi qurilma aniqlash — yangi login IP/UA avvalgi session'lar bilan
 * solishtiriladi. Agar hech bir mavjud session shu ipHash/UA ga ega bo'lmasa
 * → yangi qurilma (audit event + email-infra xabari P2).
 *
 * @param {Object} params
 * @param {string} params.userId - User safeKey
 * @param {string} [params.ipAddress] - Client IP
 * @param {string} [params.userAgent] - User agent
 * @returns {Promise<{ isNew: boolean, knownCount: number, reason: string|null }>}
 */
export async function detectNewDevice({ userId, ipAddress, userAgent }) {
  if (!userId) return { isNew: false, knownCount: 0, reason: null };

  const sessions = await getUserSessions(userId);
  const known = Object.values(sessions || {});
  if (!known.length) {
    // Birinchi login (yoki session record yo'q) — "yangi" emas (FARQ qilmaydi).
    return { isNew: false, knownCount: 0, reason: null };
  }

  const ipHash = ipAddress ? crypto.createHash('sha256').update(ipAddress).digest('hex') : null;
  const ua = userAgent ? userAgent.substring(0, 500) : null;

  // Shu IP/UA kombinatsiyasi oldin ko'rilganmi?
  const seenSameIp = known.some((s) => s.ipHash && s.ipHash === ipHash);
  const seenSameUa = known.some((s) => s.userAgent && s.userAgent === ua);

  // Yangi device: IP HAM UA ham noma'lum (ikkalasi ham mavjud bo'lsa).
  // IP o'zgarishi mumkin (NAT/mobil) — shuning uchun faqat IP farqi etarli emas.
  const isNew = !seenSameIp && !seenSameUa;

  return {
    isNew,
    knownCount: known.length,
    reason: isNew ? 'unseen_ip_and_ua' : null,
  };
}

// ── Recovery Codes ──

/**
 * Generate recovery codes for a user.
 * Returns the plain-text codes (display once) and stores hashed versions.
 *
 * @param {string} userId
 * @returns {Promise<Object>} { ok, codes: string[] }
 */
export async function generateRecoveryCodes(userId) {
  const plainCodes = [];

  for (let i = 0; i < RECOVERY_CODES_COUNT; i++) {
    const code = crypto.randomBytes(RECOVERY_CODE_LENGTH)
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=/g, '')
      .substring(0, RECOVERY_CODE_LENGTH)
      .toUpperCase();

    plainCodes.push(code);
  }

  // Hash and store each code
  const recoveryData = {};
  for (const code of plainCodes) {
    const hash = crypto.createHash('sha256').update(code).digest('hex');
    recoveryData[hash] = {
      hash,
      used: false,
      createdAt: Date.now(),
    };
  }

  // Store user's recovery codes container
  const userRecoveryPath = `${RECOVERY_PATH}/${userId}`;
  await fb.set(userRecoveryPath, {
    codes: recoveryData,
    generatedAt: Date.now(),
    totalGenerated: plainCodes.length,
  });

  return { ok: true, codes: plainCodes };
}

/**
 * Verify a recovery code.
 * If valid and unused, marks it as used and returns success.
 *
 * @param {string} userId
 * @param {string} code - Plain-text recovery code
 * @returns {Promise<Object>} { ok, error, remaining }
 */
export async function verifyRecoveryCode(userId, code) {
  if (!code || code.length < 8) {
    return { ok: false, error: 'Invalid recovery code format.' };
  }

  const userRecoveryPath = `${RECOVERY_PATH}/${userId}`;
  const snap = await fb.get(userRecoveryPath);

  if (!snap.exists()) {
    return { ok: false, error: 'No recovery codes found. Generate new ones.' };
  }

  const recoveryData = snap.val();
  const codeHash = crypto.createHash('sha256').update(code.trim().toUpperCase()).digest('hex');

  // Check if hash exists and is unused
  if (!recoveryData.codes[codeHash]) {
    return { ok: false, error: 'Invalid recovery code.' };
  }

  if (recoveryData.codes[codeHash].used) {
    return { ok: false, error: 'This recovery code has already been used.' };
  }

  // Mark as used
  recoveryData.codes[codeHash].used = true;
  recoveryData.codes[codeHash].usedAt = Date.now();
  await fb.set(userRecoveryPath, recoveryData);

  // Count remaining unused codes
  const remaining = Object.values(recoveryData.codes).filter(c => !c.used).length;

  // Audit
  await audit({
    action: AUDIT_ACTIONS.RECOVERY_CODE_USED,
    userId,
    details: { remaining },
  });

  return { ok: true, remaining };
}

/**
 * Get recovery code status for a user (no codes returned, just status).
 *
 * @param {string} userId
 * @returns {Promise<Object>} { hasCodes, total, used, remaining }
 */
export async function getRecoveryCodeStatus(userId) {
  const userRecoveryPath = `${RECOVERY_PATH}/${userId}`;
  const snap = await fb.get(userRecoveryPath);

  if (!snap.exists()) {
    return { hasCodes: false, total: 0, used: 0, remaining: 0 };
  }

  const data = snap.val();
  const codes = Object.values(data.codes || {});
  const total = codes.length;
  const used = codes.filter(c => c.used).length;

  return {
    hasCodes: total > 0,
    total,
    used,
    remaining: total - used,
  };
}

/**
 * Revoke (invalidate) all recovery codes for a user.
 *
 * @param {string} userId
 * @returns {Promise<boolean>}
 */
export async function revokeRecoveryCodes(userId) {
  await fb.remove(`${RECOVERY_PATH}/${userId}`);

  await audit({
    action: AUDIT_ACTIONS.RECOVERY_CODE_REVOKE,
    userId,
  });

  return true;
}
