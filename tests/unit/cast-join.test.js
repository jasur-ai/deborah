import { describe, it, expect } from 'vitest';
import { normalizeJoinCode, assertJoinCodeFormat, sanitizeDisplayAlias, suggestNumberedAlias } from '../../services/cast/join-service.js';

describe('normalizeJoinCode', () => {
  it('uppercases', () => {
    expect(normalizeJoinCode('abc123')).toBe('ABC123');
  });

  it('strips whitespace and hyphens', () => {
    expect(normalizeJoinCode(' 7K4 - MXQ ')).toBe('7K4MXQ');
  });
});

describe('assertJoinCodeFormat', () => {
  it('accepts valid code', () => {
    expect(assertJoinCodeFormat('7K4MXQ')).toBe('7K4MXQ');
  });

  it('rejects too short', () => {
    expect(() => assertJoinCodeFormat('AB')).toThrow();
  });

  it('rejects invalid characters', () => {
    expect(() => assertJoinCodeFormat('ABC-!@')).toThrow();
  });
});

describe('sanitizeDisplayAlias', () => {
  it('trims and returns normalized', () => {
    const r = sanitizeDisplayAlias('  Jasur  ');
    expect(r.displayAlias).toBe('Jasur');
    expect(r.normalized).toBe('jasur');
  });

  it('strips invisible characters', () => {
    const r = sanitizeDisplayAlias('Jas\u200Bur');
    expect(r.displayAlias).toBe('Jasur');
  });

  it('rejects reserved role names', () => {
    expect(() => sanitizeDisplayAlias('Host')).toThrow();
    expect(() => sanitizeDisplayAlias('DIRECTOR')).toThrow();
    expect(() => sanitizeDisplayAlias('admin')).toThrow();
  });

  it('rejects angle brackets (XSS)', () => {
    expect(() => sanitizeDisplayAlias('<script>')).toThrow();
  });

  it('rejects empty', () => {
    expect(() => sanitizeDisplayAlias('   ')).toThrow();
  });

  it('truncates long names to 30 chars', () => {
    const r = sanitizeDisplayAlias('x'.repeat(80));
    expect(r.displayAlias.length).toBe(30);
  });

  it('strips zero-width characters (filter, not reject)', () => {
    const r = sanitizeDisplayAlias('J\u200Dasur');
    expect(r.displayAlias).toBe('Jasur');
  });

  it('strips bidi control characters', () => {
    const r = sanitizeDisplayAlias('Ja\u202Esur');
    expect(r.displayAlias).toBe('Jasur');
  });
});

describe('suggestNumberedAlias', () => {
  it('suggests base 2, then 3', () => {
    expect(suggestNumberedAlias('Jasur', new Set(['jasur', 'jasur 2']))).toBe('Jasur 3');
  });

  it('returns base 2 when free', () => {
    expect(suggestNumberedAlias('Jasur', new Set(['jasur']))).toBe('Jasur 2');
  });
});
