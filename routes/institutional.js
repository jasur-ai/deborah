/**
 * Edikit — Institutional Handoff Routes (Prompt 72)
 *
 *   - GET  /admin/institutional                 — cutover/training/pilot/
 *     procurement readiness dashboard (requireAdmin)
 *   - GET  /admin/api/institutional/posture     — JSON posture (AJAX refresh)
 *   - POST /admin/api/institutional/backup      — final legacy backup + hash
 *   - POST /admin/api/institutional/dry-run     — migration dry-run review
 *   - POST /admin/api/institutional/reconcile   — reconciliation parity
 *   - POST /admin/api/institutional/cutover     — execute cutover (PG primary)
 *   - POST /admin/api/institutional/training    — record role training
 *   - POST /admin/api/institutional/practice    — student practice exam
 *   - POST /admin/api/institutional/pilot       — record pilot phase decision
 *   - POST /admin/api/institutional/procurement — procurement pack evidence
 *   - POST /admin/api/institutional/exit-test   — tenant export/restore/delete
 *
 * Security: requireAdmin on the whole router; every write is audited
 * (INSTITUTIONAL_*) + emits a telemetry metric (item 17).
 */

import { Router } from 'express';
import { requireAdmin } from '../middleware/auth.js';
import {
  getInstitutionalPosture,
  recordFinalBackup,
  recordMigrationDryRun,
  recordReconciliation,
  executeCutover,
  completeCutover,
  recordTraining,
  recordPracticeExam,
  recordPilotPhase,
  recordProcurementPack,
  recordExitTest,
  TRAINING_ROLES,
  PILOT_PHASES,
  PROCUREMENT_ITEMS,
} from '../src/modules/institutional/index.js';

const router = Router();
// Scope requireAdmin to the /admin prefix — the router is mounted at '/'
// with fully-qualified /admin/... routes; an unscoped router-level guard
// would gate the ENTIRE application behind admin auth.
router.use('/admin', requireAdmin);

function actorId(req) {
  return req.session?.admin?.id || req.session?.user?.id || null;
}

/** GET /admin/institutional — dashboard. */
router.get('/admin/institutional', async (req, res) => {
  try {
    const posture = await getInstitutionalPosture();
    res.render('admin/institutional', {
      title: 'Institutional Handoff',
      active: '/admin/institutional',
      user: req.session.user,
      admin: req.session.admin,
      posture,
      trainingRoles: TRAINING_ROLES,
      pilotPhases: PILOT_PHASES,
      procurementItems: PROCUREMENT_ITEMS,
    });
  } catch (err) {
    res.status(500).render('admin/institutional', {
      title: 'Institutional Handoff',
      active: '/admin/institutional',
      user: req.session.user,
      admin: req.session.admin,
      posture: null,
      trainingRoles: TRAINING_ROLES,
      pilotPhases: PILOT_PHASES,
      procurementItems: PROCUREMENT_ITEMS,
      error: err.message,
    });
  }
});

/** GET /admin/api/institutional/posture — JSON posture (AJAX). */
router.get('/admin/api/institutional/posture', async (req, res) => {
  try {
    const posture = await getInstitutionalPosture();
    res.json({ ok: true, posture });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/** POST /admin/api/institutional/backup — final legacy backup + hash. */
router.post('/admin/api/institutional/backup', async (req, res) => {
  try {
    const { dataHash, records } = req.body || {};
    const result = await recordFinalBackup({ dataHash, records, actorId: actorId(req) });
    return res.status(result.ok ? 200 : 400).json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/** POST /admin/api/institutional/dry-run — migration dry-run review. */
router.post('/admin/api/institutional/dry-run', async (req, res) => {
  try {
    const { reviewed, reportHash } = req.body || {};
    const result = await recordMigrationDryRun({ reviewed, reportHash, actorId: actorId(req) });
    return res.status(result.ok ? 200 : 400).json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/** POST /admin/api/institutional/reconcile — reconciliation parity. */
router.post('/admin/api/institutional/reconcile', async (req, res) => {
  try {
    const { legacy, migrated } = req.body || {};
    const result = await recordReconciliation({ legacy, migrated, actorId: actorId(req) });
    return res.status(result.ok ? 200 : 400).json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/** POST /admin/api/institutional/cutover — execute cutover (PG primary). */
router.post('/admin/api/institutional/cutover', async (req, res) => {
  try {
    const { gate0Ok, legalOk, supportOk, drOk } = req.body || {};
    const result = await executeCutover({ gate0Ok, legalOk, supportOk, drOk, actorId: actorId(req) });
    return res.status(result.ok ? 200 : 400).json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/** POST /admin/api/institutional/cutover/complete — mark completed. */
router.post('/admin/api/institutional/cutover/complete', async (req, res) => {
  try {
    const result = await completeCutover({ actorId: actorId(req) });
    return res.status(result.ok ? 200 : 400).json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/** POST /admin/api/institutional/training — record role training. */
router.post('/admin/api/institutional/training', async (req, res) => {
  try {
    const { role, completed, verifier } = req.body || {};
    const result = await recordTraining({ role, completed, verifier, actorId: actorId(req) });
    return res.status(result.ok ? 200 : 400).json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/** POST /admin/api/institutional/practice — student practice exam. */
router.post('/admin/api/institutional/practice', async (req, res) => {
  try {
    const { completed, attempts, participants, verifiedBy } = req.body || {};
    const result = await recordPracticeExam({ completed, attempts, participants, verifiedBy, actorId: actorId(req) });
    return res.status(result.ok ? 200 : 400).json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/** POST /admin/api/institutional/pilot — record pilot phase decision. */
router.post('/admin/api/institutional/pilot', async (req, res) => {
  try {
    const { phase, incidents, availability, dataLossIncidents, rollback } = req.body || {};
    const result = await recordPilotPhase({ phase, incidents, availability, dataLossIncidents, rollback, actorId: actorId(req) });
    return res.status(result.ok ? 200 : 400).json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/** POST /admin/api/institutional/procurement — procurement pack evidence. */
router.post('/admin/api/institutional/procurement', async (req, res) => {
  try {
    const { provided, owner } = req.body || {};
    const result = await recordProcurementPack({ provided, owner, actorId: actorId(req) });
    return res.status(result.ok ? 200 : 400).json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/** POST /admin/api/institutional/exit-test — tenant exit test. */
router.post('/admin/api/institutional/exit-test', async (req, res) => {
  try {
    const { completed, bundleHash, restoredOk, receipts } = req.body || {};
    const result = await recordExitTest({ completed, bundleHash, restoredOk, receipts, actorId: actorId(req) });
    return res.status(result.ok ? 200 : 400).json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

export default router;
