/**
 * Deborah — Cast Error Module
 * --------------------------
 * Stable, contract-level error codes va helper constructor.
 * Client bu kodlar orqali UI state'ni boshqaradi.
 */

import { CAST_ERROR_CODES } from '../../utils/cast-constants.js';

export class CastError extends Error {
  constructor(code, message, extra = {}) {
    super(message || code);
    this.name = 'CastError';
    this.code = code || CAST_ERROR_CODES.INTERNAL;
    this.isCastError = true;
    Object.assign(this, extra);
  }
}

/**
 * Resolve any thrown error into a stable { code, message, ...extra } object.
 * Non-Cast errors -> INTERNAL (never leak stack/message details to client).
 */
export function toCastError(err, fallback = CAST_ERROR_CODES.INTERNAL) {
  if (err && err.isCastError) {
    const { code, message, ...extra } = err;
    return { code, message, ...extra };
  }
  return { code: fallback, message: 'Server xatoligi yuz berdi' };
}

export { CAST_ERROR_CODES };
