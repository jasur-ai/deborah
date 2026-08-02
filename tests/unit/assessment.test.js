/**
 * Edikit — Assessment Builder & Blueprint Tests
 *
 * Covers: 50/30/20 deterministic distribution, blueprint validation,
 * score/time arithmetic validator, seeded pool selection, secret-safe
 * preview render, service graceful degradation, barrel export.
 */

import { describe, it, expect } from 'vitest';

import {
  // Pure blueprint engine
  DISTRIBUTION_RATIOS,
  distributeCount,
  split502030,
  computeBlueprintCounts,
  validateBlueprint,
  validateScoreTimeArithmetic,
  mulberry32,
  seededShuffle,
  selectItemsFromPool,
  renderStudentPreview,
  escapeHtml,
  ASSESSMENT_TYPES,
  ASSESSMENT_STATUS,
  ASSESSMENT_STATUS_TRANSITIONS,
} from '../../src/modules/assessment/blueprint.js';

import {
  // Service (graceful degradation)
  createAssessmentTemplate,
  getAssessmentTemplate,
  listAssessmentTemplates,
  createAssessment,
  getAssessment,
  listAssessments,
  updateAssessment,
  deleteAssessment,
  createAssessmentVersion,
  publishAssessment,
  getAssessmentVersions,
  diffAssessmentVersions,
  addSection,
  updateSection,
  removeSection,
  listSections,
  addAssessmentItem,
  updateAssessmentItem,
  removeAssessmentItem,
  listItems,
  setBlueprint,
  setRandomizationConfig,
  renderPreview,
} from '../../src/modules/assessment/assessment.service.js';

// ═══════════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════════

describe('Assessment — Constants', () => {
  it('should have the 50/30/20 default distribution', () => {
    expect(DISTRIBUTION_RATIOS).toEqual({ easy: 0.5, medium: 0.3, hard: 0.2 });
  });

  it('should have assessment types', () => {
    expect(ASSESSMENT_TYPES).toContain('formative');
    expect(ASSESSMENT_TYPES).toContain('summative');
    expect(ASSESSMENT_TYPES).toContain('quiz');
    expect(ASSESSMENT_TYPES).toContain('midterm');
  });

  it('should have status lifecycle', () => {
    expect(ASSESSMENT_STATUS.DRAFT).toBe('draft');
    expect(ASSESSMENT_STATUS.PUBLISHED).toBe('published');
    expect(ASSESSMENT_STATUS_TRANSITIONS.draft).toContain('published');
    // Published is immutable — no draft transition back
    expect(ASSESSMENT_STATUS_TRANSITIONS.published).not.toContain('draft');
  });
});

// ═══════════════════════════════════════════════════════════════════
// 50/30/20 DETERMINISTIC DISTRIBUTION
// ═══════════════════════════════════════════════════════════════════

describe('Assessment — distributeCount (50/30/20)', () => {
  it('should split exactly for multiples of 10', () => {
    expect(distributeCount(10)).toEqual({ easy: 5, medium: 3, hard: 2 });
    expect(distributeCount(100)).toEqual({ easy: 50, medium: 30, hard: 20 });
  });

  it('should preserve exact sum for arbitrary totals (largest remainder)', () => {
    for (let total = 1; total <= 25; total++) {
      const split = distributeCount(total);
      const sum = Object.values(split).reduce((s, v) => s + v, 0);
      expect(sum, `total=${total}`).toBe(total);
      expect(split.easy).toBeGreaterThanOrEqual(split.medium);
      expect(split.medium).toBeGreaterThanOrEqual(split.hard);
    }
  });

  it('should be deterministic (same input → same output)', () => {
    expect(distributeCount(7)).toEqual(distributeCount(7));
    expect(distributeCount(7)).toEqual({ easy: 4, medium: 2, hard: 1 });
  });

  it('should handle total of 0', () => {
    expect(distributeCount(0)).toEqual({ easy: 0, medium: 0, hard: 0 });
  });

  it('should handle negative/NaN totals as 0', () => {
    expect(distributeCount(-5)).toEqual({ easy: 0, medium: 0, hard: 0 });
    expect(distributeCount(NaN)).toEqual({ easy: 0, medium: 0, hard: 0 });
  });

  it('should round down fractional totals', () => {
    expect(distributeCount(7.9).easy + distributeCount(7.9).medium + distributeCount(7.9).hard).toBe(7);
  });

  it('should throw when all ratios are zero', () => {
    expect(() => distributeCount(10, { a: 0, b: 0 })).toThrow('ratio');
  });

  it('should work with custom ratios', () => {
    expect(distributeCount(10, { a: 1, b: 1 })).toEqual({ a: 5, b: 5 });
  });

  it('split502030 is an alias', () => {
    expect(split502030(50)).toEqual({ easy: 25, medium: 15, hard: 10 });
  });
});

describe('Assessment — computeBlueprintCounts', () => {
  it('should split by outcome weights', () => {
    const weights = [
      { outcome_code: 'alg', weight: 60 },
      { outcome_code: 'geo', weight: 40 },
    ];
    expect(computeBlueprintCounts(10, weights)).toEqual({ alg: 6, geo: 4 });
  });

  it('should return {} for no weights', () => {
    expect(computeBlueprintCounts(10, [])).toEqual({});
  });

  it('should ignore invalid weight entries', () => {
    const weights = [{ outcome_code: 'alg', weight: 60 }, { weight: 40 }, null];
    const counts = computeBlueprintCounts(10, weights);
    expect(counts).toEqual({ alg: 10 });
  });
});

// ═══════════════════════════════════════════════════════════════════
// BLUEPRINT VALIDATION
// ═══════════════════════════════════════════════════════════════════

describe('Assessment — validateBlueprint', () => {
  it('should accept weights summing to 100', () => {
    const result = validateBlueprint({
      weights: [{ outcome_code: 'alg', weight: 50 }, { outcome_code: 'geo', weight: 50 }],
    });
    expect(result.ok).toBe(true);
  });

  it('should reject weights not summing to 100', () => {
    const result = validateBlueprint({
      weights: [{ outcome_code: 'alg', weight: 50 }, { outcome_code: 'geo', weight: 30 }],
    });
    expect(result.ok).toBe(false);
    expect(result.errors[0]).toContain('100');
  });

  it('should reject duplicate outcome codes', () => {
    const result = validateBlueprint({
      weights: [{ outcome_code: 'alg', weight: 50 }, { outcome_code: 'alg', weight: 50 }],
    });
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('Duplicate'))).toBe(true);
  });

  it('should validate distribution counts against expected total', () => {
    const ok = validateBlueprint({ distribution: { easy: 5, medium: 3, hard: 2 } }, { expectedTotalItems: 10 });
    expect(ok.ok).toBe(true);

    const bad = validateBlueprint({ distribution: { easy: 5, medium: 3, hard: 2 } }, { expectedTotalItems: 20 });
    expect(bad.ok).toBe(false);
    expect(bad.errors[0]).toContain('20');
  });

  it('should reject non-integer seed in randomization', () => {
    const result = validateBlueprint({ randomization: { seed: 3.14 } });
    expect(result.ok).toBe(false);
    expect(result.errors[0]).toContain('seed');
  });

  it('should pass empty blueprint', () => {
    expect(validateBlueprint({}).ok).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════
// SCORE / TIME ARITHMETIC VALIDATOR
// ═══════════════════════════════════════════════════════════════════

describe('Assessment — validateScoreTimeArithmetic', () => {
  const items = [
    { id: 1, section_id: 1, points: 3, time_seconds: 60 },
    { id: 2, section_id: 1, points: 2, time_seconds: 60 },
    { id: 3, section_id: 2, points: 5, time_seconds: 120 },
  ];

  it('should pass when totals match', () => {
    const result = validateScoreTimeArithmetic({
      totalPoints: 10,
      totalTimeSeconds: 240,
      sections: [
        { id: 1, title: 'A', max_points: 5, max_time_seconds: 120 },
        { id: 2, title: 'B', max_points: 5, max_time_seconds: 120 },
      ],
      items,
    });
    expect(result.ok).toBe(true);
    expect(result.totals).toEqual({ points: 10, timeSeconds: 240 });
  });

  it('should reject points mismatch with assessment total', () => {
    const result = validateScoreTimeArithmetic({ totalPoints: 9, items });
    expect(result.ok).toBe(false);
    expect(result.errors[0]).toContain('points');
  });

  it('should reject time mismatch with assessment total', () => {
    const result = validateScoreTimeArithmetic({ totalTimeSeconds: 100, items });
    expect(result.ok).toBe(false);
    expect(result.errors[0]).toContain('time');
  });

  it('should reject section points over max', () => {
    const result = validateScoreTimeArithmetic({
      sections: [{ id: 1, title: 'A', max_points: 3 }],
      items,
    });
    expect(result.ok).toBe(false);
    expect(result.errors[0]).toContain('exceed');
  });

  it('should skip checks when totals are 0 (unset)', () => {
    const result = validateScoreTimeArithmetic({ totalPoints: 0, totalTimeSeconds: 0, items });
    expect(result.ok).toBe(true);
  });

  it('should handle empty items', () => {
    const result = validateScoreTimeArithmetic({ totalPoints: 0, items: [] });
    expect(result.ok).toBe(true);
    expect(result.totals).toEqual({ points: 0, timeSeconds: 0 });
  });
});

// ═══════════════════════════════════════════════════════════════════
// SEEDED POOL SELECTION
// ═══════════════════════════════════════════════════════════════════

describe('Assessment — seeded pool selection', () => {
  const pool = [
    { id: 1, difficulty: 'easy', question_type: 'single_choice' },
    { id: 2, difficulty: 'easy', question_type: 'single_choice' },
    { id: 3, difficulty: 'easy', question_type: 'true_false' },
    { id: 4, difficulty: 'medium', question_type: 'single_choice' },
    { id: 5, difficulty: 'medium', question_type: 'essay' },
    { id: 6, difficulty: 'hard', question_type: 'essay' },
    { id: 7, difficulty: 'hard', question_type: 'numeric' },
    { id: 8, difficulty: 'hard', question_type: 'numeric' },
  ];

  it('mulberry32 should be deterministic per seed', () => {
    expect(mulberry32(42)()).toBe(mulberry32(42)());
    expect(mulberry32(1)()).not.toBe(mulberry32(2)());
  });

  it('seededShuffle should be deterministic', () => {
    const a = seededShuffle([1, 2, 3, 4, 5], 7);
    const b = seededShuffle([1, 2, 3, 4, 5], 7);
    expect(a).toEqual(b);
    expect(a).toHaveLength(5);
  });

  it('should select the requested count', () => {
    const result = selectItemsFromPool(pool, {
      total_items: 6,
      distribution: { easy: 0.5, medium: 0.3, hard: 0.2 },
    }, { seed: 5 });
    expect(result.selected).toHaveLength(6);
    expect(result.deterministic).toBe(true);
  });

  it('should be deterministic for the same seed', () => {
    const r1 = selectItemsFromPool(pool, { total_items: 6, distribution: { easy: 0.5, medium: 0.3, hard: 0.2 } }, { seed: 9 });
    const r2 = selectItemsFromPool(pool, { total_items: 6, distribution: { easy: 0.5, medium: 0.3, hard: 0.2 } }, { seed: 9 });
    expect(r1.selected.map((i) => i.id)).toEqual(r2.selected.map((i) => i.id));
  });

  it('should differ between seeds', () => {
    const r1 = selectItemsFromPool(pool, { total_items: 6, distribution: { easy: 0.5, medium: 0.3, hard: 0.2 } }, { seed: 1 });
    const r2 = selectItemsFromPool(pool, { total_items: 6, distribution: { easy: 0.5, medium: 0.3, hard: 0.2 } }, { seed: 999 });
    expect(r1.selected.map((i) => i.id)).not.toEqual(r2.selected.map((i) => i.id));
  });

  it('should report shortage as skipped', () => {
    const result = selectItemsFromPool(pool, {
      total_items: 10,
      distribution: { easy: 0.5, medium: 0.3, hard: 0.2 },
    }, { seed: 3 });
    expect(result.skipped.length).toBeGreaterThan(0);
    // But still returns everything available deterministically
    expect(result.selected.length).toBeGreaterThan(0);
    expect(result.selected.length).toBeLessThanOrEqual(10);
  });

  it('should handle empty pool', () => {
    const result = selectItemsFromPool([], { total_items: 5 }, { seed: 1 });
    expect(result.selected).toEqual([]);
    expect(result.skipped.length).toBeGreaterThan(0);
  });
});

// ═══════════════════════════════════════════════════════════════════
// STUDENT / AUTHOR PREVIEW (secret-safe)
// ═══════════════════════════════════════════════════════════════════

describe('Assessment — preview render', () => {
  const assessment = {
    title: 'Algebra Midterm',
    description: 'Midterm exam',
    assessment_type: 'midterm',
    total_points: 6,
    total_time_seconds: 180,
  };

  const sections = [
    {
      title: 'Algebra',
      items: [
        {
          question_type: 'single_choice',
          points: 3,
          public_data: {
            stem: { text: 'What is 2+2?' },
            options: [{ key: 'A', text: '3' }, { key: 'B', text: '4' }],
          },
          private_data: { correctKeys: ['B'] },
        },
        {
          question_type: 'single_choice',
          points: 3,
          public_data: {
            stem: { text: '<script>alert(1)</script> dangerous?' },
            options: [{ key: 'A', text: 'Yes' }, { key: 'B', text: 'No' }],
          },
          private_data: { correctKeys: ['A'] },
        },
      ],
    },
  ];

  it('should render a full HTML document', () => {
    const html = renderStudentPreview(assessment, sections, {});
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('Algebra Midterm');
    expect(html).toContain('What is 2+2?');
  });

  it('should NOT include answer key by default (student preview)', () => {
    const html = renderStudentPreview(assessment, sections, {});
    expect(html).not.toContain('correctKeys');
    expect(html).not.toContain('Answer key');
    expect(html).toContain('answer key hidden');
  });

  it('should include answer key only when authorized', () => {
    const html = renderStudentPreview(assessment, sections, {
      includePrivateKey: true,
      authorized: true,
    });
    expect(html).toContain('Answer key');
    expect(html).toContain('B');
  });

  it('should NOT include answer key when includePrivateKey=true but NOT authorized', () => {
    const html = renderStudentPreview(assessment, sections, {
      includePrivateKey: true,
      authorized: false,
    });
    expect(html).not.toContain('Answer key (author only)');
    expect(html).toContain('answer key hidden');
  });

  it('should escape XSS in stems and options', () => {
    const html = renderStudentPreview(assessment, sections, {});
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('should number items sequentially', () => {
    const html = renderStudentPreview(assessment, sections, {});
    expect(html).toContain('>1.<');
    expect(html).toContain('>2.<');
  });

  it('escapeHtml should escape special chars', () => {
    expect(escapeHtml('<b>"x" & \'y\'</b>')).toBe('&lt;b&gt;&quot;x&quot; &amp; &#39;y&#39;&lt;/b&gt;');
    expect(escapeHtml(null)).toBe('');
    expect(escapeHtml(undefined)).toBe('');
  });

  it('should handle empty assessment', () => {
    const html = renderStudentPreview({}, [], {});
    expect(html).toContain('Untitled assessment');
  });
});

// ═══════════════════════════════════════════════════════════════════
// SERVICE (graceful degradation without PostgreSQL)
// ═══════════════════════════════════════════════════════════════════

describe('Assessment — Service (graceful degradation)', () => {
  it('createAssessment should reject without PostgreSQL', async () => {
    await expect(createAssessment({ title: 'T' })).rejects.toThrow('PostgreSQL required');
  });

  it('updateAssessment should reject without PostgreSQL', async () => {
    await expect(updateAssessment(1, { title: 'T' })).rejects.toThrow('PostgreSQL required');
  });

  it('deleteAssessment should reject without PostgreSQL', async () => {
    await expect(deleteAssessment(1, 1)).rejects.toThrow('PostgreSQL required');
  });

  it('publishAssessment should reject without PostgreSQL', async () => {
    await expect(publishAssessment(1, { userId: 1 })).rejects.toThrow('PostgreSQL required');
  });

  it('createAssessmentVersion should reject without PostgreSQL', async () => {
    await expect(createAssessmentVersion(1, {})).rejects.toThrow('PostgreSQL required');
  });

  it('getAssessment should return null without PostgreSQL', async () => {
    expect(await getAssessment(1)).toBeNull();
  });

  it('listAssessments should return [] without PostgreSQL', async () => {
    expect(await listAssessments()).toEqual([]);
  });

  it('getAssessmentVersions should return [] without PostgreSQL', async () => {
    expect(await getAssessmentVersions(1)).toEqual([]);
  });

  it('diffAssessmentVersions should return null without PostgreSQL', async () => {
    expect(await diffAssessmentVersions(1, 1, 2)).toBeNull();
  });

  it('createAssessmentTemplate should reject without PostgreSQL', async () => {
    await expect(createAssessmentTemplate({ name: 'T' })).rejects.toThrow('PostgreSQL required');
  });

  it('getAssessmentTemplate should return null without PostgreSQL', async () => {
    expect(await getAssessmentTemplate(1)).toBeNull();
  });

  it('listAssessmentTemplates should return [] without PostgreSQL', async () => {
    expect(await listAssessmentTemplates()).toEqual([]);
  });

  it('addSection should reject without PostgreSQL', async () => {
    await expect(addSection(1, { title: 'S' })).rejects.toThrow('PostgreSQL required');
  });

  it('updateSection should reject without PostgreSQL', async () => {
    await expect(updateSection(1, { title: 'S' })).rejects.toThrow('PostgreSQL required');
  });

  it('removeSection should reject without PostgreSQL', async () => {
    await expect(removeSection(1)).rejects.toThrow('PostgreSQL required');
  });

  it('listSections should return [] without PostgreSQL', async () => {
    expect(await listSections(1)).toEqual([]);
  });

  it('addAssessmentItem should reject without PostgreSQL', async () => {
    await expect(addAssessmentItem(1, { item_id: 5 })).rejects.toThrow('PostgreSQL required');
  });

  it('updateAssessmentItem should reject without PostgreSQL', async () => {
    await expect(updateAssessmentItem(1, { points: 2 })).rejects.toThrow('PostgreSQL required');
  });

  it('removeAssessmentItem should reject without PostgreSQL', async () => {
    await expect(removeAssessmentItem(1)).rejects.toThrow('PostgreSQL required');
  });

  it('listItems should return [] without PostgreSQL', async () => {
    expect(await listItems(1)).toEqual([]);
  });

  it('setBlueprint should reject without PostgreSQL', async () => {
    await expect(setBlueprint(1, {})).rejects.toThrow('PostgreSQL required');
  });

  it('setRandomizationConfig should reject without PostgreSQL', async () => {
    await expect(setRandomizationConfig(1, {})).rejects.toThrow('PostgreSQL required');
  });

  it('renderPreview should degrade gracefully without PostgreSQL', async () => {
    const html = await renderPreview(1, {});
    expect(html).toContain('Preview unavailable');
  });
});

// ═══════════════════════════════════════════════════════════════════
// BARREL EXPORT
// ═══════════════════════════════════════════════════════════════════

describe('Assessment — Barrel Export', () => {
  it('should export all expected functions and constants', async () => {
    const mod = await import('../../src/modules/assessment/index.js');
    const expected = [
      // Blueprint engine
      'DISTRIBUTION_RATIOS', 'distributeCount', 'split502030',
      'computeBlueprintCounts', 'validateBlueprint', 'validateScoreTimeArithmetic',
      'mulberry32', 'seededShuffle', 'selectItemsFromPool',
      'renderStudentPreview', 'escapeHtml',

      // Service
      'createAssessmentTemplate', 'getAssessmentTemplate', 'listAssessmentTemplates',
      'updateAssessmentTemplate', 'deleteAssessmentTemplate',
      'createAssessment', 'getAssessment', 'listAssessments',
      'updateAssessment', 'deleteAssessment',
      'createAssessmentVersion', 'publishAssessment',
      'getAssessmentVersions', 'diffAssessmentVersions',
      'addSection', 'updateSection', 'removeSection', 'listSections',
      'addAssessmentItem', 'updateAssessmentItem', 'removeAssessmentItem', 'listItems',
      'setBlueprint', 'setRandomizationConfig', 'renderPreview',
      'ASSESSMENT_TYPES', 'ASSESSMENT_STATUS', 'ASSESSMENT_STATUS_TRANSITIONS',
    ];

    for (const exp of expected) {
      expect(mod[exp], `Missing export: ${exp}`).toBeDefined();
    }
  });
});
