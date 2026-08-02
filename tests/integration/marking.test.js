/**
 * Edikit — Marking service integration tests (Prompt 46)
 *
 * Service-layer coverage (graceful degradation without PostgreSQL):
 *   - Write paths validate input BEFORE requiring PG (fail fast with
 *     clear errors, no silent hangs).
 *   - Read paths return []/null when PG is unavailable.
 *   - Validation contract: required fields, invalid roles rejected,
 *     empty goldScores rejected, empty submissions rejected.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  createMarkingAssignment,
  allocateWorkItems,
  openCalibrationRun,
  completeCalibrationRun,
  saveCriterionScores,
  adjudicateModerationCase,
  getMarkingAssignment,
  listMarkingAssignments,
  listWorkItems,
  listModerationCases,
  listCalibrationRuns,
  getAssignmentProgress,
} from '../../src/modules/marking/index.js';

// All tests assume no PostgreSQL is configured (CI default), which the
// service handles via graceful degradation. If PG IS available, these
// tests would exercise real writes — but the assertions below only rely
// on the validation contract that runs BEFORE the DB call.

describe('marking service — validation contract (pre-DB)', () => {
  it('createMarkingAssignment requires assessmentId and markerUserId', async () => {
    await expect(createMarkingAssignment({})).rejects.toThrow('assessmentId and markerUserId are required');
  });

  it('createMarkingAssignment rejects invalid roles', async () => {
    await expect(createMarkingAssignment({ assessmentId: 1, markerUserId: 2, role: 'janitor' }))
      .rejects.toThrow('Invalid marker role');
  });

  it('createMarkingAssignment requires PostgreSQL after validation', async () => {
    await expect(createMarkingAssignment({ assessmentId: 1, markerUserId: 2, role: 'marker' }))
      .rejects.toThrow('PostgreSQL required');
  });

  it('allocateWorkItems requires assignmentId', async () => {
    await expect(allocateWorkItems({ submissions: [{ id: 1 }] })).rejects.toThrow('assignmentId is required');
  });

  it('allocateWorkItems requires a non-empty submissions array', async () => {
    await expect(allocateWorkItems({ assignmentId: 1, submissions: [] })).rejects.toThrow('submissions is required');
  });

  it('openCalibrationRun requires assignmentId and anchorSetId', async () => {
    await expect(openCalibrationRun({ goldScores: { a: 1 } })).rejects.toThrow('assignmentId and anchorSetId are required');
  });

  it('openCalibrationRun requires non-empty goldScores', async () => {
    await expect(openCalibrationRun({ assignmentId: 1, anchorSetId: 2, goldScores: {} })).rejects.toThrow('goldScores is required');
  });

  it('saveCriterionScores requires workItemId and markerUserId', async () => {
    await expect(saveCriterionScores({})).rejects.toThrow('workItemId and markerUserId are required');
  });

  it('saveCriterionScores requires non-empty criterionScores', async () => {
    await expect(saveCriterionScores({ workItemId: 1, markerUserId: 2, criterionScores: [] }))
      .rejects.toThrow('criterionScores is required');
  });

  it('adjudicateModerationCase requires caseId', async () => {
    await expect(adjudicateModerationCase({ adjudicatedScore: 70 })).rejects.toThrow('caseId is required');
  });

  it('adjudicateModerationCase requires adjudicatedScore', async () => {
    await expect(adjudicateModerationCase({ caseId: 1 })).rejects.toThrow('adjudicatedScore is required');
  });
});

describe('marking service — graceful degradation (read paths)', () => {
  it('listMarkingAssignments resolves to [] without PG', async () => {
    const rows = await listMarkingAssignments({});
    expect(Array.isArray(rows)).toBe(true);
    expect(rows).toHaveLength(0);
  });

  it('listWorkItems resolves to [] without PG', async () => {
    const rows = await listWorkItems({});
    expect(Array.isArray(rows)).toBe(true);
    expect(rows).toHaveLength(0);
  });

  it('listModerationCases resolves to [] without PG', async () => {
    const rows = await listModerationCases({});
    expect(Array.isArray(rows)).toBe(true);
    expect(rows).toHaveLength(0);
  });

  it('listCalibrationRuns resolves to [] without PG', async () => {
    const rows = await listCalibrationRuns({});
    expect(Array.isArray(rows)).toBe(true);
    expect(rows).toHaveLength(0);
  });

  it('getMarkingAssignment resolves to null without PG', async () => {
    const row = await getMarkingAssignment(1);
    expect(row).toBeNull();
  });

  it('getAssignmentProgress resolves to null without PG', async () => {
    const metrics = await getAssignmentProgress(1);
    expect(metrics).toBeNull();
  });
});
