/**
 * Deborah — Student Assignment List, Brief & Preflight API Routes
 *
 * Prompt 28 REST API:
 *   - GET  /api/student/assignments        — assignments the student is
 *     authorized for (published roster snapshot only)
 *   - GET  /api/student/assignments/:id/brief — exact-version, sanitized
 *     brief + policy render (answer keys structurally impossible)
 *   - POST /api/student/assignments/:id/preflight — run + persist the full
 *     eligibility contract (idempotent per assignment+user+day)
 *   - GET  /api/student/assignments/:id/preflight — latest persisted status
 *   - GET  /api/student/preflight/meta     — contract meta (blocker codes)
 *   - GET  /api/student/preflight          — student preflight history
 *
 * Security:
 *   - Every route requires an authenticated student session (requireAuth)
 *   - Authorization = membership in the PUBLISHED roster snapshot; the live
 *     roster is never consulted (§24 — no silent re-sync)
 *   - Brief/policy renders are whitelist-sanitized in the pure schema
 */

import { Router } from 'express';
import {
  // schema (pure)
  AVAILABILITY_STATUS,
  PREFLIGHT_STATUS,
  BLOCKER_CODES,
  BLOCKER_MESSAGES,
  DEVICE_CHECKS,
  // service
  getStudentAssignments,
  getStudentAssignmentBrief,
  runPreflight,
  getPreflightStatus,
  listStudentPreflights,
  confirmStudentAccommodation,
} from '../src/modules/preflight/index.js';

const router = Router();

function actorId(req) {
  // BUG-230db119 fix: session'da `id` YO'Q — safeKey/username bor (auth.js session.user shakli).
  // Avvalgi kod faqat `user.id` o'qirdi → logged-in studentlar uchun ham hammasi 401 edi.
  return req.session?.user?.safeKey || req.session?.user?.username || req.session?.admin?.id || null;
}

/** GET /api/student/assignments — list authorized assignments. */
router.get('/api/student/assignments', async (req, res) => {
  try {
    const userId = actorId(req);
    if (!userId) return res.status(401).json({ error: 'Authentication required' });
    const assignments = await getStudentAssignments(userId);
    res.json({ assignments });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/** GET /api/student/assignments/:id/brief — exact-version sanitized render. */
router.get('/api/student/assignments/:id/brief', async (req, res) => {
  try {
    const userId = actorId(req);
    if (!userId) return res.status(401).json({ error: 'Authentication required' });
    const result = await getStudentAssignmentBrief(parseInt(req.params.id, 10), userId);
    if (!result) return res.status(404).json({ error: 'Assignment not found' });
    if (result.ok === false && result.code === 'not_assigned') {
      // 404 (not 403) — same shape as any unknown resource; the student must
      // not learn that the assignment exists (§24 / hidden-resource principle)
      return res.status(404).json({ error: 'Assignment not found' });
    }
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/** POST /api/student/assignments/:id/preflight — run + persist contract. */
router.post('/api/student/assignments/:id/preflight', async (req, res) => {
  try {
    const userId = actorId(req);
    if (!userId) return res.status(401).json({ error: 'Authentication required' });
    const {
      clientInfo = {},
      deviceAttestation = {},
      practiceData = {},
    } = req.body || {};
    const result = await runPreflight({
      assignmentId: parseInt(req.params.id, 10),
      userId,
      clientInfo,
      deviceAttestation,
      practiceData,
    });
    res.status(result.duplicate ? 200 : 201).json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/** POST /api/student/assignments/:id/accommodation/confirm — confirm accommodation (§10). */
router.post('/api/student/assignments/:id/accommodation/confirm', async (req, res) => {
  try {
    const userId = actorId(req);
    if (!userId) return res.status(401).json({ error: 'Authentication required' });
    const result = await confirmStudentAccommodation({
      assignmentId: parseInt(req.params.id, 10),
      userId,
    });
    if (!result) return res.status(404).json({ error: 'Assignment not found' });
    if (result.ok === false && (result.code === 'not_found' || result.code === 'not_assigned')) {
      return res.status(404).json({ error: 'Assignment not found' });
    }
    if (result.ok === false && result.code === 'no_accommodation') {
      return res.status(400).json({ error: 'Sizda bu assessment uchun accommodation yo\'q' });
    }
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/** GET /api/student/assignments/:id/preflight — latest persisted status. */
router.get('/api/student/assignments/:id/preflight', async (req, res) => {
  try {
    const userId = actorId(req);
    if (!userId) return res.status(401).json({ error: 'Authentication required' });
    const row = await getPreflightStatus(parseInt(req.params.id, 10), userId);
    if (!row) return res.status(404).json({ error: 'No preflight yet' });
    res.json(row);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/** GET /api/student/preflight — student preflight history. */
router.get('/api/student/preflight', async (req, res) => {
  try {
    const userId = actorId(req);
    if (!userId) return res.status(401).json({ error: 'Authentication required' });
    const rows = await listStudentPreflights(userId, {
      limit: parseInt(req.query.limit || '50', 10),
    });
    res.json({ preflights: rows });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/** GET /api/student/preflight/meta — eligibility contract meta. */
router.get('/api/student/preflight/meta', (req, res) => {
  res.json({
    availabilityStatuses: AVAILABILITY_STATUS,
    preflightStatuses: PREFLIGHT_STATUS,
    blockerCodes: BLOCKER_CODES,
    blockerMessages: BLOCKER_MESSAGES,
    deviceChecks: DEVICE_CHECKS,
  });
});

export default router;
