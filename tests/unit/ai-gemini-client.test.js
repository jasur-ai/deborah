/**
 * Deborah — REAL AI Gemini klient: unit testlar
 * ------------------------------------------------
 *  - extractJson: fenced/ichma-ich/qavslar string ichida
 *  - kalit yo'q → not_configured (real so'rov uchmaydi)
 *  - bo'sh prompt → invalid_prompt
 * CI'da real tarmoq chaqiruvi YO'Q (kalitsiz muhitda xavfsiz).
 */
import { describe, it, expect } from 'vitest';
import { extractJson, isAiEnabled, aiGenerateText } from '../../src/modules/ai/gemini-client.js';

describe('AI gemini-client', () => {
  it('extractJson: oddiy obyekt', () => {
    expect(extractJson('{"a":1}')).toEqual({ a: 1 });
  });
  it('extractJson: ```json blok ichida', () => {
    expect(extractJson('Salom\n```json\n[{"text":"q","options":["a","b"],"correctIndex":0}]\n```\nrahmat'))
      .toEqual([{ text: 'q', options: ['a', 'b'], correctIndex: 0 }]);
  });
  it('extractJson: ichma-ich qavslar + string ichida qavslar', () => {
    const o = extractJson('javob: {"t":"a } b { c","arr":[{"x":1}],"n":2} tugadi');
    expect(o.t).toBe('a } b { c');
    expect(o.arr).toEqual([{ x: 1 }]);
  });
  it('extractJson: JSON yo‘q → null', () => {
    expect(extractJson('faqat matn')).toBeNull();
    expect(extractJson('')).toBeNull();
  });
  it('kalit yo‘q bo‘lsa not_configured (so‘rov uchmaydi)', async () => {
    const saved = process.env.GEMINI_API_KEY; delete process.env.GEMINI_API_KEY;
    const saved2 = process.env.GOOGLE_AI_API_KEY; delete process.env.GOOGLE_AI_API_KEY;
    try {
      expect(isAiEnabled()).toBe(false);
      const r = await aiGenerateText('test');
      expect(r.ok).toBe(false);
      expect(r.error).toBe('not_configured');
    } finally {
      if (saved) process.env.GEMINI_API_KEY = saved;
      if (saved2) process.env.GOOGLE_AI_API_KEY = saved2;
    }
  });
  it('bo‘sh prompt → invalid_prompt (kalit bo‘lsa ham)', async () => {
    process.env.GEMINI_API_KEY = process.env.GEMINI_API_KEY || 'test-key-ci';
    try {
      const r = await aiGenerateText('  ');
      expect(r.ok).toBe(false);
      expect(r.error).toBe('invalid_prompt');
    } finally {
      if (process.env.GEMINI_API_KEY === 'test-key-ci') delete process.env.GEMINI_API_KEY;
    }
  });
});
