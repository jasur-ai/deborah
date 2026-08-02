/**
 * Edikit — Consideration service integration tests (Prompt 48)
 *
 * Service-layer coverage (graceful degradation without PostgreSQL):
 *   - Write paths validate input BEFORE requiring PG (fail fast with
 *     clear errors).
 *   - Read paths return []/null when PG is unavailable.
 *   - Validation contract: required fields, invalid types/decisions
 *     rejected, human decider required (AI hukmi chiqarmaydi).
 */

import { describe, it, expect } from 'vitest';
import {
  createCase,
  transitionCase,
  decideCase,
  addCaseEvidence,
  getCaseEvidence,
  scheduleRemedy,
  completeRemedy,
  createScoringIncident,
  freezeIncident,
  addIncidentImpact,
  rescoreAttempt,
  getCase,
  listCases,
  listCaseDecisions,
  listCaseRemedies,
  listIncidents,
  listIncidentImpacts,
  listRescoreRuns,
} from '../../src/modules/consideration/index.js';

describe('consideration service — validation contract (pre-DB)', () => {
  it('createCase rejects invalid case types', async () => {
    await expect(createCase({ caseType: 'birthday', userId: 1, grounds: 'valid grounds here' }))
      .rejects.toThrow('Invalid case type');
  });

  it('createCase requires userId and grounds', async () => {
    await expect(createCase({ caseType: 'deferral' })).rejects.toThrow('userId is required');
    await expect(createCase({ caseType: 'deferral', userId: 1, grounds: 'x' })).rejects.toThrow('grounds are required');
  });

  it('createCase requires PostgreSQL after validation', async () => {
    await expect(createCase({ caseType: 'deferral', userId: 1, grounds: 'valid grounds here' }))
      .rejects.toThrow('PostgreSQL required');
  });

  it('transitionCase requires caseId and to', async () => {
    await expect(transitionCase({})).rejects.toThrow('caseId and to are required');
  });

  it('decideCase requires a HUMAN decider (AI hukmi chiqarmaydi)', async () => {
    await expect(decideCase({ caseId: 1, decision: 'approved', reason: 'valid reason here', decidedBy: null }))
      .rejects.toThrow('a human decider is required');
  });

  it('decideCase rejects AI/system deciders (fail-closed)', async () => {
    await expect(decideCase({ caseId: 1, decision: 'approved', reason: 'valid reason here', decidedBy: 'ai' }))
      .rejects.toThrow('a human decider is required');
    await expect(decideCase({ caseId: 1, decision: 'approved', reason: 'valid reason here', decidedBy: 'system' }))
      .rejects.toThrow('a human decider is required');
    await expect(decideCase({ caseId: 1, decision: 'approved', reason: 'valid reason here', decidedBy: 'auto' }))
      .rejects.toThrow('a human decider is required');
  });

  it('decideCase accepts a human decider then degrades to PostgreSQL required', async () => {
    await expect(decideCase({ caseId: 1, decision: 'approved', reason: 'valid reason here', decidedBy: 'admin' }))
      .rejects.toThrow('PostgreSQL required');
  });

  it('decideCase rejects invalid decisions', async () => {
    await expect(decideCase({ caseId: 1, decision: 'auto', reason: 'valid reason here', decidedBy: 2 }))
      .rejects.toThrow('Invalid decision');
  });

  it('addCaseEvidence requires caseId and plaintext', async () => {
    await expect(addCaseEvidence({})).rejects.toThrow('caseId and plaintext are required');
  });

  it('scheduleRemedy requires a valid remedyType', async () => {
    await expect(scheduleRemedy({ caseId: 1, remedyType: 'magic' })).rejects.toThrow('valid remedyType');
  });

  it('createScoringIncident requires title and valid kind', async () => {
    await expect(createScoringIncident({ title: '' })).rejects.toThrow('title is required');
    await expect(createScoringIncident({ title: 'x', kind: 'weird' })).rejects.toThrow('Invalid incident kind');
  });

  it('freezeIncident requires incidentId', async () => {
    await expect(freezeIncident({})).rejects.toThrow('incidentId is required');
  });

  it('addIncidentImpact requires incidentId and userId', async () => {
    await expect(addIncidentImpact({})).rejects.toThrow('incidentId and userId are required');
  });

  it('rescoreAttempt requires all fields', async () => {
    await expect(rescoreAttempt({})).rejects.toThrow('incidentId, attemptId, runId and newFinal are required');
  });
});

describe('consideration service — graceful degradation (read paths)', () => {
  it('listCases resolves to [] without PG', async () => {
    expect(await listCases({})).toEqual([]);
  });

  it('listCaseDecisions resolves to [] without PG', async () => {
    expect(await listCaseDecisions({})).toEqual([]);
  });

  it('listCaseRemedies resolves to [] without PG', async () => {
    expect(await listCaseRemedies({})).toEqual([]);
  });

  it('listIncidents resolves to [] without PG', async () => {
    expect(await listIncidents({})).toEqual([]);
  });

  it('listIncidentImpacts resolves to [] without PG', async () => {
    expect(await listIncidentImpacts({})).toEqual([]);
  });

  it('listRescoreRuns resolves to [] without PG', async () => {
    expect(await listRescoreRuns({})).toEqual([]);
  });

  it('getCase resolves to null without PG', async () => {
    expect(await getCase(1)).toBeNull();
  });

  it('getCaseEvidence resolves to null without PG', async () => {
    expect(await getCaseEvidence({ caseId: 1, evidenceId: 1 })).toBeNull();
  });
});
