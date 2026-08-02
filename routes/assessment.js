/**
 * Edikit — Assessment Builder API Routes
 *
 * REST API for the assessment draft builder & blueprint:
 *   - Templates CRUD
 *   - Assessment draft CRUD (mutable draft / immutable published)
 *   - Sections & item pool management
 *   - Blueprint / randomization config
 *   - Versioning, publish, diff
 *   - Student preview (public) / author preview (private key, gated)
 *   - Pure helpers: distribution split, score/time validation
 */

import { Router } from 'express';
import {
  createAssessmentTemplate,
  getAssessmentTemplate,
  listAssessmentTemplates,
  updateAssessmentTemplate,
  deleteAssessmentTemplate,
  createAssessment,
  getAssessment,
  listAssessments,
  updateAssessment,
  deleteAssessment,
  createAssessmentVersion,
  publishAssessment,
  getAssessmentVersions,
  diffAssessmentVersions,
  addSection,
  updateSection,
  removeSection,
  listSections,
  addAssessmentItem,
  updateAssessmentItem,
  removeAssessmentItem,
  listItems,
  setBlueprint,
  setRandomizationConfig,
  renderPreview,
} from '../src/modules/assessment/index.js';

import {
  distributeCount,
  split502030,
  computeBlueprintCounts,
  validateBlueprint,
  validateScoreTimeArithmetic,
  selectItemsFromPool,
} from '../src/modules/assessment/blueprint.js';

const router = Router();

// Helper: resolve who is acting (user id or admin flag)
function actingIdentity(req) {
  if (req.session?.admin?.id) return { userId: req.session.admin.id, isAdmin: true };
  if (req.session?.user?.id) return { userId: req.session.user.id, isAdmin: false };
  return { userId: null, isAdmin: false };
}

// Helper: is this actor the assessment author (or a platform admin)?
async function isAuthorizedAuthor(req, assessmentId) {
  const { userId, isAdmin } = actingIdentity(req);
  if (!userId) return false;
  if (isAdmin) return true;
  // Ownership check — only the assessment author (created_by) can preview the answer key
  const assessment = await getAssessment(assessmentId);
  return Boolean(assessment && assessment.created_by === userId);
}

// ═══════════════════════════════════════════════════════════════════
// PURE HELPERS
// ═══════════════════════════════════════════════════════════════════

/** GET /api/assessment/distribution?total=10 — deterministic 50/30/20 split. */
router.get('/api/assessment/distribution', (req, res) => {
  const total = parseInt(req.query.total || '10', 10);
  try {
    res.json({ total, split: split502030(total) });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/** POST /api/assessment/distribution/counts — per-outcome counts from weights. */
router.post('/api/assessment/distribution/counts', (req, res) => {
  try {
    const { total, weights } = req.body || {};
    res.json({ total, counts: computeBlueprintCounts(parseInt(total || '0', 10), weights || []) });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/** POST /api/assessment/blueprint/validate — validate blueprint arithmetic. */
router.post('/api/assessment/blueprint/validate', (req, res) => {
  try {
    const { blueprint, expectedTotalItems } = req.body || {};
    res.json(validateBlueprint(blueprint || {}, { expectedTotalItems }));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/** POST /api/assessment/score-time/validate — score/time arithmetic validator. */
router.post('/api/assessment/score-time/validate', (req, res) => {
  try {
    res.json(validateScoreTimeArithmetic(req.body || {}));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/** POST /api/assessment/pool/select — deterministic seeded pool selection. */
router.post('/api/assessment/pool/select', (req, res) => {
  try {
    const { pool, blueprint, seed } = req.body || {};
    res.json(selectItemsFromPool(pool || [], blueprint || {}, { seed }));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════════
// TEMPLATES
// ═══════════════════════════════════════════════════════════════════

router.post('/api/assessment-templates', async (req, res) => {
  try {
    const result = await createAssessmentTemplate({
      ...req.body,
      created_by: req.session?.user?.id || req.session?.admin?.id,
    });
    res.status(201).json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.get('/api/assessment-templates', async (req, res) => {
  try {
    res.json(await listAssessmentTemplates({
      assessment_type: req.query.assessment_type,
      is_public: req.query.is_public !== undefined ? req.query.is_public === 'true' : undefined,
      limit: parseInt(req.query.limit || '50', 10),
      offset: parseInt(req.query.offset || '0', 10),
    }));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.get('/api/assessment-templates/:id', async (req, res) => {
  try {
    const tpl = await getAssessmentTemplate(parseInt(req.params.id, 10));
    if (!tpl) return res.status(404).json({ error: 'Template not found' });
    res.json(tpl);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.patch('/api/assessment-templates/:id', async (req, res) => {
  try {
    res.json(await updateAssessmentTemplate(parseInt(req.params.id, 10), {
      ...req.body,
      updated_by: req.session?.user?.id || req.session?.admin?.id,
    }));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.delete('/api/assessment-templates/:id', async (req, res) => {
  try {
    res.json(await deleteAssessmentTemplate(
      parseInt(req.params.id, 10),
      req.session?.user?.id || req.session?.admin?.id
    ));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════════
// ASSESSMENT DRAFTS
// ═══════════════════════════════════════════════════════════════════

router.post('/api/assessments', async (req, res) => {
  try {
    const result = await createAssessment({
      ...req.body,
      created_by: req.session?.user?.id || req.session?.admin?.id,
    });
    res.status(201).json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.get('/api/assessments', async (req, res) => {
  try {
    res.json(await listAssessments({
      status: req.query.status,
      assessment_type: req.query.assessment_type,
      course_id: req.query.course_id ? parseInt(req.query.course_id, 10) : undefined,
      limit: parseInt(req.query.limit || '50', 10),
      offset: parseInt(req.query.offset || '0', 10),
    }));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.get('/api/assessments/:id', async (req, res) => {
  try {
    const assessment = await getAssessment(parseInt(req.params.id, 10));
    if (!assessment) return res.status(404).json({ error: 'Assessment not found' });

    // Published assessments return with version info; drafts return full
    const [sections, items, versions] = await Promise.all([
      listSections(assessment.id),
      listItems(assessment.id),
      getAssessmentVersions(assessment.id),
    ]);

    res.json({ ...assessment, sections, items, versions: versions.slice(0, 5) });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/** PATCH — draft mutable only; published is immutable (silent edits rejected). */
router.patch('/api/assessments/:id', async (req, res) => {
  try {
    res.json(await updateAssessment(parseInt(req.params.id, 10), {
      ...req.body,
      updated_by: req.session?.user?.id || req.session?.admin?.id,
    }));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.delete('/api/assessments/:id', async (req, res) => {
  try {
    res.json(await deleteAssessment(
      parseInt(req.params.id, 10),
      req.session?.user?.id || req.session?.admin?.id
    ));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════════
// BLUEPRINT & RANDOMIZATION CONFIG
// ═══════════════════════════════════════════════════════════════════

router.put('/api/assessments/:id/blueprint', async (req, res) => {
  try {
    res.json(await setBlueprint(parseInt(req.params.id, 10), req.body.blueprint || {}, {
      userId: req.session?.user?.id || req.session?.admin?.id,
      itemCount: req.body.item_count,
    }));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.put('/api/assessments/:id/randomization', async (req, res) => {
  try {
    res.json(await setRandomizationConfig(parseInt(req.params.id, 10), req.body || {}, {
      userId: req.session?.user?.id || req.session?.admin?.id,
    }));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════════
// SECTIONS
// ═══════════════════════════════════════════════════════════════════

router.post('/api/assessments/:id/sections', async (req, res) => {
  try {
    const result = await addSection(parseInt(req.params.id, 10), req.body);
    res.status(201).json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.get('/api/assessments/:id/sections', async (req, res) => {
  try {
    res.json(await listSections(parseInt(req.params.id, 10)));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.patch('/api/assessments/:id/sections/:sid', async (req, res) => {
  try {
    res.json(await updateSection(parseInt(req.params.sid, 10), req.body));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.delete('/api/assessments/:id/sections/:sid', async (req, res) => {
  try {
    res.json(await removeSection(parseInt(req.params.sid, 10)));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════════
// ITEMS (item pool links)
// ═══════════════════════════════════════════════════════════════════

router.post('/api/assessments/:id/items', async (req, res) => {
  try {
    const result = await addAssessmentItem(parseInt(req.params.id, 10), {
      ...req.body,
      added_by: req.session?.user?.id || req.session?.admin?.id,
    });
    res.status(201).json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.get('/api/assessments/:id/items', async (req, res) => {
  try {
    res.json(await listItems(parseInt(req.params.id, 10)));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.patch('/api/assessments/:id/items/:iid', async (req, res) => {
  try {
    res.json(await updateAssessmentItem(parseInt(req.params.iid, 10), req.body));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.delete('/api/assessments/:id/items/:iid', async (req, res) => {
  try {
    res.json(await removeAssessmentItem(parseInt(req.params.iid, 10)));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════════
// VERSIONING & PUBLISH
// ═══════════════════════════════════════════════════════════════════

router.post('/api/assessments/:id/versions', async (req, res) => {
  try {
    const result = await createAssessmentVersion(parseInt(req.params.id, 10), {
      userId: req.session?.user?.id || req.session?.admin?.id,
      changeSummary: req.body.change_summary,
    });
    res.status(201).json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.get('/api/assessments/:id/versions', async (req, res) => {
  try {
    res.json(await getAssessmentVersions(parseInt(req.params.id, 10)));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.get('/api/assessments/:id/versions/diff', async (req, res) => {
  try {
    const from = parseInt(req.query.from, 10);
    const to = parseInt(req.query.to, 10);
    if (!from || !to) return res.status(400).json({ error: 'from and to query params required' });
    res.json(await diffAssessmentVersions(parseInt(req.params.id, 10), from, to));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/** POST /api/assessments/:id/publish — validates arithmetic then freezes. */
router.post('/api/assessments/:id/publish', async (req, res) => {
  try {
    res.json(await publishAssessment(parseInt(req.params.id, 10), {
      userId: req.session?.user?.id || req.session?.admin?.id,
    }));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════════
// PREVIEW
// ═══════════════════════════════════════════════════════════════════

/**
 * GET /api/assessments/:id/preview
 *   - Default: STUDENT preview (public items only, answer key hidden)
 *   - ?include_private=1: AUTHOR preview (answer key) — requires logged-in author
 */
router.get('/api/assessments/:id/preview', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const includePrivate = req.query.include_private === '1' || req.query.include_private === 'true';

    // Private-key (author) preview requires assessment ownership or admin.
    if (includePrivate && !(await isAuthorizedAuthor(req, id))) {
      return res.status(403).json({ error: 'Author preview requires assessment ownership' });
    }

    const html = await renderPreview(id, {
      includePrivateKey: includePrivate,
      authorized: includePrivate, // only ever true when ownership was verified
    });
    if (!html) return res.status(404).json({ error: 'Assessment not found' });
    res.type('html').send(html);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

export default router;
