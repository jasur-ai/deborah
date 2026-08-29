/**
 * Deborah — Versioned Cast Scoring
 * --------------------------------
 * Pure, deterministic scoring functions. Server authoritative.
 * Client clock scorega ta'sir qilmaydi — elapsed server timestamp bilan.
 *
 * Formula (score_v2):
 *   remainingRatio = clamp(1 - elapsedMs / limitMs, 0, 1)
 *   speedComponent = speedBonusMax * remainingRatio ^ alpha
 *   score = round((correctBase * creditFraction + speedComponent) * multiplier)
 */

import { CAST_SCORING_MODE } from '../../utils/cast-constants.js';

export const SCORER_REGISTRY = {
  score_v2: {
    version: 'score_v2',
    alphas: { balanced: 1.5, speed: 1.25, accuracy: 1 },
  },
};

function clamp01(v) {
  return Math.min(1, Math.max(0, v));
}

function roundScore(v) {
  return Math.round(v);
}

/**
 * Calculate a single question score (pure).
 *
 * @param {object} input
 * @param {string} input.mode — scoring mode
 * @param {boolean} input.isCorrect
 * @param {number} input.elapsedMs
 * @param {number} input.limitMs — question time limit (0/undefined = no limit)
 * @param {object} input.config — resolved scoring config {correctBase,speedBonusMax,wrongPoints,multiplier,partialCredit}
 * @param {number} input.creditFraction — 0..1 (partial credit / question-type scorer)
 * @param {boolean} input.late — soft-late marker
 * @param {boolean} input.accepted — false if strict-late rejected
 * @returns {{score:number, breakdown:object}}
 */
export function calculateQuestionScore(input) {
  const {
    mode = CAST_SCORING_MODE.ACCURACY,
    isCorrect = false,
    elapsedMs = 0,
    limitMs = 0,
    config = {},
    creditFraction = 1,
    late = false,
    accepted = true,
    // C3-17: engagement multiplier (power-up) — ball alohida ko'rsatiladi (item 10)
    engagementMultiplier = 1,
  } = input;

  const correctBase = config.correctBase ?? 1000;
  const speedBonusMax = config.speedBonusMax ?? 0;
  const wrongPoints = config.wrongPoints ?? 0;
  const multiplier = config.multiplier ?? 1;
  const alpha = (SCORER_REGISTRY[config.version || 'score_v2']?.alphas || {})[mode] ?? 1;

  // Strict-late → scorega kiritilmaydi
  if (!accepted) {
    return { score: 0, breakdown: { mode, isCorrect, creditFraction: 0, base: 0, speed: 0, multiplier, total: 0, late, accepted: false } };
  }

  let base = 0;
  if (mode === CAST_SCORING_MODE.NO_POINTS) {
    // Raw correctness saqlanadi, ball yo'q
    return {
      score: 0,
      breakdown: { mode, isCorrect, creditFraction, base: 0, speed: 0, multiplier, total: 0, late, accepted: true, rawCorrect: isCorrect },
    };
  }

  if (mode === CAST_SCORING_MODE.PARTICIPATION) {
    const fixedPoints = config.participationPoints ?? 100;
    return {
      score: roundScore(fixedPoints * multiplier * engagementMultiplier),
      breakdown: { mode, isCorrect, creditFraction: 1, base: fixedPoints, speed: 0, multiplier, engagementMultiplier, total: roundScore(fixedPoints * multiplier * engagementMultiplier), late, accepted: true },
    };
  }

  const credit = clamp01(creditFraction);
  if (isCorrect) {
    base = correctBase * credit;
  } else {
    base = wrongPoints;
  }

  // Soft-late → speed bonus 0
  let speed = 0;
  const eligibleForSpeed = isCorrect && !late && limitMs > 0 && speedBonusMax > 0;
  if (eligibleForSpeed) {
    const remainingRatio = clamp01(1 - elapsedMs / limitMs);
    speed = speedBonusMax * Math.pow(remainingRatio, alpha);
  }

  // C3-17 (item 10): engagement multiplier (power-up) — total'ga qo'llanadi,
  // lekin base/speed alohida ko'rsatiladi; raw correctness O'ZGARMAYDI.
  const preEngagement = roundScore((base + speed) * multiplier);
  const total = roundScore(preEngagement * engagementMultiplier);

  return {
    score: total,
    breakdown: {
      scoringVersion: 'score_v2',
      mode,
      isCorrect,
      creditFraction: credit,
      base: roundScore(base),
      speed: roundScore(speed),
      multiplier,
      engagementMultiplier,
      preEngagement,
      total,
      late,
      accepted: true,
    },
  };
}

/**
 * Participation points for participation mode.
 */
export function participationPoints(input) {
  const { config = {}, accepted = true } = input;
  if (!accepted) return 0;
  return config.participationPoints ?? 100;
}

/**
 * Compute accuracy percent with numerator/denominator (evidence contract).
 */
export function accuracyPercent(correctCount, scorableCount) {
  if (!scorableCount) return null;
  return Math.round((correctCount / scorableCount) * 100);
}
