/**
 * Edikit — Cast Boot Rehydration Job (C5-06 item 10)
 * ---------------------------------------------------
 * Node restart'dan so'ng durable state (Firebase) asosida ACTIVE
 * question timer'larini qayta tiklaydi. State timestamp authoritative:
 * process-local timer registry faqat optimization edi — restart'da
 * state.qestionOpenedAt/closesAt dan qayta hisoblanadi.
 *
 * Tugallanish sharti: node restart active session state/answers'ni
 * yo'qotmaydi (answers/events durable store'da allaqachon saqlanadi).
 */

import { getCurrentState, getEventsAfter } from './event-store.js';
import { scheduleQuestionTimer, cancelSessionTimer } from './timer-service.js';
import { CAST_PHASES } from '../../utils/cast-constants.js';

/**
 * Bitta session uchun timer holatini state'dan tiklash.
 * QUESTION_OPEN / REVOTE_OPEN bo'lsa va closesAt kelajakda bo'lsa —
 * timer'ni re-schedule qiladi (onFire: no-op log; asl close handler
 * session'da qayta ulangan director tomonidan boshqariladi).
 *
 * @returns {Promise<{sessionId:string, rehydrated:boolean, phase:string|null, reason:string|null}>}
 */
export async function rehydrateSessionTimer(sessionId, { onFire = null, now = Date.now() } = {}) {
  const state = await getCurrentState(sessionId);
  if (!state) {
    return { sessionId, rehydrated: false, phase: null, reason: 'NO_STATE' };
  }
  const { phase, questionId, closesAt, questionPosition, totalQuestions, revision } = state;

  const isOpen = phase === CAST_PHASES.QUESTION_OPEN || phase === CAST_PHASES.REVOTE_OPEN;
  if (!isOpen || !questionId || !closesAt) {
    return { sessionId, rehydrated: false, phase: phase || null, reason: 'NOT_OPEN' };
  }

  cancelSessionTimer(sessionId);
  const remaining = Math.max(0, closesAt - now);
  if (remaining <= 0) {
    return { sessionId, rehydrated: false, phase, reason: 'ALREADY_EXPIRED' };
  }

  scheduleQuestionTimer({
    sessionId,
    questionId,
    revision: revision || 1,
    expiresAt: closesAt,
    mode: 'soft',
    onFire: onFire || ((fire) => {
      // Default: timer o'tdi — log. Haqiqiy close davom etgan session'da
      // director command orqali yoki state timestamp orqali bajariladi.
      console.warn(`[Cast Rehydration] timer fired for ${fire.sessionId} (expired while node offline)`);
    }),
  });

  return {
    sessionId,
    rehydrated: true,
    phase,
    reason: `rehydrated q${questionPosition || '?'}/${totalQuestions || '?'} closesAt=${closesAt}`,
  };
}

/**
 * Boot job — barcha ACTIVE session'larni topib timer'larini tiklaydi.
 * @param {Array<string>} sessionIds — active session id ro'yxati
 * @returns {Promise<{scanned:number, rehydrated:number, failed:number, items:Array}>}
 */
export async function rehydrateActiveSessions(sessionIds = [], { now = Date.now() } = {}) {
  const items = [];
  let rehydrated = 0;
  let failed = 0;
  for (const sessionId of sessionIds) {
    try {
      const r = await rehydrateSessionTimer(sessionId, { now });
      items.push(r);
      if (r.rehydrated) rehydrated += 1;
    } catch (_) {
      failed += 1;
      items.push({ sessionId, rehydrated: false, phase: null, reason: 'ERROR' });
    }
  }
  return { scanned: sessionIds.length, rehydrated, failed, items };
}

/**
 * Replay continuity check — event log'ni oxirgi holat bilan solishtiradi.
 * (Item 5 test uchun: recovery adapter support deterministik replay.)
 * @returns {Promise<{sessionId:string, lastEventRevision:number, stateRevision:number, consistent:boolean}>}
 */
export async function checkEventConsistency(sessionId) {
  const state = await getCurrentState(sessionId);
  if (!state) return { sessionId, lastEventRevision: 0, stateRevision: 0, consistent: false, reason: 'NO_STATE' };
  const events = await getEventsAfter(sessionId, 0);
  const lastEventRevision = Math.max(0, ...events.map((e) => e.revision || 0));
  const stateRevision = state.revision || 0;
  return {
    sessionId,
    lastEventRevision,
    stateRevision,
    consistent: lastEventRevision <= stateRevision,
    reason: lastEventRevision === stateRevision ? 'IN_SYNC' : 'STATE_AHEAD',
  };
}

export default {
  rehydrateSessionTimer,
  rehydrateActiveSessions,
  checkEventConsistency,
};
