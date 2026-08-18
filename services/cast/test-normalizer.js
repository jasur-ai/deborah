/**
 * Deborah — Cast Question Normalizer
 * ----------------------------------
 * Har qanday formatdagi questionni Cast canonical formatga o'tkazadi:
 * - stable question ID (q_01, q_02, ...)
 * - har optionga alohida stable ID (o_a, o_b, ...) — duplicate text bo'lsa ham
 * - correct index → correctOptionIds (optionId lar)
 * - legacy q_correct / qCorrect hech qayerda saqlanmaydi
 */

import { CAST_QUESTION_TYPES } from '../../utils/cast-constants.js';

const LETTERS = 'abcdefghijklmnopqrstuvwxyz';

function optionIdFor(index) {
  if (index < 26) return 'o_' + LETTERS[index];
  return 'o_' + LETTERS[Math.floor(index / 26) - 1] + LETTERS[index % 26];
}

/**
 * Detect cast question type from raw structure.
 */
export function detectCastType(q) {
  const options = q.options || [];
  if (Array.isArray(q.correct) && q.correct.length > 1) return CAST_QUESTION_TYPES.MULTIPLE_SELECT;
  if (options.length === 2) {
    const texts = options.map((o) => (typeof o === 'object' ? String(o.text || '') : String(o || '')).toLowerCase().trim());
    const tfPair = (texts.includes('to‘g‘ri') || texts.includes("to'g'ri") || texts.includes('true')) &&
      (texts.includes('noto‘g‘ri') || texts.includes("noto'g'ri") || texts.includes('false'));
    if (tfPair) return CAST_QUESTION_TYPES.TRUE_FALSE;
  }
  return CAST_QUESTION_TYPES.SINGLE_CHOICE;
}

/**
 * Extract correct option ids from any raw format.
 */
function extractCorrectIds(q, optionsArr) {
  const rawCorrect = q.correct;
  let indices = [];

  if (Array.isArray(rawCorrect)) {
    // Legacy: array of indices OR array of {isCorrect:true}
    if (rawCorrect.length && typeof rawCorrect[0] === 'object') {
      indices = optionsArr.map((o, i) => (o && o.isCorrect ? i : -1)).filter((i) => i >= 0);
    } else {
      indices = rawCorrect.filter((i) => Number.isInteger(i) && i >= 0);
    }
  } else if (typeof rawCorrect === 'number') {
    indices = rawCorrect >= 0 ? [rawCorrect] : [];
  } else if (Array.isArray(q.options)) {
    indices = optionsArr.map((o, i) => (o && o.isCorrect ? i : -1)).filter((i) => i >= 0);
  }
  return indices;
}

/**
 * Normalize a raw question into canonical Cast form with stable IDs.
 * @param {object} q — raw question (user/mock/pre format)
 * @param {number} index — question position (0-based)
 * @returns {object|null} normalized question
 */
export function normalizeCastQuestion(q, index) {
  if (!q || typeof q !== 'object') return null;
  const rawOptions = q.options || [];
  if (!Array.isArray(rawOptions) || rawOptions.length === 0) return null;

  // Normalize options into {id, text} objects
  const options = rawOptions.map((o, i) => {
    if (o && typeof o === 'object') {
      return { id: optionIdFor(i), text: String(o.text ?? ''), isCorrect: !!o.isCorrect };
    }
    return { id: optionIdFor(i), text: String(o ?? ''), isCorrect: false };
  });

  const correctIndices = extractCorrectIds(q, options);
  // Ensure at least the first option is marked correct for options carrying isCorrect
  if (correctIndices.length === 0) {
    options.forEach((o, i) => { if (o.isCorrect) correctIndices.push(i); });
  }
  if (correctIndices.length === 0) {
    // No correct answer — blocker: question unusable in Cast
    return null;
  }

  const correctOptionIds = correctIndices
    .map((i) => options[i]?.id)
    .filter(Boolean);
  // dedupe + keep order
  const uniqueCorrect = [...new Set(correctOptionIds)];

  const type = detectCastType(q);
  const text = String(q.text ?? '').trim();
  if (!text) return null;

  return {
    id: 'q_' + String(index + 1).padStart(2, '0'),
    type,
    text,
    options: options.map(({ id, text: t }) => ({ id, text: t })),
    correctOptionIds: uniqueCorrect,
    isDouble: !!q.is_double,
    explanation: q.explanation || q.teacherExplanation || null,
    misconceptionByOptionId: q.misconceptionByOptionId || {},
  };
}
