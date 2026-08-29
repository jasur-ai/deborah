/**
 * Deborah — Assessment Builder API Routes
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
import { requireAuth } from '../middleware/auth.js';
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

// ── S20 BUG-123/129: identity — deborah user obyektida `.id` YO'Q (safeKey/
// username), admin'da esa username. Eski kod req.session?.user?.id o'qib doim
// undefined olar edi: created_by=NULl, mualliflik/author-preview doim buziq.
function actingIdentity(req) {
  if (req.session?.admin) {
    return { userId: String(req.session.admin.username || req.session.admin.id || 'admin'), isAdmin: true };
  }
  if (req.session?.user) {
    const u = req.session.user;
    return { userId: String(u.safeKey || u.username || ''), isAdmin: false };
  }
  return { userId: null, isAdmin: false };
}

// S20 BUG-122/128: butun assessment API'da auth/rol yo'q edi — anonim
// yaratish/o'chirish/publish, studentlar draft+item bank (javob kalitlari)
// o'qiy olardi. Yozish va draft o'qish = faqat teacher/admin/board.
function requireAssessmentStaff(req, res, next) {
  if (req.session?.admin) return next();
  const role = req.session?.user?.role;
  if (['teacher', 'admin', 'board'].includes(role)) return next();
  return res.status(403).json({ error: "Faqat o'qituvchi/admin" });
}

// S20 BUG-124: mutate oqimlarda ownership — faqat muallif (yoki admin).
// PG bo'lmasa (lokal) xatoni 400 bilan qaytaramiz, emas 500.
async function assertAssessmentOwner(req, res, id) {
  const { userId, isAdmin } = actingIdentity(req);
  if (isAdmin) return true;
  try {
    const a = await getAssessment(id);
    if (!a) { res.status(404).json({ error: 'Assessment not found' }); return false; }
    if (a.created_by !== userId) { res.status(403).json({ error: 'Faqat muallif tahrirlay oladi' }); return false; }
    return true;
  } catch (e) {
    res.status(400).json({ error: e.message });
    return false;
  }
}

// S20 BUG-126: ...req.body mass-assignment (created_by/tenant/status spoof).
const TEMPLATE_FIELDS = ['name', 'assessment_type', 'description', 'blueprint_template', 'is_public', 'schema_version'];
const ASSESSMENT_FIELDS = ['template_id', 'course_id', 'title', 'description', 'assessment_type', 'total_score', 'time_limit_minutes', 'instructions'];
function pick(obj = {}, fields) {
  const out = {};
  for (const f of fields) if (obj[f] !== undefined) out[f] = obj[f];
  return out;
}

// Helper: is this actor the assessment author (or a platform admin)?
async function isAuthorizedAuthor(req, assessmentId) {
  const { userId, isAdmin } = actingIdentity(req);
  if (!userId) return false;
  if (isAdmin) return true;
  // Ownership check — only the assessment author (created_by) can preview the answer key.
  // S20: PG yo'q bo'lsa xato deb emas, 'huquq yo'q' deb qaytaramiz (fail-closed).
  try {
    const assessment = await getAssessment(assessmentId);
    return Boolean(assessment && assessment.created_by === userId);
  } catch (_) {
    return false;
  }
}

// ── S20 BUG-122: auth gate — templates + assessments namespace (preview mustasno) ──
router.use(['/api/assessment-templates', '/api/assessments'], (req, res, next) => {
  requireAuth(req, res, () => {
    // Student preview (public items, javob kalitsiz) — har qanday login'li user
    const isStudentPreview = req.method === 'GET' && /\/preview$/.test(req.path);
    if (isStudentPreview) return next();
    return requireAssessmentStaff(req, res, next);
  });
});

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
      ...pick(req.body, TEMPLATE_FIELDS), // S20 BUG-126: whitelist
      created_by: actingIdentity(req).userId,
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
      limit: Math.min(200, Math.max(1, parseInt(req.query.limit || '50', 10) || 50)), // S20 BUG-125
      offset: Math.min(10000, Math.max(0, parseInt(req.query.offset || '0', 10) || 0)),
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
    // S20 BUG-124: template ownership (muallif yoki admin)
    const { userId, isAdmin } = actingIdentity(req);
    if (!isAdmin) {
      const tpl = await getAssessmentTemplate(parseInt(req.params.id, 10));
      if (!tpl) return res.status(404).json({ error: 'Template not found' });
      if (tpl.created_by !== userId) return res.status(403).json({ error: 'Faqat muallif tahrirlay oladi' });
    }
    res.json(await updateAssessmentTemplate(parseInt(req.params.id, 10), {
      ...pick(req.body, TEMPLATE_FIELDS), // S20 BUG-126
      updated_by: actingIdentity(req).userId,
    }));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.delete('/api/assessment-templates/:id', async (req, res) => {
  try {
    // S20 BUG-124: template ownership
    const { userId, isAdmin } = actingIdentity(req);
    if (!isAdmin) {
      const tpl = await getAssessmentTemplate(parseInt(req.params.id, 10));
      if (!tpl) return res.status(404).json({ error: 'Template not found' });
      if (tpl.created_by !== userId) return res.status(403).json({ error: "Faqat muallif o'chira oladi" });
    }
    res.json(await deleteAssessmentTemplate(
      parseInt(req.params.id, 10),
      actingIdentity(req).userId
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
      ...pick(req.body, ASSESSMENT_FIELDS), // S20 BUG-126
      created_by: actingIdentity(req).userId,
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
      limit: Math.min(200, Math.max(1, parseInt(req.query.limit || '50', 10) || 50)), // S20 BUG-125
      offset: Math.min(10000, Math.max(0, parseInt(req.query.offset || '0', 10) || 0)),
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
    if (!(await assertAssessmentOwner(req, res, parseInt(req.params.id, 10)))) return; // S20 BUG-124
    res.json(await updateAssessment(parseInt(req.params.id, 10), {
      ...pick(req.body, ASSESSMENT_FIELDS), // S20 BUG-126
      updated_by: actingIdentity(req).userId,
    }));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.delete('/api/assessments/:id', async (req, res) => {
  try {
    if (!(await assertAssessmentOwner(req, res, parseInt(req.params.id, 10)))) return; // S20 BUG-124
    res.json(await deleteAssessment(
      parseInt(req.params.id, 10),
      actingIdentity(req).userId
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
    if (!(await assertAssessmentOwner(req, res, parseInt(req.params.id, 10)))) return; // S20 BUG-124
    res.json(await setBlueprint(parseInt(req.params.id, 10), req.body.blueprint || {}, {
      userId: actingIdentity(req).userId,
      itemCount: req.body.item_count,
    }));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.put('/api/assessments/:id/randomization', async (req, res) => {
  try {
    if (!(await assertAssessmentOwner(req, res, parseInt(req.params.id, 10)))) return; // S20 BUG-124
    res.json(await setRandomizationConfig(parseInt(req.params.id, 10), req.body || {}, {
      userId: actingIdentity(req).userId,
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
    if (!(await assertAssessmentOwner(req, res, parseInt(req.params.id, 10)))) return; // S20 BUG-124
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

// S20 BUG-127: nested resurs (section/item) OTASIGA tegishlimi? Patch/delete
// faqat :sid/:iid bo'yicha ishlar edi — boshqa assessment'ning section'idini
// ko'chirib o'zgartirish mumkin edi.
async function assertChildBelongsTo(req, res, listFn, assessmentId, childId, label) {
  try {
    const rows = await listFn(assessmentId);
    if (!Array.isArray(rows) || !rows.some((r) => r.id === childId)) {
      res.status(404).json({ error: `${label} bu assessmentga tegishli emas` });
      return false;
    }
    return true;
  } catch (e) {
    res.status(400).json({ error: e.message });
    return false;
  }
}

router.patch('/api/assessments/:id/sections/:sid', async (req, res) => {
  try {
    const aid = parseInt(req.params.id, 10), sid = parseInt(req.params.sid, 10);
    if (!(await assertAssessmentOwner(req, res, aid))) return; // S20 BUG-124
    if (!(await assertChildBelongsTo(req, res, listSections, aid, sid, 'Section'))) return; // S20 BUG-127
    res.json(await updateSection(sid, req.body));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.delete('/api/assessments/:id/sections/:sid', async (req, res) => {
  try {
    const aid = parseInt(req.params.id, 10), sid = parseInt(req.params.sid, 10);
    if (!(await assertAssessmentOwner(req, res, aid))) return; // S20 BUG-124
    if (!(await assertChildBelongsTo(req, res, listSections, aid, sid, 'Section'))) return; // S20 BUG-127
    res.json(await removeSection(sid));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════════
// ITEMS (item pool links)
// ═══════════════════════════════════════════════════════════════════

router.post('/api/assessments/:id/items', async (req, res) => {
  try {
    if (!(await assertAssessmentOwner(req, res, parseInt(req.params.id, 10)))) return; // S20 BUG-124
    const result = await addAssessmentItem(parseInt(req.params.id, 10), {
      ...req.body,
      added_by: actingIdentity(req).userId,
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
    const aid = parseInt(req.params.id, 10), iid = parseInt(req.params.iid, 10);
    if (!(await assertAssessmentOwner(req, res, aid))) return; // S20 BUG-124
    if (!(await assertChildBelongsTo(req, res, listItems, aid, iid, 'Item'))) return; // S20 BUG-127
    res.json(await updateAssessmentItem(iid, req.body));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.delete('/api/assessments/:id/items/:iid', async (req, res) => {
  try {
    const aid = parseInt(req.params.id, 10), iid = parseInt(req.params.iid, 10);
    if (!(await assertAssessmentOwner(req, res, aid))) return; // S20 BUG-124
    if (!(await assertChildBelongsTo(req, res, listItems, aid, iid, 'Item'))) return; // S20 BUG-127
    res.json(await removeAssessmentItem(iid));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════════
// VERSIONING & PUBLISH
// ═══════════════════════════════════════════════════════════════════

router.post('/api/assessments/:id/versions', async (req, res) => {
  try {
    if (!(await assertAssessmentOwner(req, res, parseInt(req.params.id, 10)))) return; // S20 BUG-124
    const result = await createAssessmentVersion(parseInt(req.params.id, 10), {
      userId: actingIdentity(req).userId,
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
    if (!(await assertAssessmentOwner(req, res, parseInt(req.params.id, 10)))) return; // S20 BUG-124
    res.json(await publishAssessment(parseInt(req.params.id, 10), {
      userId: actingIdentity(req).userId,
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
