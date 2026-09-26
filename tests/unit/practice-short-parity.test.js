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
import { practiceOptionMeta, normalizeShortAnswer, shortAnswerHash, orderHash, matchHash } from '../../routes/user.js';

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

/**
 * Deborah — Faza 1b: reorder/match server/client parity.
 * Darhol tekshirish ketma-ketlik xeshiga tayanadi — salt + JSON.stringify
 * ikkala tomonda aynan bir xil bo'lishi shart.
 */
describe('practice reorder/match parity', () => {
  it('orderHash = sha256("deborah-order-v1|" + JSON.stringify(seq))', () => {
    const seq = ['bir', 'ikki', 'uch'];
    const expected = createHash('sha256').update('deborah-order-v1|' + JSON.stringify(seq), 'utf8').digest('hex');
    expect(orderHash(seq)).toBe(expected);
    expect(orderHash(seq)).toHaveLength(64);
  });

  it('matchHash = sha256("deborah-match-v1|" + JSON.stringify(rights))', () => {
    const rights = ['4', '9', '16'];
    const expected = createHash('sha256').update('deborah-match-v1|' + JSON.stringify(rights), 'utf8').digest('hex');
    expect(matchHash(rights)).toBe(expected);
    expect(matchHash(rights)).toHaveLength(64);
  });

  it('order matters: swapped sequence → different hash', () => {
    expect(orderHash(['a', 'b'])).not.toBe(orderHash(['b', 'a']));
    expect(matchHash(['x', 'y'])).not.toBe(matchHash(['y', 'x']));
  });

  it('practice.ejs client uses the same salts + JSON.stringify', () => {
    const ejs = readFileSync(new URL('../../views/user/practice.ejs', import.meta.url), 'utf8');
    expect(ejs).toContain('deborah-order-v1|');
    expect(ejs).toContain('deborah-match-v1|');
    expect(ejs).toContain('JSON.stringify(seq)');
  });

  it('practiceOptionMeta: match pairs sanitize (faqat to‘liq juftliklar)', () => {
    const m = practiceOptionMeta({
      type: 'match',
      pairs: [{ l: '2+2', r: '4' }, { l: 'yarmi', r: '' }, { l: '', r: 'x' }, { l: '3+3', r: '6' }],
    });
    expect(m.pairs).toEqual([{ l: '2+2', r: '4' }, { l: '3+3', r: '6' }]);
  });

  it('practiceOptionMeta: reorder texts passthrough (bo‘shlar bilan)', () => {
    const m = practiceOptionMeta({ type: 'reorder', options: ['a', '', 'b'] });
    expect(m.texts).toEqual(['a', '', 'b']);
  });
});
