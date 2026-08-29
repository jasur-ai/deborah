/**
 * Deborah — Attempt Lease, Identity Step & Server Timer API Routes
 *
 * Prompt 30 (Phase D #1) REST API:
 *   - POST /api/student/assignments/:id/attempt    — start a single-writer,
 *     server-timed attempt (roster snapshot auth + preflight gate + identity
 *     step-up + parallel-session policy; atomic lease)
 *   - GET  /api/student/attempts/:id               — attempt the user owns
 *   - GET  /api/student/attempts/:id/content       — PUBLIC content package
 *     (answer keys structurally impossible)
 *   - POST /api/student/attempts/:id/transition    — ready → in_progress →
 *     submitted | terminated
 *   - GET  /api/student/assignments/:id/attempts   — attempt history
 *   - GET  /api/student/attempt/meta               — contract meta
 *
 * Security:
 *   - Every route requires an authenticated student session (requireAuth)
 *   - startAttempt authorization = PUBLISHED roster snapshot (never the live
 *     roster, §24 no silent re-sync) + PASSED preflight + identity step-up
 *   - Unauthorized attempts return 404 (not 403) so the student never learns
 *     the assignment exists (hidden-resource principle, mirrors preflight)
 *   - Client clock / display timer / join code are NEVER authoritative —
 *     started_at/ends_at are server-computed
 */

import { Router } from 'express';
import {
  ATTEMPT_STATUS,
  ATTEMPT_STATUS_TRANSITIONS,
  IDENTITY_LEVELS,
  resolveIdentityLevelFromSession,
  startAttempt,
  transitionAttempt,
  getAttempt,
  getAttemptPublicContent,
  listAttempts,
} from '../src/modules/attempt/index.js';

const router = Router();

function actorId(req) {
  return req.session?.user?.id || req.session?.admin?.id || null;
}

/** POST /api/student/assignments/:id/attempt — start a secure attempt. */
router.post('/api/student/assignments/:id/attempt', async (req, res) => {
  try {
    const userId = actorId(req);
    if (!userId) return res.status(401).json({ error: 'Authentication required' });

    const { clientInfo = {}, deviceAttestation = {} } = req.body || {};
    // Identity level is derived SERVER-SIDE from the session — never from the
    // request body (a malicious client could otherwise claim `passkey` and
    // bypass the S3/S4 step-up gate; research.md §30).
    const identityLevel = resolveIdentityLevelFromSession(req.session.user);
    const result = await startAttempt({
      assignmentId: parseInt(req.params.id, 10),
      userId,
      identityLevel,
      clientInfo,
      deviceAttestation,
    });

    if (result.ok === false && result.code === 'assignment_not_found') {
      return res.status(404).json({ error: 'Assignment not found' });
    }
    if (result.ok === false && result.code === 'not_assigned') {
      return res.status(404).json({ error: 'Assignment not found' });
    }
    if (result.ok === false && result.code === 'blocked') {
      return res.status(400).json({ error: 'Attempt boshlash mumkin emas', blockers: result.blockers });
    }
    if (result.ok === false && result.code === 'parallel_session_denied') {
      return res.status(409).json({ error: 'Faol attempt allaqachon mavjud' });
    }
    if (result.ok === false && result.code === 'content_secret_leak') {
      return res.status(500).json({ error: 'Content security error' });
    }
    res.status(result.duplicate ? 200 : 201).json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/** GET /api/student/attempts/:id — attempt owned by the student. */
router.get('/api/student/attempts/:id', async (req, res) => {
  try {
    const userId = actorId(req);
    if (!userId) return res.status(401).json({ error: 'Authentication required' });
    const attempt = await getAttempt(parseInt(req.params.id, 10), userId);
    if (!attempt) return res.status(404).json({ error: 'Attempt not found' });
    res.json(attempt);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/** GET /api/student/attempts/:id/content — PUBLIC content package only. */
router.get('/api/student/attempts/:id/content', async (req, res) => {
  try {
    const userId = actorId(req);
    if (!userId) return res.status(401).json({ error: 'Authentication required' });
    const content = await getAttemptPublicContent(parseInt(req.params.id, 10), userId);
    if (!content) return res.status(404).json({ error: 'Attempt not found' });
    res.json(content);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/** POST /api/student/attempts/:id/transition — lifecycle transition. */
router.post('/api/student/attempts/:id/transition', async (req, res) => {
  try {
    const userId = actorId(req);
    if (!userId) return res.status(401).json({ error: 'Authentication required' });
    const { to } = req.body || {};
    if (!to) return res.status(400).json({ error: 'Transition target (to) is required' });
    const result = await transitionAttempt(parseInt(req.params.id, 10), to, userId);
    if (result.ok === false && result.code === 'not_found') {
      return res.status(404).json({ error: 'Attempt not found' });
    }
    if (result.ok === false && result.code === 'forbidden') {
      return res.status(403).json({ error: 'Siz bu attemptga egalik qilmaysiz' });
    }
    if (result.ok === false && result.code === 'invalid_transition') {
      return res.status(400).json({ error: `Cannot transition ${result.from} → ${result.to}` });
    }
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/** GET /api/student/assignments/:id/attempts — attempt history. */
router.get('/api/student/assignments/:id/attempts', async (req, res) => {
  try {
    const userId = actorId(req);
    if (!userId) return res.status(401).json({ error: 'Authentication required' });
    const attempts = await listAttempts(parseInt(req.params.id, 10), userId);
    res.json({ attempts });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/** GET /api/student/attempt/meta — attempt contract meta. */
router.get('/api/student/attempt/meta', (req, res) => {
  res.json({
    statuses: ATTEMPT_STATUS,
    transitions: ATTEMPT_STATUS_TRANSITIONS,
    identityLevels: IDENTITY_LEVELS,
  });
});

export default router;
