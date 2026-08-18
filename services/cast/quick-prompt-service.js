/**
 * Edikit — Cast Quick Prompt Service (C3-06)
 * --------------------------------------------
 * Teacher active session ichida original testni o'zgartirmasdan
 * ad-hoc savol yuboradi. Promptlar session eventida qoladi;
 * original source testga silent yozilmaydi.
 *
 * Supported types:
 *   single_choice, true_false, multiple_select,
 *   short_answer, exit_ticket, confidence, prediction, rating
 */

import crypto from 'crypto';
import { fb } from '../../firebase/admin.js';
import { CAST_ERROR_CODES, CastError } from './errors.js';

// ── Prompt types ──
export const QUICK_PROMPT_TYPES = {
  SINGLE_CHOICE: 'single_choice',
  TRUE_FALSE: 'true_false',
  MULTIPLE_SELECT: 'multiple_select',
  SHORT_ANSWER: 'short_answer',
  EXIT_TICKET: 'exit_ticket',
  CONFIDENCE: 'confidence',
  PREDICTION: 'prediction',
  RATING: 'rating',
};

export const QUICK_PROMPT_TYPE_LIST = Object.values(QUICK_PROMPT_TYPES);

// ── Prompt schema validation ──
export const QUICK_PROMPT_SCORED_TYPES = new Set([
  QUICK_PROMPT_TYPES.SINGLE_CHOICE,
  QUICK_PROMPT_TYPES.TRUE_FALSE,
  QUICK_PROMPT_TYPES.MULTIPLE_SELECT,
]);

export const QUICK_PROMPT_SHORT_ANSWER_MAX = 280;

/**
 * Validate a quick prompt draft before launch.
 * @param {object} draft — { type, text, options, correctOptionIds, timer }
 * @param {object} config — session config for bounds
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validateQuickPrompt(draft, config = {}) {
  const errors = [];

  if (!draft || typeof draft !== 'object') {
    return { valid: false, errors: ['Prompt malumoti talab qilinadi'] };
  }

  const type = draft.type;
  if (!type || !QUICK_PROMPT_TYPE_LIST.includes(type)) {
    errors.push(`Noma'lum prompt turi: ${type}`);
  }

  const text = String(draft.text || '').trim();
  if (!text) {
    errors.push('Prompt matni talab qilinadi');
  }
  if (text.length > 1000) {
    errors.push('Prompt matni 1000 belgidan oshmasligi kerak');
  }

  // Type-specific validation
  if (QUICK_PROMPT_SCORED_TYPES.has(type)) {
    if (!Array.isArray(draft.options) || draft.options.length < 2) {
      errors.push('Kamida 2 ta variant talab qilinadi');
    }
    if (draft.options && draft.options.length > 10) {
      errors.push('Variantlar soni 10 tadan oshmasligi kerak');
    }
    if (!Array.isArray(draft.correctOptionIds) || draft.correctOptionIds.length === 0) {
      errors.push('To\'g\'ri javob variantlari talab qilinadi');
    }
    if (draft.options && Array.isArray(draft.correctOptionIds)) {
      const validIds = new Set((draft.options || []).map((o) => o.id));
      for (const id of draft.correctOptionIds) {
        if (!validIds.has(id)) {
          errors.push(`Noto'g'ri variant ID: ${id}`);
          break;
        }
      }
    }
  }

  // Short answer validation
  if (type === QUICK_PROMPT_TYPES.SHORT_ANSWER) {
    if (draft.correctAnswer && draft.correctAnswer.length > QUICK_PROMPT_SHORT_ANSWER_MAX) {
      errors.push('Qisqa javob 280 belgidan oshmasligi kerak');
    }
  }

  // Exit ticket — options may be optional (default: 3 emoji buttons)
  if (type === QUICK_PROMPT_TYPES.EXIT_TICKET) {
    // No specific validation needed; default 3-option emoji set
  }

  // Timer validation
  const timer = draft.timer || {};
  if (timer.seconds !== undefined) {
    const sec = Number(timer.seconds);
    if (isNaN(sec) || sec < 5 || sec > 600) {
      errors.push('Vaqt oralig\'i 5–600 soniya bo\'lishi kerak');
    }
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Generate a session-scoped question ID for a quick prompt.
 * @param {string} sessionId
 * @returns {string} — e.g., "qp_abc123"
 */
export function generatePromptQuestionId(sessionId) {
  const suffix = crypto.randomBytes(6).toString('hex');
  return `qp_${suffix}`;
}

/**
 * Build a prompt question object from a validated draft.
 * @param {object} draft — validated draft
 * @param {string} questionId — generated session-scoped ID
 * @returns {{ public: object, private: object|null }}
 */
export function buildPromptQuestion(draft, questionId) {
  const isScored = QUICK_PROMPT_SCORED_TYPES.has(draft.type);
  const timer = draft.timer || {};

  const publicQ = {
    id: questionId,
    type: draft.type,
    text: String(draft.text || '').trim(),
    options: draft.options || [],
    timer,
    isQuickPrompt: true,
    createdAt: Date.now(),
  };

  // Exit ticket defaults
  if (draft.type === QUICK_PROMPT_TYPES.EXIT_TICKET && (!publicQ.options || publicQ.options.length === 0)) {
    publicQ.options = [
      { id: 'o_exit_clear', text: '🔆 Tushunarli' },
      { id: 'o_exit_confused', text: '🤔 Tushunmadim' },
      { id: 'o_exit_too_fast', text: '⚡ Tez ketdi' },
    ];
  }

  // Rating defaults
  if (draft.type === QUICK_PROMPT_TYPES.RATING && (!publicQ.options || publicQ.options.length === 0)) {
    publicQ.options = [
      { id: 'o_1', text: '⭐' },
      { id: 'o_2', text: '⭐⭐' },
      { id: 'o_3', text: '⭐⭐⭐' },
      { id: 'o_4', text: '⭐⭐⭐⭐' },
      { id: 'o_5', text: '⭐⭐⭐⭐⭐' },
    ];
  }

  // Confidence defaults
  if (draft.type === QUICK_PROMPT_TYPES.CONFIDENCE && (!publicQ.options || publicQ.options.length === 0)) {
    publicQ.options = [
      { id: 'o_conf_low', text: 'Past' },
      { id: 'o_conf_med', text: 'O\'rtacha' },
      { id: 'o_conf_high', text: 'Yuqori' },
    ];
  }

  // Private question (only for scored types)
  let privateQ = null;
  if (isScored) {
    privateQ = {
      id: questionId,
      type: draft.type,
      correctOptionIds: draft.correctOptionIds || [],
      correctAnswer: draft.correctAnswer || null, // for short_answer
      isQuickPrompt: true,
      createdAt: Date.now(),
    };
  }

  return { public: publicQ, private: privateQ };
}

/**
 * Save a quick prompt to the library (teacher's saved items).
 * @param {object} prompt — { type, text, options, correctOptionIds, timer }
 * @param {string} teacherId
 * @returns {Promise<string>} libraryItemId
 */
export async function saveToLibrary(prompt, teacherId) {
  if (!teacherId) {
    throw new CastError(CAST_ERROR_CODES.NOT_AUTHORIZED, 'Saqlash uchun avtorizatsiya talab qilinadi');
  }

  const itemId = 'lib_' + crypto.randomBytes(8).toString('hex');
  const item = {
    itemId,
    type: prompt.type,
    text: String(prompt.text || '').trim(),
    options: prompt.options || [],
    correctOptionIds: prompt.correctOptionIds || [],
    correctAnswer: prompt.correctAnswer || null,
    timer: prompt.timer || {},
    savedAt: Date.now(),
    savedBy: teacherId,
    source: 'quick_prompt',
  };

  await fb.set(`cast_library/${teacherId}/${itemId}`, item);
  return itemId;
}

/**
 * Get a saved quick prompt from library.
 * @param {string} teacherId
 * @param {string} itemId
 * @returns {Promise<object|null>}
 */
export async function getFromLibrary(teacherId, itemId) {
  const snap = await fb.get(`cast_library/${teacherId}/${itemId}`);
  return snap.exists() ? snap.val() : null;
}

/**
 * List all saved quick prompts for a teacher.
 * @param {string} teacherId
 * @returns {Promise<object>}
 */
export async function listLibrary(teacherId) {
  const snap = await fb.get(`cast_library/${teacherId}`);
  return snap.exists() ? snap.val() : {};
}

export default {
  QUICK_PROMPT_TYPES,
  QUICK_PROMPT_TYPE_LIST,
  QUICK_PROMPT_SCORED_TYPES,
  QUICK_PROMPT_SHORT_ANSWER_MAX,
  validateQuickPrompt,
  generatePromptQuestionId,
  buildPromptQuestion,
  saveToLibrary,
  getFromLibrary,
  listLibrary,
};