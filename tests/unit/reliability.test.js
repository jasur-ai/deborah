/**
 * Edikit — Reliability Guard (unit, Prompt 71)
 *
 * Pure logic tests for src/modules/reliability/schema:
 *   - Load profile SLO evaluation (peak load SLO test, item 18)
 *   - Chaos drills + data-corruption forced-fail guard (item 15)
 *   - Backup/DR RPO ≤ 1 min / RTO ≤ 30 min evidence (item 12)
 *   - Drain sequence (item 13) + freeze runbook (item 14)
 *   - Rehearsal dataset data guard (no production PII / answer keys)
 */

import { describe, it, expect } from 'vitest';
import {
  LOAD_PROFILES,
  evaluateLoadSlo,
  CHAOS_SCENARIOS,
  evaluateChaosDrill,
  BACKUP_TYPES,
  DR_TARGETS,
  evaluateBackupRestore,
  DRAIN_STEPS,
  validateDrainSequence,
  validateFreezeRunbook,
  validateRehearsalDataset,
} from '../../src/modules/reliability/reliability.schema.js';

// ═══════════════════════════════════════════════════════════════════
// 1. Load profile SLOs (items 07, 18)
// ═══════════════════════════════════════════════════════════════════

describe('load profiles — definitions', () => {
  it('defines all 4 exam phases (T−30, T0, autosave, submit)', () => {
    expect(LOAD_PROFILES.map((p) => p.id)).toEqual([
      't-minus-30', 't0-start', 'autosave', 'submit-burst',
    ]);
  });

  it('every profile has ack p95, availability and data-loss SLOs', () => {
    for (const p of LOAD_PROFILES) {
      expect(p.slo.ackP95Ms).toBeGreaterThan(0);
      expect(p.slo.answerSaveAvailability).toBeGreaterThan(0.99);
      expect(p.slo.dataLoss).toBe(0);
    }
  });

  it('submit burst allows slightly relaxed ack target (sealing spike)', () => {
    const submit = LOAD_PROFILES.find((p) => p.id === 'submit-burst');
    expect(submit.slo.ackP95Ms).toBeGreaterThanOrEqual(800);
  });
});

describe('load profile SLO evaluation (item 18)', () => {
  it('passes when all SLOs met', () => {
    const res = evaluateLoadSlo({
      profileId: 't-minus-30',
      observed: { ackP95Ms: 320, answerSaveAvailability: 0.9996, dataLoss: 0 },
    });
    expect(res.ok).toBe(true);
    expect(res.securityGuard).toBeNull();
  });

  it('fails when ack p95 exceeds target', () => {
    const res = evaluateLoadSlo({
      profileId: 't-minus-30',
      observed: { ackP95Ms: 900, answerSaveAvailability: 0.9996, dataLoss: 0 },
    });
    expect(res.ok).toBe(false);
    expect(res.checks.find((c) => c.name === 'ackP95Ms').ok).toBe(false);
  });

  it('fails when availability drops below target', () => {
    const res = evaluateLoadSlo({
      profileId: 'autosave',
      observed: { ackP95Ms: 200, answerSaveAvailability: 0.99, dataLoss: 0 },
    });
    expect(res.ok).toBe(false);
  });

  it('data loss > 0 can NEVER pass (security guard item 15)', () => {
    const res = evaluateLoadSlo({
      profileId: 't0-start',
      observed: { ackP95Ms: 100, answerSaveAvailability: 0.9999, dataLoss: 1 },
    });
    expect(res.ok).toBe(false);
    expect(res.securityGuard).toMatch(/data corruption must never pass/);
  });

  it('unknown profile returns clear error', () => {
    expect(evaluateLoadSlo({ profileId: 'nope' }).ok).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 2. Chaos drills (items 08–09, 15, 19)
// ═══════════════════════════════════════════════════════════════════

describe('chaos scenarios — definitions', () => {
  it('covers reconnect storm, app-node kill, redis/db/object/provider', () => {
    expect(CHAOS_SCENARIOS.map((s) => s.id)).toEqual([
      'chaos-reconnect-storm', 'chaos-app-node-kill', 'chaos-redis-fail',
      'chaos-db-fail', 'chaos-object-fail', 'chaos-provider-fail',
    ]);
  });

  it('reconnect storm requires ≥99.9% recovery (item 08)', () => {
    const storm = CHAOS_SCENARIOS.find((s) => s.id === 'chaos-reconnect-storm');
    expect(storm.requiredRecovery).toBeGreaterThanOrEqual(0.999);
  });
});

describe('chaos drill evaluation (item 19)', () => {
  it('passes with recovery above threshold and no corruption', () => {
    const res = evaluateChaosDrill({
      scenarioId: 'chaos-redis-fail',
      observed: { recoveryRate: 0.995, dataCorrupted: false },
    });
    expect(res.ok).toBe(true);
  });

  it('fails when recovery is below threshold', () => {
    const res = evaluateChaosDrill({
      scenarioId: 'chaos-db-fail',
      observed: { recoveryRate: 0.5, dataCorrupted: false },
    });
    expect(res.ok).toBe(false);
  });

  it('data corruption forces failure even with perfect recovery (item 15)', () => {
    const res = evaluateChaosDrill({
      scenarioId: 'chaos-app-node-kill',
      observed: { recoveryRate: 1.0, dataCorrupted: true },
    });
    expect(res.ok).toBe(false);
    expect(res.securityGuard).toMatch(/data corruption detected/);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 3. Backup / DR — RPO/RTO evidence (items 10–12)
// ═══════════════════════════════════════════════════════════════════

describe('DR targets', () => {
  it('RPO ≤ 1 min, RTO ≤ 30 min (§38.4)', () => {
    expect(DR_TARGETS.rpoMinutes).toBeLessThanOrEqual(1);
    expect(DR_TARGETS.rtoMinutes).toBeLessThanOrEqual(30);
  });
});

describe('backup restore evaluation (item 12)', () => {
  it('pg-pitr restore passes with evidence when RPO/RTO met + integrity verified', () => {
    const res = evaluateBackupRestore({
      backupType: 'pg-pitr',
      observed: { rpoMinutes: 0.7, rtoMinutes: 22, restoredIntegrity: true, verifiedBy: 'QA' },
    });
    expect(res.ok).toBe(true);
    expect(res.evidence).toBeTruthy();
    expect(res.evidence.rpoMinutes).toBe(0.7);
  });

  it('object/key recovery drill passes independently', () => {
    const res = evaluateBackupRestore({
      backupType: 'object',
      observed: { rpoMinutes: 0.5, rtoMinutes: 18, restoredIntegrity: true, verifiedBy: 'DevOps' },
    });
    expect(res.ok).toBe(true);
  });

  it('fails when RPO exceeds 1 min', () => {
    const res = evaluateBackupRestore({
      backupType: 'pg-pitr',
      observed: { rpoMinutes: 5, rtoMinutes: 20, restoredIntegrity: true, verifiedBy: 'QA' },
    });
    expect(res.ok).toBe(false);
    expect(res.evidence).toBeNull();
  });

  it('fails when RTO exceeds 30 min', () => {
    const res = evaluateBackupRestore({
      backupType: 'pg-pitr',
      observed: { rpoMinutes: 0.5, rtoMinutes: 45, restoredIntegrity: true, verifiedBy: 'QA' },
    });
    expect(res.ok).toBe(false);
  });

  it('integrity must be verified — no evidence without it', () => {
    const res = evaluateBackupRestore({
      backupType: 'object',
      observed: { rpoMinutes: 0.5, rtoMinutes: 15, restoredIntegrity: false, verifiedBy: 'QA' },
    });
    expect(res.ok).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 4. Release safety — drain & freeze (items 13–14)
// ═══════════════════════════════════════════════════════════════════

describe('drain sequence (item 13)', () => {
  it('defines the 6 drain steps ending with zero in-flight', () => {
    expect(DRAIN_STEPS).toHaveLength(6);
    expect(DRAIN_STEPS[DRAIN_STEPS.length - 1]).toBe('switch-traffic');
  });

  it('passes when all steps complete in order with zero in-flight', () => {
    const res = validateDrainSequence({ completedSteps: [...DRAIN_STEPS], zeroInflight: true });
    expect(res.ok).toBe(true);
  });

  it('fails with in-flight work remaining (traffic switch unsafe)', () => {
    const res = validateDrainSequence({ completedSteps: [...DRAIN_STEPS], zeroInflight: false });
    expect(res.ok).toBe(false);
    expect(res.checks.find((c) => c.name === 'zeroInflight').ok).toBe(false);
  });

  it('fails when steps are missing or out of order', () => {
    expect(validateDrainSequence({ completedSteps: ['switch-traffic', 'drain-socket-rooms'], zeroInflight: true }).ok).toBe(false);
  });
});

describe('freeze runbook (item 14)', () => {
  it('passes with freeze active + valid 7+ day window + verified rollback', () => {
    const res = validateFreezeRunbook({
      freezeActive: true,
      windowStart: '2026-08-01',
      windowEnd: '2026-08-14',
      rollbackVerified: true,
    });
    expect(res.ok).toBe(true);
    expect(res.plan.durationDays).toBeGreaterThanOrEqual(7);
  });

  it('fails when release freeze not active for high-stakes window', () => {
    const res = validateFreezeRunbook({ freezeActive: false, windowStart: '2026-08-01', windowEnd: '2026-08-14', rollbackVerified: true });
    expect(res.ok).toBe(false);
  });

  it('fails without verified rollback restore point', () => {
    const res = validateFreezeRunbook({ freezeActive: true, windowStart: '2026-08-01', windowEnd: '2026-08-14', rollbackVerified: false });
    expect(res.ok).toBe(false);
    expect(res.plan).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════
// 5. Security/data guard — rehearsal dataset (item 15)
// ═══════════════════════════════════════════════════════════════════

describe('rehearsal dataset guard (item 15)', () => {
  it('rejects production PII and answer keys in load test datasets', () => {
    const res = validateRehearsalDataset({ usedFields: ['studentName', 'answerKey'], isolated: true });
    expect(res.ok).toBe(false);
    expect(res.violations).toContain('studentName');
    expect(res.violations).toContain('answerKey');
  });

  it('rejects non-isolated datasets', () => {
    const res = validateRehearsalDataset({ usedFields: ['attemptId'], isolated: false });
    expect(res.ok).toBe(false);
  });

  it('accepts isolated synthetic datasets with benign fields', () => {
    const res = validateRehearsalDataset({ usedFields: ['attemptId', 'answerLetter', 'questionId'], isolated: true });
    expect(res.ok).toBe(true);
  });
});
