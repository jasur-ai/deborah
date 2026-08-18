/**
 * Edikit — Cast Session Store
 * ----------------------------
 * Cast data access bitta adapter orqali. Handlerlar raw Firebase
 * path bilmaydi. Logical collections:
 *
 *   cast_sessions/{id}/meta
 *   cast_sessions/{id}/config
 *   cast_sessions/{id}/state
 *   cast_sessions/{id}/questions_public/{qid}
 *   cast_sessions/{id}/roles/{actorId}
 *   cast_sessions/{id}/participants/{pid}
 *   cast_sessions/{id}/scores/{pid}
 *   cast_sessions/{id}/action_pack
 *   cast_private/{id}/questions/{qid}
 *   cast_private/{id}/answers/{qid}/{pid}/{attemptNo}
 *   cast_private/{id}/events/{revKey}
 *   cast_private/{id}/audit/{auditId}
 *   cast_private/{id}/wall_queue/{contentId}   (C3-10: moderated question wall)
 *   cast_private/{id}/wall_state             (C3-10: moderator presence / freeze)
 *   cast_codes/{joinCode}
 */

import crypto from 'crypto';
import { fb } from '../../firebase/admin.js';
import { CAST_ERROR_CODES, CastError } from './errors.js';
import { CAST_ROLES, JOIN_CODE_ALPHABET, JOIN_CODE_LENGTH } from '../../utils/cast-constants.js';

const S = (id) => `cast_sessions/${id}`;
const P = (id) => `cast_private/${id}`;

/**
 * Generate a cryptographically random session id.
 */
export function generateSessionId() {
  return 'cast_' + crypto.randomBytes(9).toString('base64url');
}

/**
 * Generate a join code (ambiguous chars excluded).
 */
export function generateJoinCode() {
  let code = '';
  const bytes = crypto.randomBytes(JOIN_CODE_LENGTH);
  for (let i = 0; i < JOIN_CODE_LENGTH; i++) {
    code += JOIN_CODE_ALPHABET[bytes[i] % JOIN_CODE_ALPHABET.length];
  }
  return code;
}

// ── Session creation ──
export async function createSession({ sessionId, joinCode, meta, config, state, privateQuestions, publicQuestions }) {
  const sessionIdSafe = sessionId || generateSessionId();
  const code = joinCode || generateJoinCode();

  // Join code collision check (transactional)
  const collision = await fb.get(`cast_codes/${code}`);
  if (collision.exists()) {
    throw new CastError(CAST_ERROR_CODES.CONFIG_INVALID, 'Join kod band');
  }

  const publicQ = {};
  for (const q of publicQuestions) publicQ[q.id] = q;
  const privateQ = {};
  for (const q of privateQuestions) privateQ[q.id] = q;

  await fb.set(S(sessionIdSafe), {
    meta: { ...meta, sessionId: sessionIdSafe, joinCode: code, created_at: Date.now() },
    config,
    state,
    questions_public: publicQ,
    participants: {},
    scores: {},
  });
  await fb.set(P(sessionIdSafe), {
    questions: privateQ,
    answers: {},
    events: { '00000001': { eventId: 'evt_init', sessionId: sessionIdSafe, revision: 1, type: 'cast:sessionCreated', serverAt: Date.now(), payload: {} } },
    audit: {},
  });
  await fb.set(`cast_codes/${code}`, { sessionId: sessionIdSafe, created_at: Date.now() });

  return { sessionId: sessionIdSafe, joinCode: code };
}

// ── Reads ──
export async function getSessionMeta(sessionId) {
  const snap = await fb.get(`${S(sessionId)}/meta`);
  return snap.exists() ? snap.val() : null;
}

export async function getConfig(sessionId) {
  const snap = await fb.get(`${S(sessionId)}/config`);
  return snap.exists() ? snap.val() : null;
}

/**
 * Active (tugamagan) sessionlar soni — C5-09 item 20 admission uchun.
 * Tier cap'dan yuqori bo'lsa yangi session create rad qilinadi.
 * Real Firebase'da this limited query; local'da to'liq skan (SLO monitoring).
 */
export async function countActiveSessions() {
  const snap = await fb.get('cast_sessions');
  if (!snap.exists()) return 0;
  const all = snap.val();
  let active = 0;
  for (const id of Object.keys(all)) {
    const meta = all[id] && all[id].meta;
    const state = all[id] && all[id].state;
    if (meta && meta.endedAt) continue; // explicit end
    if (state && state.phase === 'ENDED') continue;
    active++;
  }
  return active;
}

export async function getState(sessionId) {
  const snap = await fb.get(`${S(sessionId)}/state`);
  return snap.exists() ? snap.val() : null;
}

export async function getPublicQuestion(sessionId, questionId) {
  const snap = await fb.get(`${S(sessionId)}/questions_public/${questionId}`);
  return snap.exists() ? snap.val() : null;
}

export async function getPrivateQuestion(sessionId, questionId) {
  const snap = await fb.get(`${P(sessionId)}/questions/${questionId}`);
  return snap.exists() ? snap.val() : null;
}

export async function getPublicQuestions(sessionId) {
  const snap = await fb.get(`${S(sessionId)}/questions_public`);
  return snap.exists() ? snap.val() : {};
}

export async function getPrivateQuestions(sessionId) {
  const snap = await fb.get(`${P(sessionId)}/questions`);
  return snap.exists() ? snap.val() : {};
}

export async function resolveSessionByCode(code) {
  const normalized = String(code || '').toUpperCase().replace(/[\s-]/g, '');
  if (!normalized) return null;
  const snap = await fb.get(`cast_codes/${normalized}`);
  if (!snap.exists()) return null;
  const val = snap.val();
  return val.sessionId || null;
}

// ── Roles ──
export async function getRole(sessionId, actorId) {
  const snap = await fb.get(`${S(sessionId)}/roles/${encodeURIComponent(actorId)}`);
  return snap.exists() ? snap.val() : null;
}

export async function upsertRole(sessionId, roleRecord) {
  await fb.set(`${S(sessionId)}/roles/${encodeURIComponent(roleRecord.actorId)}`, roleRecord);
}

// ── Participants ──
export async function upsertParticipant(sessionId, participant) {
  await fb.set(`${S(sessionId)}/participants/${participant.participantId}`, participant);
}

export async function getParticipant(sessionId, participantId) {
  const snap = await fb.get(`${S(sessionId)}/participants/${participantId}`);
  return snap.exists() ? snap.val() : null;
}

export async function listParticipants(sessionId) {
  const snap = await fb.get(`${S(sessionId)}/participants`);
  return snap.exists() ? snap.val() : {};
}

export async function markPresence(sessionId, participantId, presence, lastSeen) {
  await fb.update(`${S(sessionId)}/participants/${participantId}`, {
    presence,
    last_seen: lastSeen || Date.now(),
  });
}

export async function removeParticipant(sessionId, participantId) {
  await fb.remove(`${S(sessionId)}/participants/${participantId}`);
}

// ── Answers (private) ──
/**
 * Idempotent answer put: first accepted answer immutable.
 * @returns {Promise<{status:string, answer:object, previousAck?:object}>}
 */
export async function putAnswerIfAbsent({ sessionId, questionId, participantId, attemptNo = 1, answerRecord }) {
  const path = `${P(sessionId)}/answers/${questionId}/${participantId}/${attemptNo}`;
  const result = await fb.transaction(path, (current) => {
    if (current && current.status === 'ACCEPTED') {
      // Same commandId → return previous ACK (retry-safe)
      if (current.commandId === answerRecord.commandId) {
        return current; // keep, but flag replay
      }
      // Different commandId → duplicate rejected
      return { ...current, duplicateRejectedAt: Date.now() };
    }
    return answerRecord;
  });

  const value = result.value;
  if (value && value.commandId === answerRecord.commandId && value.status === 'ACCEPTED') {
    return { status: value.replay ? 'REPLAYED_ACK' : 'ACCEPTED', answer: value, replayed: !!value.replay };
  }
  if (value && value.status === 'ACCEPTED' && value.commandId !== answerRecord.commandId) {
    return { status: 'ALREADY_ANSWERED', answer: value };
  }
  return { status: 'ACCEPTED', answer: value };
}

export async function getAnswerStatus(sessionId, questionId, participantId, attemptNo = 1) {
  const snap = await fb.get(`${P(sessionId)}/answers/${questionId}/${participantId}/${attemptNo}`);
  return snap.exists() ? snap.val() : null;
}

export async function listAnswersForQuestion(sessionId, questionId, attemptNo = 1) {
  const snap = await fb.get(`${P(sessionId)}/answers/${questionId}`);
  if (!snap.exists()) return {};
  const all = snap.val();
  const out = {};
  for (const [pid, attempts] of Object.entries(all)) {
    const rec = attempts[attemptNo] || attempts['1'];
    if (rec && rec.status === 'ACCEPTED') out[pid] = rec;
  }
  return out;
}

// ── C4-03 Paper-card scans ──
export async function getCardScans(sessionId, questionId) {
  const snap = await fb.get(`${P(sessionId)}/card_scans/${questionId}`);
  return snap.exists() ? snap.val() : {};
}

// ── Scores ──
export async function getScores(sessionId) {
  const snap = await fb.get(`${S(sessionId)}/scores`);
  return snap.exists() ? snap.val() : {};
}

export async function setScore(sessionId, participantId, scoreRecord) {
  await fb.set(`${S(sessionId)}/scores/${participantId}`, scoreRecord);
}

// ── Session lifecycle ──
export async function endSession(sessionId, endedAt) {
  await fb.update(`${S(sessionId)}/meta`, { ended_at: endedAt || Date.now(), status: 'ended' });
  await fb.set(`${S(sessionId)}/state/endedAt`, endedAt || Date.now());
}

export async function setLobbyLock(sessionId, locked) {
  await fb.update(`${S(sessionId)}/meta`, { lobbyLocked: !!locked });
}

export async function getLobbyLock(sessionId) {
  const meta = await getSessionMeta(sessionId);
  return !!(meta && meta.lobbyLocked);
}
