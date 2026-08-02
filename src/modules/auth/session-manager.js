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
import { audit, AUDIT_ACTIONS } from './audit.js';

// ── Constants ──
const MAX_SESSIONS_PER_USER = 20;
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
 * @returns {Promise<boolean>}
 */
export async function recordSession({ userId, sessionId, ipAddress, userAgent, authMethod }) {
  if (!userId || !sessionId) return false;

  const userSessionsPath = `${SESSION_PATH}/${userId}`;
  const snap = await fb.get(userSessionsPath);
  const sessions = snap.exists() ? snap.val() : {};

  // Limit active sessions
  const sessionKeys = Object.keys(sessions);
  if (sessionKeys.length >= MAX_SESSIONS_PER_USER) {
    // Remove oldest session
    const oldestKey = sessionKeys.sort((a, b) => (sessions[a].createdAt || 0) - (sessions[b].createdAt || 0))[0];
    delete sessions[oldestKey];
  }

  // Record new session
  sessions[sessionId] = {
    sessionId,
    ipAddress: ipAddress || null,
    userAgent: userAgent ? userAgent.substring(0, 500) : null,
    authMethod: authMethod || 'password',
    createdAt: Date.now(),
    lastActiveAt: Date.now(),
  };

  await fb.set(userSessionsPath, sessions);
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

  for (const sid of Object.keys(sessions)) {
    if (sid !== currentSessionId) {
      delete sessions[sid];
      removedCount++;
    }
  }

  await fb.set(userSessionsPath, sessions);

  if (removedCount > 0) {
    await audit({
      action: AUDIT_ACTIONS.SESSION_REVOKE,
      userId,
      details: { revokedCount: removedCount, type: 'other_sessions' },
    });
  }

  return { ok: true, count: removedCount };
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
