/**
 * Deborah — Cast Mastery, Transfer va Redemption Service (C3-08)
 * --------------------------------------------------------------
 * Teacher equivalent transfer yoki redemption itemini ishga tushiradi;
 * learning progress original leaderboarddan alohida saqlanadi.
 *
 * Contract:
 *   {
 *     sourceQuestionId: "q_04",
 *     followUpQuestionId: "q_18",
 *     type: "TRANSFER",            // TRANSFER | REDEMPTION
 *     attemptNo: 1,
 *     leaderboardImpact: "NONE"    // original leaderboard o'zgarmaydi
 *   }
 *
 * Tugallanish sharti:
 *   - Redemption score va original competition score alohida.
 */

import { CAST_ERROR_CODES, CastError } from './errors.js';

// ── Transfer / Redemption types ──
export const MASTERY_FLOW_TYPES = {
  TRANSFER: 'TRANSFER',       // equivalent skill — normal question flow
  REDEMPTION: 'REDEMPTION',   // re-attempt after wrong answer
};

export const MASTERY_FLOW_TYPE_LIST = Object.values(MASTERY_FLOW_TYPES);

// ── Leaderboard impact ──
export const LEADERBOARD_IMPACT = {
  NONE: 'NONE',               // original leaderboard o'zgarmaydi (default)
  SEPARATE: 'SEPARATE',       // alohida learning progress leaderboard
};

// ── Learning progress statuses ──
export const LEARNING_PROGRESS = {
  FIRST_WRONG_TRANSFER_CORRECT: 'first_wrong_transfer_correct', // ✗→✓ transfer orqali
  FIRST_CORRECT_STAYS: 'first_correct_stays',                   // ✓→✓ (barqaror)
  FIRST_WRONG_REDEEMED_CORRECT: 'first_wrong_redeemed_correct', // ✗→✓ redemption orqali
  FIRST_WRONG_REDEEMED_WRONG: 'first_wrong_redeemed_wrong',     // ✗→✗ (hali o'zlashtirilmagan)
  FIRST_WRONG_NO_FOLLOWUP: 'first_wrong_no_followup',           // ✗, follow-up yo'q
};

// ── Default redemption attempt limit ──
export const DEFAULT_REDEMPTION_LIMIT = 3;

/**
 * Validate a transfer/redemption mapping request.
 * @param {object} input
 * @param {string} input.sourceQuestionId
 * @param {string} input.followUpQuestionId
 * @param {string} input.type — TRANSFER | REDEMPTION
 * @param {object} input.privateQuestions — { qid: privateQuestion }
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validateTransferMapping({ sourceQuestionId, followUpQuestionId, type, privateQuestions = {} }) {
  const errors = [];

  if (!sourceQuestionId) {
    errors.push('Manba savol ID talab qilinadi');
  }
  if (!followUpQuestionId) {
    errors.push('Follow-up savol ID talab qilinadi');
  }
  if (!type || !MASTERY_FLOW_TYPE_LIST.includes(type)) {
    errors.push(`Noma'lum flow turi: ${type}`);
  }
  if (sourceQuestionId === followUpQuestionId) {
    errors.push('Follow-up savol manba savoldan farqli bo\'lishi kerak');
  }

  // Mapping validation: both questions must exist in private store
  if (sourceQuestionId && !privateQuestions[sourceQuestionId]) {
    errors.push(`Manba savol topilmadi: ${sourceQuestionId}`);
  }
  if (followUpQuestionId && !privateQuestions[followUpQuestionId]) {
    errors.push(`Follow-up savol topilmadi: ${followUpQuestionId}`);
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Build a mastery flow contract (teacher → server).
 * @returns {object} contract per plan C3-08
 */
export function buildMasteryContract({ sourceQuestionId, followUpQuestionId, type, attemptNo = 1, leaderboardImpact = LEADERBOARD_IMPACT.NONE }) {
  return {
    sourceQuestionId,
    followUpQuestionId,
    type,
    attemptNo,
    leaderboardImpact,
  };
}

/**
 * Compute learning progress record from source + follow-up answers.
 * @param {object} input
 * @param {object} input.sourceAnswer — answer on the original question (attemptNo=1)
 * @param {object} input.followUpAnswer — answer on the transfer/redemption question
 * @param {string} input.type — TRANSFER | REDEMPTION
 * @returns {object} learning progress record
 */
export function computeLearningProgress({ sourceAnswer, followUpAnswer, type }) {
  const sourceCorrect = !!sourceAnswer?.isCorrect;
  const followUpCorrect = !!followUpAnswer?.isCorrect;

  let status;
  if (sourceCorrect) {
    status = LEARNING_PROGRESS.FIRST_CORRECT_STAYS;
  } else if (type === MASTERY_FLOW_TYPES.REDEMPTION) {
    status = followUpCorrect
      ? LEARNING_PROGRESS.FIRST_WRONG_REDEEMED_CORRECT
      : LEARNING_PROGRESS.FIRST_WRONG_REDEEMED_WRONG;
  } else {
    // TRANSFER
    status = followUpCorrect
      ? LEARNING_PROGRESS.FIRST_WRONG_TRANSFER_CORRECT
      : LEARNING_PROGRESS.FIRST_WRONG_NO_FOLLOWUP;
  }

  return {
    sourceQuestionId: sourceAnswer?.questionId || null,
    followUpQuestionId: followUpAnswer?.questionId || null,
    type,
    sourceCorrect,
    followUpCorrect,
    status,
    wrongToCorrect: !sourceCorrect && followUpCorrect,
    at: Date.now(),
  };
}

/**
 * Check redemption attempt limit (unlimited trial-and-error bloklash).
 * @param {object} input
 * @param {number} input.attemptsUsed — redemption attempts so far
 * @param {number} [input.limit] — config redemptionAttemptLimit (default 3)
 * @returns {{ allowed: boolean, remaining: number }}
 */
export function checkRedemptionLimit({ attemptsUsed = 0, limit = DEFAULT_REDEMPTION_LIMIT }) {
  const remaining = Math.max(0, limit - attemptsUsed);
  return { allowed: remaining > 0, remaining };
}

/**
 * Build action pack next-step entry.
 * @param {object} input
 * @returns {object} action pack record
 */
export function buildNextStep({ sessionId, questionId, status, followUpQuestionId = null, flowType }) {
  return {
    sessionId,
    questionId,
    followUpQuestionId,
    flowType,
    status,
    nextStep: status === LEARNING_PROGRESS.FIRST_WRONG_REDEEMED_WRONG
      ? 'qayta_ogatish'  // teacher reteach
      : status === LEARNING_PROGRESS.FIRST_WRONG_REDEEMED_CORRECT
        ? 'mustahkamlash' // reinforcement
        : status === LEARNING_PROGRESS.FIRST_WRONG_TRANSFER_CORRECT
          ? 'transfer_oylashtirildi' // transfer mastered
          : 'davom_etish',
    at: Date.now(),
  };
}

export default {
  MASTERY_FLOW_TYPES,
  MASTERY_FLOW_TYPE_LIST,
  LEADERBOARD_IMPACT,
  LEARNING_PROGRESS,
  DEFAULT_REDEMPTION_LIMIT,
  validateTransferMapping,
  buildMasteryContract,
  computeLearningProgress,
  checkRedemptionLimit,
  buildNextStep,
};