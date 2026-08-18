/**
 * Deborah — Cast Projections
 * --------------------------
 * Answer key (correctOptionIds) hech qachon public projectionga kirmaydi.
 * - participantQuestion: savol ochiq paytidagi safe projection
 * - revealProjection: faqat policy ruxsat bergan fieldlar
 * - directorPrivateProjection: faqat owner/co-host kanali uchun
 */

import { CAST_PHASES } from '../../utils/cast-constants.js';

/**
 * Participant-safe question projection (savol ochiq paytida).
 * Hech qachon correctOptionIds / explanation / rubric o'z ichiga olmaydi.
 */
export function participantQuestionProjection(publicQuestion, phaseInfo) {
  return {
    questionId: publicQuestion.id,
    type: publicQuestion.type,
    text: publicQuestion.text,
    options: publicQuestion.options.map((o) => ({ id: o.id, text: o.text })),
    media: publicQuestion.media || null,
    isDouble: !!publicQuestion.isDouble,
    phase: phaseInfo.phase,
    openedAt: phaseInfo.openedAt || null,
    closesAt: phaseInfo.closesAt || null,
    revision: phaseInfo.revision,
  };
}

/**
 * Reveal projection — faqat policy ruxsat bergan fieldlar.
 * @param {object} privateQuestion — server-side private question
 * @param {object} opts — { includeExplanation:boolean, includeDistribution:boolean }
 */
export function revealProjection(privateQuestion, opts = {}) {
  const out = {
    questionId: privateQuestion.id,
    correctOptionIds: privateQuestion.correctOptionIds,
  };
  if (opts.includeExplanation && privateQuestion.explanation) {
    out.explanation = privateQuestion.explanation;
  }
  return out;
}

/**
 * Director-private projection — current question + safe aggregate.
 * (Director o'z kanalida ham to'liq answer keyni olmaydi; faqat current
 * safe question + private evidence aggregate yuboriladi.)
 */
export function directorQuestionProjection(publicQuestion, privateQuestion) {
  return {
    questionId: publicQuestion.id,
    type: publicQuestion.type,
    text: publicQuestion.text,
    options: publicQuestion.options.map((o) => ({ id: o.id, text: o.text })),
    isDouble: !!publicQuestion.isDouble,
    // Private faqat director aggregate uchun — correct ids emas
    hasExplanation: !!privateQuestion.explanation,
  };
}

/**
 * Public state projection — Socket'da broadcast qilinadigan safe state.
 */
export function publicStateProjection(state) {
  const { questionId, phase, revision, openedAt, closesAt, pausedAt, totalPausedMs, timerMode, questionPosition, totalQuestions, poeFlow } = state || {};
  // C3-11: POE reconnect — contract public-safe (answer key/correct ids yo'q).
  // Faqat media, timer, ids va timestamp'lar — participant OBSERVATION/EXPLANATION
  // phase'da qayta ulanganda o'z kontekstini tiklay oladi.
  let poe = null;
  if (poeFlow && poeFlow.contract) {
    const c = poeFlow.contract;
    let poePhase = null;
    if (phase === CAST_PHASES.PREDICTION_OPEN) poePhase = 'PREDICTION';
    else if (phase === CAST_PHASES.OBSERVATION) poePhase = 'OBSERVATION';
    else if (phase === CAST_PHASES.EXPLANATION_OPEN) poePhase = 'EXPLANATION';
    else if (poeFlow.analysisShownAt) poePhase = 'ANALYSIS';
    else if (poeFlow.explanationClosedAt) poePhase = 'DONE';
    poe = {
      phase: poePhase,
      flowId: c.flowId,
      predictionQuestionId: c.predictionQuestionId,
      observationId: c.observationId,
      explanationQuestionId: c.explanationQuestionId,
      media: c.media,
      mediaReadyThreshold: c.mediaReadyThreshold,
      timerPolicy: c.timerPolicy,
      predictionClosedAt: poeFlow.predictionClosedAt || null,
      explanationOpenedAt: poeFlow.explanationOpenedAt || null,
      explanationClosedAt: poeFlow.explanationClosedAt || null,
      analysisShownAt: poeFlow.analysisShownAt || null,
      mediaFailed: !!poeFlow.mediaFailed,
      mediaFallbackText: poeFlow.mediaFallbackText || null,
    };
  }
  // C3-12: ORB reconnect — participant ORB_COLLECT'da qayta ulanganda o'z view'ini tiklaydi.
  let orb = null;
  if (state?.orbFlow && state?.orbFlow?.runId) {
    let orbPhase = null;
    if (phase === CAST_PHASES.ORB_COLLECT) orbPhase = 'COLLECT';
    else if (phase === CAST_PHASES.ORB_REVIEW) orbPhase = 'REVIEW';
    orb = {
      phase: orbPhase,
      runId: state.orbFlow.runId,
      prompt: state.orbFlow.prompt || null,
    };
  }
  // C3-14: Choreography — faqat current block TYPE (config hech qachon public emas:
  // promptText/questionId kelgusi blokni oshkor qilmasligi kerak)
  let choreography = null;
  const chor = state?.choreography;
  if (chor && chor.blocks && chor.blocks[chor.currentIndex]) {
    choreography = {
      currentType: chor.blocks[chor.currentIndex].type,
      progress: Math.min(1, (chor.currentIndex + 1) / chor.blocks.length),
      finished: chor.currentIndex >= chor.blocks.length,
    };
  }
  // C3-16: Self-paced room-level flag (public-safe — faqat active/paused,
  // hech qanday cursor/order/rank ma'lumoti kirmaydi)
  let selfPaced = null;
  const sp = state?.selfPaced;
  if (sp && sp.active) {
    selfPaced = {
      active: true,
      paused: !!sp.paused,
      startedAt: sp.startedAt || null,
    };
  }
  return {
    questionId,
    phase,
    revision,
    openedAt,
    closesAt,
    pausedAt,
    totalPausedMs,
    timerMode,
    questionPosition,
    totalQuestions,
    poe,
    orb,
    choreography,
    selfPaced,
  };
}

/**
 * Answer count projection — hech qanday shaxs/answer key yo'q.
 */
export function answerCountProjection(answered, total) {
  return { answered, total };
}

/**
 * Public projector-safe evidence projection (C3-01).
 * Public roomga faqat UMBUMIY count'lar chiqadi — hech qachon
 * individual identity, correct/incorrect split yoki distractor emas.
 */
export function publicEvidenceProjection(evidence) {
  return {
    questionId: evidence.questionId,
    accepted: evidence.accepted,
    responseRate: evidence.responseRate,
    active: evidence.active,
    eligible: evidence.eligible,
    revision: evidence.revision,
  };
}

/**
 * Director-private evidence projection (C3-01) — faqat director room.
 * Barcha aggregate'lar count bilan birga; individual identity yo'q.
 */
export function directorEvidenceProjection(evidence) {
  return {
    questionId: evidence.questionId,
    attemptNo: evidence.attemptNo,
    revision: evidence.revision,
    eligible: evidence.eligible,
    active: evidence.active,
    shown: evidence.shown,
    accepted: evidence.accepted,
    correct: evidence.correct,
    incorrect: evidence.incorrect,
    noResponse: evidence.noResponse,
    notShown: evidence.notShown,
    lateJoin: evidence.lateJoin,
    disconnected: evidence.disconnected,
    technicalFailure: evidence.technicalFailure,
    abstain: evidence.abstain,
    accuracyPercent: evidence.accuracyPercent,
    responseRate: evidence.responseRate,
    participationPercent: evidence.participationPercent,
    distribution: evidence.distribution,
    confidenceCoverage: evidence.confidenceCoverage,
    confidencePercent: evidence.confidencePercent,
    responseTime: evidence.responseTime,
    namedDrilldownAvailable: evidence.namedDrilldownAvailable,
    computedAt: evidence.computedAt,
  };
}
