/**
 * Deborah — AI Question Generator 50/30/20 (DB service)
 *
 * Prompt 53 — source-grounded, difficulty-controlled item draft pipeline.
 * Graceful degradation (PostgreSQL absent in CI): write path'lar
 * 'PostgreSQL required' throw qiladi, read path'lar []/null.
 * Har bir write path tenant-scoped + idempotent (UNIQUE index'lar).
 *
 * Publish flow: APPROVED candidate → item-bank createItem (source:
 * ai_generated). Candidate hech qachon APPROVED/PUBLISHED bo'lmaydi
 * teacher review'siz (§15 lifecycle guard).
 */

import { getDb } from '../../infrastructure/postgres.js';
import { getCurrentTenant } from '../auth/tenant-context.js';
import { audit, AUDIT_ACTIONS } from '../auth/audit.js';
import { createItem, getItemBank } from '../item-bank/index.js';
import {
  validateBlueprint,
  planCandidateJobs,
  runAllValidators,
  canTransition,
  GEN_BLUEPRINT_STATUS,
  GEN_JOB_STATUS,
  GEN_CANDIDATE_STATUS,
  GEN_REVIEW_DECISION,
} from './ai-question-gen.schema.js';

function getTenantId() {
  return getCurrentTenant()?.tenantId || 1;
}

// ═══════════════════════════════════════════════════════════════════
// BLUEPRINTS
// ═══════════════════════════════════════════════════════════════════

/**
 * Create a generation blueprint + per-slot jobs (3–5 overgenerate).
 * @param {Object} params - { name, competencyId, sourcePackId, subjectArea, educationLevel, language, targetCount, itemTypes, model, modelVersion, overgenerateFactor, createdBy }
 */
export async function createGenerationBlueprint({
  name,
  competencyId = null,
  sourcePackId,
  subjectArea = null,
  educationLevel = null,
  language = 'uz',
  targetCount,
  itemTypes = ['single_choice'],
  model,
  modelVersion,
  overgenerateFactor,
  createdBy = null,
} = {}) {
  // validate-before-getDb (graceful degradation)
  const v = validateBlueprint({
    name,
    targetCount,
    itemTypes,
    sourcePackId,
    model,
    modelVersion,
    hasAnswerVerifier: true, // source-pack verifyCitation mavjud
  });
  if (!v.ok) throw new Error(v.reason);
  const jobs = planCandidateJobs({ targetCount, overgenerateFactor });
  if (!jobs.ok) throw new Error(jobs.error);

  const db = await getDb();
  if (!db) throw new Error('PostgreSQL required');
  const row = await db
    .insertInto('ai_gen_blueprints')
    .values({
      tenant_id: getTenantId(),
      name: name.trim(),
      competency_id: competencyId ? Number(competencyId) : null,
      source_pack_id: Number(sourcePackId),
      subject_area: subjectArea ? String(subjectArea).slice(0, 64) : null,
      education_level: educationLevel ? String(educationLevel).slice(0, 32) : null,
      language: String(language).slice(0, 16),
      target_count: targetCount,
      easy_ratio: 0.5,
      medium_ratio: 0.3,
      hard_ratio: 0.2,
      item_types: itemTypes,
      model: String(model).slice(0, 64),
      model_version: String(modelVersion).slice(0, 32),
      status: GEN_BLUEPRINT_STATUS.DRAFT,
      created_by: createdBy,
    })
    .returning(['id', 'name', 'target_count', 'status', 'created_at'])
    .executeTakeFirst();

  // Per-slot jobs (idempotent UNIQUE)
  for (const j of jobs.jobs) {
    await db
      .insertInto('ai_gen_jobs')
      .values({
        tenant_id: getTenantId(),
        blueprint_id: row.id,
        slot: j.slot,
        requested_count: j.requested,
        overgenerate_factor: j.overgenerate,
        status: GEN_JOB_STATUS.QUEUED,
      })
      .onConflict((oc) => oc.columns(['tenant_id', 'blueprint_id', 'slot']).doNothing())
      .execute();
  }
  await audit({ action: AUDIT_ACTIONS.AI_GEN_BLUEPRINT, userId: createdBy, metadata: { blueprintId: row.id, targetCount, jobs: jobs.jobs } });
  return { ok: true, blueprint: row, jobs: jobs.jobs };
}

/** List blueprints (tenant-scoped). */
export async function listGenerationBlueprints({ status = null } = {}) {
  const db = await getDb();
  if (!db) return [];
  let q = db.selectFrom('ai_gen_blueprints').where('tenant_id', '=', getTenantId());
  if (status) q = q.where('status', '=', status);
  return await q.orderBy('created_at', 'desc').selectAll().execute();
}

/** Get a blueprint with its jobs (tenant-scoped). */
export async function getGenerationBlueprint(id) {
  if (!id) return null;
  const db = await getDb();
  if (!db) return null;
  const blueprint = await db
    .selectFrom('ai_gen_blueprints')
    .where('id', '=', Number(id))
    .where('tenant_id', '=', getTenantId())
    .selectAll()
    .executeTakeFirst();
  if (!blueprint) return null;
  const jobs = await db
    .selectFrom('ai_gen_jobs')
    .where('blueprint_id', '=', blueprint.id)
    .where('tenant_id', '=', getTenantId())
    .orderBy('slot', 'asc')
    .selectAll()
    .execute();
  return { ...blueprint, jobs };
}

// ═══════════════════════════════════════════════════════════════════
// CANDIDATES (generate → validate → review → publish)
// ═══════════════════════════════════════════════════════════════════

/**
 * Submit a generated candidate (CI simulyatsiya — real LLM yo'q).
 * Pure pipeline: validators ishlaydi, natija jadvalga yoziladi.
 *
 * @param {Object} params
 * @param {number} params.jobId
 * @param {Object} params.candidate - { stem, options, correctKey, correctAnswer, questionType, difficulty, cognitiveLevel, sourceRefs, rationale, misconceptions }
 * @param {Array<Object>} [params.approvedChunks]
 * @param {string[]} [params.existingHashes]
 * @param {number|null} [params.actorId]
 */
export async function submitGeneratedCandidate({
  jobId,
  candidate = {},
  approvedChunks = [],
  existingHashes = [],
  actorId = null,
} = {}) {
  if (!jobId) throw new Error('jobId is required');
  if (!candidate || typeof candidate !== 'object') throw new Error('candidate is required');
  if (!candidate.stem || typeof candidate.stem !== 'string' || !candidate.stem.trim()) {
    throw new Error('candidate.stem is required');
  }
  if (!candidate.correctAnswer) throw new Error('candidate.correctAnswer is required');

  // Validators (pure)
  const validation = runAllValidators({ candidate, approvedChunks, existingHashes });
  const inputHash = require('node:crypto').createHash('sha256').update(candidate.stem).digest('hex');

  const db = await getDb();
  if (!db) {
    // dry-run — CI integration test
    return {
      ok: true,
      dryRun: true,
      accepted: validation.ok,
      inputHash,
      validation,
      candidate: { stem: candidate.stem, difficulty: candidate.difficulty, status: validation.ok ? GEN_CANDIDATE_STATUS.AI_DRAFT : GEN_CANDIDATE_STATUS.REJECTED },
    };
  }
  const job = await db
    .selectFrom('ai_gen_jobs')
    .where('id', '=', Number(jobId))
    .where('tenant_id', '=', getTenantId())
    .select(['id', 'blueprint_id', 'slot'])
    .executeTakeFirst();
  if (!job) throw new Error('Job not found');

  const status = validation.ok ? GEN_CANDIDATE_STATUS.AI_DRAFT : GEN_CANDIDATE_STATUS.REJECTED;
  const row = await db
    .insertInto('ai_gen_candidates')
    .values({
      tenant_id: getTenantId(),
      job_id: job.id,
      blueprint_id: job.blueprint_id,
      stem: candidate.stem,
      options: candidate.options || [],
      correct_key: candidate.correctKey || 'A',
      rationale: candidate.rationale || null,
      source_refs: candidate.sourceRefs || [],
      difficulty: candidate.difficulty || 'medium',
      cognitive_level: candidate.cognitiveLevel || null,
      question_type: candidate.questionType || 'single_choice',
      distractor_rationales: candidate.distractorRationales || [],
      validation_summary: validation.summary,
      status,
      input_hash: inputHash,
    })
    .onConflict((oc) => oc.columns(['tenant_id', 'job_id', 'input_hash']).doNothing())
    .returning(['id', 'stem', 'difficulty', 'status', 'input_hash'])
    .executeTakeFirst();

  if (!row) throw new Error('duplicate candidate — identical stem already submitted');
  for (const vv of validation.validations) {
    await db
      .insertInto('ai_gen_validations')
      .values({
        tenant_id: getTenantId(),
        candidate_id: row.id,
        validator: vv.name,
        ok: vv.ok,
        note: String(vv.note || '').slice(0, 500),
      })
      .onConflict((oc) => oc.columns(['tenant_id', 'candidate_id', 'validator']).doNothing())
      .execute();
  }
  await audit({ action: AUDIT_ACTIONS.AI_GEN_CANDIDATE, userId: actorId, metadata: { candidateId: row.id, status, slot: job.slot } });
  return { ok: true, candidate: row, validation };
}

/** List candidates (tenant-scoped, optional job/blueprint filter). */
export async function listGeneratedCandidates({ jobId = null, blueprintId = null, status = null, limit = 100 } = {}) {
  const db = await getDb();
  if (!db) return [];
  let q = db.selectFrom('ai_gen_candidates').where('tenant_id', '=', getTenantId());
  if (jobId) q = q.where('job_id', '=', Number(jobId));
  if (blueprintId) q = q.where('blueprint_id', '=', Number(blueprintId));
  if (status) q = q.where('status', '=', status);
  return await q.orderBy('id', 'desc').limit(Math.min(200, Number(limit) || 100)).selectAll().execute();
}

/** Get a candidate with validations + reviews (tenant-scoped). */
export async function getGeneratedCandidate(id) {
  if (!id) return null;
  const db = await getDb();
  if (!db) return null;
  const candidate = await db
    .selectFrom('ai_gen_candidates')
    .where('id', '=', Number(id))
    .where('tenant_id', '=', getTenantId())
    .selectAll()
    .executeTakeFirst();
  if (!candidate) return null;
  const validations = await db
    .selectFrom('ai_gen_validations')
    .where('candidate_id', '=', candidate.id)
    .where('tenant_id', '=', getTenantId())
    .selectAll()
    .execute();
  const reviews = await db
    .selectFrom('ai_gen_reviews')
    .where('candidate_id', '=', candidate.id)
    .where('tenant_id', '=', getTenantId())
    .orderBy('created_at', 'asc')
    .selectAll()
    .execute();
  return { ...candidate, validations, reviews };
}

/**
 * Teacher review — approve/reject/edit/publish candidate.
 * Publish: APPROVED candidate → item-bank createItem (source: ai_generated).
 *
 * @param {Object} params
 * @param {number} params.candidateId
 * @param {string} params.decision - approve | reject | publish | retire | edit
 * @param {string} [params.note]
 * @param {Object} [params.edits] - { stem, options, correctKey, rationale }
 * @param {number} [params.bankId] - publish uchun kerak
 * @param {number|null} [params.reviewerId]
 */
export async function reviewGeneratedCandidate({
  candidateId,
  decision,
  note = '',
  edits = null,
  bankId = null,
  reviewerId = null,
} = {}) {
  if (!candidateId) throw new Error('candidateId is required');
  if (!Object.values(GEN_REVIEW_DECISION).includes(decision)) {
    throw new Error(`invalid decision ${decision}`);
  }
  const db = await getDb();
  if (!db) throw new Error('PostgreSQL required');
  const candidate = await getGeneratedCandidate(Number(candidateId));
  if (!candidate) throw new Error('Candidate not found');

  // Lifecycle guard
  const target =
    decision === GEN_REVIEW_DECISION.APPROVE
      ? GEN_CANDIDATE_STATUS.APPROVED
      : decision === GEN_REVIEW_DECISION.PUBLISH
        ? GEN_CANDIDATE_STATUS.PUBLISHED
        : decision === GEN_REVIEW_DECISION.REJECT
          ? GEN_CANDIDATE_STATUS.REJECTED
          : decision === GEN_REVIEW_DECISION.RETIRE
            ? GEN_CANDIDATE_STATUS.RETIRED
            : GEN_CANDIDATE_STATUS.REVIEWED;
  const transition = canTransition({
    from: candidate.status,
    to: target,
    teacherApproved: true, // review endpoint = teacher action
  });
  if (!transition.ok) throw new Error(transition.reason);

  // Publish → item-bank createItem (faqat APPROVED)
  let publishedItemId = null;
  if (decision === GEN_REVIEW_DECISION.PUBLISH) {
    if (!bankId) throw new Error('bankId is required to publish to item bank');
    const bank = await getItemBank(Number(bankId));
    if (!bank) throw new Error('Item bank not found');
    const options = edits?.options || candidate.options || [];
    const correctOption = options.find((o) => String(o.key) === String(candidate.correct_key)) || options.find((o) => o.isCorrect);
    const item = await createItem({
      bank_id: Number(bankId),
      question_type: candidate.question_type,
      difficulty: candidate.difficulty,
      cognitive_level: candidate.cognitive_level,
      points: 1,
      time_seconds: null,
      public_data: {
        stem: edits?.stem || candidate.stem,
        options: options.map((o) => ({ key: o.key, text: o.text })),
      },
      private_data: {
        correctKey: correctOption ? correctOption.key : candidate.correct_key,
        explanation: edits?.rationale || candidate.rationale || null,
      },
      source: 'ai_generated',
      misconceptions: options.map((o) => ({ optionKey: o.key, misconception: o.misconception || '' })),
      metadata: { aiGenCandidateId: candidate.id, blueprintId: candidate.blueprint_id, sourceRefs: candidate.source_refs },
      created_by: reviewerId,
    });
    publishedItemId = item.id;
  }

  // Apply edits if provided (teacher edit)
  const updated = await db
    .updateTable('ai_gen_candidates')
    .set({
      status: target,
      updated_at: new Date(),
      ...(edits?.stem ? { stem: edits.stem } : {}),
      ...(edits?.options ? { options: edits.options } : {}),
    })
    .where('id', '=', candidate.id)
    .where('tenant_id', '=', getTenantId())
    .returning(['id', 'status', 'stem'])
    .executeTakeFirst();

  const reviewRow = await db
    .insertInto('ai_gen_reviews')
    .values({
      tenant_id: getTenantId(),
      candidate_id: candidate.id,
      decision,
      note: String(note || '').slice(0, 1000),
      edited_stem: edits?.stem || null,
      edited_options: edits?.options || null,
      published_item_id: publishedItemId,
      reviewer_id: reviewerId,
    })
    .returning(['id', 'decision', 'published_item_id'])
    .executeTakeFirst();
  await audit({
    action: AUDIT_ACTIONS.AI_GEN_REVIEW,
    userId: reviewerId,
    metadata: { candidateId: candidate.id, decision, publishedItemId },
  });
  return { ok: true, candidate: updated, review: reviewRow };
}

// ═══════════════════════════════════════════════════════════════════
// DASHBOARD
// ═══════════════════════════════════════════════════════════════════

/** Aggregate dashboard data for the admin question-gen page. */
export async function getQuestionGenDashboard({ blueprintId = null } = {}) {
  const db = await getDb();
  if (!db) return { ok: true, dryRun: true, blueprints: [], candidates: [], jobs: [] };
  const tenant = getTenantId();
  const blueprints = blueprintId
    ? await db.selectFrom('ai_gen_blueprints').where('tenant_id', '=', tenant).where('id', '=', Number(blueprintId)).selectAll().execute()
    : await db.selectFrom('ai_gen_blueprints').where('tenant_id', '=', tenant).orderBy('created_at', 'desc').limit(30).selectAll().execute();
  const candidates = await db
    .selectFrom('ai_gen_candidates')
    .where('tenant_id', '=', tenant)
    .orderBy('id', 'desc')
    .limit(100)
    .selectAll()
    .execute();
  const jobs = blueprintId
    ? await db.selectFrom('ai_gen_jobs').where('tenant_id', '=', tenant).where('blueprint_id', '=', Number(blueprintId)).orderBy('slot', 'asc').selectAll().execute()
    : await db.selectFrom('ai_gen_jobs').where('tenant_id', '=', tenant).orderBy('id', 'desc').limit(50).selectAll().execute();
  return { ok: true, dryRun: false, blueprints, candidates, jobs };
}
