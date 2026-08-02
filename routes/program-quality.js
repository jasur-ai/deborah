/**
 * Edikit — Program Quality & Accreditation Workspace Routes
 *
 * Prompt 62 REST API:
 *   - GET    /admin/program-quality                 — admin UI
 *   - GET    /api/admin/program-quality/maps        — list maps
 *   - POST   /api/admin/program-quality/maps        — create map
 *   - GET    /api/admin/program-quality/maps/:id    — map + entries + gaps
 *   - POST   /api/admin/program-quality/maps/:id/status — transition status
 *   - POST   /api/admin/program-quality/maps/:id/entries — map course↔outcome
 *   - POST   /api/admin/program-quality/evidence    — add aggregation
 *   - GET    /api/admin/program-quality/evidence    — list (suppressed)
 *   - POST   /api/admin/program-quality/findings    — create finding
 *   - POST   /api/admin/program-quality/findings/:id/status — transition
 *   - GET    /api/admin/program-quality/findings    — list findings
 *   - POST   /api/admin/program-quality/actions     — create action
 *   - POST   /api/admin/program-quality/actions/:id/status — transition (close blocker)
 *   - POST   /api/admin/program-quality/actions/:id/follow-up — add follow-up evidence
 *   - GET    /api/admin/program-quality/actions     — list actions
 *   - POST   /api/admin/program-quality/exports     — create export bundle
 *   - GET    /api/admin/program-quality/exports     — list exports
 *   - POST   /api/admin/program-quality/exports/:id/verify — verify manifest hash
 *
 * Security (Prompt 62 §15, §56.5): barcha route'lar requireAdmin;
 * teacher leaderboard yo'q; raw PII aggregate'ga chiqmaydi; action
 * evidence'siz close bo'lmaydi; privileged actionlar audited.
 */

import { Router } from 'express';
import { requireAdmin } from '../middleware/auth.js';
import {
  createCurriculumMap,
  listCurriculumMaps,
  getCurriculumMap,
  transitionMapStatus,
  mapCourseOutcome,
  addEvidenceAggregation,
  listEvidenceAggregations,
  createFinding,
  transitionFindingStatus,
  listFindings,
  createImprovementAction,
  transitionActionStatus,
  addFollowUpEvidence,
  listActions,
  createAccreditationExport,
  listAccreditationExports,
  verifyAccreditationExport,
} from '../src/modules/program-quality/index.js';

const router = Router();

function actorId(req) {
  return req.session?.admin?.username || req.session?.admin?.id || req.session?.user?.username || req.session?.user?.id || null;
}

/** GET /admin/program-quality — admin UI. */
router.get('/admin/program-quality', requireAdmin, (req, res) => {
  res.render('admin/program-quality', {
    title: 'Program Quality',
    user: req.session.admin,
    csrfToken: req.csrfToken?.(),
  });
});

// ── Curriculum maps ────────────────────────────────────────────────

router.get('/api/admin/program-quality/maps', requireAdmin, async (req, res) => {
  try {
    const maps = await listCurriculumMaps({ status: req.query.status || null });
    res.json({ maps });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

router.post('/api/admin/program-quality/maps', requireAdmin, async (req, res) => {
  try {
    const r = await createCurriculumMap({
      name: req.body?.name || '',
      frameworkId: req.body?.frameworkId || null,
      term: req.body?.term || null,
      version: req.body?.version || 'v1',
      createdBy: actorId(req),
    });
    if (!r.ok) return res.status(400).json({ error: r.error });
    res.json({ ok: true, mapId: r.mapId, version: r.version });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

router.get('/api/admin/program-quality/maps/:id', requireAdmin, async (req, res) => {
  try {
    const map = await getCurriculumMap({ mapId: Number(req.params.id) });
    if (!map) return res.status(404).json({ error: 'curriculum map not found' });
    res.json({ map });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

router.post('/api/admin/program-quality/maps/:id/status', requireAdmin, async (req, res) => {
  try {
    const r = await transitionMapStatus({ mapId: Number(req.params.id), to: req.body?.status || '', actorId: actorId(req) });
    if (!r.ok) return res.status(400).json({ error: r.error });
    res.json({ ok: true, status: r.status });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

router.post('/api/admin/program-quality/maps/:id/entries', requireAdmin, async (req, res) => {
  try {
    const r = await mapCourseOutcome({
      mapId: Number(req.params.id),
      courseId: Number(req.body?.courseId || 0),
      courseCode: req.body?.courseCode || '',
      courseName: req.body?.courseName || '',
      outcomeId: Number(req.body?.outcomeId || 0),
      outcomeCode: req.body?.outcomeCode || '',
      outcomeName: req.body?.outcomeName || '',
      irmaLevel: req.body?.irmaLevel || 'introduced',
      assessmentPoints: Number(req.body?.assessmentPoints || 0),
      createdBy: actorId(req),
    });
    if (!r.ok) return res.status(400).json({ error: r.error });
    res.json({ ok: true, entryId: r.entryId, updated: r.updated });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

// ── Evidence aggregation ───────────────────────────────────────────

router.post('/api/admin/program-quality/evidence', requireAdmin, async (req, res) => {
  try {
    const r = await addEvidenceAggregation({
      mapId: Number(req.body?.mapId || 0),
      outcomeId: Number(req.body?.outcomeId || 0),
      outcomeCode: req.body?.outcomeCode || '',
      term: req.body?.term || '',
      evidenceType: req.body?.evidenceType || 'direct',
      method: req.body?.method || '',
      sampleSize: Number(req.body?.sampleSize || 0),
      minCellSize: Number(req.body?.minCellSize || 5),
      observedPct: req.body?.observedPct ?? null,
      benchmarkTargetPct: req.body?.benchmarkTargetPct ?? null,
      aggregateMeta: req.body?.aggregateMeta || {},
      createdBy: actorId(req),
    });
    if (!r.ok) return res.status(400).json({ error: r.error });
    res.json({ ok: true, aggregationId: r.aggregationId, suppressed: r.suppressed, observedPct: r.observedPct });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

router.get('/api/admin/program-quality/evidence', requireAdmin, async (req, res) => {
  try {
    const items = await listEvidenceAggregations({
      mapId: Number(req.query.mapId || 0),
      outcomeId: req.query.outcomeId ? Number(req.query.outcomeId) : null,
      includeSuppressed: req.query.includeSuppressed !== 'false',
    });
    res.json({ items });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

// ── Findings ───────────────────────────────────────────────────────

router.post('/api/admin/program-quality/findings', requireAdmin, async (req, res) => {
  try {
    const r = await createFinding({
      mapId: Number(req.body?.mapId || 0),
      outcomeId: Number(req.body?.outcomeId || 0),
      outcomeCode: req.body?.outcomeCode || '',
      title: req.body?.title || '',
      targetPct: Number(req.body?.targetPct || 0),
      observedPct: req.body?.observedPct ?? null,
      reviewNotes: req.body?.reviewNotes || '',
      createdBy: actorId(req),
    });
    if (!r.ok) return res.status(400).json({ error: r.error });
    res.json({ ok: true, findingId: r.findingId, gap: r.gap, verdict: r.verdict });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

router.post('/api/admin/program-quality/findings/:id/status', requireAdmin, async (req, res) => {
  try {
    const r = await transitionFindingStatus({ findingId: Number(req.params.id), to: req.body?.status || '', actorId: actorId(req) });
    if (!r.ok) return res.status(400).json({ error: r.error });
    res.json({ ok: true, status: r.status });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

router.get('/api/admin/program-quality/findings', requireAdmin, async (req, res) => {
  try {
    const findings = await listFindings({ mapId: Number(req.query.mapId || 0), status: req.query.status || null });
    res.json({ findings });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

// ── Improvement actions ────────────────────────────────────────────

router.post('/api/admin/program-quality/actions', requireAdmin, async (req, res) => {
  try {
    const r = await createImprovementAction({
      findingId: Number(req.body?.findingId || 0),
      title: req.body?.title || '',
      owner: req.body?.owner || '',
      deadline: req.body?.deadline || null,
      createdBy: actorId(req),
    });
    if (!r.ok) return res.status(400).json({ error: r.error });
    res.json({ ok: true, actionId: r.actionId });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

router.post('/api/admin/program-quality/actions/:id/status', requireAdmin, async (req, res) => {
  try {
    const r = await transitionActionStatus({ actionId: Number(req.params.id), to: req.body?.status || '', actorId: actorId(req) });
    if (!r.ok) return res.status(400).json({ error: r.error });
    res.json({ ok: true, status: r.status });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

router.post('/api/admin/program-quality/actions/:id/follow-up', requireAdmin, async (req, res) => {
  try {
    const r = await addFollowUpEvidence({
      actionId: Number(req.params.id),
      cycle: req.body?.cycle || '',
      evidenceRef: req.body?.evidenceRef || '',
      decision: req.body?.decision || '',
      notes: req.body?.notes || '',
      collectedBy: actorId(req),
    });
    if (!r.ok) return res.status(400).json({ error: r.error });
    res.json({ ok: true, evidenceId: r.evidenceId });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

router.get('/api/admin/program-quality/actions', requireAdmin, async (req, res) => {
  try {
    const actions = await listActions({ findingId: req.query.findingId ? Number(req.query.findingId) : null });
    res.json({ actions });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

// ── Accreditation exports ──────────────────────────────────────────

router.post('/api/admin/program-quality/exports', requireAdmin, async (req, res) => {
  try {
    const r = await createAccreditationExport({
      mapId: Number(req.body?.mapId || 0),
      standard: req.body?.standard || '',
      standardVersion: req.body?.standardVersion || '',
      exportedBy: actorId(req),
    });
    if (!r.ok) return res.status(400).json({ error: r.error });
    res.json({ ok: true, exportId: r.exportId, manifestHash: r.manifestHash, manifest: r.manifest });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

router.get('/api/admin/program-quality/exports', requireAdmin, async (req, res) => {
  try {
    const exportsList = await listAccreditationExports({ mapId: Number(req.query.mapId || 0) });
    res.json({ exports: exportsList });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

router.post('/api/admin/program-quality/exports/:id/verify', requireAdmin, async (req, res) => {
  try {
    const r = await verifyAccreditationExport({ exportId: Number(req.params.id) });
    // Export topilmadi — 404. Hash mismatch (tamper) esa 200 + matches:false
    // qaytadi — UI "HASH MISMATCH" chipini ko'rsatishi uchun.
    if (r.error) return res.status(404).json({ error: r.error });
    res.json({ ok: r.ok, verifiable: r.verifiable, matches: r.matches, reason: r.reason });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

export default router;
