/**
 * Deborah — Cast Teacher Reflection Service (C5-02)
 * ------------------------------------------------
 * Private teacher reflection note'lari. Reflection promptlari:
 * 1. Surprise question
 * 2. Evidence changed after action
 * 3. Item to revise
 * 4. Next lesson action
 * 5. Timer/network/accessibility impact
 *
 * Reflection note'lar faqat teacher o'ziga ko'rinadi — studentlarga emas,
 * performance evaluation'ga yuborilmaydi (item 11). Retention: reflection
 * action_pack data class ostida saqlanadi (180 kun REVIEW_OR_DELETE).
 */

export const REFLECTION_VERSION = 'reflection_v1';

/** Reflection prompt fieldlari (item 10). */
export const REFLECTION_FIELDS = Object.freeze([
  { id: 'surpriseQuestion', label: 'Surprise question' },
  { id: 'evidenceChangedAfterAction', label: 'Evidence changed after action' },
  { id: 'itemToRevise', label: 'Item to revise' },
  { id: 'nextLessonAction', label: 'Next lesson action' },
  { id: 'impact', label: 'Timer/network/accessibility impact' },
]);

const MAX_FIELD_LEN = 2000;
const MAX_TOTAL = 6000;

/** Reflection note yaratish (pure) — validatsiya + sanitize. */
export function createReflection({ sessionId, teacherId, fields = {}, at = Date.now() }) {
  const clean = {};
  let total = 0;
  for (const f of REFLECTION_FIELDS) {
    const raw = fields?.[f.id];
    if (raw !== undefined && raw !== null) {
      const v = String(raw).trim().slice(0, MAX_FIELD_LEN);
      if (v) {
        clean[f.id] = v;
        total += v.length;
      }
    }
  }
  if (total >= MAX_TOTAL) {
    const err = new Error('REFLECTION_TOO_LONG');
    err.code = 'REFLECTION_TOO_LONG';
    throw err;
  }
  return {
    reflectionId: 'refl_' + cryptoRandom(6),
    sessionId,
    teacherId,
    fields: clean,
    version: REFLECTION_VERSION,
    createdAt: at,
    updatedAt: at,
    // Item 11: hech qachon performance evaluation'ga tushmaydi
    sentToEvaluation: false,
  };
}

/** Reflection yangilash (pure) — faqat o'z teacher'i o'zgartira oladi. */
export function updateReflection(note, { fields = {}, at = Date.now() }) {
  if (!note) {
    const err = new Error('REFLECTION_NOT_FOUND');
    err.code = 'REFLECTION_NOT_FOUND';
    throw err;
  }
  const clean = { ...(note.fields || {}) }; // eski fieldlar saqlanadi (merge)
  let total = 0;
  for (const f of REFLECTION_FIELDS) {
    const raw = fields?.[f.id];
    if (raw !== undefined && raw !== null) {
      const v = String(raw).trim().slice(0, MAX_FIELD_LEN);
      if (v) {
        clean[f.id] = v;
      } else {
        delete clean[f.id]; // bo'sh — o'chirilgan
      }
    }
  }
  total = Object.values(clean).reduce((s, v) => s + String(v).length, 0);
  if (total > MAX_TOTAL) {
    const err = new Error('REFLECTION_TOO_LONG');
    err.code = 'REFLECTION_TOO_LONG';
    throw err;
  }
  return {
    ...note,
    fields: clean,
    updatedAt: at,
    sentToEvaluation: false,
  };
}

/** PII-safe projection — faqat field'lar, identity metadata minimal. */
export function projectReflection(note) {
  if (!note) return null;
  return {
    reflectionId: note.reflectionId,
    sessionId: note.sessionId,
    fields: note.fields || {},
    version: note.version,
    createdAt: note.createdAt,
    updatedAt: note.updatedAt,
  };
}

function cryptoRandom(bytes) {
  // localStorage'da crypto shart emas — bu pure service, test'da global crypto bor
  const g = globalThis.crypto;
  if (g && typeof g.getRandomValues === 'function') {
    const buf = new Uint8Array(bytes);
    g.getRandomValues(buf);
    return Array.from(buf).map((b) => b.toString(16).padStart(2, '0')).join('');
  }
  return String(Math.floor(Math.random() * 0xffffff)).padStart(6, '0');
}

export default {
  REFLECTION_VERSION,
  REFLECTION_FIELDS,
  createReflection,
  updateReflection,
  projectReflection,
};
