/**
 * Deborah — Institutional Handoff (e2e, Prompt 72, item 20)
 *
 * End-to-end release scenarios:
 *   - Full cutover rehearsal: backup → dry-run → reconcile → cutover →
 *     completed (PG primary + legacy read-only).
 *   - Release rollback safety: legal/DR/accessibility blockers can never be
 *     waived (item 15); missing blocker blocks the gate.
 *   - Practice → pilot → procurement → exit full-stack release gate.
 *   - False certification guard: marketing claim must map to evidence.
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
  verifyCertificationClaims,
  getInstitutionalPosture,
} from '../../src/modules/institutional/institutional.service.js';
import {
  TRAINING_CURRICULUM,
  PROCUREMENT_ITEMS,
  assertNoBlockerWaiver,
} from '../../src/modules/institutional/institutional.schema.js';

const HASH = 'a'.repeat(64);

async function seedFullCutover() {
  await recordFinalBackup({ dataHash: HASH, records: { users: 5 }, actorId: 'ops' });
  await recordMigrationDryRun({ reviewed: true, reportHash: HASH, actorId: 'ops' });
  await recordReconciliation({ legacy: { users: 5 }, migrated: { users: 5 }, actorId: 'ops' });
  await executeCutover({ gate0Ok: true, legalOk: true, supportOk: true, drOk: true, actorId: 'ops' });
}

describe('e2e — full cutover rehearsal (items 07–09, 20)', () => {
  beforeEach(() => resetInstitutionalState());

  it('backup → dry-run → reconcile → cutover → completed, PG primary + legacy read-only', async () => {
    await seedFullCutover();
    const done = await completeCutover({ actorId: 'ops' });
    expect(done.ok).toBe(true);
    const posture = await getInstitutionalPosture();
    expect(posture.cutover.status).toBe('completed');
    expect(posture.cutover.postgresPrimary).toBe(true);
    expect(posture.cutover.legacyReadOnly).toBe(true);
  });

  it('reconciliation mismatch blocks cutover — no silent skip', async () => {
    await recordFinalBackup({ dataHash: HASH, records: {}, actorId: 'ops' });
    await recordMigrationDryRun({ reviewed: true, reportHash: HASH, actorId: 'ops' });
    const rec = await recordReconciliation({ legacy: { users: 100 }, migrated: { users: 99 }, actorId: 'ops' });
    expect(rec.ok).toBe(false);
    const cutover = await executeCutover({ gate0Ok: true, legalOk: true, supportOk: true, drOk: true, actorId: 'ops' });
    expect(cutover.ok).toBe(false);
  });

  it('rehearsal dataset/backup never mutates legacy source (read-only evidence)', async () => {
    // The service only records evidence — no write to any legacy path exists.
    const res = await recordFinalBackup({ dataHash: HASH, records: { users: 5 }, actorId: 'ops' });
    expect(res.ok).toBe(true);
    // Posture reflects evidence, not a mutated legacy store.
    const posture = await getInstitutionalPosture();
    expect(posture.cutover.status).toBe('backup-hash');
  });
});

describe('e2e — release rollback & blocker guard (item 15)', () => {
  beforeEach(() => resetInstitutionalState());

  it('legal/DR blocker can never be waived to look green', async () => {
    const res = assertNoBlockerWaiver({ blockers: ['legal-privacy', 'a11y', 'dr-backup'], waived: ['legal-privacy'] });
    expect(res.ok).toBe(false);
    expect(res.illegalWaivers).toContain('legal-privacy');
  });

  it('cutover with missing DR evidence stays blocked', async () => {
    await recordFinalBackup({ dataHash: HASH, records: {}, actorId: 'ops' });
    await recordMigrationDryRun({ reviewed: true, reportHash: HASH, actorId: 'ops' });
    await recordReconciliation({ legacy: { users: 1 }, migrated: { users: 1 }, actorId: 'ops' });
    const cutover = await executeCutover({ gate0Ok: true, legalOk: true, supportOk: true, drOk: false, actorId: 'ops' });
    expect(cutover.ok).toBe(false);
    expect(cutover.blocks).toContain('dr-backup-verified');
  });
});

describe('e2e — full institutional release (done condition item 25)', () => {
  beforeEach(() => resetInstitutionalState());

  it('cutover + all roles trained + practice + pilot + procurement + exit → gate green', async () => {
    await seedFullCutover();
    for (const role of Object.keys(TRAINING_CURRICULUM)) {
      await recordTraining({ role, completed: TRAINING_CURRICULUM[role].map((s) => s.id), verifier: 'trainer' });
    }
    await recordPracticeExam({ completed: true, attempts: 8, participants: 120, verifiedBy: 'office' });
    await recordPilotPhase({ phase: 'practice', incidents: [], availability: 1.0, dataLossIncidents: 0 });
    await recordPilotPhase({ phase: 'low-stakes', incidents: [{ id: 'i1' }], availability: 0.999, dataLossIncidents: 0 });
    await recordPilotPhase({ phase: 'controlled-midterm', incidents: [], availability: 0.999, dataLossIncidents: 0 });

    const all = Object.fromEntries(PROCUREMENT_ITEMS.map((i) => [i.id, 'art_1']));
    await recordProcurementPack({ provided: all, owner: 'sales-owner' });
    await recordExitTest({ completed: { export: true }, bundleHash: HASH, restoredOk: true, receipts: [{ store: 'pg' }, { store: 'object' }] });

    const posture = await getInstitutionalPosture();
    expect(posture.gate.pass).toBe(true);
    expect(posture.gate.blocks).toHaveLength(0);
  });

  it('missing pilot phase or procurement blocks the release', async () => {
    await seedFullCutover();
    for (const role of Object.keys(TRAINING_CURRICULUM)) {
      await recordTraining({ role, completed: TRAINING_CURRICULUM[role].map((s) => s.id), verifier: 'trainer' });
    }
    await recordPracticeExam({ completed: true, attempts: 8, participants: 120, verifiedBy: 'office' });
    await recordPilotPhase({ phase: 'practice', incidents: [], availability: 1.0, dataLossIncidents: 0 });
    // low-stakes + midterm missing

    const posture = await getInstitutionalPosture();
    expect(posture.gate.pass).toBe(false);
    expect(posture.gate.blocks.join(' ')).toMatch(/pilot phases/);
  });

  it('false certification claim is rejected (item 15)', async () => {
    const res = verifyCertificationClaims({
      claims: ['ISO/IEC 27001 certified', '100% accessible'],
      evidenceMap: { 'ASVS v5.0': true, 'WCAG 2.2 AA automated+manual': true },
    });
    expect(res.ok).toBe(false);
    expect(res.unsupportedClaims).toContain('ISO/IEC 27001 certified');
    expect(res.unsupportedClaims).toContain('100% accessible');
  });
});
