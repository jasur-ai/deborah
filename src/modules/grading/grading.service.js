/**
 * Deborah — Academic Grade Rules & Deterministic Calculation Service
 *
 * DB layer for Prompt 45 (research.md §18 GradingService, §72):
 *   - Versioned rule CRUD: draft → approved (immutable once approved —
 *     edits create a NEW version), archived.
 *   - Deterministic calculation runs: input snapshot (component scores +
 *     semantics) → output snapshot (raw/moderated/adjusted/final layers +
 *     breakdown) → final grade as DECIMAL (never float) + grade label.
 *   - Idempotency: rule_hash UNIQUE per version, run_hash UNIQUE per run —
 *     re-running the same (rule, input) returns the existing run.
 *   - Old-rule-version reproducibility: runs pin rule_version_id, so
 *     historical grades recompute EXACTLY.
 *
 * Graceful degradation: without PostgreSQL write paths throw a clear
 * error, read paths return null/[] (consistent with the platform).
 */

import { getDb } from '../../infrastructure/postgres.js';
import { getCurrentTenant } from '../auth/tenant-context.js';
import { audit, AUDIT_ACTIONS } from '../auth/audit.js';
import {
  RULE_STATUS,
  validateRuleDsl,
  hashRuleDsl,
  calculateGrade,
  computeRunHash,
  humanizeBreakdown,
} from './grading.schema.js';

const PG_UNIQUE_VIOLATION = '23505';

function getTenantId() {
  return getCurrentTenant()?.tenantId || 1;
}

// ═══════════════════════════════════════════════════════════════════
// RULE CRUD (versioned)
// ═══════════════════════════════════════════════════════════════════

/**
 * Create a grade rule with its FIRST version (draft).
 *
 * @param {Object} opts
 * @param {string} opts.name
 * @param {Object} opts.ruleDsl - validated DSL
 * @param {number|null} [opts.assessmentId]
 * @param {number|null} [opts.courseOfferingId]
 * @param {string} [opts.description]
 * @param {number|null} [opts.createdBy]
 */
export async function createGradeRule({ name = '', ruleDsl = null, assessmentId = null, courseOfferingId = null, description = '', createdBy = null } = {}) {
  if (!name) throw new Error('name is required');
  const v = validateRuleDsl(ruleDsl);
  if (!v.ok) throw new Error(v.error);
  const ruleHash = hashRuleDsl(ruleDsl);

  const db = await getDb();
  if (!db) throw new Error('PostgreSQL required');

  try {
    const rule = await db.insertInto('academic_grade_rules')
      .values({
        tenant_id: getTenantId(),
        assessment_id: assessmentId,
        course_offering_id: courseOfferingId,
        name,
        status: RULE_STATUS.DRAFT,
        current_version: 1,
        description: description ? String(description).slice(0, 1000) : null,
        created_by: createdBy || null,
      })
      .returning(['id', 'name', 'status', 'current_version'])
      .executeTakeFirst();

    const version = await db.insertInto('academic_grade_rule_versions')
      .values({
        tenant_id: getTenantId(),
        rule_id: rule.id,
        version_no: 1,
        rule_dsl: JSON.stringify(ruleDsl),
        rule_hash: ruleHash,
        status: RULE_STATUS.DRAFT,
        created_by: createdBy || null,
      })
      .returning(['id', 'version_no', 'rule_hash'])
      .executeTakeFirst();

    await audit({
      action: AUDIT_ACTIONS.GRADE_RULE_CREATE,
      userId: createdBy,
      resourceType: 'academic_grade_rule',
      resourceId: rule.id,
      details: { name, version: 1, ruleHash: ruleHash.slice(0, 12) },
    }).catch(() => {});
    return { ok: true, rule, version };
  } catch (err) {
    if (err?.code === PG_UNIQUE_VIOLATION) {
      // Same rule_hash already exists (idempotent by content)
      const existing = await db.selectFrom('academic_grade_rule_versions')
        .where('tenant_id', '=', getTenantId())
        .where('rule_hash', '=', ruleHash)
        .selectAll()
        .executeTakeFirst();
      if (existing) {
        return { ok: true, idempotent: true, ruleId: existing.rule_id, version: existing };
      }
    }
    throw err;
  }
}

/**
 * Create a NEW version of a rule (approved rules are immutable — edits
 * always fork a new version).
 *
 * @param {Object} opts
 * @param {number} opts.ruleId
 * @param {Object} opts.ruleDsl
 * @param {number|null} [opts.createdBy]
 */
export async function createRuleVersion({ ruleId, ruleDsl = null, createdBy = null } = {}) {
  if (!ruleId) throw new Error('ruleId is required');
  const v = validateRuleDsl(ruleDsl);
  if (!v.ok) throw new Error(v.error);
  const ruleHash = hashRuleDsl(ruleDsl);

  const db = await getDb();
  if (!db) throw new Error('PostgreSQL required');

  const rule = await db.selectFrom('academic_grade_rules')
    .where('id', '=', Number(ruleId))
    .where('tenant_id', '=', getTenantId())
    .selectAll()
    .executeTakeFirst();
  if (!rule) throw new Error('Grade rule not found');

  // If the new DSL is identical to the current version → idempotent no-op
  const current = await db.selectFrom('academic_grade_rule_versions')
    .where('tenant_id', '=', getTenantId())
    .where('rule_id', '=', Number(ruleId))
    .where('version_no', '=', rule.current_version)
    .selectAll()
    .executeTakeFirst();
  if (current && current.rule_hash === ruleHash) {
    return { ok: true, idempotent: true, version: current };
  }

  const nextVersion = Number(rule.current_version) + 1;
  const version = await db.insertInto('academic_grade_rule_versions')
    .values({
      tenant_id: getTenantId(),
      rule_id: Number(ruleId),
      version_no: nextVersion,
      rule_dsl: JSON.stringify(ruleDsl),
      rule_hash: ruleHash,
      status: RULE_STATUS.DRAFT,
      created_by: createdBy || null,
    })
    .returning(['id', 'version_no', 'rule_hash'])
    .executeTakeFirst();

  await db.updateTable('academic_grade_rules')
    .set({ current_version: nextVersion, updated_at: new Date() })
    .where('id', '=', Number(ruleId))
    .execute();

  await audit({
    action: AUDIT_ACTIONS.GRADE_RULE_VERSION,
    userId: createdBy,
    resourceType: 'academic_grade_rule',
    resourceId: Number(ruleId),
    details: { versionNo: nextVersion, ruleHash: ruleHash.slice(0, 12) },
  }).catch(() => {});
  return { ok: true, version };
}

/**
 * Approve a rule version — becomes IMMUTABLE (further edits fork new
 * versions). Privileged + audited.
 *
 * @param {Object} opts
 * @param {number} opts.versionId
 * @param {number|null} [opts.approvedBy]
 */
export async function approveRuleVersion({ versionId, approvedBy = null } = {}) {
  if (!versionId) throw new Error('versionId is required');
  const db = await getDb();
  if (!db) throw new Error('PostgreSQL required');

  const version = await db.selectFrom('academic_grade_rule_versions')
    .where('id', '=', Number(versionId))
    .where('tenant_id', '=', getTenantId())
    .selectAll()
    .executeTakeFirst();
  if (!version) throw new Error('Rule version not found');
  if (version.status === RULE_STATUS.APPROVED) {
    return { ok: true, idempotent: true, version };
  }

  const row = await db.updateTable('academic_grade_rule_versions')
    .set({ status: RULE_STATUS.APPROVED, approved_at: new Date(), approved_by: approvedBy || null })
    .where('id', '=', Number(versionId))
    .returning(['id', 'version_no', 'status'])
    .executeTakeFirst();

  await db.updateTable('academic_grade_rules')
    .set({ status: RULE_STATUS.APPROVED, updated_at: new Date() })
    .where('id', '=', version.rule_id)
    .execute();

  await audit({
    action: AUDIT_ACTIONS.GRADE_RULE_APPROVE,
    userId: approvedBy,
    resourceType: 'academic_grade_rule_version',
    resourceId: Number(versionId),
    details: { ruleId: version.rule_id, versionNo: version.version_no },
  }).catch(() => {});
  return { ok: true, version: row };
}

export async function getGradeRule(id) {
  const db = await getDb();
  if (!db) return null;
  return db.selectFrom('academic_grade_rules')
    .where('id', '=', Number(id))
    .where('tenant_id', '=', getTenantId())
    .selectAll()
    .executeTakeFirst();
}

export async function listGradeRules({ status } = {}) {
  const db = await getDb();
  if (!db) return [];
  let q = db.selectFrom('academic_grade_rules')
    .where('tenant_id', '=', getTenantId())
    .orderBy('created_at', 'desc')
    .limit(100);
  if (status) q = q.where('status', '=', status);
  return q.selectAll().execute();
}

export async function listRuleVersions({ ruleId } = {}) {
  const db = await getDb();
  if (!db) return [];
  return db.selectFrom('academic_grade_rule_versions')
    .where('tenant_id', '=', getTenantId())
    .where('rule_id', '=', Number(ruleId))
    .orderBy('version_no', 'desc')
    .selectAll()
    .execute();
}

// ═══════════════════════════════════════════════════════════════════
// DETERMINISTIC CALCULATION RUNS
// ═══════════════════════════════════════════════════════════════════

/**
 * Run a deterministic grade calculation for an approved rule version.
 * Idempotent: same (rule_version_id, canonical input) → existing run.
 *
 * @param {Object} opts
 * @param {number} opts.ruleVersionId
 * @param {number} opts.userId
 * @param {Array<Object>} opts.components - [{ key, raw_score, status }]
 * @param {number|null} [opts.attemptId]
 * @param {Object} [opts.context] - { lateMinutes, attemptNumber }
 * @param {number|null} [opts.createdBy]
 */
export async function runGradeCalculation({ ruleVersionId, userId, components = [], attemptId = null, context = {}, createdBy = null } = {}) {
  if (!ruleVersionId || !userId) throw new Error('ruleVersionId and userId are required');
  if (!Array.isArray(components) || components.length === 0) {
    throw new Error('components is required');
  }
  const db = await getDb();
  if (!db) throw new Error('PostgreSQL required');

  const version = await db.selectFrom('academic_grade_rule_versions')
    .where('id', '=', Number(ruleVersionId))
    .where('tenant_id', '=', getTenantId())
    .selectAll()
    .executeTakeFirst();
  if (!version) throw new Error('Rule version not found');
  if (version.status !== RULE_STATUS.APPROVED) {
    throw new Error('Rule version must be approved before calculation');
  }

  const dsl = typeof version.rule_dsl === 'string' ? JSON.parse(version.rule_dsl) : version.rule_dsl;
  const runHash = computeRunHash({ ruleHash: version.rule_hash, components });

  // Idempotent replay — same hash returns existing run
  const existing = await db.selectFrom('grade_calculation_runs')
    .where('tenant_id', '=', getTenantId())
    .where('run_hash', '=', runHash)
    .selectAll()
    .executeTakeFirst();
  if (existing) {
    await audit({
      action: AUDIT_ACTIONS.GRADE_CALCULATE,
      userId: createdBy,
      resourceType: 'grade_calculation_run',
      resourceId: existing.id,
      details: { runHash: runHash.slice(0, 12), idempotent: true },
    }).catch(() => {});
    // Idempotent replay — derive the human-readable breakdown from the
    // stored output snapshot so the UI never shows 'undefined'.
    const out = typeof existing.output_snapshot === 'string'
      ? JSON.parse(existing.output_snapshot)
      : existing.output_snapshot;
    return {
      ok: true, idempotent: true, run: existing,
      breakdown: humanizeBreakdown({ finalGrade: Number(existing.final_grade), gradeLabel: existing.grade_label, breakdown: out?.breakdown || [], notes: out?.notes || [] }),
      layers: out?.layers || null,
    };
  }

  const result = calculateGrade({ dsl, components, context });

  if (result.blocked) {
    // Blocked runs are NOT persisted — they are advisory previews only.
    return { ok: true, blocked: true, blockedReason: result.blockedReason, breakdown: result.breakdown };
  }

  const finalGrade = result.finalGrade;
  const run = await db.insertInto('grade_calculation_runs')
    .values({
      tenant_id: getTenantId(),
      rule_version_id: Number(ruleVersionId),
      attempt_id: attemptId,
      user_id: Number(userId),
      input_snapshot: JSON.stringify(components),
      output_snapshot: JSON.stringify({ layers: result.layers, breakdown: result.breakdown, notes: result.notes || [], context }),
      final_grade: finalGrade,
      grade_label: result.gradeLabel,
      run_hash: runHash,
      created_by: createdBy || null,
    })
    .returning(['id', 'final_grade', 'grade_label', 'run_hash'])
    .executeTakeFirst();

  await audit({
    action: AUDIT_ACTIONS.GRADE_CALCULATE,
    userId: createdBy,
    resourceType: 'grade_calculation_run',
    resourceId: run.id,
    details: { ruleVersionId, userId, finalGrade, gradeLabel: run.grade_label, runHash: runHash.slice(0, 12) },
  }).catch(() => {});
  return { ok: true, run, breakdown: humanizeBreakdown(result), layers: result.layers };
}

/**
 * Reproduce a run from a stored run (old-rule-version reproducibility):
 * re-runs the pinned rule version with the stored input snapshot and
 * verifies the final grade + run_hash match.
 *
 * @param {Object} opts
 * @param {number} opts.runId
 * @param {number|null} [opts.actorId]
 */
export async function reproduceRun({ runId, actorId = null } = {}) {
  if (!runId) throw new Error('runId is required');
  const db = await getDb();
  if (!db) throw new Error('PostgreSQL required');

  const run = await db.selectFrom('grade_calculation_runs')
    .where('id', '=', Number(runId))
    .where('tenant_id', '=', getTenantId())
    .selectAll()
    .executeTakeFirst();
  if (!run) throw new Error('Run not found');

  const version = await db.selectFrom('academic_grade_rule_versions')
    .where('id', '=', run.rule_version_id)
    .where('tenant_id', '=', getTenantId())
    .selectAll()
    .executeTakeFirst();
  if (!version) throw new Error('Rule version not found');

  const dsl = typeof version.rule_dsl === 'string' ? JSON.parse(version.rule_dsl) : version.rule_dsl;
  const input = typeof run.input_snapshot === 'string' ? JSON.parse(run.input_snapshot) : run.input_snapshot;
  // Persisted context (lateMinutes/attemptNumber) is stored in the output
  // snapshot so reproduction uses the SAME context as the original run.
  const out = typeof run.output_snapshot === 'string' ? JSON.parse(run.output_snapshot) : run.output_snapshot;
  const ctx = out?.context || {};
  const expectedHash = computeRunHash({ ruleHash: version.rule_hash, components: input, context: ctx });
  const result = calculateGrade({ dsl, components: input, context: ctx });

  const matches = expectedHash === run.run_hash && result.finalGrade === Number(run.final_grade);

  await audit({
    action: AUDIT_ACTIONS.GRADE_REPRODUCE,
    userId: actorId,
    resourceType: 'grade_calculation_run',
    resourceId: Number(runId),
    details: { matches, expectedHash: expectedHash.slice(0, 12) },
  }).catch(() => {});
  return { ok: true, matches, expectedHash, finalGrade: result.finalGrade, storedGrade: Number(run.final_grade) };
}

export async function getCalculationRun(id) {
  const db = await getDb();
  if (!db) return null;
  return db.selectFrom('grade_calculation_runs')
    .where('id', '=', Number(id))
    .where('tenant_id', '=', getTenantId())
    .selectAll()
    .executeTakeFirst();
}

export async function listCalculationRuns({ userId, attemptId } = {}) {
  const db = await getDb();
  if (!db) return [];
  let q = db.selectFrom('grade_calculation_runs')
    .where('tenant_id', '=', getTenantId())
    .orderBy('created_at', 'desc')
    .limit(100);
  if (userId) q = q.where('user_id', '=', Number(userId));
  if (attemptId) q = q.where('attempt_id', '=', Number(attemptId));
  return q.selectAll().execute();
}
