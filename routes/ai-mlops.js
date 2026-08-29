/**
 * Deborah — AI Evaluation, MLOps & Rollback Routes
 *
 * Prompt 52 REST API (admin — requireAdmin):
 *   - GET  /api/admin/ai-mlops/meta                 — constants for admin UI
 *   - POST /api/admin/ai-mlops/models               — register model
 *   - GET  /api/admin/ai-mlops/models               — list models
 *   - POST /api/admin/ai-mlops/models/:id/pin       — pin version (gate)
 *   - POST /api/admin/ai-mlops/models/:id/allowlist — toggle allowlist
 *   - POST /api/admin/ai-mlops/models/:id/status    — set status
 *   - POST /api/admin/ai-mlops/datasets             — create golden/adversarial dataset
 *   - GET  /api/admin/ai-mlops/datasets             — list datasets
 *   - POST /api/admin/ai-mlops/datasets/:id/items   — add eval item
 *   - GET  /api/admin/ai-mlops/datasets/:id/items   — list items
 *   - POST /api/admin/ai-mlops/evaluations          — run evaluation (gate + drift)
 *   - POST /api/admin/ai-mlops/rollback             — kill switch (disable/rollback/retire)
 *   - GET  /api/admin/ai-mlops/dashboard            — override/drift/cost dashboard
 *   - GET  /admin/ai-mlops                          — admin page
 *
 * Security (Prompt 52 §15-17):
 *   - requireAdmin barcha write path'da; actor id session'dan.
 *   - Golden set trainingga qo'shilmaydi (holdout — eval only).
 *   - Old final grade silent regrade qilinmaydi — rollback faqat model
 *     status'ni o'zgartiradi, existing final'ni qayta yozmaydi.
 *   - Model version pin/allowlist — faqat allowlisted version production.
 *   - Input validation getDb()'dan oldin (graceful degradation).
 */

import { Router } from 'express';
import { requireAdmin } from '../middleware/auth.js';
import {
  registerAiModel,
  listAiModels,
  getAiModel,
  pinAiModel,
  setAiModelAllowlist,
  setAiModelStatus,
  createEvalDataset,
  listEvalDatasets,
  addEvalItem,
  listEvalItems,
  runAiEvaluation,
  executeAiRollback,
  getAiMlopsDashboard,
  AI_MODEL_STATUS,
  AI_DATASET_KIND,
  AI_DATASET_STATUS,
  AI_EVAL_RUN_STATUS,
  AI_GATE_STAGE,
  AI_GATE_DECISION,
  AI_DRIFT_SEVERITY,
  AI_ROLLBACK_ACTION,
} from '../src/modules/ai-mlops/index.js';

const router = Router();

function actorId(req) {
  return req.session?.admin?.id || req.session?.admin?.username || req.session?.user?.id || null;
}

/** GET /api/admin/ai-mlops/meta — constants for the admin UI. */
router.get('/api/admin/ai-mlops/meta', requireAdmin, (req, res) => {
  res.json({
    modelStatus: AI_MODEL_STATUS,
    datasetKind: AI_DATASET_KIND,
    datasetStatus: AI_DATASET_STATUS,
    runStatus: AI_EVAL_RUN_STATUS,
    gateStage: AI_GATE_STAGE,
    gateDecision: AI_GATE_DECISION,
    driftSeverity: AI_DRIFT_SEVERITY,
    rollbackAction: AI_ROLLBACK_ACTION,
  });
});

// ═══════════════════════════════════════════════════════════════════
// MODELS
// ═══════════════════════════════════════════════════════════════════

/** POST /api/admin/ai-mlops/models — register a model. */
router.post('/api/admin/ai-mlops/models', requireAdmin, async (req, res) => {
  try {
    const r = await registerAiModel({
      name: req.body?.name,
      provider: req.body?.provider,
      version: req.body?.version,
      createdBy: actorId(req),
    });
    res.status(201).json(r);
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

/** GET /api/admin/ai-mlops/models — list models. */
router.get('/api/admin/ai-mlops/models', requireAdmin, async (req, res) => {
  try {
    const rows = await listAiModels({ status: req.query.status });
    res.json({ ok: true, models: rows });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

/** GET /api/admin/ai-mlops/models/:id — model detail. */
router.get('/api/admin/ai-mlops/models/:id', requireAdmin, async (req, res) => {
  try {
    const model = await getAiModel(Number(req.params.id));
    if (!model) return res.status(404).json({ ok: false, error: 'Model not found' });
    res.json({ ok: true, model });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

/** POST /api/admin/ai-mlops/models/:id/pin — pin model version (gate). */
router.post('/api/admin/ai-mlops/models/:id/pin', requireAdmin, async (req, res) => {
  try {
    const r = await pinAiModel({
      modelId: Number(req.params.id),
      modelVersion: req.body?.modelVersion,
      pinnedBy: actorId(req),
    });
    res.json(r);
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

/** POST /api/admin/ai-mlops/models/:id/allowlist — toggle allowlist. */
router.post('/api/admin/ai-mlops/models/:id/allowlist', requireAdmin, async (req, res) => {
  try {
    const r = await setAiModelAllowlist({
      modelId: Number(req.params.id),
      allowlisted: Boolean(req.body?.allowlisted),
      actorId: actorId(req),
    });
    res.json(r);
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

/** POST /api/admin/ai-mlops/models/:id/status — set model status. */
router.post('/api/admin/ai-mlops/models/:id/status', requireAdmin, async (req, res) => {
  try {
    const r = await setAiModelStatus({
      modelId: Number(req.params.id),
      status: req.body?.status,
      actorId: actorId(req),
    });
    res.json(r);
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

// ═══════════════════════════════════════════════════════════════════
// EVAL DATASETS
// ═══════════════════════════════════════════════════════════════════

/** POST /api/admin/ai-mlops/datasets — create golden/adversarial dataset. */
router.post('/api/admin/ai-mlops/datasets', requireAdmin, async (req, res) => {
  try {
    const r = await createEvalDataset({
      name: req.body?.name,
      kind: req.body?.kind,
      version: req.body?.version,
      holdout: req.body?.holdout !== false,
      createdBy: actorId(req),
    });
    res.status(201).json(r);
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

/** GET /api/admin/ai-mlops/datasets — list datasets. */
router.get('/api/admin/ai-mlops/datasets', requireAdmin, async (req, res) => {
  try {
    const rows = await listEvalDatasets({ kind: req.query.kind });
    res.json({ ok: true, datasets: rows });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

/** POST /api/admin/ai-mlops/datasets/:id/items — add eval item. */
router.post('/api/admin/ai-mlops/datasets/:id/items', requireAdmin, async (req, res) => {
  try {
    const r = await addEvalItem({
      datasetId: Number(req.params.id),
      inputHash: req.body?.inputHash,
      goldScore: req.body?.goldScore,
      aiScore: req.body?.aiScore ?? null,
      subgroup: req.body?.subgroup ?? null,
      goldResponse: req.body?.goldResponse ?? null,
    });
    res.status(201).json(r);
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

/** GET /api/admin/ai-mlops/datasets/:id/items — list items. */
router.get('/api/admin/ai-mlops/datasets/:id/items', requireAdmin, async (req, res) => {
  try {
    const rows = await listEvalItems({ datasetId: Number(req.params.id) });
    res.json({ ok: true, items: rows });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

// ═══════════════════════════════════════════════════════════════════
// EVALUATION + ROLLBACK + DASHBOARD
// ═══════════════════════════════════════════════════════════════════

/** POST /api/admin/ai-mlops/evaluations — run evaluation (gate + drift). */
router.post('/api/admin/ai-mlops/evaluations', requireAdmin, async (req, res) => {
  try {
    const r = await runAiEvaluation({
      modelId: Number(req.body?.modelId),
      datasetId: Number(req.body?.datasetId),
      items: req.body?.items || [],
      overrides: Number(req.body?.overrides || 0),
      stage: req.body?.stage,
      thresholdsJson: req.body?.thresholdsJson || null,
      actorId: actorId(req),
    });
    res.json(r);
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

/** POST /api/admin/ai-mlops/rollback — kill switch (disable/rollback/retire). */
router.post('/api/admin/ai-mlops/rollback', requireAdmin, async (req, res) => {
  try {
    const r = await executeAiRollback({
      modelId: Number(req.body?.modelId),
      action: req.body?.action,
      reason: req.body?.reason || '',
      triggeredBy: req.body?.triggeredBy || 'manual',
      actorId: actorId(req),
    });
    res.json(r);
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

/** GET /api/admin/ai-mlops/dashboard — override/drift/cost dashboard. */
router.get('/api/admin/ai-mlops/dashboard', requireAdmin, async (req, res) => {
  try {
    const r = await getAiMlopsDashboard({ modelId: req.query.modelId ? Number(req.query.modelId) : null });
    res.json(r);
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

// ═══════════════════════════════════════════════════════════════════
// ADMIN PAGE
// ═══════════════════════════════════════════════════════════════════

/** GET /admin/ai-mlops — evaluation/MLOps admin page. */
router.get('/admin/ai-mlops', requireAdmin, (req, res) => {
  res.render('admin/ai-mlops', {
    title: 'AI Evaluation & MLOps',
    user: req.session.admin,
    csrfToken: req.csrfToken ? req.csrfToken() : '',
  });
});

export default router;
