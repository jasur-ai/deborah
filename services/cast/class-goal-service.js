/**
 * Deborah — Cast Whole-Class Goal Service (C3-09)
 * ------------------------------------------------
 * Competitiondan tashqari class cooperative progress ko'rsatiladi.
 * Projector cardda individual ayb/rank ko'rsatilmaydi — faqat
 * aggregate class progress.
 *
 * Goal types:
 *   accuracy_threshold       — class accuracy >= target%
 *   misconceptions_resolved  — resolved misconception count >= target
 *   knowledge_points         — correct answers count >= target
 *   mastery_rounds           — mastery flow completed count >= target
 *
 * Tugallanish sharti:
 *   Cooperative goal leaderboarddan mustaqil ishlaydi.
 */

import { CAST_ERROR_CODES, CastError } from './errors.js';

// ── Goal types ──
export const CLASS_GOAL_TYPES = {
  ACCURACY_THRESHOLD: 'accuracy_threshold',
  MISCONCEPTIONS_RESOLVED: 'misconceptions_resolved',
  KNOWLEDGE_POINTS: 'knowledge_points',
  MASTERY_ROUNDS: 'mastery_rounds',
};

export const CLASS_GOAL_TYPE_LIST = Object.values(CLASS_GOAL_TYPES);

// ── Goal status ──
export const CLASS_GOAL_STATUS = {
  ACTIVE: 'active',
  COMPLETE: 'complete',
};

/**
 * Validate a class goal config.
 * @param {object} goal — { type, target, unit }
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validateClassGoal(goal) {
  const errors = [];
  if (!goal || typeof goal !== 'object') {
    return { valid: false, errors: ['Goal config talab qilinadi'] };
  }
  if (!goal.type || !CLASS_GOAL_TYPE_LIST.includes(goal.type)) {
    errors.push(`Noma'lum goal turi: ${goal.type}`);
  }
  const target = Number(goal.target);
  if (isNaN(target) || target <= 0) {
    errors.push('Goal target musbat son bo\'lishi kerak');
  }
  if (goal.type === CLASS_GOAL_TYPES.ACCURACY_THRESHOLD && (target > 100 || target < 1)) {
    errors.push('Accuracy target 1–100 oralig\'ida bo\'lishi kerak');
  }
  return { valid: errors.length === 0, errors };
}

/**
 * Compute class goal progress from evidence events.
 * @param {object} input
 * @param {object} input.goal — { type, target, unit }
 * @param {object} input.questions — { qid: evidenceSummary }
 * @param {object} input.events — aggregate counters
 * @returns {object} goal progress { type, target, current, percent, status, unit }
 */
export function computeClassGoalProgress({ goal, questions = {}, events = {} }) {
  if (!goal || !goal.type) {
    return { type: null, target: 0, current: 0, percent: 0, status: CLASS_GOAL_STATUS.ACTIVE, unit: null };
  }

  const target = Number(goal.target) || 0;
  let current = 0;
  let unit = '';

  switch (goal.type) {
    case CLASS_GOAL_TYPES.ACCURACY_THRESHOLD: {
      // Class-wide weighted accuracy across answered questions
      let correct = 0;
      let scorable = 0;
      for (const q of Object.values(questions)) {
        correct += q.correct || 0;
        scorable += (q.correct || 0) + (q.incorrect || 0);
      }
      current = scorable > 0 ? Math.round((correct / scorable) * 100) : 0;
      unit = '%';
      break;
    }
    case CLASS_GOAL_TYPES.MISCONCEPTIONS_RESOLVED:
      current = events.misconceptionsResolved || 0;
      unit = 'ta';
      break;
    case CLASS_GOAL_TYPES.KNOWLEDGE_POINTS:
      for (const q of Object.values(questions)) {
        current += q.correct || 0;
      }
      unit = 'ball';
      break;
    case CLASS_GOAL_TYPES.MASTERY_ROUNDS:
      current = events.masteryRoundsCompleted || 0;
      unit = 'ta';
      break;
    default:
      return { type: goal.type, target, current: 0, percent: 0, status: CLASS_GOAL_STATUS.ACTIVE, unit };
  }

  const percent = target > 0 ? Math.min(100, Math.round((current / target) * 100)) : 0;
  const status = current >= target && target > 0 ? CLASS_GOAL_STATUS.COMPLETE : CLASS_GOAL_STATUS.ACTIVE;

  return { type: goal.type, target, current, percent, status, unit };
}

/**
 * Build a goal completion event (aggregate only — no participant blame).
 * @param {object} progress — computeClassGoalProgress result
 * @returns {object|null} goal complete event or null if not complete
 */
export function buildGoalCompleteEvent(progress) {
  if (!progress || progress.status !== CLASS_GOAL_STATUS.COMPLETE) return null;
  return {
    type: 'cast:goalComplete',
    goalType: progress.type,
    target: progress.target,
    current: progress.current,
    completedAt: Date.now(),
    // Individual ayb/rank YO'Q — faqat aggregate
    aggregate: true,
  };
}

/**
 * Extract class-goal-relevant counters from evidence.
 * @param {object} questionEvidence — buildQuestionEvidence result
 * @returns {object} counters { correct, incorrect, accepted, misconceptionsResolved? }
 */
export function evidenceToGoalCounters(evidence) {
  if (!evidence) return { correct: 0, incorrect: 0, accepted: 0 };
  return {
    correct: evidence.correct || 0,
    incorrect: evidence.incorrect || 0,
    accepted: evidence.accepted || 0,
  };
}

export default {
  CLASS_GOAL_TYPES,
  CLASS_GOAL_TYPE_LIST,
  CLASS_GOAL_STATUS,
  validateClassGoal,
  computeClassGoalProgress,
  buildGoalCompleteEvent,
  evidenceToGoalCounters,
};