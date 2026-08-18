/**
 * Deborah — Canonical Presentation & Native Editor Routes
 *
 * Prompt 56 REST API (admin — requireAdmin):
 *   - GET  /api/admin/presentations/meta          — constants for admin UI
 *   - POST /api/admin/presentations               — create presentation
 *   - GET  /api/admin/presentations               — list presentations
 *   - GET  /api/admin/presentations/:id           — presentation + latest version
 *   - POST /api/admin/presentations/:id/document  — editor save (new draft version)
 *   - POST /api/admin/presentations/:id/reorder   — slide reorder
 *   - POST /api/admin/presentations/:id/comments  — add co-teacher comment
 *   - POST /api/admin/presentations/comments/:id/resolve — resolve comment
 *   - GET  /api/admin/presentations/:id/qa        — run AI design QA (§35.5)
 *   - POST /api/admin/presentations/:id/export    — queue PPTX/PDF export
 *   - GET  /api/admin/presentations/:id/versions/diff — diff two versions
 *   - POST /api/admin/presentations/:id/rollback  — rollback to version
 *   - POST /api/admin/presentations/:id/publish   — immutable publish (§35.4)
 *   - GET  /api/admin/presentations/dashboard     — aggregate data
 *   - GET  /admin/presentations                   — admin page
 *
 * Security (Prompt 56 §15-17):
 *   - Provider raw response canonical modeldan tashqariga chiqmaydi.
 *   - Published version immutable — rollback yangi version yaratadi.
 *   - Har bir write path tenant-scoped + idempotent.
 */

import { Router } from 'express';
import { requireAdmin } from '../middleware/auth.js';
import {
  createPresentation,
  listPresentations,
  getPresentation,
  saveDocument,
  rollbackToVersion,
  diffVersionsOfPresentation,
  reorderPresentationSlides,
  addComment,
  resolveComment,
  runSlideQaOnVersion,
  exportPresentation,
  publishPresentation,
  getPresentationDashboard,
  PRESENTATION_META,
} from '../src/modules/presentation/index.js';

const router = Router();

function actorId(req) {
  return req.session?.admin?.id || req.session?.admin?.username || req.session?.user?.id || null;
}

/** GET /api/admin/presentations/meta — constants for the admin UI. */
router.get('/api/admin/presentations/meta', requireAdmin, (req, res) => {
  res.json(PRESENTATION_META);
});

/** POST /api/admin/presentations — create presentation. */
router.post('/api/admin/presentations', requireAdmin, async (req, res) => {
  try {
    const r = await createPresentation({
      title: req.body?.title,
      audience: req.body?.audience,
      language: req.body?.language,
      learningOutcomes: req.body?.learningOutcomes || [],
      theme: req.body?.theme,
      document: req.body?.document || null,
      provider: req.body?.provider || null,
      actorId: actorId(req),
    });
    if (!r.ok) return res.status(400).json({ error: r.error });
    res.json({ ok: true, presentationId: r.presentationId, version: r.version });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

/** GET /api/admin/presentations — list presentations. */
router.get('/api/admin/presentations', requireAdmin, async (req, res) => {
  try {
    const rows = await listPresentations({ status: req.query.status || null });
    res.json({ presentations: rows });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

/** GET /api/admin/presentations/dashboard — aggregate (must precede /:id route). */
router.get('/api/admin/presentations/dashboard', requireAdmin, async (req, res) => {
  try {
    const dash = await getPresentationDashboard();
    if (!dash.ok) return res.status(400).json({ error: dash.error });
    res.json(dash);
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

/** GET /api/admin/presentations/:id — presentation + latest version. */
router.get('/api/admin/presentations/:id', requireAdmin, async (req, res) => {
  try {
    const row = await getPresentation(Number(req.params.id));
    if (!row) return res.status(404).json({ error: 'presentation not found' });
    res.json(row);
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

/** POST /api/admin/presentations/:id/document — editor save. */
router.post('/api/admin/presentations/:id/document', requireAdmin, async (req, res) => {
  try {
    const r = await saveDocument({
      presentationId: Number(req.params.id),
      document: req.body?.document || {},
      comment: req.body?.comment,
      actorId: actorId(req),
    });
    if (!r.ok) return res.status(400).json({ error: r.error });
    res.json({ ok: true, version: r.version, diff: r.diff || null, duplicate: Boolean(r.duplicate) });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

/** POST /api/admin/presentations/:id/reorder — slide reorder. */
router.post('/api/admin/presentations/:id/reorder', requireAdmin, async (req, res) => {
  try {
    const r = await reorderPresentationSlides({
      presentationId: Number(req.params.id),
      fromIndex: req.body?.fromIndex,
      toIndex: req.body?.toIndex,
      actorId: actorId(req),
    });
    if (!r.ok) return res.status(400).json({ error: r.error });
    res.json({ ok: true, version: r.version, diff: r.diff || null });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

/** POST /api/admin/presentations/:id/comments — add comment. */
router.post('/api/admin/presentations/:id/comments', requireAdmin, async (req, res) => {
  try {
    const r = await addComment({
      presentationId: Number(req.params.id),
      versionId: req.body?.versionId,
      slideId: req.body?.slideId,
      blockId: req.body?.blockId,
      author: req.body?.author,
      body: req.body?.body,
      actorId: actorId(req),
    });
    if (!r.ok) return res.status(400).json({ error: r.error });
    res.json({ ok: true, commentId: r.commentId });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

/** POST /api/admin/presentations/comments/:id/resolve — resolve comment. */
router.post('/api/admin/presentations/comments/:id/resolve', requireAdmin, async (req, res) => {
  try {
    const r = await resolveComment({ commentId: Number(req.params.id), actorId: actorId(req) });
    if (!r.ok) return res.status(400).json({ error: r.error });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

/** GET /api/admin/presentations/:id/qa — run AI design QA. */
router.get('/api/admin/presentations/:id/qa', requireAdmin, async (req, res) => {
  try {
    const r = await runSlideQaOnVersion({ presentationId: Number(req.params.id), actorId: actorId(req) });
    if (!r.ok) return res.status(400).json({ error: r.error });
    res.json({ ok: true, results: r.results, summary: r.summary });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

/** POST /api/admin/presentations/:id/export — queue PPTX/PDF export. */
router.post('/api/admin/presentations/:id/export', requireAdmin, async (req, res) => {
  try {
    const r = await exportPresentation({
      presentationId: Number(req.params.id),
      format: req.body?.format || 'pptx',
      actorId: actorId(req),
    });
    if (!r.ok) return res.status(400).json({ error: r.error });
    res.json({ ok: true, exportId: r.exportId, status: r.status, duplicate: Boolean(r.duplicate), skeleton: r.skeleton || null });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

/** GET /api/admin/presentations/:id/versions/diff — diff two versions. */
router.get('/api/admin/presentations/:id/versions/diff', requireAdmin, async (req, res) => {
  try {
    const r = await diffVersionsOfPresentation({
      presentationId: Number(req.params.id),
      fromVersionId: req.query.from ? Number(req.query.from) : null,
      toVersionId: req.query.to ? Number(req.query.to) : null,
    });
    if (!r.ok) return res.status(400).json({ error: r.error });
    res.json({ ok: true, added: r.addedSlides, removed: r.removedSlides, changed: r.changedSlides, summary: r.summary });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

/** POST /api/admin/presentations/:id/rollback — rollback to version. */
router.post('/api/admin/presentations/:id/rollback', requireAdmin, async (req, res) => {
  try {
    const r = await rollbackToVersion({
      presentationId: Number(req.params.id),
      targetVersionId: req.body?.targetVersionId,
      actorId: actorId(req),
    });
    if (!r.ok) return res.status(400).json({ error: r.error });
    res.json({ ok: true, version: r.version, restoredFrom: r.restoredFrom });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

/** POST /api/admin/presentations/:id/publish — immutable publish. */
router.post('/api/admin/presentations/:id/publish', requireAdmin, async (req, res) => {
  try {
    const r = await publishPresentation({ presentationId: Number(req.params.id), actorId: actorId(req) });
    if (!r.ok) return res.status(400).json({ error: r.error });
    res.json({ ok: true, version: r.version, published: true });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

/** GET /admin/presentations — admin page. */
router.get('/admin/presentations', requireAdmin, (req, res) => {
  res.render('admin/presentation', {
    title: 'Presentation Studio',
    user: req.session.admin,
    csrfToken: req.csrfToken?.(),
  });
});

export default router;
