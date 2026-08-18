/**
 * Deborah — Cast Misconception Map (C3-05)
 * -----------------------------------------
 * Distractor metadata teacher tasdiqlaydigan misconception signaliga aylanadi.
 * - Har question option'ida misconceptionId (optional).
 * - Misconception registry: misconceptionId → { title, explanation, contrastExampleId, followUpItemId }.
 * - Dominant distractor mavjud misconception mapping bo'lsa → Director card.
 * - Teacher confirm/reject → action pack.
 * - Mapping versioni session snapshotga pin qilinadi.
 * - Student individualini misconception label bilan saqlamaymiz (faqat aggregate).
 */

import { CAST_ERROR_CODES, CastError } from './errors.js';

/** Misconception registry version (bump on schema change). */
export const MISCONCEPTION_VERSION = 'misconception_v1';

/** Default misconception registry — extendable via teacher authoring. */
export const MISCONCEPTION_REGISTRY = {
  'mean_ignores_repeated_values': {
    misconceptionId: 'mean_ignores_repeated_values',
    title: 'O\'rtacha qiymat takrorlanuvchi sonlarni hisobga olmaydi',
    category: 'statistics',
    defaultExplanation: 'O\'rtacha qiymat hisoblashda barcha sonlar, shu jumladan takrorlanuvchi sonlar ham hisobga olinadi.',
  },
  'confuses_median_mean': {
    misconceptionId: 'confuses_median_mean',
    title: 'Mediana va o\'rtacha aralashadi',
    category: 'statistics',
    defaultExplanation: 'Mediana — tartiblangan qatorning o\'rtasidagi qiymat, o\'rtacha — barcha qiymatlar yig\'indisining soniga nisbati.',
  },
  'ignores_negative_sign': {
    misconceptionId: 'ignores_negative_sign',
    title: 'Manfiy ishorani hisobga olmaydi',
    category: 'arithmetic',
    defaultExplanation: 'Manfiy sonlar bilan amallar bajarishda ishorani hisobga olish kerak.',
  },
  'friction_always_opposes_motion': {
    misconceptionId: 'friction_always_opposes_motion',
    title: 'Ishqalanish kuchi harakatga qarshi',
    category: 'physics',
    defaultExplanation: 'Ishqalanish kuchi har doim nisbiy harakatga qarshi yo\'nalgan.',
  },
  'confuses_current_voltage': {
    misconceptionId: 'confuses_current_voltage',
    title: 'Tok va kuchlanish aralashadi',
    category: 'physics',
    defaultExplanation: 'Tok — zaryadlarning oqimi, kuchlanish — potensiallar farqi.',
  },
};

/**
 * Look up misconception by ID.
 * @param {string} id
 * @returns {object|null}
 */
export function getMisconception(id) {
  return MISCONCEPTION_REGISTRY[id] || null;
}

/**
 * Build misconception mapping from optionId → misconceptionId data.
 * @param {object} misconceptionByOptionId — { optionId: misconceptionId }
 * @param {object} privateQuestion — private question (with correctOptionIds)
 * @returns {Array<{optionId:string, misconception:object|null, isCorrect:boolean}>}
 */
export function buildOptionMisconceptionMap(misconceptionByOptionId = {}, privateQuestion = {}) {
  const correctSet = new Set(privateQuestion.correctOptionIds || []);
  const options = privateQuestion.options || [];
  return options.map((o) => ({
    optionId: o.id,
    misconception: getMisconception(misconceptionByOptionId[o.id]) || null,
    isCorrect: correctSet.has(o.id),
  }));
}

/**
 * Build a misconception card for a dominant distractor.
 * @param {object} dominantSignal — { optionId, count } from hinge engine
 * @param {object} optionMap — buildOptionMisconceptionMap result
 * @param {object} evidence — evidence for counts
 * @returns {object|null} teacher card or null if no mapping
 */
export function buildDominantDistractorCard(dominantSignal, optionMap, evidence) {
  if (!dominantSignal || !optionMap) return null;
  const entry = optionMap.find((o) => o.optionId === dominantSignal.optionId);
  if (!entry) return null;
  const misconception = entry.misconception;
  if (!misconception) {
    // Mapping yo'q — teacher card faqat unmapped signal
    return {
      optionId: dominantSignal.optionId,
      count: dominantSignal.count,
      total: (evidence.incorrect || 0) + (evidence.correct || 0),
      hasMapping: false,
      misconception: null,
      teacherConfirmed: null,
      teacherExplanation: null,
    };
  }
  return {
    optionId: dominantSignal.optionId,
    count: dominantSignal.count,
    total: (evidence.incorrect || 0) + (evidence.correct || 0),
    hasMapping: true,
    misconception: {
      misconceptionId: misconception.misconceptionId,
      title: misconception.title,
      category: misconception.category,
      defaultExplanation: misconception.defaultExplanation,
    },
    teacherConfirmed: null,
    teacherExplanation: null,
  };
}

/**
 * Record teacher confirmation/rejection of a misconception.
 * @param {object} input
 * @returns {object} audit record
 */
export function recordMisconceptionDecision({ sessionId, questionId, optionId, misconceptionId, confirmed, teacherExplanation, teacherId, at }) {
  return {
    type: 'cast:misconceptionDecision',
    sessionId,
    questionId,
    optionId,
    misconceptionId: confirmed ? misconceptionId : null,
    confirmed,
    teacherExplanation: teacherExplanation || null,
    teacherId,
    at: at || Date.now(),
    version: MISCONCEPTION_VERSION,
  };
}

/**
 * Pin misconception version to session snapshot.
 * @param {object} config — session config
 * @returns {object} pinned map
 */
export function pinMisconceptionVersion(config) {
  return {
    version: MISCONCEPTION_VERSION,
    pinnedAt: Date.now(),
    source: config?.source || null,
  };
}

export default {
  getMisconception,
  buildOptionMisconceptionMap,
  buildDominantDistractorCard,
  recordMisconceptionDecision,
  pinMisconceptionVersion,
  MISCONCEPTION_REGISTRY,
  MISCONCEPTION_VERSION,
};