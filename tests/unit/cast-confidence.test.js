/**
 * Deborah — Cast Confidence Lens tests (C3-04)
 * --------------------------------------------
 * - Missing confidence coverage
 * - First/revote confidence alohida
 * - Public payload absence (matrix faqat director room)
 * - Tiny cell suppression
 * - Score independence (confidence grade/rank'ga ta'sir qilmaydi)
 */

import { describe, it, expect } from 'vitest';
import { computeConfidenceMatrix, normalizeConfidence, MIN_CELL_COUNT } from '../../services/cast/confidence-service.js';

function ans(overrides = {}) {
  return { participantId: 'p1', status: 'ACCEPTED', isCorrect: true, confidence: 'high', ...overrides };
}

describe('normalizeConfidence', () => {
  it('normalizes valid levels', () => {
    expect(normalizeConfidence('low')).toBe('low');
    expect(normalizeConfidence('medium')).toBe('medium');
    expect(normalizeConfidence('high')).toBe('high');
    expect(normalizeConfidence('HIGH')).toBe('high');
  });
  it('returns null for invalid / missing', () => {
    expect(normalizeConfidence(null)).toBeNull();
    expect(normalizeConfidence(undefined)).toBeNull();
    expect(normalizeConfidence('very')).toBeNull();
    expect(normalizeConfidence('')).toBeNull();
  });
});

describe('computeConfidenceMatrix', () => {
  it('computes correctHigh / wrongHigh / correctLowOrMedium / wrongLowOrMedium', () => {
    const answers = {
      p1: ans({ isCorrect: true, confidence: 'high' }),
      p2: ans({ isCorrect: true, confidence: 'high' }),
      p3: ans({ isCorrect: false, confidence: 'high' }),
      p4: ans({ isCorrect: true, confidence: 'medium' }),
      p5: ans({ isCorrect: false, confidence: 'low' }),
      p6: ans({ isCorrect: false, confidence: 'low' }),
    };
    const r = computeConfidenceMatrix(answers);
    expect(r.coverage).toBe(6);
    expect(r.correctHigh).toBe(2);
    expect(r.wrongHigh).toBe(1);
    expect(r.correctLowOrMedium).toBe(1);
    expect(r.wrongLowOrMedium).toBe(2);
    expect(r.missingConfidence).toBe(0);
  });

  it('missing confidence is not counted as wrong', () => {
    const answers = {
      p1: ans({ isCorrect: true, confidence: 'high' }),
      p2: ans({ isCorrect: false, confidence: null }), // confidence yo'q
      p3: ans({ isCorrect: false, confidence: null }), // confidence yo'q
    };
    const r = computeConfidenceMatrix(answers);
    expect(r.coverage).toBe(1);
    expect(r.missingConfidence).toBe(2);
    // missing confidence wrong deb hisoblanmaydi; faqat bor confidence'lar hisoblanadi
    expect(r.wrongHigh).toBe(0);
    expect(r.wrongLowOrMedium).toBe(0);
  });

  it('matrix has 2x2 rows for high and low/medium aggregated', () => {
    const answers = {
      p1: ans({ isCorrect: true, confidence: 'high' }),
      p2: ans({ isCorrect: false, confidence: 'low' }),
    };
    const r = computeConfidenceMatrix(answers);
    expect(r.matrix.length).toBe(2);
    expect(r.matrix.find((m) => m.confidence === 'high').correct).toBe(1);
    expect(r.matrix.find((m) => m.confidence === 'high').wrong).toBe(0);
    expect(r.matrix.find((m) => m.confidence === 'low').wrong).toBe(1);
  });

  it('tiny cohort suppression (cell < minCellCount)', () => {
    const answers = { p1: ans({ isCorrect: true, confidence: 'high' }) };
    const r = computeConfidenceMatrix(answers, { minCellCount: 3 });
    expect(r.suppressed).toBe(true);
    expect(r.coverage).toBe(1);
  });

  it('no suppression when all cells >= minCellCount', () => {
    const answers = {};
    for (let i = 0; i < 8; i++) {
      answers['p' + i] = ans({ isCorrect: i < 3, confidence: 'high' }); // 3 correct + 5 wrong -> high cell = 8
    }
    const r = computeConfidenceMatrix(answers, { minCellCount: 3 });
    expect(r.suppressed).toBe(false);
  });

  it('coveragePercent is 0 when no answers', () => {
    const r = computeConfidenceMatrix({});
    expect(r.coverage).toBe(0);
    expect(r.coveragePercent).toBe(0);
    expect(r.matrix.length).toBe(0);
    expect(r.suppressed).toBe(false);
  });
});

describe('score independence', () => {
  it('confidence is NOT in the score record', () => {
    const answers = {
      p1: ans({ isCorrect: true, confidence: 'high', score: { total: 1000 } }),
      p2: ans({ isCorrect: false, confidence: 'high', score: { total: 0 } }),
    };
    const r = computeConfidenceMatrix(answers);
    // Score ma'lumoti confidence matritsasida YO'Q
    expect(r.correctHigh).toBe(1);
    expect(r.wrongHigh).toBe(1);
    expect(r).not.toHaveProperty('score');
    expect(r).not.toHaveProperty('leaderboard');
  });
});

describe('first/revote confidence separation', () => {
  it('separate call for attemptNo=1 and attemptNo=2', () => {
    const firstVotes = { p1: ans({ isCorrect: false, confidence: 'high' }) };
    const revotes = { p1: ans({ isCorrect: true, confidence: 'high' }) };
    const first = computeConfidenceMatrix(firstVotes);
    const revote = computeConfidenceMatrix(revotes);
    expect(first.correctHigh).toBe(0);
    expect(first.wrongHigh).toBe(1);
    expect(revote.correctHigh).toBe(1);
    expect(revote.wrongHigh).toBe(0);
  });
});