/**
 * Deborah — Intervention Loop, Adaptive Practice & Support (service)
 *
 * Prompt 55 — assessment evidence'dan teacher-approved action, reassessment
 * va formative mastery oqimi. Graceful degradation: PostgreSQL bo'lmasa
 * write path'lar 'PostgreSQL required' throw qiladi, read path'lar []/null.
 *
 *   - Misconception mapping + cluster review (teacher approval shart).
 *   - Intervention library + versions.
 *   - Next-action cards: evidence → recommendation; teacher approve/edit/
 *     dismiss/assign.
 *   - Different-item reassessment (source itemlar takrorlanmaydi).
 *   - Before/after/retention metrics.
 *   - Mastery estimate: rule + BKT.
 *   - Spaced practice scheduler (formative only).
 *   - Support case + student contest (appeal) flow.
 *
 * SECURITY / DATA GUARD (Prompt 55 §15-17):
 *   - AI hech qachon intervention assign qilmaydi — faqat recommendation.
 *   - Permanent low-ability label / auto penalty / private chat sentiment
 *     ishlatilmaydi.
 *   - Har bir write path tenant-scoped + idempotent (UNIQUE indexlar).
 */

import { getDb } from '../../infrastructure/postgres.js';
import { getCurrentTenant } from '../auth/tenant-context.js';
import { audit, AUDIT_ACTIONS } from '../auth/audit.js';
import {
  mapMisconceptionToIntervention,
  validateMisconceptionMapping,
  buildNextActionCard,
  validateTeacherDecision,
  planDifferentItemReassessment,
  computeBeforeAfterRetention,
  estimateMasteryRule,
  estimateMasteryBkt,
  computePracticeSchedule,
  validateSupportSignal,
  assertNoPermanentLabelOrPenalty,
  validateContestRequest,
  INTERVENTION_STATUS,
  ACTION_CARD_STATUS,
  CLUSTER_STATUS,
  REASSESSMENT_STATUS,
  MASTERY_METHODS,
  MASTERY_LEVELS,
  SPACED_INTERVALS_DAYS,
  TEACHER_DECISIONS,
} from './intervention.schema.js';

// ═══════════════════════════════════════════════════════════════════
// MISCONCEPTION MAPPINGS + CLUSTER REVIEW
// ═══════════════════════════════════════════════════════════════════

/**
 * Suggest a misconception mapping (AI suggestion — status draft).
 * @param {Object} params - { competencyId, label, description, evidencePattern, clusterKey, actorId }
 */
export async function suggestMisconceptionMapping({
  competencyId = null,
  label = '',
  description = '',
  evidencePattern = {},
  clusterKey = null,
  actorId = null,
} = {}) {
  const v = validateMisconceptionMapping({ competencyId, label, description });
  if (!v.ok) return { ok: false, error: v.reason };
  const db = getDb();
  if (!db) return { ok: false, error: 'PostgreSQL required' };
  const tenantId = getCurrentTenant()?.id;
  if (!tenantId) return { ok: false, error: 'tenant context is required' };

  // Idempotent: same competency+label → return existing
  const existing = await db
    .selectFrom('misconception_mappings')
    .select(['id'])
    .where('tenant_id', '=', tenantId)
    .where('competency_id', '=', competencyId)
    .where('label', '=', label)
    .executeTakeFirst();
  if (existing) return { ok: true, mappingId: existing.id, duplicate: true };

  const row = await db
    .insertInto('misconception_mappings')
    .values({
      tenant_id: tenantId,
      competency_id: competencyId,
      label,
      description: description || null,
      evidence_pattern: JSON.stringify(evidencePattern || {}),
      cluster_key: clusterKey || null,
      status: CLUSTER_STATUS.DRAFT,
      created_by: actorId,
    })
    .returning(['id'])
    .executeTakeFirst();

  await audit(AUDIT_ACTIONS.MISCONCEPTION_SUGGEST, { actorId, tenantId, detail: { competencyId, label } });
  return { ok: true, mappingId: row.id, duplicate: false };
}

/** Review a misconception cluster — approve/reject (teacher gate). */
export async function reviewMisconceptionCluster({ clusterId = null, decision = '', note = '', actorId = null } = {}) {
  if (!clusterId) return { ok: false, error: 'clusterId is required' };
  if (!['approve', 'reject'].includes(decision)) return { ok: false, error: 'decision must be approve|reject' };
  const db = getDb();
  if (!db) return { ok: false, error: 'PostgreSQL required' };
  const tenantId = getCurrentTenant()?.id;
  if (!tenantId) return { ok: false, error: 'tenant context is required' };

  const status = decision === 'approve' ? CLUSTER_STATUS.APPROVED : CLUSTER_STATUS.REJECTED;
  await db
    .updateTable('misconception_clusters')
    .set({ status, review_note: note || null, reviewed_by: actorId, reviewed_at: new Date() })
    .where('tenant_id', '=', tenantId)
    .where('id', '=', clusterId)
    .execute();

  await audit(AUDIT_ACTIONS.CLUSTER_REVIEW, { actorId, tenantId, detail: { clusterId, decision } });
  return { ok: true, status };
}

/** List misconception mappings (optionally by competency). */
export async function listMisconceptionMappings({ competencyId = null, status = null } = {}) {
  const db = getDb();
  if (!db) return [];
  const tenantId = getCurrentTenant()?.id;
  if (!tenantId) return [];
  let q = db.selectFrom('misconception_mappings').selectAll().where('tenant_id', '=', tenantId);
  if (competencyId) q = q.where('competency_id', '=', competencyId);
  if (status) q = q.where('status', '=', status);
  return q.orderBy('created_at', 'desc').limit(100).execute();
}

// ═══════════════════════════════════════════════════════════════════
// INTERVENTION LIBRARY + VERSIONS
// ═══════════════════════════════════════════════════════════════════

/**
 * Create intervention library entry (draft) + first version.
 * @param {Object} params - { kind, title, description, sourcePackId, targetClusterId, actorId }
 */
export async function createIntervention({
  kind = 'exercise',
  title = '',
  description = '',
  sourcePackId = null,
  targetClusterId = null,
  actorId = null,
} = {}) {
  if (!title || !title.trim()) return { ok: false, error: 'title is required' };
  if (!['video', 'exercise', 'reading', 'group_activity', 'reteach'].includes(kind)) {
    return { ok: false, error: `invalid kind ${kind}` };
  }
  const db = getDb();
  if (!db) return { ok: false, error: 'PostgreSQL required' };
  const tenantId = getCurrentTenant()?.id;
  if (!tenantId) return { ok: false, error: 'tenant context is required' };

  const row = await db
    .insertInto('intervention_library')
    .values({
      tenant_id: tenantId,
      kind,
      title,
      description: description || null,
      source_pack_id: sourcePackId || null,
      target_cluster_id: targetClusterId || null,
      status: INTERVENTION_STATUS.DRAFT,
      created_by: actorId,
    })
    .returning(['id'])
    .executeTakeFirst();

  await db
    .insertInto('intervention_versions')
    .values({ intervention_id: row.id, version_no: 1, title, description: description || null, created_by: actorId })
    .execute();

  await audit(AUDIT_ACTIONS.INTERVENTION_CREATE, { actorId, tenantId, detail: { interventionId: row.id, kind } });
  return { ok: true, interventionId: row.id };
}

/** Publish an intervention (draft → published). */
export async function publishIntervention({ interventionId = null, actorId = null } = {}) {
  const db = getDb();
  if (!db) return { ok: false, error: 'PostgreSQL required' };
  const tenantId = getCurrentTenant()?.id;
  if (!tenantId) return { ok: false, error: 'tenant context is required' };
  if (!interventionId) return { ok: false, error: 'interventionId is required' };

  await db
    .updateTable('intervention_library')
    .set({ status: INTERVENTION_STATUS.PUBLISHED, updated_at: new Date() })
    .where('tenant_id', '=', tenantId)
    .where('id', '=', interventionId)
    .execute();

  // New version bump
  const last = await db
    .selectFrom('intervention_versions')
    .select(db.fn.max('version_no').as('maxv'))
    .where('intervention_id', '=', interventionId)
    .executeTakeFirst();
  const nextVersion = Number(last?.maxv || 0) + 1;
  const iv = await db
    .selectFrom('intervention_library')
    .select(['title', 'description'])
    .where('id', '=', interventionId)
    .executeTakeFirst();
  await db
    .insertInto('intervention_versions')
    .values({
      intervention_id: interventionId,
      version_no: nextVersion,
      title: iv?.title || '',
      description: iv?.description || null,
      published_at: new Date(),
      created_by: actorId,
    })
    .execute();

  await audit(AUDIT_ACTIONS.INTERVENTION_PUBLISH, { actorId, tenantId, detail: { interventionId } });
  return { ok: true, version: nextVersion };
}

/** List published interventions (mapping input). */
export async function listPublishedInterventions() {
  const db = getDb();
  if (!db) return [];
  const tenantId = getCurrentTenant()?.id;
  if (!tenantId) return [];
  return db
    .selectFrom('intervention_library')
    .selectAll()
    .where('tenant_id', '=', tenantId)
    .where('status', '=', INTERVENTION_STATUS.PUBLISHED)
    .orderBy('title', 'asc')
    .execute();
}

// ═══════════════════════════════════════════════════════════════════
// NEXT-ACTION CARDS (§47 #1 — "endi nima qilamiz?")
// ═══════════════════════════════════════════════════════════════════

/**
 * Generate next-action cards from assessment evidence.
 * Recommendation only — teacher approve/assign qiladi (AI assign emas).
 *
 * @param {Object} params - { evidence, actorId }
 * @param {Object} params.evidence - { studentId, competencyId, score, attemptId, masteryEst, misconception }
 */
export async function generateNextActionCards({ evidence = {}, actorId = null } = {}) {
  // validate-before-getDb: evidence shartlari DB'ga murojaat qilmasdan tekshiriladi
  if (!evidence?.studentId || !evidence?.competencyId) {
    return { ok: false, error: 'evidence studentId and competencyId are required' };
  }
  const db = getDb();
  if (!db) return { ok: false, error: 'PostgreSQL required' };
  const tenantId = getCurrentTenant()?.id;
  if (!tenantId) return { ok: false, error: 'tenant context is required' };


  const interventions = await listPublishedInterventions();
  const matched = mapMisconceptionToIntervention({
    misconception: evidence.misconception || { label: 'generic weakness', severity: evidence.score < 0.5 ? 'high' : 'medium' },
    interventions,
  });
  if (!matched.ok) return { ok: false, error: matched.error };

  const card = buildNextActionCard({ evidence, matched: matched.matched });
  if (!card.ok) return { ok: false, error: card.reason };

  // Idempotent: bitta student+competency uchun bitta pending card
  const existing = await db
    .selectFrom('next_action_cards')
    .select(['id'])
    .where('tenant_id', '=', tenantId)
    .where('student_id', '=', evidence.studentId)
    .where('competency_id', '=', evidence.competencyId)
    .where('status', '=', ACTION_CARD_STATUS.PENDING)
    .executeTakeFirst();
  if (existing) return { ok: true, cardId: existing.id, duplicate: true };

  const row = await db
    .insertInto('next_action_cards')
    .values({
      tenant_id: tenantId,
      student_id: evidence.studentId,
      competency_id: evidence.competencyId,
      cluster_id: card.card.clusterId,
      intervention_id: card.card.interventionId,
      source_attempt_id: card.card.sourceAttemptId,
      rationale: card.card.rationale,
      status: ACTION_CARD_STATUS.PENDING,
      priority: card.card.priority,
    })
    .returning(['id'])
    .executeTakeFirst();

  await audit(AUDIT_ACTIONS.ACTION_CARD_GENERATE, { actorId, tenantId, detail: { cardId: row.id, priority: card.card.priority } });
  return { ok: true, cardId: row.id, card: { ...card.card, id: row.id }, duplicate: false };
}

/** Teacher decision — approve/edit/dismiss/assign (Prompt 55 §10). */
export async function decideNextAction({ cardId = null, decision = '', note = '', edits = null, actorId = null } = {}) {
  // validate-before-getDb: decision nomi DB'ga murojaat qilmasdan tekshiriladi
  if (!TEACHER_DECISIONS.includes(decision)) {
    return { ok: false, error: `invalid decision ${decision} — allowed: ${TEACHER_DECISIONS.join('|')}` };
  }
  if (!cardId) return { ok: false, error: 'cardId is required' };
  const db = getDb();
  if (!db) return { ok: false, error: 'PostgreSQL required' };
  const tenantId = getCurrentTenant()?.id;
  if (!tenantId) return { ok: false, error: 'tenant context is required' };


  const card = await db
    .selectFrom('next_action_cards')
    .select(['status', 'intervention_id', 'cluster_id'])
    .where('tenant_id', '=', tenantId)
    .where('id', '=', cardId)
    .executeTakeFirst();
  if (!card) return { ok: false, error: 'card not found' };

  const v = validateTeacherDecision({ decision, status: card.status });
  if (!v.ok) return { ok: false, error: v.reason };

  const set = {
    status: v.targetStatus,
    decided_by: actorId,
    decided_at: new Date(),
    updated_at: new Date(),
  };
  if (note) set.rationale = note;
  if (edits && typeof edits === 'object') {
    if (edits.interventionId) set.intervention_id = edits.interventionId;
    if (edits.clusterId) set.cluster_id = edits.clusterId;
    if (edits.rationale) set.rationale = edits.rationale;
  }

  await db
    .updateTable('next_action_cards')
    .set(set)
    .where('tenant_id', '=', tenantId)
    .where('id', '=', cardId)
    .execute();

  await audit(AUDIT_ACTIONS.ACTION_CARD_DECISION, { actorId, tenantId, detail: { cardId, decision } });
  return { ok: true, status: v.targetStatus };
}

/** List next-action cards (filter by status/student). */
export async function listActionCards({ status = null, studentId = null } = {}) {
  const db = getDb();
  if (!db) return [];
  const tenantId = getCurrentTenant()?.id;
  if (!tenantId) return [];
  let q = db.selectFrom('next_action_cards').selectAll().where('tenant_id', '=', tenantId);
  if (status) q = q.where('status', '=', status);
  if (studentId) q = q.where('student_id', '=', studentId);
  return q.orderBy('created_at', 'desc').limit(100).execute();
}

// ═══════════════════════════════════════════════════════════════════
// DIFFERENT-ITEM REASSESSMENT
// ═══════════════════════════════════════════════════════════════════

/**
 * Assign a reassessment with DIFFERENT items (source itemlar takror emas).
 * @param {Object} params - { cardId, studentId, competencyId, sourceAttemptId, itemPool, sourceItemIds, count, actorId }
 */
export async function assignReassessment({
  cardId = null,
  studentId = null,
  competencyId = null,
  sourceAttemptId = null,
  itemPool = [],
  sourceItemIds = [],
  count = 5,
  actorId = null,
} = {}) {
  if (!studentId || !competencyId) return { ok: false, error: 'studentId and competencyId are required' };
  const plan = planDifferentItemReassessment({ itemPool, sourceItemIds, count });
  if (!plan.ok) return { ok: false, error: plan.error };

  const db = getDb();
  if (!db) return { ok: false, error: 'PostgreSQL required' };
  const tenantId = getCurrentTenant()?.id;
  if (!tenantId) return { ok: false, error: 'tenant context is required' };

  // Idempotent: bitta student+competency uchun bitta reassessment
  const existing = await db
    .selectFrom('reassessments')
    .select(['id'])
    .where('tenant_id', '=', tenantId)
    .where('student_id', '=', studentId)
    .where('competency_id', '=', competencyId)
    .executeTakeFirst();
  if (existing) return { ok: true, reassessmentId: existing.id, duplicate: true };

  const row = await db
    .insertInto('reassessments')
    .values({
      tenant_id: tenantId,
      student_id: studentId,
      competency_id: competencyId,
      card_id: cardId || null,
      source_attempt_id: sourceAttemptId || null,
      item_ids: JSON.stringify(plan.picked.map((i) => i.id)),
      status: REASSESSMENT_STATUS.ASSIGNED,
      assigned_by: actorId,
    })
    .returning(['id'])
    .executeTakeFirst();

  await audit(AUDIT_ACTIONS.REASSESSMENT_ASSIGN, { actorId, tenantId, detail: { reassessmentId: row.id, items: plan.picked.length, excluded: plan.excluded } });
  return { ok: true, reassessmentId: row.id, items: plan.picked, duplicate: false };
}

// ═══════════════════════════════════════════════════════════════════
// BEFORE / AFTER / RETENTION METRICS
// ═══════════════════════════════════════════════════════════════════

/**
 * Record intervention metrics (before/after/retention).
 * @param {Object} params - { studentId, interventionId, preScore, postScore, retentionScore, preAttemptId, postAttemptId, retentionAt, actorId }
 */
export async function recordInterventionMetrics({
  studentId = null,
  interventionId = null,
  preScore = null,
  postScore = null,
  retentionScore = null,
  preAttemptId = null,
  postAttemptId = null,
  retentionAt = null,
  actorId = null,
} = {}) {
  const calc = computeBeforeAfterRetention({ preScore, postScore, retentionScore });
  if (!calc.ok) return { ok: false, error: calc.error };
  if (!studentId || !interventionId) return { ok: false, error: 'studentId and interventionId are required' };

  const db = getDb();
  if (!db) return { ok: false, error: 'PostgreSQL required' };
  const tenantId = getCurrentTenant()?.id;
  if (!tenantId) return { ok: false, error: 'tenant context is required' };

  await db
    .insertInto('intervention_metrics')
    .values({
      tenant_id: tenantId,
      student_id: studentId,
      intervention_id: interventionId,
      pre_score: preScore,
      post_score: postScore,
      retention_score: retentionScore,
      pre_attempt_id: preAttemptId || null,
      post_attempt_id: postAttemptId || null,
      retention_at: retentionAt ? new Date(retentionAt) : null,
    })
    .onConflict((oc) =>
      oc
        .columns(['tenant_id', 'student_id', 'intervention_id'])
        .doUpdateSet({
          pre_score: preScore,
          post_score: postScore,
          retention_score: retentionScore,
          retention_at: retentionAt ? new Date(retentionAt) : null,
        })
    )
    .execute();

  await audit(AUDIT_ACTIONS.INTERVENTION_METRICS, {
    actorId,
    tenantId,
    detail: { studentId, interventionId, gain: calc.gain, retained: calc.retained },
  });
  return { ok: true, ...calc.metrics };
}

// ═══════════════════════════════════════════════════════════════════
// MASTERY ESTIMATE — RULE + BKT (§47 #6)
// ═══════════════════════════════════════════════════════════════════

/**
 * Update mastery estimate (rule or BKT). Idempotent per student+competency+method.
 * @param {Object} params - { studentId, competencyId, method, responses, correct, total, lastN, actorId }
 */
export async function updateMasteryEstimate({
  studentId = null,
  competencyId = null,
  method = 'rule',
  responses = [],
  correct = null,
  total = null,
  lastN = [],
  actorId = null,
} = {}) {
  if (!studentId || !competencyId) return { ok: false, error: 'studentId and competencyId are required' };
  if (!MASTERY_METHODS.includes(method)) return { ok: false, error: `invalid method ${method}` };

  const db = getDb();
  if (!db) return { ok: false, error: 'PostgreSQL required' };
  const tenantId = getCurrentTenant()?.id;
  if (!tenantId) return { ok: false, error: 'tenant context is required' };

  let est = 0;
  let level = 'below';
  if (method === 'bkt') {
    const r = estimateMasteryBkt({ responses });
    if (!r.ok) return { ok: false, error: r.error };
    est = r.est;
    level = r.level;
  } else {
    const c = correct == null ? responses.filter(Boolean).length : Number(correct);
    const t = total == null ? responses.length : Number(total);
    const r = estimateMasteryRule({ correct: c, total: t, lastN });
    if (!r.ok) return { ok: false, error: r.error };
    est = r.est;
    level = r.level;
  }

  await db
    .insertInto('mastery_estimates')
    .values({
      tenant_id: tenantId,
      student_id: studentId,
      competency_id: competencyId,
      method,
      mastery_est: est,
      threshold: 0.8,
      level,
      prior_p: 0.3,
      learn_rate: 0.2,
      slip: 0.1,
      guess: 0.2,
      evidence_count: responses.length || Number(total) || 1,
      last_evidence_at: new Date(),
    })
    .onConflict((oc) =>
      oc
        .columns(['tenant_id', 'student_id', 'competency_id', 'method'])
        .doUpdateSet({
          mastery_est: est,
          level,
          evidence_count: responses.length || Number(total) || 1,
          last_evidence_at: new Date(),
          updated_at: new Date(),
        })
    )
    .execute();

  await audit(AUDIT_ACTIONS.MASTERY_UPDATE, { actorId, tenantId, detail: { studentId, competencyId, method, est, level } });
  return { ok: true, est, level, method };
}

// ═══════════════════════════════════════════════════════════════════
// SPACED PRACTICE SCHEDULER (P3 — formative only)
// ═══════════════════════════════════════════════════════════════════

/**
 * Schedule next practice session using spaced intervals.
 * @param {Object} params - { studentId, competencyId, sessionCount, lastDueAt, actorId }
 */
export async function schedulePracticeSession({
  studentId = null,
  competencyId = null,
  sessionCount = 0,
  lastDueAt = null,
  actorId = null,
} = {}) {
  if (!studentId || !competencyId) return { ok: false, error: 'studentId and competencyId are required' };
  const sched = computePracticeSchedule({ sessionCount, lastDueAt });
  if (!sched.ok) return { ok: false, error: sched.error };

  const db = getDb();
  if (!db) return { ok: false, error: 'PostgreSQL required' };
  const tenantId = getCurrentTenant()?.id;
  if (!tenantId) return { ok: false, error: 'tenant context is required' };

  const now = new Date();
  const dueAt = sched.dueAt ? new Date(sched.dueAt) : new Date(now.getTime() + sched.intervalDays * 24 * 3600 * 1000);

  const row = await db
    .insertInto('practice_sessions')
    .values({
      tenant_id: tenantId,
      student_id: studentId,
      competency_id: competencyId,
      session_type: 'practice',
      scheduled_at: now,
      due_at: dueAt,
      interval_days: sched.intervalDays,
      status: 'scheduled',
    })
    .returning(['id'])
    .executeTakeFirst();

  await audit(AUDIT_ACTIONS.PRACTICE_SCHEDULE, { actorId, tenantId, detail: { sessionId: row.id, intervalDays: sched.intervalDays } });
  return { ok: true, sessionId: row.id, intervalDays: sched.intervalDays, dueAt: dueAt.toISOString() };
}

// ═══════════════════════════════════════════════════════════════════
// SUPPORT CASE + STUDENT CONTEST (ETHICAL — NO PREDICTION LABELS)
// ═══════════════════════════════════════════════════════════════════

/**
 * Open a support case from a signal. Privacy guards applied:
 * temporary only, no auto penalty, no forbidden evidence source.
 * @param {Object} params - { studentId, signalType, evidence, notes, owner, actorId }
 */
export async function openSupportCase({
  studentId = null,
  signalType = 'weak_concept',
  evidence = {},
  notes = '',
  owner = null,
  actorId = null,
} = {}) {
  const sig = validateSupportSignal({ signalType, evidence });
  if (!sig.ok) return { ok: false, error: sig.reason };
  const priv = assertNoPermanentLabelOrPenalty({ isTemporary: true, autoPenalty: false, evidence });
  if (!priv.ok) return { ok: false, error: priv.reason };
  if (!studentId) return { ok: false, error: 'studentId is required' };

  const db = getDb();
  if (!db) return { ok: false, error: 'PostgreSQL required' };
  const tenantId = getCurrentTenant()?.id;
  if (!tenantId) return { ok: false, error: 'tenant context is required' };

  const existing = await db
    .selectFrom('support_cases')
    .select(['id'])
    .where('tenant_id', '=', tenantId)
    .where('student_id', '=', studentId)
    .where('signal_type', '=', signalType)
    .where('case_status', '=', 'open')
    .executeTakeFirst();
  if (existing) return { ok: true, caseId: existing.id, duplicate: true };

  const row = await db
    .insertInto('support_cases')
    .values({
      tenant_id: tenantId,
      student_id: studentId,
      signal_type: signalType,
      evidence: JSON.stringify(evidence),
      case_status: 'open',
      owner: owner || actorId || null,
      notes: notes || null,
      is_temporary: true,
      auto_penalty: false,
    })
    .returning(['id'])
    .executeTakeFirst();

  await audit(AUDIT_ACTIONS.SUPPORT_CASE_OPEN, { actorId, tenantId, detail: { caseId: row.id, signalType } });
  return { ok: true, caseId: row.id, duplicate: false };
}

/** Resolve/close a support case (teacher). */
export async function resolveSupportCase({ caseId = null, outcome = '', actorId = null } = {}) {
  if (!caseId) return { ok: false, error: 'caseId is required' };
  const db = getDb();
  if (!db) return { ok: false, error: 'PostgreSQL required' };
  const tenantId = getCurrentTenant()?.id;
  if (!tenantId) return { ok: false, error: 'tenant context is required' };

  await db
    .updateTable('support_cases')
    .set({ case_status: 'closed', notes: outcome || null, closed_at: new Date() })
    .where('tenant_id', '=', tenantId)
    .where('id', '=', caseId)
    .execute();

  await audit(AUDIT_ACTIONS.SUPPORT_CASE_CLOSE, { actorId, tenantId, detail: { caseId } });
  return { ok: true };
}

/**
 * Student contest (appeal) request — always open, human review required.
 * @param {Object} params - { studentId, caseId, requestType, reason, actorId }
 */
export async function submitContestRequest({
  studentId = null,
  caseId = null,
  requestType = 'appeal',
  reason = '',
  actorId = null,
} = {}) {
  const v = validateContestRequest({ requestType, reason });
  if (!v.ok) return { ok: false, error: v.reason };
  if (!studentId) return { ok: false, error: 'studentId is required' };

  const db = getDb();
  if (!db) return { ok: false, error: 'PostgreSQL required' };
  const tenantId = getCurrentTenant()?.id;
  if (!tenantId) return { ok: false, error: 'tenant context is required' };

  const row = await db
    .insertInto('student_contest_requests')
    .values({
      tenant_id: tenantId,
      student_id: studentId,
      case_id: caseId || null,
      request_type: requestType,
      reason,
      status: 'open',
    })
    .returning(['id'])
    .executeTakeFirst();

  await audit(AUDIT_ACTIONS.CONTEST_REQUEST, { actorId, tenantId, detail: { contestId: row.id, requestType } });
  return { ok: true, contestId: row.id };
}

/** Dashboard — cards by status, mastery levels, support cases, metrics. */
export async function getInterventionDashboard() {
  const db = getDb();
  if (!db) return { ok: false, error: 'PostgreSQL required', cards: [], mastery: [], supportCases: [], metrics: [] };
  const tenantId = getCurrentTenant()?.id;
  if (!tenantId) return { ok: false, error: 'tenant context is required' };

  const cards = await db
    .selectFrom('next_action_cards')
    .selectAll()
    .where('tenant_id', '=', tenantId)
    .orderBy('created_at', 'desc')
    .limit(50)
    .execute();

  const mastery = await db
    .selectFrom('mastery_estimates')
    .selectAll()
    .where('tenant_id', '=', tenantId)
    .orderBy('updated_at', 'desc')
    .limit(50)
    .execute();

  const supportCases = await db
    .selectFrom('support_cases')
    .selectAll()
    .where('tenant_id', '=', tenantId)
    .orderBy('created_at', 'desc')
    .limit(50)
    .execute();

  const metrics = await db
    .selectFrom('intervention_metrics')
    .selectAll()
    .where('tenant_id', '=', tenantId)
    .orderBy('created_at', 'desc')
    .limit(50)
    .execute();

  return { ok: true, cards, mastery, supportCases, metrics };
}

// Constants re-export for routes meta
export const INTERVENTION_META = {
  clusterStatus: CLUSTER_STATUS,
  interventionStatus: INTERVENTION_STATUS,
  actionCardStatus: ACTION_CARD_STATUS,
  reassessmentStatus: REASSESSMENT_STATUS,
  masteryMethods: MASTERY_METHODS,
  masteryLevels: MASTERY_LEVELS,
  spacedIntervalsDays: SPACED_INTERVALS_DAYS,
};
