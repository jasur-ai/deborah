/**
 * Deborah — Quiz-from-Deck (service)
 *
 * Prompt 59 — "Create quiz from this deck" (research.md §10):
 *   - generateQuizFromDeck: canonical deck + source packs → concepts →
 *     50/30/20 blueprint → questions (har savolda citation) → draft job
 *     (idempotent request_hash). AI savol teacher approval'siz bankka
 *     publish qilinmaydi (§22.18).
 *   - approveQuiz: teacher approval → APPROVED.
 *   - publishQuiz: APPROVED → PUBLISHED → item bank item'lari (item_ids).
 *   - listQuizJobs / getQuizJob.
 */

import { getDb } from '../../infrastructure/postgres.js';
import { getCurrentTenant } from '../auth/tenant-context.js';
import { audit, AUDIT_ACTIONS } from '../auth/audit.js';
import {
  extractQuizConcepts,
  buildQuizBlueprint,
  generateQuestionsFromDeck,
  markNeedsReview,
  validateQuizDraft,
  validateQuizStatusTransition,
  buildQuizRequestHash,
  QUIZ_STATUS,
  DEFAULT_BLUEPRINT,
} from './quiz-deck.schema.js';

/** Parse jsonb value that may be a string (fake DB) or object (real PG). */
function parseJson(v) {
  if (v == null) return null;
  if (typeof v === 'object') return v;
  try {
    return JSON.parse(v);
  } catch (_) {
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════════
// GENERATE — §59-13
// ═══════════════════════════════════════════════════════════════════

/**
 * Generate a quiz from a canonical deck (idempotent).
 * @param {Object} params - { presentationId, versionId, document, sourcePacks, previousDocument, total, actorId }
 */
export async function generateQuizFromDeck({
  presentationId = null,
  versionId = null,
  document = null,
  sourcePacks = [],
  previousDocument = null,
  total = null,
  actorId = null,
} = {}) {
  if (!presentationId || !versionId) return { ok: false, error: 'presentationId and versionId are required' };
  if (!document || !Array.isArray(document.slides)) return { ok: false, error: 'canonical document required' };

  const db = getDb();
  if (!db) return { ok: false, error: 'PostgreSQL required' };
  const tenantId = getCurrentTenant()?.id;
  if (!tenantId) return { ok: false, error: 'tenant context is required' };

  const hash = buildQuizRequestHash({ presentationId, versionId });

  // Idempotency — existing job qaytariladi
  const existing = await db
    .selectFrom('deck_quiz_jobs')
    .selectAll()
    .where('tenant_id', '=', tenantId)
    .where('request_hash', '=', hash)
    .executeTakeFirst();
  if (existing) return { ok: true, jobId: existing.id, cached: true, status: existing.status };

  // 1. Concepts (slide title emas — source pack + quizConcepts, §10)
  const conceptsR = extractQuizConcepts({ document });
  if (!conceptsR.ok) return { ok: false, error: conceptsR.reason };

  // 2. Blueprint — 50/30/20 default
  const qTotal = Number.isInteger(total) && total > 0 ? total : conceptsR.concepts.length;
  const bpR = buildQuizBlueprint({ total: qTotal });
  if (!bpR.ok) return { ok: false, error: bpR.reason };

  // 3. Questions (har savolda source citation)
  const gen = generateQuestionsFromDeck({ concepts: conceptsR.concepts, blueprint: bpR.blueprint, sourcePacks });
  if (!gen.ok) return { ok: false, error: gen.reason };

  // 4. Needs-review (claim o'zgarsa)
  const nr = markNeedsReview({ previousDocument, currentDocument: document, questions: gen.questions });

  // 5. Validate draft (teacher approval oldidan)
  const dv = validateQuizDraft({ questions: gen.questions, blueprint: bpR.blueprint });
  if (!dv.ok) return { ok: false, error: dv.reason };

  // 6. Persist job (DRAFT — publish emas)
  const jobStatus = nr.needsReview.length ? QUIZ_STATUS.NEEDS_REVIEW : QUIZ_STATUS.DRAFT;
  const row = await db
    .insertInto('deck_quiz_jobs')
    .values({
      tenant_id: tenantId,
      presentation_id: presentationId,
      version_id: versionId,
      request_hash: hash,
      status: jobStatus,
      blueprint: JSON.stringify(bpR.blueprint),
      questions: JSON.stringify(gen.questions),
      item_ids: JSON.stringify([]),
      needs_review: JSON.stringify(nr.needsReview),
      created_by: actorId,
    })
    .returning(['id'])
    .executeTakeFirst();

  await audit(AUDIT_ACTIONS.QUIZ_GENERATE, {
    actorId,
    tenantId,
    detail: { presentationId, versionId, total: gen.questions.length, status: jobStatus, needsReview: nr.needsReview.length },
  });
  return { ok: true, jobId: row.id, cached: false, status: jobStatus, questions: gen.questions, blueprint: bpR.blueprint, needsReview: nr.needsReview };
}

// ═══════════════════════════════════════════════════════════════════
// APPROVE / PUBLISH — §22.18
// ═══════════════════════════════════════════════════════════════════

/** Teacher approval — draft/needs_review → approved. */
export async function approveQuiz({ jobId = null, actorId = null } = {}) {
  if (!jobId) return { ok: false, error: 'jobId is required' };
  const db = getDb();
  if (!db) return { ok: false, error: 'PostgreSQL required' };
  const tenantId = getCurrentTenant()?.id;
  if (!tenantId) return { ok: false, error: 'tenant context is required' };

  const job = await db
    .selectFrom('deck_quiz_jobs')
    .selectAll()
    .where('tenant_id', '=', tenantId)
    .where('id', '=', jobId)
    .executeTakeFirst();
  if (!job) return { ok: false, error: 'quiz job not found' };

  const v = validateQuizStatusTransition(job.status, QUIZ_STATUS.APPROVED);
  if (!v.ok) return { ok: false, error: v.reason };

  await db.updateTable('deck_quiz_jobs')
    .set({ status: QUIZ_STATUS.APPROVED, teacher_reviewed_at: new Date(), teacher_reviewed_by: actorId, updated_at: new Date() })
    .where('id', '=', job.id)
    .execute();

  await audit(AUDIT_ACTIONS.QUIZ_APPROVE, { actorId, tenantId, detail: { jobId: job.id, presentationId: job.presentation_id } });
  return { ok: true, status: QUIZ_STATUS.APPROVED };
}

/**
 * Publish approved quiz — creates item bank items (teacher approval
 * siz publish qilinmaydi — §22.18) and stores item_ids.
 */
export async function publishQuiz({ jobId = null, actorId = null } = {}) {
  if (!jobId) return { ok: false, error: 'jobId is required' };
  const db = getDb();
  if (!db) return { ok: false, error: 'PostgreSQL required' };
  const tenantId = getCurrentTenant()?.id;
  if (!tenantId) return { ok: false, error: 'tenant context is required' };

  const job = await db
    .selectFrom('deck_quiz_jobs')
    .selectAll()
    .where('tenant_id', '=', tenantId)
    .where('id', '=', jobId)
    .executeTakeFirst();
  if (!job) return { ok: false, error: 'quiz job not found' };

  const v = validateQuizStatusTransition(job.status, QUIZ_STATUS.PUBLISHED);
  if (!v.ok) return { ok: false, error: v.reason };

  // Persist item_ids (MVP: metadata — haqiqiy item bank create keyingi
  // integration; teacher approval allaqachon bo'lgan)
  const questions = parseJson(job.questions) || [];
  const itemIds = questions.map((q, i) => `qti_${job.id}_${i + 1}`);

  await db.updateTable('deck_quiz_jobs')
    .set({
      status: QUIZ_STATUS.PUBLISHED,
      item_ids: JSON.stringify(itemIds),
      teacher_reviewed_at: job.teacher_reviewed_at || new Date(),
      updated_at: new Date(),
    })
    .where('id', '=', job.id)
    .execute();

  await audit(AUDIT_ACTIONS.QUIZ_PUBLISH, {
    actorId,
    tenantId,
    detail: { jobId: job.id, presentationId: job.presentation_id, itemCount: itemIds.length },
  });
  return { ok: true, status: QUIZ_STATUS.PUBLISHED, itemIds };
}

// ═══════════════════════════════════════════════════════════════════
// READ + META
// ═══════════════════════════════════════════════════════════════════

/** List quiz jobs (tenant-scoped). */
export async function listQuizJobs({ status = null, limit = 50 } = {}) {
  const db = getDb();
  if (!db) return [];
  const tenantId = getCurrentTenant()?.id;
  if (!tenantId) return [];
  let q = db.selectFrom('deck_quiz_jobs').selectAll().where('tenant_id', '=', tenantId);
  if (status) q = q.where('status', '=', status);
  return q.orderBy('created_at', 'desc').limit(limit).execute();
}

/** Get a quiz job (tenant-scoped). */
export async function getQuizJob(id) {
  const db = getDb();
  if (!db) return null;
  const tenantId = getCurrentTenant()?.id;
  if (!tenantId) return null;
  return db
    .selectFrom('deck_quiz_jobs')
    .selectAll()
    .where('tenant_id', '=', tenantId)
    .where('id', '=', id)
    .executeTakeFirst();
}

export const QUIZ_META = {
  statuses: QUIZ_STATUS,
  defaultBlueprint: DEFAULT_BLUEPRINT,
};
