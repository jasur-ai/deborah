/**
 * AUTH A-04 — Zod login/register validatsiya unit testlari
 * -------------------------------------------------------------------
 * - loginSchema: non-empty + username format (legacy qisqa parol bloklanmaydi)
 * - registerSchema: min 8 + harf + raqam (Zod min(8))
 * - parse* helper'lar i18n error key qaytaradi (routes copy.errors[key])
 */
import { describe, it, expect } from 'vitest';
import { parseLogin, parseRegister, loginSchema, registerSchema } from '../../src/modules/auth/validation.js';

describe('AUTH A-04 — login schema', () => {
  it('valid login: username + parol → ok', () => {
    const r = parseLogin({ username: 'alisher', password: 'parol123' });
    expect(r.ok).toBe(true);
    expect(r.username).toBe('alisher');
    expect(r.password).toBe('parol123');
  });

  it('username trim qilinadi', () => {
    const r = parseLogin({ username: '  alisher  ', password: 'x' });
    expect(r.ok).toBe(true);
    expect(r.username).toBe('alisher');
  });

  it('bo\'sh username/parol → required', () => {
    expect(parseLogin({ username: '', password: '' }).errorKey).toBe('required');
    expect(parseLogin({ username: 'alisher' }).errorKey).toBe('required');
    expect(parseLogin({}).errorKey).toBe('required');
  });

  it('noto\'g\'ri username belgilari → usernameChars', () => {
    expect(parseLogin({ username: 'ali sher!', password: 'x' }).errorKey).toBe('usernameChars');
    expect(parseLogin({ username: 'ali<sh>er', password: 'x' }).errorKey).toBe('usernameChars');
    // AUTH B-09: login max 100 (email qabul qiladi); 101 → usernameChars
    expect(parseLogin({ username: 'a'.repeat(101), password: 'x' }).errorKey).toBe('usernameChars');
  });

  // AUTH B-09 §06: duplicate flow login maydonini email bilan prefill qiladi
  it('email login qabul qilinadi (@ ruxsat)', () => {
    const r = parseLogin({ username: 'user@test.uz', password: 'x' });
    expect(r.ok).toBe(true);
    expect(r.username).toBe('user@test.uz');
  });

  it('legacy qisqa parol login\'da bloklanmaydi (rehash A-05)', () => {
    // 4-belgili legacy parol — login uchun faqat non-empty shart
    const r = parseLogin({ username: 'legacy_user', password: 'abcd' });
    expect(r.ok).toBe(true);
  });
});

describe('AUTH A-04 — register schema (A-18 email + A-22 NIST)', () => {
  it('valid register: 15+ belgi → ok (email bilan)', () => {
    const r = parseRegister({ username: 'yangi_user', password: 'sirli-parol-2026', email: 'a04u@test.uz', consent: true });
    expect(r.ok).toBe(true);
  });

  it('email yo\'q → emailInvalid (A-18 §07)', () => {
    expect(parseRegister({ username: 'user1', password: 'sirli-parol-2026' }).errorKey).toBe('emailInvalid');
  });

  // AUTH A-22 (NIST SP 800-63B §5.1.1.2): complexity talablari SHALL NOT —
  // faqat-harflar / faqat-raqamlar parollar schema darajasida QABUL qilinadi.
  // Haqiqiy min uzunlik (8 MFA / 15 oddiy) password-policy.js da tekshiriladi
  // (tests/unit/password-policy-a22.test.js).
  it('faqat-raqam parol schema darajasida ok (complexity yo\'q)', () => {
    const r = parseRegister({ username: 'user1', password: '123456789012345', email: 'a04u2@test.uz', consent: true });
    expect(r.ok).toBe(true);
  });

  it('faqat-harflar parol schema darajasida ok (complexity yo\'q)', () => {
    const r = parseRegister({ username: 'user1', password: 'abcdefghijklmno', email: 'a04u3@test.uz', consent: true });
    expect(r.ok).toBe(true);
  });

  it('noto\'g\'ri username → usernameChars', () => {
    // B-04: min 2 (hozir 'ab' VALID — 2 belgi)
    expect(parseRegister({ username: 'a', password: 'sirli-parol-2026' }).errorKey).toBe('usernameChars');
    expect(parseRegister({ username: 'ali$', password: 'sirli-parol-2026' }).errorKey).toBe('usernameChars');
    expect(parseRegister({ username: 'a'.repeat(51), password: 'sirli-parol-2026' }).errorKey).toBe('usernameChars');
  });

  it('juda uzun parol → passwordMax', () => {
    expect(parseRegister({ username: 'user1', password: 'x'.repeat(201) }).errorKey).toBe('passwordMax');
  });
});

describe('AUTH A-04 — schema exports', () => {
  it('loginSchema/registerSchema Zod ob\'ektlar', () => {
    expect(typeof loginSchema.safeParse).toBe('function');
    expect(typeof registerSchema.safeParse).toBe('function');
  });
});
