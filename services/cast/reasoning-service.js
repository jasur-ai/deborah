/**
 * Edikit — Cast Reasoning Service (C3-07)
 * -----------------------------------------
 * Selected items answerdan keyin qisqa justification oladi va
 * teacher-private moderation queue'ga yuboradi.
 *
 * Key principles:
 * - Raw reasoning private store'da saqlanadi
 * - Moderation state RECEIVED bilan boshlanadi
 * - Public (projector) faqat APPROVED/REDACTED text ko'radi
 * - Score auto o'zgarmaydi
 * - Retention class raw open text bilan bir xil
 */

import crypto from 'crypto';
import { fb } from '../../firebase/admin.js';
import { CAST_ERROR_CODES, CastError } from './errors.js';

// ── Constants ──
export const REASONING_CHAR_LIMIT = 280;
export const REASONING_CHAR_MIN = 10;

export const REASONING_POLICY = {
  OFF: 'off',
  OPTIONAL: 'optional',
  REQUIRED: 'required',
};

export const REASONING_MODERATION_STATE = {
  RECEIVED: 'RECEIVED',
  APPROVED: 'APPROVED',
  REDACTED: 'REDACTED',
  REJECTED: 'REJECTED',
  PROJECTED: 'PROJECTED',
};

/**
 * Submit reasoning for a participant's answer.
 * @param {object} input
 * @returns {Promise<object>} reasoning record
 */
export async function submitReasoning({ sessionId, questionId, participantId, commandId, text, attemptNo = 1 }) {
  const reasoningId = 'rsn_' + crypto.randomBytes(6).toString('hex');
  const clean = String(text || '').trim().slice(0, REASONING_CHAR_LIMIT);

  if (!clean) {
    return { reasoningId: null, status: 'EMPTY' };
  }

  const record = {
    reasoningId,
    sessionId,
    questionId,
    participantId,
    commandId,
    text: clean,
    charCount: clean.length,
    attemptNo,
    moderationState: REASONING_MODERATION_STATE.RECEIVED,
    submittedAt: Date.now(),
    moderatedAt: null,
    moderatedBy: null,
    redactedText: null,
    projectedAt: null,
  };

  await fb.set(`cast_private/${sessionId}/reasoning/${questionId}/${participantId}/${reasoningId}`, record);

  // Add to moderation queue (director's private room)
  await fb.set(`cast_private/${sessionId}/moderation_queue/${reasoningId}`, record);

  return { reasoningId, status: 'ACCEPTED', record };
}

/**
 * Get reasoning for a specific answer.
 * @returns {Promise<object|null>}
 */
export async function getReasoning(sessionId, questionId, participantId) {
  const snap = await fb.get(`cast_private/${sessionId}/reasoning/${questionId}/${participantId}`);
  if (!snap.exists()) return null;
  const all = snap.val();
  // Return the most recent
  const keys = Object.keys(all).sort();
  return keys.length > 0 ? all[keys[keys.length - 1]] : null;
}

/**
 * List reasoning for a question (director private).
 * @returns {Promise<object>}
 */
export async function listReasoningForQuestion(sessionId, questionId) {
  const snap = await fb.get(`cast_private/${sessionId}/reasoning/${questionId}`);
  if (!snap.exists()) return {};
  const all = snap.val();
  // Flatten: participantId → most recent reasoning
  const out = {};
  for (const [pid, entries] of Object.entries(all)) {
    const keys = Object.keys(entries).sort();
    if (keys.length > 0) {
      out[pid] = entries[keys[keys.length - 1]];
    }
  }
  return out;
}

/**
 * List moderation queue for a session (director private).
 * @returns {Promise<object>}
 */
export async function listModerationQueue(sessionId) {
  const snap = await fb.get(`cast_private/${sessionId}/moderation_queue`);
  return snap.exists() ? snap.val() : {};
}

/**
 * Moderate a reasoning entry.
 * @param {object} input
 * @returns {Promise<object>}
 */
export async function moderateReasoning({ sessionId, reasoningId, action, moderatorId, redactedText }) {
  const validActions = ['approve', 'redact', 'reject', 'project'];
  if (!validActions.includes(action)) {
    throw new CastError(CAST_ERROR_CODES.INVALID_OPTION, `Noma'lum moderatsiya: ${action}`);
  }

  const path = `cast_private/${sessionId}/moderation_queue/${reasoningId}`;
  const snap = await fb.get(path);
  if (!snap.exists()) {
    throw new CastError(CAST_ERROR_CODES.SESSION_NOT_FOUND, 'Reasoning topilmadi');
  }

  const current = snap.val();
  const stateMap = {
    approve: REASONING_MODERATION_STATE.APPROVED,
    reject: REASONING_MODERATION_STATE.REJECTED,
    redact: REASONING_MODERATION_STATE.REDACTED,
    project: REASONING_MODERATION_STATE.PROJECTED,
  };

  const update = {
    moderationState: stateMap[action],
    moderatedAt: Date.now(),
    moderatedBy: moderatorId,
    redactedText: action === 'redact' ? (redactedText || '').slice(0, REASONING_CHAR_LIMIT) : current.redactedText,
    projectedAt: action === 'project' ? Date.now() : current.projectedAt,
  };

  await fb.update(path, update);

  // Also update the private reasoning record
  const privatePath = `cast_private/${sessionId}/reasoning/${current.questionId}/${current.participantId}/${reasoningId}`;
  await fb.update(privatePath, update);

  return { ...current, ...update };
}

/**
 * Get public-safe reasoning (only APPROVED or REDACTED text).
 * @returns {Promise<string|null>}
 */
export async function getPublicReasoning(sessionId, questionId, participantId) {
  const rec = await getReasoning(sessionId, questionId, participantId);
  if (!rec) return null;
  if (rec.moderationState === REASONING_MODERATION_STATE.APPROVED) {
    return rec.text;
  }
  if (rec.moderationState === REASONING_MODERATION_STATE.REDACTED && rec.redactedText) {
    return rec.redactedText;
  }
  // PROJECTED is also public
  if (rec.moderationState === REASONING_MODERATION_STATE.PROJECTED) {
    return rec.text;
  }
  return null;
}

export default {
  REASONING_CHAR_LIMIT,
  REASONING_CHAR_MIN,
  REASONING_POLICY,
  REASONING_MODERATION_STATE,
  submitReasoning,
  getReasoning,
  listReasoningForQuestion,
  listModerationQueue,
  moderateReasoning,
  getPublicReasoning,
};