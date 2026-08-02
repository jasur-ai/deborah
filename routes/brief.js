/**
 * Edikit — Assessment Brief, Policy Pack & Simulator API Routes
 *
 * REST API for Prompt 25:
 *   - Versioned assessment briefs (A0–A4, late/resit/security/retention)
 *   - Typed institutional policy packs (DRAFT→APPROVED lifecycle, locked fields)
 *   - Recipe library (seeded templates, apply-recipe)
 *   - Roster/accommodation simulator
 *   - Publish blocker + human-readable report
 */

import { Router } from 'express';
import {
  // schema (pure)
  AI_USE_LEVELS,
  validatePolicySchema,
  validateBriefSchema,
  checkLockedFieldChanges,
  diffBriefContent,
  checkPublishBlockers,
  generatePublishReport,
  RECIPE_CATEGORIES,
  // brief service
  createBrief,
  getBrief,
  listBriefs,
  updateBrief,
  deleteBrief,
  approveBrief,
  getBriefVersions,
  diffBriefVersions,
  // policy service
  createPolicyPack,
  getPolicyPack,
  listPolicyPacks,
  updatePolicyPack,
  deletePolicyPack,
  approvePolicyPack,
  getPolicyPackVersions,
  seedRecipeLibrary,
  listRecipes,
  createPolicyFromRecipe,
  // simulator
  simulateRoster,
  generateHumanReadableReport,
  createSimulatorRun,
  listSimulatorRuns,
  getSimulatorRun,
} from '../src/modules/brief/index.js';

const router = Router();

function actorId(req) {
  return req.session?.user?.id || req.session?.admin?.id || null;
}

// ═══════════════════════════════════════════════════════════════════
// PURE HELPERS
// ═══════════════════════════════════════════════════════════════════

/** POST /api/brief/policy/validate — validate a typed policy object. */
router.post('/api/brief/policy/validate', (req, res) => {
  try {
    res.json(validatePolicySchema(req.body?.policy || {}));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/** POST /api/brief/content/validate — validate brief content. */
router.post('/api/brief/content/validate', (req, res) => {
  try {
    res.json(validateBriefSchema(req.body?.content || {}));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/** POST /api/brief/diff — material-change diff of two content objects. */
router.post('/api/brief/diff', (req, res) => {
  try {
    const { from, to } = req.body || {};
    res.json(diffBriefContent(from || {}, to || {}));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/** POST /api/brief/locked-check — locked-field denylist check. */
router.post('/api/brief/locked-check', (req, res) => {
  try {
    const { current, proposed, lockedFields } = req.body || {};
    res.json(checkLockedFieldChanges(current || {}, proposed || {}, lockedFields || []));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/** GET /api/brief/ai-levels — list AI-use levels A0–A4. */
router.get('/api/brief/ai-levels', (req, res) => {
  res.json({ levels: AI_USE_LEVELS, categories: RECIPE_CATEGORIES });
});

// ═══════════════════════════════════════════════════════════════════
// ASSESSMENT BRIEFS
// ═══════════════════════════════════════════════════════════════════

router.post('/api/briefs', async (req, res) => {
  try {
    const result = await createBrief({ ...req.body, created_by: actorId(req) });
    res.status(201).json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.get('/api/briefs', async (req, res) => {
  try {
    res.json(await listBriefs({
      status: req.query.status,
      assessment_id: req.query.assessment_id ? parseInt(req.query.assessment_id, 10) : undefined,
      limit: parseInt(req.query.limit || '50', 10),
      offset: parseInt(req.query.offset || '0', 10),
    }));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.get('/api/briefs/:id', async (req, res) => {
  try {
    const brief = await getBrief(parseInt(req.params.id, 10));
    if (!brief) return res.status(404).json({ error: 'Brief not found' });
    const versions = await getBriefVersions(brief.id);
    res.json({ ...brief, versions: versions.slice(0, 10) });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/** PATCH — draft mutable only; approved briefs are immutable. */
router.patch('/api/briefs/:id', async (req, res) => {
  try {
    res.json(await updateBrief(parseInt(req.params.id, 10), {
      ...req.body,
      updated_by: actorId(req),
    }));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.delete('/api/briefs/:id', async (req, res) => {
  try {
    res.json(await deleteBrief(parseInt(req.params.id, 10), actorId(req)));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/api/briefs/:id/approve', async (req, res) => {
  try {
    res.json(await approveBrief(parseInt(req.params.id, 10), { userId: actorId(req) }));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.get('/api/briefs/:id/versions', async (req, res) => {
  try {
    res.json(await getBriefVersions(parseInt(req.params.id, 10)));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.get('/api/briefs/:id/versions/diff', async (req, res) => {
  try {
    const from = parseInt(req.query.from, 10);
    const to = parseInt(req.query.to, 10);
    if (!from || !to) return res.status(400).json({ error: 'from and to query params required' });
    res.json(await diffBriefVersions(parseInt(req.params.id, 10), from, to));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════════
// POLICY PACKS
// ═══════════════════════════════════════════════════════════════════

router.post('/api/policy-packs', async (req, res) => {
  try {
    const result = await createPolicyPack({ ...req.body, created_by: actorId(req) });
    res.status(201).json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.get('/api/policy-packs', async (req, res) => {
  try {
    res.json(await listPolicyPacks({
      status: req.query.status,
      limit: parseInt(req.query.limit || '50', 10),
      offset: parseInt(req.query.offset || '0', 10),
    }));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.get('/api/policy-packs/:id', async (req, res) => {
  try {
    const pack = await getPolicyPack(parseInt(req.params.id, 10));
    if (!pack) return res.status(404).json({ error: 'Policy pack not found' });
    const versions = await getPolicyPackVersions(pack.id);
    res.json({ ...pack, versions: versions.slice(0, 10) });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.patch('/api/policy-packs/:id', async (req, res) => {
  try {
    res.json(await updatePolicyPack(parseInt(req.params.id, 10), {
      ...req.body,
      updated_by: actorId(req),
    }));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.delete('/api/policy-packs/:id', async (req, res) => {
  try {
    res.json(await deletePolicyPack(parseInt(req.params.id, 10), actorId(req)));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/api/policy-packs/:id/approve', async (req, res) => {
  try {
    res.json(await approvePolicyPack(parseInt(req.params.id, 10), { userId: actorId(req) }));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.get('/api/policy-packs/:id/versions', async (req, res) => {
  try {
    res.json(await getPolicyPackVersions(parseInt(req.params.id, 10)));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════════
// RECIPE LIBRARY
// ═══════════════════════════════════════════════════════════════════

router.get('/api/policy-recipes', async (req, res) => {
  try {
    res.json(await listRecipes({
      category: req.query.category,
      limit: parseInt(req.query.limit || '50', 10),
      offset: parseInt(req.query.offset || '0', 10),
    }));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/** POST /api/policy-recipes/:id/apply — create a policy pack from a recipe. */
router.post('/api/policy-recipes/:id/apply', async (req, res) => {
  try {
    const result = await createPolicyFromRecipe(parseInt(req.params.id, 10), {
      ...req.body,
      created_by: actorId(req),
    });
    res.status(201).json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/** POST /api/policy-recipes/seed — idempotent system recipe seeding. */
router.post('/api/policy-recipes/seed', async (req, res) => {
  try {
    res.json(await seedRecipeLibrary({ tenantId: req.body?.tenant_id || 1 }));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════════
// SIMULATOR
// ═══════════════════════════════════════════════════════════════════

/** POST /api/simulator/run — simulate roster + accommodations under brief/policy. */
router.post('/api/simulator/run', async (req, res) => {
  try {
    const { roster, brief, policy } = req.body || {};
    const result = simulateRoster({ roster, brief, policy });
    if (!result.ok) return res.status(400).json(result);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/** POST /api/simulator/runs — run simulation AND persist to simulator_runs. */
router.post('/api/simulator/runs', async (req, res) => {
  try {
    const { roster, brief, policy, assessment_id, brief_version_id, policy_version_id } = req.body || {};
    const result = simulateRoster({ roster, brief, policy });
    if (!result.ok) return res.status(400).json(result);
    const saved = await createSimulatorRun({
      assessment_id,
      brief_version_id,
      policy_version_id,
      input_roster: roster || [],
      result,
      created_by: actorId(req),
    });
    res.status(201).json({ ...result, runId: saved?.id || null });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/** GET /api/simulator/runs — list persisted simulation runs. */
router.get('/api/simulator/runs', async (req, res) => {
  try {
    res.json(await listSimulatorRuns({
      assessment_id: req.query.assessment_id ? parseInt(req.query.assessment_id, 10) : undefined,
      limit: parseInt(req.query.limit || '20', 10),
      offset: parseInt(req.query.offset || '0', 10),
    }));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/** GET /api/simulator/runs/:id — get a persisted simulation run. */
router.get('/api/simulator/runs/:id', async (req, res) => {
  try {
    const run = await getSimulatorRun(parseInt(req.params.id, 10));
    if (!run) return res.status(404).json({ error: 'Simulator run not found' });
    res.json(run);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════════
// PUBLISH BLOCKER & REPORT
// ═══════════════════════════════════════════════════════════════════

/** POST /api/publish/blockers — JSON publish blocker check. */
router.post('/api/publish/blockers', async (req, res) => {
  try {
    const { brief, policy, isSummative } = req.body || {};
    res.json(checkPublishBlockers({ brief, policy, isSummative: isSummative !== false }));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/** POST /api/publish/report — human-readable publish readiness report. */
router.post('/api/publish/report', async (req, res) => {
  try {
    const { brief, policy, simulation, isSummative } = req.body || {};
    if (req.query.format === 'text') {
      res.type('text/plain').send(generateHumanReadableReport({ brief, policy, simulation }));
      return;
    }
    res.json({
      report: generatePublishReport({ brief, policy, isSummative: isSummative !== false }),
      humanReadable: generateHumanReadableReport({ brief, policy, simulation }),
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

export default router;
