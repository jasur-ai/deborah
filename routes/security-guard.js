/**
 * Edikit — Security Guard Routes (Prompt 70)
 *
 *   - GET  /admin/security-guard           — threat model + ASVS + findings
 *     + red-team dashboard (requireAdmin)
 *   - GET  /admin/api/security-guard/posteure — JSON posture report (AJAX refresh)
 *   - POST /admin/api/security-guard/findings/:id/accept    — accept a finding
 *     (security/data guard: critical/high rejected)
 *   - POST /admin/api/security-guard/findings/:id/remediate — close with retest evidence
 *
 * Security: requireAdmin on the whole router; every privileged action is
 * audited (SECURITY_FINDING_ACCEPT / SECURITY_FINDING_REMEDIATE /
 * SECURITY_POSTURE_REPORT) and emits a telemetry metric (item 17).
 */

import { Router } from 'express';
import { requireAdmin } from '../middleware/auth.js';
import {
  getSecurityPosture,
  acceptFinding,
  remediateFinding,
  seedFindings,
} from '../src/modules/security-guard/index.js';
import { getAuditEvidence } from '../src/modules/security-guard/evidence-loader.js';

const router = Router();
// Scope requireAdmin to the /admin prefix — the router is mounted at '/'
// with fully-qualified /admin/... routes; an unscoped router-level guard
// would gate the ENTIRE application behind admin auth.
router.use('/admin', requireAdmin);

function actorId(req) {
  return req.session?.admin?.id || req.session?.user?.id || null;
}

/** GET /admin/security-guard — dashboard. */
router.get('/admin/security-guard', async (req, res) => {
  try {
    const evidence = await getAuditEvidence();
    const posture = await getSecurityPosture({
      implementedControls: evidence.implementedControls,
      asvsEvidence: evidence.asvsEvidence,
    });
    res.render('admin/security-guard', {
      title: 'Security Guard',
      active: '/admin/security-guard',
      user: req.session.user,
      admin: req.session.admin,
      posture,
    });
  } catch (err) {
    res.status(500).render('admin/security-guard', {
      title: 'Security Guard',
      active: '/admin/security-guard',
      user: req.session.user,
      admin: req.session.admin,
      posture: null,
      error: err.message,
    });
  }
});

/** GET /admin/api/security-guard/posture — JSON posture (AJAX). */
router.get('/admin/api/security-guard/posture', async (req, res) => {
  try {
    const evidence = await getAuditEvidence();
    const posture = await getSecurityPosture({
      implementedControls: evidence.implementedControls,
      asvsEvidence: evidence.asvsEvidence,
    });
    res.json({ ok: true, posture });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/** POST .../findings/:id/accept — accept a finding (guard enforced). */
router.post('/admin/api/security-guard/findings/:id/accept', async (req, res) => {
  try {
    const { owner, rationale, acceptedUntil } = req.body || {};
    const result = await acceptFinding({
      id: req.params.id,
      owner,
      rationale,
      acceptedUntil,
      actorId: actorId(req),
    });
    if (!result.ok) return res.status(400).json({ error: result.reason });
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/** POST .../findings/:id/remediate — close with retest evidence. */
router.post('/admin/api/security-guard/findings/:id/remediate', async (req, res) => {
  try {
    const { retestDate, verifiedBy, testName, evidenceNote } = req.body || {};
    const result = await remediateFinding({
      id: req.params.id,
      retestDate,
      verifiedBy,
      testName,
      evidenceNote,
      actorId: actorId(req),
    });
    if (!result.ok) return res.status(400).json({ error: result.reason });
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/** POST /admin/api/security-guard/seed — (dev/test) seed the finding registry. */
router.post('/admin/api/security-guard/seed', async (req, res) => {
  try {
    const count = seedFindings(req.body?.findings || []);
    res.json({ ok: true, count });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

export default router;
