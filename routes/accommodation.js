/**
 * Deborah — Accommodation API Routes
 *
 * Endpoints (ordered to avoid route collision — snapshot routes BEFORE :id):
 *   POST   /api/accommodations                          — Create new accommodation
 *   GET    /api/accommodations                           — List accommodations (filtered)
 *   GET    /api/accommodations/snapshot/:assignmentId    — Get snapshots for assignment
 *   GET    /api/accommodations/snapshot/:assignmentId/config/:userId — Get effective config
 *   POST   /api/accommodations/snapshot                 — Create assessment snapshot
 *   POST   /api/accommodations/confirm                  — Student confirmation
 *   GET    /api/accommodations/sensitive/status         — Check sensitive access
 *   GET    /api/accommodations/user/:userId             — Active accommodations for user
 *   GET    /api/accommodations/:id                      — Get accommodation details
 *   PUT    /api/accommodations/:id                      — Update accommodation
 *   POST   /api/accommodations/:id/revoke               — Revoke accommodation
 *   GET    /api/accommodations/:id/versions             — Get version history
 *
 * All endpoints require authentication. Sensitive rationale endpoints
 * require elevated privileges.
 */

import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import {
  createAccommodation,
  getAccommodation,
  listAccommodations,
  updateAccommodation,
  revokeAccommodation,
  getAccommodationVersions,
  createAccommodationSnapshot,
  getSnapshotsForAssignment,
  getActiveAccommodationsForUser,
  getEffectiveOperationalConfig,
  confirmAccommodation,
  hasSensitiveAccess,
} from '../src/modules/accommodation/index.js';

const router = Router();

// ── All endpoints require authentication. Scoped to THIS router's own
//    /api/accommodations* namespace (NOT the bare /api prefix) — a bare
//    router.use('/api', requireAuth) would also intercept /api/admin/*
//    routes from other routers and 401 them even with a valid admin
//    session (requireAuth only accepts student sessions). ──
router.use('/api/accommodations', requireAuth);

// ═══════════════════════════════════════════════════════════════════
// POST /api/accommodations — Create
// ═══════════════════════════════════════════════════════════════════

router.post('/api/accommodations', async (req, res) => {
  try {
    const { userId, type, operationalConfig, sensitiveRationale, effectiveFrom, effectiveUntil } = req.body;
    if (!userId || !type) {
      return res.status(400).json({ error: 'userId and type are required' });
    }

    const validTypes = ['extra_time', 'reader', 'font_contrast', 'break_timer',
      'camera_off', 'strike_policy_override', 'separate_room',
      'oral_interpreter', 'word_processor', 'scribe', 'other'];

    if (!validTypes.includes(type)) {
      return res.status(400).json({ error: `Invalid type. Must be one of: ${validTypes.join(', ')}` });
    }

    const grantedBy = req.session?.user?.id || req.session?.admin?.id || 1;
    const result = await createAccommodation({
      userId, type, operationalConfig,
      sensitiveRationale,
      effectiveFrom, effectiveUntil,
      grantedBy,
    });

    if (!result) return res.status(500).json({ error: 'Failed to create accommodation' });
    res.status(201).json({ ok: true, id: result.id });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════════
// GET /api/accommodations — List
// ═══════════════════════════════════════════════════════════════════

router.get('/api/accommodations', async (req, res) => {
  try {
    const accommodations = await listAccommodations({
      userId: req.query.userId ? parseInt(req.query.userId) : undefined,
      type: req.query.type,
      status: req.query.status,
      session: req.session,
      limit: parseInt(req.query.limit) || 50,
      offset: parseInt(req.query.offset) || 0,
    });
    res.json(accommodations);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════════
// ⚠️  SNAPSHOT ROUTES MUST come BEFORE :id to avoid route collision!
// ═══════════════════════════════════════════════════════════════════

// GET /api/accommodations/snapshot/:assignmentId — Get snapshots
router.get('/api/accommodations/snapshot/:assignmentId', async (req, res) => {
  try {
    const userId = req.query.userId ? parseInt(req.query.userId) : undefined;
    const snapshots = await getSnapshotsForAssignment(parseInt(req.params.assignmentId), userId);
    res.json(snapshots);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/accommodations/snapshot/:assignmentId/config/:userId — Effective config
router.get('/api/accommodations/snapshot/:assignmentId/config/:userId', async (req, res) => {
  try {
    const config = await getEffectiveOperationalConfig(
      parseInt(req.params.assignmentId),
      parseInt(req.params.userId)
    );
    res.json(config);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/accommodations/snapshot — Create assessment snapshot
router.post('/api/accommodations/snapshot', async (req, res) => {
  try {
    const { assessmentAssignmentId, userId } = req.body;
    if (!assessmentAssignmentId || !userId) {
      return res.status(400).json({ error: 'assessmentAssignmentId and userId are required' });
    }
    const result = await createAccommodationSnapshot({ assessmentAssignmentId, userId });
    res.status(201).json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// POST /api/accommodations/confirm — Student confirmation
router.post('/api/accommodations/confirm', async (req, res) => {
  try {
    const { assessmentAssignmentId, confirmedConfig } = req.body;
    if (!assessmentAssignmentId) {
      return res.status(400).json({ error: 'assessmentAssignmentId is required' });
    }
    const userId = req.session?.user?.id || 1;
    const result = await confirmAccommodation(userId, assessmentAssignmentId, confirmedConfig || {});
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// GET /api/accommodations/sensitive/status — Check sensitive access
router.get('/api/accommodations/sensitive/status', (req, res) => {
  const access = hasSensitiveAccess(req.session);
  res.json({ hasSensitiveAccess: access, roles: req.session?.user?.role || 'none' });
});

// GET /api/accommodations/user/:userId — Active accommodations for user
router.get('/api/accommodations/user/:userId', async (req, res) => {
  try {
    const accommodations = await getActiveAccommodationsForUser(parseInt(req.params.userId));
    res.json(accommodations);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════════
// PARAMETERIZED ROUTES (must come after all fixed-path routes)
// ═══════════════════════════════════════════════════════════════════

// GET /api/accommodations/:id — Get single
router.get('/api/accommodations/:id', async (req, res) => {
  try {
    const accommodation = await getAccommodation(parseInt(req.params.id), req.session);
    if (!accommodation) return res.status(404).json({ error: 'Accommodation not found' });
    res.json(accommodation);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/accommodations/:id — Update
router.put('/api/accommodations/:id', async (req, res) => {
  try {
    const { operationalConfig, effectiveFrom, effectiveUntil, sensitiveRationale, changeReason } = req.body;
    const result = await updateAccommodation(parseInt(req.params.id), {
      operationalConfig, effectiveFrom, effectiveUntil, sensitiveRationale,
      changedBy: req.session?.user?.id || req.session?.admin?.id || 1,
      changeReason,
    });
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// POST /api/accommodations/:id/revoke — Revoke
router.post('/api/accommodations/:id/revoke', async (req, res) => {
  try {
    const result = await revokeAccommodation(
      parseInt(req.params.id),
      req.session?.user?.id || req.session?.admin?.id || 1,
      req.body.reason
    );
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// GET /api/accommodations/:id/versions — Version history
router.get('/api/accommodations/:id/versions', async (req, res) => {
  try {
    const versions = await getAccommodationVersions(parseInt(req.params.id));
    res.json(versions);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
