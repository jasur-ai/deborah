/**
 * AUTH A-22 — NIST SP 800-63B-4 parol siyosati
 *
 * Qoidalar:
 *  - Dynamic min uzunlik: MFA (twofa_enabled) yoqilgan → 8 belgi, aks holda 15 belgi (NIST).
 *  - Max 128 belgi (OWASP ASVS) — silently truncate YO'Q, reject qilamiz.
 *  - Complexity talablari YO'Q (NIST SHALL NOT: "1 katta harf + 1 raqam + belgi").
 *  - Unicode: har Unicode code point 1 belgi (NIST) — [...s].length emas s.length.
 *  - zxcvbn (Dropbox) kuch indikatori 0-4; teacher/admin (requireStrong) uchun score >= 4.
 *  - Hints / security questions — yo'q.
 */

import zxcvbn from 'zxcvbn';

export const POLICY_MIN_LENGTH = 15; // NIST: MFA'siz
export const POLICY_MIN_LENGTH_MFA = 8; // NIST: MFA bilan
export const POLICY_MAX_LENGTH = 128; // OWASP ASVS

/**
 * Unicode code point soni (surrogate pair'lar 1 deb hisoblanadi — NIST).
 * @param {string} s
 * @returns {number}
 */
export function codePointLength(s) {
  if (!s) return 0;
  return [...s].length;
}

/**
 * zxcvbn kuch balli 0-4.
 * @param {string} password
 * @returns {number}
 */
export function passwordStrength(password) {
  if (!password) return 0;
  try {
    return zxcvbn(password).score;
  } catch {
    return 0; // fail-soft: hech qachon register'ni buzmaydi
  }
}

/**
 * Parolni siyosatga baholaydi.
 * @param {string} password
 * @param {{mfa?: boolean, requireStrong?: boolean}} opts
 *   mfa — user.twofa_enabled bo'lsa true (min 8).
 *   requireStrong — teacher/admin uchun true (zxcvbn score >= 4 SHART).
 * @returns {{ok: boolean, reason: string|null, score: number, min: number}}
 */
export function evaluatePassword(password, opts = {}) {
  const { mfa = false, requireStrong = false } = opts;
  const len = codePointLength(password || '');
  const min = mfa ? POLICY_MIN_LENGTH_MFA : POLICY_MIN_LENGTH;

  // D-33 (perf): uzunlik chegaralarini zxcvbn'dan OLDIN tekshiramiz — 128+
  // belgili parolda zxcvbn juda sekin (DoS xavfi); register/parse chegarasi
  // bor, lekin evaluatePassword to'g'ridan chaqirilganda ham himoya shart.
  if (len < min) {
    return { ok: false, reason: 'passwordMin', score: 0, min };
  }
  if (len > POLICY_MAX_LENGTH) {
    return { ok: false, reason: 'passwordMax', score: 0, min };
  }
  const score = passwordStrength(password);
  // NIST: complexity talabi yo'q — faqat uzunlik + (majburiy bo'lsa) kuch.
  if (requireStrong && score < 4) {
    return { ok: false, reason: 'passwordWeak', score, min };
  }
  return { ok: true, reason: null, score, min };
}
