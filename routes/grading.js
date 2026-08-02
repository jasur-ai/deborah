/**
 * Edikit — Academic Grade Rules & Deterministic Calculation Routes
 *
 * Prompt 45 REST API:
 *   - POST /api/admin/grading/rules            — create rule + first draft version
 *   - GET  /api/admin/grading/rules            — list rules
 *   - GET  /api/admin/grading/rules/:id        — rule + versions
 *   - POST /api/admin/grading/rules/:id/versions — fork a NEW version (approved rules are immutable)
 *   - POST /api/admin/grading/versions/:id/approve — approve (immutable)
 *   - POST /api/admin/grading/calculate        — deterministic calculation preview
 *   - GET  /api/admin/grading/runs             — list calculation runs
 *   - GET  /api/admin/grading/runs/:id         — run detail
 *   - POST /api/admin/grading/runs/:id/reproduce — old-rule-version reproducibility check
 *   - GET  /admin/grading                      — admin page
 *
 * Security (Prompt 45 §15-17):
 *   - requireAdmin on all write paths; actor id from session.
 *   - DSL is declarative (allowlist interpreter — NO eval).
 *   - Final grade persisted as DECIMAL (never float).
 *   - run_hash UNIQUE → idempotent replay.
 */

import { Router } from 'express';
import { requireAdmin } from '../middleware/auth.js';
import {
  createGradeRule,
  createRuleVersion,
  approveRuleVersion,
  getGradeRule,
  listGradeRules,
  listRuleVersions,
  runGradeCalculation,
  reproduceRun,
  getCalculationRun,
  listCalculationRuns,
  RULE_STATUS,
  MISSING_POLICY,
  COMPONENT_STATUS,
  ROUND_METHODS,
  RESIT_CAP_TYPES,
  GRADE_RULE_DEFAULTS,
} from '../src/modules/grading/index.js';

const router = Router();

function actorId(req) {
  return req.session?.admin?.id || req.session?.user?.id || null;
}

// ═══════════════════════════════════════════════════════════════════
// META / CONSTANTS
// ═══════════════════════════════════════════════════════════════════

/** GET /api/admin/grading/meta — constants for the admin UI. */
router.get('/api/admin/grading/meta', requireAdmin, (req, res) => {
  res.json({
    ruleStatus: RULE_STATUS,
    missingPolicy: MISSING_POLICY,
    componentStatus: COMPONENT_STATUS,
    roundMethods: ROUND_METHODS,
    resitCapTypes: RESIT_CAP_TYPES,
    defaults: GRADE_RULE_DEFAULTS,
  });
});

// ═══════════════════════════════════════════════════════════════════
// RULES (versioned)
// ═══════════════════════════════════════════════════════════════════

/** POST /api/admin/grading/rules — create rule + first version. */
router.post('/api/admin/grading/rules', requireAdmin, async (req, res) => {
  try {
    const r = await createGradeRule({
      name: req.body?.name,
      ruleDsl: req.body?.ruleDsl,
      assessmentId: req.body?.assessmentId ? Number(req.body.assessmentId) : null,
      courseOfferingId: req.body?.courseOfferingId ? Number(req.body.courseOfferingId) : null,
      description: req.body?.description || '',
      createdBy: actorId(req),
    });
    res.json(r);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/** GET /api/admin/grading/rules — list rules. */
router.get('/api/admin/grading/rules', requireAdmin, async (req, res) => {
  try {
    const rows = await listGradeRules({ status: req.query.status });
    res.json({ ok: true, rules: rows });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/** GET /api/admin/grading/rules/:id — rule + all versions. */
router.get('/api/admin/grading/rules/:id', requireAdmin, async (req, res) => {
  try {
    const rule = await getGradeRule(Number(req.params.id));
    if (!rule) return res.status(404).json({ error: 'Grade rule not found' });
    const versions = await listRuleVersions({ ruleId: Number(req.params.id) });
    res.json({ ok: true, rule, versions });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/** POST /api/admin/grading/rules/:id/versions — fork a new version. */
router.post('/api/admin/grading/rules/:id/versions', requireAdmin, async (req, res) => {
  try {
    const r = await createRuleVersion({
      ruleId: Number(req.params.id),
      ruleDsl: req.body?.ruleDsl,
      createdBy: actorId(req),
    });
    res.json(r);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/** POST /api/admin/grading/versions/:id/approve — approve (immutable). */
router.post('/api/admin/grading/versions/:id/approve', requireAdmin, async (req, res) => {
  try {
    const r = await approveRuleVersion({ versionId: Number(req.params.id), approvedBy: actorId(req) });
    res.json(r);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════════
// CALCULATION RUNS (deterministic)
// ═══════════════════════════════════════════════════════════════════

/** POST /api/admin/grading/calculate — run deterministic calculation. */
router.post('/api/admin/grading/calculate', requireAdmin, async (req, res) => {
  try {
    const r = await runGradeCalculation({
      ruleVersionId: Number(req.body?.ruleVersionId),
      userId: Number(req.body?.userId),
      components: req.body?.components || [],
      attemptId: req.body?.attemptId ? Number(req.body.attemptId) : null,
      context: req.body?.context || {},
      createdBy: actorId(req),
    });
    res.json(r);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/** GET /api/admin/grading/runs — list calculation runs. */
router.get('/api/admin/grading/runs', requireAdmin, async (req, res) => {
  try {
    const rows = await listCalculationRuns({
      userId: req.query.userId ? Number(req.query.userId) : null,
      attemptId: req.query.attemptId ? Number(req.query.attemptId) : null,
    });
    res.json({ ok: true, runs: rows });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/** GET /api/admin/grading/runs/:id — run detail. */
router.get('/api/admin/grading/runs/:id', requireAdmin, async (req, res) => {
  try {
    const run = await getCalculationRun(Number(req.params.id));
    if (!run) return res.status(404).json({ error: 'Run not found' });
    res.json({ ok: true, run });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/** POST /api/admin/grading/runs/:id/reproduce — old-rule-version check. */
router.post('/api/admin/grading/runs/:id/reproduce', requireAdmin, async (req, res) => {
  try {
    const r = await reproduceRun({ runId: Number(req.params.id), actorId: actorId(req) });
    res.json(r);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/** GET /admin/grading — admin page. */
router.get('/admin/grading', requireAdmin, (req, res) => {
  res.render('admin/grading', {
    title: 'Grade Rules',
    user: req.session.admin,
  });
});

export default router;
