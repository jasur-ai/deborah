/**
 * Deborah — Privacy-first Camera Evidence Pilot Routes
 *
 * Prompt 37 REST API:
 *   - GET  /api/admin/camera/policy           — pilot policy (requireAdmin)
 *   - PUT  /api/admin/camera/policy           — upsert pilot policy (audited)
 *   - GET  /api/student/assignments/:id/camera/status — sanitized pilot +
 *     consent status for the preflight/consent UI (requireAuth)
 *   - POST /api/student/assignments/:id/camera/consent — grant consent
 *   - DELETE /api/student/assignments/:id/camera/consent — revoke consent
 *   - POST /api/student/attempts/:id/camera/evidence — flags-only ingest
 *     (idempotent by client_seq; normal frames discarded server-side)
 *   - GET  /api/admin/attempts/:id/camera/review — teacher review timeline
 *   - POST /api/admin/camera/evidence/:id/disposition — human review decision
 *   - POST /api/admin/camera/retention          — enforce retention delete
 *   - GET  /user/camera-pilot                   — consent + preflight UI page
 *   - GET  /admin/camera-review                 — teacher review UI page
 *
 * Security / data guard (Prompt 37 §15):
 *   - Emotion/gaze/honesty/misconduct maydonlari client'dan kelsa ham schema
 *     darajasida reject (validateEvidenceFlags whitelist).
 *   - Pilot OFF → ingest no-op (alternative path). Consent yo'q → reject.
 *   - Review/disposition/retention — privilege'd (requireAdmin) + audited.
 */

import { Router } from 'express';
import { requireAdmin, requireAuth } from '../middleware/auth.js';
import {
  getCameraPilotPolicy,
  upsertCameraPilotPolicy,
  getStudentPilotStatus,
  grantCameraConsent,
  revokeCameraConsent,
  recordCameraEvidence,
  getCameraReviewTimeline,
  reviewCameraEvidence,
  enforceCameraRetention,
} from '../src/modules/camera/index.js';

const router = Router();

function actorId(req) {
  return req.session?.admin?.id || req.session?.user?.id || null;
}

/** GET /api/admin/camera/policy — pilot policy (requireAdmin). */
router.get('/api/admin/camera/policy', requireAdmin, async (req, res) => {
  try {
    const policy = await getCameraPilotPolicy();
    res.json({ ok: true, policy });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/** PUT /api/admin/camera/policy — upsert pilot policy (audited, requireAdmin). */
router.put('/api/admin/camera/policy', requireAdmin, async (req, res) => {
  try {
    const {
      pilotEnabled,
      fpsMin,
      fpsMax,
      windowMs,
      snapshotLimit,
      retentionDays,
      consentVersion,
    } = req.body || {};
    const result = await upsertCameraPilotPolicy({
      pilotEnabled,
      fpsMin,
      fpsMax,
      windowMs,
      snapshotLimit,
      retentionDays,
      consentVersion,
      actorId: actorId(req),
    });
    if (result.ok === false) {
      return res.status(400).json({ error: result.errors?.join('; ') || 'Invalid policy' });
    }
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/** GET /api/student/assignments/:id/camera/status — pilot + consent status (requireAuth). */
router.get('/api/student/assignments/:id/camera/status', requireAuth, async (req, res) => {
  try {
    const userId = actorId(req);
    const result = await getStudentPilotStatus(parseInt(req.params.id, 10), userId);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/** POST /api/student/assignments/:id/camera/consent — grant consent (requireAuth). */
router.post('/api/student/assignments/:id/camera/consent', requireAuth, async (req, res) => {
  try {
    const userId = actorId(req);
    if (!userId) return res.status(401).json({ error: 'Authentication required' });
    const result = await grantCameraConsent({
      userId,
      assignmentId: parseInt(req.params.id, 10),
    });
    if (result.ok === false) return res.status(400).json({ error: result.errors?.join('; ') || 'Consent failed' });
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/** DELETE /api/student/assignments/:id/camera/consent — revoke consent (requireAuth). */
router.delete('/api/student/assignments/:id/camera/consent', requireAuth, async (req, res) => {
  try {
    const userId = actorId(req);
    const result = await revokeCameraConsent({
      userId,
      assignmentId: parseInt(req.params.id, 10),
    });
    if (result.ok === false) return res.status(400).json({ error: result.errors?.join('; ') || 'Revoke failed' });
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/** POST /api/student/attempts/:id/camera/evidence — flags-only ingest (requireAuth). */
router.post('/api/student/attempts/:id/camera/evidence', requireAuth, async (req, res) => {
  try {
    const userId = actorId(req);
    const { samples = [] } = req.body || {};
    if (!Array.isArray(samples) || samples.length > 500) {
      return res.status(400).json({ error: 'samples must be an array (max 500)' });
    }

    const result = await recordCameraEvidence({
      attemptId: parseInt(req.params.id, 10),
      userId,
      samples,
    });

    if (result.ok === false) {
      if (result.code === 'consent_required') return res.status(403).json({ error: result.reason });
      if (result.code === 'not_found') return res.status(404).json({ error: result.reason });
      if (result.code === 'forbidden') return res.status(403).json({ error: result.reason });
      return res.status(400).json({ error: result.reason || 'Evidence rejected' });
    }
    // Data guard visible: forbidden-field payloadlari 400 qaytaradi.
    if (result.rejected > 0 && result.accepted === 0) {
      return res.status(400).json({
        error: result.errors?.join('; ') || 'All samples rejected',
        ...result,
      });
    }
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/** GET /api/admin/attempts/:id/camera/review — teacher review timeline (requireAdmin). */
router.get('/api/admin/attempts/:id/camera/review', requireAdmin, async (req, res) => {
  try {
    const result = await getCameraReviewTimeline(parseInt(req.params.id, 10), true);
    if (result.ok === false) return res.status(400).json({ error: result.reason });
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/** POST /api/admin/camera/evidence/:id/disposition — human review (requireAdmin). */
router.post('/api/admin/camera/evidence/:id/disposition', requireAdmin, async (req, res) => {
  try {
    const { disposition, note } = req.body || {};
    const result = await reviewCameraEvidence({
      evidenceId: parseInt(req.params.id, 10),
      disposition,
      note,
      actorId: actorId(req),
    });
    if (result.ok === false) return res.status(400).json({ error: result.errors?.join('; ') || 'Disposition failed' });
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/** POST /api/admin/camera/retention — enforce retention delete (audited, requireAdmin). */
router.post('/api/admin/camera/retention', requireAdmin, async (req, res) => {
  try {
    const result = await enforceCameraRetention({ actorId: actorId(req) });
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/** GET /user/camera-pilot — consent + preflight UI page. */
router.get('/user/camera-pilot', (req, res) => {
  if (!req.session?.user) return res.redirect('/user/login');
  res.render('user/camera-pilot', {
    title: 'Kamera piloti',
    user: req.session.user,
  });
});

/** GET /admin/camera-review — teacher review UI page. */
router.get('/admin/camera-review', (req, res) => {
  if (!req.session?.admin) return res.redirect('/admin/login');
  res.render('admin/camera-review', {
    title: 'Kamera evidence review',
    admin: req.session.admin,
  });
});

export default router;
