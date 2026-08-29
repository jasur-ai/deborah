/**
 * Deborah — Cast Hinge Recommendation Engine (C3-02)
 * -------------------------------------------------
 * Pure rule engine: evidence → structured suggestion (MOVE_ON | DISCUSS | RETEACH).
 *
 * Qoidalar:
 * - Recommendation = SUGGESTION object; hech qachon avtomatik command
 *   (next/revote/reteach) yubormaydi — teacher qaror qiladi.
 * - Accuracy bandlari policy config'dan keladi (responsiveTeaching.hinge…),
 *   default bandlar: ≥80% MOVE_ON, 35–79% DISCUSS, <35% RETEACH.
 * - Sample kichik / coverage past bo'lsa INSUFFICIENT_EVIDENCE.
 * - Dominant distractor → misconception signal.
 * - High-confidence wrong → priority signal (C3-04 confidence lens bilan).
 * - Timeout/network failure yuqori → technical caution signal.
 * - Rule version har eventga yoziladi.
 */

export const HINGE_RULE_VERSION = 'hinge_v1';

export const HINGE_RECOMMENDATIONS = {
  MOVE_ON: 'MOVE_ON',
  DISCUSS: 'DISCUSS',
  RETEACH: 'RETEACH',
  INSUFFICIENT_EVIDENCE: 'INSUFFICIENT_EVIDENCE',
};

export const HINGE_SIGNALS = {
  MIXED_ACCURACY: 'MIXED_ACCURACY',
  DOMINANT_DISTRACTOR: 'DOMINANT_DISTRACTOR',
  HIGH_CONFIDENCE_WRONG: 'HIGH_CONFIDENCE_WRONG',
  TECHNICAL_CAUTION: 'TECHNICAL_CAUTION',
  LOW_COVERAGE: 'LOW_COVERAGE',
  LOW_SAMPLE: 'LOW_SAMPLE',
};

/**
 * Default rule policy — config'da bo'lmasa qo'llanadi.
 */
export const HINGE_DEFAULT_POLICY = {
  moveOnAccuracyMin: 0.8,        // ≥80% → MOVE_ON
  discussAccuracyMin: 0.35,      // 35–79% → DISCUSS
  reteachBelow: 0.35,            // <35% → RETEACH
  minAcceptedSample: 5,          // kamroq accepted → INSUFFICIENT_EVIDENCE
  minCoverage: 0.4,              // accepted/eligible < 40% → low coverage signal
  dominantDistractorShare: 0.6,  // dominant noto'g'ri option incorrect'ning ≥60% bo'lsa
  technicalFailureRatio: 0.15,   // (technical+disconnected)/eligible ≥15% → caution
};

/**
 * Pure hinge recommendation.
 *
 * @param {object} evidence — computeQuestionEvidence natijasi
 * @param {object} opts
 * @param {object} [opts.policy] — policy override (responsiveTeaching hinge params)
 * @param {string[]} [opts.correctOptionIds] — to'g'ri javob ID'lari
 *   (faqat director private kanalida; public'da berilmaydi)
 * @param {object} [opts.confidence] — { highConfidenceWrongCount } (C3-04 dan)
 * @returns {{
 *   recommendation: string,
 *   ruleVersion: string,
 *   signals: Array<{code:string, value?:number, optionId?:string, count?:number}>,
 *   allowedActions: string[],
 *   teacherDecision: null|'accept'|'dismiss'|'override',
 *   evidenceSummary: { accepted, eligible, correct, incorrect, accuracyPercent, responseRate }
 * }}
 */
export function recommendHingeAction(evidence, opts = {}) {
  const policy = { ...HINGE_DEFAULT_POLICY, ...(opts.policy || {}) };
  const signals = [];
  const allowedActions = [HINGE_RECOMMENDATIONS.MOVE_ON, HINGE_RECOMMENDATIONS.DISCUSS, HINGE_RECOMMENDATIONS.RETEACH];

  const accepted = evidence.accepted || 0;
  const eligible = evidence.eligible || 0;
  const correct = evidence.correct || 0;
  const incorrect = evidence.incorrect || 0;
  const scorable = correct + incorrect;
  const accuracy = scorable > 0 ? correct / scorable : 0;
  const responseRate = eligible > 0 ? accepted / eligible : 0;

  // ── Evidence sufficiency gates ──
  if (accepted < policy.minAcceptedSample) {
    signals.push({ code: HINGE_SIGNALS.LOW_SAMPLE, value: accepted, min: policy.minAcceptedSample });
    return buildRecommendation(HINGE_RECOMMENDATIONS.INSUFFICIENT_EVIDENCE, signals, allowedActions, evidence);
  }
  if (responseRate < policy.minCoverage) {
    signals.push({ code: HINGE_SIGNALS.LOW_COVERAGE, value: Number(responseRate.toFixed(2)), min: policy.minCoverage });
    return buildRecommendation(HINGE_RECOMMENDATIONS.INSUFFICIENT_EVIDENCE, signals, allowedActions, evidence);
  }

  // ── Accuracy bands ──
  let recommendation;
  if (accuracy >= policy.moveOnAccuracyMin) {
    recommendation = HINGE_RECOMMENDATIONS.MOVE_ON;
  } else if (accuracy >= policy.discussAccuracyMin) {
    recommendation = HINGE_RECOMMENDATIONS.DISCUSS;
    signals.push({ code: HINGE_SIGNALS.MIXED_ACCURACY, value: Number(accuracy.toFixed(2)) });
  } else {
    recommendation = HINGE_RECOMMENDATIONS.RETEACH;
    signals.push({ code: HINGE_SIGNALS.MIXED_ACCURACY, value: Number(accuracy.toFixed(2)) });
  }

  // ── Dominant distractor → misconception signal ──
  // (recommendation'ni o'zgartirmaydi — faqat signal; teacher qaror qiladi)
  const dominant = findDominantDistractor(evidence.distribution, opts.correctOptionIds || [], policy.dominantDistractorShare);
  if (dominant) {
    signals.push({ code: HINGE_SIGNALS.DOMINANT_DISTRACTOR, optionId: dominant.optionId, count: dominant.count });
  }

  // ── High-confidence wrong → priority signal (C3-04 confidence lens) ──
  const highConfidenceWrong = opts.confidence?.highConfidenceWrongCount || 0;
  if (highConfidenceWrong > 0) {
    signals.push({ code: HINGE_SIGNALS.HIGH_CONFIDENCE_WRONG, count: highConfidenceWrong });
  }

  // ── Technical caution ──
  const techRatio = eligible > 0 ? (evidence.technicalFailure + evidence.disconnected) / eligible : 0;
  if (techRatio >= policy.technicalFailureRatio) {
    signals.push({ code: HINGE_SIGNALS.TECHNICAL_CAUTION, value: Number(techRatio.toFixed(2)) });
  }

  return buildRecommendation(recommendation, signals, allowedActions, evidence);
}

function buildRecommendation(recommendation, signals, allowedActions, evidence) {
  return {
    recommendation,
    ruleVersion: HINGE_RULE_VERSION,
    signals,
    allowedActions,
    teacherDecision: null,
    evidenceSummary: {
      accepted: evidence.accepted || 0,
      eligible: evidence.eligible || 0,
      correct: evidence.correct || 0,
      incorrect: evidence.incorrect || 0,
      accuracyPercent: evidence.accuracyPercent || 0,
      responseRate: evidence.responseRate || 0,
    },
  };
}

/**
 * Eng ko'p tanlangan NOTO'G'RI option (dominant distractor).
 * Correct option ID'lari berilsa, ular distribution'dan chiqariladi va
 * qolgan noto'g'ri option'lar orasidan eng kattasi olinadi.
 * Correct ID'lar berilmasa (public kontekst) → null (signal yo'q).
 *
 * @param {Array<{optionId:string, count:number}>} distribution
 * @param {string[]} correctOptionIds
 * @param {number} shareThreshold — dominant noto'g'ri option barcha noto'g'ri
 *   javoblarning ≥60% ini egallagan bo'lsa signal.
 * @returns {{optionId:string, count:number}|null}
 */
function findDominantDistractor(distribution, correctOptionIds, shareThreshold) {
  if (!Array.isArray(distribution) || distribution.length === 0) return null;
  if (!correctOptionIds || correctOptionIds.length === 0) return null; // correct ma'lumoti kerak
  const correctSet = new Set(correctOptionIds);
  const wrongOptions = distribution.filter((d) => !correctSet.has(d.optionId));
  if (wrongOptions.length === 0) return null;
  const top = [...wrongOptions].sort((a, b) => (b.count || 0) - (a.count || 0))[0];
  if (!top || !top.count) return null;
  const second = [...wrongOptions].sort((a, b) => (b.count || 0) - (a.count || 0))[1];
  // Yagona ustun bo'lmasa signal emas (ikki noto'g'ri variant teng bo'lsa)
  if (second && second.count && top.count < second.count * 1.2) return null;
  const totalWrongCount = wrongOptions.reduce((a, b) => a + (b.count || 0), 0);
  if (totalWrongCount > 0 && top.count / totalWrongCount >= shareThreshold) {
    return { optionId: top.optionId, count: top.count };
  }
  return null;
}

/**
 * Teacher decision record — accept | dismiss | override.
 * Event store/audit uchun pure record.
 */
export function recordTeacherDecision({ recommendation, ruleVersion, decision, overrideTo = null, teacherId, sessionId, questionId, at }) {
  return {
    type: 'cast:hingeDecision',
    sessionId,
    questionId,
    recommendation: recommendation?.recommendation || null,
    ruleVersion: ruleVersion || recommendation?.ruleVersion || HINGE_RULE_VERSION,
    decision, // 'accept' | 'dismiss' | 'override'
    overrideTo,
    teacherId,
    at: at || Date.now(),
  };
}

export default { recommendHingeAction, recordTeacherDecision, HINGE_RULE_VERSION, HINGE_RECOMMENDATIONS, HINGE_SIGNALS };
