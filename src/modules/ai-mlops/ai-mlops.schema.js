/**
 * Deborah — AI Evaluation, MLOps & Rollback (pure logic)
 *
 * Prompt 52 — golden set, deployment gate, drift va model rollbackni
 * production boshqaruviga aylantirish (research.md §7.7 metrics, §20
 * Phase 3 "Written AI Grading" QWK/fairness dashboard, §30 identity).
 * This module is PURE (no I/O, no globals):
 *
 *   - Metrics: computeEvalMetrics — QWK/MAE/exact/within-one (computeQwk
 *     Prompt 51'dan reuse), criterion F1, override rate.
 *   - Calibration: computeCalibrationEce — Expected Calibration Error.
 *   - Subgroup: computeSubgroupBreakdown — language/course/faculty
 *     fairness (Uzbek/Russian/English gap §7.7).
 *   - Gate service: evaluateGate — OFFLINE→SHADOW→ASSIST stage gate;
 *     holdout golden set faqat eval (trainingga QO'SHILMAYDI §15).
 *   - Drift: detectDrift — metric baseline vs current (rollback trigger).
 *   - Model ops: validateModelPin / isModelAllowlisted — version pin +
 *     allowlist (stop condition: faqat allowlisted version production'da).
 *   - Kill switch: planRollback — disable/rollback/retire decision +
 *     runbook ref. OLD FINAL GRADE SILENT REGRADE QILINMAYDI (§15).
 *
 * SECURITY / DATA GUARD (Prompt 52 §15-17):
 *   - Golden set trainingga qo'shilmaydi (holdout flag — eval only).
 *   - Rollback faqat model status'ni o'zgartiradi — hech qachon
 *     existing final grade'ni qayta yozmaydi (silent regrade yo'q).
 *   - Kill-switch threshold — drift bo'lsa auto-disable, human confirm.
 *   - Har bir write path tenant-scoped + idempotent.
 */

// ═══════════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════════

export const AI_MODEL_STATUS = {
  DRAFT: 'draft',
  ACTIVE: 'active',
  DISABLED: 'disabled',
  RETIRED: 'retired',
};

export const AI_DATASET_KIND = {
  GOLDEN: 'golden',
  ADVERSARIAL: 'adversarial',
};

export const AI_DATASET_STATUS = {
  DRAFT: 'draft',
  ACTIVE: 'active',
  RETIRED: 'retired',
};

export const AI_EVAL_RUN_STATUS = {
  QUEUED: 'queued',
  RUNNING: 'running',
  COMPLETED: 'completed',
  FAILED: 'failed',
};

export const AI_GATE_STAGE = {
  OFFLINE: 'offline',
  SHADOW: 'shadow',
  ASSIST: 'assist',
};

export const AI_GATE_DECISION = {
  APPROVED: 'approved',
  REJECTED: 'rejected',
  PENDING: 'pending',
};

export const AI_DRIFT_SEVERITY = {
  LOW: 'low',
  MEDIUM: 'medium',
  HIGH: 'high',
};

export const AI_ROLLBACK_ACTION = {
  DISABLE: 'disable',
  ROLLBACK: 'rollback',
  RETIRE: 'retire',
};

/**
 * Deployment gate default thresholds (§7.7).
 *  - OFFLINE→SHADOW: QWK ≥ 0.7 va ECE ≤ 0.15
 *  - SHADOW→ASSIST: QWK ≥ 0.8, override_rate ≤ 0.2, ECE ≤ 0.12
 *  - Drift: baseline QWK dan −0.05 dan ko'p tushsa medium; −0.10 high.
 */
export const GATE_DEFAULT_THRESHOLDS = {
  offline: { qwk: 0.7, ece: 0.15 },
  shadow: { qwk: 0.8, ece: 0.12, overrideRate: 0.2 },
  assist: { qwk: 0.85, ece: 0.1, overrideRate: 0.15 },
};

export const DRIFT_MEDIUM_DROP = 0.05;
export const DRIFT_HIGH_DROP = 0.1;

// ═══════════════════════════════════════════════════════════════════
// METRICS (§7.7)
// ═══════════════════════════════════════════════════════════════════

/**
 * Compute evaluation metrics for a set of AI-vs-gold pairs.
 * Reuses computeQwk from Prompt 51 (single source of truth).
 *
 * @param {Object} params
 * @param {Array<number>} params.aiScores
 * @param {Array<number>} params.goldScores
 * @returns {{
 *   ok: boolean, pairs: number,
 *   qwk: number|null, mae: number|null, exactAgreement: number|null,
 *   withinOneAgreement: number|null, rmse: number|null
 * }}
 */
export function computeEvalMetrics({ aiScores = [], goldScores = [] } = {}) {
  if (!Array.isArray(aiScores) || !Array.isArray(goldScores)) {
    return { ok: false, error: 'aiScores and goldScores must be arrays' };
  }
  if (aiScores.length !== goldScores.length || aiScores.length === 0) {
    return { ok: false, error: 'score arrays must be non-empty and equal length' };
  }
  const n = aiScores.length;
  let exact = 0;
  let withinOne = 0;
  let absSum = 0;
  let sqSum = 0;
  for (let i = 0; i < n; i++) {
    const a = Number(aiScores[i]);
    const g = Number(goldScores[i]);
    if (!Number.isFinite(a) || !Number.isFinite(g)) {
      return { ok: false, error: 'scores must be finite numbers' };
    }
    const delta = Math.abs(a - g);
    if (delta === 0) exact += 1;
    if (delta <= 1) withinOne += 1;
    absSum += delta;
    sqSum += delta * delta;
  }
  return {
    ok: true,
    pairs: n,
    qwk: computeQwk(aiScores, goldScores),
    mae: Number((absSum / n).toFixed(4)),
    rmse: Number(Math.sqrt(sqSum / n).toFixed(4)),
    exactAgreement: Number((exact / n).toFixed(4)),
    withinOneAgreement: Number((withinOne / n).toFixed(4)),
  };
}

/**
 * Criterion-level F1 (binary hit: score difference == 0).
 *
 * @param {Object} params
 * @param {number} params.truePositive - gold hit & AI hit
 * @param {number} params.falsePositive - gold miss & AI hit
 * @param {number} params.falseNegative - gold hit & AI miss
 * @returns {{ ok: boolean, precision: number|null, recall: number|null, f1: number|null }}
 */
export function computeCriterionF1({ truePositive = 0, falsePositive = 0, falseNegative = 0 } = {}) {
  const tp = Number(truePositive) || 0;
  const fp = Number(falsePositive) || 0;
  const fn = Number(falseNegative) || 0;
  const precision = tp + fp > 0 ? Number((tp / (tp + fp)).toFixed(4)) : 0;
  const recall = tp + fn > 0 ? Number((tp / (tp + fn)).toFixed(4)) : 0;
  const f1 = precision + recall > 0 ? Number(((2 * precision * recall) / (precision + recall)).toFixed(4)) : 0;
  return { ok: true, precision, recall, f1 };
}

/**
 * Override rate — teacher override qilgan ulush (autonomy ko'rsatkichi).
 *
 * @param {Object} params
 * @param {number} params.overrides - teacher override soni
 * @param {number} params.total - umumiy shadow run soni
 * @returns {{ ok: boolean, overrideRate: number|null }}
 */
export function computeOverrideRate({ overrides = 0, total = 0 } = {}) {
  const t = Number(total) || 0;
  if (t <= 0) return { ok: false, error: 'total must be > 0' };
  return { ok: true, overrideRate: Number((Number(overrides) / t).toFixed(4)) };
}

/**
 * Expected Calibration Error — confidence kalibratsiyasi (§7.7).
 * Bins 10: confidence interval [i/10, (i+1)/10), outcome = AI score == gold.
 *
 * @param {Object} params
 * @param {Array<number>} params.confidences
 * @param {Array<number>} params.outcomes - 0|1 (score match)
 * @param {number} [params.bins]
 * @returns {{ ok: boolean, ece: number|null, perBin: Array<Object> }}
 */
export function computeCalibrationEce({ confidences = [], outcomes = [], bins = 10 } = {}) {
  if (!Array.isArray(confidences) || !Array.isArray(outcomes) || confidences.length !== outcomes.length || confidences.length === 0) {
    return { ok: false, error: 'confidences and outcomes must be non-empty equal-length arrays' };
  }
  const k = Math.max(1, Math.min(20, Number(bins) || 10));
  const perBin = Array.from({ length: k }, () => ({ count: 0, acc: 0, conf: 0 }));
  for (let i = 0; i < confidences.length; i++) {
    const c = Number(confidences[i]);
    const o = Number(outcomes[i]) ? 1 : 0;
    if (!Number.isFinite(c)) return { ok: false, error: 'confidences must be finite' };
    const idx = Math.min(k - 1, Math.floor(Math.min(Math.max(c, 0), 0.9999) * k));
    perBin[idx].count += 1;
    perBin[idx].acc += o;
    perBin[idx].conf += c;
  }
  const n = confidences.length;
  let ece = 0;
  for (const b of perBin) {
    if (b.count === 0) {
      b.accuracy = null;
      b.confidence = null;
      continue;
    }
    b.accuracy = Number((b.acc / b.count).toFixed(4));
    b.confidence = Number((b.conf / b.count).toFixed(4));
    ece += (b.count / n) * Math.abs(b.accuracy - b.confidence);
  }
  return { ok: true, ece: Number(ece.toFixed(4)), perBin };
}

// ═══════════════════════════════════════════════════════════════════
// SUBGROUP BREAKDOWN (fairness §7.7)
// ═══════════════════════════════════════════════════════════════════

/**
 * Compute per-subgroup metrics (language/course/faculty).
 *
 * @param {Object} params
 * @param {Array<{ subgroup: string, ai: number, gold: number }>} params.items
 * @returns {{ ok: boolean, groups: Array<{ subgroup: string, n: number, qwk: number|null, mae: number|null, exactAgreement: number|null, withinOneAgreement: number|null }> }}
 */
export function computeSubgroupBreakdown({ items = [] } = {}) {
  if (!Array.isArray(items)) return { ok: false, error: 'items must be an array' };
  const byGroup = {};
  for (const it of items) {
    const key = String(it.subgroup || 'unknown');
    if (!byGroup[key]) byGroup[key] = [];
    byGroup[key].push(it);
  }
  const groups = Object.keys(byGroup)
    .sort()
    .map((subgroup) => {
      const g = byGroup[subgroup];
      const aiScores = g.map((x) => Number(x.ai));
      const goldScores = g.map((x) => Number(x.gold));
      const m = computeEvalMetrics({ aiScores, goldScores });
      return {
        subgroup,
        n: g.length,
        qwk: m.ok ? m.qwk : null,
        mae: m.ok ? m.mae : null,
        exactAgreement: m.ok ? m.exactAgreement : null,
        withinOneAgreement: m.ok ? m.withinOneAgreement : null,
      };
    });
  return { ok: true, groups };
}

// ═══════════════════════════════════════════════════════════════════
// GATE SERVICE (OFFLINE → SHADOW → ASSIST)
// ═══════════════════════════════════════════════════════════════════

/**
 * Evaluate whether a model passes the deployment gate at a given stage.
 * Golden/holdout dataset eval'dan kelgan metrikalar asosida qaror.
 *
 * @param {Object} params
 * @param {string} params.stage - offline | shadow | assist
 * @param {Object} params.metrics - { qwk, ece, overrideRate }
 * @param {Object} [params.thresholds] - overrides GATE_DEFAULT_THRESHOLDS
 * @returns {{ ok: boolean, decision: string, checks: Array<{name: string, ok: boolean, actual: number|null, threshold: number}> }}
 */
export function evaluateGate({ stage = AI_GATE_STAGE.SHADOW, metrics = {}, thresholds = null } = {}) {
  const t = thresholds || GATE_DEFAULT_THRESHOLDS[stage] || GATE_DEFAULT_THRESHOLDS.shadow;
  if (!t) return { ok: false, error: `no thresholds for stage ${stage}` };
  const checks = [];
  const add = (name, actual, threshold, comp) => {
    const ok = actual === null || actual === undefined ? false : comp(Number(actual), Number(threshold));
    checks.push({ name, ok, actual: actual === null || actual === undefined ? null : Number(actual), threshold: Number(threshold) });
  };
  add('qwk', metrics.qwk, t.qwk, (a, b) => a >= b);
  if (t.ece !== undefined) add('ece', metrics.ece, t.ece, (a, b) => a <= b);
  if (t.overrideRate !== undefined) add('override_rate', metrics.overrideRate, t.overrideRate, (a, b) => a <= b);
  const allOk = checks.every((c) => c.ok);
  return {
    ok: true,
    decision: allOk ? AI_GATE_DECISION.APPROVED : AI_GATE_DECISION.REJECTED,
    checks,
  };
}

// ═══════════════════════════════════════════════════════════════════
// DRIFT DETECTION
// ═══════════════════════════════════════════════════════════════════

/**
 * Detect metric drift between a baseline and current value.
 * Rollback trigger: medium/high severity → auto-disable flag.
 *
 * @param {Object} params
 * @param {string} params.metric - qwk | mae | f1 | ece | override_rate
 * @param {number} params.baseline
 * @param {number} params.current
 * @returns {{ ok: boolean, severity: string, delta: number, drifted: boolean }}
 */
export function detectDrift({ metric = 'qwk', baseline = null, current = null } = {}) {
  if (baseline === null || baseline === undefined || current === null || current === undefined) {
    return { ok: false, error: 'baseline and current are required' };
  }
  const b = Number(baseline);
  const c = Number(current);
  if (!Number.isFinite(b) || !Number.isFinite(c)) {
    return { ok: false, error: 'baseline and current must be finite numbers' };
  }
  // Higher-is-better metrics: drop = baseline - current (positive = worse)
  // Lower-is-better (mae, ece, override_rate): drop = current - baseline
  const lowerIsBetter = ['mae', 'ece', 'override_rate'].includes(metric);
  const drop = lowerIsBetter ? c - b : b - c;
  let severity = AI_DRIFT_SEVERITY.LOW;
  if (drop >= DRIFT_HIGH_DROP) severity = AI_DRIFT_SEVERITY.HIGH;
  else if (drop >= DRIFT_MEDIUM_DROP) severity = AI_DRIFT_SEVERITY.MEDIUM;
  return {
    ok: true,
    severity,
    delta: Number(drop.toFixed(4)),
    drifted: severity !== AI_DRIFT_SEVERITY.LOW,
  };
}

// ═══════════════════════════════════════════════════════════════════
// MODEL OPS (version pin / allowlist)
// ═══════════════════════════════════════════════════════════════════

/**
 * Validate a model+version is allowed to serve (pin + allowlist).
 *
 * @param {Object} params
 * @param {string} params.model
 * @param {string} params.version
 * @param {boolean} [params.allowlisted]
 * @param {string} [params.status]
 * @returns {{ ok: boolean, reason?: string }}
 */
export function validateModelPin({ model = '', version = '', allowlisted = false, status = AI_MODEL_STATUS.DRAFT } = {}) {
  if (!model || typeof model !== 'string') return { ok: false, reason: 'model is required' };
  if (!version || typeof version !== 'string') return { ok: false, reason: 'version is required (stop condition: exact version pin)' };
  if (status !== AI_MODEL_STATUS.ACTIVE) return { ok: false, reason: `model is not active (status: ${status})` };
  if (!allowlisted) return { ok: false, reason: 'model is not allowlisted — deployment gate not passed' };
  return { ok: true };
}

/**
 * Check a model is still in the allowlist and pinned version matches.
 * @param {Object} params
 * @param {string} params.pinnedVersion
 * @param {string} params.requestedVersion
 * @param {boolean} [params.allowlisted]
 * @returns {{ ok: boolean, reason?: string }}
 */
export function isModelAllowlisted({ pinnedVersion = '', requestedVersion = '', allowlisted = false } = {}) {
  if (!allowlisted) return { ok: false, reason: 'model not allowlisted' };
  if (!pinnedVersion || pinnedVersion !== requestedVersion) {
    return { ok: false, reason: `pinned version ${pinnedVersion || '(none)'} does not match requested ${requestedVersion}` };
  }
  return { ok: true };
}

// ═══════════════════════════════════════════════════════════════════
// KILL SWITCH / ROLLBACK
// ═══════════════════════════════════════════════════════════════════

/**
 * Plan a rollback/disable action. NEVER touches existing final grades —
 * only changes model status. Old final grade silent regrade qilinmaydi.
 *
 * @param {Object} params
 * @param {string} params.action - disable | rollback | retire
 * @param {string} params.fromStatus
 * @param {string} [params.reason]
 * @param {string} [params.runbookRef]
 * @returns {{ ok: boolean, toStatus: string, immutableFinal: true, reason?: string }}
 */
export function planRollback({ action = AI_ROLLBACK_ACTION.DISABLE, fromStatus = AI_MODEL_STATUS.ACTIVE, reason = '', runbookRef = '' } = {}) {
  if (!Object.values(AI_ROLLBACK_ACTION).includes(action)) {
    return { ok: false, reason: `invalid action ${action}` };
  }
  if (fromStatus === AI_MODEL_STATUS.RETIRED) {
    return { ok: false, reason: 'model already retired' };
  }
  const toStatus =
    action === AI_ROLLBACK_ACTION.RETIRE
      ? AI_MODEL_STATUS.RETIRED
      : AI_MODEL_STATUS.DISABLED;
  return {
    ok: true,
    toStatus,
    immutableFinal: true, // existing final grades never rewritten
    reason: reason || (action === AI_ROLLBACK_ACTION.RETIRE ? 'model retired' : 'model disabled'),
    runbookRef: runbookRef || (action === AI_ROLLBACK_ACTION.ROLLBACK ? 'RUNBOOK-ROLLBACK-V1' : 'RUNBOOK-DISABLE-V1'),
  };
}

/**
 * Golden set guard — golden/adversarial dataset faqat eval uchun.
 * @param {Object} params
 * @param {boolean} [params.holdout]
 * @param {string} [params.kind]
 * @returns {{ ok: boolean, reason?: string }}
 */
export function assertGoldenHoldout({ holdout = true, kind = AI_DATASET_KIND.GOLDEN } = {}) {
  if (kind === AI_DATASET_KIND.GOLDEN && !holdout) {
    return { ok: false, reason: 'golden set must be holdout — never used for training (Prompt 52 §15)' };
  }
  return { ok: true };
}

// Re-export QWK from Prompt 51 (single source of truth)
import { computeQwk } from '../ai-grading/ai-grading.schema.js';
export { computeQwk };
