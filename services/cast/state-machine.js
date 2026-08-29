/**
 * Deborah — Cast Server State Machine
 * -----------------------------------
 * Pure applyEvent(state, event) reducer + allowed transitions.
 * Side effect yo'q — reducer faqat state qaytaradi.
 * Har mutation yangi revision yoki deterministic rejection beradi.
 */

import { CAST_PHASES } from '../../utils/cast-constants.js';
import { CAST_ERROR_CODES as E, CastError } from './errors.js';
// C3-14 Session Choreography
import { advanceRuntime, applyOverride, assertValidJump } from './choreography-service.js';

// Re-export constants for convenience
export { CAST_PHASES };

// ── Allowed command → phases map ──
export const ALLOWED_COMMANDS_BY_PHASE = {
  [CAST_PHASES.LOBBY_OPEN]: ['session:start', 'lock:lobby', 'participant:join', 'session:end'],
  [CAST_PHASES.THINK_TIME]: ['question:open', 'question:pause', 'question:skip', 'poe:launch', 'orb:launch', 'session:end'],
  [CAST_PHASES.QUESTION_OPEN]: ['question:pause', 'time:add', 'question:close', 'session:end', 'quick_prompt:launch', 'mastery:launch'],
  [CAST_PHASES.QUESTION_LOCKED]: ['question:reveal', 'discuss:start', 'mastery:launch', 'poe:launch', 'orb:launch', 'session:end'],
  [CAST_PHASES.REVEAL]: ['question:next', 'leaderboard:show', 'discuss:start', 'revote:open', 'mastery:launch', 'poe:launch', 'orb:launch', 'session:end'],
  [CAST_PHASES.DISCUSSION]: ['discuss:end', 'revote:open', 'question:next', 'session:end'],
  [CAST_PHASES.REVOTE_OPEN]: ['question:close', 'question:reveal', 'session:end'],
  [CAST_PHASES.LEADERBOARD]: ['question:next', 'orb:launch', 'session:end'],
  // C3-11 POE flow
  [CAST_PHASES.PREDICTION_OPEN]: ['question:pause', 'time:add', 'poe:closePrediction', 'session:end'],
  [CAST_PHASES.OBSERVATION]: ['poe:startExplanation', 'poe:mediaAction', 'session:end'],
  [CAST_PHASES.EXPLANATION_OPEN]: ['question:pause', 'time:add', 'poe:closeExplanation', 'session:end'],
  // C3-12 Open-Response Semantic Board
  [CAST_PHASES.ORB_COLLECT]: ['orb:close', 'session:end'],
  [CAST_PHASES.ORB_REVIEW]: ['orb:runCluster', 'orb:manual', 'orb:end', 'session:end'],
  [CAST_PHASES.ENDED]: [],
};

// ── Allowed next-phase map ──
// Session end (ENDED) istalgan phase'dan ruxsat — o'qituvchi har doim tugata oladi.
export const ALLOWED_NEXT_PHASE = {
  [CAST_PHASES.LOBBY_OPEN]: [CAST_PHASES.THINK_TIME],
  [CAST_PHASES.THINK_TIME]: [CAST_PHASES.QUESTION_OPEN, CAST_PHASES.QUESTION_LOCKED, CAST_PHASES.PREDICTION_OPEN],
  [CAST_PHASES.QUESTION_OPEN]: [CAST_PHASES.QUESTION_LOCKED, CAST_PHASES.REVEAL],
  [CAST_PHASES.QUESTION_LOCKED]: [CAST_PHASES.REVEAL, CAST_PHASES.DISCUSSION, CAST_PHASES.PREDICTION_OPEN],
  [CAST_PHASES.REVEAL]: [CAST_PHASES.QUESTION_OPEN, CAST_PHASES.LEADERBOARD, CAST_PHASES.DISCUSSION, CAST_PHASES.REVOTE_OPEN, CAST_PHASES.PREDICTION_OPEN, CAST_PHASES.ORB_COLLECT, CAST_PHASES.ENDED],
  [CAST_PHASES.DISCUSSION]: [CAST_PHASES.REVOTE_OPEN, CAST_PHASES.QUESTION_OPEN, CAST_PHASES.ENDED],
  [CAST_PHASES.REVOTE_OPEN]: [CAST_PHASES.REVEAL, CAST_PHASES.QUESTION_LOCKED],
  [CAST_PHASES.LEADERBOARD]: [CAST_PHASES.QUESTION_OPEN, CAST_PHASES.ORB_COLLECT, CAST_PHASES.ENDED],
  // C3-11 POE flow
  [CAST_PHASES.PREDICTION_OPEN]: [CAST_PHASES.OBSERVATION, CAST_PHASES.ENDED],
  [CAST_PHASES.OBSERVATION]: [CAST_PHASES.EXPLANATION_OPEN, CAST_PHASES.ENDED],
  [CAST_PHASES.EXPLANATION_OPEN]: [CAST_PHASES.QUESTION_LOCKED, CAST_PHASES.ENDED],
  // C3-12 Open-Response Semantic Board
  [CAST_PHASES.ORB_COLLECT]: [CAST_PHASES.ORB_REVIEW, CAST_PHASES.ENDED],
  [CAST_PHASES.ORB_REVIEW]: [CAST_PHASES.QUESTION_OPEN, CAST_PHASES.ENDED],
  [CAST_PHASES.ENDED]: [],
};

/**
 * Initial state for a new session.
 */
export function initialState({ primaryDirectorId, questionIds, questionCount, choreography }) {
  return {
    phase: CAST_PHASES.LOBBY_OPEN,
    revision: 1,
    questionPosition: 0,
    questionId: questionIds?.[0] || null,
    totalQuestions: questionCount || (questionIds ? questionIds.length : 0),
    openedAt: null,
    closesAt: null,
    pausedAt: null,
    totalPausedMs: 0,
    timerMode: 'soft',
    primaryDirectorId: primaryDirectorId || null,
    endedAt: null,
    leaderboardVisible: false,
    // C3-03 Vote→Discuss→Revote
    voteRound: 1,                 // 1 = first vote, 2 = revote
    discussionEndsAt: null,
    discussionInstructions: null,
    // C3-08 Mastery/Transfer/Redemption
    transferSourceQuestionId: null,  // active transfer bo'lsa — manba savol
    masteryFlowType: null,           // TRANSFER | REDEMPTION
    masteryFlowActive: false,
    // C3-11 POE flow
    poeFlow: null,                   // { contract, openedAt, closesAt, predictionClosedAt, explanationOpenedAt, explanationClosedAt, analysisShownAt }
    // C3-12 Open-Response Semantic Board
    orbFlow: null,                   // { runId, prompt, openedAt, closesAt, closedAt }
    // C3-14 Session Choreography (immutable snapshot + runtime pointer)
    choreography: choreography || null,
    // C3-16 Self-Paced Race (room-level flag; cursor'lar private'da)
    selfPaced: {
      active: false,
      paused: false,
      startedAt: null,
    },
  };
}

/**
 * Validate a command against the current phase.
 * Throws CastError with stable code on violation.
 */
export function assertCommandAllowed(state, commandType) {
  if (state.phase === CAST_PHASES.ENDED) {
    throw new CastError(E.SESSION_ENDED, 'Sessiya tugagan');
  }
  const allowed = ALLOWED_COMMANDS_BY_PHASE[state.phase] || [];
  if (!allowed.includes(commandType)) {
    throw new CastError(E.INVALID_PHASE, `Bu holatda "${commandType}" buyrug‘i mavjud emas`, { phase: state.phase });
  }
}

/**
 * Validate a phase transition.
 * ENDED istalgan phase'dan ruxsat (session end har doim mumkin).
 */
export function assertPhaseTransition(state, nextPhase) {
  if (state.phase === nextPhase) return;
  if (nextPhase === CAST_PHASES.ENDED) return; // session end always allowed
  const allowed = ALLOWED_NEXT_PHASE[state.phase] || [];
  if (!allowed.includes(nextPhase)) {
    throw new CastError(E.INVALID_PHASE, `"${state.phase}" → "${nextPhase}" o‘tish mumkin emas`, {
      fromPhase: state.phase,
      toPhase: nextPhase,
    });
  }
}

/**
 * Pure reducer: applyEvent(state, event) → new state.
 * event shape: { type, payload, revision, serverAt }
 */
export function applyEvent(state, event) {
  const s = { ...state };
  const { type, payload = {}, revision } = event;

  switch (type) {
    case 'cast:sessionStarted':
      s.phase = CAST_PHASES.THINK_TIME;
      s.startedAt = payload.startedAt || event.serverAt;
      break;

    case 'cast:questionPreview':
      s.phase = CAST_PHASES.THINK_TIME;
      s.questionPosition = payload.questionPosition ?? s.questionPosition;
      s.questionId = payload.questionId || s.questionId;
      s.openedAt = null;
      s.closesAt = null;
      break;

    case 'cast:questionOpened':
      s.phase = CAST_PHASES.QUESTION_OPEN;
      s.questionPosition = payload.questionPosition ?? s.questionPosition;
      s.questionId = payload.questionId || s.questionId;
      s.openedAt = payload.openedAt;
      s.closesAt = payload.closesAt;
      s.pausedAt = null;
      s.totalPausedMs = s.totalPausedMs || 0;
      s.timerMode = payload.timerMode || s.timerMode;
      // C3-08: transfer ochilganda mastery metadata state'da saqlanadi
      if (payload.masteryFlowType) {
        s.masteryFlowType = payload.masteryFlowType;
        s.masteryFlowActive = true;
      }
      if (payload.transferSourceQuestionId) {
        s.transferSourceQuestionId = payload.transferSourceQuestionId;
      }
      break;

    case 'cast:transferOpened':
      // Transfer/redemption follow-up savol normal question flow bilan ochiladi
      s.phase = CAST_PHASES.QUESTION_OPEN;
      s.questionId = payload.questionId || s.questionId;
      s.openedAt = payload.openedAt;
      s.closesAt = payload.closesAt;
      s.transferSourceQuestionId = payload.sourceQuestionId || s.transferSourceQuestionId;
      s.masteryFlowType = payload.flowType || s.masteryFlowType;
      s.masteryFlowActive = true;
      s.voteRound = 1;
      break;

    case 'cast:transferCompleted':
      // Transfer yakunlandi — mastery flow metadata tozalanadi
      s.masteryFlowActive = false;
      s.transferSourceQuestionId = null;
      s.masteryFlowType = null;
      break;

    // ── C3-11 POE flow ──
    case 'poe:launched': {
      const contract = payload.contract;
      s.phase = CAST_PHASES.PREDICTION_OPEN;
      s.questionId = contract.predictionQuestionId;
      s.openedAt = payload.openedAt;
      s.closesAt = payload.closesAt;
      s.pausedAt = null;
      s.voteRound = 1;
      s.poeFlow = {
        contract,
        openedAt: payload.openedAt,
        closesAt: payload.closesAt,
        predictionClosedAt: null,
        explanationOpenedAt: null,
        explanationClosedAt: null,
        analysisShownAt: null,
        mediaFailed: false,
      };
      break;
    }

    case 'poe:predictionLocked':
      s.phase = CAST_PHASES.OBSERVATION;
      s.closesAt = null;
      s.poeFlow = { ...(s.poeFlow || {}), predictionClosedAt: payload.closedAt || event.serverAt };
      break;

    case 'poe:mediaFailed':
      s.poeFlow = { ...(s.poeFlow || {}), mediaFailed: true, mediaFallbackText: payload.fallbackText || null };
      break;

    case 'poe:explanationOpened':
      s.phase = CAST_PHASES.EXPLANATION_OPEN;
      s.questionId = s.poeFlow?.contract?.explanationQuestionId || s.questionId;
      s.openedAt = payload.openedAt;
      s.closesAt = payload.closesAt;
      s.poeFlow = { ...(s.poeFlow || {}), explanationOpenedAt: payload.openedAt, closesAt: payload.closesAt };
      break;

    case 'poe:explanationLocked':
      s.phase = CAST_PHASES.QUESTION_LOCKED;
      s.closesAt = null;
      s.poeFlow = { ...(s.poeFlow || {}), explanationClosedAt: payload.closedAt || event.serverAt };
      break;

    case 'poe:analysisShown':
      s.phase = CAST_PHASES.REVEAL;
      s.poeFlow = { ...(s.poeFlow || {}), analysisShownAt: payload.shownAt || event.serverAt };
      break;

    // ── C3-12 Open-Response Semantic Board ──
    case 'orb:opened':
      s.phase = CAST_PHASES.ORB_COLLECT;
      s.questionId = null;
      s.openedAt = payload.openedAt;
      s.closesAt = payload.closesAt || null;
      s.pausedAt = null;
      s.voteRound = 1;
      s.orbFlow = {
        runId: payload.runId,
        prompt: payload.prompt || null,
        openedAt: payload.openedAt,
        closesAt: payload.closesAt || null,
        closedAt: null,
      };
      break;

    case 'orb:closed':
      s.phase = CAST_PHASES.ORB_REVIEW;
      s.closesAt = null;
      s.orbFlow = { ...(s.orbFlow || {}), closedAt: payload.closedAt || event.serverAt };
      break;

    case 'orb:ended':
      s.phase = CAST_PHASES.QUESTION_OPEN;
      s.closesAt = null;
      s.orbFlow = null; // ORB yakunlandi — metadata tozalanadi
      break;


    case 'cast:questionPaused':
      s.pausedAt = payload.pausedAt;
      break;

    case 'cast:questionResumed':
      s.totalPausedMs = (s.totalPausedMs || 0) + (payload.pausedDurationMs || 0);
      s.pausedAt = null;
      s.closesAt = payload.closesAt;
      break;

    case 'cast:timeAdded':
      s.closesAt = payload.closesAt;
      break;

    case 'cast:questionClosed':
      // Close → lock: javob olish to'xtaydi, keyingi bosqich reveal
      s.closesAt = payload.closesAt || s.closesAt;
      s.phase = CAST_PHASES.QUESTION_LOCKED;
      break;

    case 'cast:questionLocked':
      s.phase = CAST_PHASES.QUESTION_LOCKED;
      break;

    case 'cast:questionRevealed':
      s.phase = CAST_PHASES.REVEAL;
      break;

    case 'cast:discussionStarted':
      s.phase = CAST_PHASES.DISCUSSION;
      s.discussionEndsAt = payload.discussionEndsAt || null;
      s.discussionInstructions = payload.instructions || null;
      s.voteRound = 1;
      break;

    case 'cast:revoteOpened':
      s.phase = CAST_PHASES.REVOTE_OPEN;
      s.openedAt = payload.openedAt;
      s.closesAt = payload.closesAt;
      s.voteRound = 2; // C3-03: revote — attemptNo=2
      break;

    case 'cast:revoteClosed':
      // Revote yopildi — REVEAL holatiga qaytish (before/after matrix director'ga)
      s.phase = CAST_PHASES.REVEAL;
      s.closesAt = payload.closesAt || s.closesAt;
      break;

    case 'cast:leaderboardShown':
      s.phase = CAST_PHASES.LEADERBOARD;
      s.leaderboardVisible = true;
      break;

    case 'cast:questionNext':
      s.questionPosition = payload.questionPosition ?? s.questionPosition + 1;
      s.questionId = payload.questionId || null;
      s.openedAt = null;
      s.closesAt = null;
      s.pausedAt = null;
      s.phase = CAST_PHASES.THINK_TIME;
      s.poeFlow = null; // C3-11: POE yakunlandi — metadata tozalanadi
      s.orbFlow = null; // C3-12: ORB yakunlandi — metadata tozalanadi
      break;

    case 'cast:sessionEnded':
      s.phase = CAST_PHASES.ENDED;
      s.endedAt = payload.endedAt || event.serverAt;
      break;

    // ── C3-14 Choreography ──
    case 'choreo:override': {
      // Planned next override (item 14-15) — invalid jump rad etiladi (item 16)
      // Replay-determinizm: timestamp reducer'da Date.now() emas, event.serverAt
      if (s.choreography) {
        s.choreography = applyOverride(s.choreography, payload.blockId, payload.by || null, event.serverAt);
      }
      break;
    }

    case 'choreo:advance': {
      // Manual advance (item 13 — director 'next' tugmasi)
      if (s.choreography) {
        s.choreography = advanceRuntime(s.choreography, 'choreo:advance', event.serverAt, payload.by || null);
      }
      break;
    }

    // ── C3-16 Self-Paced Race (room-level flags) ──
    case 'sp:activated':
      s.selfPaced = { active: true, paused: false, startedAt: payload.startedAt || event.serverAt };
      break;

    case 'sp:paused':
      s.selfPaced = { ...(s.selfPaced || {}), paused: true, pausedAt: payload.pausedAt || event.serverAt };
      break;

    case 'sp:resumed':
      s.selfPaced = { ...(s.selfPaced || {}), paused: false, pausedAt: null, totalPausedMs: payload.totalPausedMs || 0 };
      break;

    default:
      // Unknown event: ignore in reducer (replay-safe)
      return s;
  }

  // C3-14: phase-transition event'lar choreography block'ini avtomatik tugatadi
  if (s.choreography && !['choreo:advance', 'choreo:override'].includes(type)) {
    const advanced = advanceRuntime(s.choreography, type, event.serverAt);
    if (advanced !== s.choreography) {
      s.choreography = advanced;
    }
  }

  if (revision !== undefined) s.revision = revision;
  return s;
}

/**
 * Replay events → final state (deterministic).
 */
export function replayEvents(initial, events) {
  let state = { ...initial };
  for (const ev of events) {
    state = applyEvent(state, ev);
  }
  return state;
}
