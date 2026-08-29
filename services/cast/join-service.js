/**
 * Deborah — Cast Join Service
 * ---------------------------
 * Join code normalize, nickname sanitize, reserved/confusable bloklash.
 */

import { CAST_ERROR_CODES, CastError } from './errors.js';

const RESERVED_ROLE_NAMES = new Set(['host', 'director', 'teacher', 'admin', 'moderator', 'system', 'projector', 'owner', 'co-host', 'cohost']);

// Confusable / invisible character abuse
const INVISIBLE_RE = /[\u200B-\u200F\u2060-\u206F\uFEFF\u202A-\u202E\u00AD]/g;
const ZERO_WIDTH_RE = /[\u200B\u200C\u200D]/;

/**
 * Normalize join code: uppercase, strip whitespace/hyphens.
 */
export function normalizeJoinCode(code) {
  return String(code || '').toUpperCase().replace(/[\s-]/g, '');
}

/**
 * Validate join code format.
 */
export function assertJoinCodeFormat(code) {
  const norm = normalizeJoinCode(code);
  if (!/^[A-Z0-9]{4,8}$/.test(norm)) {
    throw new CastError(CAST_ERROR_CODES.JOIN_CODE_INVALID, 'Noto‘g‘ri join kod');
  }
  return norm;
}

/**
 * Sanitize + validate display alias.
 * @returns {{displayAlias:string, normalized:string}}
 */
export function sanitizeDisplayAlias(raw, maxLength = 30) {
  let name = String(raw || '').replace(INVISIBLE_RE, '').trim();
  if (!name) {
    throw new CastError(CAST_ERROR_CODES.NAME_TAKEN, 'Ism kiritilishi shart');
  }
  if (name.length > maxLength) name = name.slice(0, maxLength);
  if (ZERO_WIDTH_RE.test(name)) {
    throw new CastError(CAST_ERROR_CODES.NAME_TAKEN, 'Ismda yashirin belgilar bo‘lishi mumkin emas');
  }
  const lower = name.toLowerCase().normalize('NFKC').replace(/[\u0300-\u036f]/g, '');
  if (RESERVED_ROLE_NAMES.has(lower)) {
    throw new CastError(CAST_ERROR_CODES.NAME_TAKEN, 'Bu ism band');
  }
  if (/[<>{}]/.test(name)) {
    throw new CastError(CAST_ERROR_CODES.NAME_TAKEN, 'Ismda maxsus belgilar bo‘lishi mumkin emas');
  }
  return { displayAlias: name, normalized: lower };
}

/**
 * Suggest a numbered alias for duplicate names: "Jasur" → "Jasur 2".
 */
export function suggestNumberedAlias(base, takenSet) {
  let i = 2;
  let candidate = `${base} ${i}`;
  while (takenSet.has(candidate.toLowerCase().normalize('NFKC'))) {
    i++;
    candidate = `${base} ${i}`;
  }
  return candidate;
}
