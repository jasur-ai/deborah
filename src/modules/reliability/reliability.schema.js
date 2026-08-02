/**
 * Edikit — Reliability Guard: Peak Load, Chaos, Backup/DR & Release Safety
 * (pure logic — Prompt 71)
 *
 * Prompt 71 proves data integrity under exam peak and dependency failures
 * (research §37 transaction/event architecture, §38 SRE/SLO/RTO/RPO):
 *
 *   - Load profiles: T−30 join ramp, T0 start spike, autosave steady-state,
 *     submit burst (item 07). SLO evaluation per profile (item 18).
 *   - Chaos scenarios: reconnect storm, app-node kill, Redis/DB/object/
 *     provider failure injection (items 08–09) — a scenario only passes when
 *     it did NOT corrupt data (item 15).
 *   - Backup/DR: PostgreSQL PITR restore, object/key recovery, RPO/RTO
 *     targets + evidence (items 10–12). RPO ≤ 1 min, RTO ≤ 30 min (§38.4).
 *   - Release safety: blue-green / canary / worker-socket drain + 7–14 day
 *     high-stakes freeze/rollback runbook (items 13–14).
 *   - Security/data guard: load tests never run with production PII/answer
 *     keys; failure scenarios cannot pass with data corruption.
 *
 * Purity: no I/O, no globals, no DB — fully unit-testable.
 */

// ═══════════════════════════════════════════════════════════════════
// 1. LOAD PROFILES & SLO (items 07, 18)
// ═══════════════════════════════════════════════════════════════════

/** Load profile phases for an exam window (§38.4 + item 07). */
export const LOAD_PROFILES = [
  {
    id: 't-minus-30',
    label: 'T−30 join ramp',
    description: 'Last 30 min before T0 — students join, reconnect storm risk',
    windowMs: 30 * 60000,
    expected: { concurrentPlayers: 250, joinsPerSec: 20, reconnectRatio: 0.5 },
    slo: { ackP95Ms: 500, answerSaveAvailability: 0.9995, dataLoss: 0 },
  },
  {
    id: 't0-start',
    label: 'T0 start spike',
    description: 'Exam opens — synchronized start, identity/preflight spike',
    windowMs: 5 * 60000,
    expected: { concurrentPlayers: 300, joinsPerSec: 40, reconnectRatio: 0.1 },
    slo: { ackP95Ms: 500, answerSaveAvailability: 0.9995, dataLoss: 0 },
  },
  {
    id: 'autosave',
    label: 'Autosave steady-state',
    description: 'Every 5–10 s autosave per active attempt (§37.3)',
    windowMs: 90 * 60000,
    expected: { concurrentPlayers: 300, autosavesPerSec: 60, reconnectRatio: 0.05 },
    slo: { ackP95Ms: 500, answerSaveAvailability: 0.9995, dataLoss: 0 },
  },
  {
    id: 'submit-burst',
    label: 'Submit burst',
    description: 'Sealing burst at end of exam — submit + scoring enqueue (§37)',
    windowMs: 10 * 60000,
    expected: { concurrentPlayers: 300, submitsPerSec: 50, reconnectRatio: 0.05 },
    slo: { ackP95Ms: 800, answerSaveAvailability: 0.999, dataLoss: 0 },
  },
];

export const LOAD_SLO_KEYS = ['ackP95Ms', 'answerSaveAvailability', 'dataLoss'];

/**
 * Evaluate a load profile run against its SLO (item 18 unit test target).
 *
 * @param {Object} params
 * @param {string} params.profileId - one of LOAD_PROFILES[].id
 * @param {Object} params.observed - { ackP95Ms, answerSaveAvailability, dataLoss }
 * @returns {{ ok: boolean, profile: string, checks: Array<{ name, ok, observed, target }>,
 *             securityGuard?: string }}
 */
export function evaluateLoadSlo({ profileId = 't-minus-30', observed = {} } = {}) {
  const profile = LOAD_PROFILES.find((p) => p.id === profileId);
  if (!profile) {
    return { ok: false, error: `Unknown load profile: ${profileId}` };
  }
  const checks = [];
  checks.push({
    name: 'ackP95Ms',
    ok: (observed.ackP95Ms ?? Infinity) <= profile.slo.ackP95Ms,
    observed: observed.ackP95Ms,
    target: profile.slo.ackP95Ms,
  });
  checks.push({
    name: 'answerSaveAvailability',
    ok: (observed.answerSaveAvailability ?? 0) >= profile.slo.answerSaveAvailability,
    observed: observed.answerSaveAvailability,
    target: profile.slo.answerSaveAvailability,
  });
  checks.push({
    name: 'dataLoss',
    ok: (observed.dataLoss ?? 0) === 0,
    observed: observed.dataLoss,
    target: 0,
  });

  // Security/data guard (item 15): a load run that reports data loss can
  // never pass — even if other SLOs are green.
  const dataLossOk = checks.find((c) => c.name === 'dataLoss').ok;
  const securityGuard = dataLossOk ? null : 'dataLoss > 0 — load run FAILED (data corruption must never pass)';

  return { ok: checks.every((c) => c.ok), profile: profileId, checks, securityGuard };
}

// ═══════════════════════════════════════════════════════════════════
// 2. CHAOS SCENARIOS (items 08–09, 15)
// ═══════════════════════════════════════════════════════════════════

/** Chaos scenario catalogue — dependency failures to inject (§38.5 runbooks). */
export const CHAOS_SCENARIOS = [
  {
    id: 'chaos-reconnect-storm',
    label: 'Reconnect storm',
    target: 'socket',
    description: 'Mass disconnect+reconnect (network flap) during T−30 — presence must not corrupt answers (item 08)',
    requiredRecovery: 0.999,
  },
  {
    id: 'chaos-app-node-kill',
    label: 'App-node kill',
    target: 'app',
    description: 'Kill one app node mid-exam — sessions recover on another node; in-flight writes must be idempotent (item 08)',
    requiredRecovery: 0.999,
  },
  {
    id: 'chaos-redis-fail',
    label: 'Redis outage',
    target: 'redis',
    description: 'Redis unavailable — session store falls back, socket adapter degrades without data loss (item 09)',
    requiredRecovery: 0.99,
  },
  {
    id: 'chaos-db-fail',
    label: 'Database outage',
    target: 'db',
    description: 'PostgreSQL unavailable — answer writes queue/retry; no silent ACK without persistence (item 09)',
    requiredRecovery: 0.99,
  },
  {
    id: 'chaos-object-fail',
    label: 'Object storage outage',
    target: 'storage',
    description: 'MinIO/S3 unavailable — evidence/uploads queue with retry; no loss of accepted evidence (item 09)',
    requiredRecovery: 0.99,
  },
  {
    id: 'chaos-provider-fail',
    label: 'AI provider outage',
    target: 'provider',
    description: 'Provider unavailable — grading jobs stay queued; degradation visible to user, no silent fail (§38.4)',
    requiredRecovery: 0.95,
  },
];

/**
 * Evaluate a chaos drill result (item 19 integration test target).
 * Security/data guard: recovery below the scenario threshold, OR any data
 * corruption, fails the drill.
 *
 * @param {Object} params
 * @param {string} params.scenarioId
 * @param {Object} params.observed - { recoveryRate, dataCorrupted, notes? }
 * @returns {{ ok: boolean, scenario: string, checks: Array, securityGuard?: string }}
 */
export function evaluateChaosDrill({ scenarioId = 'chaos-reconnect-storm', observed = {} } = {}) {
  const scenario = CHAOS_SCENARIOS.find((s) => s.id === scenarioId);
  if (!scenario) return { ok: false, error: `Unknown chaos scenario: ${scenarioId}` };

  const checks = [];
  checks.push({
    name: 'recoveryRate',
    ok: (observed.recoveryRate ?? 0) >= scenario.requiredRecovery,
    observed: observed.recoveryRate,
    target: scenario.requiredRecovery,
  });
  checks.push({
    name: 'noDataCorruption',
    ok: observed.dataCorrupted !== true,
    observed: observed.dataCorrupted === true,
    target: false,
  });

  const corruption = observed.dataCorrupted === true;
  const securityGuard = corruption
    ? `data corruption detected during ${scenarioId} — drill must FAIL (item 15)`
    : null;

  return { ok: checks.every((c) => c.ok), scenario: scenarioId, checks, securityGuard };
}

// ═══════════════════════════════════════════════════════════════════
// 3. BACKUP / DR — RPO/RTO EVIDENCE (items 10–12, §38.4)
// ═══════════════════════════════════════════════════════════════════

/** DR targets — RPO ≤ 1 min, RTO ≤ 30 min (§38.4, item 12). */
export const DR_TARGETS = {
  rpoMinutes: 1,
  rtoMinutes: 30,
};

export const BACKUP_TYPES = [
  { id: 'pg-pitr', label: 'PostgreSQL PITR', description: 'WAL archiving + base backup — point-in-time restore (item 10)' },
  { id: 'object', label: 'Object/key recovery', description: 'Evidence/upload objects + encryption keys recovery drill (item 11)' },
  { id: 'local-db', label: 'local-db snapshot', description: 'JSON file DB snapshot (dev/fallback mode)' },
];

/**
 * Validate a backup restore rehearsal against RPO/RTO targets (item 12).
 *
 * @param {Object} params
 * @param {string} params.backupType - one of BACKUP_TYPES[].id
 * @param {Object} params.observed - { rpoMinutes, rtoMinutes, restoredIntegrity, verifiedBy }
 * @returns {{ ok: boolean, type: string, checks: Array, evidence: Object }}
 */
export function evaluateBackupRestore({ backupType = 'pg-pitr', observed = {} } = {}) {
  const type = BACKUP_TYPES.find((b) => b.id === backupType);
  if (!type) return { ok: false, error: `Unknown backup type: ${backupType}` };

  const checks = [];
  checks.push({
    name: 'rpo',
    ok: (observed.rpoMinutes ?? Infinity) <= DR_TARGETS.rpoMinutes,
    observed: observed.rpoMinutes,
    target: `${DR_TARGETS.rpoMinutes} min`,
  });
  checks.push({
    name: 'rto',
    ok: (observed.rtoMinutes ?? Infinity) <= DR_TARGETS.rtoMinutes,
    observed: observed.rtoMinutes,
    target: `${DR_TARGETS.rtoMinutes} min`,
  });
  checks.push({
    name: 'integrity',
    ok: observed.restoredIntegrity === true,
    observed: observed.restoredIntegrity,
    target: true,
  });
  checks.push({
    name: 'verified',
    ok: Boolean(observed.verifiedBy),
    observed: observed.verifiedBy || null,
    target: 'non-empty verifier',
  });

  const pass = checks.every((c) => c.ok);
  return {
    ok: pass,
    type: backupType,
    checks,
    evidence: pass
      ? {
          backupType: backupType,
          rpoMinutes: observed.rpoMinutes,
          rtoMinutes: observed.rtoMinutes,
          restoredIntegrity: observed.restoredIntegrity,
          verifiedBy: observed.verifiedBy,
          rehearsalDate: observed.rehearsalDate || new Date().toISOString(),
        }
      : null,
  };
}

// ═══════════════════════════════════════════════════════════════════
// 4. RELEASE SAFETY — BLUE-GREEN / CANARY / DRAIN / FREEZE (items 13–14)
// ═══════════════════════════════════════════════════════════════════

/** Deployment strategies. */
export const DEPLOY_STRATEGIES = [
  { id: 'blue-green', label: 'Blue-green', description: 'Two full environments; atomic switch with rollback on error' },
  { id: 'canary', label: 'Canary', description: '% traffic to new version; rollback on SLO breach' },
];

/** Drain steps for worker/socket during a deploy (item 13). */
export const DRAIN_STEPS = [
  'stop-new-connections',
  'drain-socket-rooms',
  'drain-worker-queue',
  'flush-outbox',
  'verify-zero-inflight',
  'switch-traffic',
];

/**
 * Validate a drain sequence — must complete in order and end with
 * zero in-flight work before traffic switch.
 *
 * @param {Object} params
 * @param {string[]} params.completedSteps
 * @param {boolean} [params.zeroInflight]
 * @returns {{ ok: boolean, missing: string[], checks: Array }}
 */
export function validateDrainSequence({ completedSteps = [], zeroInflight = false } = {}) {
  const missing = DRAIN_STEPS.filter((s) => !completedSteps.includes(s));
  const inOrder = DRAIN_STEPS.every((s, i) => completedSteps[i] === undefined || completedSteps.indexOf(s) === i);
  const checks = [
    { name: 'allSteps', ok: missing.length === 0, detail: missing.length ? `missing: ${missing.join(', ')}` : 'all drain steps done' },
    { name: 'inOrder', ok: inOrder, detail: inOrder ? 'steps in order' : 'steps out of order' },
    { name: 'zeroInflight', ok: zeroInflight === true, detail: zeroInflight ? 'zero in-flight work' : 'in-flight work remains — traffic switch NOT safe' },
  ];
  return { ok: checks.every((c) => c.ok), missing, checks };
}

/**
 * 7–14 day high-stakes freeze/rollback runbook (item 14).
 * A high-stakes exam window requires a release freeze; a rollback plan with
 * verified restore point is mandatory.
 *
 * @param {Object} params
 * @param {boolean} params.freezeActive - releases frozen during window?
 * @param {string} params.windowStart - ISO date of freeze start
 * @param {string} params.windowEnd - ISO date of freeze end
 * @param {boolean} params.rollbackVerified - restore point verified?
 * @returns {{ ok: boolean, checks: Array, plan: Object }}
 */
export function validateFreezeRunbook({
  freezeActive = false,
  windowStart = null,
  windowEnd = null,
  rollbackVerified = false,
} = {}) {
  const checks = [];
  checks.push({
    name: 'freezeActive',
    ok: freezeActive === true,
    detail: freezeActive ? 'release freeze active' : 'release freeze NOT active for high-stakes window',
  });
  const windowValid = Boolean(windowStart) && Boolean(windowEnd)
    && new Date(windowStart).getTime() < new Date(windowEnd).getTime();
  checks.push({
    name: 'windowValid',
    ok: windowValid,
    detail: windowValid ? `${windowStart} → ${windowEnd}` : 'freeze window start/end missing or invalid',
  });
  checks.push({
    name: 'rollbackVerified',
    ok: rollbackVerified === true,
    detail: rollbackVerified ? 'rollback restore point verified' : 'rollback restore point NOT verified',
  });

  return {
    ok: checks.every((c) => c.ok),
    checks,
    plan: checks.every((c) => c.ok) ? {
      strategy: 'blue-green',
      freezeWindow: { start: windowStart, end: windowEnd },
      rollback: 'switch traffic back to previous environment after drain',
      restorePoint: 'verified base backup + WAL archive',
      durationDays: Math.max(1, Math.round((new Date(windowEnd).getTime() - new Date(windowStart).getTime()) / 86400000)),
    } : null,
  };
}

// ═══════════════════════════════════════════════════════════════════
// 5. SECURITY / DATA GUARD (item 15)
// ═══════════════════════════════════════════════════════════════════

/**
 * Validate a load/chaos rehearsal dataset against the data guard:
 * production PII / answer keys must NOT be used in load tests.
 *
 * @param {Object} params
 * @param {string[]} params.usedFields - fields present in the rehearsal dataset
 * @param {boolean} [params.isolated] - dataset isolated from production?
 * @returns {{ ok: boolean, violations: string[], guard?: string }}
 */
export function validateRehearsalDataset({
  usedFields = [],
  isolated = false,
} = {}) {
  const SENSITIVE = ['studentName', 'studentEmail', 'studentPhone', 'passport', 'answerKey', 'rubric', 'rawEssay'];
  const violations = SENSITIVE.filter((f) => usedFields.includes(f));
  const ok = violations.length === 0 && isolated === true;
  return {
    ok,
    violations,
    guard: ok ? null : `rehearsal dataset must be isolated+synthetic: violations=${violations.join(', ') || 'not-isolated'}`,
  };
}
