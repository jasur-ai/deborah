/**
 * Edikit — Cast Rehearsal Service (C3-15)
 * ----------------------------------------
 * Teacher production participantlarsiz sessionni botlar bilan tekshiradi.
 *
 * Isolation (item 2, 13):
 * - Rehearsal session `meta.environment = 'simulation'` bilan yaratiladi.
 * - Bot participantʻlar `bot:` namespaceʻda (dedicated).
 * - Rehearsal maʻlumotlari production leaderboard, roster va institusional
 *   metriclarga KIRMAYDI — quality report alohida namespaceʻda saqlanadi.
 */

import { fb } from '../../firebase/admin.js';
import { CastError, CAST_ERROR_CODES } from './errors.js';
import { initialState } from './state-machine.js';
import { commitEvent } from './event-store.js';
import { getState, getSessionMeta, listParticipants, endSession } from './session-store.js';
import { listBots, removeAllBots, isBot } from './bot-simulator.js';

export const REHEARSAL_ENV = 'simulation';
export const PRODUCTION_ENV = 'production';

/** Rehearsal session ekanini aniqlash (meta). */
export function isRehearsal(meta) {
  return Boolean(meta && meta.environment === REHEARSAL_ENV);
}

/** Production metriclarga kirishi mumkin boʻlmagan session (item 13). */
export function excludeFromMetrics(meta) {
  return isRehearsal(meta) || Boolean(meta?.excludeFromMetrics);
}

/** Rehearsal meta marker. */
export function rehearsalMeta(extra = {}) {
  return {
    environment: REHEARSAL_ENV,
    rehearsal: true,
    createdFor: 'quality_lab',
    ...extra,
  };
}

/**
 * Reset rehearsal (item 8) — answers/scores tozalanadi, bots saqlanadi,
 * state lobbiga qaytadi. Production sessionlarda TAQIQLANADI.
 * @returns {Promise<{ok:boolean, revision:number}>}
 */
export async function resetRehearsal(sessionId, primaryDirectorId = null) {
  const meta = await getSessionMeta(sessionId);
  if (!meta) throw new CastError(CAST_ERROR_CODES.SESSION_NOT_FOUND, 'Sessiya topilmadi');
  if (!isRehearsal(meta)) {
    throw new CastError(CAST_ERROR_CODES.NOT_AUTHORIZED, 'Reset faqat rehearsal sessiyalarda ruxsat');
  }

  // 1. Answers + scores tozala
  await fb.remove(`cast_private/${sessionId}/answers`);
  await fb.remove(`cast_sessions/${sessionId}/scores`);
  await fb.remove(`cast_sessions/${sessionId}/participants`);

  // 2. Botsʻni qayta yaratamiz (roster saqlanadi)
  const bots = await listBots(sessionId);

  // 3. Stateʻni lobbiga qaytar
  const state = await getState(sessionId);
  const fresh = initialState({ primaryDirectorId, questionCount: state?.totalQuestions || 0 });
  const event = { type: 'choreo:advance', payload: {}, serverAt: Date.now() };
  // Reset event — phase LOBBY_OPEN
  const resetEvent = {
    type: 'cast:questionPreview',
    payload: { questionPosition: 0 },
    serverAt: Date.now(),
  };
  // Eng toza yoʻl: stateʻni toʻg'ridan-toʻg'ri yozamiz (revision +1)
  const cur = await getState(sessionId);
  const freshState = {
    ...initialState({ primaryDirectorId, questionCount: cur?.totalQuestions || 0 }),
    revision: (cur?.revision || 0) + 1,
  };
  await fb.set(`cast_sessions/${sessionId}/state`, freshState);

  // Botsʻni qayta upsert
  for (const b of bots) {
    await fb.set(`cast_sessions/${sessionId}/participants/${b.participantId}`, b);
  }

  return { ok: true, revision: freshState.revision, botsKept: bots.length };
}

/**
 * Stop rehearsal (item 8) — sessionni tugatadi.
 */
export async function stopRehearsal(sessionId) {
  const meta = await getSessionMeta(sessionId);
  if (!meta) throw new CastError(CAST_ERROR_CODES.SESSION_NOT_FOUND, 'Sessiya topilmadi');
  if (!isRehearsal(meta)) {
    throw new CastError(CAST_ERROR_CODES.NOT_AUTHORIZED, 'Stop faqat rehearsal sessiyalarda ruxsat');
  }
  await endSession(sessionId, Date.now());
  return { ok: true };
}

/**
 * Rehearsal roster projection — botʻlar real participantlardan ajratiladi (item 2).
 * @returns {Promise<{bots:Array, real:Array}>}
 */
export async function rehearsalRoster(sessionId) {
  const participants = await listParticipants(sessionId);
  const all = Object.values(participants);
  return {
    bots: all.filter((p) => isBot(p.participantId)),
    real: all.filter((p) => !isBot(p.participantId)),
  };
}

/** Rehearsal session yaratish uchun tekshiruv + meta qaytarish. */
export async function assertRehearsalAllowed(ownerActorId) {
  if (!ownerActorId) throw new CastError(CAST_ERROR_CODES.NOT_AUTHORIZED, 'Avtorizatsiya talab qilinadi');
  return true;
}

/** Quality report — productionʻdan alohida namespace (item 13). */
export const QUALITY_ROOT = (sessionId) => `cast_private/${sessionId}/quality`;

export default {
  REHEARSAL_ENV,
  PRODUCTION_ENV,
  isRehearsal,
  excludeFromMetrics,
  rehearsalMeta,
  resetRehearsal,
  stopRehearsal,
  rehearsalRoster,
  assertRehearsalAllowed,
  QUALITY_ROOT,
};
