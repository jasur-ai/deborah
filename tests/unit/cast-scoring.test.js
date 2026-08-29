import { describe, it, expect } from 'vitest';
import { calculateQuestionScore, accuracyPercent } from '../../services/cast/scoring.js';
import { CAST_SCORING_MODE } from '../../utils/cast-constants.js';

const baseConfig = { correctBase: 1000, speedBonusMax: 0, wrongPoints: 0, multiplier: 1, version: 'score_v2' };

describe('Accuracy mode', () => {
  it('correct = 1000', () => {
    const r = calculateQuestionScore({ mode: 'accuracy', isCorrect: true, elapsedMs: 0, limitMs: 30000, config: baseConfig });
    expect(r.score).toBe(1000);
  });

  it('wrong = 0', () => {
    const r = calculateQuestionScore({ mode: 'accuracy', isCorrect: false, elapsedMs: 500, limitMs: 30000, config: baseConfig });
    expect(r.score).toBe(0);
  });

  it('exact limit still full credit if correct (no speed bonus)', () => {
    const r = calculateQuestionScore({ mode: 'accuracy', isCorrect: true, elapsedMs: 30000, limitMs: 30000, config: baseConfig });
    expect(r.score).toBe(1000);
  });

  it('over limit (soft late) correct = 1000, late marker true', () => {
    const r = calculateQuestionScore({ mode: 'accuracy', isCorrect: true, elapsedMs: 35000, limitMs: 30000, config: baseConfig, late: true });
    expect(r.score).toBe(1000);
    expect(r.breakdown.late).toBe(true);
  });

  it('strict-late (accepted=false) = 0', () => {
    const r = calculateQuestionScore({ mode: 'accuracy', isCorrect: true, elapsedMs: 35000, limitMs: 30000, config: baseConfig, accepted: false });
    expect(r.score).toBe(0);
  });
});

describe('Balanced mode', () => {
  const cfg = { ...baseConfig, correctBase: 800, speedBonusMax: 200 };

  it('elapsed 0 → max speed bonus', () => {
    const r = calculateQuestionScore({ mode: 'balanced', isCorrect: true, elapsedMs: 0, limitMs: 30000, config: cfg });
    expect(r.breakdown.base).toBe(800);
    expect(r.breakdown.speed).toBe(200);
    expect(r.score).toBe(1000);
  });

  it('elapsed halfway → alpha 1.5 speed component', () => {
    const r = calculateQuestionScore({ mode: 'balanced', isCorrect: true, elapsedMs: 15000, limitMs: 30000, config: cfg });
    // remaining = 0.5, speed = 200 * 0.5^1.5 ≈ 70.7 → 71
    expect(r.breakdown.speed).toBe(71);
    expect(r.score).toBe(871);
  });

  it('soft-late → speed bonus 0', () => {
    const r = calculateQuestionScore({ mode: 'balanced', isCorrect: true, elapsedMs: 35000, limitMs: 30000, config: cfg, late: true });
    expect(r.breakdown.speed).toBe(0);
    expect(r.score).toBe(800);
  });

  it('wrong in balanced = 0 (no negative)', () => {
    const r = calculateQuestionScore({ mode: 'balanced', isCorrect: false, elapsedMs: 1000, limitMs: 30000, config: cfg });
    expect(r.score).toBe(0);
  });
});

describe('Speed mode', () => {
  const cfg = { ...baseConfig, correctBase: 600, speedBonusMax: 400 };

  it('elapsed 0 → full speed', () => {
    const r = calculateQuestionScore({ mode: 'speed', isCorrect: true, elapsedMs: 0, limitMs: 30000, config: cfg });
    expect(r.score).toBe(1000);
  });

  it('elapsed = limit → base only', () => {
    const r = calculateQuestionScore({ mode: 'speed', isCorrect: true, elapsedMs: 30000, limitMs: 30000, config: cfg });
    expect(r.breakdown.speed).toBe(0);
    expect(r.score).toBe(600);
  });
});

describe('No Points / Participation', () => {
  it('no_points always 0 but keeps rawCorrect', () => {
    const r = calculateQuestionScore({ mode: 'no_points', isCorrect: true, elapsedMs: 0, limitMs: 30000, config: baseConfig });
    expect(r.score).toBe(0);
    expect(r.breakdown.rawCorrect).toBe(true);
  });

  it('participation gives fixed points for accepted', () => {
    const r = calculateQuestionScore({ mode: 'participation', isCorrect: false, elapsedMs: 5000, limitMs: 30000, config: { ...baseConfig, participationPoints: 100 } });
    expect(r.score).toBe(100);
  });
});

describe('Partial credit & multiplier', () => {
  it('partial credit fraction applies', () => {
    const r = calculateQuestionScore({ mode: 'accuracy', isCorrect: true, elapsedMs: 0, limitMs: 30000, config: baseConfig, creditFraction: 0.5 });
    expect(r.score).toBe(500);
  });

  it('multiplier applied last', () => {
    const r = calculateQuestionScore({ mode: 'accuracy', isCorrect: true, elapsedMs: 0, limitMs: 30000, config: { ...baseConfig, multiplier: 2 } });
    expect(r.score).toBe(2000);
  });

  it('credit fraction clamped to 0..1', () => {
    const r = calculateQuestionScore({ mode: 'accuracy', isCorrect: true, elapsedMs: 0, limitMs: 30000, config: baseConfig, creditFraction: 1.5 });
    expect(r.score).toBe(1000);
  });
});

describe('Determinism', () => {
  it('same input → same score', () => {
    const input = { mode: 'balanced', isCorrect: true, elapsedMs: 12345, limitMs: 30000, config: { ...baseConfig, correctBase: 800, speedBonusMax: 200 } };
    const a = calculateQuestionScore(input);
    const b = calculateQuestionScore(input);
    expect(a).toEqual(b);
  });

  it('rounding is consistent (integer)', () => {
    const r = calculateQuestionScore({ mode: 'balanced', isCorrect: true, elapsedMs: 9999, limitMs: 30000, config: { ...baseConfig, correctBase: 800, speedBonusMax: 200 } });
    expect(Number.isInteger(r.score)).toBe(true);
  });
});

describe('accuracyPercent', () => {
  it('computes rounded percent', () => {
    expect(accuracyPercent(19, 24)).toBe(79);
  });

  it('returns null for zero denominator', () => {
    expect(accuracyPercent(5, 0)).toBeNull();
  });
});
