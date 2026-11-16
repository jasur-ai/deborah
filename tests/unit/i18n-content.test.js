/**
 * STYLE STEP 35 — Content system tests
 * - S35.03 Term registry (data/term-registry.js)
 * - S35.04 Jargon approved labels + approveJargon
 * - S35.05 Apostrophe normalization (client term-utils, Node'da window shim bilan)
 * - S35.06 Intl formatters (i18n-formatters.js)
 * - S35.07 dir foundation (views)
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { TERMS, JARGON, termLabel, approveJargon } from '../../data/term-registry.js';

describe('S35.03 — Term registry', () => {
  it('core termlar mavjud va approved label bilan', () => {
    expect(TERMS.teacher.label).toBe("O'qituvchi");
    expect(TERMS.student.label).toBe('Ishtirokchi');
    expect(TERMS.test.plural).toBe('Testlar');
    expect(TERMS.session.label).toBe('Jonli sessiya');
    expect(TERMS.result.label).toBe('Natija');
    expect(TERMS.settings.label).toBe('Sozlamalar');
  });

  it('termLabel fallback: noma\'lum key raw sifatida qaytadi (hech qachon undefined emas)', () => {
    expect(termLabel('test')).toBe('Test');
    expect(termLabel('not-a-real-key')).toBe('not-a-real-key');
  });
});

describe('S35.04 — Jargon approval', () => {
  it('jargon approved label/description ga ega', () => {
    expect(JARGON.mock.label).toBe('Namuna fanlar');
    expect(JARGON.pre.label).toBe('Tayyor testlar');
    expect(JARGON.characters.label).toBe('Qahramonlar');
    expect(JARGON.realtime.label).toContain('Jonli');
    expect(JARGON.cast.label).toBe('Jonli sessiya');
  });

  it('approveJargon uzun jargon\'ni birinchi almashtiradi', () => {
    expect(approveJargon('Mock Fanlar va PRE Testlar')).toBe('Namuna fanlar va Tayyor testlar');
    expect(approveJargon('Mock')).toBe('Namuna fanlar');
    expect(approveJargon('PRE Testlar')).toBe('Tayyor testlar');
    expect(approveJargon('Real-time Multiplayer rejimi')).toBe('Jonli ko\'p ishtirokchili o\'yin rejimi');
    expect(approveJargon('Hech qanday jargon yo\'q')).toBe('Hech qanday jargon yo\'q');
  });
});

describe('S35.05 — Apostrophe normalization (client term-utils, window shim)', () => {
  let T;
  beforeAll(() => {
    const src = readFileSync('public/js/term-utils.js', 'utf8');
    // window shim bilan run qilish
    const sandbox = { window: {}, document: {} };
    const fn = new Function('window', 'document', src);
    fn(sandbox.window, sandbox.document);
    T = sandbox.window.DeborahTerms;
  });

  it('normalizeApostrophes: barcha variantlar canonical U+02BB', () => {
    expect(T.normalizeApostrophes("O'zbekiston")).toBe('O\u02BBzbekiston');
    expect(T.normalizeApostrophes('O‘zbekiston')).toBe('O\u02BBzbekiston');
    expect(T.normalizeApostrophes('Oʼzbekiston')).toBe('O\u02BBzbekiston');
    expect(T.normalizeApostrophes('g\'oya')).toBe('g\u02BBoya');
  });

  it('searchNormalize: lowercase + canonical + trim', () => {
    expect(T.searchNormalize("  O'qituvchi  ")).toBe('o\u02BBqituvchi');
    expect(T.searchNormalize('O‘qituvchi')).toBe('o\u02BBqituvchi');
  });

  it('dirAuto: RTL arab matnini taniydi, boshqa holat auto', () => {
    expect(T.dirAuto('مرحبا')).toBe('rtl');
    expect(T.dirAuto('Salom')).toBe('auto');
  });
});

describe('S35.06 — Intl formatters (i18n-formatters.js)', () => {
  let F;
  beforeAll(() => {
    const src = readFileSync('public/js/i18n-formatters.js', 'utf8');
    const sandbox = { window: {}, document: { documentElement: { getAttribute: () => 'uz-Latn' } } };
    const fn = new Function('window', 'document', src);
    fn(sandbox.window, sandbox.document);
    F = sandbox.window.DeborahI18nFmt;
  });

  it('formatNumber locale-aware raqam chiqaradi', () => {
    expect(F.formatNumber(1234.5)).toContain('1');
  });

  it('formatPercent 0.42 -> 42%', () => {
    expect(F.formatPercent(0.42)).toContain('42');
  });

  it('formatDuration compact va full', () => {
    expect(F.formatDuration(65, { compact: true })).toContain('daq');
    expect(F.formatDuration(5)).toContain('5');
  });

  it('formatList conjunction bilan', () => {
    expect(F.formatList(['A', 'B', 'C'])).toContain('A');
  });

  it('formatDate null xavfsiz', () => {
    expect(F.formatDate(null)).toBe('');
  });
});

describe('S35.07 — dir foundation', () => {
  it('asosiy view\'larda <html dir="ltr"> mavjud', () => {
    for (const v of ['views/index.ejs', 'views/user/panel.ejs', 'views/user/login.ejs', 'views/admin/dashboard.ejs', 'views/error.ejs', 'views/offline.ejs']) {
      if (!existsSync(v)) continue;
      const src = readFileSync(v, 'utf8');
      // EJS `<%= %>` ichidagi `>` regex'ni buzadi — interpolyatsiyani maskalaymiz.
      const masked = src.replace(/<%[\s\S]*?%>/g, '');
      expect(masked).toMatch(/<html[^>]*dir=/);
    }
  });

  it('head.ejs da S35 scriptlari yuklanadi', () => {
    const h = readFileSync('views/partials/head.ejs', 'utf8');
    expect(h).toContain('i18n-formatters.js');
    expect(h).toContain('term-utils.js');
  });
});
