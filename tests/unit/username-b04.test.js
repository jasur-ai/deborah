/**
 * Deborah — AUTH B-04 Username validatsiya — Unit tests
 * -----------------------------------------------------
 * OWASP username: case-insensitive, NFKC, 2–50, [a-zA-Z0-9_.-],
 * rezerv so'zlar bloki, leet/confusable blok.
 */
import { describe, it, expect } from 'vitest';
import {
  normalizeUsername,
  isReserved,
  isConfusableReserved,
  confusableToPlain,
  validateUsername,
  RESERVED_USERNAMES,
} from '../../src/modules/auth/username.js';
// Production path: parseLogin/parseRegister schema'dan OLDIN normalize qiladi
import { parseLogin, parseRegister } from '../../src/modules/auth/validation.js';

describe('AUTH B-04 — normalizeUsername', () => {
  it('trim + lowercase (case-insensitive asos)', () => {
    expect(normalizeUsername('  John.Doe  ')).toBe('john.doe');
  });

  it('NFKC: full-width "ａｄｍｉｎ" → "admin"', () => {
    expect(normalizeUsername('ａｄｍｉｎ')).toBe('admin');
  });

  it('NFKC: full-width raqam "１２３" → "123"', () => {
    expect(normalizeUsername('ab１２３')).toBe('ab123');
  });
});

describe('AUTH B-04 — format (validateUsername)', () => {
  it('valid: harf/raqam/_.- 2–50', () => {
    expect(validateUsername('smith').ok).toBe(true);
    expect(validateUsername('john.doe').ok).toBe(true);
    expect(validateUsername('jane-doe_2').ok).toBe(true);
    expect(validateUsername('a'.repeat(50)).ok).toBe(true);
  });

  it('qisqa (1) / uzun (51) → usernameChars', () => {
    expect(validateUsername('a').errorKey).toBe('usernameChars');
    expect(validateUsername('a'.repeat(51)).errorKey).toBe('usernameChars');
  });

  it('kirill/emoji/space/! → usernameChars', () => {
    expect(validateUsername('аdmin').errorKey).toBe('usernameChars'); // kirill a
    expect(validateUsername('ali sher').errorKey).toBe('usernameChars');
    expect(validateUsername('ali!').errorKey).toBe('usernameChars');
    expect(validateUsername('user🙂').errorKey).toBe('usernameChars');
  });

  it('normalizatsiya canonical qaytaradi', () => {
    const r = validateUsername('  Smith  ');
    expect(r.ok).toBe(true);
    expect(r.username).toBe('smith');
  });
});

describe('AUTH B-04 — rezerv so\'zlar', () => {
  it('rezerv ro\'yxat mavjud (guide §08)', () => {
    for (const w of ['admin', 'root', 'support', 'system', 'test']) {
      expect(RESERVED_USERNAMES.has(w)).toBe(true);
    }
  });

  it('rezerv so\'z (har qanday holatda) → usernameReserved', () => {
    expect(validateUsername('admin').errorKey).toBe('usernameReserved');
    expect(validateUsername(' Admin ').errorKey).toBe('usernameReserved');
    expect(validateUsername('ADMIN').errorKey).toBe('usernameReserved');
    expect(validateUsername('support').errorKey).toBe('usernameReserved');
    expect(isReserved('TEST')).toBe(true);
  });

  it('full-width rezerv → NFKC keyin blok', () => {
    expect(validateUsername('ａｄｍｉｎ').errorKey).toBe('usernameReserved');
  });
});

describe('AUTH B-04 — leet/confusable', () => {
  it('leet "4dm1n"/"adm1n" → usernameConfusable', () => {
    expect(confusableToPlain('4dm1n')).toBe('admin');
    expect(validateUsername('4dm1n').errorKey).toBe('usernameConfusable');
    expect(validateUsername('adm1n').errorKey).toBe('usernameConfusable');
    expect(isConfusableReserved('adm1n')).toBe(true);
  });

  it('oddiy username confusable emas', () => {
    expect(isConfusableReserved('bob_2026')).toBe(false);
    expect(validateUsername('bob_2026').ok).toBe(true);
  });

  it('toza rezerv so\'z isConfusableReserved da false (isReserved qamraydi)', () => {
    expect(isConfusableReserved('admin')).toBe(false);
  });
});

describe('AUTH B-04 — production path (parseLogin/parseRegister)', () => {
  it('parseRegister: full-width "ａｄｍｉｎ" → usernameReserved (schema emas)', () => {
    const r = parseRegister({ username: 'ａｄｍｉｎ', password: 'sirli-parol-2026', email: 'x@test.uz' });
    expect(r.ok).toBe(false);
    expect(r.errorKey).toBe('usernameReserved');
  });

  it('parseRegister: full-width "ｓｍｉｔｈ" → canonical smith', () => {
    const r = parseRegister({ username: 'ｓｍｉｔｈ', password: 'sirli-parol-2026', email: 'x@test.uz', consent: true });
    expect(r.ok).toBe(true);
    expect(r.username).toBe('smith');
  });

  it('parseLogin: full-width "ｓｍｉｔｈ" muvaffaqiyatli (NFKC oldin)', () => {
    const r = parseLogin({ username: 'ｓｍｉｔｈ', password: 'x' });
    expect(r.ok).toBe(true);
    expect(r.username).toBe('smith');
  });

  it('parseRegister: rezerv leet "4dm1n" → usernameConfusable', () => {
    const r = parseRegister({ username: '4dm1n', password: 'sirli-parol-2026', email: 'x@test.uz' });
    expect(r.ok).toBe(false);
    expect(r.errorKey).toBe('usernameConfusable');
  });
});
