/**
 * Edikit — Institutional Handoff (integration, Prompt 72)
 *
 * Service-level tests:
 *   - Final backup hash → dry-run → reconciliation → cutover flow
 *   - Cutover readiness gate blocks when legal/DR not verified
 *   - Role training + practice exam recording
 *   - Pilot phase decision recording (practice → low-stakes → midterm)
 *   - Procurement pack + exit test
 *   - getInstitutionalPosture release gate combination
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  resetInstitutionalState,
  recordFinalBackup,
  recordMigrationDryRun,
  recordReconciliation,
  executeCutover,
  completeCutover,
  recordTraining,
  recordPracticeExam,
  recordPilotPhase,
  recordProcurementPack,
  recordExitTest,
  getInstitutionalPosture,
} from '../../src/modules/institutional/institutional.service.js';
import { TRAINING_CURRICULUM } from '../../src/modules/institutional/institutional.schema.js';
import { PROCUREMENT_ITEMS } from '../../src/modules/institutional/institutional.schema.js';

const HASH = 'a'.repeat(64);

describe('cutover flow', () => {
  beforeEach(() => resetInstitutionalState());

  it('backup → dry-run → reconcile → cutover (PG primary, legacy read-only)', async () => {
    const backup = await recordFinalBackup({ dataHash: HASH, records: { users: 5 }, actorId: 'ops' });
    expect(backup.ok).toBe(true);

    const dryRun = await recordMigrationDryRun({ reviewed: true, reportHash: HASH, actorId: 'ops' });
    expect(dryRun.ok).toBe(true);

    const parity = { users: 5, tests: 2, items: 20, results: 1, enrollments: 1 };
    const rec = await recordReconciliation({ legacy: parity, migrated: parity, actorId: 'ops' });
    expect(rec.ok).toBe(true);

    const cutover = await executeCutover({ gate0Ok: true, legalOk: true, supportOk: true, drOk: true, actorId: 'ops' });
    expect(cutover.ok).toBe(true);
    expect(cutover.postgresPrimary).toBe(true);
    expect(cutover.legacyReadOnly).toBe(true);
  });

  it('rejects reconciliation mismatch — cutover blocked', async () => {
    await recordFinalBackup({ dataHash: HASH, records: {}, actorId: 'ops' });
    await recordMigrationDryRun({ reviewed: true, reportHash: HASH, actorId: 'ops' });
    const rec = await recordReconciliation({ legacy: { users: 10 }, migrated: { users: 8 }, actorId: 'ops' });
    expect(rec.ok).toBe(false);
  });

  it('blocks cutover when legal or DR gate missing (no waiver possible)', async () => {
    await recordFinalBackup({ dataHash: HASH, records: {}, actorId: 'ops' });
    await recordMigrationDryRun({ reviewed: true, reportHash: HASH, actorId: 'ops' });
    await recordReconciliation({ legacy: { users: 1 }, migrated: { users: 1 }, actorId: 'ops' });
    const cutover = await executeCutover({ gate0Ok: true, legalOk: false, supportOk: true, drOk: false, actorId: 'ops' });
    expect(cutover.ok).toBe(false);
    expect(cutover.blocks).toContain('legal-privacy');
    expect(cutover.blocks).toContain('dr-backup-verified');
  });

  it('cutover is idempotent — second call returns already-cutover', async () => {
    await recordFinalBackup({ dataHash: HASH, records: {}, actorId: 'ops' });
    await recordMigrationDryRun({ reviewed: true, reportHash: HASH, actorId: 'ops' });
    await recordReconciliation({ legacy: { users: 1 }, migrated: { users: 1 }, actorId: 'ops' });
    await executeCutover({ gate0Ok: true, legalOk: true, supportOk: true, drOk: true, actorId: 'ops' });
    const again = await executeCutover({ gate0Ok: true, legalOk: true, supportOk: true, drOk: true, actorId: 'ops' });
    expect(again.ok).toBe(true);
    expect(again.alreadyCutover).toBe(true);
  });

  it('completes the cutover to terminal state', async () => {
    await recordFinalBackup({ dataHash: HASH, records: {}, actorId: 'ops' });
    await recordMigrationDryRun({ reviewed: true, reportHash: HASH, actorId: 'ops' });
    await recordReconciliation({ legacy: { users: 1 }, migrated: { users: 1 }, actorId: 'ops' });
    await executeCutover({ gate0Ok: true, legalOk: true, supportOk: true, drOk: true, actorId: 'ops' });
    const done = await completeCutover({ actorId: 'ops' });
    expect(done.ok).toBe(true);
    expect(done.status).toBe('completed');
  });
});

describe('training & practice', () => {
  beforeEach(() => resetInstitutionalState());

  it('records role training for all 4 roles', async () => {
    for (const role of Object.keys(TRAINING_CURRICULUM)) {
      const steps = TRAINING_CURRICULUM[role].map((s) => s.id);
      const res = await recordTraining({ role, completed: steps, verifier: 'trainer', actorId: 'office' });
      expect(res.ok).toBe(true);
    }
  });

  it('rejects incomplete training', async () => {
    const res = await recordTraining({ role: 'proctor', completed: ['p-incident'], verifier: 'trainer' });
    expect(res.ok).toBe(false);
  });

  it('records the student practice exam', async () => {
    const res = await recordPracticeExam({ completed: true, attempts: 5, participants: 60, verifiedBy: 'office', actorId: 'office' });
    expect(res.ok).toBe(true);
  });
});

describe('pilot phases', () => {
  beforeEach(() => resetInstitutionalState());

  it('requires practice exam before pilot phases', async () => {
    const res = await recordPilotPhase({ phase: 'low-stakes', incidents: [], availability: 0.999 });
    expect(res.ok).toBe(false);
    expect(res.reason).toMatch(/practice exam/);
  });

  it('walks practice → low-stakes → controlled-midterm', async () => {
    await recordPracticeExam({ completed: true, attempts: 5, participants: 60, verifiedBy: 'office' });
    const p1 = await recordPilotPhase({ phase: 'practice', incidents: [], availability: 0.999, dataLossIncidents: 0 });
    expect(p1.ok).toBe(true);
    const p2 = await recordPilotPhase({ phase: 'low-stakes', incidents: [], availability: 0.995, dataLossIncidents: 0 });
    expect(p2.ok).toBe(true);
    const p3 = await recordPilotPhase({ phase: 'controlled-midterm', incidents: [{ id: 'i1' }], availability: 0.998, dataLossIncidents: 0 });
    expect(p3.ok).toBe(true);
  });

  it('cannot skip phases', async () => {
    await recordPracticeExam({ completed: true, attempts: 5, participants: 60, verifiedBy: 'office' });
    const skip = await recordPilotPhase({ phase: 'controlled-midterm', incidents: [], availability: 0.999, dataLossIncidents: 0 });
    expect(skip.ok).toBe(false);
  });

  it('data-loss incidents force extend decision', async () => {
    await recordPracticeExam({ completed: true, attempts: 5, participants: 60, verifiedBy: 'office' });
    await recordPilotPhase({ phase: 'practice', incidents: [], availability: 1.0, dataLossIncidents: 0 });
    const res = await recordPilotPhase({ phase: 'low-stakes', incidents: [], availability: 0.99, dataLossIncidents: 1 });
    expect(res.ok).toBe(false);
    expect(res.decision).toBe('extend');
  });
});

describe('procurement pack & exit test', () => {
  beforeEach(() => resetInstitutionalState());

  it('records a complete procurement pack', async () => {
    const all = Object.fromEntries(PROCUREMENT_ITEMS.map((i) => [i.id, 'art_1']));
    const res = await recordProcurementPack({ provided: all, owner: 'sales-owner', actorId: 'sales' });
    expect(res.ok).toBe(true);
    expect(res.items).toBe(PROCUREMENT_ITEMS.length);
  });

  it('records the tenant exit test', async () => {
    const res = await recordExitTest({
      completed: { export: true },
      bundleHash: HASH,
      restoredOk: true,
      receipts: [{ store: 'pg' }, { store: 'object' }],
      actorId: 'ops',
    });
    expect(res.ok).toBe(true);
  });
});

describe('institutional posture gate (done condition item 25)', () => {
  beforeEach(() => resetInstitutionalState());

  it('empty state → gate blocked with all blocks listed', async () => {
    const posture = await getInstitutionalPosture();
    expect(posture.gate.pass).toBe(false);
    expect(posture.gate.blocks.length).toBeGreaterThanOrEqual(5);
  });

  it('full green handoff stack → gate passes', async () => {
    // Cutover
    await recordFinalBackup({ dataHash: HASH, records: { users: 5 }, actorId: 'ops' });
    await recordMigrationDryRun({ reviewed: true, reportHash: HASH, actorId: 'ops' });
    await recordReconciliation({ legacy: { users: 5 }, migrated: { users: 5 }, actorId: 'ops' });
    await executeCutover({ gate0Ok: true, legalOk: true, supportOk: true, drOk: true, actorId: 'ops' });
    // Training — all roles
    for (const role of Object.keys(TRAINING_CURRICULUM)) {
      await recordTraining({ role, completed: TRAINING_CURRICULUM[role].map((s) => s.id), verifier: 'trainer' });
    }
    // Practice + pilot
    await recordPracticeExam({ completed: true, attempts: 5, participants: 60, verifiedBy: 'office' });
    await recordPilotPhase({ phase: 'practice', incidents: [], availability: 1.0, dataLossIncidents: 0 });
    await recordPilotPhase({ phase: 'low-stakes', incidents: [], availability: 0.999, dataLossIncidents: 0 });
    await recordPilotPhase({ phase: 'controlled-midterm', incidents: [], availability: 0.999, dataLossIncidents: 0 });
    // Procurement + exit
    const all = Object.fromEntries(PROCUREMENT_ITEMS.map((i) => [i.id, 'art_1']));
    await recordProcurementPack({ provided: all, owner: 'sales-owner' });
    await recordExitTest({ completed: { export: true }, bundleHash: HASH, restoredOk: true, receipts: [{ store: 'pg' }] });

    const posture = await getInstitutionalPosture();
    expect(posture.gate.pass).toBe(true);
    expect(posture.gate.blocks).toHaveLength(0);
  });
});
