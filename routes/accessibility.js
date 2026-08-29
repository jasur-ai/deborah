/**
 * Deborah — WCAG 2.2 AA & Artifact Accessibility Routes
 *
 * Prompt 64 REST API:
 *   - GET    /admin/accessibility                          — admin UI
 *   - GET    /api/admin/accessibility/settings?userKey=    — get settings
 *   - POST   /api/admin/accessibility/settings             — upsert settings
 *   - POST   /api/admin/accessibility/audits               — run audit (ACR)
 *   - GET    /api/admin/accessibility/audits               — list audits
 *   - POST   /api/admin/accessibility/gaps                 — create gap
 *   - POST   /api/admin/accessibility/gaps/:id/status      — gap FSM
 *   - GET    /api/admin/accessibility/gaps                 — list gaps
 *   - POST   /api/admin/accessibility/artifacts            — artifact QA
 *   - GET    /api/admin/accessibility/artifacts            — list artifact checks
 *   - GET    /api/admin/accessibility/summary              — dashboard summary
 *
 * Security (Prompt 64 §15-17): hamma route'lar requireAdmin; automated
 * checker yetarli emas — inson verification (ACR sign-off) talab qilinadi;
 * privileged actionlar audited.
 */

import { Router } from 'express';
import { requireAdmin } from '../middleware/auth.js';
import {
  getAccessibilitySettings,
  saveAccessibilitySettings,
  runAudit,
  listAudits,
  createGap,
  transitionGapStatus,
  listGaps,
  checkArtifact,
  listArtifactChecks,
  getAccessibilitySummary,
} from '../src/modules/accessibility/index.js';

const router = Router();

function actorId(req) {
  return req.session?.admin?.username || req.session?.admin?.id || req.session?.user?.username || req.session?.user?.id || null;
}

/** GET /admin/accessibility — admin UI. */
router.get('/admin/accessibility', requireAdmin, (req, res) => {
  res.render('admin/accessibility', {
    title: 'Accessibility',
    user: req.session.admin,
    csrfToken: req.csrfToken?.(),
  });
});

// ── Settings ────────────────────────────────────────────────────────

router.get('/api/admin/accessibility/settings', requireAdmin, async (req, res) => {
  try {
    const settings = await getAccessibilitySettings({ userKey: req.query.userKey || 'default' });
    res.json({ ok: true, settings });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

router.post('/api/admin/accessibility/settings', requireAdmin, async (req, res) => {
  try {
    const r = await saveAccessibilitySettings({
      userKey: req.body.userKey || 'default',
      reducedMotion: req.body.reducedMotion === true,
      highContrast: req.body.highContrast === true,
      fontScale: Number(req.body.fontScale) || 1,
      keyboardNav: req.body.keyboardNav === true,
      screenReaderMode: req.body.screenReaderMode === true,
      updatedBy: actorId(req),
    });
    if (!r.ok) return res.status(400).json({ ok: false, error: r.error });
    res.json(r);
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ── Audits (ACR) ────────────────────────────────────────────────────

router.post('/api/admin/accessibility/audits', requireAdmin, async (req, res) => {
  try {
    const r = await runAudit({
      journey: req.body.journey || 'student',
      pageUrl: req.body.pageUrl || '',
      snapshot: req.body.snapshot || null,
      runBy: actorId(req),
    });
    if (!r.ok) return res.status(400).json({ ok: false, error: r.error });
    res.json(r);
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

router.get('/api/admin/accessibility/audits', requireAdmin, async (req, res) => {
  try {
    const audits = await listAudits({ journey: req.query.journey || null, limit: req.query.limit });
    res.json({ ok: true, audits });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ── Gap backlog ─────────────────────────────────────────────────────

router.post('/api/admin/accessibility/gaps', requireAdmin, async (req, res) => {
  try {
    const r = await createGap({
      ruleId: req.body.ruleId,
      description: req.body.description,
      journey: req.body.journey || 'student',
      impact: req.body.impact || '',
      severity: req.body.severity || 'major',
      isTimed: req.body.isTimed === true,
      assignee: req.body.assignee || null,
      targetDate: req.body.targetDate || null,
      createdBy: actorId(req),
    });
    if (!r.ok) return res.status(400).json({ ok: false, error: r.error });
    res.json(r);
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

router.post('/api/admin/accessibility/gaps/:id/status', requireAdmin, async (req, res) => {
  try {
    const r = await transitionGapStatus({
      gapId: Number(req.params.id),
      to: req.body.to || '',
      verifiedBy: req.body.verifiedBy || '',
      actorId: actorId(req),
    });
    if (!r.ok) return res.status(400).json({ ok: false, error: r.error });
    res.json(r);
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

router.get('/api/admin/accessibility/gaps', requireAdmin, async (req, res) => {
  try {
    const gaps = await listGaps({
      status: req.query.status || null,
      blockerOnly: req.query.blockerOnly === 'true',
      limit: req.query.limit,
    });
    res.json({ ok: true, gaps });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ── Artifact QA ─────────────────────────────────────────────────────

router.post('/api/admin/accessibility/artifacts', requireAdmin, async (req, res) => {
  try {
    const r = await checkArtifact({
      artifactType: req.body.artifactType || 'pdf',
      artifactId: Number(req.body.artifactId) || 0,
      readingOrderOk: req.body.readingOrderOk === true,
      images: Array.isArray(req.body.images) ? req.body.images : [],
      contrastPairs: Array.isArray(req.body.contrastPairs) ? req.body.contrastPairs : [],
      tagged: req.body.tagged === true,
      checkedBy: actorId(req),
    });
    if (!r.ok) return res.status(400).json({ ok: false, error: r.error });
    res.json(r);
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

router.get('/api/admin/accessibility/artifacts', requireAdmin, async (req, res) => {
  try {
    const artifacts = await listArtifactChecks({ artifactType: req.query.artifactType || null, limit: req.query.limit });
    res.json({ ok: true, artifacts });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ── Summary ─────────────────────────────────────────────────────────

router.get('/api/admin/accessibility/summary', requireAdmin, async (req, res) => {
  try {
    const summary = await getAccessibilitySummary();
    res.json(summary);
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

export default router;
