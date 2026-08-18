/**
 * Deborah — AI Evaluation, MLOps & Rollback (DB service)
 *
 * Prompt 52 — golden set, deployment gate, drift va model rollbackni
 * production boshqaruviga aylantirish. Graceful degradation (PostgreSQL
 * absent in CI): write path'lar 'PostgreSQL required' throw qiladi,
 * read path'lar []/null. Har bir write path tenant-scoped + idempotent
 * (UNIQUE index'lar).
 *
 * SECURITY / DATA GUARD (Prompt 52 §15-17):
 *   - Golden set trainingga qo'shilmaydi (holdout — eval only).
 *   - Old final grade silent regrade qilinmaydi — rollback faqat model
 *     status'ni o'zgartiradi, existing final'ni qayta yozmaydi.
 *   - Model version pin/allowlist — faqat allowlisted version production.
 *   - Kill-switch — drift bo'lsa auto-disable + audit trail.
 */

import { getDb } from '../../infrastructure/postgres.js';
import { getCurrentTenant } from '../auth/tenant-context.js';
import { audit, AUDIT_ACTIONS } from '../auth/audit.js';
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
  AI_DATASET_STATUS,
  AI_EVAL_RUN_STATUS,
  AI_GATE_STAGE,
  AI_GATE_DECISION,
  AI_ROLLBACK_ACTION,
} from './ai-mlops.schema.js';

function getTenantId() {
  return getCurrentTenant()?.tenantId || 1;
}

// ═══════════════════════════════════════════════════════════════════
// MODEL REGISTRY
// ═══════════════════════════════════════════════════════════════════

/** Register a model in the registry. */
export async function registerAiModel({ name, provider = 'unknown', version, createdBy = null } = {}) {
  if (!name || typeof name !== 'string' || !name.trim()) throw new Error('name is required');
  if (name.length > 64) throw new Error('name exceeds 64 chars');
  if (!version || typeof version !== 'string' || !version.trim()) {
    throw new Error('version is required (stop condition: exact version pin)');
  }
  if (version.length > 32) throw new Error('version exceeds 32 chars');
  const db = await getDb();
  if (!db) throw new Error('PostgreSQL required');
  const row = await db
    .insertInto('ai_models')
    .values({
      tenant_id: getTenantId(),
      name: name.trim(),
      provider: String(provider).slice(0, 32),
      version: version.trim(),
      status: AI_MODEL_STATUS.DRAFT,
      allowlisted: false,
      created_by: createdBy,
    })
    .onConflict((oc) => oc.columns(['tenant_id', 'name', 'version']).doNothing())
    .returning(['id', 'name', 'provider', 'version', 'status', 'allowlisted', 'created_at'])
    .executeTakeFirst();
  if (!row) throw new Error('model with this name+version already registered');
  await audit({ action: AUDIT_ACTIONS.AI_MODEL_REGISTER, userId: createdBy, metadata: { modelId: row.id, name, version } });
  return { ok: true, model: row };
}

/** List models (tenant-scoped). */
export async function listAiModels({ status = null } = {}) {
  const db = await getDb();
  if (!db) return [];
  let q = db.selectFrom('ai_models').where('tenant_id', '=', getTenantId());
  if (status) q = q.where('status', '=', status);
  return await q.orderBy('created_at', 'desc').selectAll().execute();
}

/** Get a single model (tenant-scoped). */
export async function getAiModel(id) {
  if (!id) return null;
  const db = await getDb();
  if (!db) return null;
  return await db.selectFrom('ai_models').where('id', '=', Number(id)).where('tenant_id', '=', getTenantId()).selectAll().executeTakeFirst();
}

/**
 * Pin a model version (deployment gate) — bitta active pin per model.
 * @param {Object} params - { modelId, modelVersion, pinnedBy }
 */
export async function pinAiModel({ modelId, modelVersion, pinnedBy = null } = {}) {
  if (!modelId) throw new Error('modelId is required');
  if (!modelVersion || typeof modelVersion !== 'string') throw new Error('modelVersion is required (exact pin)');
  const db = await getDb();
  if (!db) throw new Error('PostgreSQL required');
  const model = await getAiModel(Number(modelId));
  if (!model) throw new Error('Model not found');
  // Pin only allowlisted + active (deployment gate passed)
  const v = validateModelPin({ model: model.name, version: modelVersion, allowlisted: model.allowlisted, status: model.status });
  if (!v.ok) throw new Error(v.reason);
  const row = await db
    .insertInto('ai_model_pins')
    .values({
      tenant_id: getTenantId(),
      model_id: Number(modelId),
      model_version: String(modelVersion).slice(0, 32),
      pinned_by: pinnedBy,
    })
    .onConflict((oc) => oc.columns(['tenant_id', 'model_id']).doUpdate((eb) => ({
      model_version: eb.ref('excluded.model_version'),
      pinned_by: eb.ref('excluded.pinned_by'),
      pinned_at: new Date(),
    })))
    .returning(['id', 'model_id', 'model_version', 'pinned_at'])
    .executeTakeFirst();
  await audit({ action: AUDIT_ACTIONS.AI_MODEL_PIN, userId: pinnedBy, metadata: { modelId: Number(modelId), modelVersion } });
  return { ok: true, pin: row };
}

/**
 * Toggle allowlist on a model (manual admin action after gate passes).
 * @param {Object} params - { modelId, allowlisted, actorId }
 */
export async function setAiModelAllowlist({ modelId, allowlisted = false, actorId = null } = {}) {
  if (!modelId) throw new Error('modelId is required');
  const db = await getDb();
  if (!db) throw new Error('PostgreSQL required');
  const updated = await db
    .updateTable('ai_models')
    .set({ allowlisted: Boolean(allowlisted), updated_at: new Date() })
    .where('id', '=', Number(modelId))
    .where('tenant_id', '=', getTenantId())
    .returning(['id', 'name', 'version', 'allowlisted', 'status'])
    .executeTakeFirst();
  if (!updated) throw new Error('Model not found');
  await audit({ action: AUDIT_ACTIONS.AI_MODEL_ALLOWLIST, userId: actorId, metadata: { modelId: Number(modelId), allowlisted: Boolean(allowlisted) } });
  return { ok: true, model: updated };
}

/**
 * Set model status (activate/disable/retire).
 * @param {Object} params - { modelId, status, actorId }
 */
export async function setAiModelStatus({ modelId, status, actorId = null } = {}) {
  if (!modelId) throw new Error('modelId is required');
  if (!Object.values(AI_MODEL_STATUS).includes(status)) throw new Error(`invalid status ${status}`);
  const db = await getDb();
  if (!db) throw new Error('PostgreSQL required');
  const updated = await db
    .updateTable('ai_models')
    .set({ status, updated_at: new Date() })
    .where('id', '=', Number(modelId))
    .where('tenant_id', '=', getTenantId())
    .returning(['id', 'name', 'version', 'status', 'allowlisted'])
    .executeTakeFirst();
  if (!updated) throw new Error('Model not found');
  await audit({ action: AUDIT_ACTIONS.AI_MODEL_STATUS, userId: actorId, metadata: { modelId: Number(modelId), status } });
  return { ok: true, model: updated };
}

// ═══════════════════════════════════════════════════════════════════
// EVAL DATASETS (golden / adversarial — holdout)
// ═══════════════════════════════════════════════════════════════════

/** Create a golden/adversarial eval dataset (holdout by default). */
export async function createEvalDataset({ name, kind = AI_DATASET_KIND.GOLDEN, version = 'v1', holdout = true, createdBy = null } = {}) {
  if (!name || typeof name !== 'string' || !name.trim()) throw new Error('name is required');
  if (name.length > 160) throw new Error('name exceeds 160 chars');
  if (!Object.values(AI_DATASET_KIND).includes(kind)) throw new Error(`invalid kind ${kind}`);
  // Golden set trainingga qo'shilmaydi (§15)
  const guard = assertGoldenHoldout({ holdout, kind });
  if (!guard.ok) throw new Error(guard.reason);
  const db = await getDb();
  if (!db) throw new Error('PostgreSQL required');
  const row = await db
    .insertInto('ai_eval_datasets')
    .values({
      tenant_id: getTenantId(),
      name: name.trim(),
      version: String(version).slice(0, 16),
      kind,
      status: AI_DATASET_STATUS.DRAFT,
      holdout: Boolean(holdout),
      item_count: 0,
      created_by: createdBy,
    })
    .onConflict((oc) => oc.columns(['tenant_id', 'name', 'version']).doNothing())
    .returning(['id', 'name', 'version', 'kind', 'status', 'holdout', 'item_count', 'created_at'])
    .executeTakeFirst();
  if (!row) throw new Error('dataset with this name+version already exists');
  await audit({ action: AUDIT_ACTIONS.AI_DATASET_CREATE, userId: createdBy, metadata: { datasetId: row.id, name, kind } });
  return { ok: true, dataset: row };
}

/** List eval datasets (tenant-scoped). */
export async function listEvalDatasets({ kind = null } = {}) {
  const db = await getDb();
  if (!db) return [];
  let q = db.selectFrom('ai_eval_datasets').where('tenant_id', '=', getTenantId());
  if (kind) q = q.where('kind', '=', kind);
  return await q.orderBy('created_at', 'desc').selectAll().execute();
}

/**
 * Add an eval item to a dataset (idempotent by input_hash).
 * @param {Object} params - { datasetId, inputHash, goldScore, aiScore, subgroup, goldResponse }
 */
export async function addEvalItem({ datasetId, inputHash, goldScore, aiScore = null, subgroup = null, goldResponse = null } = {}) {
  if (!datasetId) throw new Error('datasetId is required');
  if (!inputHash || typeof inputHash !== 'string') throw new Error('inputHash is required');
  if (inputHash.length !== 64) throw new Error('inputHash must be a 64-char sha256');
  if (goldScore === undefined || goldScore === null || !Number.isFinite(Number(goldScore))) throw new Error('goldScore is required (human gold mark)');
  const db = await getDb();
  if (!db) throw new Error('PostgreSQL required');
  const row = await db
    .insertInto('ai_eval_items')
    .values({
      tenant_id: getTenantId(),
      dataset_id: Number(datasetId),
      input_hash: inputHash,
      gold_score: Number(goldScore),
      ai_score: aiScore === null || aiScore === undefined ? null : Number(aiScore),
      subgroup: subgroup ? String(subgroup).slice(0, 32) : null,
      gold_response: goldResponse ? String(goldResponse).slice(0, 4000) : null,
    })
    .onConflict((oc) => oc.columns(['tenant_id', 'dataset_id', 'input_hash']).doNothing())
    .returning(['id', 'dataset_id', 'input_hash', 'gold_score', 'subgroup'])
    .executeTakeFirst();
  if (row) {
    await db.updateTable('ai_eval_datasets').set({ item_count: db.raw('item_count + 1') }).where('id', '=', Number(datasetId)).execute();
  }
  return { ok: true, item: row, added: Boolean(row) };
}

/** List items in a dataset. */
export async function listEvalItems({ datasetId = null } = {}) {
  const db = await getDb();
  if (!db) return [];
  let q = db.selectFrom('ai_eval_items').where('tenant_id', '=', getTenantId());
  if (datasetId) q = q.where('dataset_id', '=', Number(datasetId));
  return await q.orderBy('id', 'asc').selectAll().execute();
}

// ═══════════════════════════════════════════════════════════════════
// EVALUATION RUN (metrics + gate + drift)
// ═══════════════════════════════════════════════════════════════════

/**
 * Run an evaluation on a dataset for a model (metrics snapshot).
 * PG'siz: dry-run natija qaytariladi (integration test uchun).
 *
 * @param {Object} params
 * @param {number} params.modelId
 * @param {number} params.datasetId
 * @param {Array<{ ai: number, gold: number, subgroup?: string, confidence?: number }>} [params.items]
 * @param {number} [params.overrides]
 * @param {string} [params.stage]
 * @param {string|null} [params.thresholdsJson]
 * @param {number|null} [params.actorId]
 */
export async function runAiEvaluation({
  modelId,
  datasetId,
  items = [],
  overrides = 0,
  stage = AI_GATE_STAGE.SHADOW,
  thresholdsJson = null,
  actorId = null,
} = {}) {
  if (!modelId) throw new Error('modelId is required');
  if (!datasetId) throw new Error('datasetId is required');
  if (!Array.isArray(items) || items.length === 0) throw new Error('items are required for evaluation');
  const aiScores = items.map((x) => Number(x.ai));
  const goldScores = items.map((x) => Number(x.gold));
  const metrics = computeEvalMetrics({ aiScores, goldScores });
  if (!metrics.ok) throw new Error(metrics.error);

  // Exact-match F1 — gold har bir item uchun ground truth (positive),
  // shuning uchun precision = 1 va F1 = 2·recall/(1+recall) = exact-match
  // darajasining monoton transformatsiyasi. Erkin "criterion F1" emas —
  // haqiqiy negative klass yo'qligi uchun ataylab shunday hujjatlanadi.
  let exact = 0;
  for (const it of items) {
    if (Number(it.gold) === Number(it.ai)) exact += 1;
  }
  const f1r = computeCriterionF1({ truePositive: exact, falsePositive: 0, falseNegative: items.length - exact });

  // Calibration (ECE) — confidence'lar berilgan bo'lsa
  let ece = null;
  const confItems = items.filter((x) => x.confidence !== undefined && x.confidence !== null);
  if (confItems.length > 0) {
    const confs = confItems.map((x) => Number(x.confidence));
    const outcomes = confItems.map((x) => (Number(x.gold) === Number(x.ai) ? 1 : 0));
    const cal = computeCalibrationEce({ confidences: confs, outcomes });
    ece = cal.ok ? cal.ece : null;
  }

  const overrideRate = computeOverrideRate({ overrides, total: items.length }).overrideRate;

  // Subgroup breakdown (fairness)
  const subgroups = computeSubgroupBreakdown({
    items: items.map((x) => ({ subgroup: x.subgroup || 'all', ai: Number(x.ai), gold: Number(x.gold) })),
  });

  // Deployment gate
  let thresholds = null;
  if (thresholdsJson) {
    try { thresholds = JSON.parse(thresholdsJson); } catch (_) { /* fallback to defaults */ }
  }
  const gate = evaluateGate({ stage, metrics: { qwk: metrics.qwk, ece, overrideRate }, thresholds });
  const gateQwkThreshold = thresholds?.qwk ?? GATE_DEFAULT_QWK_BASELINE;

  // Drift detection vs baseline (baseline = threshold or previous run)
  const drift = detectDrift({ metric: 'qwk', baseline: gateQwkThreshold, current: metrics.qwk });

  const run = {
    ok: true,
    dryRun: true,
    metrics: {
      qwk: metrics.qwk,
      mae: metrics.mae,
      rmse: metrics.rmse,
      exactAgreement: metrics.exactAgreement,
      withinOneAgreement: metrics.withinOneAgreement,
      f1: f1r.f1,
      ece,
      overrideRate,
      pairs: metrics.pairs,
    },
    f1Breakdown: f1r,
    subgroups: subgroups.groups,
    gate: { stage, decision: gate.decision, checks: gate.checks },
    drift,
  };

  const db = await getDb();
  if (db) {
    const row = await db
      .insertInto('ai_eval_runs')
      .values({
        tenant_id: getTenantId(),
        model_id: Number(modelId),
        dataset_id: Number(datasetId),
        status: AI_EVAL_RUN_STATUS.COMPLETED,
        qwk: metrics.qwk,
        mae: metrics.mae,
        f1: f1r.f1,
        ece,
        override_rate: overrideRate,
        exact_agreement: metrics.exactAgreement,
        items_evaluated: metrics.pairs,
        passed: gate.decision === AI_GATE_DECISION.APPROVED,
        threshold: gateQwkThreshold,
        drift_detected: drift.drifted,
        notes: `gate:${gate.decision}`,
        created_by: actorId,
        completed_at: new Date(),
      })
      .returning(['id', 'status', 'qwk', 'mae', 'f1', 'ece', 'passed', 'drift_detected'])
      .executeTakeFirst();
    run.runId = row?.id || null;
    run.dryRun = false;

    if (row) {
      // Subgroup metrics
      for (const g of subgroups.groups) {
        await db
          .insertInto('ai_subgroup_metrics')
          .values({
            tenant_id: getTenantId(),
            run_id: row.id,
            subgroup: g.subgroup,
            n: g.n,
            qwk: g.qwk,
            mae: g.mae,
            exact_agreement: g.exactAgreement,
          })
          .onConflict((oc) => oc.columns(['tenant_id', 'run_id', 'subgroup']).doNothing())
          .execute();
      }
      // Gate decision record
      await db
        .insertInto('ai_gate_decisions')
        .values({
          tenant_id: getTenantId(),
          model_id: Number(modelId),
          run_id: row.id,
          stage,
          decision: gate.decision,
          threshold: thresholds?.qwk ?? null,
          actual: metrics.qwk,
          reason: gate.checks.filter((c) => !c.ok).map((c) => `${c.name}: ${c.actual} vs ${c.threshold}`).join('; ') || 'all checks passed',
          decided_by: actorId,
          decided_at: new Date(),
        })
        .onConflict((oc) => oc.columns(['tenant_id', 'model_id', 'stage']).doUpdate((eb) => ({
          decision: eb.ref('excluded.decision'),
          run_id: eb.ref('excluded.run_id'),
          actual: eb.ref('excluded.actual'),
          reason: eb.ref('excluded.reason'),
          decided_at: new Date(),
        })))
        .execute();
      // Drift event
      if (drift.drifted) {
        await db
          .insertInto('ai_drift_events')
          .values({
            tenant_id: getTenantId(),
            model_id: Number(modelId),
            run_id: row.id,
            metric: 'qwk',
            baseline: drift.baseline ?? null,
            current: metrics.qwk,
            severity: drift.severity,
            window_start: new Date(Date.now() - 7 * 86400000),
            window_end: new Date(),
          })
          .execute();
      }
      await audit({ action: AUDIT_ACTIONS.AI_EVAL_RUN, userId: actorId, metadata: { runId: row.id, qwk: metrics.qwk, gate: gate.decision } });
    }
  }
  return run;
}  // Baseline fallback for drift (used when no threshold provided)
  const GATE_DEFAULT_QWK_BASELINE = 0.8;


// ═══════════════════════════════════════════════════════════════════
// ROLLBACK / KILL SWITCH
// ═══════════════════════════════════════════════════════════════════

/**
 * Execute a kill-switch rollback/disable. Immutable final guard:
 * existing final grades NEVER rewritten (§15).
 *
 * @param {Object} params - { modelId, action, reason, triggeredBy, actorId }
 */
export async function executeAiRollback({ modelId, action = AI_ROLLBACK_ACTION.DISABLE, reason = '', triggeredBy = 'manual', actorId = null } = {}) {
  if (!modelId) throw new Error('modelId is required');
  const db = await getDb();
  if (!db) throw new Error('PostgreSQL required');
  const model = await getAiModel(Number(modelId));
  if (!model) throw new Error('Model not found');
  const plan = planRollback({ action, fromStatus: model.status, reason });
  if (!plan.ok) throw new Error(plan.reason);
  const updated = await db
    .updateTable('ai_models')
    // Rollback/disable/retire — har doim allowlistni ham olib tashlaymiz:
    // disabled+allowlisted ziddiyat (validateModelPin talabiga ko'ra)
    .set({ status: plan.toStatus, allowlisted: false, updated_at: new Date() })
    .where('id', '=', Number(modelId))
    .where('tenant_id', '=', getTenantId())
    .returning(['id', 'name', 'version', 'status', 'allowlisted'])
    .executeTakeFirst();
  const event = await db
    .insertInto('ai_rollback_events')
    .values({
      tenant_id: getTenantId(),
      model_id: Number(modelId),
      action,
      reason: String(reason || '').slice(0, 1000),
      triggered_by: String(triggeredBy).slice(0, 12),
      from_status: model.status,
      to_status: plan.toStatus,
      runbook_ref: plan.runbookRef,
      actor_id: actorId,
    })
    .returning(['id', 'action', 'from_status', 'to_status', 'runbook_ref'])
    .executeTakeFirst();
  await audit({
    action: AUDIT_ACTIONS.AI_ROLLBACK,
    userId: actorId,
    metadata: { modelId: Number(modelId), action, toStatus: plan.toStatus, runbookRef: plan.runbookRef, immutableFinal: plan.immutableFinal },
  });
  return { ok: true, model: updated, event, immutableFinal: plan.immutableFinal };
}

// ═══════════════════════════════════════════════════════════════════
// DASHBOARD (override / drift / cost)
// ═══════════════════════════════════════════════════════════════════

/** Aggregate dashboard data for the admin MLOps page. */
export async function getAiMlopsDashboard({ modelId = null } = {}) {
  const db = await getDb();
  if (!db) return { ok: true, dryRun: true, models: [], datasets: [], runs: [], gates: [], drift: [], rollbacks: [] };
  const tenant = getTenantId();
  const models = modelId
    ? await db.selectFrom('ai_models').where('tenant_id', '=', tenant).where('id', '=', Number(modelId)).selectAll().execute()
    : await db.selectFrom('ai_models').where('tenant_id', '=', tenant).orderBy('created_at', 'desc').limit(50).selectAll().execute();
  const datasets = await db.selectFrom('ai_eval_datasets').where('tenant_id', '=', tenant).orderBy('created_at', 'desc').limit(50).selectAll().execute();
  let runs = await db.selectFrom('ai_eval_runs').where('tenant_id', '=', tenant).orderBy('created_at', 'desc').limit(50).selectAll().execute();
  let gates = await db.selectFrom('ai_gate_decisions').where('tenant_id', '=', tenant).orderBy('created_at', 'desc').limit(50).selectAll().execute();
  let drift = await db.selectFrom('ai_drift_events').where('tenant_id', '=', tenant).orderBy('created_at', 'desc').limit(50).selectAll().execute();
  let rollbacks = await db.selectFrom('ai_rollback_events').where('tenant_id', '=', tenant).orderBy('created_at', 'desc').limit(50).selectAll().execute();
  if (modelId) {
    runs = runs.filter((r) => Number(r.model_id) === Number(modelId));
    gates = gates.filter((g) => Number(g.model_id) === Number(modelId));
    drift = drift.filter((d) => Number(d.model_id) === Number(modelId));
    rollbacks = rollbacks.filter((r) => Number(r.model_id) === Number(modelId));
  }
  return { ok: true, dryRun: false, models, datasets, runs, gates, drift, rollbacks };
}
