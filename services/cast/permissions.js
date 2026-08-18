/**
 * Edikit — Cast Permissions
 * --------------------------
 * Role matrix — immutable registry. Har command uchun
 * permissions.can(actor, action, session) chaqiriladi.
 */

import { CAST_ROLES } from '../../utils/cast-constants.js';
import { CAST_ERROR_CODES, CastError } from './errors.js';

export const ACTIONS = {
  SESSION_START: 'session:start',
  QUESTION_OPEN: 'question:open',
  QUESTION_PAUSE: 'question:pause',
  QUESTION_RESUME: 'question:resume',
  QUESTION_CLOSE: 'question:close',
  QUESTION_REVEAL: 'question:reveal',
  QUESTION_NEXT: 'question:next',
  ANSWER_SUBMIT: 'answer:submit',
  MODERATE: 'content:moderate',
  SESSION_END: 'session:end',
  ADD_TIME: 'time:add',
  LEADERBOARD_SHOW: 'leaderboard:show',
  LOCK_LOBBY: 'lock:lobby',
  REMOVE_PARTICIPANT: 'participant:remove',
  JOIN: 'participant:join',
  ANALYZE: 'analyst:read',
  PROJECTOR_VIEW: 'projector:view',
  // C3-03 Vote→Discuss→Revote
  DISCUSS_START: 'discuss:start',
  REVOTE_OPEN: 'revote:open',
  // C3-06 Quick Prompt
  QUICK_PROMPT_LAUNCH: 'quick_prompt:launch',
  // C3-08 Mastery/Transfer/Redemption
  MASTERY_LAUNCH: 'mastery:launch',
};

// Immutable role → allowed actions
const MATRIX = {
  [CAST_ROLES.OWNER]: Object.values(ACTIONS),
  [CAST_ROLES.CO_HOST]: [
    ACTIONS.SESSION_START,
    ACTIONS.QUESTION_OPEN,
    ACTIONS.QUESTION_PAUSE,
    ACTIONS.QUESTION_RESUME,
    ACTIONS.QUESTION_CLOSE,
    ACTIONS.QUESTION_REVEAL,
    ACTIONS.QUESTION_NEXT,
    ACTIONS.ADD_TIME,
    ACTIONS.LEADERBOARD_SHOW,
    ACTIONS.LOCK_LOBBY,
    ACTIONS.REMOVE_PARTICIPANT,
    ACTIONS.ANSWER_SUBMIT,
    ACTIONS.MODERATE,
    ACTIONS.SESSION_END,
    ACTIONS.ANALYZE,
    ACTIONS.DISCUSS_START,
    ACTIONS.REVOTE_OPEN,
  ],
  [CAST_ROLES.MODERATOR]: [
    ACTIONS.MODERATE,
    ACTIONS.REMOVE_PARTICIPANT,
    ACTIONS.ANSWER_SUBMIT,
    ACTIONS.ANALYZE,
  ],
  [CAST_ROLES.PROJECTOR_ONLY]: [ACTIONS.PROJECTOR_VIEW],
  [CAST_ROLES.ANALYST_READONLY]: [ACTIONS.ANALYZE, ACTIONS.PROJECTOR_VIEW],
};

// Participant is a virtual role — only answer:submit + join
const PARTICIPANT_ACTIONS = [ACTIONS.ANSWER_SUBMIT, ACTIONS.JOIN];

/**
 * Pure check — returns {allowed:boolean, reason?:string}.
 */
export function can(actorRole, action, ctx = {}) {
  if (action === ACTIONS.JOIN || action === ACTIONS.ANSWER_SUBMIT) {
    if (actorRole === 'participant') return { allowed: true };
  }
  const allowed = (MATRIX[actorRole] || []).includes(action);
  if (!allowed) {
    return { allowed: false, reason: `Rol "${actorRole}" uchun "${action}" ruxsat emas` };
  }
  return { allowed: true };
}

/**
 * Throwing variant.
 */
export function assertCan(actorRole, action, ctx = {}) {
  const res = can(actorRole, action, ctx);
  if (!res.allowed) {
    throw new CastError(CAST_ERROR_CODES.NOT_AUTHORIZED, res.reason);
  }
  return true;
}

export { CAST_ROLES };
