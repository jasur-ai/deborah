/**
 * Deborah — Academic Grade Rules unit tests (Prompt 45)
 *
 * Pure-schema coverage:
 *   - Decimal arithmetic (scaled integers, NO float drift)
 *   - DSL validation: allowlist (no eval), weight sum, rounding methods
 *   - Layers: raw → moderated → adjusted → final
 *   - Semantics: missing (exclude/zero), exempt, pending, zero
 *   - Hurdles/caps: late penalty cap, resit cap, max attempts
 *   - Rounding/boundary: half_up/half_even/floor/ceil, boundary mapping
 *   - Determinism: same input → same run hash + final grade (property-ish)
 */

import { describe, it, expect } from 'vitest';
import {
  toScaled,
  fromScaled,
  mulScaled,
  divScaled,
  roundScaled,
  addScaled,
  subScaled,
  validateRuleDsl,
  hashRuleDsl,
  canonicalStringify,
  calculateGrade,
  applyBoundary,
  computeRunHash,
  humanizeBreakdown,
  COMPONENT_STATUS,
  MISSING_POLICY,
  GRADE_RULE_DEFAULTS,
  SCALE,
} from '../../src/modules/grading/index.js';

const baseDsl = () => ({
  components: [
    { key: 'midterm', label: 'Oraliq', max_score: 30, weight: 40 },
    { key: 'final', label: 'Yakuniy', max_score: 50, weight: 60 },
  ],
  missingPolicy: MISSING_POLICY.EXCLUDE,
  rounding: { method: 'half_up', scale: 2 },
  boundaries: GRADE_RULE_DEFAULTS.boundaries,
});

const scored = (overrides = {}) => ({
  midterm: { key: 'midterm', raw_score: 27, status: COMPONENT_STATUS.SCORED },
  final: { key: 'final', raw_score: 45, status: COMPONENT_STATUS.SCORED },
  ...overrides,
});

describe('Grading — decimal arithmetic (no float drift)', () => {
  it('scaled integer conversion is exact', () => {
    expect(toScaled(0.5)).toBe(5000);
    expect(toScaled(1.2345)).toBe(12345);
    expect(fromScaled(5000)).toBe(0.5);
  });

  it('mulScaled and divScaled stay integer', () => {
    // 0.5 * 0.25 = 0.125
    expect(mulScaled(toScaled(0.5), toScaled(0.25))).toBe(toScaled(0.125));
    // 0.5 / 0.25 = 2.0
    expect(divScaled(toScaled(0.5), toScaled(0.25))).toBe(toScaled(2));
  });

  it('mulScaled avoids float drift for repeated ops', () => {
    // 0.1 * 3 should be exactly 0.3 in scaled units (0.1*10000=1000, ×3=3000)
    expect(mulScaled(toScaled(0.1), toScaled(3))).toBe(3000);
  });

  it('rejects division by zero', () => {
    expect(() => divScaled(100, 0)).toThrow(/division by zero/);
  });

  it('roundScaled half_up rounds ties away from zero', () => {
    // 12.345 → scale 2 → 12.35 (half_up)
    expect(roundScaled(toScaled(12.345), 'half_up', 2)).toBe(toScaled(12.35));
    expect(roundScaled(toScaled(12.344), 'half_up', 2)).toBe(toScaled(12.34));
  });

  it('roundScaled half_even rounds ties to even', () => {
    expect(roundScaled(toScaled(12.345), 'half_even', 2)).toBe(toScaled(12.34));
    expect(roundScaled(toScaled(12.355), 'half_even', 2)).toBe(toScaled(12.36));
  });

  it('roundScaled floor and ceil', () => {
    expect(roundScaled(toScaled(12.349), 'floor', 2)).toBe(toScaled(12.34));
    expect(roundScaled(toScaled(12.341), 'ceil', 2)).toBe(toScaled(12.35));
  });
});

describe('Grading — DSL validation (allowlist, NO eval)', () => {
  it('accepts a valid rule DSL', () => {
    expect(validateRuleDsl(baseDsl()).ok).toBe(true);
  });

  it('rejects missing components or bad weights', () => {
    expect(validateRuleDsl({ components: [] }).ok).toBe(false);
    expect(validateRuleDsl({ components: [{ key: 'a', label: 'A', max_score: 10, weight: 50 }] }).ok).toBe(false); // sum != 100
    expect(validateRuleDsl({ components: [{ key: 'a', label: 'A', max_score: -1, weight: 100 }] }).ok).toBe(false);
  });

  it('rejects banned/eval-like keys', () => {
    const evil = baseDsl();
    evil.eval = 'process.exit(1)';
    expect(validateRuleDsl(evil).ok).toBe(false);
    // Real attack vector: JSON.parse creates __proto__ as an OWN key
    // (the wire format — express.json). JS `=` assignment sets the
    // prototype, which is NOT an own key and must be tested separately.
    const evil2 = JSON.parse('{"components":[{"key":"a","label":"A","max_score":10,"weight":100}],"__proto__":{"polluted":true}}');
    expect(validateRuleDsl(evil2).ok).toBe(false);
  });

  it('rejects unknown rounding method', () => {
    const d = baseDsl();
    d.rounding = { method: 'bankers_weird', scale: 2 };
    expect(validateRuleDsl(d).ok).toBe(false);
  });

  it('canonical hash is deterministic and key-order independent', () => {
    const d1 = baseDsl();
    const d2 = baseDsl();
    const h1 = hashRuleDsl(d1);
    const h2 = hashRuleDsl(d2);
    expect(h1).toBe(h2);
    expect(h1).toHaveLength(64);
    expect(canonicalStringify({ b: 2, a: 1 })).toBe(canonicalStringify({ a: 1, b: 2 }));
  });
});

describe('Grading — layers (raw → moderated → adjusted → final)', () => {
  it('computes weighted raw percent', () => {
    // midterm 27/30=0.9 (40%) + final 45/50=0.9 (60%) → 90%
    const r = calculateGrade({ dsl: baseDsl(), components: [scored().midterm, scored().final] });
    expect(r.blocked).toBe(false);
    expect(r.finalGrade).toBe(90);
    expect(r.gradeLabel).toBe('A');
    expect(r.layers.raw).toBeCloseTo(90, 2);
  });

  it('applies moderation factor', () => {
    const d = baseDsl();
    d.moderationFactor = { numerator: 102, denominator: 100 }; // +2%
    const r = calculateGrade({ dsl: d, components: [scored().midterm, scored().final] });
    expect(r.layers.moderated).toBeCloseTo(91.8, 1);
  });

  it('applies capped late penalty', () => {
    const d = baseDsl();
    d.latePolicy = { enabled: true, graceMinutes: 60, penaltyPercentPerHour: 5, maxPenaltyPercent: 10 };
    // 3 hours late → 15% → capped at 10%
    const r = calculateGrade({ dsl: d, components: [scored().midterm, scored().final], context: { lateMinutes: 180 } });
    expect(r.layers.adjusted).toBeCloseTo(81, 1);
    expect(r.notes.join(' ')).toMatch(/late penalty/);
  });

  it('grace period prevents penalty', () => {
    const d = baseDsl();
    d.latePolicy = { enabled: true, graceMinutes: 60, penaltyPercentPerHour: 5, maxPenaltyPercent: 10 };
    const r = calculateGrade({ dsl: d, components: [scored().midterm, scored().final], context: { lateMinutes: 30 } });
    expect(r.layers.adjusted).toBeCloseTo(90, 1);
  });
});

describe('Grading — missing/zero/exempt/pending semantics', () => {
  it('missing + exclude policy redistributes weight (no penalty)', () => {
    // final 45/50=0.9 → 90%
    const r = calculateGrade({
      dsl: baseDsl(),
      components: [{ key: 'final', raw_score: 45, status: COMPONENT_STATUS.SCORED }],
    });
    expect(r.finalGrade).toBe(90);
    expect(r.breakdown.some((b) => b.key === 'midterm' && b.status === 'missing')).toBe(true);
  });

  it('missing + zero policy penalizes', () => {
    const d = baseDsl();
    d.missingPolicy = MISSING_POLICY.ZERO;
    const r = calculateGrade({
      dsl: d,
      components: [{ key: 'final', raw_score: 45, status: COMPONENT_STATUS.SCORED }],
    });
    // midterm → 0 (40%) + final 90% (60%) → 54%
    expect(r.finalGrade).toBeCloseTo(54, 1);
  });

  it('exempt component excluded from numerator AND denominator', () => {
    // midterm exempt → final 45/50 = 90% (weight redistributed to 100%)
    const r = calculateGrade({
      dsl: baseDsl(),
      components: [
        { key: 'midterm', raw_score: null, status: COMPONENT_STATUS.EXEMPT },
        { key: 'final', raw_score: 45, status: COMPONENT_STATUS.SCORED },
      ],
    });
    expect(r.finalGrade).toBe(90);
  });

  it('pending component blocks calculation (no partial final)', () => {
    const r = calculateGrade({
      dsl: baseDsl(),
      components: [
        { key: 'midterm', raw_score: 27, status: COMPONENT_STATUS.SCORED },
        { key: 'final', raw_score: null, status: COMPONENT_STATUS.PENDING },
      ],
    });
    expect(r.blocked).toBe(true);
    expect(r.finalGrade).toBeNull();
  });

  it('all exempt → blocked (no graded components)', () => {
    const r = calculateGrade({
      dsl: baseDsl(),
      components: [
        { key: 'midterm', raw_score: null, status: COMPONENT_STATUS.EXEMPT },
        { key: 'final', raw_score: null, status: COMPONENT_STATUS.EXEMPT },
      ],
    });
    expect(r.blocked).toBe(true);
  });
});

describe('Grading — resit cap & max attempts', () => {
  it('resit capped at capPercent', () => {
    const d = baseDsl();
    d.resitCap = { type: 'capped', capPercent: 70, bestOf: null };
    const r = calculateGrade({ dsl: d, components: [scored().midterm, scored().final], context: { attemptNumber: 2 } });
    expect(r.finalGrade).toBe(70);
  });

  it('resit cap does not affect first attempt', () => {
    const d = baseDsl();
    d.resitCap = { type: 'capped', capPercent: 70, bestOf: null };
    const r = calculateGrade({ dsl: d, components: [scored().midterm, scored().final], context: { attemptNumber: 1 } });
    expect(r.finalGrade).toBe(90);
  });

  it('max_attempts exceeded blocks', () => {
    const d = baseDsl();
    d.resitCap = { type: 'max_attempts', capPercent: null, bestOf: 2 };
    const r = calculateGrade({ dsl: d, components: [scored().midterm, scored().final], context: { attemptNumber: 3 } });
    expect(r.blocked).toBe(true);
  });
});

describe('Grading — boundaries & breakdown', () => {
  it('applies boundary mapping', () => {
    expect(applyBoundary(toScaled(95))).toBe('A');
    expect(applyBoundary(toScaled(84.9))).toBe('B');
    expect(applyBoundary(toScaled(59))).toBe('F');
  });

  it('humanizeBreakdown is readable and mentions the final grade', () => {
    const r = calculateGrade({ dsl: baseDsl(), components: [scored().midterm, scored().final] });
    const text = humanizeBreakdown(r);
    expect(text).toMatch(/Yakuniy: 90% → A/);
    expect(text).toMatch(/Oraliq/);
  });
});

describe('Grading — determinism & property checks', () => {
  it('same input + rule → identical run hash and final grade (10×)', () => {
    const dsl = baseDsl();
    const hash1 = hashRuleDsl(dsl);
    for (let i = 0; i < 10; i++) {
      const h = computeRunHash({ ruleHash: hash1, components: [scored().midterm, scored().final] });
      expect(h).toBe(computeRunHash({ ruleHash: hash1, components: [scored().midterm, scored().final] }));
      const r = calculateGrade({ dsl, components: [scored().midterm, scored().final] });
      expect(r.finalGrade).toBe(90);
    }
  });

  it('different input → different run hash', () => {
    const hash1 = hashRuleDsl(baseDsl());
    const hA = computeRunHash({ ruleHash: hash1, components: [scored().midterm, scored().final] });
    const hB = computeRunHash({ ruleHash: hash1, components: [{ key: 'midterm', raw_score: 20, status: 'scored' }, scored().final] });
    expect(hA).not.toBe(hB);
  });

  it('scaled arithmetic never returns fractional scaled ints (SCALE=10000)', () => {
    const dsl = baseDsl();
    for (let i = 0; i < 20; i++) {
      const r = calculateGrade({ dsl, components: [scored().midterm, scored().final] });
      expect(Number.isInteger(toScaled(r.layers.raw))).toBe(true);
      expect(toScaled(r.layers.raw) % 1).toBe(0);
    }
  });
});
