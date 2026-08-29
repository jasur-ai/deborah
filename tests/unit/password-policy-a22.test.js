import { describe, it, expect } from 'vitest';
import {
  evaluatePassword,
  passwordStrength,
  codePointLength,
  POLICY_MIN_LENGTH,
  POLICY_MIN_LENGTH_MFA,
  POLICY_MAX_LENGTH,
} from '../../src/modules/auth/password-policy.js';

describe('AUTH A-22 — NIST parol siyosati (unit)', () => {
  it('min 8 (foydalanuvchi qarori 2026-08-26) — MFA holatidan qat\'i nazar', () => {
    // 7 belgili harf+raqam — rad (qisqa)
    expect(evaluatePassword('abc12de').ok).toBe(false);
    // 8 belgili harf+raqam — qabul (aynan chegara)
    expect(evaluatePassword('abcd1234').ok).toBe(true);
    expect(POLICY_MIN_LENGTH).toBe(8);
    expect(POLICY_MIN_LENGTH_MFA).toBe(8);
  });

  it('harf + raqam SHART (foydalanuvchi talabi) — boshqa belgi cheklovi yo\'q', () => {
    // faqat harflar → rad
    expect(evaluatePassword('faqatharflardan').ok).toBe(false);
    // faqat raqamlar → rad
    expect(evaluatePassword('12345678').ok).toBe(false);
    // harf+raqam, maxsus belgisiz → qabul
    expect(evaluatePassword('parol2026').ok).toBe(true);
    // maxsus belgili — cheklov YO'Q (xohlasa qo'shsin)
    expect(evaluatePassword('Parol!2026x').ok).toBe(true);
    expect(evaluatePassword('parol!@#$2026').ok).toBe(true);
  });

  it('max 128 (OWASP ASVS) — undan uzun rad, silently truncate yo\'q', () => {
    expect(evaluatePassword('a'.repeat(127) + '1').ok).toBe(true);
    const tooLong = evaluatePassword('a'.repeat(128) + '1');
    expect(tooLong.ok).toBe(false);
    expect(tooLong.reason).toBe('passwordMax');
    expect(POLICY_MAX_LENGTH).toBe(128);
  });

  it('faqat harfli parol → passwordWeak (harf+raqam qoidasi, 2026-08-26)', () => {
    const lettersOnly = evaluatePassword('faqatharflardaniboratparol');
    expect(lettersOnly.ok).toBe(false);
    expect(lettersOnly.reason).toBe('passwordWeak');
  });

  it('Unicode: har code point 1 belgi (surrogate pair 1 deb hisoblanadi)', () => {
    // 8 ta emoji = 16 UTF-16 unit, lekin 8 code point
    expect(codePointLength('😀'.repeat(8))).toBe(8);
    // emoji+harf+raqam parol (8 code point) → qabul
    expect(evaluatePassword('😀😀😀a1234').ok).toBe(true);
    // faqat emoji — raqam yo'q → passwordWeak
    expect(evaluatePassword('😀'.repeat(15)).reason).toBe('passwordWeak');
  });

  it('zxcvbn score 0-4 qaytaradi (passwordStrength)', () => {
    expect(passwordStrength('password123')).toBe(0);
    expect(passwordStrength('Xk9!qL2#vP7$mN4@rT6^')).toBe(4);
    expect(passwordStrength('')).toBe(0);
  });

  it('requireStrong (teacher) — zxcvbn score < 4 rad, >= 4 qabul', () => {
    // Uzun bo'lsa ham kuchsiz (ketma-ket, harf+raqam) → teacher uchun rad
    const weak = evaluatePassword('aaaaaaaaaaaaaaaa1', { requireStrong: true });
    expect(weak.ok).toBe(false);
    expect(weak.reason).toBe('passwordWeak');
    // Student uchun (requireStrong yo'q) — uzun harf+raqam qabul
    expect(evaluatePassword('aaaaaaaaaaaaaaaa1').ok).toBe(true);
    // Haqiqatan kuchli parol → teacher uchun ham qabul
    expect(evaluatePassword('Xk9!qL2#vP7$mN4@rT6^', { requireStrong: true }).ok).toBe(true);
  });

  it('bo\'sh parol → rad (passwordMin)', () => {
    const r = evaluatePassword('');
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('passwordMin');
  });
});
