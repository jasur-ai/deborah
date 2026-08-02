/**
 * Edikit — Reliability Guard Routes (Prompt 71)
 *
 *   - GET  /admin/reliability             — DR/load/chaos/release readiness
 *     dashboard (requireAdmin)
 *   - GET  /admin/api/reliability/posture — JSON posture (AJAX refresh)
 *   - POST /admin/api/reliability/load    — record a load profile run
 *   - POST /admin/api/reliability/chaos   — record a chaos drill
 *   - POST /admin/api/reliability/backup  — record a backup restore (RPO/RTO)
 *   - POST /admin/api/reliability/drain   — record a drain sequence
 *   - POST /admin/api/reliability/freeze  — record the high-stakes freeze runbook
 *
 * Security: requireAdmin on the whole router; every rehearsal recording is
 * audited (RELIABILITY_*) and emits a telemetry metric (item 17).
 */

import { Router } from 'express';
import { requireAdmin } from '../middleware/auth.js';
import {
  getReliabilityPosture,
  recordLoadRun,
  recordChaosDrill,
  recordBackupRestore,
  recordDrain,
  recordFreeze,
  LOAD_PROFILES,
  CHAOS_SCENARIOS,
  BACKUP_TYPES,
} from '../src/modules/reliability/index.js';

const router = Router();
// Scope requireAdmin to the /admin prefix — the router is mounted at '/'
// with fully-qualified /admin/... routes; an unscoped router-level guard
// would gate the ENTIRE application behind admin auth.
router.use('/admin', requireAdmin);

function actorId(req) {
  return req.session?.admin?.id || req.session?.user?.id || null;
}

/** GET /admin/reliability — dashboard. */
router.get('/admin/reliability', async (req, res) => {
  try {
    const posture = await getReliabilityPosture();
    res.render('admin/reliability', {
      title: 'Reliability',
      active: '/admin/reliability',
      user: req.session.user,
      admin: req.session.admin,
      posture,
      loadProfiles: LOAD_PROFILES,
      chaosScenarios: CHAOS_SCENARIOS,
      backupTypes: BACKUP_TYPES,
    });
  } catch (err) {
    res.status(500).render('admin/reliability', {
      title: 'Reliability',
      active: '/admin/reliability',
      user: req.session.user,
      admin: req.session.admin,
      posture: null,
      loadProfiles: LOAD_PROFILES,
      chaosScenarios: CHAOS_SCENARIOS,
      backupTypes: BACKUP_TYPES,
      error: err.message,
    });
  }
});

/** GET /admin/api/reliability/posture — JSON posture (AJAX). */
router.get('/admin/api/reliability/posture', async (req, res) => {
  try {
    const posture = await getReliabilityPosture();
    res.json({ ok: true, posture });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/**
 * Send a rehearsal recording response.
 * A recorded evaluation (even a FAILED drill) returns 200 — the failed drill
 * is legitimate evidence that MUST stay visible on the dashboard (item 15:
 * failures must not pass, but they must be recorded). Only unrecorded
 * rejections (data guard / invalid input — the service returns `error` and
 * skips the registry) return 400.
 */
function sendRehearsalResult(res, result) {
  if (result.error) return res.status(400).json(result);
  return res.json(result);
}

/** POST /admin/api/reliability/load — record a load profile run. */
router.post('/admin/api/reliability/load', async (req, res) => {
  try {
    const { profileId, observed, dataset } = req.body || {};
    const result = await recordLoadRun({ profileId, observed, dataset, actorId: actorId(req) });
    return sendRehearsalResult(res, result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/** POST /admin/api/reliability/chaos — record a chaos drill. */
router.post('/admin/api/reliability/chaos', async (req, res) => {
  try {
    const { scenarioId, observed } = req.body || {};
    const result = await recordChaosDrill({ scenarioId, observed, actorId: actorId(req) });
    return sendRehearsalResult(res, result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/** POST /admin/api/reliability/backup — record a backup restore (RPO/RTO evidence). */
router.post('/admin/api/reliability/backup', async (req, res) => {
  try {
    const { backupType, observed } = req.body || {};
    const result = await recordBackupRestore({ backupType, observed, actorId: actorId(req) });
    return sendRehearsalResult(res, result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/** POST /admin/api/reliability/drain — record a drain sequence. */
router.post('/admin/api/reliability/drain', async (req, res) => {
  try {
    const { completedSteps, zeroInflight } = req.body || {};
    const result = await recordDrain({ completedSteps, zeroInflight, actorId: actorId(req) });
    return sendRehearsalResult(res, result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/** POST /admin/api/reliability/freeze — record the high-stakes freeze runbook. */
router.post('/admin/api/reliability/freeze', async (req, res) => {
  try {
    const { freezeActive, windowStart, windowEnd, rollbackVerified } = req.body || {};
    const result = await recordFreeze({ freezeActive, windowStart, windowEnd, rollbackVerified, actorId: actorId(req) });
    return sendRehearsalResult(res, result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

export default router;
