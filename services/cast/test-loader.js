/**
 * Edikit — Cast Test Loader
 * --------------------------
 * - source=user → faqat users/{session.user.safeKey}/tests/{key} o'qiladi (G0-03)
 * - source=mock/pre → published/active tekshiruvi
 * - Har question/optionga stable ID berish (G0-04)
 * - Immutable snapshot: testId, testVersion, itemSetHash
 */

import crypto from 'crypto';
import { fb } from '../../firebase/admin.js';
import { DB_PATHS } from '../../utils/constants.js';
import { CAST_ERROR_CODES, CastError } from './errors.js';
import { normalizeCastQuestion } from './test-normalizer.js';

/**
 * Normalize source reference from user input.
 * @param {{type:string,key:string,chunk?:string|null}} source
 */
export function validateSourceReference(source) {
  if (!source || !source.type) {
    throw new CastError(CAST_ERROR_CODES.CONFIG_INVALID, 'Manba ko‘rsatilmagan');
  }
  if (!['user', 'mock', 'pre'].includes(source.type)) {
    throw new CastError(CAST_ERROR_CODES.CONFIG_INVALID, 'Noma’lum manba turi');
  }
  if (!source.key || typeof source.key !== 'string' || source.key.length > 120) {
    throw new CastError(CAST_ERROR_CODES.CONFIG_INVALID, 'Manba kaliti noto‘g‘ri');
  }
  if (source.type === 'pre') {
    if (!source.chunk || typeof source.chunk !== 'string') {
      throw new CastError(CAST_ERROR_CODES.CONFIG_INVALID, 'PRE manbasi uchun chunk ko‘rsatilishi shart');
    }
  }
  return {
    type: source.type,
    key: source.key,
    chunk: source.chunk || null,
  };
}

/**
 * Hash determinism — canonical JSON hash.
 */
export function hashOf(value) {
  return 'sha256:' + crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

/**
 * Load raw test data from the appropriate source. Ownership enforced.
 *
 * @param {{type:string,key:string,chunk?:string|null}} source
 * @param {object|null} sessionUser — req.session.user (teacher)
 * @returns {Promise<{title:string, rawQuestions:Array, testVersion:number, sourceKey:string}>}
 */
export async function loadRawTest(source, sessionUser) {
  const src = validateSourceReference(source);

  if (src.type === 'user') {
    // G0-03: faqat o'z testi — global users scan YO'Q
    if (!sessionUser || !sessionUser.safeKey) {
      throw new CastError(CAST_ERROR_CODES.NOT_AUTHORIZED, 'Avtorizatsiya talab qilinadi');
    }
    const snap = await fb.get(`${DB_PATHS.USERS}/${sessionUser.safeKey}/tests/${src.key}`);
    if (!snap.exists()) {
      throw new CastError(CAST_ERROR_CODES.SOURCE_UNAVAILABLE, 'Test topilmadi');
    }
    const data = snap.val();
    return {
      title: data.name || src.key,
      rawQuestions: Array.isArray(data.questions) ? data.questions : [],
      testVersion: data.version || 1,
      sourceKey: src.key,
    };
  }

  if (src.type === 'mock') {
    const snap = await fb.get(`${DB_PATHS.MOCK_FANS}/${src.key}`);
    if (!snap.exists()) {
      throw new CastError(CAST_ERROR_CODES.SOURCE_UNAVAILABLE, 'Mock fan topilmadi');
    }
    const data = snap.val();
    // mock published/active flagni tekshirish (agar mavjud bo'lsa)
    if (data.isActive === false) {
      throw new CastError(CAST_ERROR_CODES.SOURCE_UNAVAILABLE, 'Mock fan faol emas');
    }
    return {
      title: data.name || src.key,
      rawQuestions: Array.isArray(data.questions) ? data.questions : [],
      testVersion: data.version || 1,
      sourceKey: src.key,
    };
  }

  // PRE
  const snap = await fb.get(`${DB_PATHS.PRE_GROUPS}/${src.key}`);
  if (!snap.exists()) {
    throw new CastError(CAST_ERROR_CODES.SOURCE_UNAVAILABLE, 'PRE guruh topilmadi');
  }
  const data = snap.val();
  const chunks = Array.isArray(data.chunks) ? data.chunks : [];
  const selected = chunks.find((c) => c && c.id === src.chunk) || null;
  if (!selected) {
    throw new CastError(CAST_ERROR_CODES.CONFIG_INVALID, 'PRE chunk topilmadi');
  }
  return {
    title: `${data.title || src.key} — ${selected.name || src.chunk}`,
    rawQuestions: Array.isArray(selected.questions) ? selected.questions : [],
    testVersion: data.version || 1,
    sourceKey: `${src.key}/${src.chunk}`,
  };
}

/**
 * Load + normalize + snapshot a test for Cast.
 *
 * @returns {Promise<{testId:string,testVersion:number,itemSetHash:string,title:string,
 *   privateQuestions:Array,publicQuestions:Array,questionIds:string[]}>}
 */
export async function loadCastTest(source, sessionUser) {
  const src = validateSourceReference(source);
  const { title, rawQuestions, testVersion, sourceKey } = await loadRawTest(src, sessionUser);

  const privateQuestions = [];
  const publicQuestions = [];
  const questionIds = [];

  rawQuestions.forEach((raw, index) => {
    const normalized = normalizeCastQuestion(raw, index);
    if (!normalized) return;
    const { privateQuestion, publicQuestion } = splitQuestion(normalized);
    privateQuestions.push(privateQuestion);
    publicQuestions.push(publicQuestion);
    questionIds.push(publicQuestion.id);
  });

  const testId = `${src.type}:${sourceKey}`;
  const itemSetHash = hashOf({ title, privateQuestions: privateQuestions.map((q) => q.correctOptionIds) });

  return {
    testId,
    testVersion: testVersion || 1,
    itemSetHash,
    title,
    privateQuestions,
    publicQuestions,
    questionIds,
  };
}

/**
 * Split a normalized question into Private + Public projections (G0-02).
 * Public projection NEVER contains correctOptionIds / explanation policy internals.
 */
export function splitQuestion(normalized) {
  const { correctOptionIds, explanation, misconceptionByOptionId, ...publicRest } = normalized;
  const privateQuestion = {
    id: normalized.id,
    type: normalized.type,
    text: normalized.text,
    options: normalized.options.map((o) => ({ id: o.id, text: o.text })),
    correctOptionIds,
    explanation: explanation || null,
    misconceptionByOptionId: misconceptionByOptionId || {},
  };
  const publicQuestion = {
    id: normalized.id,
    type: normalized.type,
    text: normalized.text,
    options: normalized.options.map((o) => ({ id: o.id, text: o.text })),
    media: null,
    isDouble: !!normalized.isDouble,
  };
  return { privateQuestion, publicQuestion };
}
