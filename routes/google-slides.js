/**
 * Deborah — Google Slides Adapter Routes
 *
 * Prompt 59 REST API:
 *   - GET   /api/admin/google-slides/status     — config/scope status
 *   - POST  /api/admin/google-slides/link       — start OAuth (drive.file)
 *   - POST  /api/admin/google-slides/callback   — complete OAuth
 *   - POST  /api/admin/google-slides/unlink     — revoke + clear vault
 *   - POST  /api/admin/google-slides/deck       — create from canonical deck
 *   - POST  /api/admin/google-slides/:id/export — export presentation
 *   - GET   /admin/google-slides                — admin page
 *
 * Security (Prompt 59 §15): faqat drive.file scope (full Drive REJECT),
 * token vault encrypted, Google token boshqa provider'ga berilmaydi.
 */

import { Router } from 'express';
import { requireAdmin } from '../middleware/auth.js';
import {
  startGoogleLink,
  completeGoogleLink,
  unlinkGoogleAccount,
  createFromCanonical,
  exportGooglePresentation,
  GOOGLE_SLIDES_META,
} from '../src/modules/google-slides/index.js';

const router = Router();

function actorId(req) {
  return req.session?.admin?.id || req.session?.admin?.username || req.session?.user?.id || 0;
}

/** GET /api/admin/google-slides/status — config/scope status. */
router.get('/api/admin/google-slides/status', requireAdmin, (req, res) => {
  res.json({ ...GOOGLE_SLIDES_META, configured: Boolean(process.env.GOOGLE_CLIENT_ID) });
});

/** POST /api/admin/google-slides/link — start OAuth (drive.file). */
router.post('/api/admin/google-slides/link', requireAdmin, async (req, res) => {
  try {
    const r = await startGoogleLink({ session: req.session });
    if (!r.ok) return res.status(400).json({ error: r.error });
    res.json({ ok: true, url: r.url });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

/**
 * Google OAuth redirect — browser GET ?code=...&state=... bilan qaytadi.
 * GET (redirect) + POST (JSON body) ikkala yo'l ham qo'llab-quvvatlanadi.
 */
const handleGoogleCallback = async (req, res) => {
  try {
    const r = await completeGoogleLink({
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
router.get('/api/admin/google-slides/callback', requireAdmin, handleGoogleCallback);
router.post('/api/admin/google-slides/callback', requireAdmin, handleGoogleCallback);

/** POST /api/admin/google-slides/unlink — revoke + clear vault. */
router.post('/api/admin/google-slides/unlink', requireAdmin, async (req, res) => {
  try {
    const r = await unlinkGoogleAccount({ actorId: actorId(req) });
    res.json({ ok: true, linked: r.linked });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

/** POST /api/admin/google-slides/deck — create presentation from canonical deck. */
router.post('/api/admin/google-slides/deck', requireAdmin, async (req, res) => {
  try {
    const r = await createFromCanonical({ title: req.body?.title || 'Deborah deck', document: req.body?.document, actorId: actorId(req) });
    if (!r.ok) return res.status(400).json({ error: r.error });
    res.json({ ok: true, presentationId: r.presentationId, presentationUrl: r.presentationUrl, slides: r.slides });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

/** POST /api/admin/google-slides/:id/export — export presentation (pptx/pdf). */
router.post('/api/admin/google-slides/:id/export', requireAdmin, async (req, res) => {
  try {
    const format = req.body?.format || 'pptx';
    const r = await exportGooglePresentation({ presentationId: req.params.id, format, actorId: actorId(req) });
    if (!r.ok) return res.status(400).json({ error: r.error });
    // JSON summary qaytariladi — view JSON bilan ishlaydi; raw binary
    // download alohida worker/route uchun (buffer browserga uzatilmaydi)
    res.json({ ok: true, size: r.size, mimeType: r.mimeType, format, presentationId: req.params.id });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

/** GET /admin/google-slides — admin page. */
router.get('/admin/google-slides', requireAdmin, (req, res) => {
  res.render('admin/google-slides', {
    title: 'Google Slides Adapter',
    user: req.session.admin,
    csrfToken: req.csrfToken?.(),
  });
});

export default router;
