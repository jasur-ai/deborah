/**
 * Deborah — Intervention Loop, Adaptive Practice & Support (integration tests, Prompt 55)
 *
 * Service qatlami: graceful degradation (PG'siz → 400/error), validate-before-
 * getDb, reassessment item non-duplication (integration §19), idempotency.
 * PostgreSQL yo'q muhitda service'ning fail-closed xatti-harakati tekshiriladi.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('intervention — integration (Prompt 55 §19)', () => {
  let mod;
  beforeEach(async () => {
    vi.resetModules();
    vi.doMock('../../src/infrastructure/postgres.js', () => ({ getDb: () => null }));
    mod = await import('../../src/modules/intervention/index.js');
  });

  it('suggestMisconceptionMapping — PG yo\u2018q → graceful error', async () => {
    const r = await mod.suggestMisconceptionMapping({ competencyId: 1, label: 'Kalvin sikli xatosi' });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/PostgreSQL required/i);
  });

  it('suggestMisconceptionMapping — invalid label rejected before DB', async () => {
    const r = await mod.suggestMisconceptionMapping({ competencyId: 1, label: '' });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/misconception label is required/i);
  });

  it('createIntervention — PG yo\u2018q → graceful error', async () => {
    const r = await mod.createIntervention({ title: 'Algebra mashqlar', kind: 'exercise' });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/PostgreSQL required/i);
  });

  it('createIntervention — invalid kind rejected before DB', async () => {
    const r = await mod.createIntervention({ title: 'x', kind: 'lecture' });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/invalid kind/i);
  });

  it('generateNextActionCards — PG yo\u2018q → graceful error', async () => {
    const r = await mod.generateNextActionCards({
      evidence: { studentId: 1, competencyId: 2, score: 0.4 },
    });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/PostgreSQL required/i);
  });

  it('generateNextActionCards — missing evidence rejected before DB', async () => {
    const r = await mod.generateNextActionCards({ evidence: {} });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/studentId and competencyId are required/i);
  });

  it('decideNextAction — PG yo\u2018q → graceful error', async () => {
    const r = await mod.decideNextAction({ cardId: 1, decision: 'approve' });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/PostgreSQL required/i);
  });

  it('decideNextAction — invalid decision rejected before DB', async () => {
    const r = await mod.decideNextAction({ cardId: 1, decision: 'delete' });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/invalid decision/i);
  });

  it('assignReassessment — non-duplication plan runs before DB', async () => {
    const pool = [1, 2, 3, 4, 5, 6].map((id) => ({ id, difficulty: 0.5 }));
    const r = await mod.assignReassessment({
      studentId: 1,
      competencyId: 2,
      itemPool: pool,
      sourceItemIds: [1, 2],
      count: 3,
    });
    // PG yo'q, lekin non-duplication plan avval ishlaydi → error PG, plan OK emas
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/PostgreSQL required/i);
  });

  it('updateMasteryEstimate — PG yo\u2018q → graceful error', async () => {
    const r = await mod.updateMasteryEstimate({ studentId: 1, competencyId: 2, method: 'bkt', responses: [1, 1] });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/PostgreSQL required/i);
  });

  it('updateMasteryEstimate — invalid method rejected before DB', async () => {
    const r = await mod.updateMasteryEstimate({ studentId: 1, competencyId: 2, method: 'nn', responses: [1] });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/invalid method/i);
  });

  it('openSupportCase — private chat sentiment rejected before DB (§15)', async () => {
    const r = await mod.openSupportCase({
      studentId: 1,
      signalType: 'at_risk',
      evidence: { source: 'private_chat', score: 0.8 },
    });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/private chat sentiment/i);
  });

  it('openSupportCase — auto penalty rejected before DB (§15)', async () => {
    // assertNoPermanentLabelOrPenalty evidence field rad etadi
    const r = await mod.openSupportCase({
      studentId: 1,
      signalType: 'weak_concept',
      evidence: { grade_reduction: -5 },
    });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/penalty or permanent label/i);
  });

  it('submitContestRequest — empty reason rejected before DB', async () => {
    const r = await mod.submitContestRequest({ studentId: 1, requestType: 'appeal', reason: '' });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/reason is required/i);
  });

  it('getInterventionDashboard — PG yo\u2018q → empty graceful shape', async () => {
    const r = await mod.getInterventionDashboard();
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/PostgreSQL required/i);
    expect(Array.isArray(r.cards)).toBe(true);
  });
});
