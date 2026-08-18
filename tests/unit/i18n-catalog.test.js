import { describe, it, expect, beforeEach } from 'vitest';
import {
  LOCALES,
  DEFAULT_LOCALE,
  canonicalLocale,
  localeChain,
  lookupKey,
  plural,
  select,
  formatNumber,
  formatPercent,
  formatList,
  interpolate,
  pseudoLocalize,
  reportMissingKey,
  takeMissingKeyStats,
  normalizeApostrophes,
  hasBidiControl,
  isRtl,
} from '../../services/i18n/catalog.js';

// ── Item 3: BCP-47 canonical registry ──
describe('C4-05: canonicalLocale / localeChain', () => {
  it('canonical va case-insensitive nomlarni taniydi', () => {
    expect(canonicalLocale('uz-latn')).toBe('uz-Latn');
    expect(canonicalLocale('uz_Latn')).toBe('uz-Latn');
    expect(canonicalLocale('RU')).toBe('ru');
    expect(canonicalLocale('en-US')).toBeNull();
    expect(canonicalLocale('uz')).toBe('uz-Latn');
    expect(canonicalLocale(null)).toBeNull();
  });

  it('fallback chain: requested → base → uz-Latn (item 20)', () => {
    expect(localeChain('uz-Cyrl')).toEqual(['uz-Cyrl', 'uz-Latn']);
    expect(localeChain('ru')).toEqual(['ru', 'uz-Latn']);
    expect(localeChain('ar')).toEqual(['ar', 'en', 'uz-Latn']);
    expect(localeChain('unknown')).toEqual(['uz-Latn']);
  });
});

// ── Item 20: fallback lookup ──
describe('C4-05: lookupKey fallback', () => {
  const catalogs = {
    'uz-Latn': { hello: 'Salom', onlyUz: 'Faqat uz' },
    ru: { hello: 'Привет' },
  };
  it('requested locale ustun, keyin base', () => {
    expect(lookupKey(catalogs, 'ru', 'hello')).toBe('Привет');
    expect(lookupKey(catalogs, 'uz-Cyrl', 'onlyUz')).toBe('Faqat uz');
    expect(lookupKey(catalogs, 'ru', 'onlyUz')).toBe('Faqat uz');
  });
  it("topilmasa key qaytadi (missing telemetry uchun)", () => {
    expect(lookupKey(catalogs, 'ru', 'nope')).toBe('nope');
  });
});

// ── Item 4: plural / select ──
describe('C4-05: ICU plural/select', () => {
  it('ruscha plural: one/few/other', () => {
    const forms = { one: 'ответ', few: 'ответа', other: 'ответов' };
    expect(plural('ru', 1, forms)).toBe('ответ');
    expect(plural('ru', 21, forms)).toBe('ответ');
    expect(plural('ru', 2, forms)).toBe('ответа');
    expect(plural('ru', 5, forms)).toBe('ответов');
    expect(plural('ru', 11, forms)).toBe('ответов');
  });
  it('inglizcha plural: one/other', () => {
    const forms = { one: 'answer', other: 'answers' };
    expect(plural('en', 1, forms)).toBe('answer');
    expect(plural('en', 3, forms)).toBe('answers');
  });    it("select: choice bo'yicha", () => {
    expect(select('male', { male: 'U', female: 'Q', other: '?' })).toBe('U');
    expect(select('x', { male: 'U', female: 'Q', other: '?' })).toBe('?');
    expect(select('male', { male: 'U' })).toBe('U');
  });
});

// ── Item 6: Intl formatters ──
describe('C4-05: Intl formatters', () => {
  it('formatNumber', () => {
    expect(formatNumber('en', 1234)).toBe('1,234');
    expect(formatNumber('uz-Latn', 1234.5)).toContain('1');
  });
  it('formatPercent', () => {
    expect(formatPercent('en', 0.42)).toBe('42%');
  });
  it('formatList', () => {
    expect(formatList('en', ['a', 'b'])).toBe('a and b');
  });
});

// ── Interpolation ──
describe('C4-05: interpolate', () => {
  it("{var} almashtiradi, yo'q vara qoldiradi", () => {
    expect(interpolate('{n} javob', { n: 5 })).toBe('5 javob');
    expect(interpolate('{n} javob', {})).toBe('{n} javob');
  });
  it('escape variant XSS qochadi', () => {
    expect(interpolate('{x}', { x: '<script>' }, true)).toBe('&lt;script&gt;');
  });
});

// ── Item 17: pseudo-locale ──
describe('C4-05: pseudoLocalize', () => {
  it("qavslar va aksentlar qo'shadi", () => {
    const out = pseudoLocalize('Salom');
    expect(out).toContain('[Ŀǿřéɱ]');
    expect(out).toContain('[íƥśúɱ]');
    expect(out).toContain('Šáłóɱ');
  });
});

// ── Item 19: missing key telemetry (PII'siz) ──
describe('C4-05: missing key telemetry', () => {
  beforeEach(() => {
    takeMissingKeyStats();
  });
  it("key + locale + count yig'adi, key qaytishi mumkin", () => {
    reportMissingKey('foo.bar', 'ru');
    reportMissingKey('foo.bar', 'ru');
    const stats = takeMissingKeyStats();
    expect(stats).toHaveLength(1);
    expect(stats[0].key).toBe('foo.bar');
    expect(stats[0].count).toBe(2);
    expect(stats[0].locales).toEqual(['ru']);
    // PII yo'q — faqat key va count
    expect(JSON.stringify(stats)).not.toMatch(/user|token|email/i);
  });
  it("takeMissingKeyStats bo'shatadi", () => {
    reportMissingKey('a', 'en');
    takeMissingKeyStats();
    expect(takeMissingKeyStats()).toHaveLength(0);
  });
});

// ── Item 14: apostrophe normalization ──
describe('C4-05: normalizeApostrophes', () => {
  it("barcha apostrophe turlarini canonical (U+02BB) ga keltiradi", () => {
    expect(normalizeApostrophes("o'zbek o‘zbek oʼzbek g‘oya `x`")).toBe("o\u02BBzbek o\u02BBzbek o\u02BBzbek g\u02BBoya \u02BBx\u02BB");
  });
  it('null/undefined qaytaradi', () => {
    expect(normalizeApostrophes(null)).toBeNull();
  });
});

// ── Item 8/13: bidi ──
describe('C4-05: bidi helpers', () => {
  it('bidi control belgilarini aniqlaydi', () => {
    expect(hasBidiControl('hello')).toBe(false);
    expect(hasBidiControl('abc\u202Edef')).toBe(true);
    expect(hasBidiControl('a\u2066b\u2069')).toBe(true);
  });
  it('RTL locale aniqlaydi', () => {
    expect(isRtl('ar')).toBe(true);
    expect(isRtl('fa-IR')).toBe(true);
    expect(isRtl('uz-Latn')).toBe(false);
    expect(isRtl('ru')).toBe(false);
  });
});

// ── Catalog completeness: locale JSONlar server'da o'qiladi ──
describe('C4-05: locale catalogs completeness', () => {
  it("barcha shipping locale fayllari mavjud va bir xil keylar to'plamiga ega", async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const base = path.join(process.cwd(), 'locales');
    // ar/fa-IR registry'da bor lekin base=en fallback (fayl talab qilinmaydi)
    const shipping = ['uz-Latn', 'uz-Cyrl', 'ru', 'en'];
    const cats = {};
    for (const lang of shipping) {
      const p = path.join(base, lang, 'cast.json');
      expect(fs.existsSync(p), `${lang}/cast.json mavjud`).toBe(true);
      cats[lang] = JSON.parse(fs.readFileSync(p, 'utf8'));
    }
    const uzKeys = Object.keys(cats['uz-Latn']).sort();
    expect(uzKeys.length).toBeGreaterThan(30);
    for (const lang of shipping) {
      expect(Object.keys(cats[lang]).sort()).toEqual(uzKeys);
    }
  });
});
