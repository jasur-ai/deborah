/**
 * Edikit — Reliability Guard Service (Prompt 71)
 *
 * Service half of the reliability module:
 *   - Rehearsal evidence registry: load profile runs, chaos drills, backup
 *     restores, drain sequences, freeze runbooks (in-memory, seedable).
 *   - getReliabilityPosture(): combines all rehearsals into a DR/release
 *     readiness gate (RPO/RTO evidence + rollback verified + no data loss).
 *   - Every privileged rehearsal action is audited + emits telemetry
 *     (item 17).
 *
 * Graceful degradation: fully functional without PostgreSQL (in-memory).
 */

import { audit, AUDIT_ACTIONS } from '../auth/audit.js';
import { recordMetric } from '../../telemetry/index.js';
import {
  evaluateLoadSlo,
  evaluateChaosDrill,
  evaluateBackupRestore,
  validateDrainSequence,
  validateFreezeRunbook,
  validateRehearsalDataset,
  DR_TARGETS,
  LOAD_PROFILES,
  CHAOS_SCENARIOS,
} from './reliability.schema.js';

// ── In-memory rehearsal evidence registry ──
const rehearsals = {
  load: new Map(),      // profileId → last evaluation
  chaos: new Map(),     // scenarioId → last evaluation
  backup: new Map(),    // backupType → last evidence
  drain: null,          // last drain evaluation
  freeze: null,         // last freeze runbook evaluation
};

/** Reset the rehearsal registry (seed for tests / CI). */
export function resetRehearsals() {
  rehearsals.load.clear();
  rehearsals.chaos.clear();
  rehearsals.backup.clear();
  rehearsals.drain = null;
  rehearsals.freeze = null;
}

/**
 * Record a load profile run (audited + metric).
 *
 * @param {Object} params - { profileId, observed, dataset, actorId }
 * @returns {Promise<Object>} evaluation
 */
export async function recordLoadRun({ profileId, observed = {}, dataset = {}, actorId = null } = {}) {
  // Data guard first — synthetic/isolated dataset required (item 15).
  const dataGuard = validateRehearsalDataset({ usedFields: dataset.usedFields || [], isolated: dataset.isolated === true });
  if (!dataGuard.ok) {
    return { ok: false, error: dataGuard.guard };
  }

  const eval_ = evaluateLoadSlo({ profileId, observed });
  // Invalid input (unknown profileId) must NOT pollute the registry.
  if (!eval_.error) {
    rehearsals.load.set(profileId, { ...eval_, recordedAt: Date.now(), actorId });
  }

  await audit({
    action: AUDIT_ACTIONS.RELIABILITY_LOAD_RUN,
    userId: actorId || null,
    resourceType: 'reliability',
    resourceId: profileId,
    details: { ok: eval_.ok, dataLoss: observed.dataLoss ?? 0, guard: dataGuard.ok },
  }).catch(() => null);

  // Invalid input (unknown profileId) must not count as a run.
  if (!eval_.error) {
    recordMetric('edikit_reliability_load_runs_total', 1, { labels: { profile: profileId, result: eval_.ok ? 'pass' : 'fail' } });
  }

  return { ...eval_, dataGuard };
}

/**
 * Record a chaos drill (audited + metric). Data corruption → forced fail.
 *
 * @param {Object} params - { scenarioId, observed, actorId }
 * @returns {Promise<Object>} evaluation
 */
export async function recordChaosDrill({ scenarioId, observed = {}, actorId = null } = {}) {
  const eval_ = evaluateChaosDrill({ scenarioId, observed });
  // Invalid input (unknown scenarioId) must NOT pollute the registry.
  if (!eval_.error) {
    rehearsals.chaos.set(scenarioId, { ...eval_, recordedAt: Date.now(), actorId });
  }

  await audit({
    action: AUDIT_ACTIONS.RELIABILITY_CHAOS_DRILL,
    userId: actorId || null,
    resourceType: 'reliability',
    resourceId: scenarioId,
    details: { ok: eval_.ok, dataCorrupted: observed.dataCorrupted === true },
  }).catch(() => null);

  // Invalid input (unknown scenarioId) must not count as a drill.
  if (!eval_.error) {
    recordMetric('edikit_reliability_chaos_drills_total', 1, { labels: { scenario: scenarioId, result: eval_.ok ? 'pass' : 'fail' } });
  }

  return eval_;
}

/**
 * Record a backup restore rehearsal (audited + metric) — RPO/RTO evidence.
 *
 * @param {Object} params - { backupType, observed, actorId }
 * @returns {Promise<Object>} evaluation + evidence
 */
export async function recordBackupRestore({ backupType, observed = {}, actorId = null } = {}) {
  const eval_ = evaluateBackupRestore({ backupType, observed });
  // Invalid input (unknown backupType) must NOT pollute the registry.
  if (!eval_.error) {
    rehearsals.backup.set(backupType, { ...eval_, recordedAt: Date.now(), actorId });
  }

  await audit({
    action: AUDIT_ACTIONS.RELIABILITY_BACKUP_RESTORE,
    userId: actorId || null,
    resourceType: 'reliability',
    resourceId: backupType,
    details: {
      ok: eval_.ok,
      rpoMinutes: observed.rpoMinutes ?? null,
      rtoMinutes: observed.rtoMinutes ?? null,
      integrity: observed.restoredIntegrity === true,
    },
  }).catch(() => null);

  if (eval_.ok && eval_.evidence) {
    recordMetric('edikit_reliability_backup_restores_total', 1, { labels: { type: backupType, result: 'pass' } });
  }

  return eval_;
}

/**
 * Record a drain sequence check (item 13).
 *
 * @param {Object} params - { completedSteps, zeroInflight, actorId }
 * @returns {Promise<Object>} validation
 */
export async function recordDrain({ completedSteps = [], zeroInflight = false, actorId = null } = {}) {
  const eval_ = validateDrainSequence({ completedSteps, zeroInflight });
  rehearsals.drain = { ...eval_, recordedAt: Date.now(), actorId };

  await audit({
    action: AUDIT_ACTIONS.RELIABILITY_DRAIN,
    userId: actorId || null,
    resourceType: 'reliability',
    resourceId: 'drain',
    details: { ok: eval_.ok, zeroInflight },
  }).catch(() => null);

  return eval_;
}

/**
 * Record the high-stakes freeze runbook (item 14).
 *
 * @param {Object} params - { freezeActive, windowStart, windowEnd, rollbackVerified, actorId }
 * @returns {Promise<Object>} validation
 */
export async function recordFreeze({ freezeActive = false, windowStart = null, windowEnd = null, rollbackVerified = false, actorId = null } = {}) {
  const eval_ = validateFreezeRunbook({ freezeActive, windowStart, windowEnd, rollbackVerified });
  rehearsals.freeze = { ...eval_, recordedAt: Date.now(), actorId };

  await audit({
    action: AUDIT_ACTIONS.RELIABILITY_FREEZE,
    userId: actorId || null,
    resourceType: 'reliability',
    resourceId: 'freeze',
    details: { ok: eval_.ok, freezeActive, rollbackVerified },
  }).catch(() => null);

  return eval_;
}

/**
 * Full reliability posture report — load SLOs, chaos drills, backup/DR
 * evidence, drain/freeze status combined into a DR readiness gate.
 *
 * @param {Object} [params]
 * @param {Object<string, Object>} [params.seed] - { load?, chaos?, backup?, drain?, freeze? } evidence to seed before evaluation
 * @returns {Promise<Object>} posture report
 */
export async function getReliabilityPosture({ seed = {} } = {}) {
  if (seed.load) for (const [k, v] of Object.entries(seed.load)) rehearsals.load.set(k, { ...v, recordedAt: Date.now() });
  if (seed.chaos) for (const [k, v] of Object.entries(seed.chaos)) rehearsals.chaos.set(k, { ...v, recordedAt: Date.now() });
  if (seed.backup) for (const [k, v] of Object.entries(seed.backup)) rehearsals.backup.set(k, { ...v, recordedAt: Date.now() });
  if (seed.drain) rehearsals.drain = { ...seed.drain, recordedAt: Date.now() };
  if (seed.freeze) rehearsals.freeze = { ...seed.freeze, recordedAt: Date.now() };

  const load = [...rehearsals.load.entries()].map(([k, v]) => ({ profileId: k, ...v }));
  const chaos = [...rehearsals.chaos.entries()].map(([k, v]) => ({ scenarioId: k, ...v }));
  const backup = [...rehearsals.backup.entries()].map(([k, v]) => ({ backupType: k, ...v }));

  // Full catalogue coverage required: ALL 4 load profiles and ALL 6 chaos
  // scenarios must be recorded AND pass — a partial rehearsal set never
  // yields a green gate (item 25 done condition).
  const allLoadPass = LOAD_PROFILES.length === load.length && load.every((l) => l.ok);
  const allChaosPass = CHAOS_SCENARIOS.length === chaos.length && chaos.every((c) => c.ok);
  const pgRestore = backup.find((b) => b.backupType === 'pg-pitr');
  const objRecovery = backup.find((b) => b.backupType === 'object');
  const backupPass = Boolean(pgRestore?.ok) && Boolean(objRecovery?.ok);
  const drainOk = rehearsals.drain ? rehearsals.drain.ok === true : false;
  const freezeOk = rehearsals.freeze ? rehearsals.freeze.ok === true : false;

  const gate = {
    pass: allLoadPass && allChaosPass && backupPass && drainOk && freezeOk,
    blocks: [
      ...(allLoadPass ? [] : ['load profile SLOs not all green']),
      ...(allChaosPass ? [] : ['chaos drills not all passed (or missing)']),
      ...(backupPass ? [] : ['backup restore rehearsal missing or failing (RPO≤1min / RTO≤30min)']),
      ...(drainOk ? [] : ['drain sequence not verified']),
      ...(freezeOk ? [] : ['high-stakes freeze runbook not verified']),
    ],
  };

  // Telemetry — DR readiness gate (item 17)
  recordMetric('edikit_reliability_dr_gate', gate.pass ? 1 : 0, {});

  return {
    load,
    chaos,
    backup,
    drain: rehearsals.drain,
    freeze: rehearsals.freeze,
    targets: DR_TARGETS,
    gate,
  };
}
