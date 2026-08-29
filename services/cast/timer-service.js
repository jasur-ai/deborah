/**
 * Deborah — Cast Server Timer Service
 * -----------------------------------
 * Off / soft / strict timer — server timestamp va revision bilan.
 * Timer callback'da expected question ID + revision tekshiriladi (stale → no-op).
 * Process-local registry = optimization; state timestamp authoritative.
 */

import { CAST_TIMER_MODE, CAST_BOUNDS } from '../../utils/cast-constants.js';

const timers = new Map(); // sessionId -> {questionId, revision, timeout, mode, expiresAt}

/**
 * Compute closesAt for an opened question.
 * @returns {number|null} closesAt timestamp (null for OFF mode)
 */
export function computeClosesAt({ mode, defaultSeconds, openedAt }) {
  if (mode === CAST_TIMER_MODE.OFF) return null;
  const seconds = defaultSeconds || 30;
  return openedAt + seconds * 1000;
}

/**
 * Remaining ms at a given server now.
 */
export function remainingMs(closesAt, serverNow) {
  if (!closesAt) return null;
  return Math.max(0, closesAt - serverNow);
}

/**
 * Exact boundary acceptance: answer receivedAt <= closesAt + graceMs accepted.
 */
export function isWithinBoundary(receivedAt, closesAt, graceMs = 0) {
  if (!closesAt) return true; // OFF timer — no boundary
  return receivedAt <= closesAt + graceMs;
}

/**
 * Schedule a question timer.
 *
 * @param {object} opts
 * @param {string} opts.sessionId
 * @param {string} opts.questionId
 * @param {number} opts.revision
 * @param {number} opts.expiresAt — timestamp when timer fires
 * @param {string} opts.mode — soft|strict
 * @param {(fire: {sessionId,questionId,revision,mode}) => void} onFire
 * @returns {{cancel:()=>void, expiresAt:number}}
 */
export function scheduleQuestionTimer({ sessionId, questionId, revision, expiresAt, mode, onFire }) {
  // Stale timer callback'larni no-op qilish uchun registry
  const existing = timers.get(sessionId);
  if (existing) clearTimeout(existing.timeout);

  const delay = Math.max(0, expiresAt - Date.now());
  const timeout = setTimeout(() => {
    const reg = timers.get(sessionId);
    if (!reg) return; // cancelled
    if (reg.questionId !== questionId || reg.revision !== revision) return; // stale
    timers.delete(sessionId);
    try {
      onFire({ sessionId, questionId, revision, mode });
    } catch (_) {
      /* timer fire errors must not crash process */
    }
  }, delay);

  timers.set(sessionId, { questionId, revision, timeout, mode, expiresAt });
  return {
    cancel: () => {
      const reg = timers.get(sessionId);
      if (reg && reg.timeout === timeout) {
        clearTimeout(timeout);
        timers.delete(sessionId);
      }
    },
    expiresAt,
  };
}

/**
 * Cancel any timer for a session (pause / close / end).
 */
export function cancelSessionTimer(sessionId) {
  const reg = timers.get(sessionId);
  if (reg) {
    clearTimeout(reg.timeout);
    timers.delete(sessionId);
  }
}

/**
 * Clear all timers (server shutdown / tests).
 */
export function clearAllTimers() {
  for (const [, reg] of timers) clearTimeout(reg.timeout);
  timers.clear();
}

export { CAST_TIMER_MODE, CAST_BOUNDS };
