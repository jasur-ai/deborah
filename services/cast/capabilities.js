/**
 * Deborah — Cast Capabilities
 * ---------------------------
 * Test imkoniyatlarini safe metadata sifatida hisoblaydi.
 * Blocker = Cast'ni boshlab bo'lmaydi; Warning = davom etsa ham ogohlantirish.
 */

import { CAST_QUESTION_TYPES } from '../../utils/cast-constants.js';

const SUPPORTED_TYPES = new Set(Object.values(CAST_QUESTION_TYPES));

/**
 * Analyze questions → type counts + blockers + warnings.
 *
 * @param {Array<{type:string,text:string,options:Array,explanation?:string|null}>} publicQuestions
 * @param {Array<{id:string,correctOptionIds:string[]}>} privateQuestions
 * @returns {{typeCounts:object, blockers:Array, warnings:Array, supportsTeams:boolean, supportsAnswerShuffle:boolean, supportsPartialCredit:boolean}}
 */
export function analyzeTest(publicQuestions, privateQuestions) {
  const typeCounts = {};
  const blockers = [];
  const warnings = [];
  const privateMap = new Map((privateQuestions || []).map((q) => [q.id, q]));

  for (const q of publicQuestions || []) {
    typeCounts[q.type] = (typeCounts[q.type] || 0) + 1;

    // Unsupported type blocker
    if (!SUPPORTED_TYPES.has(q.type)) {
      blockers.push({
        code: 'UNSUPPORTED_QUESTION_TYPE',
        severity: 'BLOCKER',
        questionId: q.id,
        message: `Savol turi qo‘llab-quvvatlanmaydi: ${q.type}`,
      });
    }

    // Missing answer blocker (private side)
    const priv = privateMap.get(q.id);
    if (!priv || !priv.correctOptionIds || priv.correctOptionIds.length === 0) {
      blockers.push({
        code: 'MISSING_ANSWER',
        severity: 'BLOCKER',
        questionId: q.id,
        message: 'To‘g‘ri javob ko‘rsatilmagan',
      });
    }

    // Long stem warning
    if (q.text && q.text.length > 200) {
      warnings.push({
        code: 'LONG_STEM',
        severity: 'WARNING',
        questionId: q.id,
        message: 'Savol matni juda uzun — projector' + 'da o‘qish qiyin',
      });
    }

    // Missing explanation warning
    if (!priv?.explanation) {
      warnings.push({
        code: 'MISSING_EXPLANATION',
        severity: 'WARNING',
        questionId: q.id,
        message: 'Tushuntirish (explanation) yo‘q',
      });
    }
  }

  const supportsTeams = true;
  const supportsAnswerShuffle = true;
  const supportsPartialCredit = true;

  return {
    typeCounts,
    blockers,
    warnings,
    supportsTeams,
    supportsAnswerShuffle,
    supportsPartialCredit,
  };
}

/**
 * Per-question timer recommendation (seconds).
 */
export function recommendTimer(q, defaultSeconds = 30) {
  if (!q) return defaultSeconds;
  const lengthFactor = q.text ? Math.min(2, Math.ceil(q.text.length / 150)) : 1;
  const optionFactor = q.options && q.options.length > 4 ? 1.25 : 1;
  const rec = Math.round(defaultSeconds * lengthFactor * optionFactor);
  return Math.min(120, Math.max(10, rec));
}
