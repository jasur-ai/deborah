/**
 * AUTH B-34 — Signup review queue (admin)
 * -------------------------------------------------
 * Suspicious signup'lar (velocity/fingerprint/domain) admin tomonidan ko'rib
 * chiqiladi: list pending → approve | reject (MFA step-up talab qilinadi).
 * Mount: /admin (requireAdmin ichida), teachers.js pattern'i bilan bir xil.
 */
import { Router } from 'express';
import { requireAdmin, requireRecentAdminAuth, requireAdminMfaStepUp } from '../../middleware/auth.js';
import { listSignupReviews, resolveSignupReview, signupReviewDepth } from '../../src/modules/auth/bot-guard.js';

const router = Router();
router.use(requireAdmin);

// ── GET /admin/api/signup-reviews?status=pending|approved|rejected ──
router.get('/api/signup-reviews', async (req, res) => {
  try {
    const status = req.query.status === 'approved' || req.query.status === 'rejected'
      ? req.query.status : 'pending';
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const reviews = await listSignupReviews({ status, limit });
    const depth = await signupReviewDepth();
    res.json({ ok: true, status, reviews, pendingDepth: depth });
  } catch (err) {
    res.status(500).json({ ok: false, error: 'internal' });
  }
});

// ── POST /admin/api/signup-reviews/:id/approve ──
router.post('/api/signup-reviews/:id/approve', requireRecentAdminAuth, requireAdminMfaStepUp, async (req, res) => {
  const r = await resolveSignupReview({ id: req.params.id, decision: 'approve', adminId: req.session.admin?.username || null });
  if (!r.ok) {
    const code = r.error === 'not-found' ? 404 : (r.error === 'not-pending' ? 409 : 400);
    return res.status(code).json({ ok: false, error: r.error });
  }
  res.json({ ok: true });
});

// ── POST /admin/api/signup-reviews/:id/reject ──
router.post('/api/signup-reviews/:id/reject', requireRecentAdminAuth, requireAdminMfaStepUp, async (req, res) => {
  const r = await resolveSignupReview({ id: req.params.id, decision: 'reject', adminId: req.session.admin?.username || null });
  if (!r.ok) {
    const code = r.error === 'not-found' ? 404 : (r.error === 'not-pending' ? 409 : 400);
    return res.status(code).json({ ok: false, error: r.error });
  }
  res.json({ ok: true });
});

export default router;
