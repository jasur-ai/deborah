/**
 * Edikit — Institutional Handoff (unit, Prompt 72)
 *
 * Pure logic tests for src/modules/institutional/schema:
 *   - Cutover FSM transitions + final backup evidence + reconciliation parity
 *   - Cutover readiness gate (PG primary / legacy read-only)
 *   - Role training curriculum + evidence
 *   - Practice exam + pilot phase transitions + pilot decision
 *   - Procurement pack completeness + false-certification guard
 *   - Exit test (export/restore/delete)
 *   - Blocker waiver guard + write-path guard (item 15–16)
 */

import { describe, it, expect } from 'vitest';
import {
  CUTOVER_STATES,
  assertCutoverTransition,
  buildFinalBackupEvidence,
  evaluateReconciliation,
  evaluateCutoverReadiness,
  TRAINING_ROLES,
  TRAINING_CURRICULUM,
  validateTrainingRole,
  validateTrainingEvidence,
  validatePracticeExam,
  PILOT_PHASES,
  assertPilotTransition,
  evaluatePilotDecision,
  PROCUREMENT_ITEMS,
  evaluateProcurementPack,
  assertNoFalseCertification,
  EXIT_TEST_STEPS,
  evaluateExitTest,
  assertNoBlockerWaiver,
  assertWritePathGuard,
} from '../../src/modules/institutional/institutional.schema.js';

// ═══════════════════════════════════════════════════════════════════
// 1. CUTOVER FSM (items 07–09)
// ═══════════════════════════════════════════════════════════════════

describe('cutover FSM — definitions', () => {
  it('defines the 6-state cutover lifecycle', () => {
    expect(CUTOVER_STATES).toEqual([
      'pre-migration', 'backup-hash', 'dry-run', 'reconciled', 'cutover', 'completed',
    ]);
  });

  it('allows forward transitions only', () => {
    expect(assertCutoverTransition({ from: 'pre-migration', to: 'backup-hash' }).ok).toBe(true);
    expect(assertCutoverTransition({ from: 'reconciled', to: 'cutover' }).ok).toBe(true);
    expect(assertCutoverTransition({ from: 'cutover', to: 'completed' }).ok).toBe(true);
  });

  it('rejects skips and backwards jumps', () => {
    expect(assertCutoverTransition({ from: 'pre-migration', to: 'cutover' }).ok).toBe(false);
    expect(assertCutoverTransition({ from: 'cutover', to: 'reconciled' }).ok).toBe(false);
  });
});

describe('final backup evidence (item 07)', () => {
  it('accepts valid SHA-256 hash + actor', () => {
    const hash = 'a'.repeat(64);
    const res = buildFinalBackupEvidence({ dataHash: hash, records: { users: 3 }, actorId: 'ops' });
    expect(res.ok).toBe(true);
    expect(res.dataHash).toBe(hash);
  });

  it('rejects non-SHA-256 hashes', () => {
    expect(buildFinalBackupEvidence({ dataHash: 'short', records: {}, actorId: 'ops' }).ok).toBe(false);
    expect(buildFinalBackupEvidence({ dataHash: '', records: {}, actorId: 'ops' }).ok).toBe(false);
  });

  it('requires an actor', () => {
    expect(buildFinalBackupEvidence({ dataHash: 'a'.repeat(64), records: {}, actorId: '' }).ok).toBe(false);
  });
});

describe('reconciliation parity (item 09)', () => {
  it('passes when all section counts match', () => {
    const res = evaluateReconciliation({
      legacy: { users: 10, tests: 5, items: 40, results: 3, enrollments: 2 },
      migrated: { users: 10, tests: 5, items: 40, results: 3, enrollments: 2 },
    });
    expect(res.ok).toBe(true);
  });

  it('fails on any mismatch and names the section', () => {
    const res = evaluateReconciliation({
      legacy: { users: 10, tests: 5, items: 40 },
      migrated: { users: 10, tests: 6, items: 40 },
    });
    expect(res.ok).toBe(false);
    expect(res.checks.find((c) => c.section === 'tests').ok).toBe(false);
  });
});

describe('cutover readiness gate (item 08, 16)', () => {
  it('passes only with all gates green', () => {
    const res = evaluateCutoverReadiness({ backupOk: true, dryRunOk: true, reconciled: true, gate0Ok: true, legalOk: true, supportOk: true, drOk: true });
    expect(res.ok).toBe(true);
    expect(res.blocks).toHaveLength(0);
  });

  it('blocks and lists missing gates — legal/DR cannot be skipped', () => {
    const res = evaluateCutoverReadiness({ backupOk: true, dryRunOk: true, reconciled: true, gate0Ok: true, legalOk: false, supportOk: false, drOk: false });
    expect(res.ok).toBe(false);
    expect(res.blocks).toContain('legal-privacy');
    expect(res.blocks).toContain('dr-backup-verified');
  });
});

// ═══════════════════════════════════════════════════════════════════
// 2. TRAINING (items 10–11)
// ═══════════════════════════════════════════════════════════════════

describe('role training', () => {
  it('defines curricula for teacher/admin/proctor/marker', () => {
    expect(TRAINING_ROLES).toEqual(['teacher', 'admin', 'proctor', 'marker']);
    for (const role of TRAINING_ROLES) {
      expect(TRAINING_CURRICULUM[role].length).toBeGreaterThanOrEqual(3);
    }
  });

  it('rejects unknown roles', () => {
    expect(validateTrainingRole('principal').ok).toBe(false);
  });

  it('requires every step + human verifier', () => {
    const steps = TRAINING_CURRICULUM.teacher.map((s) => s.id);
    expect(validateTrainingEvidence({ role: 'teacher', completed: steps, verifier: 'trainer' }).ok).toBe(true);
    expect(validateTrainingEvidence({ role: 'teacher', completed: steps.slice(0, 1), verifier: 'trainer' }).ok).toBe(false);
    expect(validateTrainingEvidence({ role: 'teacher', completed: steps, verifier: '' }).ok).toBe(false);
  });
});

describe('practice exam (item 11)', () => {
  it('requires completion + attempts + participants + verifier', () => {
    expect(validatePracticeExam({ completed: true, attempts: 3, participants: 40, verifiedBy: 'office' }).ok).toBe(true);
    expect(validatePracticeExam({ completed: false, attempts: 0, participants: 0, verifiedBy: '' }).ok).toBe(false);
    expect(validatePracticeExam({ completed: true, attempts: 1, participants: 1, verifiedBy: '' }).ok).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 3. PILOT (items 12, 14)
// ═══════════════════════════════════════════════════════════════════

describe('pilot phases', () => {
  it('orders practice → low-stakes → controlled-midterm', () => {
    expect(PILOT_PHASES).toEqual(['practice', 'low-stakes', 'controlled-midterm']);
    expect(assertPilotTransition({ from: 'practice', to: 'low-stakes' }).ok).toBe(true);
    expect(assertPilotTransition({ from: 'low-stakes', to: 'controlled-midterm' }).ok).toBe(true);
    expect(assertPilotTransition({ from: 'practice', to: 'controlled-midterm' }).ok).toBe(false);
  });

  it('decides continue when metrics are green', () => {
    const res = evaluatePilotDecision({ phase: 'low-stakes', incidents: [], availability: 0.995, dataLossIncidents: 0 });
    expect(res.ok).toBe(true);
    expect(res.decision).toBe('continue');
  });

  it('decides extend when availability is below floor', () => {
    const res = evaluatePilotDecision({ phase: 'low-stakes', incidents: [], availability: 0.95, dataLossIncidents: 0 });
    expect(res.ok).toBe(false);
    expect(res.decision).toBe('extend');
  });

  it('rollback decision is explicit, not automatic on green metrics', () => {
    const res = evaluatePilotDecision({ phase: 'practice', incidents: [], availability: 1.0, dataLossIncidents: 0, rollback: true });
    expect(res.ok).toBe(true);
    expect(res.rollback).toBe(true);
  });

  it('any unresolved data-loss incident blocks continuation', () => {
    const res = evaluatePilotDecision({ phase: 'controlled-midterm', incidents: [], availability: 0.999, dataLossIncidents: 2 });
    expect(res.ok).toBe(false);
    expect(res.decision).toBe('extend');
  });
});

// ═══════════════════════════════════════════════════════════════════
// 4. PROCUREMENT PACK (item 13, research §75)
// ═══════════════════════════════════════════════════════════════════

describe('procurement pack', () => {
  it('defines the 12 buyer evidence items', () => {
    expect(PROCUREMENT_ITEMS.map((i) => i.id)).toContain('hecvat');
    expect(PROCUREMENT_ITEMS.map((i) => i.id)).toContain('acr');
    expect(PROCUREMENT_ITEMS.map((i) => i.id)).toContain('dpa');
    expect(PROCUREMENT_ITEMS.map((i) => i.id)).toContain('exit-plan');
    expect(PROCUREMENT_ITEMS.length).toBeGreaterThanOrEqual(12);
  });

  it('passes only when every item is provided with an owner', () => {
    const all = Object.fromEntries(PROCUREMENT_ITEMS.map((i) => [i.id, 'art_1']));
    expect(evaluateProcurementPack({ provided: all, owner: 'sales-owner' }).ok).toBe(true);
    const missingOne = { ...all };
    delete missingOne.hecvat;
    expect(evaluateProcurementPack({ provided: missingOne, owner: 'sales-owner' }).ok).toBe(false);
    expect(evaluateProcurementPack({ provided: all, owner: '' }).ok).toBe(false);
  });

  it('false-certification guard rejects unsupported claims (item 15)', () => {
    const res = assertNoFalseCertification({ claims: ['ISO 27001 certified'], evidenceMap: { 'ASVS v5.0': true } });
    expect(res.ok).toBe(false);
    expect(res.unsupportedClaims).toContain('ISO 27001 certified');
  });
});

// ═══════════════════════════════════════════════════════════════════
// 5. EXIT TEST (item 20)
// ═══════════════════════════════════════════════════════════════════

describe('tenant exit test', () => {
  it('defines export → restore → delete', () => {
    expect(EXIT_TEST_STEPS).toEqual(['export', 'restore', 'delete']);
  });

  it('passes with bundle hash + restore parity + deletion receipts', () => {
    const res = evaluateExitTest({
      completed: { export: true },
      bundleHash: 'a'.repeat(64),
      restoredOk: true,
      receipts: [{ store: 'pg' }],
    });
    expect(res.ok).toBe(true);
  });

  it('fails when restore is not verified or receipts are missing', () => {
    expect(evaluateExitTest({ completed: { export: true }, bundleHash: 'a'.repeat(64), restoredOk: false, receipts: [] }).ok).toBe(false);
    expect(evaluateExitTest({ completed: { export: false }, bundleHash: '', restoredOk: true, receipts: [{ s: 1 }] }).ok).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 6. SECURITY / DATA GUARD (items 15–16)
// ═══════════════════════════════════════════════════════════════════

describe('blocker waiver guard (item 15)', () => {
  it('legal/privacy/accessibility/DR blockers can never be waived', () => {
    const res = assertNoBlockerWaiver({ blockers: ['legal', 'privacy', 'a11y', 'dr'], waived: ['legal'] });
    expect(res.ok).toBe(false);
    expect(res.illegalWaivers).toContain('legal');
  });

  it('passes when no blockers are waived', () => {
    expect(assertNoBlockerWaiver({ blockers: ['legal', 'dr'], waived: [] }).ok).toBe(true);
  });
});

describe('write-path guard (item 16)', () => {
  it('requires tenant scope + authorization + validation + idempotency', () => {
    expect(assertWritePathGuard({ tenantScoped: true, authorized: true, validated: true, idempotent: true }).ok).toBe(true);
    const res = assertWritePathGuard({ tenantScoped: true, authorized: true, validated: false, idempotent: true });
    expect(res.ok).toBe(false);
    expect(res.blocks).toContain('validation');
  });
});
