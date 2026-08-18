/**
 * Deborah — Rubric Module Tests
 */

import { describe, it, expect } from 'vitest';
import {
  createRubric, getRubric, listRubrics, updateRubric,
  createRubricVersion, transitionRubricVersion, listRubricVersions, diffRubricVersions,
  createCriterion, updateCriterion, deleteCriterion, listCriteria, getRubricVersionMaxPoints,
  createAnchor, listAnchors, deleteAnchor,
  pinRubricToItem, getPinnedRubric, unpinRubricFromItem,
  generateRubricPreview,
  RUBRIC_TYPES, RUBRIC_STATUS, ANCHOR_TYPES, EVIDENCE_TYPES,
} from '../../src/modules/rubric/index.js';

// ── Constants ──
describe('Rubric — Constants', () => {
  it('should have RUBRIC_TYPES', () => { expect(RUBRIC_TYPES).toContain('analytic'); expect(RUBRIC_TYPES).toContain('holistic'); });
  it('should have RUBRIC_STATUS', () => { expect(RUBRIC_STATUS.DRAFT).toBe('draft'); expect(RUBRIC_STATUS.PUBLISHED).toBe('published'); });
  it('should have ANCHOR_TYPES', () => { expect(ANCHOR_TYPES).toContain('exemplar'); expect(ANCHOR_TYPES).toContain('borderline'); });
  it('should have EVIDENCE_TYPES', () => { expect(EVIDENCE_TYPES).toContain('concept'); expect(EVIDENCE_TYPES).toContain('semantic'); });
});

// ── Rubrics (graceful degradation) ──
describe('Rubric — Rubrics', () => {
  it('createRubric should reject when DB unavailable (type validation AFTER DB check)', async () => {
    // DB check runs BEFORE type validation
    await expect(createRubric({ name: 'Test', type: 'invalid' })).rejects.toThrow('PostgreSQL required');
  });
  it('createRubric should reject when DB unavailable', async () => {
    await expect(createRubric({ name: 'Test', type: 'analytic' })).rejects.toThrow('PostgreSQL required');
  });
  it('getRubric should return null', async () => { expect(await getRubric(1)).toBeNull(); });
  it('listRubrics should return []', async () => { expect(await listRubrics()).toEqual([]); });
  it('updateRubric should reject', async () => { await expect(updateRubric(1, { name: 'Upd' })).rejects.toThrow('PostgreSQL required'); });
});

// ── Versions (graceful degradation) ──
describe('Rubric — Versions', () => {
  it('createRubricVersion should reject', async () => { await expect(createRubricVersion(1, { change_summary: 'test' })).rejects.toThrow('PostgreSQL required'); });
  it('transitionRubricVersion should reject', async () => { await expect(transitionRubricVersion(1, 'published', 1)).rejects.toThrow('PostgreSQL required'); });
  it('listRubricVersions should return []', async () => { expect(await listRubricVersions(1)).toEqual([]); });
  it('diffRubricVersions should return null', async () => { expect(await diffRubricVersions(1, 2)).toBeNull(); });
});

// ── Criteria (graceful degradation) ──
describe('Rubric — Criteria', () => {
  it('createCriterion should reject when DB unavailable (validation AFTER DB check)', async () => {
    await expect(createCriterion({ rubric_version_id: 1, name: 'C1', levels: [] })).rejects.toThrow('PostgreSQL required');
  });
  it('createCriterion should reject when DB unavailable (valid data)', async () => {
    await expect(createCriterion({ rubric_version_id: 1, name: 'C1', levels: [{ points: 3, descriptor: 'Good' }, { points: 0, descriptor: 'Poor' }] })).rejects.toThrow('PostgreSQL required');
  });
  it('listCriteria should return []', async () => { expect(await listCriteria(1)).toEqual([]); });
  it('updateCriterion should reject', async () => { await expect(updateCriterion(1, { name: 'Upd' })).rejects.toThrow('PostgreSQL required'); });
  it('deleteCriterion should reject', async () => { await expect(deleteCriterion(1, 1)).rejects.toThrow('PostgreSQL required'); });
  it('getRubricVersionMaxPoints should return 0', async () => { expect(await getRubricVersionMaxPoints(1)).toBe(0); });
});

// ── Anchors (graceful degradation) ──
describe('Rubric — Anchors', () => {
  it('createAnchor should reject when DB unavailable (type validation AFTER DB check)', async () => {
    await expect(createAnchor({ rubric_version_id: 1, response_text: 'Test', expected_score: 3, type: 'invalid' })).rejects.toThrow('PostgreSQL required');
  });
  it('createAnchor should reject when DB unavailable', async () => {
    await expect(createAnchor({ rubric_version_id: 1, response_text: 'Test', expected_score: 3, type: 'exemplar' })).rejects.toThrow('PostgreSQL required');
  });
  it('listAnchors should return []', async () => { expect(await listAnchors(1)).toEqual([]); });
  it('deleteAnchor should reject', async () => { await expect(deleteAnchor(1, 1)).rejects.toThrow('PostgreSQL required'); });
});

// ── Pin (graceful degradation) ──
describe('Rubric — Item↔Rubric Pin', () => {
  it('pinRubricToItem should reject', async () => { await expect(pinRubricToItem(1, 1, 1)).rejects.toThrow('PostgreSQL required'); });
  it('getPinnedRubric should return null', async () => { expect(await getPinnedRubric(1)).toBeNull(); });
  it('unpinRubricFromItem should reject', async () => { await expect(unpinRubricFromItem(1, 1)).rejects.toThrow('PostgreSQL required'); });
});

// ── Preview (graceful degradation) ──
describe('Rubric — Preview', () => {
  it('generateRubricPreview should return error when no criteria', async () => {
    const result = await generateRubricPreview(1);
    expect(result.error).toBe('No criteria found');
  });
});

// ── Barrel ──
describe('Rubric — Barrel Export', () => {
  it('should export all functions', async () => {
    const mod = await import('../../src/modules/rubric/index.js');
    const expected = [
      'createRubric', 'getRubric', 'listRubrics', 'updateRubric',
      'createRubricVersion', 'transitionRubricVersion', 'listRubricVersions', 'diffRubricVersions',
      'createCriterion', 'updateCriterion', 'deleteCriterion', 'listCriteria', 'getRubricVersionMaxPoints',
      'createAnchor', 'listAnchors', 'deleteAnchor',
      'pinRubricToItem', 'getPinnedRubric', 'unpinRubricFromItem',
      'generateRubricPreview',
      'RUBRIC_TYPES', 'RUBRIC_STATUS', 'ANCHOR_TYPES', 'EVIDENCE_TYPES',
    ];
    for (const exp of expected) { expect(mod[exp]).toBeDefined(); }
  });
});
