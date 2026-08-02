/**
 * Edikit — Institutional Handoff Service (Prompt 72)
 *
 * Service half of the institutional module:
 *   - Cutover registry: final backup/hash evidence, reconciliation parity,
 *     PostgreSQL PRIMARY / legacy read-only state.
 *   - Training records: role-based training evidence (teacher/admin/proctor/
 *     marker) + student practice exam.
 *   - Pilot phases: practice → low-stakes → controlled midterm, with metrics,
 *     incidents and a rollback decision report.
 *   - Procurement pack: HECVAT/ACR/security/DPA/SLA/exit evidence checklist.
 *   - Exit test: full tenant export/restore/delete rehearsal.
 *   - Every privileged action is audited + emits telemetry (item 17).
 *
 * Graceful degradation: fully functional without PostgreSQL (in-memory).
 */

import { audit, AUDIT_ACTIONS } from '../auth/audit.js';
import { recordMetric } from '../../telemetry/index.js';
import {
  assertCutoverTransition,
  buildFinalBackupEvidence,
  evaluateReconciliation,
  evaluateCutoverReadiness,
  validateTrainingRole,
  validateTrainingEvidence,
  validatePracticeExam,
  assertPilotTransition,
  evaluatePilotDecision,
  evaluateProcurementPack,
  assertNoFalseCertification,
  evaluateExitTest,
  assertNoBlockerWaiver,
  assertWritePathGuard,
  CUTOVER_STATES,
  TRAINING_ROLES,
  PILOT_PHASES,
  PROCUREMENT_ITEMS,
  EXIT_TEST_STEPS,
} from './institutional.schema.js';

// ── In-memory institutional state registry ──
const state = {
  cutover: null,            // { status, evidence, ... }
  training: new Map(),      // role → { ...evidence }
  practice: null,           // practice exam evidence
  pilot: { phase: null, phases: {} },  // phase → { incidents, availability, decision }
  procurement: null,        // procurement pack evidence
  exit: null,               // exit test evidence
};

/** Reset the institutional state (seed for tests / CI). */
export function resetInstitutionalState() {
  state.cutover = null;
  state.training.clear();
  state.practice = null;
  state.pilot = { phase: null, phases: {} };
  state.procurement = null;
  state.exit = null;
}

/** Current cutover state (defaults to pre-migration when unset). */
function currentCutoverState() {
  return state.cutover?.status || 'pre-migration';
}

/**
 * Take the final legacy backup + hash — moves cutover to 'backup-hash'.
 * @param {Object} params - { dataHash, records, actorId }
 */
export async function recordFinalBackup({ dataHash = '', records = {}, actorId = null } = {}) {
  const evidence = buildFinalBackupEvidence({ dataHash, records, actorId });
  if (!evidence.ok) return evidence;

  const transition = assertCutoverTransition({ from: currentCutoverState(), to: 'backup-hash' });
  if (!transition.ok) return { ok: false, reason: transition.reason };

  state.cutover = { status: 'backup-hash', evidence, recordedAt: Date.now(), actorId };

  await audit({
    action: AUDIT_ACTIONS.INSTITUTIONAL_BACKUP_HASH,
    userId: actorId || null,
    resourceType: 'institutional',
    resourceId: 'cutover-backup',
    details: { dataHash: dataHash.slice(0, 16), records: Object.keys(records).length },
  }).catch(() => null);
  recordMetric('edikit_institutional_backup_hash_total', 1, { labels: { result: 'ok' } });

  return { ok: true, status: 'backup-hash', evidence };
}

/**
 * Record a migration dry-run review — moves cutover to 'dry-run'.
 * @param {Object} params - { reviewed, reportHash, actorId }
 */
export async function recordMigrationDryRun({ reviewed = false, reportHash = '', actorId = null } = {}) {
  if (!reviewed) return { ok: false, reason: 'migration dry-run report must be reviewed before cutover proceeds' };
  if (!reportHash) return { ok: false, reason: 'dry-run report hash is required' };

  const transition = assertCutoverTransition({ from: currentCutoverState(), to: 'dry-run' });
  if (!transition.ok) return { ok: false, reason: transition.reason };

  state.cutover = { status: 'dry-run', reportHash, reviewed: true, recordedAt: Date.now(), actorId };

  await audit({
    action: AUDIT_ACTIONS.INSTITUTIONAL_DRY_RUN,
    userId: actorId || null,
    resourceType: 'institutional',
    resourceId: 'cutover-dry-run',
    details: { reportHash: reportHash.slice(0, 16) },
  }).catch(() => null);
  recordMetric('edikit_institutional_dry_run_total', 1, { labels: { result: 'ok' } });

  return { ok: true, status: 'dry-run' };
}

/**
 * Record reconciliation parity — moves cutover to 'reconciled'.
 * @param {Object} params - { legacy, migrated, actorId }
 */
export async function recordReconciliation({ legacy = {}, migrated = {}, actorId = null } = {}) {
  const eval_ = evaluateReconciliation({ legacy, migrated });
  if (!eval_.ok) return { ok: false, reason: eval_.reason, checks: eval_.checks };

  const transition = assertCutoverTransition({ from: currentCutoverState(), to: 'reconciled' });
  if (!transition.ok) return { ok: false, reason: transition.reason };

  state.cutover = { status: 'reconciled', checks: eval_.checks, recordedAt: Date.now(), actorId };

  await audit({
    action: AUDIT_ACTIONS.INSTITUTIONAL_RECONCILE,
    userId: actorId || null,
    resourceType: 'institutional',
    resourceId: 'reconciliation',
    details: { sections: eval_.checks.length },
  }).catch(() => null);
  recordMetric('edikit_institutional_reconcile_total', 1, { labels: { result: 'ok' } });

  return { ok: true, status: 'reconciled', checks: eval_.checks };
}

/**
 * Execute the cutover — PostgreSQL becomes PRIMARY, legacy read-only flag.
 * Requires full readiness: backup, dry-run, reconciliation, Gate 0, legal,
 * support, DR verified. Legacy read-only can never be reversed to writable
 * (idempotency guard: second call returns already-cutover).
 * @param {Object} params - { gate0Ok, legalOk, supportOk, drOk, actorId }
 */
export async function executeCutover({ gate0Ok = false, legalOk = false, supportOk = false, drOk = false, actorId = null } = {}) {
  if (state.cutover?.status === 'cutover' || state.cutover?.status === 'completed') {
    return { ok: true, status: state.cutover.status, alreadyCutover: true };
  }

  const readiness = evaluateCutoverReadiness({
    backupOk: state.cutover?.status === 'backup-hash' || ['dry-run', 'reconciled'].includes(state.cutover?.status),
    dryRunOk: state.cutover?.status === 'dry-run' || state.cutover?.status === 'reconciled',
    reconciled: state.cutover?.status === 'reconciled',
    gate0Ok, legalOk, supportOk, drOk,
  });
  if (!readiness.ok) return { ok: false, reason: readiness.reason, blocks: readiness.blocks };

  const transition = assertCutoverTransition({ from: currentCutoverState(), to: 'cutover' });
  if (!transition.ok) return { ok: false, reason: transition.reason };

  state.cutover = {
    status: 'cutover',
    postgresPrimary: true,
    legacyReadOnly: true,
    executedAt: Date.now(),
    actorId,
  };

  await audit({
    action: AUDIT_ACTIONS.INSTITUTIONAL_CUTOVER,
    userId: actorId || null,
    resourceType: 'institutional',
    resourceId: 'cutover',
    details: { postgresPrimary: true, legacyReadOnly: true },
  }).catch(() => null);
  recordMetric('edikit_institutional_cutover_total', 1, { labels: { result: 'ok' } });

  return { ok: true, status: 'cutover', postgresPrimary: true, legacyReadOnly: true };
}

/** Mark cutover completed (terminal state). */
export async function completeCutover({ actorId = null } = {}) {
  const transition = assertCutoverTransition({ from: currentCutoverState(), to: 'completed' });
  if (!transition.ok) return { ok: false, reason: transition.reason };
  state.cutover = { ...(state.cutover || {}), status: 'completed', completedAt: Date.now(), actorId };

  await audit({
    action: AUDIT_ACTIONS.INSTITUTIONAL_CUTOVER_COMPLETE,
    userId: actorId || null,
    resourceType: 'institutional',
    resourceId: 'cutover',
    details: {},
  }).catch(() => null);
  return { ok: true, status: 'completed' };
}

// ═══════════════════════════════════════════════════════════════════
// TRAINING
// ═══════════════════════════════════════════════════════════════════

/** Record role-based training evidence (teacher/admin/proctor/marker). */
export async function recordTraining({ role = '', completed = [], verifier = '', actorId = null } = {}) {
  const evidence = validateTrainingEvidence({ role, completed, verifier });
  if (!evidence.ok) return evidence;
  state.training.set(role, { ...evidence, recordedAt: Date.now(), actorId });

  await audit({
    action: AUDIT_ACTIONS.INSTITUTIONAL_TRAINING,
    userId: actorId || null,
    resourceType: 'institutional',
    resourceId: `training:${role}`,
    details: { completedSteps: evidence.completedSteps, verifier },
  }).catch(() => null);
  recordMetric('edikit_institutional_training_total', 1, { labels: { role, result: 'ok' } });

  return { ok: true, role, completedSteps: evidence.completedSteps };
}

/** Record the student practice exam. */
export async function recordPracticeExam({ completed = false, attempts = 0, participants = 0, verifiedBy = '', actorId = null } = {}) {
  const evidence = validatePracticeExam({ completed, attempts, participants, verifiedBy });
  if (!evidence.ok) return evidence;
  state.practice = { ...evidence, recordedAt: Date.now(), actorId };

  await audit({
    action: AUDIT_ACTIONS.INSTITUTIONAL_PRACTICE,
    userId: actorId || null,
    resourceType: 'institutional',
    resourceId: 'practice-exam',
    details: { attempts, participants },
  }).catch(() => null);
  recordMetric('edikit_institutional_practice_exam_total', 1, { labels: { result: 'ok' } });

  return { ok: true, attempts, participants };
}

// ═══════════════════════════════════════════════════════════════════
// PILOT
// ═══════════════════════════════════════════════════════════════════

/** Record pilot metrics + incidents for the current phase and decide. */
export async function recordPilotPhase({
  phase = '', incidents = [], availability = 1.0, dataLossIncidents = 0, rollback = false, actorId = null,
} = {}) {
  if (!PILOT_PHASES.includes(phase)) return { ok: false, reason: `invalid pilot phase: ${phase}` };

  // Practice phase must be completed before low-stakes/midterm.
  if (phase !== 'practice' && !state.practice) {
    return { ok: false, reason: 'student practice exam must be completed before pilot phases' };
  }

  // Phase ordering — cannot jump phases. 'practice' is always the first phase.
  if (!state.pilot.phase && phase !== 'practice') {
    return { ok: false, reason: 'pilot must start with the practice phase' };
  }
  if (state.pilot.phase && state.pilot.phase !== phase) {
    const transition = assertPilotTransition({ from: state.pilot.phase, to: phase });
    if (!transition.ok) return { ok: false, reason: transition.reason };
  }

  const decision = evaluatePilotDecision({ phase, incidents, availability, dataLossIncidents, rollback });
  state.pilot.phase = phase;
  state.pilot.phases[phase] = { ...decision, incidents, recordedAt: Date.now(), actorId };

  await audit({
    action: AUDIT_ACTIONS.INSTITUTIONAL_PILOT,
    userId: actorId || null,
    resourceType: 'institutional',
    resourceId: `pilot:${phase}`,
    details: { decision: decision.decision, incidents: incidents.length, availability },
  }).catch(() => null);
  recordMetric('edikit_institutional_pilot_phase_total', 1, { labels: { phase, decision: decision.decision } });

  return { ok: decision.ok, phase, decision: decision.decision, blocks: decision.blocks };
}

// ═══════════════════════════════════════════════════════════════════
// PROCUREMENT PACK
// ═══════════════════════════════════════════════════════════════════

/** Record the procurement pack (buyer evidence) completeness. */
export async function recordProcurementPack({ provided = {}, owner = '', actorId = null } = {}) {
  const eval_ = evaluateProcurementPack({ provided, owner });
  if (!eval_.ok) return eval_;
  state.procurement = { ...eval_, provided, recordedAt: Date.now(), actorId };

  await audit({
    action: AUDIT_ACTIONS.INSTITUTIONAL_PROCUREMENT,
    userId: actorId || null,
    resourceType: 'institutional',
    resourceId: 'procurement-pack',
    details: { items: eval_.items, owner },
  }).catch(() => null);
  recordMetric('edikit_institutional_procurement_pack_total', 1, { labels: { result: 'ok' } });

  return { ok: true, items: eval_.items, owner };
}

/** Verify no unsupported certification claims (false-certification guard). */
export function verifyCertificationClaims({ claims = [], evidenceMap = {} } = {}) {
  return assertNoFalseCertification({ claims, evidenceMap });
}

// ═══════════════════════════════════════════════════════════════════
// EXIT TEST
// ═══════════════════════════════════════════════════════════════════

/** Record the full tenant exit test (export/restore/delete). */
export async function recordExitTest({ completed = {}, bundleHash = '', restoredOk = false, receipts = [], actorId = null } = {}) {
  const eval_ = evaluateExitTest({ completed, bundleHash, restoredOk, receipts });
  if (!eval_.ok) return eval_;
  state.exit = { ...eval_, bundleHash, restoredOk, receipts: receipts.length, recordedAt: Date.now(), actorId };

  await audit({
    action: AUDIT_ACTIONS.INSTITUTIONAL_EXIT_TEST,
    userId: actorId || null,
    resourceType: 'institutional',
    resourceId: 'exit-test',
    details: { steps: eval_.steps.length, bundleHash: bundleHash.slice(0, 12) },
  }).catch(() => null);
  recordMetric('edikit_institutional_exit_test_total', 1, { labels: { result: 'ok' } });

  return { ok: true, steps: eval_.steps };
}

// ═══════════════════════════════════════════════════════════════════
// POSTURE REPORT
// ═══════════════════════════════════════════════════════════════════

/**
 * Full institutional handoff posture — cutover, training, practice, pilot,
 * procurement and exit combined into a single release readiness gate.
 * @param {Object} [params]
 * @param {Object} [params.seed] - { cutover?, training?, practice?, pilot?, procurement?, exit? } to seed before evaluation
 */
export async function getInstitutionalPosture({ seed = {} } = {}) {
  if (seed.cutover) state.cutover = { ...seed.cutover, recordedAt: Date.now() };
  if (seed.training) for (const [k, v] of Object.entries(seed.training)) state.training.set(k, { ...v, recordedAt: Date.now() });
  if (seed.practice) state.practice = { ...seed.practice, recordedAt: Date.now() };
  if (seed.pilot) {
    state.pilot.phase = seed.pilot.phase || state.pilot.phase;
    for (const [k, v] of Object.entries(seed.pilot.phases || {})) state.pilot.phases[k] = { ...v, recordedAt: Date.now() };
  }
  if (seed.procurement) state.procurement = { ...seed.procurement, recordedAt: Date.now() };
  if (seed.exit) state.exit = { ...seed.exit, recordedAt: Date.now() };

  const training = [...state.training.entries()].map(([role, v]) => ({ role, ...v }));
  const allRolesTrained = TRAINING_ROLES.length === training.length && training.every((t) => t.ok);
  const practiceOk = state.practice ? state.practice.ok === true : false;
  const pilotPhases = Object.entries(state.pilot.phases).map(([phase, v]) => ({ phase, ...v }));
  const pilotOk = PILOT_PHASES.every((p) => state.pilot.phases[p]?.ok === true);
  const procurementOk = state.procurement ? state.procurement.ok === true : false;
  const exitOk = state.exit ? state.exit.ok === true : false;
  const cutoverDone = ['cutover', 'completed'].includes(state.cutover?.status);

  const gate = {
    pass: cutoverDone && allRolesTrained && practiceOk && pilotOk && procurementOk && exitOk,
    blocks: [
      ...(cutoverDone ? [] : ['cutover not executed (PostgreSQL primary + legacy read-only)']),
      ...(allRolesTrained ? [] : ['role training incomplete (teacher/admin/proctor/marker)']),
      ...(practiceOk ? [] : ['student practice exam not completed']),
      ...(pilotOk ? [] : ['pilot phases not all green (practice/low-stakes/controlled-midterm)']),
      ...(procurementOk ? [] : ['procurement pack incomplete (HECVAT/ACR/DPA/SLA/exit)']),
      ...(exitOk ? [] : ['tenant exit test not passed (export/restore/delete)']),
    ],
  };

  recordMetric('edikit_institutional_gate', gate.pass ? 1 : 0, {});

  return {
    cutover: state.cutover,
    training,
    practice: state.practice,
    pilot: { phase: state.pilot.phase, phases: pilotPhases },
    procurement: state.procurement,
    exit: state.exit,
    catalog: {
      cutoverStates: CUTOVER_STATES,
      trainingRoles: TRAINING_ROLES,
      pilotPhases: PILOT_PHASES,
      procurementItems: PROCUREMENT_ITEMS,
      exitSteps: EXIT_TEST_STEPS,
    },
    gate,
  };
}
