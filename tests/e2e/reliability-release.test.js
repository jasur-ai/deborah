/**
 * Deborah — Reliability Release Safety (e2e, Prompt 71, item 20)
 *
 * End-to-end reliability scenarios:
 *   - Isolated backup restore: restore is validated on a SYNTHETIC dataset
 *     (data guard) with integrity verification — production data never used.
 *   - Release rollback: blue-green drain → switch → rollback path verified.
 *   - Full DR readiness gate: only when load + chaos + backup + drain +
 *     freeze are all green (done condition item 25).
 *   - Data guard: a rehearsal that reports corruption can never yield a green
 *     gate, even if every other metric looks perfect.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  resetRehearsals,
  recordLoadRun,
  recordChaosDrill,
  recordBackupRestore,
  recordDrain,
  recordFreeze,
  getReliabilityPosture,
} from '../../src/modules/reliability/reliability.service.js';
import {
  LOAD_PROFILES,
  CHAOS_SCENARIOS,
  evaluateBackupRestore,
  validateDrainSequence,
  validateRehearsalDataset,
} from '../../src/modules/reliability/reliability.schema.js';

const SAFE_DATASET = { usedFields: ['attemptId', 'answerLetter', 'questionId'], isolated: true };

async function seedFullGreen() {
  for (const p of LOAD_PROFILES) {
    await recordLoadRun({ profileId: p.id, observed: { ackP95Ms: 300, answerSaveAvailability: 0.9996, dataLoss: 0 }, dataset: SAFE_DATASET });
  }
  for (const s of CHAOS_SCENARIOS) {
    await recordChaosDrill({ scenarioId: s.id, observed: { recoveryRate: 0.999, dataCorrupted: false } });
  }
  await recordBackupRestore({ backupType: 'pg-pitr', observed: { rpoMinutes: 0.5, rtoMinutes: 21, restoredIntegrity: true, verifiedBy: 'devops' } });
  await recordBackupRestore({ backupType: 'object', observed: { rpoMinutes: 0.5, rtoMinutes: 15, restoredIntegrity: true, verifiedBy: 'devops' } });
  await recordDrain({ completedSteps: ['stop-new-connections', 'drain-socket-rooms', 'drain-worker-queue', 'flush-outbox', 'verify-zero-inflight', 'switch-traffic'], zeroInflight: true });
  await recordFreeze({ freezeActive: true, windowStart: '2026-08-01', windowEnd: '2026-08-14', rollbackVerified: true });
}

describe('e2e — isolated backup restore (item 10–11, 20)', () => {
  beforeEach(() => resetRehearsals());

  it('pg-pitr restore on synthetic dataset passes with integrity evidence', async () => {
    const res = await recordBackupRestore({
      backupType: 'pg-pitr',
      observed: { rpoMinutes: 0.7, rtoMinutes: 24, restoredIntegrity: true, verifiedBy: 'ops' },
    });
    expect(res.ok).toBe(true);
    expect(res.evidence.restoredIntegrity).toBe(true);
    expect(res.evidence.verifiedBy).toBe('ops');
  });

  it('restore drill refuses production answer-key dataset (data guard)', () => {
    const guard = validateRehearsalDataset({ usedFields: ['answerKey', 'rawEssay'], isolated: false });
    expect(guard.ok).toBe(false);
    expect(guard.violations).toContain('answerKey');
  });

  it('object/key recovery drill restores evidence objects independently', async () => {
    const res = await recordBackupRestore({
      backupType: 'object',
      observed: { rpoMinutes: 0.4, rtoMinutes: 12, restoredIntegrity: true, verifiedBy: 'ops' },
    });
    expect(res.ok).toBe(true);
  });
});

describe('e2e — release rollback (blue-green, item 13–14, 20)', () => {
  beforeEach(() => resetRehearsals());

  it('drain completes in order then traffic switch is safe', () => {
    const res = validateDrainSequence({
      completedSteps: ['stop-new-connections', 'drain-socket-rooms', 'drain-worker-queue', 'flush-outbox', 'verify-zero-inflight', 'switch-traffic'],
      zeroInflight: true,
    });
    expect(res.ok).toBe(true);
  });

  it('rollback path: previous environment restore point is verified', async () => {
    await recordDrain({ completedSteps: ['stop-new-connections', 'drain-socket-rooms', 'drain-worker-queue', 'flush-outbox', 'verify-zero-inflight', 'switch-traffic'], zeroInflight: true });
    const freeze = await recordFreeze({
      freezeActive: true,
      windowStart: '2026-08-01',
      windowEnd: '2026-08-14',
      rollbackVerified: true,
    });
    expect(freeze.ok).toBe(true);
    expect(freeze.plan.rollback).toMatch(/switch traffic back/);
    expect(freeze.plan.restorePoint).toMatch(/base backup \+ WAL/);
  });

  it('rollback NOT verified blocks the freeze runbook', async () => {
    const freeze = await recordFreeze({ freezeActive: true, windowStart: '2026-08-01', windowEnd: '2026-08-14', rollbackVerified: false });
    expect(freeze.ok).toBe(false);
  });
});

describe('e2e — DR readiness gate (done condition item 25)', () => {
  beforeEach(() => resetRehearsals());

  it('full green stack → gate passes with zero blocks', async () => {
    await seedFullGreen();
    const posture = await getReliabilityPosture();
    expect(posture.gate.pass).toBe(true);
    expect(posture.gate.blocks).toHaveLength(0);
  });

  it('single missing chaos drill blocks the gate', async () => {
    await seedFullGreen();
    // Remove one chaos drill by re-running the gate with a hole: reset chaos
    // via a fresh reset + selective seeding is complex — instead simulate by
    // re-seeding only 5 of 6 scenarios.
    resetRehearsals();
    for (const p of LOAD_PROFILES) {
      await recordLoadRun({ profileId: p.id, observed: { ackP95Ms: 300, answerSaveAvailability: 0.9996, dataLoss: 0 }, dataset: SAFE_DATASET });
    }
    for (const s of CHAOS_SCENARIOS.slice(0, 5)) {
      await recordChaosDrill({ scenarioId: s.id, observed: { recoveryRate: 0.999, dataCorrupted: false } });
    }
    await recordBackupRestore({ backupType: 'pg-pitr', observed: { rpoMinutes: 0.5, rtoMinutes: 21, restoredIntegrity: true, verifiedBy: 'devops' } });
    await recordBackupRestore({ backupType: 'object', observed: { rpoMinutes: 0.5, rtoMinutes: 15, restoredIntegrity: true, verifiedBy: 'devops' } });
    await recordDrain({ completedSteps: ['stop-new-connections', 'drain-socket-rooms', 'drain-worker-queue', 'flush-outbox', 'verify-zero-inflight', 'switch-traffic'], zeroInflight: true });
    await recordFreeze({ freezeActive: true, windowStart: '2026-08-01', windowEnd: '2026-08-14', rollbackVerified: true });

    const posture = await getReliabilityPosture();
    expect(posture.gate.pass).toBe(false);
    expect(posture.gate.blocks.join(' ')).toMatch(/chaos drills/);
  });

  it('data corruption in ANY rehearsal can never produce a green gate (item 15)', async () => {
    await seedFullGreen();
    // Re-run one chaos drill WITH corruption — the record is replaced and must fail.
    await recordChaosDrill({ scenarioId: 'chaos-db-fail', observed: { recoveryRate: 1.0, dataCorrupted: true } });
    const posture = await getReliabilityPosture();
    expect(posture.gate.pass).toBe(false);
    expect(posture.gate.blocks.join(' ')).toMatch(/chaos drills/);
  });

  it('ack loss zero and RPO/RTO targets met in rehearsal (done condition)', async () => {
    await seedFullGreen();
    const posture = await getReliabilityPosture();
    // ACK loss zero == dataLoss 0 in every load profile
    for (const l of posture.load) {
      expect(l.checks.find((c) => c.name === 'dataLoss').observed).toBe(0);
    }
    // RPO/RTO met
    const pg = posture.backup.find((b) => b.backupType === 'pg-pitr');
    expect(pg.checks[0].ok).toBe(true); // rpo
    expect(pg.checks[1].ok).toBe(true); // rto
    expect(pg.checks[2].ok).toBe(true); // integrity
  });
});
