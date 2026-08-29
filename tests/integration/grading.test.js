/**
 * Deborah — Academic Grade Rules integration tests (Prompt 45)
 *
 * Service-contract coverage (graceful degradation without PG) +
 * missing/exempt/resit fixture contracts (Prompt 45 §19):
 *   - createGradeRule requires PostgreSQL (validate-first)
 *   - createRuleVersion / approveRuleVersion require PostgreSQL
 *   - runGradeCalculation requires PostgreSQL (validate-first)
 *   - reproduceRun requires PostgreSQL
 *   - list paths degrade to empty arrays / null
 *   - invalid DSL rejected BEFORE DB
 *   - fixture: missing/exempt/resit combinations produce exact grades
 */

import { describe, it, expect } from 'vitest';
import {
  createGradeRule,
  createRuleVersion,
  approveRuleVersion,
  runGradeCalculation,
  reproduceRun,
  getGradeRule,
  listGradeRules,
  listRuleVersions,
  listCalculationRuns,
  getCalculationRun,
  calculateGrade,
  MISSING_POLICY,
  COMPONENT_STATUS,
  GRADE_RULE_DEFAULTS,
} from '../../src/modules/grading/index.js';

const validDsl = () => ({
  components: [
    { key: 'a', label: 'A', max_score: 20, weight: 30 },
    { key: 'b', label: 'B', max_score: 40, weight: 70 },
  ],
  missingPolicy: MISSING_POLICY.EXCLUDE,
  rounding: { method: 'half_up', scale: 2 },
  boundaries: GRADE_RULE_DEFAULTS.boundaries,
});

describe('Grading — service contract (graceful degradation without PG)', () => {
  it('createGradeRule requires PostgreSQL (validate-first)', async () => {
    await expect(
      createGradeRule({ name: 'Rule 1', ruleDsl: validDsl() })
    ).rejects.toThrow('PostgreSQL required');
  });

  it('createGradeRule rejects invalid DSL BEFORE DB', async () => {
    await expect(
      createGradeRule({ name: 'Bad', ruleDsl: { components: [{ key: 'a', label: 'A', max_score: 1, weight: 50 }] } })
    ).rejects.toThrow(/weights must sum to 100/);
  });

  it('createRuleVersion requires PostgreSQL', async () => {
    await expect(createRuleVersion({ ruleId: 1, ruleDsl: validDsl() })).rejects.toThrow('PostgreSQL required');
  });

  it('approveRuleVersion requires PostgreSQL', async () => {
    await expect(approveRuleVersion({ versionId: 1 })).rejects.toThrow('PostgreSQL required');
  });

  it('runGradeCalculation requires PostgreSQL (validate-first)', async () => {
    await expect(
      runGradeCalculation({ ruleVersionId: 1, userId: 1, components: [{ key: 'a', raw_score: 10, status: 'scored' }] })
    ).rejects.toThrow('PostgreSQL required');
  });

  it('runGradeCalculation rejects missing components BEFORE DB', async () => {
    await expect(
      runGradeCalculation({ ruleVersionId: 1, userId: 1, components: [] })
    ).rejects.toThrow(/components is required/);
  });

  it('reproduceRun requires PostgreSQL', async () => {
    await expect(reproduceRun({ runId: 1 })).rejects.toThrow('PostgreSQL required');
  });

  it('list/read paths degrade gracefully', async () => {
    expect(await listGradeRules()).toEqual([]);
    expect(await listRuleVersions({ ruleId: 1 })).toEqual([]);
    expect(await listCalculationRuns()).toEqual([]);
    expect(await getGradeRule(1)).toBeNull();
    expect(await getCalculationRun(1)).toBeNull();
  });
});

describe('Grading — missing/exempt/resit fixtures (Prompt 45 §19)', () => {
  it('fixture: missing with exclude policy → weight redistributed', () => {
    const r = calculateGrade({
      dsl: validDsl(),
      components: [{ key: 'b', raw_score: 40, status: COMPONENT_STATUS.SCORED }], // 40/40 = 100%
    });
    expect(r.finalGrade).toBe(100);
  });

  it('fixture: exempt + partial scores → exact expected grade', () => {
    // a exempt; b = 20/40 = 50% → 50%
    const r = calculateGrade({
      dsl: validDsl(),
      components: [
        { key: 'a', raw_score: null, status: COMPONENT_STATUS.EXEMPT },
        { key: 'b', raw_score: 20, status: COMPONENT_STATUS.SCORED },
      ],
    });
    expect(r.finalGrade).toBe(50);
  });

  it('fixture: zero vs missing distinction', () => {
    const d = validDsl();
    d.missingPolicy = MISSING_POLICY.ZERO;
    // a = 0 (missing→zero), b = 40/40 = 100% (70%) → 70%
    const r = calculateGrade({
      dsl: d,
      components: [{ key: 'b', raw_score: 40, status: COMPONENT_STATUS.SCORED }],
    });
    expect(r.finalGrade).toBeCloseTo(70, 1);
  });

  it('fixture: resit capped at 65% on attempt 2', () => {
    const d = validDsl();
    d.resitCap = { type: 'capped', capPercent: 65, bestOf: null };
    const r = calculateGrade({
      dsl: d,
      components: [
        { key: 'a', raw_score: 20, status: COMPONENT_STATUS.SCORED },
        { key: 'b', raw_score: 40, status: COMPONENT_STATUS.SCORED },
      ],
      context: { attemptNumber: 2 },
    });
    expect(r.finalGrade).toBe(65);
  });

  it('fixture: exact boundary edge (59.99 → F, 60 → D)', () => {
    const d = validDsl();
    d.boundaries = [
      { minPercent: 90, label: 'A' },
      { minPercent: 80, label: 'B' },
      { minPercent: 70, label: 'C' },
      { minPercent: 60, label: 'D' },
      { minPercent: 0, label: 'F' },
    ];
    const r59 = calculateGrade({ dsl: d, components: [{ key: 'b', raw_score: 23.999, status: 'scored' }] }); // ~59.9975 → 59.99... rounds
    const r60 = calculateGrade({ dsl: d, components: [{ key: 'b', raw_score: 24, status: 'scored' }] }); // 60%
    expect(r60.gradeLabel).toBe('D');
    expect(r59.gradeLabel).toBe('F');
  });
});
