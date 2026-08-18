/**
 * Deborah — Uzbek Latin/Cyrillic & Terminology Layer (unit tests, Prompt 63)
 *
 * Deterministic transliteration (golden set), script detection, name/
 * apostrophe normalization, ambiguous token highlight, cross-script search
 * key, security guards (no psychometric equivalence, original preserved,
 * identity isolation), glossary injection, locale validation.
 */

import { describe, it, expect } from 'vitest';
import {
  latnToCyrl,
  cyrlToLatn,
  transliterateUz,
  detectScript,
  normalizeUzName,
  normalizeApostrophe,
  highlightAmbiguousTokens,
  buildSearchKey,
  assertNoPsychometricEquivalence,
  assertOriginalPreserved,
  assertIdentityNameIsolation,
  buildGlossaryInjection,
  assertSupportedLocale,
  SUPPORTED_LOCALES,
} from '../../src/modules/multilingual/multilingual.schema.js';

describe('multilingual — BCP-47 locales', () => {
  it('supports uz-Latn, uz-Cyrl, ru, en', () => {
    expect(SUPPORTED_LOCALES).toEqual(['uz-Latn', 'uz-Cyrl', 'ru', 'en']);
    expect(assertSupportedLocale({ lang: 'uz-Latn' }).ok).toBe(true);
    expect(assertSupportedLocale({ lang: 'fr' }).ok).toBe(false);
  });
});

describe('multilingual — Latin↔Cyrillic golden set', () => {
  it('transliterates Uzbek Latin to Cyrillic (golden set)', () => {
    const cases = [
      ['o\'quvchi', 'ўқувчи'],
      ['g\'oya', 'ғоя'],
      ['shahar', 'шаҳар'],
      ['choy', 'чой'],
      ['matematika', 'математика'],
      ['maktab', 'мактаб'],
      ['xat', 'хат'],
      ['qalam', 'қалам'],
    ];
    for (const [latn, cyrl] of cases) {
      expect(latnToCyrl(latn)).toBe(cyrl);
    }
  });

  it('transliterates Cyrillic to Latin (golden set)', () => {
    const cases = [
      ['ўқувчи', "o'quvchi"],
      ['ғоя', "g'oya"],
      ['шаҳар', 'shahar'],
      ['чой', 'choy'],
      ['математика', 'matematika'],
      ['мактаб', 'maktab'],
      ['қалам', 'qalam'],
    ];
    for (const [cyrl, latn] of cases) {
      expect(cyrlToLatn(cyrl)).toBe(latn);
    }
  });

  it('is deterministic — same input, same output', () => {
    expect(latnToCyrl('o\'quvchi')).toBe(latnToCyrl('o\'quvchi'));
    expect(cyrlToLatn('ўқувчи')).toBe(cyrlToLatn('ўқувчи'));
  });

  it('transliterateUz auto-detects source script', () => {
    const r = transliterateUz({ text: 'o\'quvchi', to: 'uz-Cyrl' });
    expect(r.ok).toBe(true);
    expect(r.from).toBe('uz-Latn');
    expect(r.text).toBe('ўқувчи');
  });
});

describe('multilingual — script detection', () => {
  it('detects Cyrillic and Latin', () => {
    expect(detectScript('ўқувчи')).toBe('cyrl');
    expect(detectScript('matematika')).toBe('latn');
    expect(detectScript('Азиз')).toBe('cyrl');
    expect(detectScript('Aziz')).toBe('latn');
  });
});

describe('multilingual — name/apostrophe normalization', () => {
  it('normalizes apostrophe variants to single quote', () => {
    expect(normalizeApostrophe("oʻquvchi o‘quvchi o'quvchi oʼquvchi o’quvchi")).toBe("o'quvchi o'quvchi o'quvchi o'quvchi o'quvchi");
  });

  it('normalizes Uzbek names (trim, collapse spaces, apostrophe)', () => {
    expect(normalizeUzName('  Aziz   Karimov  ')).toBe('Aziz Karimov');
    expect(normalizeUzName('Oʻktam   Bekmurodov')).toBe("O'ktam Bekmurodov");
  });
});

describe('multilingual — ambiguous tokens', () => {
  it('highlights o\'/g\' and standalone apostrophe as ambiguous', () => {
    const r = highlightAmbiguousTokens("o'quvchi");
    expect(r.ambiguous.length).toBeGreaterThan(0);
    expect(r.ambiguous[0].token).toBe("o'");
  });
});

describe('multilingual — cross-script search key', () => {
  it('maps Cyrillic and Latin to same canonical key', () => {
    expect(buildSearchKey('ўқувчи')).toBe(buildSearchKey("o'quvchi"));
    expect(buildSearchKey('импулс')).toBe(buildSearchKey('impuls'));
  });

  it('lowercases and strips apostrophe for search', () => {
    expect(buildSearchKey("O'QUVCHI")).toBe('oquvchi');
    expect(buildSearchKey('Импулс')).toBe('impuls');
  });
});

describe('multilingual — security guards (§15, §58.2/58.4)', () => {
  it('blocks psychometric equivalence auto-linking', () => {
    const r = assertNoPsychometricEquivalence({ psychometricLinked: true });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/psychometric/i);
    expect(assertNoPsychometricEquivalence({ psychometricLinked: false }).ok).toBe(true);
  });

  it('requires original text preservation', () => {
    expect(assertOriginalPreserved({ original: '', result: 'x' }).ok).toBe(false);
    expect(assertOriginalPreserved({ original: 'x', result: '' }).ok).toBe(false);
    expect(assertOriginalPreserved({ original: 'x', result: 'y' }).ok).toBe(true);
  });

  it('isolates identity names from blind transliteration', () => {
    const r = assertIdentityNameIsolation({ isIdentity: true, allowTransliteration: false });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/identity/i);
    expect(assertIdentityNameIsolation({ isIdentity: false }).ok).toBe(true);
  });
});

describe('multilingual — glossary injection', () => {
  it('builds injection with approved terminology', () => {
    const r = buildGlossaryInjection({
      terms: [{ canonical_term: 'momentum', uz_latn: 'impuls', uz_cyrl: 'импулс', definition: 'harakat miqdori' }],
      targetLang: 'uz-Latn',
    });
    expect(r.ok).toBe(true);
    expect(r.termCount).toBe(1);
    expect(r.injection).toContain('momentum → impuls');
    expect(r.injection).toContain('do not vary');
  });

  it('returns empty injection for no terms', () => {
    const r = buildGlossaryInjection({ terms: [] });
    expect(r.ok).toBe(true);
    expect(r.injection).toBe('');
  });
});
