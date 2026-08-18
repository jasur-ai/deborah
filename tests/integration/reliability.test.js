/**
 * Deborah — Reliability Guard (integration, Prompt 71)
 *
 * Service-level tests:
 *   - recordLoadRun with data guard + audit + metric
 *   - recordChaosDrill (reconnect data-loss, item 19)
 *   - recordBackupRestore → RPO/RTO evidence
 *   - recordDrain / recordFreeze
 *   - getReliabilityPosture DR readiness gate combination
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
import { LOAD_PROFILES, CHAOS_SCENARIOS } from '../../src/modules/reliability/reliability.schema.js';

const SAFE_DATASET = { usedFields: ['attemptId', 'answerLetter', 'questionId'], isolated: true };

describe('load run recording', () => {
  beforeEach(() => resetRehearsals());

  it('records a passing load run with data guard', async () => {
    const res = await recordLoadRun({
      profileId: 't-minus-30',
      observed: { ackP95Ms: 300, answerSaveAvailability: 0.9996, dataLoss: 0 },
      dataset: SAFE_DATASET,
      actorId: 'qa',
    });
    expect(res.ok).toBe(true);
    expect(res.dataGuard.ok).toBe(true);
  });

  it('rejects a load run using production PII fields (data guard)', async () => {
    const res = await recordLoadRun({
      profileId: 't0-start',
      observed: { ackP95Ms: 300, answerSaveAvailability: 0.9996, dataLoss: 0 },
      dataset: { usedFields: ['studentName', 'answerKey'], isolated: false },
      actorId: 'qa',
    });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/synthetic/);
  });

  it('data loss run is recorded as FAILED and reflected in posture', async () => {
    await recordLoadRun({
      profileId: 'autosave',
      observed: { ackP95Ms: 200, answerSaveAvailability: 0.9998, dataLoss: 3 },
      dataset: SAFE_DATASET,
    });
    const posture = await getReliabilityPosture();
    const run = posture.load.find((l) => l.profileId === 'autosave');
    expect(run.ok).toBe(false);
    expect(run.securityGuard).toMatch(/data corruption/);
    expect(posture.gate.pass).toBe(false);
  });
});

describe('chaos drills & reconnect data-loss (item 19)', () => {
  beforeEach(() => resetRehearsals());

  it('reconnect storm drill without data loss passes', async () => {
    const res = await recordChaosDrill({
      scenarioId: 'chaos-reconnect-storm',
      observed: { recoveryRate: 0.9995, dataCorrupted: false },
      actorId: 'qa',
    });
    expect(res.ok).toBe(true);
  });

  it('reconnect with data loss is forced to fail (item 15)', async () => {
    const res = await recordChaosDrill({
      scenarioId: 'chaos-app-node-kill',
      observed: { recoveryRate: 1.0, dataCorrupted: true },
    });
    expect(res.ok).toBe(false);
    expect(res.securityGuard).toMatch(/data corruption/);
  });

  it('all chaos scenarios recorded green → posture chaos section green', async () => {
    for (const s of CHAOS_SCENARIOS) {
      await recordChaosDrill({ scenarioId: s.id, observed: { recoveryRate: 0.999, dataCorrupted: false } });
    }
    const posture = await getReliabilityPosture();
    expect(posture.chaos.length).toBe(6);
    expect(posture.chaos.every((c) => c.ok)).toBe(true);
  });
});

describe('backup restore evidence (RPO/RTO)', () => {
  beforeEach(() => resetRehearsals());

  it('pg-pitr restore produces RPO/RTO evidence', async () => {
    const res = await recordBackupRestore({
      backupType: 'pg-pitr',
      observed: { rpoMinutes: 0.5, rtoMinutes: 21, restoredIntegrity: true, verifiedBy: 'devops' },
    });
    expect(res.ok).toBe(true);
    expect(res.evidence).toBeTruthy();
  });

  it('missing pg-pitr evidence blocks the DR gate', async () => {
    const posture = await getReliabilityPosture();
    expect(posture.gate.pass).toBe(false);
    expect(posture.gate.blocks.join(' ')).toMatch(/backup restore rehearsal missing/);
  });
});

describe('drain & freeze recording', () => {
  beforeEach(() => resetRehearsals());

  it('records a passing drain sequence', async () => {
    const res = await recordDrain({
      completedSteps: ['stop-new-connections', 'drain-socket-rooms', 'drain-worker-queue', 'flush-outbox', 'verify-zero-inflight', 'switch-traffic'],
      zeroInflight: true,
      actorId: 'devops',
    });
    expect(res.ok).toBe(true);
  });

  it('records a verified freeze runbook', async () => {
    const res = await recordFreeze({
      freezeActive: true,
      windowStart: '2026-08-01',
      windowEnd: '2026-08-14',
      rollbackVerified: true,
      actorId: 'release-mgr',
    });
    expect(res.ok).toBe(true);
    expect(res.plan).toBeTruthy();
  });
});

describe('DR readiness posture gate', () => {
  beforeEach(() => resetRehearsals());

  it('empty registry → gate blocked with all requirement blocks listed', async () => {
    const posture = await getReliabilityPosture();
    expect(posture.gate.pass).toBe(false);
    expect(posture.gate.blocks.length).toBeGreaterThanOrEqual(4);
  });

  it('full green rehearsal stack → gate passes (done condition item 25)', async () => {
    // Load — all 4 profiles
    for (const p of LOAD_PROFILES) {
      await recordLoadRun({ profileId: p.id, observed: { ackP95Ms: 300, answerSaveAvailability: 0.9996, dataLoss: 0 }, dataset: SAFE_DATASET });
    }
    // Chaos — all 6 scenarios
    for (const s of CHAOS_SCENARIOS) {
      await recordChaosDrill({ scenarioId: s.id, observed: { recoveryRate: 0.999, dataCorrupted: false } });
    }
    // Backup — pg-pitr + object
    await recordBackupRestore({ backupType: 'pg-pitr', observed: { rpoMinutes: 0.5, rtoMinutes: 21, restoredIntegrity: true, verifiedBy: 'devops' } });
    await recordBackupRestore({ backupType: 'object', observed: { rpoMinutes: 0.5, rtoMinutes: 15, restoredIntegrity: true, verifiedBy: 'devops' } });
    // Drain + freeze
    await recordDrain({ completedSteps: ['stop-new-connections', 'drain-socket-rooms', 'drain-worker-queue', 'flush-outbox', 'verify-zero-inflight', 'switch-traffic'], zeroInflight: true });
    await recordFreeze({ freezeActive: true, windowStart: '2026-08-01', windowEnd: '2026-08-14', rollbackVerified: true });

    const posture = await getReliabilityPosture();
    expect(posture.gate.pass).toBe(true);
    expect(posture.gate.blocks).toHaveLength(0);
  });

  it('targets are exposed with RPO ≤ 1 min, RTO ≤ 30 min', async () => {
    const posture = await getReliabilityPosture();
    expect(posture.targets.rpoMinutes).toBeLessThanOrEqual(1);
    expect(posture.targets.rtoMinutes).toBeLessThanOrEqual(30);
  });
});
