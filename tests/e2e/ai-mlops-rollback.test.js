/**
 * Edikit — AI Evaluation, MLOps & Rollback (e2e, Prompt 52)
 *
 * Full MLOps governance journey at pure-logic layer + HTTP:
 *   - Golden set (holdout) bilan model ro'yxatga olish → allowlist → pin.
 *   - Evaluation: QWK/MAE/F1/ECE/subgroup metrikalari → deployment gate.
 *   - Drift detection → kill-switch rollback (immutable final guard).
 *   - Model change regression: yangi model eski modeldan yomon bo'lsa
 *     gate rad etadi (rollback trigger).
 *
 * DONE CONDITION (Prompt 52 §25): approved threshold + rollback bilan
 * TEACHER_ASSISTga tayyor — old final grade silent regrade qilinmaydi.
 */

import { describe, it, expect } from 'vitest';
import {
  computeEvalMetrics,
  computeSubgroupBreakdown,
  evaluateGate,
  detectDrift,
  validateModelPin,
  planRollback,
  assertGoldenHoldout,
  AI_MODEL_STATUS,
  AI_DATASET_KIND,
  AI_GATE_STAGE,
  AI_GATE_DECISION,
  AI_ROLLBACK_ACTION,
} from '../../src/modules/ai-mlops/index.js';

// ═══════════════════════════════════════════════════════════════════
// 01. GOLDEN SET → GATE → ALLOWLIST → PIN JOURNEY
// ═══════════════════════════════════════════════════════════════════

describe('AI MLOps e2e — golden set deployment journey', () => {
  it('golden holdout dataset → evaluation → gate approved → allowlist → pin', () => {
    // 1. Golden set holdout bo'lishi shart (§15)
    expect(assertGoldenHoldout({ kind: AI_DATASET_KIND.GOLDEN, holdout: true }).ok).toBe(true);

    // 2. Golden set eval — yuqori sifatli model
    const items = [
      { ai: 4, gold: 4, subgroup: 'uz' },
      { ai: 3, gold: 3, subgroup: 'uz' },
      { ai: 4, gold: 4, subgroup: 'ru' },
      { ai: 2, gold: 2, subgroup: 'en' },
      { ai: 4, gold: 4, subgroup: 'en' },
    ];
    const m = computeEvalMetrics({ aiScores: items.map((x) => x.ai), goldScores: items.map((x) => x.gold) });
    expect(m.ok).toBe(true);
    expect(m.qwk).toBe(1);

    // 3. Gate — SHADOW stage
    const gate = evaluateGate({ stage: AI_GATE_STAGE.SHADOW, metrics: { qwk: m.qwk, ece: 0.05, overrideRate: 0.1 } });
    expect(gate.decision).toBe(AI_GATE_DECISION.APPROVED);

    // 4. Allowlist + pin — faqat active + allowlisted serve qiladi
    expect(validateModelPin({ model: 'm', version: '2026-07-01', allowlisted: true, status: AI_MODEL_STATUS.ACTIVE }).ok).toBe(true);

    // 5. Subgroup fairness — hammasi 1.0
    const sub = computeSubgroupBreakdown({ items });
    expect(sub.groups.every((g) => g.qwk === 1)).toBe(true);
  });

  it("model change regression: yangi model gate'ni o'ta olmasa rad etiladi", () => {
    // Yaxshi model (baseline)
    const good = computeEvalMetrics({ aiScores: [4, 3, 4, 3, 4], goldScores: [4, 3, 4, 3, 4] });
    expect(good.qwk).toBe(1);
    // Yomon "yangi" model (regression)
    const bad = computeEvalMetrics({ aiScores: [1, 1, 1, 1, 1], goldScores: [4, 3, 4, 3, 4] });
    const gate = evaluateGate({ stage: AI_GATE_STAGE.SHADOW, metrics: { qwk: bad.qwk, ece: 0.3, overrideRate: 0.6 } });
    expect(gate.decision).toBe(AI_GATE_DECISION.REJECTED);
    // Drift — high severity → rollback trigger
    const drift = detectDrift({ metric: 'qwk', baseline: good.qwk, current: bad.qwk });
    expect(drift.severity).toBe('high');
    expect(drift.drifted).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 02. KILL SWITCH / ROLLBACK (§14, §15)
// ═══════════════════════════════════════════════════════════════════

describe('AI MLOps e2e — kill switch & immutable final', () => {
  it('drift → kill switch disable → model disabled, final grades untouched', () => {
    // Production'da active model
    const active = validateModelPin({ model: 'prod', version: 'v1', allowlisted: true, status: AI_MODEL_STATUS.ACTIVE });
    expect(active.ok).toBe(true);

    // Drift: QWK 0.85 → 0.55 (high)
    const drift = detectDrift({ metric: 'qwk', baseline: 0.85, current: 0.55 });
    expect(drift.drifted).toBe(true);
    expect(drift.severity).toBe('high');

    // Kill switch — rollback plan: immutable final
    const plan = planRollback({ action: AI_ROLLBACK_ACTION.DISABLE, fromStatus: AI_MODEL_STATUS.ACTIVE, reason: `drift ${drift.delta}` });
    expect(plan.ok).toBe(true);
    expect(plan.toStatus).toBe(AI_MODEL_STATUS.DISABLED);
    expect(plan.immutableFinal).toBe(true);
    expect(plan.runbookRef).toBe('RUNBOOK-DISABLE-V1');

    // Disabled model endi serve qila olmaydi
    const after = validateModelPin({ model: 'prod', version: 'v1', allowlisted: false, status: AI_MODEL_STATUS.DISABLED });
    expect(after.ok).toBe(false);
    // va hech qanday final grade qayta yozilmaydi (silent regrade yo'q)
    expect(plan.immutableFinal).toBe(true);
  });

  it('rollback action → disabled + runbook ref; retired is terminal', () => {
    const rb = planRollback({ action: AI_ROLLBACK_ACTION.ROLLBACK, fromStatus: AI_MODEL_STATUS.ACTIVE, reason: 'production incident' });
    expect(rb.toStatus).toBe(AI_MODEL_STATUS.DISABLED);
    expect(rb.runbookRef).toBe('RUNBOOK-ROLLBACK-V1');
    const retire = planRollback({ action: AI_ROLLBACK_ACTION.RETIRE, fromStatus: AI_MODEL_STATUS.ACTIVE });
    expect(retire.toStatus).toBe(AI_MODEL_STATUS.RETIRED);
    // Terminal: retired model qayta rollback bo'lmaydi
    expect(planRollback({ action: AI_ROLLBACK_ACTION.DISABLE, fromStatus: AI_MODEL_STATUS.RETIRED }).ok).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 03. FAIRNESS DRILLS (§7.7)
// ═══════════════════════════════════════════════════════════════════

describe('AI MLOps e2e — subgroup fairness drills', () => {
  it('language gap detected — uz strong, en weak', () => {
    const sub = computeSubgroupBreakdown({
      items: [
        { subgroup: 'uz', ai: 4, gold: 4 },
        { subgroup: 'uz', ai: 3, gold: 3 },
        { subgroup: 'uz', ai: 4, gold: 4 },
        { subgroup: 'en', ai: 1, gold: 4 },
        { subgroup: 'en', ai: 2, gold: 4 },
      ],
    });
    expect(sub.ok).toBe(true);
    const uz = sub.groups.find((g) => g.subgroup === 'uz');
    const en = sub.groups.find((g) => g.subgroup === 'en');
    expect(uz.qwk).toBe(1);
    expect(en.mae).toBe(2.5); // (3+2)/2 — fairness gap signal
    expect(en.qwk).toBeLessThan(uz.qwk);
  });

  it('gate + drift + subgroup work together for TEACHER_ASSIST readiness', () => {
    // Ready model: high QWK, low ECE, low override, fair subgroups
    const m = computeEvalMetrics({ aiScores: [4, 3, 4, 2, 3], goldScores: [4, 3, 4, 2, 3] });
    const gate = evaluateGate({ stage: AI_GATE_STAGE.ASSIST, metrics: { qwk: m.qwk, ece: 0.06, overrideRate: 0.1 } });
    expect(gate.decision).toBe(AI_GATE_DECISION.APPROVED);
    expect(detectDrift({ metric: 'qwk', baseline: 0.85, current: m.qwk }).drifted).toBe(false);
  });
});
