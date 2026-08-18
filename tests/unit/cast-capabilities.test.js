import { describe, it, expect } from 'vitest';
import { analyzeTest, recommendTimer } from '../../services/cast/capabilities.js';

describe('analyzeTest', () => {
  it('counts types + no blockers for clean test', () => {
    const res = analyzeTest(
      [
        { id: 'q_01', type: 'single_choice', text: 'x', options: [] },
        { id: 'q_02', type: 'true_false', text: 'y', options: [] },
      ],
      [
        { id: 'q_01', correctOptionIds: ['o_a'] },
        { id: 'q_02', correctOptionIds: ['o_a'] },
      ],
    );
    expect(res.typeCounts.single_choice).toBe(1);
    expect(res.typeCounts.true_false).toBe(1);
    expect(res.blockers).toHaveLength(0);
  });

  it('flags missing answer as blocker', () => {
    const res = analyzeTest([{ id: 'q_01', type: 'single_choice', text: 'x', options: [] }], []);
    expect(res.blockers.some((b) => b.code === 'MISSING_ANSWER')).toBe(true);
  });

  it('flags unsupported type as blocker', () => {
    const res = analyzeTest(
      [{ id: 'q_01', type: 'essay', text: 'x', options: [] }],
      [{ id: 'q_01', correctOptionIds: ['o_a'] }],
    );
    expect(res.blockers.some((b) => b.code === 'UNSUPPORTED_QUESTION_TYPE')).toBe(true);
  });

  it('warns on long stem', () => {
    const longText = 'a'.repeat(250);
    const res = analyzeTest(
      [{ id: 'q_01', type: 'single_choice', text: longText, options: [] }],
      [{ id: 'q_01', correctOptionIds: ['o_a'], explanation: 'e' }],
    );
    expect(res.warnings.some((w) => w.code === 'LONG_STEM')).toBe(true);
  });

  it('warns on missing explanation', () => {
    const res = analyzeTest(
      [{ id: 'q_01', type: 'single_choice', text: 'short', options: [] }],
      [{ id: 'q_01', correctOptionIds: ['o_a'] }],
    );
    expect(res.warnings.some((w) => w.code === 'MISSING_EXPLANATION')).toBe(true);
  });

  it('no missing-explanation warning when explanation present', () => {
    const res = analyzeTest(
      [{ id: 'q_01', type: 'single_choice', text: 'short', options: [] }],
      [{ id: 'q_01', correctOptionIds: ['o_a'], explanation: 'because' }],
    );
    expect(res.warnings.some((w) => w.code === 'MISSING_EXPLANATION')).toBe(false);
  });
});

describe('recommendTimer', () => {
  it('returns default for short question', () => {
    expect(recommendTimer({ text: 'hi', options: [] }, 30)).toBe(30);
  });

  it('recommends more for long text', () => {
    const rec = recommendTimer({ text: 'x'.repeat(200), options: [] }, 30);
    expect(rec).toBeGreaterThan(30);
  });

  it('bounds between 10 and 120', () => {
    expect(recommendTimer({ text: 'x'.repeat(2000), options: [] }, 30)).toBeLessThanOrEqual(120);
    expect(recommendTimer({ text: 'x', options: [] }, 5)).toBeGreaterThanOrEqual(10);
  });
});
