/**
 * Edikit — Intervention Loop, Adaptive Practice & Support (unit tests, Prompt 55)
 *
 * Pure schema tekshiruvi (hech qanday DB/I-O yo'q):
 *   - Misconception → intervention mapping (§47 #1).
 *   - Next-action card build + teacher decision flow.
 *   - Different-item reassessment — source itemlar takrorlanmaydi.
 *   - Before/after/retention metrics.
 *   - Mastery: rule + BKT (Bayesian Knowledge Tracing).
 *   - Spaced-repetition scheduler.
 *   - Support privacy guards: permanent label / auto penalty / private
 *     chat sentiment ishlatilmaydi (§15, §47 #10).
 *   - Student contest (appeal) flow.
 */

import { describe, it, expect } from 'vitest';
import {
  mapMisconceptionToIntervention,
  validateMisconceptionMapping,
  buildNextActionCard,
  validateTeacherDecision,
  planDifferentItemReassessment,
  computeBeforeAfterRetention,
  estimateMasteryRule,
  estimateMasteryBkt,
  masteryLevel,
  computePracticeSchedule,
  validateSupportSignal,
  assertNoPermanentLabelOrPenalty,
  validateContestRequest,
  INTERVENTION_STATUS,
  ACTION_CARD_STATUS,
  DEFAULT_BKT,
  SPACED_INTERVALS_DAYS,
  FORBIDDEN_EVIDENCE_SOURCES,
} from '../../src/modules/intervention/index.js';

// ═══════════════════════════════════════════════════════════════════
// MISCONCEPTION → INTERVENTION MAPPING (§47 #1)
// ═══════════════════════════════════════════════════════════════════

describe('intervention — misconception→intervention mapping (Prompt 55 §07)', () => {
  const interventions = [
    { id: 1, kind: 'exercise', title: 'Algebra mashqlar', status: INTERVENTION_STATUS.PUBLISHED, target_cluster_id: 10 },
    { id: 2, kind: 'reteach', title: 'Fotosintez reteach', status: INTERVENTION_STATUS.PUBLISHED, target_cluster_id: 11 },
    { id: 3, kind: 'video', title: 'Video dars', status: INTERVENTION_STATUS.DRAFT, target_cluster_id: null },
  ];

  it('maps by cluster match (strongest signal)', () => {
    const r = mapMisconceptionToIntervention({
      misconception: { label: 'Kalvin sikli xatosi', cluster_id: 10, cluster_key: 'calvin', severity: 'medium' },
      interventions,
    });
    expect(r.ok).toBe(true);
    expect(r.matched[0].intervention.id).toBe(1);
    expect(r.matched[0].reason).toMatch(/cluster match/i);
  });

  it('high severity → reteach preference', () => {
    const r = mapMisconceptionToIntervention({
      misconception: { label: 'Kalvin sikli xatosi', cluster_id: 11, severity: 'high' },
      interventions,
    });
    expect(r.ok).toBe(true);
    expect(r.matched[0].intervention.kind).toBe('reteach');
  });

  it('ignores non-published interventions', () => {
    const r = mapMisconceptionToIntervention({
      misconception: { label: 'x', cluster_id: null, severity: 'low' },
      interventions,
    });
    // Faqat published (1,2) ishtirok etadi — draft (3) yo'q
    expect(r.matched.every((m) => m.intervention.status === INTERVENTION_STATUS.PUBLISHED)).toBe(true);
  });

  it('stop condition: no published interventions', () => {
    const r = mapMisconceptionToIntervention({
      misconception: { label: 'x', severity: 'medium' },
      interventions: [{ id: 9, status: INTERVENTION_STATUS.DRAFT }],
    });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/no published interventions/i);
  });

  it('validateMisconceptionMapping — label required', () => {
    expect(validateMisconceptionMapping({ competencyId: 1, label: '' }).ok).toBe(false);
    expect(validateMisconceptionMapping({ competencyId: null, label: 'x' }).ok).toBe(false);
    expect(validateMisconceptionMapping({ competencyId: 1, label: 'Kalvin sikli xatosi' }).ok).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════
// NEXT-ACTION CARD + TEACHER DECISION (§47 #1, §10)
// ═══════════════════════════════════════════════════════════════════

describe('intervention — next-action card & teacher decision (Prompt 55 §09-10)', () => {
  const matched = [{ intervention: { id: 1, target_cluster_id: 10 }, reason: 'cluster match', score: 0.6 }];

  it('buildNextActionCard from evidence + matched intervention', () => {
    const r = buildNextActionCard({
      evidence: { studentId: 7, competencyId: 5, score: 0.4, attemptId: 100 },
      matched,
    });
    expect(r.ok).toBe(true);
    expect(r.card.interventionId).toBe(1);
    expect(r.card.priority).toBe('high'); // mastery < 0.5
    expect(r.card.sourceAttemptId).toBe(100);
  });

  it('rejects missing competency or invalid score', () => {
    expect(buildNextActionCard({ evidence: { studentId: 1 }, matched }).ok).toBe(false);
    expect(buildNextActionCard({ evidence: { studentId: 1, competencyId: 2, score: 1.5 }, matched }).ok).toBe(false);
  });

  it('no matched intervention → cannot build card', () => {
    expect(buildNextActionCard({ evidence: { studentId: 1, competencyId: 2, score: 0.5 }, matched: [] }).ok).toBe(false);
  });

  it('teacher decision flow — approve/edit/dismiss/assign', () => {
    expect(validateTeacherDecision({ decision: 'approve', status: 'pending' }).targetStatus).toBe(ACTION_CARD_STATUS.APPROVED);
    expect(validateTeacherDecision({ decision: 'dismiss', status: 'pending' }).targetStatus).toBe(ACTION_CARD_STATUS.DISMISSED);
    expect(validateTeacherDecision({ decision: 'invalid', status: 'pending' }).ok).toBe(false);
  });

  it('assign requires approved/edited first (AI assign qilmaydi)', () => {
    expect(validateTeacherDecision({ decision: 'assign', status: 'pending' }).ok).toBe(false);
    expect(validateTeacherDecision({ decision: 'assign', status: 'approved' }).ok).toBe(true);
    expect(validateTeacherDecision({ decision: 'assign', status: 'edited' }).ok).toBe(true);
  });

  it('edit only from pending/approved', () => {
    expect(validateTeacherDecision({ decision: 'edit', status: 'assigned' }).ok).toBe(false);
    expect(validateTeacherDecision({ decision: 'edit', status: 'pending' }).ok).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════
// DIFFERENT-ITEM REASSESSMENT (§21 non-duplication)
// ═══════════════════════════════════════════════════════════════════

describe('intervention — different-item reassessment (Prompt 55 §11)', () => {
  const pool = [1, 2, 3, 4, 5, 6, 7, 8].map((id) => ({ id, difficulty: id % 3 === 0 ? 0.8 : 0.4 }));

  it('excludes source items (non-duplication)', () => {
    const r = planDifferentItemReassessment({ itemPool: pool, sourceItemIds: [1, 2, 3], count: 5 });
    expect(r.ok).toBe(true);
    expect(r.picked).toHaveLength(5);
    expect(r.excluded).toBe(3);
    expect(r.picked.some((i) => [1, 2, 3].includes(i.id))).toBe(false);
  });

  it('deterministic pick (stable sort)', () => {
    const a = planDifferentItemReassessment({ itemPool: pool, sourceItemIds: [], count: 3 });
    const b = planDifferentItemReassessment({ itemPool: pool, sourceItemIds: [], count: 3 });
    expect(a.picked.map((i) => i.id)).toEqual(b.picked.map((i) => i.id));
  });

  it('fails when not enough non-duplicate items', () => {
    const r = planDifferentItemReassessment({ itemPool: pool, sourceItemIds: [1, 2, 3, 4, 5, 6, 7, 8], count: 5 });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/non-duplicate items available/i);
  });

  it('rejects empty pool and bad count', () => {
    expect(planDifferentItemReassessment({ itemPool: [], count: 5 }).ok).toBe(false);
    expect(planDifferentItemReassessment({ itemPool: pool, count: 0 }).ok).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════
// BEFORE / AFTER / RETENTION METRICS (§47 #1 measurable loop)
// ═══════════════════════════════════════════════════════════════════

describe('intervention — before/after/retention metrics (Prompt 55 §12)', () => {
  it('computes gain and retention delta', () => {
    const r = computeBeforeAfterRetention({ preScore: 0.4, postScore: 0.8, retentionScore: 0.75 });
    expect(r.ok).toBe(true);
    expect(r.gain).toBeCloseTo(0.4, 4);
    expect(r.retentionDelta).toBeCloseTo(-0.05, 4);
    expect(r.retained).toBe(true); // 0.75 >= 0.8*0.9
  });

  it('retention below tolerance → not retained', () => {
    const r = computeBeforeAfterRetention({ preScore: 0.4, postScore: 0.8, retentionScore: 0.5 });
    expect(r.retained).toBe(false);
  });

  it('requires at least one of pre/post', () => {
    expect(computeBeforeAfterRetention({}).ok).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════
// MASTERY — RULE + BKT (§47 #6)
// ═══════════════════════════════════════════════════════════════════

describe('intervention — mastery estimate rule + BKT (Prompt 55 §13)', () => {
  it('rule mastery from accuracy + momentum', () => {
    // acc=0.6, recent=0.6 → est=0.6 → approaching
    const r = estimateMasteryRule({ correct: 3, total: 5, lastN: [1, 0, 1, 0, 1] });
    expect(r.ok).toBe(true);
    expect(r.est).toBeGreaterThan(0.5);
    expect(r.est).toBeLessThan(0.8);
    expect(r.level).toBe('approaching');
  });

  it('rule mastery high → at level', () => {
    const r = estimateMasteryRule({ correct: 5, total: 5, lastN: [1, 1, 1] });
    expect(r.est).toBe(1);
    expect(r.level).toBe('above');
  });

  it('rejects total 0', () => {
    expect(estimateMasteryRule({ correct: 0, total: 0 }).ok).toBe(false);
  });

  it('BKT updates posterior after each observation (learns from correct)', () => {
    // P(L0)=0.3; correct answer should raise mastery
    const r = estimateMasteryBkt({ priorP: 0.3, responses: [1, 1, 1, 1, 1] });
    expect(r.ok).toBe(true);
    expect(r.est).toBeGreaterThan(0.8);
    expect(r.trace).toHaveLength(6);
    expect(r.trace[0]).toBe(0.3);
  });

  it('BKT drops after repeated wrong answers', () => {
    const r = estimateMasteryBkt({ priorP: 0.3, responses: [0, 0, 0, 0] });
    expect(r.est).toBeLessThan(0.3);
  });

  it('BKT monotonic learning from correct-only', () => {
    const r = estimateMasteryBkt({ responses: [1, 1, 1, 1, 1, 1] });
    // Har correct keyin est oshishi kerak
    const deltas = r.trace.slice(1).map((v, i) => v - r.trace[i]);
    expect(deltas.every((d) => d >= 0)).toBe(true);
  });

  it('BKT requires responses', () => {
    expect(estimateMasteryBkt({ responses: [] }).ok).toBe(false);
  });

  it('masteryLevel thresholds', () => {
    expect(masteryLevel(0.9, 0.8)).toBe('at');
    expect(masteryLevel(0.95, 0.8)).toBe('above');
    expect(masteryLevel(0.6, 0.8)).toBe('approaching');
    expect(masteryLevel(0.3, 0.8)).toBe('below');
  });

  it('DEFAULT_BKT params are sane', () => {
    expect(DEFAULT_BKT.priorP).toBe(0.3);
    expect(DEFAULT_BKT.learnRate).toBe(0.2);
    expect(DEFAULT_BKT.slip).toBe(0.1);
    expect(DEFAULT_BKT.guess).toBe(0.2);
  });
});

// ═══════════════════════════════════════════════════════════════════
// SPACED-REPETITION SCHEDULER (§47 #6 — formative only)
// ═══════════════════════════════════════════════════════════════════

describe('intervention — spaced practice scheduler (Prompt 55 §13)', () => {
  it('interval steps follow SPACED_INTERVALS_DAYS', () => {
    const s0 = computePracticeSchedule({ sessionCount: 0, lastDueAt: '2026-08-01T00:00:00Z' });
    expect(s0.intervalDays).toBe(SPACED_INTERVALS_DAYS[0]); // 1
    const s3 = computePracticeSchedule({ sessionCount: 3, lastDueAt: '2026-08-01T00:00:00Z' });
    expect(s3.intervalDays).toBe(SPACED_INTERVALS_DAYS[3]); // 14
  });

  it('clamps to last interval for high counts', () => {
    const s = computePracticeSchedule({ sessionCount: 99, lastDueAt: '2026-08-01T00:00:00Z' });
    expect(s.intervalDays).toBe(SPACED_INTERVALS_DAYS[SPACED_INTERVALS_DAYS.length - 1]); // 30
  });

  it('computes dueAt from lastDueAt', () => {
    const s = computePracticeSchedule({ sessionCount: 0, lastDueAt: '2026-08-01T00:00:00Z' });
    expect(new Date(s.dueAt).getTime()).toBe(new Date('2026-08-02T00:00:00Z').getTime());
  });

  it('no lastDueAt → dueAt null (first session)', () => {
    const s = computePracticeSchedule({ sessionCount: 0 });
    expect(s.dueAt).toBe(null);
  });
});

// ═══════════════════════════════════════════════════════════════════
// SUPPORT PRIVACY GUARDS (§15, §47 #10)
// ═══════════════════════════════════════════════════════════════════

describe('intervention — support privacy guards (Prompt 55 §14-15)', () => {
  it('validateSupportSignal — allowed types only', () => {
    expect(validateSupportSignal({ signalType: 'weak_concept', evidence: {} }).ok).toBe(true);
    expect(validateSupportSignal({ signalType: 'prediction_score', evidence: {} }).ok).toBe(false);
  });

  it('forbids private chat sentiment evidence', () => {
    const r = validateSupportSignal({
      signalType: 'at_risk',
      evidence: { source: 'private_chat_sentiment', score: 0.9 },
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/private chat sentiment/i);
    expect(FORBIDDEN_EVIDENCE_SOURCES).toContain('private_chat');
  });

  it('no permanent low-ability label', () => {
    const r = assertNoPermanentLabelOrPenalty({ isTemporary: false, autoPenalty: false });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/permanent low-ability label/i);
  });

  it('no auto penalty', () => {
    const r = assertNoPermanentLabelOrPenalty({ isTemporary: true, autoPenalty: true });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/no auto penalty/i);
  });

  it('rejects penalty/permanent_label evidence fields', () => {
    const r = assertNoPermanentLabelOrPenalty({ isTemporary: true, autoPenalty: false, evidence: { grade_reduction: -10 } });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/penalty or permanent label/i);
  });

  it('valid case passes guards', () => {
    const r = assertNoPermanentLabelOrPenalty({ isTemporary: true, autoPenalty: false, evidence: { source: 'attempt', score: 0.4 } });
    expect(r.ok).toBe(true);
  });

  it('student contest request validation', () => {
    expect(validateContestRequest({ requestType: 'appeal', reason: 'Men javobimni ko\'rmadim' }).ok).toBe(true);
    expect(validateContestRequest({ requestType: 'appeal', reason: '' }).ok).toBe(false);
    expect(validateContestRequest({ requestType: 'bribe', reason: 'x' }).ok).toBe(false);
  });
});
