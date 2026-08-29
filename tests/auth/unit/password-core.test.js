/**
 * AUTH D-15 §06 — Parol core unit testlari (NIST SP 800-63B-4 / OWASP ASVS)
 * ---------------------------------------------------------------------------
 *  - Dynamic min uzunlik: MFA'siz 15, MFA bilan 8 (NIST).
 *  - Max 128 (OWASP ASVS) — silently truncate yo'q.
 *  - Complexity talabi yo'q (NIST SHALL NOT).
 *  - Unicode: code point bo'yicha hisoblash (NIST).
 *  - Argon2id verify + dummy hash (timing equalization).
 *  - HIBP k-anonymity (mock-providers makeHibpFetch).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  POLICY_MIN_LENGTH,
  POLICY_MIN_LENGTH_MFA,
  POLICY_MAX_LENGTH,
  codePointLength,
  passwordStrength,
  evaluatePassword,
} from '../../../src/modules/auth/password-policy.js';
import { hashPassword, verifyPassword } from '../../../utils/helpers.js';
import { makeHibpFetch } from '../../helpers/mock-providers.js';
import { isPasswordBreached, _hibpCacheResetForTests } from '../../../src/modules/auth/hibp.js';

// routes/auth.js dagi bilan bir xil dummy hash — login jitter (A-06/A-22)
const DUMMY_ARGON2_HASH = '$argon2id$v=19$m=65536,p=4,t=3$u1kus5wly9Ue/tfOGXv22w$cKyecI4i1mfK4fQOKglk6jroNJBXOs+bGMM5LHd1FFw';

describe('AUTH D-15 §06 — NIST dynamic min uzunlik', () => {
  it('min 8 — 7 belgi reject (foydalanuvchi qarori 2026-08-26)', () => {
    expect(POLICY_MIN_LENGTH).toBe(8);
    const r = evaluatePassword('correct horse battery stapler!'.slice(0, 7));
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('passwordMin');
    expect(r.min).toBe(8);
  });

  it('MFA bilan 8 belgi yetarli (NIST — MFA compensating control)', () => {
    expect(POLICY_MIN_LENGTH_MFA).toBe(8);
    const r = evaluatePassword('shortpw1', { mfa: true });
    expect(r.ok).toBe(true);
    expect(r.min).toBe(8);
  });

  it('8 belgi harf+raqam qabul (uzunlik yetarli)', () => {
    const r = evaluatePassword('this-is-a-long-pass-42');
    expect(r.ok).toBe(true);
    expect(r.reason).toBeNull();
  });

  it('max 128 — 129 belgi reject (OWASP ASVS V2.1)', () => {
    expect(POLICY_MAX_LENGTH).toBe(128);
    const r = evaluatePassword('a'.repeat(128) + '1');
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('passwordMax');
  });

  it('Unicode: emoji 1 code point (NIST — [...s].length emas)', () => {
    // '🔒x' — emoji surrogate pair; s.length=3 lekin code point=2
    expect('🔒x'.length).toBe(3);
    expect(codePointLength('🔒x')).toBe(2);
  });

  it('harf+raqam SHART — faqat harfli parol rad (foydalanuvchi talabi 2026-08-26)', () => {
    const r = evaluatePassword('abcdefghijklmnopqrstuvwxyz');
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('passwordWeak');
    // maxsus belgi talabi YO'Q — qo'shsa ham qabul
    expect(evaluatePassword('abc!@#123').ok).toBe(true);
  });
});

describe('AUTH D-15 §06 — Argon2id verify + dummy timing', () => {
  it('hash/verify roundtrip — to\'g\'ri parol true', async () => {
    const hash = await hashPassword('super-secret-pass-42');
    expect(hash.startsWith('$argon2id$')).toBe(true);
    expect(await verifyPassword('super-secret-pass-42', hash)).toBe(true);
  });

  it('noto\'g\'ri parol → false', async () => {
    const hash = await hashPassword('super-secret-pass-42');
    expect(await verifyPassword('wrong-password', hash)).toBe(false);
  });

  it('dummy hash — verify bajariladi, false qaytaradi (login jitter)', async () => {
    // Mavjud bo'lmagan user uchun ham argon2 ishlaydi — javob vaqti teng (A-06)
    const result = await verifyPassword('any-password', DUMMY_ARGON2_HASH);
    expect(result).toBe(false);
  });
});

describe('AUTH D-15 §06 — HIBP k-anonymity (mock)', () => {
  const ORIG_ENV = process.env.NODE_ENV;

  beforeEach(() => {
    // Modul call-time NODE_ENV o'qiydi — test rejimida skip bo'lmasligi uchun
    process.env.NODE_ENV = 'development';
    _hibpCacheResetForTests();
  });

  afterEach(() => {
    process.env.NODE_ENV = ORIG_ENV;
  });

  it('breached parol → true (suffix topiladi)', async () => {
    const fetchImpl = makeHibpFetch({ breached: true });
    const r = await isPasswordBreached('password', { fetchImpl });
    expect(r.breached).toBe(true);
    expect(r.checked).toBe(true);
  });

  it('toza parol → false', async () => {
    const fetchImpl = makeHibpFetch({ breached: false });
    const r = await isPasswordBreached('unique-pass-42', { fetchImpl });
    expect(r.breached).toBe(false);
  });
});
