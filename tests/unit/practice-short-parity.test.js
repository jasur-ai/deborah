/**
 * Deborah — Faza 1: short_answer server/client parity.
 *
 * Darhol tekshirish (practice.ejs) server yuborgan sha256 xeshga tayanadi —
 * normalizatsiya + xesh prefiksi ikkala tomonda aynan bir xil bo'lishi shart.
 * Bu test ikkala tomonni bir-biriga bog'lab qo'yadi.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { createHash } from 'crypto';
import { practiceOptionMeta, normalizeShortAnswer, shortAnswerHash } from '../../routes/user.js';

describe('practice short_answer parity', () => {
  it('normalizes: trim + lowercase + space collapse', () => {
    expect(normalizeShortAnswer('  ToshKent   shahri ')).toBe('toshkent shahri');
  });

  it('unifies Uzbek apostrophe variants', () => {
    expect(normalizeShortAnswer('o‘quvchi')).toBe("o'quvchi");
    expect(normalizeShortAnswer('o’quvchi')).toBe("o'quvchi");
    expect(normalizeShortAnswer('o`quvchi')).toBe("o'quvchi");
    expect(normalizeShortAnswer('OʻZBEKISTON')).toBe("o'zbekiston");
  });

  it('hash = sha256("deborah-short-v1|" + normalized)', () => {
    const expected = createHash('sha256').update('deborah-short-v1|toshkent', 'utf8').digest('hex');
    expect(shortAnswerHash('toshkent')).toBe(expected);
  });

  it('practice.ejs client uses the same prefix + chain', () => {
    const ejs = readFileSync(new URL('../../views/user/practice.ejs', import.meta.url), 'utf8');
    expect(ejs).toContain('deborah-short-v1|');
    expect(ejs).toContain("toLowerCase().trim().replace(/\\s+/g, ' ')");
    expect(ejs).toContain('crypto.subtle.digest');
  });
});

describe('practiceOptionMeta (Faza 1)', () => {
  it('multiple_select: correctMulti set', () => {
    const m = practiceOptionMeta({ type: 'multiple_select', options: ['a', 'b', 'c'], correct: 0, correctMulti: [0, 2] });
    expect(m.correctMulti).toEqual([0, 2]);
  });

  it('short_answer: raw text (alternatives with |)', () => {
    const s = practiceOptionMeta({ type: 'short_answer', options: ['Toshkent|tashkent'] });
    expect(s.shortAnswer).toBe('Toshkent|tashkent');
  });

  it('legacy {text,isCorrect} options → multi flags', () => {
    const m = practiceOptionMeta({ options: [{ text: 'a', isCorrect: true }, { text: 'b' }, { text: 'c', isCorrect: true }] });
    expect(m.correctMulti).toEqual([0, 2]);
  });

  it('single: correctMulti = [correctIdx] fallback', () => {
    const m = practiceOptionMeta({ options: ['a', 'b'], correct: 1 });
    expect(m.correctIdx).toBe(1);
    expect(m.correctMulti).toEqual([1]);
  });
});
