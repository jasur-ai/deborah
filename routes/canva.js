/**
 * Deborah — Canva Button/Connect Adapter Routes
 *
 * Prompt 59 REST API:
 *   - GET   /api/admin/canva/status            — config/scope status
 *   - POST  /api/admin/canva/link              — start OAuth (returns authorize URL)
 *   - POST  /api/admin/canva/callback          — complete OAuth (code exchange)
 *   - POST  /api/admin/canva/button            — handle Button callback
 *   - POST  /api/admin/canva/unlink            — revoke + clear vault
 *   - POST  /api/admin/canva/design            — create design
 *   - POST  /api/admin/canva/design/:id/import — import PPTX/PDF into design
 *   - POST  /api/admin/canva/design/:id/export — export design
 *   - GET   /admin/canva                       — admin page
 *
 * Security (Prompt 59 §15): token vault encrypted; Google token bu
 * provider'ga berilmaydi; callback state (CSRF) tekshiriladi.
 */

import { Router } from 'express';
import { requireAdmin } from '../middleware/auth.js';
import {
  startCanvaLink,
  completeCanvaLink,
  handleButtonCallback,
  unlinkCanvaAccount,
  createCanvaDesign,
  importDeckToCanva,
  exportFromCanva,
  CANVA_META,
} from '../src/modules/canva/index.js';

const router = Router();

function actorId(req) {
  return req.session?.admin?.id || req.session?.admin?.username || req.session?.user?.id || 0;
}

/** GET /api/admin/canva/status — config/scope status. */
router.get('/api/admin/canva/status', requireAdmin, (req, res) => {
  res.json({ ...CANVA_META, configured: Boolean(process.env.CANVA_CLIENT_ID) });
});

/** POST /api/admin/canva/link — start OAuth (returns authorize URL). */
router.post('/api/admin/canva/link', requireAdmin, async (req, res) => {
  try {
    const r = await startCanvaLink({ session: req.session });
    if (!r.ok) return res.status(400).json({ error: r.error });
    res.json({ ok: true, url: r.url });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

/**
 * Canva OAuth redirect — browser GET ?code=...&state=... bilan qaytadi.
 * GET (redirect) + POST (JSON body) ikkala yo'l ham qo'llab-quvvatlanadi.
 */
const handleCanvaCallback = async (req, res) => {
  try {
    const r = await completeCanvaLink({
      session: req.session,
      code: req.body?.code || req.query?.code,
      state: req.body?.state || req.query?.state,
      actorId: actorId(req),
    });
    if (!r.ok) return res.status(400).json({ error: r.error });
    res.json({ ok: true, linked: r.linked });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
};
router.get('/api/admin/canva/callback', requireAdmin, handleCanvaCallback);
router.post('/api/admin/canva/callback', requireAdmin, handleCanvaCallback);

/** POST /api/admin/canva/button — handle Button callback. */
router.post('/api/admin/canva/button', requireAdmin, async (req, res) => {
  try {
    const r = await handleButtonCallback({ payload: req.body, actorId: actorId(req) });
    if (!r.ok) return res.status(400).json({ error: r.error });
    res.json({ ok: true, designId: r.designId, type: r.type, designUrl: r.designUrl });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

/** POST /api/admin/canva/unlink — revoke + clear vault. */
router.post('/api/admin/canva/unlink', requireAdmin, async (req, res) => {
  try {
    const r = await unlinkCanvaAccount({ actorId: actorId(req) });
    res.json({ ok: true, linked: r.linked });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

/** POST /api/admin/canva/design — create design. */
router.post('/api/admin/canva/design', requireAdmin, async (req, res) => {
  try {
    const r = await createCanvaDesign({ title: req.body?.title || 'Deborah deck', actorId: actorId(req) });
    if (!r.ok) return res.status(400).json({ error: r.error });
    res.json({ ok: true, designId: r.designId, designUrl: r.designUrl });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

/** POST /api/admin/canva/design/:id/import — import PPTX/PDF into design. */
router.post('/api/admin/canva/design/:id/import', requireAdmin, async (req, res) => {
  try {
    const r = await importDeckToCanva({ designId: req.params.id, fileType: req.body?.fileType || 'pptx', fileBase64: req.body?.fileBase64 || '', actorId: actorId(req) });
    if (!r.ok) return res.status(400).json({ error: r.error });
    res.json({ ok: true, imported: r.imported });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

/** POST /api/admin/canva/design/:id/export — export design. */
router.post('/api/admin/canva/design/:id/export', requireAdmin, async (req, res) => {
  try {
    const r = await exportFromCanva({ designId: req.params.id, exportType: req.body?.exportType || 'pdf', actorId: actorId(req) });
    if (!r.ok) return res.status(400).json({ error: r.error });
    res.json({ ok: true, designId: r.designId, exportType: r.exportType });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

/** GET /admin/canva — admin page. */
router.get('/admin/canva', requireAdmin, (req, res) => {
  res.render('admin/canva', {
    title: 'Canva Adapter',
    user: req.session.admin,
    csrfToken: req.csrfToken?.(),
  });
});

export default router;
