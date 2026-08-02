/**
 * Edikit — Rubric Builder API Routes
 */

import { Router } from 'express';
import {
  createRubric, getRubric, listRubrics, updateRubric,
  createRubricVersion, transitionRubricVersion, listRubricVersions, diffRubricVersions,
  createCriterion, updateCriterion, deleteCriterion, listCriteria, getRubricVersionMaxPoints,
  createAnchor, listAnchors, deleteAnchor,
  pinRubricToItem, getPinnedRubric, unpinRubricFromItem,
  generateRubricPreview,
} from '../src/modules/rubric/index.js';

const router = Router();
const uid = (req) => req.session?.user?.id || req.session?.admin?.id;

// ── Rubrics ──
router.post('/api/rubrics', async (req, res) => {
  try { res.status(201).json(await createRubric({ ...req.body, owner_id: uid(req) })); }
  catch (e) { res.status(400).json({ error: e.message }); }
});
router.get('/api/rubrics', async (req, res) => {
  try { res.json(await listRubrics({ subject_area: req.query.subject_area, type: req.query.type, limit: parseInt(req.query.limit || '50'), offset: parseInt(req.query.offset || '0') })); }
  catch (e) { res.status(400).json({ error: e.message }); }
});
router.get('/api/rubrics/:id', async (req, res) => {
  try { const r = await getRubric(parseInt(req.params.id)); if (!r) return res.status(404).json({ error: 'Not found' }); res.json(r); }
  catch (e) { res.status(400).json({ error: e.message }); }
});
router.put('/api/rubrics/:id', async (req, res) => {
  try { res.json(await updateRubric(parseInt(req.params.id), { ...req.body, updated_by: uid(req) })); }
  catch (e) { res.status(400).json({ error: e.message }); }
});

// ── Versions ──
router.post('/api/rubrics/:id/versions', async (req, res) => {
  try { res.status(201).json(await createRubricVersion(parseInt(req.params.id), { ...req.body, created_by: uid(req) })); }
  catch (e) { res.status(400).json({ error: e.message }); }
});
router.get('/api/rubrics/:id/versions', async (req, res) => {
  try { res.json(await listRubricVersions(parseInt(req.params.id))); }
  catch (e) { res.status(400).json({ error: e.message }); }
});
router.post('/api/rubrics/versions/:id/transition', async (req, res) => {
  try { res.json(await transitionRubricVersion(parseInt(req.params.id), req.body.status, uid(req))); }
  catch (e) { res.status(400).json({ error: e.message }); }
});
router.get('/api/rubrics/versions/diff', async (req, res) => {
  try { const a = parseInt(req.query.a); const b = parseInt(req.query.b); if (!a || !b) return res.status(400).json({ error: 'a and b query params required' }); res.json(await diffRubricVersions(a, b)); }
  catch (e) { res.status(400).json({ error: e.message }); }
});

// ── Criteria ──
router.post('/api/rubrics/criteria', async (req, res) => {
  try { res.status(201).json(await createCriterion({ ...req.body, created_by: uid(req) })); }
  catch (e) { res.status(400).json({ error: e.message }); }
});
router.get('/api/rubrics/versions/:id/criteria', async (req, res) => {
  try { res.json(await listCriteria(parseInt(req.params.id))); }
  catch (e) { res.status(400).json({ error: e.message }); }
});
router.put('/api/rubrics/criteria/:id', async (req, res) => {
  try { res.json(await updateCriterion(parseInt(req.params.id), { ...req.body, updated_by: uid(req) })); }
  catch (e) { res.status(400).json({ error: e.message }); }
});
router.delete('/api/rubrics/criteria/:id', async (req, res) => {
  try { res.json(await deleteCriterion(parseInt(req.params.id), uid(req))); }
  catch (e) { res.status(400).json({ error: e.message }); }
});
router.get('/api/rubrics/versions/:id/max-points', async (req, res) => {
  try { res.json({ total: await getRubricVersionMaxPoints(parseInt(req.params.id)) }); }
  catch (e) { res.status(400).json({ error: e.message }); }
});

// ── Anchors ──
router.post('/api/rubrics/anchors', async (req, res) => {
  try { res.status(201).json(await createAnchor({ ...req.body, created_by: uid(req) })); }
  catch (e) { res.status(400).json({ error: e.message }); }
});
router.get('/api/rubrics/versions/:id/anchors', async (req, res) => {
  try { res.json(await listAnchors(parseInt(req.params.id), req.query.criterion_id ? parseInt(req.query.criterion_id) : undefined)); }
  catch (e) { res.status(400).json({ error: e.message }); }
});
router.delete('/api/rubrics/anchors/:id', async (req, res) => {
  try { res.json(await deleteAnchor(parseInt(req.params.id), uid(req))); }
  catch (e) { res.status(400).json({ error: e.message }); }
});

// ── Item↔Rubric Pin ──
router.post('/api/rubrics/pin', async (req, res) => {
  try { res.status(201).json(await pinRubricToItem(req.body.item_id, req.body.rubric_version_id, uid(req))); }
  catch (e) { res.status(400).json({ error: e.message }); }
});
router.get('/api/rubrics/pin/:itemId', async (req, res) => {
  try { const pin = await getPinnedRubric(parseInt(req.params.itemId)); if (!pin) return res.status(404).json({ error: 'No pinned rubric' }); res.json(pin); }
  catch (e) { res.status(400).json({ error: e.message }); }
});
router.delete('/api/rubrics/pin/:itemId', async (req, res) => {
  try { res.json(await unpinRubricFromItem(parseInt(req.params.itemId), uid(req))); }
  catch (e) { res.status(400).json({ error: e.message }); }
});

// ── Preview ──
router.get('/api/rubrics/versions/:id/preview', async (req, res) => {
  try { res.json(await generateRubricPreview(parseInt(req.params.id))); }
  catch (e) { res.status(400).json({ error: e.message }); }
});

export default router;
