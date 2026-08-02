/**
 * Edikit — AI Evaluation, MLOps & Rollback (unit tests, Prompt 52)
 *
 * Pure schema tekshiruvi (hech qanday DB/I-O yo'q):
 *   - Metrics: QWK/MAE/RMSE/exact/within-one (computeQwk Prompt 51 reuse).
 *   - Criterion F1, override rate, calibration ECE.
 *   - Subgroup breakdown (language/course fairness §7.7).
 *   - Gate service: OFFLINE→SHADOW→ASSIST stage gate (thresholds).
 *   - Drift detection: severity low/medium/high + rollback trigger.
 *   - Model ops: version pin/allowlist (stop condition).
 *   - Kill switch: disable/rollback/retire — immutable final guard.
 *   - Golden set holdout: trainingga qo'shilmaydi (§15).
 */

import { describe, it, expect } from 'vitest';
import {
  computeEvalMetrics,
  computeCriterionF1,
  computeOverrideRate,
  computeCalibrationEce,
  computeSubgroupBreakdown,
  evaluateGate,
  detectDrift,
  validateModelPin,
  isModelAllowlisted,
  planRollback,
  assertGoldenHoldout,
  AI_MODEL_STATUS,
  AI_DATASET_KIND,
  AI_GATE_STAGE,
  AI_GATE_DECISION,
  AI_DRIFT_SEVERITY,
  AI_ROLLBACK_ACTION,
} from '../../src/modules/ai-mlops/index.js';

// ═══════════════════════════════════════════════════════════════════
// METRICS (§7.7)
// ═══════════════════════════════════════════════════════════════════

describe('AI MLOps — evaluation metrics (Prompt 52 §09)', () => {
  it('computes QWK=1, MAE=0, exact=1 for perfect agreement', () => {
    const m = computeEvalMetrics({ aiScores: [4, 3, 2, 1, 4], goldScores: [4, 3, 2, 1, 4] });
    expect(m.ok).toBe(true);
    expect(m.qwk).toBe(1);
    expect(m.mae).toBe(0);
    expect(m.exactAgreement).toBe(1);
    expect(m.withinOneAgreement).toBe(1);
    expect(m.rmse).toBe(0);
  });

  it('computes MAE/RMSE for off-by-one disagreement', () => {
    const m = computeEvalMetrics({ aiScores: [4, 3], goldScores: [3, 3] });
    expect(m.ok).toBe(true);
    expect(m.exactAgreement).toBe(0.5);
    expect(m.mae).toBe(0.5);
    expect(m.rmse).toBeCloseTo(0.7071, 3);
  });

  it('QWK < 1 for disagreement cohort', () => {
    const m = computeEvalMetrics({ aiScores: [4, 4, 4, 4, 4], goldScores: [4, 3, 2, 1, 0] });
    expect(m.ok).toBe(true);
    expect(m.qwk).toBeLessThan(1);
    expect(m.qwk).toBeGreaterThan(-1);
  });

  it('rejects mismatched/empty pairs', () => {
    expect(computeEvalMetrics({ aiScores: [1], goldScores: [1, 2] }).ok).toBe(false);
    expect(computeEvalMetrics({ aiScores: [], goldScores: [] }).ok).toBe(false);
    expect(computeEvalMetrics({ aiScores: [1], goldScores: ['x'] }).ok).toBe(false);
  });
});

describe('AI MLOps — F1 / override / calibration', () => {
  it('computes criterion F1 correctly', () => {
    const r = computeCriterionF1({ truePositive: 8, falsePositive: 2, falseNegative: 1 });
    expect(r.ok).toBe(true);
    expect(r.precision).toBe(0.8); // 8/(8+2)
    expect(r.recall).toBeCloseTo(0.8889, 3); // 8/(8+1)
    expect(r.f1).toBeCloseTo(0.8421, 3);
  });

  it('computes override rate', () => {
    expect(computeOverrideRate({ overrides: 2, total: 10 }).overrideRate).toBe(0.2);
    expect(computeOverrideRate({ overrides: 1, total: 0 }).ok).toBe(false);
  });

  it('computes ECE — well-calibrated → low ECE', () => {
    // Perfectly calibrated: bin accuracy == bin confidence (0.5 == 0.5)
    const r = computeCalibrationEce({
      confidences: [0.5, 0.5, 0.5, 0.5],
      outcomes: [1, 1, 0, 0],
    });
    expect(r.ok).toBe(true);
    expect(r.ece).toBe(0);
    expect(r.ece).toBeLessThan(0.1);
  });

  it('ECE detects miscalibration', () => {
    // Confident but wrong → high ECE
    const r = computeCalibrationEce({
      confidences: [0.9, 0.9, 0.9, 0.9],
      outcomes: [0, 0, 0, 0],
    });
    expect(r.ok).toBe(true);
    expect(r.ece).toBeGreaterThan(0.5);
  });
});

// ═══════════════════════════════════════════════════════════════════
// SUBGROUP BREAKDOWN (fairness §7.7)
// ═══════════════════════════════════════════════════════════════════

describe('AI MLOps — subgroup breakdown (§7.7)', () => {
  it('computes per-language metrics (Uzbek/Russian/English gap)', () => {
    const r = computeSubgroupBreakdown({
      items: [
        { subgroup: 'uz', ai: 4, gold: 4 },
        { subgroup: 'uz', ai: 3, gold: 3 },
        { subgroup: 'ru', ai: 2, gold: 4 },
        { subgroup: 'en', ai: 4, gold: 4 },
        { subgroup: 'en', ai: 1, gold: 4 },
      ],
    });
    expect(r.ok).toBe(true);
    const uz = r.groups.find((g) => g.subgroup === 'uz');
    const ru = r.groups.find((g) => g.subgroup === 'ru');
    const en = r.groups.find((g) => g.subgroup === 'en');
    expect(uz.n).toBe(2);
    expect(uz.qwk).toBe(1);
    expect(ru.n).toBe(1);
    expect(ru.mae).toBe(2);
    expect(en.n).toBe(2);
    // en subgroup MAE = (0 + 3)/2 = 1.5 > ru gap → fairness signal
    expect(en.mae).toBe(1.5);
  });
});

// ═══════════════════════════════════════════════════════════════════
// GATE SERVICE (OFFLINE → SHADOW → ASSIST)
// ═══════════════════════════════════════════════════════════════════

describe('AI MLOps — deployment gate (Prompt 52 §11)', () => {
  it('approves SHADOW gate when QWK≥0.80, ECE≤0.12, override≤0.20', () => {
    const g = evaluateGate({
      stage: AI_GATE_STAGE.SHADOW,
      metrics: { qwk: 0.85, ece: 0.08, overrideRate: 0.1 },
    });
    expect(g.ok).toBe(true);
    expect(g.decision).toBe(AI_GATE_DECISION.APPROVED);
    expect(g.checks.every((c) => c.ok)).toBe(true);
  });

  it('rejects SHADOW gate on low QWK', () => {
    const g = evaluateGate({
      stage: AI_GATE_STAGE.SHADOW,
      metrics: { qwk: 0.6, ece: 0.08, overrideRate: 0.1 },
    });
    expect(g.decision).toBe(AI_GATE_DECISION.REJECTED);
    expect(g.checks.find((c) => c.name === 'qwk').ok).toBe(false);
  });

  it('rejects ASSIST gate on high override rate', () => {
    const g = evaluateGate({
      stage: AI_GATE_STAGE.ASSIST,
      metrics: { qwk: 0.9, ece: 0.05, overrideRate: 0.4 },
    });
    expect(g.decision).toBe(AI_GATE_DECISION.REJECTED);
    expect(g.checks.find((c) => c.name === 'override_rate').ok).toBe(false);
  });

  it('OFFLINE gate is lenient (QWK≥0.70)', () => {
    const g = evaluateGate({ stage: AI_GATE_STAGE.OFFLINE, metrics: { qwk: 0.72, ece: 0.1 } });
    expect(g.decision).toBe(AI_GATE_DECISION.APPROVED);
  });
});

// ═══════════════════════════════════════════════════════════════════
// DRIFT DETECTION
// ═══════════════════════════════════════════════════════════════════

describe('AI MLOps — drift detection (Prompt 52 §13)', () => {
  it('no drift when stable', () => {
    const d = detectDrift({ metric: 'qwk', baseline: 0.85, current: 0.84 });
    expect(d.ok).toBe(true);
    expect(d.drifted).toBe(false);
    expect(d.severity).toBe(AI_DRIFT_SEVERITY.LOW);
  });

  it('medium drift at −0.05, high at −0.10', () => {
    expect(detectDrift({ metric: 'qwk', baseline: 0.85, current: 0.79 }).severity).toBe(AI_DRIFT_SEVERITY.MEDIUM);
    expect(detectDrift({ metric: 'qwk', baseline: 0.85, current: 0.7 }).severity).toBe(AI_DRIFT_SEVERITY.HIGH);
  });

  it('lower-is-better metrics (mae/ece) drift on increase', () => {
    // mae 0.40 → 0.47 = +0.07 → medium (≥0.05, <0.10)
    const d = detectDrift({ metric: 'mae', baseline: 0.4, current: 0.47 });
    expect(d.ok).toBe(true);
    expect(d.drifted).toBe(true);
    expect(d.severity).toBe(AI_DRIFT_SEVERITY.MEDIUM);
    // +0.15 → high
    expect(detectDrift({ metric: 'mae', baseline: 0.4, current: 0.55 }).severity).toBe(AI_DRIFT_SEVERITY.HIGH);
  });

  it('rejects non-finite values', () => {
    expect(detectDrift({ metric: 'qwk', baseline: null, current: 0.8 }).ok).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════
// MODEL OPS (version pin / allowlist)
// ═══════════════════════════════════════════════════════════════════

describe('AI MLOps — model pin & allowlist (Prompt 52 §13)', () => {
  it('only active + allowlisted models can serve', () => {
    expect(validateModelPin({ model: 'm', version: 'v1', allowlisted: true, status: AI_MODEL_STATUS.ACTIVE }).ok).toBe(true);
    expect(validateModelPin({ model: 'm', version: 'v1', allowlisted: false, status: AI_MODEL_STATUS.ACTIVE }).ok).toBe(false);
    expect(validateModelPin({ model: 'm', version: 'v1', allowlisted: true, status: AI_MODEL_STATUS.DRAFT }).ok).toBe(false);
  });

  it('requires exact version (stop condition)', () => {
    expect(validateModelPin({ model: 'm', version: '', allowlisted: true, status: AI_MODEL_STATUS.ACTIVE }).ok).toBe(false);
  });

  it('allowlist pin must match requested version', () => {
    expect(isModelAllowlisted({ pinnedVersion: 'v1', requestedVersion: 'v1', allowlisted: true }).ok).toBe(true);
    expect(isModelAllowlisted({ pinnedVersion: 'v1', requestedVersion: 'v2', allowlisted: true }).ok).toBe(false);
    expect(isModelAllowlisted({ pinnedVersion: 'v1', requestedVersion: 'v1', allowlisted: false }).ok).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════
// KILL SWITCH / ROLLBACK (§15)
// ═══════════════════════════════════════════════════════════════════

describe('AI MLOps — kill switch & rollback (Prompt 52 §14)', () => {
  it('disable → status disabled + runbook', () => {
    const p = planRollback({ action: AI_ROLLBACK_ACTION.DISABLE, fromStatus: AI_MODEL_STATUS.ACTIVE, reason: 'drift' });
    expect(p.ok).toBe(true);
    expect(p.toStatus).toBe(AI_MODEL_STATUS.DISABLED);
    expect(p.immutableFinal).toBe(true);
    expect(p.runbookRef).toBe('RUNBOOK-DISABLE-V1');
  });

  it('rollback keeps final grades immutable — never silent regrade', () => {
    const p = planRollback({ action: AI_ROLLBACK_ACTION.ROLLBACK, fromStatus: AI_MODEL_STATUS.ACTIVE });
    expect(p.toStatus).toBe(AI_MODEL_STATUS.DISABLED);
    expect(p.immutableFinal).toBe(true);
    expect(p.runbookRef).toBe('RUNBOOK-ROLLBACK-V1');
  });

  it('retire → status retired; already retired rejected', () => {
    expect(planRollback({ action: AI_ROLLBACK_ACTION.RETIRE, fromStatus: AI_MODEL_STATUS.ACTIVE }).toStatus).toBe(AI_MODEL_STATUS.RETIRED);
    expect(planRollback({ action: AI_ROLLBACK_ACTION.RETIRE, fromStatus: AI_MODEL_STATUS.RETIRED }).ok).toBe(false);
  });

  it('invalid action rejected', () => {
    expect(planRollback({ action: 'explode', fromStatus: AI_MODEL_STATUS.ACTIVE }).ok).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════
// GOLDEN SET HOLDout (§15 — trainingga qo'shilmaydi)
// ═══════════════════════════════════════════════════════════════════

describe('AI MLOps — golden set holdout (Prompt 52 §15)', () => {
  it('golden dataset must be holdout (eval only)', () => {
    expect(assertGoldenHoldout({ kind: AI_DATASET_KIND.GOLDEN, holdout: true }).ok).toBe(true);
    expect(assertGoldenHoldout({ kind: AI_DATASET_KIND.GOLDEN, holdout: false }).ok).toBe(false);
  });

  it('adversarial dataset may be non-holdout (training), golden never', () => {
    expect(assertGoldenHoldout({ kind: AI_DATASET_KIND.ADVERSARIAL, holdout: false }).ok).toBe(true);
  });
});
