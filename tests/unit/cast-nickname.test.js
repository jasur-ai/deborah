/**
 * Edikit — Cast C4-06 Nickname / Identity Policy Tests
 * -----------------------------------------------------
 * coverage: safe alias generation (locale catalog), reserved role
 *           impersonation block, invisible/bidi abuse detection,
 *           NFKC comparison, alias assessment.
 */

import { describe, it, expect } from 'vitest';
import {
  normalizeForCompare,
  isReservedImpersonation,
  hasInvisibleAbuse,
  flagNickname,
  generateSafeAlias,
  aliasWordPool,
  assessAlias,
} from '../../services/cast/nickname.js';

describe('C4-06: aliasWordPool (locale catalog integration)', () => {
  it('uz-Latn catalog so\'zlarini o\'qidi (20 hayvon + 12 rang)', () => {
    const pool = aliasWordPool('uz-Latn');
    expect(pool.animals.length).toBe(20);
    expect(pool.colors.length).toBe(12);
    expect(pool.animals).toContain('burgut');
    expect(pool.colors).toContain('ko‘k');
  });

  it('noma\'lum locale → embedded fallback (default uz-Latn)', () => {
    const pool = aliasWordPool('xx-YY');
    expect(pool.animals.length).toBeGreaterThanOrEqual(10);
  });

  it('en catalog so\'zlari inglizcha', () => {
    const pool = aliasWordPool('en');
    expect(pool.animals).toContain('eagle');
    expect(pool.colors).toContain('blue');
  });
});

describe('C4-06: generateSafeAlias', () => {
  it('"Rang Hayvon N" formatida, takrorlanmaydi (takenSet)', () => {
    const taken = new Set([normalizeForCompare('qizil kit 34')]);
    for (let i = 0; i < 20; i++) {
      const alias = generateSafeAlias('uz-Latn', taken);
      // Rang bir yoki ikki so'z bo'lishi mumkin (to'q sariq, ko'k...) + hayvon + raqam
      const parts = alias.trim().split(/\s+/);
      expect(parts.length).toBeGreaterThanOrEqual(3);
      expect(parts[parts.length - 1]).toMatch(/^\d+$/);
      expect(taken.has(normalizeForCompare(alias))).toBe(false);
    }
  });

  it('locale catalog so\'zlaridan tuziladi', () => {
    const alias = generateSafeAlias('en');
    const words = alias.split(' ');
    expect(aliasWordPool('en').colors).toContain(words[0]);
    expect(aliasWordPool('en').animals).toContain(words[1]);
  });
});

describe('C4-06: reserved role impersonation (item 6)', () => {
  it('bloklaydi: host/director/teacher/moderator/admin (case-insensitive)', () => {
    expect(isReservedImpersonation('Host')).toBe(true);
    expect(isReservedImpersonation('DIRECTOR')).toBe(true);
    expect(isReservedImpersonation('Teacher')).toBe(true);
    expect(isReservedImpersonation('moderator')).toBe(true);
    expect(isReservedImpersonation('admin')).toBe(true);
    expect(isReservedImpersonation('Admin')).toBe(true);
  });

  it('bloklaydi: confusable variantlar (h0st, ho0st)', () => {
    expect(isReservedImpersonation('h0st')).toBe(true);
    expect(isReservedImpersonation('ho0st')).toBe(true);
  });

  it('flagNickname invisible → unsafe (hatto reserved bo\'lmasa ham)', () => {
    const { flags, unsafe } = flagNickname('Ja\u200Bsur');
    expect(flags.invisible).toBe(true);
    expect(unsafe).toBe(true);
  });

  it('oddiy ismlar ruxsat etiladi', () => {
    expect(isReservedImpersonation('Jasur')).toBe(false);
    expect(isReservedImpersonation('Malika')).toBe(false);
    expect(isReservedImpersonation('Karim 23')).toBe(false);
  });
});

describe('C4-06: invisible / bidi abuse (item 9)', () => {
  it('zero-width + invisible belgilar aniqlanadi', () => {
    expect(hasInvisibleAbuse('a\u200Bb')).toBe(true);
    expect(hasInvisibleAbuse('a\u200Db')).toBe(true);
    expect(hasInvisibleAbuse('a\u200Eb')).toBe(true);
  });

  it('bidi control belgilari aniqlanadi', () => {
    expect(hasInvisibleAbuse('\u202Eevol')).toBe(true); // RLO
    expect(hasInvisibleAbuse('\u2066')).toBe(true);     // LRI
  });

  it('normal matn invisible emas', () => {
    expect(hasInvisibleAbuse('Jasur')).toBe(false);
    expect(hasInvisibleAbuse('Bobur 2')).toBe(false);
  });

  it('flagNickname invisible → unsafe', () => {
    const { flags, unsafe } = flagNickname('\u200BHost');
    expect(flags.invisible).toBe(true);
    expect(unsafe).toBe(true);
  });
});

describe('C4-06: assessAlias', () => {
  it('reserved role → RESERVED_ROLE', () => {
    expect(assessAlias('Teacher').reason).toBe('RESERVED_ROLE');
    expect(assessAlias('Teacher').safe).toBe(false);
  });

  it('invisible-only → INVISIBLE_ONLY', () => {
    expect(assessAlias('\u200B\u200B').safe).toBe(false);
    expect(assessAlias('\u200B\u200B').reason).toBe('INVISIBLE_ONLY');
  });

  it("invisible ichida bo'lsa — tozalanadi, keyin safe (item 9 filter)", () => {
    const res = assessAlias('Ja\u200Bsur');
    expect(res.safe).toBe(true);
    expect(res.clean).toBe('Jasur'); // invisible belgi olib tashlandi
    expect(res.normalized).toBe('jasur');
  });

  it('safe alias → clean + normalized (NFKC)', () => {
    const res = assessAlias('  Jasur  ');
    expect(res.safe).toBe(true);
    expect(res.clean).toBe('Jasur');
    expect(res.normalized).toBe('jasur');
  });

  it('bo\'sh ism → EMPTY', () => {
    expect(assessAlias('   ').safe).toBe(false);
    expect(assessAlias('   ').reason).toBe('EMPTY');
  });
});

describe('C4-06: normalizeForCompare (item 7)', () => {
  it('NFKC + lowercase + diacritics strip', () => {
    expect(normalizeForCompare('O‘zbek')).toBe(normalizeForCompare('Oʻzbek'));
    expect(normalizeForCompare('Sardor')).toBe('sardor');
    expect(normalizeForCompare('  Malika ')).toBe('malika');
  });
});
