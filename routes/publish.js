/**
 * Deborah — Immutable Publish Transaction & Assignment Snapshot API Routes
 *
 * REST API for Prompt 27:
 *   - POST /api/publish/plan — deterministic dry-run of a publish
 *   - POST /api/publish — atomic publish (one transaction: snapshots +
 *     calendar + outbox)
 *   - GET /api/assignments[/:id] — assignment reads
 *   - GET /api/assignments/:id/public-items — student-facing public surface
 *   - GET /api/assignments/:id/private-scores — scoring keys (authorized callers)
 *   - GET /api/assignments/:id/roster — roster snapshot
 *   - GET /api/assignments/:id/notifications — outbox reads
 *   - GET /api/assignments/:id/verify — integrity/immutability check
 *
 * Security: private-scores endpoint must only be exposed to scoring-authorized
 * callers (the route checks session role); the public-items endpoint never
 * returns private columns (they don't exist on the public table).
 */

import { Router } from 'express';
import {
  // schema (pure)
  ASSIGNMENT_STATUS,
  ASSIGNMENT_STATUS_TRANSITIONS,
  NOTIFICATION_TYPES,
  NOTIFICATION_SCOPES,
  planPublish,
  derivePublishKey,
  rosterHash,
  canonicalHash,
  verifyPublicSnapshotClean,
  // service
  publishAssignment,
  getAssignment,
  listAssignments,
  getAssignmentPublicItems,
  getAssignmentPrivateScores,
  getAssignmentRoster,
  getAssignmentNotifications,
  verifyAssignmentIntegrity,
} from '../src/modules/publish/index.js';

const router = Router();

function actorId(req) {
  return req.session?.user?.id || req.session?.admin?.id || null;
}

function isScoringAuthorized(req) {
  const role = req.session?.user?.role || req.session?.admin?.role || '';
  return ['platform_admin', 'institution_admin', 'teacher', 'scoring'].some(
    (r) => role === r || role === r.replace(/_/g, '')
  );
}

// ═══════════════════════════════════════════════════════════════════
// META
// ═══════════════════════════════════════════════════════════════════

/** GET /api/publish/meta — statuses, transitions, notification config. */
router.get('/api/publish/meta', (req, res) => {
  res.json({
    statuses: ASSIGNMENT_STATUS,
    transitions: ASSIGNMENT_STATUS_TRANSITIONS,
    notificationTypes: NOTIFICATION_TYPES,
    notificationScopes: NOTIFICATION_SCOPES,
  });
});

// ═══════════════════════════════════════════════════════════════════
// PURE HELPERS
// ═══════════════════════════════════════════════════════════════════

/** POST /api/publish/plan — deterministic publish plan (dry-run, no writes). */
router.post('/api/publish/plan', (req, res) => {
  try {
    const { assessment, sections, items, brief, policy, rosterMembers, externalKey } = req.body || {};
    const result = planPublish({
      assessment,
      sections: sections || [],
      items: items || [],
      brief,
      policy,
      rosterMembers: rosterMembers || [],
      externalKey,
    });
    if (!result.ok) return res.status(400).json(result);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/** POST /api/publish/hash — canonical hash of arbitrary content. */
router.post('/api/publish/hash', (req, res) => {
  try {
    res.json({ hash: canonicalHash(req.body?.content || {}) });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/** POST /api/publish/secret-scan — verify a public surface has no leaks. */
router.post('/api/publish/secret-scan', (req, res) => {
  try {
    res.json(verifyPublicSnapshotClean(req.body?.publicItems || []));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/** POST /api/publish/key — derive an idempotency key for a publish attempt. */
router.post('/api/publish/key', (req, res) => {
  try {
    const { assessmentId, briefVersionId, policyVersionId, rosterMembers } = req.body || {};
    res.json({
      key: derivePublishKey({
        assessmentId,
        briefVersionId: briefVersionId || null,
        policyVersionId: policyVersionId || null,
        rosterHash: rosterHash(rosterMembers || []),
      }),
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════════
// PUBLISH (atomic transaction)
// ═══════════════════════════════════════════════════════════════════

/** POST /api/publish — atomically publish an assessment draft. */
router.post('/api/publish', async (req, res) => {
  try {
    const {
      assessmentId,
      items,
      sections,
      brief,
      policy,
      rosterMembers,
      schedule,
      externalKey,
    } = req.body || {};

    if (!assessmentId) return res.status(400).json({ error: 'assessmentId is required' });
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'items are required' });
    }

    const result = await publishAssignment({
      assessmentId: parseInt(assessmentId, 10),
      items,
      sections: sections || [],
      brief,
      policy,
      rosterMembers: rosterMembers || [],
      schedule,
      externalKey,
      createdBy: actorId(req),
    });
    res.status(result.duplicate ? 200 : 201).json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════════
// ASSIGNMENT READS
// ═══════════════════════════════════════════════════════════════════

/** GET /api/assignments — list assignments. */
router.get('/api/assignments', async (req, res) => {
  try {
    res.json(await listAssignments({
      status: req.query.status,
      assessment_id: req.query.assessment_id ? parseInt(req.query.assessment_id, 10) : undefined,
      limit: parseInt(req.query.limit || '50', 10),
      offset: parseInt(req.query.offset || '0', 10),
    }));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/** GET /api/assignments/:id — assignment detail with counts. */
router.get('/api/assignments/:id', async (req, res) => {
  try {
    const assignment = await getAssignment(parseInt(req.params.id, 10));
    if (!assignment) return res.status(404).json({ error: 'Assignment not found' });
    const [publicCount, privateCount, rosterCount] = await Promise.all([
      getAssignmentPublicItems(assignment.id),
      getAssignmentPrivateScores(assignment.id),
      getAssignmentRoster(assignment.id),
    ]);
    res.json({
      ...assignment,
      counts: {
        publicItems: publicCount.length,
        privateScores: privateCount.length,
        rosterMembers: rosterCount.length,
      },
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/** GET /api/assignments/:id/public-items — student-facing surface (never private). */
router.get('/api/assignments/:id/public-items', async (req, res) => {
  try {
    const assignment = await getAssignment(parseInt(req.params.id, 10));
    if (!assignment) return res.status(404).json({ error: 'Assignment not found' });
    res.json({ assignmentId: assignment.id, items: await getAssignmentPublicItems(assignment.id) });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/** GET /api/assignments/:id/private-scores — scoring keys; authorized only. */
router.get('/api/assignments/:id/private-scores', async (req, res) => {
  try {
    if (!isScoringAuthorized(req)) {
      return res.status(403).json({ error: 'Scoring authorization required' });
    }
    const assignment = await getAssignment(parseInt(req.params.id, 10));
    if (!assignment) return res.status(404).json({ error: 'Assignment not found' });
    res.json({ assignmentId: assignment.id, scores: await getAssignmentPrivateScores(assignment.id) });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/** GET /api/assignments/:id/roster — roster membership snapshot. */
router.get('/api/assignments/:id/roster', async (req, res) => {
  try {
    const assignment = await getAssignment(parseInt(req.params.id, 10));
    if (!assignment) return res.status(404).json({ error: 'Assignment not found' });
    res.json({ assignmentId: assignment.id, members: await getAssignmentRoster(assignment.id) });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/** GET /api/assignments/:id/notifications — outbox reads. */
router.get('/api/assignments/:id/notifications', async (req, res) => {
  try {
    const assignment = await getAssignment(parseInt(req.params.id, 10));
    if (!assignment) return res.status(404).json({ error: 'Assignment not found' });
    res.json(await getAssignmentNotifications(assignment.id, {
      status: req.query.status,
      limit: parseInt(req.query.limit || '100', 10),
    }));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/** GET /api/assignments/:id/verify — integrity/immutability check. */
router.get('/api/assignments/:id/verify', async (req, res) => {
  try {
    res.json(await verifyAssignmentIntegrity(parseInt(req.params.id, 10)));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

export default router;
