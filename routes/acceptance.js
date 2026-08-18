/**
 * Deborah — Final System Acceptance Routes (Prompt 73)
 *
 *   - GET  /admin/acceptance                     — release acceptance
 *     dashboard (requireAdmin)
 *   - GET  /admin/api/acceptance/release         — JSON release report
 *   - POST /admin/api/acceptance/evidence        — submit domain evidence
 *   - POST /admin/api/acceptance/review          — review domain evidence
 *   - POST /admin/api/acceptance/sign-off        — sign off a domain
 *   - POST /admin/api/acceptance/deferred        — record deferred features
 *   - POST /admin/api/acceptance/backlog         — record next-version item
 *
 * Security: requireAdmin on the whole router; every write is audited
 * (ACCEPTANCE_*) + emits a telemetry metric (item 17).
 */

import { Router } from 'express';
import { requireAdmin } from '../middleware/auth.js';
import {
  getReleaseReport,
  submitDomainEvidence,
  reviewDomain,
  signOffDomain,
  recordDeferredFeatures,
  recordBacklogItem,
  ACCEPTANCE_DOMAINS,
} from '../src/modules/acceptance/index.js';

const router = Router();
router.use('/admin', requireAdmin);

function actorId(req) {
  return req.session?.admin?.id || req.session?.user?.id || null;
}

/** GET /admin/acceptance — release acceptance dashboard. */
router.get('/admin/acceptance', async (req, res) => {
  try {
    const report = await getReleaseReport();
    res.render('admin/acceptance', {
      title: 'Release Acceptance',
      active: '/admin/acceptance',
      user: req.session.user,
      admin: req.session.admin,
      report,
      domains: ACCEPTANCE_DOMAINS,
    });
  } catch (err) {
    res.status(500).render('admin/acceptance', {
      title: 'Release Acceptance',
      active: '/admin/acceptance',
      user: req.session.user,
      admin: req.session.admin,
      report: null,
      domains: ACCEPTANCE_DOMAINS,
      error: err.message,
    });
  }
});

/** GET /admin/api/acceptance/release — JSON release report (AJAX). */
router.get('/admin/api/acceptance/release', async (req, res) => {
  try {
    const report = await getReleaseReport();
    res.json({ ok: true, report });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/** POST /admin/api/acceptance/evidence — submit domain evidence. */
router.post('/admin/api/acceptance/evidence', async (req, res) => {
  try {
    const { domainId, provided, owner, criticalRiskOwner } = req.body || {};
    const result = await submitDomainEvidence({ domainId, provided, owner, criticalRiskOwner });
    return res.status(result.ok ? 200 : 400).json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/** POST /admin/api/acceptance/review — review domain evidence. */
router.post('/admin/api/acceptance/review', async (req, res) => {
  try {
    const { domainId, reviewer, outcome } = req.body || {};
    const result = await reviewDomain({ domainId, reviewer, outcome });
    return res.status(result.ok ? 200 : 400).json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/** POST /admin/api/acceptance/sign-off — sign off a domain. */
router.post('/admin/api/acceptance/sign-off', async (req, res) => {
  try {
    const { domainId, signer } = req.body || {};
    const result = await signOffDomain({ domainId, signer });
    return res.status(result.ok ? 200 : 400).json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/** POST /admin/api/acceptance/deferred — record deferred high-risk features. */
router.post('/admin/api/acceptance/deferred', async (req, res) => {
  try {
    const { features } = req.body || {};
    const result = recordDeferredFeatures({ features });
    return res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/** POST /admin/api/acceptance/backlog — record next-version backlog item. */
router.post('/admin/api/acceptance/backlog', async (req, res) => {
  try {
    const { title, priority, owner, reason } = req.body || {};
    const result = await recordBacklogItem({ title, priority, owner, reason, actorId: actorId(req) });
    return res.status(result.ok ? 200 : 400).json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

export default router;
