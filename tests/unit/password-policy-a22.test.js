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
  it('dynamic min: MFA yoqilgan → 8, aks holda 15 (NIST)', () => {
    // 8 belgili — MFA'siz rad, MFA bilan qabul
    expect(evaluatePassword('abcdefgh').ok).toBe(false);
    expect(evaluatePassword('abcdefgh', { mfa: true }).ok).toBe(true);
    // 15 belgili — MFA'siz qabul (aynan chegara)
    expect(evaluatePassword('abcdefghijklmno').ok).toBe(true);
    expect(POLICY_MIN_LENGTH).toBe(15);
    expect(POLICY_MIN_LENGTH_MFA).toBe(8);
  });

  it('max 128 (OWASP ASVS) — undan uzun rad, silently truncate yo\'q', () => {
    expect(evaluatePassword('a'.repeat(128)).ok).toBe(true);
    const tooLong = evaluatePassword('a'.repeat(129));
    expect(tooLong.ok).toBe(false);
    expect(tooLong.reason).toBe('passwordMax');
    expect(POLICY_MAX_LENGTH).toBe(128);
  });

  it('complexity talabi YO\'Q (NIST SHALL NOT) — faqat harfli uzun parol qabul', () => {
    // 15+ faqat kichik harflar — hech qanday raqam/belgi/bosh harf shart emas
    const lettersOnly = evaluatePassword('faqatharflardaniboratparol');
    expect(lettersOnly.ok).toBe(true);
    expect(lettersOnly.reason).toBeNull();
  });

  it('Unicode: har code point 1 belgi (surrogate pair 1 deb hisoblanadi)', () => {
    // 8 ta emoji = 16 UTF-16 unit, lekin 8 code point
    expect(codePointLength('😀'.repeat(8))).toBe(8);
    // 8 emoji MFA bilan min 8 → qabul
    expect(evaluatePassword('😀'.repeat(8), { mfa: true }).ok).toBe(true);
    // 15 emoji MFA'siz → qabul
    expect(evaluatePassword('😀'.repeat(15)).ok).toBe(true);
  });

  it('zxcvbn score 0-4 qaytaradi (passwordStrength)', () => {
    expect(passwordStrength('password123')).toBe(0);
    expect(passwordStrength('Xk9!qL2#vP7$mN4@rT6^')).toBe(4);
    expect(passwordStrength('')).toBe(0);
  });

  it('requireStrong (teacher) — zxcvbn score < 4 rad, >= 4 qabul', () => {
    // Uzun bo'lsa ham kuchsiz (ketma-ket) → teacher uchun rad
    const weak = evaluatePassword('aaaaaaaaaaaaaaaa', { requireStrong: true });
    expect(weak.ok).toBe(false);
    expect(weak.reason).toBe('passwordWeak');
    // Student uchun (requireStrong yo'q) — uzun bo'lsa qabul
    expect(evaluatePassword('aaaaaaaaaaaaaaaa').ok).toBe(true);
    // Haqiqatan kuchli parol → teacher uchun ham qabul
    expect(evaluatePassword('Xk9!qL2#vP7$mN4@rT6^', { requireStrong: true }).ok).toBe(true);
  });

  it('bo\'sh parol → rad (passwordMin)', () => {
    const r = evaluatePassword('');
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('passwordMin');
  });
});
