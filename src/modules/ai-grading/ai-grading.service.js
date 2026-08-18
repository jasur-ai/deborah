/**
 * Deborah — Written AI Grading Shadow Mode (DB service)
 *
 * Prompt 51 — rubric/evidence structured AI draft'ni shadow rejimda
 * ishlatish. Graceful degradation (PostgreSQL absent in CI): write
 * path'lar 'PostgreSQL required' throw qiladi, read path'lar []/null.
 * Har bir write path tenant-scoped + idempotent (UNIQUE index'lar).
 *
 * SECURITY / DATA GUARD (Prompt 51 §15-17):
 *   - LLM total score final authority EMAS — override faqat teacher.
 *   - PII redaction provider'ga borishdan oldin (redactPii).
 *   - Model web/tool access qilmaydi — provider_response faqat JSON.
 *   - Prompt-injection / keyword-stuffing / negation → human_review.
 */

import { getDb } from '../../infrastructure/postgres.js';
import { getCurrentTenant } from '../auth/tenant-context.js';
import { audit, AUDIT_ACTIONS } from '../auth/audit.js';
import {
  redactPii,
  hashAiInput,
  buildPromptTemplate,
  enforceCriterionSchema,
  validateEvidenceSpan,
  extractConceptEvidence,
  aggregateCriterionScores,
  routeConfidence,
  compareAiHuman,
  shadowNeverChangesFinal,
  AI_JOB_STATUS,
  AI_RUN_STATUS,
  AI_ROUTING,
  AI_PROMPT_TEMPLATE_VERSION,
} from './ai-grading.schema.js';

function getTenantId() {
  return getCurrentTenant()?.tenantId || 1;
}

// ═══════════════════════════════════════════════════════════════════
// JOBS
// ═══════════════════════════════════════════════════════════════════

/** Create an AI grading job (batch registry). */
export async function createAiGradingJob({ rubricVersionId = null, name, model, modelVersion, createdBy = null } = {}) {
  if (!name || typeof name !== 'string' || !name.trim()) throw new Error('name is required');
  if (name.length > 160) throw new Error('name exceeds 160 chars');
  if (!model || !modelVersion) throw new Error('model and modelVersion are required (stop condition: exact version pin)');
  const db = await getDb();
  if (!db) throw new Error('PostgreSQL required');
  const row = await db
    .insertInto('ai_grading_jobs')
    .values({
      tenant_id: getTenantId(),
      rubric_version_id: rubricVersionId ? Number(rubricVersionId) : null,
      name: name.trim(),
      model: String(model).slice(0, 64),
      model_version: String(modelVersion).slice(0, 32),
      prompt_template_version: AI_PROMPT_TEMPLATE_VERSION,
      status: AI_JOB_STATUS.QUEUED,
      created_by: createdBy,
    })
    .returning(['id', 'name', 'model', 'model_version', 'status', 'created_at'])
    .executeTakeFirst();
  await audit({ action: AUDIT_ACTIONS.AI_JOB_CREATE, userId: createdBy, metadata: { jobId: row.id, model, modelVersion } });
  return { ok: true, job: row };
}

/** List jobs (tenant-scoped). */
export async function listAiGradingJobs({ status = null } = {}) {
  const db = await getDb();
  if (!db) return [];
  let q = db.selectFrom('ai_grading_jobs').where('tenant_id', '=', getTenantId());
  if (status) q = q.where('status', '=', status);
  return await q.orderBy('created_at', 'desc').selectAll().execute();
}

/** Get a single job (tenant-scoped). */
export async function getAiGradingJob(id) {
  if (!id) return null;
  const db = await getDb();
  if (!db) return null;
  return await db.selectFrom('ai_grading_jobs').where('id', '=', Number(id)).where('tenant_id', '=', getTenantId()).selectAll().executeTakeFirst();
}

// ═══════════════════════════════════════════════════════════════════
// SHADOW RUNS (PURE: redact → prompt → schema → route)
// ═══════════════════════════════════════════════════════════════════

/**
 * Run a shadow grading on a single work item (pure pipeline).
 * PG'siz: dry-run natija qaytariladi (integration test uchun).
 *
 * @param {Object} params
 * @param {number} params.jobId
 * @param {string} params.pseudonym
 * @param {string} params.responseText - STUDENT RAW javob (redact qilinadi)
 * @param {Object} params.criterion - rubric criterion { name, max_points, required_concepts, contradictions, levels }
 * @param {Array<Object>} [params.anchors]
 * @param {Object} [params.providerOutput] - simulyatsiya uchun (CI'da real LLM yo'q)
 * @param {boolean} [params.summative]
 * @param {number} [params.workItemId]
 * @param {number|null} [params.actorId]
 */
export async function runAiShadowGrade({
  jobId,
  pseudonym,
  responseText = '',
  criterion = {},
  anchors = [],
  providerOutput = null,
  summative = false,
  workItemId = null,
  actorId = null,
} = {}) {
  if (!jobId) throw new Error('jobId is required');
  if (!pseudonym) throw new Error('pseudonym is required');
  if (!responseText || typeof responseText !== 'string') throw new Error('responseText is required');
  if (!criterion || typeof criterion !== 'object') throw new Error('criterion is required');

  // 1. PII redaction + hash (reproducibility)
  const redacted = redactPii(responseText);
  const inputHash = hashAiInput(redacted.text);

  // 2. Concept/evidence/contradiction pipeline (risk flags)
  const pipeline = extractConceptEvidence({
    response: redacted.text,
    requiredConcepts: criterion.required_concepts || [],
    contradictions: criterion.contradictions || [],
  });

  // 3. Provider output — real deployment'da LLM call; CI'da simulyatsiya
  const raw = providerOutput;
  const schema = enforceCriterionSchema({
    raw,
    levels: criterion.levels || [],
    responseText: redacted.text,
  });
  if (!schema.ok) {
    return { ok: false, error: schema.error, inputHash, pipeline, redactedCount: redacted.redactedCount };
  }
  const parsed = schema.parsed;

  // 4. Validate every evidence span against the redacted response
  for (const span of parsed.evidence_spans) {
    const v = validateEvidenceSpan({ span, responseText: redacted.text });
    if (!v.ok) return { ok: false, error: v.error, inputHash };
  }

  // 5. Routing (§7.5) — contradiction/injection/stuffing/negation → human
  const routing = routeConfidence({
    confidence: parsed.confidence,
    contradiction: pipeline.contradictionsFound.length > 0,
    injection: pipeline.injection.length > 0,
    keywordStuffing: pipeline.stuffing.length > 0,
    negation: pipeline.negated.length > 0,
    summative,
  });

  // 6. Deterministic aggregation — level-mapped score
  const agg = aggregateCriterionScores([{ score: parsed.criterion_score, weight: 1 }]);
  const result = {
    ok: true,
    inputHash,
    redactedCount: redacted.redactedCount,
    totalScore: agg.total,
    confidence: Number(parsed.confidence),
    routing: routing.decision,
    routingReason: routing.reason,
    criterionResult: {
      criterionName: criterion.name,
      score: parsed.criterion_score,
      level: parsed.level,
      confidence: parsed.confidence,
      missingConcepts: pipeline.missing,
      contradictionsFound: pipeline.contradictionsFound,
      feedback: parsed.feedback,
      evidenceSpans: parsed.evidence_spans,
    },
    prompt: buildPromptTemplate({ criterion, redactedResponse: redacted.text, anchors }),
    pipeline,
  };

  // 7. Persist (PG'li bo'lsa) — shadow hech qachon final'ni o'zgartirmaydi
  const db = await getDb();
  if (db) {
    const runRow = await db
      .insertInto('ai_grading_runs')
      .values({
        tenant_id: getTenantId(),
        job_id: Number(jobId),
        work_item_id: workItemId ? Number(workItemId) : null,
        pseudonym,
        pii_redacted: redacted.redactedCount > 0,
        input_hash: inputHash,
        status: AI_RUN_STATUS.COMPLETED,
        total_score: agg.total,
        confidence: parsed.confidence,
        routing_decision: routing.decision,
        provider_response: parsed,
        started_at: new Date(),
        completed_at: new Date(),
      })
      .onConflict((oc) => oc.columns(['tenant_id', 'job_id', 'work_item_id']).doNothing())
      .returning(['id', 'status', 'total_score', 'routing_decision'])
      .executeTakeFirst();
    if (runRow) {
      const critRow = await db
        .insertInto('ai_criterion_results')
        .values({
          tenant_id: getTenantId(),
          run_id: runRow.id,
          criterion_name: criterion.name,
          score: parsed.criterion_score,
          level: parsed.level,
          confidence: parsed.confidence,
          missing_concepts: pipeline.missing,
          contradictions_found: pipeline.contradictionsFound,
          feedback: String(parsed.feedback || '').slice(0, 2000),
        })
        .returning(['id'])
        .executeTakeFirst();
      for (const span of parsed.evidence_spans) {
        await db
          .insertInto('ai_evidence_spans')
          .values({
            tenant_id: getTenantId(),
            run_id: runRow.id,
            criterion_result_id: critRow?.id || null,
            concept: String(span.concept).slice(0, 160),
            span_start: Number(span.start),
            span_end: Number(span.end),
            span_text: String(span.text || '').slice(0, 600),
          })
          .execute();
      }
      await db.updateTable('ai_grading_jobs').set({ run_count: db.raw('run_count + 1'), updated_at: new Date() }).where('id', '=', Number(jobId)).execute();
      await audit({ action: AUDIT_ACTIONS.AI_RUN_COMPLETE, userId: actorId, metadata: { runId: runRow.id, totalScore: agg.total, routing: routing.decision } });
      result.runId = runRow.id;
    } else {
      result.runId = null; // duplicate work item — idempotent no-op
    }
  } else {
    result.dryRun = true;
  }
  return result;
}

// ═══════════════════════════════════════════════════════════════════
// RUNS / RESULTS / OVERRIDES
// ═══════════════════════════════════════════════════════════════════

/** List shadow runs for a job (tenant-scoped). */
export async function listAiRuns({ jobId = null } = {}) {
  const db = await getDb();
  if (!db) return [];
  let q = db.selectFrom('ai_grading_runs').where('tenant_id', '=', getTenantId());
  if (jobId) q = q.where('job_id', '=', Number(jobId));
  return await q.orderBy('created_at', 'desc').selectAll().execute();
}

/** Get a shadow run with its criterion results + evidence spans. */
export async function getAiRun(id) {
  if (!id) return null;
  const db = await getDb();
  if (!db) return null;
  const run = await db.selectFrom('ai_grading_runs').where('id', '=', Number(id)).where('tenant_id', '=', getTenantId()).selectAll().executeTakeFirst();
  if (!run) return null;
  const criterionResults = await db.selectFrom('ai_criterion_results').where('run_id', '=', run.id).where('tenant_id', '=', getTenantId()).selectAll().execute();
  const evidenceSpans = await db.selectFrom('ai_evidence_spans').where('run_id', '=', run.id).where('tenant_id', '=', getTenantId()).selectAll().execute();
  const overrides = await db.selectFrom('ai_human_overrides').where('run_id', '=', run.id).where('tenant_id', '=', getTenantId()).selectAll().execute();
  return { ...run, criterionResults, evidenceSpans, overrides };
}

/**
 * Teacher override — shadow natijasi qayd qilinadi, final faqat teacher.
 * @param {Object} params - { runId, workItemId, aiTotalScore, overriddenScore, reason, teacherId }
 */
export async function saveAiOverride({ runId, workItemId = null, aiTotalScore, overriddenScore, reason = '', teacherId = null } = {}) {
  if (!runId) throw new Error('runId is required');
  if (aiTotalScore === undefined || overriddenScore === undefined) throw new Error('aiTotalScore and overriddenScore are required');
  if (!teacherId) throw new Error('teacherId is required (human)');
  shadowNeverChangesFinal(); // advisory-only guard
  const db = await getDb();
  if (!db) throw new Error('PostgreSQL required');
  const row = await db
    .insertInto('ai_human_overrides')
    .values({
      tenant_id: getTenantId(),
      run_id: Number(runId),
      work_item_id: workItemId ? Number(workItemId) : null,
      ai_total_score: Number(aiTotalScore),
      overridden_score: Number(overriddenScore),
      reason: String(reason || '').slice(0, 1000),
      teacher_id: Number(teacherId),
    })
    .returning(['id', 'ai_total_score', 'overridden_score', 'created_at'])
    .executeTakeFirst();
  await audit({ action: AUDIT_ACTIONS.AI_OVERRIDE, userId: teacherId, metadata: { runId: Number(runId), overriddenScore } });
  return { ok: true, override: row };
}

// ═══════════════════════════════════════════════════════════════════
// METRICS (shadow comparison)
// ═══════════════════════════════════════════════════════════════════

/**
 * Compute AI-vs-human comparison metrics for a job (QWK/exact/within-one/MAE).
 * @param {Object} params - { jobId, pairs: [{ ai, human }] }
 */
export async function computeJobComparison({ jobId, pairs = [] } = {}) {
  if (!pairs || pairs.length === 0) return { ok: true, metrics: null, pairs: 0 };
  const aiScores = pairs.map((p) => Number(p.ai));
  const humanScores = pairs.map((p) => Number(p.human));
  const metrics = compareAiHuman({ aiScores, humanScores });
  const db = await getDb();
  if (db && jobId) {
    await db
      .updateTable('ai_grading_jobs')
      .set({ total_score: metrics.mae, updated_at: new Date() })
      .where('id', '=', Number(jobId))
      .execute();
  }
  return { ok: true, metrics, pairs: pairs.length };
}
