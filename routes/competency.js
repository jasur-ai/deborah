/**
 * Edikit — Competency & Curriculum Graph API Routes
 *
 * Provides REST API endpoints for competency management:
 *   - Framework CRUD
 *   - Version lifecycle
 *   - Competency hierarchy management
 *   - Relation management
 *   - Course mapping (with AI_SUGGESTED approval)
 *   - Impact/orphan/coverage queries
 *   - CASE import/export
 */

import { Router } from 'express';
import {
  createFramework, getFramework, listFrameworks, updateFramework,
  createVersion, transitionVersion, listVersions,
  createCompetency, getCompetency, listCompetencies, updateCompetency, deleteCompetency,
  createRelation, listRelations, deleteRelation,
  mapCompetencyToCourse, approveMapping, listCourseMappings,
  getCompetencyImpact, findOrphanCompetencies, getCourseCoverage,
  importCaseFormat, exportCaseFormat,
} from '../src/modules/competency/index.js';

const router = Router();

// ═══════════════════════════════════════════════════════════════════
// FRAMEWORK ENDPOINTS
// ═══════════════════════════════════════════════════════════════════

router.post('/api/competency/frameworks', async (req, res) => {
  try {
    const result = await createFramework({
      ...req.body,
      created_by: req.session?.user?.id || req.session?.admin?.id,
    });
    res.status(201).json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.get('/api/competency/frameworks', async (req, res) => {
  try {
    const frameworks = await listFrameworks({
      subject_area: req.query.subject_area,
      education_level: req.query.education_level,
      is_active: req.query.is_active !== undefined ? req.query.is_active === 'true' : undefined,
      limit: parseInt(req.query.limit || '50'),
      offset: parseInt(req.query.offset || '0'),
    });
    res.json(frameworks);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.get('/api/competency/frameworks/:id', async (req, res) => {
  try {
    const framework = await getFramework(parseInt(req.params.id));
    if (!framework) return res.status(404).json({ error: 'Framework not found' });
    res.json(framework);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.put('/api/competency/frameworks/:id', async (req, res) => {
  try {
    const result = await updateFramework(parseInt(req.params.id), {
      ...req.body,
      updated_by: req.session?.user?.id || req.session?.admin?.id,
    });
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════════
// VERSION ENDPOINTS
// ═══════════════════════════════════════════════════════════════════

router.post('/api/competency/frameworks/:id/versions', async (req, res) => {
  try {
    const result = await createVersion(parseInt(req.params.id), {
      ...req.body,
      created_by: req.session?.user?.id || req.session?.admin?.id,
    });
    res.status(201).json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.get('/api/competency/frameworks/:id/versions', async (req, res) => {
  try {
    const versions = await listVersions(parseInt(req.params.id));
    res.json(versions);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/api/competency/versions/:id/transition', async (req, res) => {
  try {
    const result = await transitionVersion(
      parseInt(req.params.id),
      req.body.status,
      req.session?.user?.id || req.session?.admin?.id
    );
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════════
// COMPETENCY ENDPOINTS
// ═══════════════════════════════════════════════════════════════════

router.post('/api/competency/competencies', async (req, res) => {
  try {
    const result = await createCompetency({
      ...req.body,
      created_by: req.session?.user?.id || req.session?.admin?.id,
    });
    res.status(201).json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.get('/api/competency/competencies', async (req, res) => {
  try {
    const competencies = await listCompetencies({
      framework_id: req.query.framework_id ? parseInt(req.query.framework_id) : undefined,
      version_id: req.query.version_id ? parseInt(req.query.version_id) : undefined,
      parent_id: req.query.parent_id !== undefined ? parseInt(req.query.parent_id) : undefined,
      type: req.query.type,
      cognitive_level: req.query.cognitive_level,
      limit: parseInt(req.query.limit || '100'),
      offset: parseInt(req.query.offset || '0'),
    });
    res.json(competencies);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.get('/api/competency/competencies/:id', async (req, res) => {
  try {
    const competency = await getCompetency(parseInt(req.params.id));
    if (!competency) return res.status(404).json({ error: 'Competency not found' });
    res.json(competency);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.put('/api/competency/competencies/:id', async (req, res) => {
  try {
    const result = await updateCompetency(parseInt(req.params.id), {
      ...req.body,
      updated_by: req.session?.user?.id || req.session?.admin?.id,
    });
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.delete('/api/competency/competencies/:id', async (req, res) => {
  try {
    const result = await deleteCompetency(
      parseInt(req.params.id),
      req.session?.user?.id || req.session?.admin?.id
    );
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════════
// RELATION ENDPOINTS
// ═══════════════════════════════════════════════════════════════════

router.post('/api/competency/relations', async (req, res) => {
  try {
    const result = await createRelation({
      ...req.body,
      created_by: req.session?.user?.id || req.session?.admin?.id,
    });
    res.status(201).json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.get('/api/competency/competencies/:id/relations', async (req, res) => {
  try {
    const relations = await listRelations(parseInt(req.params.id));
    res.json(relations);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.delete('/api/competency/relations/:id', async (req, res) => {
  try {
    const result = await deleteRelation(
      parseInt(req.params.id),
      req.session?.user?.id || req.session?.admin?.id
    );
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════════
// COURSE MAPPING ENDPOINTS
// ═══════════════════════════════════════════════════════════════════

router.post('/api/competency/mappings', async (req, res) => {
  try {
    const result = await mapCompetencyToCourse({
      ...req.body,
      mapped_by: req.session?.user?.id || req.session?.admin?.id,
    });
    res.status(201).json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.get('/api/competency/mappings', async (req, res) => {
  try {
    const mappings = await listCourseMappings({
      course_offering_id: req.query.course_offering_id ? parseInt(req.query.course_offering_id) : undefined,
      competency_id: req.query.competency_id ? parseInt(req.query.competency_id) : undefined,
      mapping_status: req.query.mapping_status,
      limit: parseInt(req.query.limit || '50'),
      offset: parseInt(req.query.offset || '0'),
    });
    res.json(mappings);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/api/competency/mappings/:id/approve', async (req, res) => {
  try {
    const result = await approveMapping(
      parseInt(req.params.id),
      req.body.status || 'approved',
      req.session?.user?.id || req.session?.admin?.id
    );
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════════
// IMPACT / ORPHAN / COVERAGE QUERIES
// ═══════════════════════════════════════════════════════════════════

router.get('/api/competency/competencies/:id/impact', async (req, res) => {
  try {
    const impact = await getCompetencyImpact(parseInt(req.params.id));
    if (!impact) return res.status(404).json({ error: 'Competency not found' });
    res.json(impact);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.get('/api/competency/orphans', async (req, res) => {
  try {
    const frameworkId = parseInt(req.query.framework_id);
    if (!frameworkId) return res.status(400).json({ error: 'framework_id is required' });
    const orphans = await findOrphanCompetencies(frameworkId);
    res.json(orphans);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.get('/api/competency/courses/:id/coverage', async (req, res) => {
  try {
    const coverage = await getCourseCoverage(parseInt(req.params.id));
    if (!coverage) return res.status(404).json({ error: 'Course not found' });
    res.json(coverage);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════════
// CASE IMPORT/EXPORT
// ═══════════════════════════════════════════════════════════════════

router.post('/api/competency/import/case', async (req, res) => {
  try {
    const result = await importCaseFormat(
      req.body,
      req.body.framework_id,
      req.session?.user?.id || req.session?.admin?.id
    );
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.get('/api/competency/frameworks/:id/export/case', async (req, res) => {
  try {
    const result = await exportCaseFormat(parseInt(req.params.id));
    if (!result) return res.status(404).json({ error: 'No competencies found for export' });
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

export default router;
