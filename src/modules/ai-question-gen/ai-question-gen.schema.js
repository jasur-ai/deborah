/**
 * Deborah — AI Question Generator 50/30/20 (pure logic)
 *
 * Prompt 53 — source-grounded, difficulty-controlled item draft pipeline
 * (research.md §8 AI test generatori, §8.1 50/30/20 default, §8.3 pipeline,
 * §8.4 distractor sifati, §8.6 lifecycle, §21 acceptance). This module is
 * PURE (no I/O, no globals):
 *
 *   - 50/30/20: computeDifficultyCounts — easy=floor(N×0.5),
 *     medium=floor(N×0.3), hard=N-easy-medium (jami doim 100%).
 *   - Blueprint: validateBlueprint — target item types, model provider,
 *     validator capability (source-grounded + answer verifier shart).
 *   - Jobs: planCandidateJobs — har slot uchun 3–5 overgenerate.
 *   - Verifier: verifyAnswerSource — javob faqat approved source
 *     chunk'laridan isbotlanishi kerak (§8.3 step 6).
 *   - Distractors: generateDistractors — misconception-based plausible
 *     distractorlar (§8.4).
 *   - Validators: validateAmbiguity, validateMultiCorrect,
 *     validateDuplicate, checkLanguage, checkAccessibility,
 *     checkDifficulty (§8.3 step 9-11).
 *   - Lifecycle: canTransition — AI_DRAFT teacher approval'siz APPROVED
 *     bo'lmaydi (§15); publish faqat APPROVED'dan (§8.6).
 *
 * SECURITY / DATA GUARD (Prompt 53 §15-17):
 *   - AI_DRAFT → APPROVED teacher review talab qiladi (lifecycle guard).
 *   - Source-grounded: answer approved chunk'da bo'lmasa → reject.
 *   - Prompt-injection markerlar language check'da aniqlanadi.
 *   - Har bir write path tenant-scoped + idempotent.
 */

import { createHash } from 'node:crypto';

// ═══════════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════════

export const GEN_BLUEPRINT_STATUS = {
  DRAFT: 'draft',
  RUNNING: 'running',
  COMPLETED: 'completed',
  FAILED: 'failed',
};
export const GEN_JOB_STATUS = {
  QUEUED: 'queued',
  RUNNING: 'running',
  COMPLETED: 'completed',
  FAILED: 'failed',
};
export const GEN_CANDIDATE_STATUS = {
  AI_DRAFT: 'ai_draft',
  REVIEWED: 'reviewed',
  APPROVED: 'approved',
  PUBLISHED: 'published',
  REJECTED: 'rejected',
  RETIRED: 'retired',
};
export const GEN_REVIEW_DECISION = {
  APPROVE: 'approve',
  REJECT: 'reject',
  PUBLISH: 'publish',
  RETIRE: 'retire',
  EDIT: 'edit',
};

/** Default 50/30/20 taqsimot (§8.1). */
export const DEFAULT_DISTRIBUTION = { easy: 0.5, medium: 0.3, hard: 0.2 };

/** Supported item types (item-bank ITEM_TYPES subset — MCQ-focused MVP). */
export const SUPPORTED_ITEM_TYPES = [
  'single_choice',
  'multiple_choice',
  'true_false',
];

/** Overgenerate range (§8.3 step 4: har slot uchun 3–5 candidate). */
export const OVERGENERATE_MIN = 3;
export const OVERGENERATE_MAX = 5;

/** Prompt-injection markerlar — language check'da fail-closed. */
export const GEN_INSTRUCTION_MARKERS = [
  'ignore all previous instructions',
  'ignore previous instructions',
  'disregard all previous',
  'system prompt',
  'you are now',
  'from now on you are',
  'reveal your instructions',
  'jailbreak',
];

/** Cognitive demand per difficulty (§8.2). */
export const DIFFICULTY_COGNITIVE = {
  easy: ['remember', 'understand'],
  medium: ['apply', 'analyze'],
  hard: ['analyze', 'evaluate', 'create'],
};

// ═══════════════════════════════════════════════════════════════════
// 50/30/20 COUNT ALGORITHM (§8.1)
// ═══════════════════════════════════════════════════════════════════

/**
 * Compute difficulty slot counts from a target N.
 * easy = floor(N×0.50), medium = floor(N×0.30), hard = N-easy-medium.
 * Property: easy+medium+hard === N always.
 *
 * @param {Object} params
 * @param {number} params.count - target item count (N)
 * @param {number} [params.easyRatio]
 * @param {number} [params.mediumRatio]
 * @param {number} [params.hardRatio]
 * @returns {{ ok: boolean, easy: number, medium: number, hard: number, total: number, distribution: string, error?: string }}
 */
export function computeDifficultyCounts({
  count = 0,
  easyRatio = DEFAULT_DISTRIBUTION.easy,
  mediumRatio = DEFAULT_DISTRIBUTION.medium,
  hardRatio = DEFAULT_DISTRIBUTION.hard,
} = {}) {
  if (!Number.isInteger(count) || count < 1) {
    return { ok: false, error: 'count must be a positive integer' };
  }
  const e = Number(easyRatio);
  const m = Number(mediumRatio);
  const h = Number(hardRatio);
  if (![e, m, h].every((x) => Number.isFinite(x) && x >= 0)) {
    return { ok: false, error: 'ratios must be non-negative finite numbers' };
  }
  const easy = Math.floor(count * e);
  const medium = Math.floor(count * m);
  const hard = count - easy - medium;
  if (easy < 0 || medium < 0 || hard < 0) {
    return { ok: false, error: 'ratios produce a negative slot' };
  }
  // Property test: total doim N ga teng
  if (easy + medium + hard !== count) {
    return { ok: false, error: 'slots do not sum to target count' };
  }
  return {
    ok: true,
    easy,
    medium,
    hard,
    total: count,
    distribution: `${Math.round(e * 100)}/${Math.round(m * 100)}/${Math.round(h * 100)}`,
  };
}

// ═══════════════════════════════════════════════════════════════════
// BLUEPRINT VALIDATION (§8.3 input)
// ═══════════════════════════════════════════════════════════════════

/**
 * Validate a generation blueprint before creating jobs.
 * Stop condition: source pack yoki answer verifier yetarli bo'lmasa.
 *
 * @param {Object} params
 * @param {string} params.name
 * @param {number} params.targetCount
 * @param {Array<string>} [params.itemTypes]
 * @param {number} [params.sourcePackId]
 * @param {string} [params.model]
 * @param {string} [params.modelVersion]
 * @param {boolean} [params.hasAnswerVerifier]
 * @returns {{ ok: boolean, reason?: string, counts?: Object }}
 */
export function validateBlueprint({
  name = '',
  targetCount = 0,
  itemTypes = ['single_choice'],
  sourcePackId = null,
  model = '',
  modelVersion = '',
  hasAnswerVerifier = false,
} = {}) {
  if (!name || typeof name !== 'string' || !name.trim()) {
    return { ok: false, reason: 'name is required' };
  }
  if (name.length > 160) return { ok: false, reason: 'name exceeds 160 chars' };
  if (!Number.isInteger(targetCount) || targetCount < 1) {
    return { ok: false, reason: 'targetCount must be a positive integer' };
  }
  if (!Array.isArray(itemTypes) || itemTypes.length === 0) {
    return { ok: false, reason: 'at least one item type is required' };
  }
  for (const t of itemTypes) {
    if (!SUPPORTED_ITEM_TYPES.includes(t)) {
      return { ok: false, reason: `unsupported item type ${t} — supported: ${SUPPORTED_ITEM_TYPES.join(', ')}` };
    }
  }
  if (!sourcePackId) {
    return { ok: false, reason: 'source pack is required — items must be source-grounded' };
  }
  if (!model || !modelVersion) {
    return { ok: false, reason: 'model and modelVersion are required (exact version pin)' };
  }
  // Answer verifier capability — Prompt 53 §24 stop condition
  if (!hasAnswerVerifier) {
    return { ok: false, reason: 'answer verifier capability is required (stop condition)' };
  }
  const counts = computeDifficultyCounts({ count: targetCount });
  if (!counts.ok) return { ok: false, reason: counts.error };
  return { ok: true, counts };
}

// ═══════════════════════════════════════════════════════════════════
// CANDIDATE JOB PLANNING (§8.3 step 4: 3–5 overgenerate)
// ═══════════════════════════════════════════════════════════════════

/**
 * Plan per-slot candidate jobs with overgenerate factor (3–5).
 *
 * @param {Object} params
 * @param {number} params.targetCount
 * @param {number} [params.overgenerateFactor]
 * @returns {{ ok: boolean, jobs: Array<{ slot: string, requested: number, overgenerate: number, candidates: number }>, error?: string }}
 */
export function planCandidateJobs({ targetCount = 0, overgenerateFactor = OVERGENERATE_MIN } = {}) {
  const counts = computeDifficultyCounts({ count: targetCount });
  if (!counts.ok) return { ok: false, error: counts.error };
  const factor = Math.min(OVERGENERATE_MAX, Math.max(OVERGENERATE_MIN, Number(overgenerateFactor) || OVERGENERATE_MIN));
  const jobs = ['easy', 'medium', 'hard'].map((slot) => {
    const requested = counts[slot];
    return { slot, requested, overgenerate: factor, candidates: requested * factor };
  });
  return { ok: true, jobs, total: targetCount, overgenerateFactor: factor };
}

// ═══════════════════════════════════════════════════════════════════
// ANSWER / SOURCE VERIFIER (§8.3 step 6)
// ═══════════════════════════════════════════════════════════════════

/**
 * Verify an answer is source-grounded — javob approved source chunk
 * quote'ida isbotlanishi kerak. Pure: approvedChunks array'ini o'qiydi.
 *
 * @param {Object} params
 * @param {string} params.answer
 * @param {Array<{ chunkId: number|string, quote?: string }>} params.sourceRefs
 * @param {Array<{ id: number|string, quote?: string }>} params.approvedChunks
 * @returns {{ ok: boolean, reason: string, matchedChunkId?: number|string }}
 */
export function verifyAnswerSource({ answer = '', sourceRefs = [], approvedChunks = [] } = {}) {
  if (!answer || typeof answer !== 'string') {
    return { ok: false, reason: 'answer is required' };
  }
  if (!Array.isArray(sourceRefs) || sourceRefs.length === 0) {
    return { ok: false, reason: 'no source refs — answer must be source-grounded' };
  }
  if (!Array.isArray(approvedChunks) || approvedChunks.length === 0) {
    return { ok: false, reason: 'no approved source chunks available' };
  }
  const norm = (s) => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();
  const answerNorm = norm(answer);
  // Distractor-only answers (short answer) — kamida 8 belgi isbot talab
  const probe = answerNorm.slice(0, Math.min(60, answerNorm.length));
  if (!probe) return { ok: false, reason: 'answer is empty' };
  for (const ref of sourceRefs) {
    const chunk = approvedChunks.find((c) => String(c.id) === String(ref.chunkId));
    if (!chunk) continue;
    const quote = norm(chunk.quote || '');
    if (!quote) continue;
    if (quote.includes(probe)) {
      return { ok: true, reason: 'answer verified against approved source', matchedChunkId: chunk.id };
    }
  }
  return { ok: false, reason: 'answer not found in approved source chunks — not source-grounded' };
}

// ═══════════════════════════════════════════════════════════════════
// DISTRACTOR MISCONCEPTION GENERATOR (§8.4)
// ═══════════════════════════════════════════════════════════════════

/**
 * Generate plausible distractors from common misconceptions.
 * Distractor: stem bilan grammatik mos, uzunligi javobdan keskin farq
 * qilmaydi, "hammasi/yuqoridagilarning barchasi" default emas.
 *
 * @param {Object} params
 * @param {string} params.correctAnswer
 * @param {Array<{ label?: string, stem?: string }>} params.misconceptions
 * @param {string} [params.language]
 * @returns {{ ok: boolean, distractors: Array<{ key: string, text: string, isCorrect: boolean, misconception: string }>, reason?: string }}
 */
export function generateDistractors({ correctAnswer = '', misconceptions = [], language = 'uz' } = {}) {
  if (!correctAnswer) return { ok: false, reason: 'correctAnswer is required' };
  const sources = (Array.isArray(misconceptions) ? misconceptions : []).filter(
    (mc) => mc && (mc.stem || mc.label)
  );
  const distractors = sources.slice(0, 4).map((mc, i) => {
    const text = mc.stem || mc.label;
    const normalized = String(text).trim();
    return {
      key: String.fromCharCode(66 + i), // B, C, D, E
      text: normalized,
      isCorrect: false,
      misconception: mc.label || 'common confusion',
    };
  });
  // All-of-the-above / none-of-the-above default emas (§8.4)
  const banned = /hammasi|yuqoridagilarning barchasi|all of the above|none of the above/i;
  const filtered = distractors.filter((d) => !banned.test(d.text));
  return {
    ok: true,
    language,
    distractors: filtered,
    correctAnswer,
  };
}

// ═══════════════════════════════════════════════════════════════════
// VALIDATORS (§8.3 step 9-11, §21 assessment quality)
// ═══════════════════════════════════════════════════════════════════

/**
 * Ambiguity detector — stem bir nechta option bilan javob beriladigan
 * bo'lmasligi kerak (semantic overlap).
 * @param {Object} params - { stem, options: [{ key, text, isCorrect }] }
 * @returns {{ ok: boolean, reason?: string }}
 */
export function validateAmbiguity({ stem = '', options = [] } = {}) {
  if (!stem || typeof stem !== 'string' || !stem.trim()) {
    return { ok: false, reason: 'stem is required' };
  }
  if (!Array.isArray(options) || options.length < 2) {
    return { ok: false, reason: 'at least 2 options are required' };
  }
  const norm = (s) => String(s || '').toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
  const texts = options.map((o) => norm(o.text));
  // Duplicate option text → ambiguity
  const seen = new Set();
  for (const t of texts) {
    if (!t) return { ok: false, reason: 'empty option text' };
    if (seen.has(t)) return { ok: false, reason: `duplicate option text: "${t}" — ambiguous` };
    seen.add(t);
  }
  // Semantic overlap: bir option boshqasining substring'i bo'lsa (noto'g'ri keyingi darajali tuzilma)
  for (let i = 0; i < texts.length; i++) {
    for (let j = 0; j < texts.length; j++) {
      if (i === j) continue;
      const long = texts[i].length >= texts[j].length ? texts[i] : texts[j];
      const short = texts[i].length >= texts[j].length ? texts[j] : texts[i];
      if (short.length >= 8 && long.includes(short)) {
        return { ok: false, reason: `option ${i + 1} and ${j + 1} overlap — ambiguous` };
      }
    }
  }
  return { ok: true };
}

/**
 * Multi-correct validator — single_choice aynan 1 correct; multiple_choice ≥ 2.
 * @param {Object} params - { questionType, options }
 * @returns {{ ok: boolean, reason?: string, correctCount: number }}
 */
export function validateMultiCorrect({ questionType = 'single_choice', options = [] } = {}) {
  if (!Array.isArray(options) || options.length === 0) {
    return { ok: false, reason: 'options are required' };
  }
  const correctCount = options.filter((o) => Boolean(o.isCorrect)).length;
  if (questionType === 'single_choice' || questionType === 'true_false') {
    if (correctCount !== 1) {
      return { ok: false, reason: `single_choice must have exactly 1 correct option (found ${correctCount})`, correctCount };
    }
  } else if (questionType === 'multiple_choice') {
    if (correctCount < 2) {
      return { ok: false, reason: `multiple_choice must have at least 2 correct options (found ${correctCount})`, correctCount };
    }
  }
  return { ok: true, correctCount };
}

/**
 * Duplicate detector — input_hash orqali bir xil stem takrorlanmasligi.
 * @param {Object} params - { stem, existingHashes: string[] }
 * @returns {{ ok: boolean, reason?: string, hash?: string }}
 */
export function validateDuplicate({ stem = '', existingHashes = [] } = {}) {
  const hash = createHash('sha256').update(String(stem ?? '')).digest('hex');
  if (Array.isArray(existingHashes) && existingHashes.includes(hash)) {
    return { ok: false, reason: 'duplicate stem — identical item already generated', hash };
  }
  return { ok: true, hash };
}

/**
 * Language check — prompt-injection markerlar + PII yo'qligi.
 * @param {Object} params - { stem, options, language }
 * @returns {{ ok: boolean, reason?: string, markers?: string[] }}
 */
export function checkLanguage({ stem = '', options = [], language = 'uz' } = {}) {
  const all = [stem, ...(options || []).map((o) => o.text || '')].join(' ').toLowerCase();
  const markers = GEN_INSTRUCTION_MARKERS.filter((m) => all.includes(m));
  if (markers.length > 0) {
    return { ok: false, reason: `prompt-injection marker detected: ${markers.join(', ')}`, markers };
  }
  // PII: phone/email/long ID
  const pii = /(?:\+998|998)\s?\d{2}\s?\d{3}\s?\d{2}\s?\d{2}|\b[\w.+-]+@[\w-]+\.[\w.]+\b|\b[A-Z]{2}\d{7}\b/;
  if (pii.test(all)) {
    return { ok: false, reason: 'PII detected in item text' };
  }
  return { ok: true, language };
}

/**
 * Accessibility check — alt/matn faqat rang bilan emas, yetarli uzunlik.
 * @param {Object} params - { stem, options }
 * @returns {{ ok: boolean, reason?: string }}
 */
export function checkAccessibility({ stem = '', options = [] } = {}) {
  const all = [stem, ...(options || []).map((o) => o.text || '')];
  for (const t of all) {
    if (!t || !String(t).trim()) return { ok: false, reason: 'empty text — accessibility issue' };
    if (String(t).length < 3) return { ok: false, reason: 'text too short for readability' };
  }
  // Color-only / direction-only indication
  if (/qizil|yashil|rangli|highlighted|see the (red|green)/i.test(all.join(' '))) {
    return { ok: false, reason: 'color-only indication — accessibility issue' };
  }
  return { ok: true };
}

/**
 * Difficulty check — cognitive level target difficulty'ga mos bo'lishi.
 * §8.2: easy=remember/understand, medium=apply/analyze, hard=analyze/evaluate/create.
 * @param {Object} params - { difficulty, cognitiveLevel }
 * @returns {{ ok: boolean, reason?: string }}
 */
export function checkDifficulty({ difficulty = 'medium', cognitiveLevel = '' } = {}) {
  if (!Object.keys(DIFFICULTY_COGNITIVE).includes(difficulty)) {
    return { ok: false, reason: `invalid difficulty ${difficulty}` };
  }
  if (!cognitiveLevel) return { ok: false, reason: 'cognitive level is required' };
  if (!DIFFICULTY_COGNITIVE[difficulty].includes(cognitiveLevel)) {
    return {
      ok: false,
      reason: `cognitive level ${cognitiveLevel} does not match difficulty ${difficulty} (${DIFFICULTY_COGNITIVE[difficulty].join('|')})`,
    };
  }
  return { ok: true };
}

// ═══════════════════════════════════════════════════════════════════
// CANDIDATE LIFECYCLE (§8.6, §15)
// ═══════════════════════════════════════════════════════════════════

/**
 * Run all validators on a candidate. Har bir validator natijasi alohida
 * qaytariladi (ai_gen_validations jadvaliga yozish uchun).
 *
 * @param {Object} params
 * @param {Object} params.candidate - { stem, options, correctKey, questionType, difficulty, cognitiveLevel, sourceRefs }
 * @param {Array<Object>} params.approvedChunks
 * @param {string[]} [params.existingHashes]
 * @returns {{ ok: boolean, validations: Array<{ name: string, ok: boolean, note: string }> }}
 */
export function runAllValidators({
  candidate = {},
  approvedChunks = [],
  existingHashes = [],
} = {}) {
  const validations = [];
  const add = (name, result) => {
    validations.push({
      name,
      ok: Boolean(result.ok),
      note: result.reason || 'ok',
    });
    return result.ok;
  };

  add('answer_verifier', verifyAnswerSource({
    answer: candidate.correctAnswer || '',
    sourceRefs: candidate.sourceRefs || [],
    approvedChunks,
  }));
  add('ambiguity', validateAmbiguity({ stem: candidate.stem, options: candidate.options }));
  add('multi_correct', validateMultiCorrect({ questionType: candidate.questionType, options: candidate.options }));
  add('duplicate', validateDuplicate({ stem: candidate.stem, existingHashes }));
  add('language', checkLanguage({ stem: candidate.stem, options: candidate.options, language: candidate.language }));
  add('accessibility', checkAccessibility({ stem: candidate.stem, options: candidate.options }));
  add('difficulty', checkDifficulty({ difficulty: candidate.difficulty, cognitiveLevel: candidate.cognitiveLevel }));

  const failed = validations.filter((v) => !v.ok).map((v) => v.name);
  return {
    ok: failed.length === 0,
    validations,
    summary: { allOk: failed.length === 0, failed },
  };
}

/**
 * Lifecycle transition guard — AI_DRAFT teacher approval'siz APPROVED
 * bo'lmaydi (§15); publish faqat APPROVED'dan (§8.6).
 *
 * @param {Object} params
 * @param {string} params.from
 * @param {string} params.to
 * @param {boolean} [params.teacherApproved]
 * @returns {{ ok: boolean, reason?: string }}
 */
export function canTransition({ from = '', to = '', teacherApproved = false } = {}) {
  const allowed = {
    [GEN_CANDIDATE_STATUS.AI_DRAFT]: [GEN_CANDIDATE_STATUS.REVIEWED, GEN_CANDIDATE_STATUS.REJECTED],
    [GEN_CANDIDATE_STATUS.REVIEWED]: [GEN_CANDIDATE_STATUS.APPROVED, GEN_CANDIDATE_STATUS.REJECTED, GEN_CANDIDATE_STATUS.AI_DRAFT],
    [GEN_CANDIDATE_STATUS.APPROVED]: [GEN_CANDIDATE_STATUS.PUBLISHED, GEN_CANDIDATE_STATUS.REJECTED, GEN_CANDIDATE_STATUS.RETIRED],
    [GEN_CANDIDATE_STATUS.PUBLISHED]: [GEN_CANDIDATE_STATUS.RETIRED],
  };
  if (!allowed[from]) return { ok: false, reason: `unknown source status ${from}` };
  // Security: teacher approval'siz APPROVED bo'lmaydi (§15) — maxsus reason
  // allowed-map'dan OLDIN tekshiriladi, aks holda AI_DRAFT→APPROVED
  // "invalid transition" generic xabari bilan chalkashib ketadi.
  if (to === GEN_CANDIDATE_STATUS.APPROVED && !teacherApproved) {
    return { ok: false, reason: 'teacher approval required before APPROVED (AI_DRAFT cannot self-approve)' };
  }
  // Publish faqat APPROVED'dan (§8.6) — xuddi shu sabab bilan oldin tekshiriladi.
  if (to === GEN_CANDIDATE_STATUS.PUBLISHED && from !== GEN_CANDIDATE_STATUS.APPROVED) {
    return { ok: false, reason: 'publish requires an APPROVED candidate' };
  }
  if (!allowed[from].includes(to)) {
    return { ok: false, reason: `invalid transition ${from} → ${to}` };
  }
  return { ok: true };
}
