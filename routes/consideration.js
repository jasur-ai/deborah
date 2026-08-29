/**
 * Deborah — Special Consideration, Deferral, Resit, Appeal & Scoring
 * Incident Routes
 *
 * Prompt 48 REST API:
 *   - GET  /api/admin/cases/meta                    — constants for admin UI
 *   - POST /api/admin/cases                         — create case (DRAFT)
 *   - GET  /api/admin/cases                         — list cases
 *   - GET  /api/admin/cases/:id                     — case detail (+overdue)
 *   - POST /api/admin/cases/:id/transition          — state machine transition
 *   - POST /api/admin/cases/:id/decide              — HUMAN decision
 *   - POST /api/admin/cases/:id/evidence            — add encrypted evidence
 *   - GET  /api/admin/cases/:id/evidence/:evId      — decrypt (ACL-gated)
 *   - GET  /api/admin/cases/:id/decisions           — decision history
 *   - POST /api/admin/cases/:id/remedies            — schedule remedy (lineage)
 *   - GET  /api/admin/cases/:id/remedies            — remedy list
 *   - POST /api/admin/cases/remedies/:id/complete   — complete remedy
 *   - POST /api/admin/scoring-incidents             — create scoring incident
 *   - GET  /api/admin/scoring-incidents             — list incidents
 *   - POST /api/admin/scoring-incidents/:id/freeze  — FREEZE (release block)
 *   - POST /api/admin/scoring-incidents/:id/impacts — add before/after impact
 *   - GET  /api/admin/scoring-incidents/:id/impacts — impact list
 *   - POST /api/admin/scoring-incidents/:id/rescore — IDEMPOTENT rescore
 *   - GET  /api/admin/scoring-incidents/:id/rescores— rescore runs
 *
 * NOTE: the generic /api/admin/incidents prefix is owned by the
 * command-center module (evacuation incidents) — scoring incidents live
 * under /api/admin/scoring-incidents to avoid a route collision.
 *   - GET  /admin/consideration                     — admin page
 *
 * Security (Prompt 48):
 *   - requireAdmin on all write paths; actor id from session.
 *   - AI case hukmi chiqarmaydi — decide requires a human decider.
 *   - Evidence encrypted + ACL — marker/proctor sensitive evidence
 *     ko'rmaydi (§72.2).
 *   - Rescore idempotent; grade change via board amendment ledger.
 */

import { Router } from 'express';
import { requireAdmin } from '../middleware/auth.js';
import { appendAmendment } from '../src/modules/board/index.js';
import {
  createCase,
  transitionCase,
  decideCase,
  addCaseEvidence,
  getCaseEvidence,
  scheduleRemedy,
  completeRemedy,
  createScoringIncident,
  freezeIncident,
  addIncidentImpact,
  rescoreAttempt,
  getCase,
  listCases,
  listCaseDecisions,
  listCaseRemedies,
  listIncidents,
  listIncidentImpacts,
  listRescoreRuns,
  CASE_TYPES,
  CASE_STATUS,
  REMEDY_TYPES,
  INCIDENT_STATUS,
  INCIDENT_KINDS,
  INCIDENT_REMEDIES,
  CONSIDERATION_DEFAULTS,
} from '../src/modules/consideration/index.js';

const router = Router();

function actorId(req) {
  return req.session?.admin?.id || req.session?.user?.id || null;
}

// ═══════════════════════════════════════════════════════════════════
// META / CONSTANTS
// ═══════════════════════════════════════════════════════════════════

/** GET /api/admin/cases/meta — constants for the admin UI. */
router.get('/api/admin/cases/meta', requireAdmin, (req, res) => {
  res.json({
    caseTypes: CASE_TYPES,
    caseStatus: CASE_STATUS,
    remedyTypes: REMEDY_TYPES,
    incidentStatus: INCIDENT_STATUS,
    incidentKinds: INCIDENT_KINDS,
    incidentRemedies: INCIDENT_REMEDIES,
    defaults: CONSIDERATION_DEFAULTS,
  });
});

// ═══════════════════════════════════════════════════════════════════
// CASES
// ═══════════════════════════════════════════════════════════════════

/** POST /api/admin/cases — create a case (DRAFT). */
router.post('/api/admin/cases', requireAdmin, async (req, res) => {
  try {
    const { caseType, userId, attemptId, runId, grounds, summary, ownerUserId, slaDays } = req.body || {};
    const result = await createCase({
      caseType, userId, attemptId, runId, grounds, summary, ownerUserId, slaDays,
      createdBy: actorId(req),
    });
    res.status(result.ok ? 201 : 400).json(result);
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

/** GET /api/admin/cases — list cases. */
router.get('/api/admin/cases', requireAdmin, async (req, res) => {
  try {
    const rows = await listCases({ status: req.query.status, caseType: req.query.caseType });
    res.json({ ok: true, rows });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

/** GET /api/admin/cases/:id — case detail. */
router.get('/api/admin/cases/:id', requireAdmin, async (req, res) => {
  try {
    const row = await getCase(Number(req.params.id), req.session);
    if (!row) return res.status(404).json({ ok: false, error: 'Case not found' });
    const decisions = await listCaseDecisions({ caseId: Number(req.params.id) });
    const remedies = await listCaseRemedies({ caseId: Number(req.params.id) });
    res.json({ ok: true, case: row, decisions, remedies });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

/** POST /api/admin/cases/:id/transition — state machine transition. */
router.post('/api/admin/cases/:id/transition', requireAdmin, async (req, res) => {
  try {
    const { to } = req.body || {};
    const result = await transitionCase({ caseId: Number(req.params.id), to, actorId: actorId(req) });
    res.status(result.ok ? 200 : 400).json(result);
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

/** POST /api/admin/cases/:id/decide — HUMAN decision (AI hukmi yo'q). */
router.post('/api/admin/cases/:id/decide', requireAdmin, async (req, res) => {
  try {
    const { decision, reason } = req.body || {};
    const result = await decideCase({
      caseId: Number(req.params.id), decision, reason,
      decidedBy: actorId(req) || req.session?.admin?.username || null,
    });
    res.status(result.ok ? 200 : 400).json(result);
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

/** POST /api/admin/cases/:id/evidence — add encrypted evidence. */
router.post('/api/admin/cases/:id/evidence', requireAdmin, async (req, res) => {
  try {
    const { evidenceType, fileName, plaintext, accessRole } = req.body || {};
    const result = await addCaseEvidence({
      caseId: Number(req.params.id), evidenceType, fileName, plaintext, accessRole,
      createdBy: actorId(req),
    });
    res.status(result.ok ? 201 : 400).json(result);
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

/** GET /api/admin/cases/:id/evidence/:evId — ACL-gated decrypt. */
router.get('/api/admin/cases/:id/evidence/:evId', requireAdmin, async (req, res) => {
  try {
    const row = await getCaseEvidence({
      caseId: Number(req.params.id),
      evidenceId: Number(req.params.evId),
      session: req.session,
    });
    if (!row) return res.status(404).json({ ok: false, error: 'Evidence not found' });
    res.json({ ok: true, evidence: row });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

/** GET /api/admin/cases/:id/decisions — decision history. */
router.get('/api/admin/cases/:id/decisions', requireAdmin, async (req, res) => {
  try {
    const rows = await listCaseDecisions({ caseId: Number(req.params.id) });
    res.json({ ok: true, rows });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

// ═══════════════════════════════════════════════════════════════════
// REMEDIES (attempt lineage)
// ═══════════════════════════════════════════════════════════════════

/** POST /api/admin/cases/:id/remedies — schedule a remedy. */
router.post('/api/admin/cases/:id/remedies', requireAdmin, async (req, res) => {
  try {
    const {
      remedyType, adjustment, countsAsAttempt, capRule, capPolicyVersion,
      supersedesAttemptId, newAttemptId, equivalentAssignmentId,
    } = req.body || {};
    const result = await scheduleRemedy({
      caseId: Number(req.params.id), remedyType, adjustment, countsAsAttempt,
      capRule, capPolicyVersion, supersedesAttemptId, newAttemptId, equivalentAssignmentId,
      createdBy: actorId(req),
    });
    res.status(result.ok ? 201 : 400).json(result);
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

/** GET /api/admin/cases/:id/remedies — remedy list. */
router.get('/api/admin/cases/:id/remedies', requireAdmin, async (req, res) => {
  try {
    const rows = await listCaseRemedies({ caseId: Number(req.params.id) });
    res.json({ ok: true, rows });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

/** POST /api/admin/cases/remedies/:id/complete — complete remedy. */
router.post('/api/admin/cases/remedies/:id/complete', requireAdmin, async (req, res) => {
  try {
    const result = await completeRemedy({ remedyId: Number(req.params.id), actorId: actorId(req) });
    res.status(result.ok ? 200 : 400).json(result);
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

// ═══════════════════════════════════════════════════════════════════
// SCORING INCIDENTS
// ═══════════════════════════════════════════════════════════════════

/** POST /api/admin/scoring-incidents — create a scoring incident. */
router.post('/api/admin/scoring-incidents', requireAdmin, async (req, res) => {
  try {
    const { assessmentId, title, kind, severity, description } = req.body || {};
    const result = await createScoringIncident({
      assessmentId, title, kind, severity, description, createdBy: actorId(req),
    });
    res.status(result.ok ? 201 : 400).json(result);
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

/** GET /api/admin/scoring-incidents — list incidents. */
router.get('/api/admin/scoring-incidents', requireAdmin, async (req, res) => {
  try {
    const rows = await listIncidents({ status: req.query.status });
    res.json({ ok: true, rows });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

/** POST /api/admin/scoring-incidents/:id/freeze — FREEZE (release block). */
router.post('/api/admin/scoring-incidents/:id/freeze', requireAdmin, async (req, res) => {
  try {
    const result = await freezeIncident({ incidentId: Number(req.params.id), actorId: actorId(req) });
    res.status(result.ok ? 200 : 400).json(result);
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

/** POST /api/admin/scoring-incidents/:id/impacts — add before/after impact. */
router.post('/api/admin/scoring-incidents/:id/impacts', requireAdmin, async (req, res) => {
  try {
    const { userId, attemptId, scoreBefore, scoreAfter, noDetriment } = req.body || {};
    const result = await addIncidentImpact({
      incidentId: Number(req.params.id), userId, attemptId, scoreBefore, scoreAfter, noDetriment,
      createdBy: actorId(req),
    });
    res.status(result.ok ? 201 : 400).json(result);
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

/** GET /api/admin/scoring-incidents/:id/impacts — impact list. */
router.get('/api/admin/scoring-incidents/:id/impacts', requireAdmin, async (req, res) => {
  try {
    const rows = await listIncidentImpacts({ incidentId: Number(req.params.id) });
    res.json({ ok: true, rows });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

/** POST /api/admin/scoring-incidents/:id/rescore — IDEMPOTENT rescore. */
router.post('/api/admin/scoring-incidents/:id/rescore', requireAdmin, async (req, res) => {
  try {
    const { attemptId, runId, newFinal, reason } = req.body || {};
    const result = await rescoreAttempt({
      incidentId: Number(req.params.id), attemptId, runId, newFinal, reason,
      amend: appendAmendment, // grade change via board ledger (§71.6)
      changedBy: actorId(req),
    });
    res.status(result.ok ? 200 : 400).json(result);
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

/** GET /api/admin/scoring-incidents/:id/rescores — rescore runs. */
router.get('/api/admin/scoring-incidents/:id/rescores', requireAdmin, async (req, res) => {
  try {
    const rows = await listRescoreRuns({ incidentId: Number(req.params.id) });
    res.json({ ok: true, rows });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

// ═══════════════════════════════════════════════════════════════════
// ADMIN PAGE
// ═══════════════════════════════════════════════════════════════════

/** GET /admin/consideration — admin case console. */
router.get('/admin/consideration', requireAdmin, (req, res) => {
  res.render('admin/consideration', {
    title: 'Special Consideration',
    user: req.session.admin,
    csrfToken: req.csrfToken ? req.csrfToken() : '',
  });
});

export default router;
