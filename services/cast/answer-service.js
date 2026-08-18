/**
 * Deborah — Cast Answer Service
 * -----------------------------
 * Server-authoritative answer time va idempotency (G0-05).
 * - Answer unique path: sessionId/questionId/participantId/attemptNo
 * - receivedAt = server Date.now() (client clock IGNORED)
 * - Strict timer: receivedAt > closesAt → reject
 * - Soft timer: late=true marker
 * - Birinchi accepted answer immutable; commandId retry → same ACK
 */

import { fb } from '../../firebase/admin.js';
import { CAST_ERROR_CODES, CastError } from './errors.js';
import { CAST_ANSWER_STATUS, CAST_PHASES } from '../../utils/cast-constants.js';
import { normalizeConfidence } from './confidence-service.js';
import {
  putAnswerIfAbsent,
  getAnswerStatus,
  getPrivateQuestion,
  getState,
} from './session-store.js';
import { calculateQuestionScore } from './scoring.js';
// C3-16 Self-Paced Race
import { isSelfPaced, getCursor, setCursor, advanceCursor, checkCursorExpiry } from './self-paced-service.js';
// C3-17 Power-ups
import { getUsed } from './powerup-service.js';
// C4-01 Team Challenge
import { isTeamsEnabled, isSingleTeamDevice, EVIDENCE_UNIT } from './team-service.js';

/**
 * Submit an answer with server-authoritative time + idempotency.
 *
 * @param {object} input
 * @param {string} input.sessionId
 * @param {string} input.questionId
 * @param {string} input.participantId
 * @param {string} input.commandId
 * @param {string[]} input.selectedOptionIds
 * @param {number} input.attemptNo
 * @param {string} [input.confidence] — low | medium | high (C3-04; grade/score'ga ta'sir qilmaydi)
 * @param {string} [input.teamId] — C4-01: single_team_device'da jamoa ID (responseOwnerId)
 * @param {object} input.config — resolved scoring config
 * @returns {Promise<{status:string, answerId:string, ack:object, scoreRecord?:object}>}
 */
export async function submitAnswer(input) {
  const {
    sessionId,
    questionId,
    participantId,
    commandId,
    selectedOptionIds = [],
    attemptNo = 1,
    confidence,
    teamId,
    config,
  } = input;

  if (!commandId || !participantId || !questionId) {
    throw new CastError(CAST_ERROR_CODES.INVALID_OPTION, 'Javob ma’lumotlari yetarli emas');
  }

  // 1. Read current state + private question (authoritative)
  const state = await getState(sessionId);
  if (!state || state.phase === 'ENDED') {
    throw new CastError(CAST_ERROR_CODES.SESSION_ENDED, 'Sessiya tugagan yoki topilmadi');
  }
  const priv = await getPrivateQuestion(sessionId, questionId);
  if (!priv) {
    throw new CastError(CAST_ERROR_CODES.INVALID_OPTION, 'Savol topilmadi');
  }

  // 2. Validate selected option IDs against private question options
  const validIds = new Set((priv.options || []).map((o) => o.id));
  for (const id of selectedOptionIds) {
    if (!validIds.has(id)) {
      throw new CastError(CAST_ERROR_CODES.INVALID_OPTION, 'Noma’lum variant', { optionId: id });
    }
  }
  const uniqueSelected = [...new Set(selectedOptionIds)];
  if (uniqueSelected.length !== selectedOptionIds.length) {
    throw new CastError(CAST_ERROR_CODES.INVALID_OPTION, 'Takroriy variant');
  }

  // 3. Phase check — question must be open
  if (state.phase !== 'QUESTION_OPEN' && state.phase !== 'REVOTE_OPEN') {
    throw new CastError(CAST_ERROR_CODES.REJECTED_QUESTION_CLOSED, 'Savol yopilgan');
  }
  if (state.questionId !== questionId) {
    throw new CastError(CAST_ERROR_CODES.REJECTED_QUESTION_CLOSED, 'Bu savol uchun javob qabul qilinmaydi');
  }
  // C3-08: Transfer/redemption follow-up savolga normal answerSubmit YO'Q —
  // leaderboard bypass bloklanadi (transfer result alohida yoziladi)
  if (state.masteryFlowActive === true) {
    throw new CastError(CAST_ERROR_CODES.REJECTED_QUESTION_CLOSED, 'Bu savol transfer/redemption uchun — transferSubmit ishlating');
  }
  // C3-11: POE phase'larda normal answerSubmit YO'Q — prediction/explanation alohida
  // command'lar bilan yoziladi (leaderboard'ga hech narsa kirmaydi)
  // C3-12: ORB phase'larida ham answerSubmit yo'q — open response orb:submit orqali
  if ([CAST_PHASES.PREDICTION_OPEN, CAST_PHASES.OBSERVATION, CAST_PHASES.EXPLANATION_OPEN, CAST_PHASES.ORB_COLLECT, CAST_PHASES.ORB_REVIEW].includes(state.phase)) {
    throw new CastError(CAST_ERROR_CODES.REJECTED_QUESTION_CLOSED, 'Bu bosqichda javob qabul qilinmaydi');
  }

  // ── C3-16 Self-Paced: cursor guard ──
  // Participant faqat o'z cursor'idagi joriy savolga javob bera oladi.
  if (isSelfPaced(config)) {
    let cursor = await getCursor(sessionId, participantId);
    if (!cursor || cursor.finishedAt) {
      throw new CastError(CAST_ERROR_CODES.REJECTED_QUESTION_CLOSED, 'Race tugagan yoki cursor mavjud emas');
    }
    // Late-join: race active bo'lsa pending cursor'ni aktivlashamiz (review fix #3)
    if (cursor.status !== 'active') {
      const raceActive = state?.selfPaced?.active;
      if (!raceActive) {
        throw new CastError(CAST_ERROR_CODES.REJECTED_QUESTION_CLOSED, 'Race hali boshlanmagan');
      }
      cursor.status = 'active';
      cursor.startedAt = cursor.startedAt || Date.now();
      cursor.questionOpenedAt = Date.now();
      cursor.questionExpiresAt = Date.now() + (config?.selfPaced?.perQuestionSeconds || 60) * 1000;
      await setCursor(sessionId, participantId, cursor);
    }
    // Expiry bo'lsa — oldin advance qilinadi (javobsiz o'tkazish)
    const expiry = await checkCursorExpiry({ sessionId, participantId });
    if (expiry.expired) {
      throw new CastError(CAST_ERROR_CODES.REJECTED_LATE, 'Vaqt tugadi — keyingi savolga o‘tdingiz');
    }
    const cursorQid = cursor.order[cursor.position];
    if (cursorQid !== questionId) {
      throw new CastError(CAST_ERROR_CODES.REJECTED_QUESTION_CLOSED, 'Bu savol hozir sizning navbatingizda emas');
    }
  }

  // 4. Server-authoritative time
  const receivedAt = Date.now();
  const timerMode = config?.timer?.mode || 'soft';
  const closesAt = state.closesAt;

  // 5. Timer policy check
  let late = false;
  if (timerMode === 'strict' && closesAt && receivedAt > closesAt) {
    throw new CastError(CAST_ERROR_CODES.REJECTED_LATE, 'Vaqt tugagan');
  }
  if (closesAt && receivedAt > closesAt) {
    late = true; // soft timer — accept with late marker
  }

  // 6. Correctness via stable option IDs
  const correctSet = new Set(priv.correctOptionIds || []);
  const isCorrect =
    uniqueSelected.length === correctSet.size &&
    uniqueSelected.every((id) => correctSet.has(id));

  const elapsedMs = Math.max(0, receivedAt - (state.openedAt || receivedAt));

  // ── C3-17 Power-ups (item 8, 9, 10) ──
  // - Hint ishlatilgan bo'lsa metadata answer record'ga yoziladi
  // - Raw correctness (isCorrect) O'ZGARMAYDI
  // - private_redemption → engagement multiplier 1.0 (ball o'zgartirilmaydi)
  const used = (config?.powerUps?.enabled) ? await getUsed(sessionId, participantId).catch(() => ({})) : {};
  const hintUsed = !!used[`hint:${questionId}`];
  const engagementMultiplier = 1; // power-up ballni o'zgartirmaydi (pedagogic safe)

  // 7. Score (pure)
  const limitMs = config?.timer?.mode === 'off' || !closesAt ? 0 : (state.closesAt - (state.openedAt || receivedAt)) || 0;
  const { score, breakdown } = calculateQuestionScore({
    mode: config?.scoring?.mode || 'accuracy',
    isCorrect,
    elapsedMs,
    limitMs: limitMs > 0 ? limitMs : config?.timer?.defaultSeconds * 1000 || 30000,
    config: config?.scoring,
    creditFraction: 1,
    late,
    accepted: true,
    engagementMultiplier,
  });

  // 8. Idempotent write
  // C3-04: confidence alohida field — grade/score'ga kirmaydi, missing = wrong EMAS
  const normalizedConfidence = normalizeConfidence(confidence);

  // ── C4-01 (item 6/7/8): response model split ──
  // single_team_device'da answer team ID bilan yoziladi; individual memberlarga
  // NUSXALANMAYDI (item 8). responseOwnerId = teamId, evidenceUnit = group (item 14).
  const teamsEnabled = isTeamsEnabled(config);
  const singleDevice = isSingleTeamDevice(config);
  let responseOwnerId = participantId;
  let evidenceUnit = EVIDENCE_UNIT.INDIVIDUAL;
  if (teamsEnabled) {
    if (singleDevice) {
      if (!teamId) {
        throw new CastError(CAST_ERROR_CODES.INVALID_OPTION, 'Jamoa aniq emas — single_team_device rejimida jamoa javobi kerak');
      }
      responseOwnerId = teamId;
      evidenceUnit = EVIDENCE_UNIT.GROUP;
    } else {
      // individual_then_aggregate: individual javob, keyin jamoa aggregati
      evidenceUnit = EVIDENCE_UNIT.INDIVIDUAL;
    }
  }

  const answerRecord = {
    answerId: 'ans_' + commandId.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 40) || undefined,
    commandId,
    participantId,
    responseOwnerId, // C4-01: team yoki individual
    evidenceUnit,    // C4-01: group | individual
    questionId,
    selectedOptionIds: uniqueSelected,
    receivedAt,
    elapsedMs,
    late,
    attemptNo,
    voteRound: attemptNo === 2 ? 2 : 1, // C3-03: attemptNo=2 → revote
    confidence: normalizedConfidence,   // C3-04: low|medium|high|null
    // C3-17 (item 8): hint ko'rsatilgani metadata — raw evidence o'zgarishsiz
    powerUps: hintUsed ? { hintUsed: true } : undefined,
    status: 'ACCEPTED',
    isCorrect,
    score,
    breakdown,
  };
  if (!answerRecord.powerUps) delete answerRecord.powerUps;
  // answerId: derive from hash if commandId empty
  if (!answerRecord.answerId) {
    const crypto = await import('crypto');
    answerRecord.answerId = 'ans_' + crypto.createHash('sha256').update(commandId).digest('hex').slice(0, 16);
  }

  // C4-01 (item 7): single_team_device'da answer responseOwnerId (team) bilan yoziladi
  // — duplicate team answer bitta bo'ladi (birinchi member javobi qoladi).
  const result = await putAnswerIfAbsent({
    sessionId,
    questionId,
    participantId: responseOwnerId,
    attemptNo,
    answerRecord,
  });

  if (result.status === 'ALREADY_ANSWERED') {
    throw new CastError(CAST_ERROR_CODES.ALREADY_ANSWERED, 'Javob allaqachon qabul qilingan');
  }

  // ── C3-16 Self-Paced: answer'dan so'ng cursor advance + next safe question ──
  // Review fix #1: faqat birinchi ACCEPTED'da advance — REPLAYED_ACK (ACK lost retry)
  // cursor'ni ikki marta o'tkazib yubormaydi.
  let nextCursor = null;
  if (isSelfPaced(config) && result.status === 'ACCEPTED') {
    const cur = await getCursor(sessionId, participantId);
    if (cur && !cur.finishedAt) {
      cur.answeredCount = (cur.answeredCount || 0) + 1;
      await setCursor(sessionId, participantId, cur);
      const adv = await advanceCursor({ sessionId, participantId, config });
      nextCursor = adv.cursor;
    }
  }

  return {
    status: result.status === 'REPLAYED_ACK' ? 'REPLAYED_ACK' : 'ACCEPTED',
    answerId: result.answer.answerId,
    ack: {
      ok: true,
      commandId,
      answerId: result.answer.answerId,
      status: result.answer.status,
      serverAt: Date.now(),
      revision: state.revision,
      isCorrect,
      score,
      // C3-16: next cursor projection (faqat o'ziga) — frontend keyingi savolga o'tadi
      selfPaced: nextCursor ? { nextQuestionId: nextCursor.currentQuestionId, progress: nextCursor.progress, finished: nextCursor.status === 'finished' } : null,
    },
    scoreRecord: {
      participantId: responseOwnerId, // C4-01: team bo'lsa jamoa balli (individual emas)
      responseOwnerId,
      evidenceUnit,
      total: score,
      breakdown,
      updatedAt: Date.now(),
    },
  };
}

/**
 * Get my answer status (ACK lost recovery).
 */
export async function getMyAnswerStatus(sessionId, questionId, participantId, attemptNo = 1) {
  const rec = await getAnswerStatus(sessionId, questionId, participantId, attemptNo);
  if (!rec) return { status: 'NO_ANSWER' };
  return {
    status: rec.status,
    answerId: rec.answerId,
    commandId: rec.commandId,
    serverAt: rec.receivedAt,
    revision: (await getState(sessionId))?.revision || 0,
  };
}
