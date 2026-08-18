/**
 * Edikit — Cast Hinge Engine tests (C3-02)
 * -----------------------------------------
 * - ≥80% → MOVE_ON
 * - 35–79% → DISCUSS
 * - <35% → RETEACH
 * - Low coverage / low sample → INSUFFICIENT_EVIDENCE
 * - Dominant distractor → misconception signal
 * - High network failure → technical caution
 * - Teacher override record
 * - No automatic mutation (recommendation hech qachon command emas)
 */

import { describe, it, expect } from 'vitest';
import { recommendHingeAction, recordTeacherDecision, HINGE_RULE_VERSION, HINGE_RECOMMENDATIONS, HINGE_SIGNALS } from '../../services/cast/hinge-engine.js';

const CORRECT = ['o_b']; // to'g'ri javob ID (director private)

function evidence(overrides = {}) {
  return {
    questionId: 'q1',
    eligible: 30,
    active: 28,
    accepted: 24,
    correct: 19,
    incorrect: 5,
    noResponse: 3,
    notShown: 1,
    lateJoin: 1,
    disconnected: 2,
    technicalFailure: 2,
    accuracyPercent: 79,
    responseRate: 80,
    distribution: [
      { optionId: 'o_b', count: 19, percent: 79 },
      { optionId: 'o_c', count: 4, percent: 17 },
      { optionId: 'o_a', count: 1, percent: 4 },
    ],
    confidenceCoverage: 18,
    ...overrides,
  };
}

describe('recommendHingeAction — accuracy bands', () => {
  it('≥80% accuracy → MOVE_ON', () => {
    const r = recommendHingeAction(evidence({ accepted: 25, correct: 20, incorrect: 5, accuracyPercent: 80 }));
    expect(r.recommendation).toBe(HINGE_RECOMMENDATIONS.MOVE_ON);
    expect(r.ruleVersion).toBe(HINGE_RULE_VERSION);
    expect(r.allowedActions).toEqual(['MOVE_ON', 'DISCUSS', 'RETEACH']);
    expect(r.teacherDecision).toBeNull();
  });

  it('35–79% accuracy → DISCUSS with MIXED_ACCURACY signal', () => {
    const r = recommendHingeAction(evidence({ correct: 14, incorrect: 10, accuracyPercent: 58 }));
    expect(r.recommendation).toBe(HINGE_RECOMMENDATIONS.DISCUSS);
    expect(r.signals).toContainEqual(expect.objectContaining({ code: HINGE_SIGNALS.MIXED_ACCURACY, value: 0.58 }));
  });

  it('<35% accuracy → RETEACH', () => {
    const r = recommendHingeAction(evidence({ correct: 8, incorrect: 16, accuracyPercent: 33 }));
    expect(r.recommendation).toBe(HINGE_RECOMMENDATIONS.RETEACH);
  });
});

describe('recommendHingeAction — sufficiency gates', () => {
  it('small sample → INSUFFICIENT_EVIDENCE with LOW_SAMPLE signal', () => {
    const r = recommendHingeAction(evidence({ accepted: 3, correct: 3, incorrect: 0, accuracyPercent: 100, responseRate: 100 }));
    expect(r.recommendation).toBe(HINGE_RECOMMENDATIONS.INSUFFICIENT_EVIDENCE);
    expect(r.signals).toContainEqual(expect.objectContaining({ code: HINGE_SIGNALS.LOW_SAMPLE }));
  });

  it('low coverage → INSUFFICIENT_EVIDENCE with LOW_COVERAGE signal', () => {
    const r = recommendHingeAction(evidence({ eligible: 50, accepted: 10, responseRate: 20, correct: 8, incorrect: 2, accuracyPercent: 80 }));
    expect(r.recommendation).toBe(HINGE_RECOMMENDATIONS.INSUFFICIENT_EVIDENCE);
    expect(r.signals).toContainEqual(expect.objectContaining({ code: HINGE_SIGNALS.LOW_COVERAGE }));
  });
});

describe('recommendHingeAction — signals', () => {
  it('dominant distractor → DOMINANT_DISTRACTOR signal (recommendation unchanged)', () => {
    const r = recommendHingeAction(
      evidence({
        correct: 24, incorrect: 6, accepted: 30, accuracyPercent: 80,
        distribution: [
          { optionId: 'o_b', count: 24, percent: 80 },
          { optionId: 'o_c', count: 5, percent: 17 },
          { optionId: 'o_a', count: 1, percent: 3 },
        ],
      }),
      { correctOptionIds: CORRECT }
    );
    expect(r.signals).toContainEqual(expect.objectContaining({ code: HINGE_SIGNALS.DOMINANT_DISTRACTOR, optionId: 'o_c' }));
    // Signal qo'shiladi, lekin recommendation bandga ko'ra MOVE_ON bo'lib qoladi
    expect(r.recommendation).toBe(HINGE_RECOMMENDATIONS.MOVE_ON);
  });

  it('DISCUSS band with dominant distractor → both signals present', () => {
    const r = recommendHingeAction(
      evidence({
        correct: 14, incorrect: 10, accepted: 24, accuracyPercent: 58,
        distribution: [
          { optionId: 'o_b', count: 14, percent: 58 },
          { optionId: 'o_c', count: 8, percent: 33 },
          { optionId: 'o_a', count: 2, percent: 8 },
        ],
      }),
      { correctOptionIds: CORRECT }
    );
    expect(r.recommendation).toBe(HINGE_RECOMMENDATIONS.DISCUSS);
    expect(r.signals).toContainEqual(expect.objectContaining({ code: HINGE_SIGNALS.MIXED_ACCURACY }));
    expect(r.signals).toContainEqual(expect.objectContaining({ code: HINGE_SIGNALS.DOMINANT_DISTRACTOR, optionId: 'o_c' }));
  });

  it('no dominant distractor when options are close', () => {
    const r = recommendHingeAction(
      evidence({
        correct: 18, incorrect: 6, accepted: 24,
        distribution: [
          { optionId: 'o_b', count: 18, percent: 75 },
          { optionId: 'o_c', count: 3, percent: 12.5 },
          { optionId: 'o_a', count: 3, percent: 12.5 },
        ],
      }),
      { correctOptionIds: CORRECT }
    );
    expect(r.signals.some((s) => s.code === HINGE_SIGNALS.DOMINANT_DISTRACTOR)).toBe(false);
  });

  it('no DOMINANT_DISTRACTOR signal when correct IDs are absent (public context)', () => {
    const r = recommendHingeAction(
      evidence({
        correct: 24, incorrect: 6, accepted: 30, accuracyPercent: 80,
        distribution: [
          { optionId: 'o_b', count: 24, percent: 80 },
          { optionId: 'o_c', count: 5, percent: 17 },
          { optionId: 'o_a', count: 1, percent: 3 },
        ],
      })
    );
    // correctOptionIds berilmasa answer-key ma'lumoti ishlatilmaydi
    expect(r.signals.some((s) => s.code === HINGE_SIGNALS.DOMINANT_DISTRACTOR)).toBe(false);
  });

  it('high technical failure → TECHNICAL_CAUTION signal', () => {
    const r = recommendHingeAction(evidence({ technicalFailure: 6, disconnected: 3, eligible: 30, accepted: 24 }));
    expect(r.signals).toContainEqual(expect.objectContaining({ code: HINGE_SIGNALS.TECHNICAL_CAUTION }));
  });

  it('high-confidence wrong → HIGH_CONFIDENCE_WRONG signal (C3-04 confidence lens)', () => {
    const r = recommendHingeAction(evidence(), { confidence: { highConfidenceWrongCount: 4 } });
    expect(r.signals).toContainEqual(expect.objectContaining({ code: HINGE_SIGNALS.HIGH_CONFIDENCE_WRONG, count: 4 }));
  });
});

describe('recommendHingeAction — safety', () => {
  it('recommendation is a suggestion object, never an action/command', () => {
    const r = recommendHingeAction(evidence({ accepted: 25, correct: 20, incorrect: 5, accuracyPercent: 80 }));
    expect(typeof r).toBe('object');
    expect(r.recommendation).toBeTruthy();
    expect(r.allowedActions).toContain(HINGE_RECOMMENDATIONS.MOVE_ON);
    // recommendation object'da command/next/revote kabi mutatsiya yo'q
    expect(r).not.toHaveProperty('command');
    expect(r).not.toHaveProperty('nextQuestion');
    expect(r).not.toHaveProperty('execute');
  });

  it('recommendation does not mutate evidence input', () => {
    const ev = evidence({ accepted: 25, correct: 20, incorrect: 5, accuracyPercent: 80 });
    const snapshot = JSON.stringify(ev);
    recommendHingeAction(ev);
    expect(JSON.stringify(ev)).toBe(snapshot);
  });

  it('evidenceSummary includes underlying counts for the director card', () => {
    const r = recommendHingeAction(evidence({ accepted: 25, correct: 20, incorrect: 5, accuracyPercent: 80 }));
    expect(r.evidenceSummary).toEqual({
      accepted: 25,
      eligible: 30,
      correct: 20,
      incorrect: 5,
      accuracyPercent: 80,
      responseRate: 80,
    });
  });
});

describe('recordTeacherDecision', () => {
  it('records accept decision with rule version', () => {
    const rec = recordTeacherDecision({
      recommendation: { recommendation: 'DISCUSS', ruleVersion: HINGE_RULE_VERSION },
      decision: 'accept',
      teacherId: 'user:t1',
      sessionId: 's1',
      questionId: 'q1',
      at: 1000,
    });
    expect(rec.type).toBe('cast:hingeDecision');
    expect(rec.decision).toBe('accept');
    expect(rec.ruleVersion).toBe(HINGE_RULE_VERSION);
    expect(rec.recommendation).toBe('DISCUSS');
  });

  it('records override with target', () => {
    const rec = recordTeacherDecision({
      recommendation: { recommendation: 'MOVE_ON', ruleVersion: HINGE_RULE_VERSION },
      decision: 'override',
      overrideTo: 'RETEACH',
      teacherId: 'user:t1',
      sessionId: 's1',
      questionId: 'q1',
    });
    expect(rec.decision).toBe('override');
    expect(rec.overrideTo).toBe('RETEACH');
  });

  it('dismiss keeps recommendation null-safe', () => {
    const rec = recordTeacherDecision({ decision: 'dismiss', teacherId: 'user:t1', sessionId: 's1', questionId: 'q1' });
    expect(rec.decision).toBe('dismiss');
    expect(rec.recommendation).toBeNull();
    expect(rec.ruleVersion).toBe(HINGE_RULE_VERSION); // default fallback
  });
});
