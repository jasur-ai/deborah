/**
 * Edikit — Deck Export Routes
 *
 * Prompt 59:
 *   - GET   /api/admin/deck-exports/meta       — constants
 *   - POST  /api/admin/deck-exports            — export canonical deck (pptx/pdf/handout)
 *   - GET   /api/admin/deck-exports            — list exports
 *   - GET   /api/admin/deck-exports/:id        — export detail
 *   - GET   /admin/deck-export                 — admin page
 */

import { Router } from 'express';
import { requireAdmin } from '../middleware/auth.js';
import { exportDeck, listDeckExports, getDeckExport, DECK_EXPORT_META } from '../src/modules/deck-export/index.js';

const router = Router();

function actorId(req) {
  return req.session?.admin?.id || req.session?.admin?.username || req.session?.user?.id || null;
}

/** Parse jsonb value that may be a string (fake DB) or object (real PG). */
function parseJson(v) {
  if (v == null) return null;
  if (typeof v === 'object') return v;
  try {
    return JSON.parse(v);
  } catch (_) {
    return null;
  }
}

/** Map a raw export row to a view-friendly shape (jsonb → plain). */
function mapExportRow(row) {
  const a11y = parseJson(row?.accessibility) || {};
  return {
    ...row,
    accessibility_ok: a11y.passed != null ? a11y.failed === 0 : null,
    accessibility: undefined,
  };
}

/** GET /api/admin/deck-exports/meta — constants. */
router.get('/api/admin/deck-exports/meta', requireAdmin, (req, res) => {
  res.json(DECK_EXPORT_META);
});

/** POST /api/admin/deck-exports — export canonical deck. */
router.post('/api/admin/deck-exports', requireAdmin, async (req, res) => {
  try {
    const r = await exportDeck({
      presentationId: req.body?.presentationId,
      versionId: req.body?.versionId,
      format: req.body?.format || 'pptx',
      document: req.body?.document,
      provider: req.body?.provider || null,
      model: req.body?.model || null,
      jobId: req.body?.jobId || null,
      humanReviewedAt: req.body?.humanReviewedAt || null,
      sourceLicenses: req.body?.sourceLicenses || [],
      quizQuestions: req.body?.quizQuestions || [],
      actorId: actorId(req),
    });
    if (!r.ok) return res.status(400).json({ error: r.error });
    res.json({ ok: true, exportId: r.exportId, cached: r.cached || false, status: r.status, format: r.format, slides: r.slides, a11y: r.a11y || null });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

/** GET /api/admin/deck-exports — list exports. */
router.get('/api/admin/deck-exports', requireAdmin, async (req, res) => {
  try {
    const rows = await listDeckExports({ status: req.query.status || null, limit: req.query.limit || 50 });
    res.json({ exports: rows.map(mapExportRow) });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

/** GET /api/admin/deck-exports/:id — export detail. */
router.get('/api/admin/deck-exports/:id', requireAdmin, async (req, res) => {
  try {
    const row = await getDeckExport(Number(req.params.id));
    if (!row) return res.status(404).json({ error: 'export not found' });
    res.json(row);
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

/** GET /admin/deck-export — admin page. */
router.get('/admin/deck-export', requireAdmin, (req, res) => {
  res.render('admin/deck-export', {
    title: 'Deck Export',
    user: req.session.admin,
    csrfToken: req.csrfToken?.(),
  });
});

export default router;
