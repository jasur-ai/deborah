/**
 * Deborah — Intervention Loop, Adaptive Practice & Support (pure logic)
 *
 * Prompt 55 — assessment evidence'dan teacher-approved action, reassessment
 * va formative mastery oqimi (research.md §47 #1 Assessment-to-Intervention
 * Loop, #6 Adaptive Mastery Practice — P3 formative only first, #10 Ethical
 * Student Success Engine — prediction emas, action). This module is PURE
 * (no I/O, no globals):
 *
 *   - Misconception → intervention mapping (rule-based, AI suggestion).
 *   - Next-action card: evidence → recommendation + rationale.
 *   - Teacher decision flow: approve | edit | dismiss | assign.
 *   - Different-item reassessment: source itemlar takrorlanmaydi.
 *   - Before / after / retention metrics.
 *   - Mastery estimate: rule-based + BKT (Bayesian Knowledge Tracing).
 *   - Spaced-repetition practice scheduler.
 *   - Support signal/case privacy guards: permanent low-ability label YO'Q,
 *     auto penalty YO'Q, private chat sentiment ishlatilmaydi.
 *
 * SECURITY / DATA GUARD (Prompt 55 §15-17):
 *   - AI hech qachon intervention assign qilmaydi — faqat recommendation;
 *     teacher approval shart.
 *   - Hech qanday permanent "low ability" label yoki auto penalty yo'q.
 *   - Student contest (appeal) flow har doim ochiq.
 */

// ═══════════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════════

/** Misconception mapping / cluster status. */
export const CLUSTER_STATUS = {
  DRAFT: 'draft',
  REVIEWED: 'reviewed',
  APPROVED: 'approved',
  REJECTED: 'rejected',
};

/** Intervention kinds (§8.3 distractor/misconception rework). */
export const INTERVENTION_KINDS = ['video', 'exercise', 'reading', 'group_activity', 'reteach'];

/** Intervention library status. */
export const INTERVENTION_STATUS = {
  DRAFT: 'draft',
  PUBLISHED: 'published',
  RETIRED: 'retired',
};

/** Next-action card statuses. */
export const ACTION_CARD_STATUS = {
  PENDING: 'pending',
  APPROVED: 'approved',
  EDITED: 'edited',
  DISMISSED: 'dismissed',
  ASSIGNED: 'assigned',
  COMPLETED: 'completed',
};

/** Teacher decision actions (Prompt 55 §10). */
export const TEACHER_DECISIONS = ['approve', 'edit', 'dismiss', 'assign'];

/** Reassessment statuses. */
export const REASSESSMENT_STATUS = {
  ASSIGNED: 'assigned',
  IN_PROGRESS: 'in_progress',
  COMPLETED: 'completed',
};

/** Mastery methods (§47 #6 — rule + BKT). */
export const MASTERY_METHODS = ['rule', 'bkt'];

/** Mastery levels. */
export const MASTERY_LEVELS = ['below', 'approaching', 'at', 'above'];

/** Default BKT parameters (research-informed starting point). */
export const DEFAULT_BKT = { priorP: 0.3, learnRate: 0.2, slip: 0.1, guess: 0.2 };

/** Spaced-repetition interval steps (days) — P3 formative only. */
export const SPACED_INTERVALS_DAYS = [1, 3, 7, 14, 30];

/** Support signal types (§47 #10 — action, not prediction). */
export const SUPPORT_SIGNAL_TYPES = ['at_risk', 'weak_concept', 'mastery_gap', 'attendance', 'engagement'];

/** Support case statuses. */
export const SUPPORT_CASE_STATUS = { OPEN: 'open', TRIAGED: 'triaged', CLOSED: 'closed' };

/** Contest request types (student appeal flow). */
export const CONTEST_REQUEST_TYPES = ['appeal', 'contest', 'review'];

/** Forbidden signal sources — private chat sentiment never used (§15). */
export const FORBIDDEN_EVIDENCE_SOURCES = ['private_chat', 'chat_sentiment', 'social_media_sentiment'];

// ═══════════════════════════════════════════════════════════════════
// MISCONCEPTION → INTERVENTION MAPPING (§47 #1)
// ═══════════════════════════════════════════════════════════════════

/**
 * Rule-based misconception → intervention mapping. AI suggestion — hech
 * qachon avtomatik assign emas (teacher approval shart).
 *
 * @param {Object} params
 * @param {Object} params.misconception - { label, cluster_key, severity }
 * @param {Array<Object>} params.interventions - published intervention library
 * @returns {{ ok: boolean, matched: Array<{ intervention: Object, score: number, reason: string }>, error?: string }}
 */
export function mapMisconceptionToIntervention({ misconception = {}, interventions = [] } = {}) {
  if (!misconception || !misconception.label) {
    return { ok: false, error: 'misconception with label is required' };
  }
  const published = Array.isArray(interventions)
    ? interventions.filter((i) => i && i.status === INTERVENTION_STATUS.PUBLISHED)
    : [];
  if (published.length === 0) {
    return { ok: false, error: 'no published interventions available (stop condition)' };
  }

  const label = String(misconception.label).toLowerCase();
  const clusterKey = String(misconception.cluster_key || '').toLowerCase();
  const severity = String(misconception.severity || 'medium').toLowerCase();

  const scored = [];
  for (const iv of published) {
    let score = 0;
    const reasons = [];
    // Cluster match — strongest signal
    if (iv.target_cluster_id && misconception.cluster_id && iv.target_cluster_id === misconception.cluster_id) {
      score += 0.6;
      reasons.push('cluster match');
    }
    // Kind heuristic by severity
    if (severity === 'high' && iv.kind === 'reteach') {
      score += 0.3;
      reasons.push('high severity reteach');
    }
    if (severity === 'low' && iv.kind === 'exercise') {
      score += 0.3;
      reasons.push('low severity practice');
    }
    // Title overlap heuristic
    const ivText = String(iv.title || '').toLowerCase();
    if (label && ivText.includes(label.slice(0, 8))) {
      score += 0.2;
      reasons.push('title overlap');
    }
    if (score > 0) {
      scored.push({ intervention: iv, score: Number(score.toFixed(2)), reason: reasons.join(', ') || 'rule match' });
    }
  }
  scored.sort((a, b) => b.score - a.score);
  return { ok: true, matched: scored.slice(0, 3) };
}

/**
 * Validate a misconception mapping before insert (teacher review gate).
 * @param {Object} params - { competencyId, label, description }
 * @returns {{ ok: boolean, reason?: string }}
 */
export function validateMisconceptionMapping({ competencyId = null, label = '', description = '' } = {}) {
  if (!competencyId) return { ok: false, reason: 'competencyId is required' };
  if (!label || typeof label !== 'string' || !label.trim()) {
    return { ok: false, reason: 'misconception label is required' };
  }
  if (String(label).length > 120) return { ok: false, reason: 'label exceeds 120 chars' };
  if (String(description).length > 2000) return { ok: false, reason: 'description exceeds 2000 chars' };
  return { ok: true };
}

// ═══════════════════════════════════════════════════════════════════
// NEXT-ACTION CARD (§47 #1 — "endi nima qilamiz?")
// ═══════════════════════════════════════════════════════════════════

/**
 * Build a next-action card from assessment evidence.
 * Card = recommendation only; teacher approve/assign qiladi.
 *
 * @param {Object} params
 * @param {Object} params.evidence - { studentId, competencyId, score, attemptId, masteryEst }
 * @param {Array<Object>} params.matched - mapping output (intervention matches)
 * @returns {{ ok: boolean, card?: Object, reason?: string }}
 */
export function buildNextActionCard({ evidence = {}, matched = [] } = {}) {
  const score = Number(evidence.score ?? 0);
  if (!evidence.competencyId) return { ok: false, reason: 'competencyId is required' };
  if (!evidence.studentId) return { ok: false, reason: 'studentId is required' };
  if (score < 0 || score > 1) return { ok: false, reason: 'score must be 0..1' };
  if (!Array.isArray(matched) || matched.length === 0) {
    return { ok: false, reason: 'no matched intervention — cannot build action card' };
  }

  const top = matched[0];
  const masteryEst = Number(evidence.masteryEst ?? score);
  const priority =
    masteryEst < 0.5 ? 'high' : masteryEst < 0.7 ? 'medium' : 'low';

  return {
    ok: true,
    card: {
      studentId: evidence.studentId,
      competencyId: evidence.competencyId,
      sourceAttemptId: evidence.attemptId || null,
      clusterId: top.intervention?.target_cluster_id || null,
      interventionId: top.intervention?.id || null,
      rationale: top.reason || 'top ranked intervention match',
      priority,
      score: Number(score.toFixed(4)),
      masteryEst: Number(masteryEst.toFixed(4)),
    },
  };
}

/**
 * Teacher decision validation (Prompt 55 §10).
 * @param {Object} params - { decision, status }
 * @returns {{ ok: boolean, reason?: string, targetStatus?: string }}
 */
export function validateTeacherDecision({ decision = '', status = '' } = {}) {
  if (!TEACHER_DECISIONS.includes(decision)) {
    return { ok: false, reason: `invalid decision ${decision} — allowed: ${TEACHER_DECISIONS.join('|')}` };
  }
  const map = {
    approve: ACTION_CARD_STATUS.APPROVED,
    edit: ACTION_CARD_STATUS.EDITED,
    dismiss: ACTION_CARD_STATUS.DISMISSED,
    assign: ACTION_CARD_STATUS.ASSIGNED,
  };
  const target = map[decision];
  // Edit faqat pending/approved dan; assign faqat approved dan
  if (decision === 'edit' && !['pending', 'approved'].includes(status)) {
    return { ok: false, reason: `cannot edit card in status ${status}` };
  }
  if (decision === 'assign' && !['approved', 'edited'].includes(status)) {
    return { ok: false, reason: `cannot assign card in status ${status} — approve first` };
  }
  return { ok: true, targetStatus: target };
}

// ═══════════════════════════════════════════════════════════════════
// DIFFERENT-ITEM REASSESSMENT (§47 #1, §21 non-duplication)
// ═══════════════════════════════════════════════════════════════════

/**
 * Plan reassessment with DIFFERENT items — source itemlar takrorlanmaydi.
 * Deterministic pick: published items, excluding source item ids.
 *
 * @param {Object} params
 * @param {Array<Object>} params.itemPool - { id, difficulty, competencyId } published items
 * @param {Array<number>} params.sourceItemIds - items already seen by student
 * @param {number} params.count - number of items to pick
 * @returns {{ ok: boolean, picked: Array<Object>, excluded: number, error?: string }}
 */
export function planDifferentItemReassessment({
  itemPool = [],
  sourceItemIds = [],
  count = 5,
} = {}) {
  if (!Array.isArray(itemPool) || itemPool.length === 0) {
    return { ok: false, error: 'item pool is empty' };
  }
  const n = Number(count);
  if (!Number.isInteger(n) || n < 1 || n > 50) {
    return { ok: false, error: 'count must be an integer 1..50' };
  }
  const source = new Set((sourceItemIds || []).map((id) => Number(id)));
  const available = itemPool.filter((it) => it && it.id && !source.has(Number(it.id)));
  if (available.length < n) {
    return { ok: false, error: `only ${available.length} non-duplicate items available (need ${n})` };
  }
  // Deterministic pick: stable sort by difficulty then id
  const picked = [...available]
    .sort((a, b) => {
      const da = Number(a.difficulty ?? 0.5);
      const db = Number(b.difficulty ?? 0.5);
      return da - db || Number(a.id) - Number(b.id);
    })
    .slice(0, n);
  return { ok: true, picked, excluded: source.size };
}

// ═══════════════════════════════════════════════════════════════════
// BEFORE / AFTER / RETENTION METRICS (§47 #1 measurable loop)
// ═══════════════════════════════════════════════════════════════════

/**
 * Compute before/after/retention deltas.
 * @param {Object} params - { preScore, postScore, retentionScore }
 * @returns {{ ok: boolean, gain: number, retentionDelta: number, retained: boolean, metrics?: Object }}
 */
export function computeBeforeAfterRetention({ preScore = null, postScore = null, retentionScore = null } = {}) {
  const pre = preScore == null ? null : Number(preScore);
  const post = postScore == null ? null : Number(postScore);
  const ret = retentionScore == null ? null : Number(retentionScore);
  if (pre == null && post == null) return { ok: false, error: 'at least one of pre/post is required' };
  const gain = pre != null && post != null ? Number((post - pre).toFixed(4)) : null;
  const retentionDelta = post != null && ret != null ? Number((ret - post).toFixed(4)) : null;
  // Retention "saqlanib qoldi" — retention >= post * 0.9 (10% tolerance)
  const retained = post != null && ret != null ? ret >= post * 0.9 : null;
  return { ok: true, gain, retentionDelta, retained, metrics: { pre, post, retention: ret, gain, retentionDelta, retained } };
}

// ═══════════════════════════════════════════════════════════════════
// MASTERY ESTIMATE — RULE + BKT (§47 #6)
// ═══════════════════════════════════════════════════════════════════

/**
 * Rule-based mastery estimate — last-N accuracy with momentum.
 * @param {Object} params - { correct, total, lastN, threshold }
 * @returns {{ ok: boolean, est: number, level: string, evidence?: Object }}
 */
export function estimateMasteryRule({ correct = 0, total = 0, lastN = [], threshold = 0.8 } = {}) {
  if (total <= 0) return { ok: false, error: 'total must be > 0' };
  const acc = Math.min(1, Math.max(0, correct / total));
  let recent = acc;
  if (Array.isArray(lastN) && lastN.length > 0) {
    const hits = lastN.filter(Boolean).length;
    recent = hits / lastN.length;
  }
  // Momentum: recent performance > overall
  const est = Number((0.6 * recent + 0.4 * acc).toFixed(4));
  const level = masteryLevel(est, threshold);
  return { ok: true, est, level, evidence: { accuracy: Number(acc.toFixed(4)), recent, threshold } };
}

/**
 * BKT (Bayesian Knowledge Tracing) mastery estimate.
 * P(L_n) updated after each observation (correct/wrong) with slip/guess.
 * @param {Object} params
 * @param {number} params.priorP - P(L_0)
 * @param {number} params.learnRate - P(T)
 * @param {number} params.slip - P(correct | not known)
 * @param {number} params.guess - P(correct | not known) lower bound guard
 * @param {Array<0|1>} params.responses - ordered observations (1=correct)
 * @returns {{ ok: boolean, est: number, level: string, trace?: Array<number> }}
 */
export function estimateMasteryBkt({ priorP = DEFAULT_BKT.priorP, learnRate = DEFAULT_BKT.learnRate, slip = DEFAULT_BKT.slip, guess = DEFAULT_BKT.guess, responses = [] } = {}) {
  if (!Array.isArray(responses) || responses.length === 0) {
    return { ok: false, error: 'responses are required' };
  }
  let p = Number(priorP);
  const trace = [p];
  for (const r of responses) {
    const correct = Boolean(r);
    // Posterior after observation:
    // P(L|obs) = P(obs|L)*P(L) / (P(obs|L)*P(L) + P(obs|~L)*P(~L))
    const pObsGivenKnown = correct ? 1 - Number(slip) : Number(slip);
    const pObsGivenUnknown = correct ? Number(guess) : 1 - Number(guess);
    const denom = pObsGivenKnown * p + pObsGivenUnknown * (1 - p);
    if (!Number.isFinite(denom) || denom === 0) {
      p = correct ? 1 : 0;
    } else {
      const posterior = (pObsGivenKnown * p) / denom;
      // Learning: P(L_{n+1}) = P(L_n|obs) + (1 - P(L_n|obs)) * P(T)
      p = posterior + (1 - posterior) * Number(learnRate);
    }
    p = Math.min(0.9999, Math.max(0.0001, p));
    trace.push(Number(p.toFixed(4)));
  }
  const est = Number(p.toFixed(4));
  return { ok: true, est, level: masteryLevel(est, 0.8), trace };
}

/** Map mastery estimate to level (below/approaching/at/above). */
export function masteryLevel(est = 0, threshold = 0.8) {
  const e = Number(est) || 0;
  // 'above' faqat threshold dan QAT'IY oshganda (0.9+0.1 → 0.9 hali 'at')
  if (e > threshold + 0.1) return 'above';
  if (e >= threshold) return 'at';
  if (e >= threshold - 0.3) return 'approaching';
  return 'below';
}

// ═══════════════════════════════════════════════════════════════════
// SPACED-REPETITION SCHEDULER (§47 #6 — formative only)
// ═══════════════════════════════════════════════════════════════════

/**
 * Compute next practice due date using spaced intervals.
 * @param {Object} params - { sessionCount, lastDueAt, intervals }
 * @returns {{ ok: boolean, intervalDays: number, dueAt: string|null, error?: string }}
 */
export function computePracticeSchedule({
  sessionCount = 0,
  lastDueAt = null,
  intervals = SPACED_INTERVALS_DAYS,
} = {}) {
  const n = Number(sessionCount) || 0;
  if (n < 0) return { ok: false, error: 'sessionCount must be >= 0' };
  const step = Math.min(n, intervals.length - 1);
  const intervalDays = intervals[step];
  let dueAt = null;
  if (lastDueAt) {
    const base = new Date(lastDueAt).getTime();
    dueAt = new Date(base + intervalDays * 24 * 3600 * 1000).toISOString();
  }
  return { ok: true, intervalDays, dueAt };
}

// ═══════════════════════════════════════════════════════════════════
// SUPPORT SIGNAL / CASE PRIVACY GUARDS (§47 #10, §15)
// ═══════════════════════════════════════════════════════════════════

/**
 * Validate a support signal. Rejects forbidden evidence sources
 * (private chat sentiment, etc.) and requires allowed signal types.
 * @param {Object} params - { signalType, evidence }
 * @returns {{ ok: boolean, reason?: string }}
 */
export function validateSupportSignal({ signalType = '', evidence = {} } = {}) {
  if (!SUPPORT_SIGNAL_TYPES.includes(signalType)) {
    return { ok: false, reason: `invalid signal type ${signalType}` };
  }
  const ev = evidence && typeof evidence === 'object' ? evidence : {};
  // Forbidden sources — private chat sentiment ishlatilmaydi (§15)
  const src = String(ev.source || '').toLowerCase();
  if (FORBIDDEN_EVIDENCE_SOURCES.some((f) => src.includes(f))) {
    return { ok: false, reason: 'private chat sentiment is a forbidden evidence source (§15)' };
  }
  return { ok: true };
}

/**
 * Privacy guard — support case hech qachon permanent label yoki
 * auto penalty bo'lmasligi shart.
 * @param {Object} params - { isTemporary, autoPenalty, evidence }
 * @returns {{ ok: boolean, reason?: string, normalized?: Object }}
 */
export function assertNoPermanentLabelOrPenalty({ isTemporary = true, autoPenalty = false, evidence = {} } = {}) {
  if (isTemporary !== true) {
    return { ok: false, reason: 'support case must be temporary — no permanent low-ability label (§15)' };
  }
  if (autoPenalty !== false) {
    return { ok: false, reason: 'no auto penalty — teacher action required (§15)' };
  }
  // Penalty/label-suggesting evidence fields rad etiladi
  const ev = evidence && typeof evidence === 'object' ? evidence : {};
  if (ev.penalty || ev.permanent_label || ev.grade_reduction) {
    return { ok: false, reason: 'evidence must not carry penalty or permanent label fields' };
  }
  return { ok: true, normalized: { isTemporary: true, autoPenalty: false } };
}

/**
 * Validate a student contest (appeal) request.
 * @param {Object} params - { requestType, reason }
 * @returns {{ ok: boolean, reason?: string }}
 */
export function validateContestRequest({ requestType = '', reason = '' } = {}) {
  if (!CONTEST_REQUEST_TYPES.includes(requestType)) {
    return { ok: false, reason: `invalid contest request type ${requestType}` };
  }
  if (!reason || typeof reason !== 'string' || !reason.trim()) {
    return { ok: false, reason: 'reason is required for a contest request' };
  }
  return { ok: true };
}
