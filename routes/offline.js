/**
 * Edikit — IndexedDB Offline Journal, Reconnect & Recovery Routes
 *
 * Prompt 32 (Phase D #3) REST API:
 *   - POST /api/student/attempts/:id/offline/sync  — reconnect batch sync
 *     (validated per-entry, ACKs highest contiguous seq, idempotent)
 *   - POST /api/student/attempts/:id/offline/export — emergency recovery
 *     package export (never the answer key)
 *   - POST /api/admin/attempts/:id/offline/import  — PRIVILEGED recovery
 *     import (checksum verify + answer-key scan + audit trail)
 *   - GET  /api/admin/attempts/:id/offline/packages — privileged audit view
 *   - GET  /api/student/offline/meta               — contract meta
 *
 * Security:
 *   - Student routes require an authenticated session (requireAuth); the
 *     actor id is derived from the session (never the body).
 *   - Admin import/listing routes require requireAdmin (privileged-only).
 *   - Every entry is re-validated + epoch-checked server-side; parallel-device
 *     policy is evaluated from server-side ACK watermarks, not client claims.
 *   - Recovery packages NEVER contain the answer key (§15 / §29.3); a leaky
 *     package is rejected outright.
 */

import { Router } from 'express';
import { requireAdmin } from '../middleware/auth.js';
import {
  DEVICE_POLICY,
  JOURNAL_STATUS,
  reconnectSync,
  exportRecoveryPackage,
  importRecoveryPackage,
  listRecoveryPackages,
} from '../src/modules/offline/index.js';

const router = Router();

function actorId(req) {
  return req.session?.user?.id || null;
}

/** POST /api/student/attempts/:id/offline/sync — reconnect batch sync. */
router.post('/api/student/attempts/:id/offline/sync', async (req, res) => {
  try {
    const userId = actorId(req);
    if (!userId) return res.status(401).json({ error: 'Authentication required' });

    // SECURITY: `epoch` and `devicePolicy` are NEVER read from the request
    // body — the current attempt epoch and the parallel-device policy are
    // resolved SERVER-SIDE only (Prompt 30 identityLevel bug class). A client
    // claiming `devicePolicy: 'allow'` or a fake epoch must be impossible.
    const { deviceId, entries = [], maxBatch } = req.body || {};
    if (!deviceId || typeof deviceId !== 'string') {
      return res.status(400).json({ error: 'deviceId is required' });
    }
    if (!Array.isArray(entries)) return res.status(400).json({ error: 'entries must be an array' });

    const result = await reconnectSync({
      attemptId: parseInt(req.params.id, 10),
      userId,
      deviceId,
      entries,
      opts: { maxBatch },
    });

    if (result.ok === false && result.code === 'not_found') {
      return res.status(404).json({ error: 'Attempt not found' });
    }
    if (result.blocked) {
      return res.status(409).json({ error: `Sync blocked: ${result.reason}`, reason: result.reason });
    }
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/** POST /api/student/attempts/:id/offline/export — emergency recovery export. */
router.post('/api/student/attempts/:id/offline/export', async (req, res) => {
  try {
    const userId = actorId(req);
    if (!userId) return res.status(401).json({ error: 'Authentication required' });

    const { deviceId, entries = [], meta = {} } = req.body || {};
    if (!deviceId || typeof deviceId !== 'string') {
      return res.status(400).json({ error: 'deviceId is required' });
    }
    if (!Array.isArray(entries)) return res.status(400).json({ error: 'entries must be an array' });

    const result = await exportRecoveryPackage({
      attemptId: parseInt(req.params.id, 10),
      userId,
      deviceId,
      entries,
      opts: { meta },
    });

    if (result.ok === false && result.code === 'not_found') {
      return res.status(404).json({ error: 'Attempt not found' });
    }
    if (result.ok === false && result.code === 'answer_key_present') {
      return res.status(400).json({ error: 'Recovery package rejected: answer key present', found: result.found });
    }
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/** POST /api/admin/attempts/:id/offline/import — PRIVILEGED recovery import. */
router.post('/api/admin/attempts/:id/offline/import', requireAdmin, async (req, res) => {
  try {
    const { package: pkg } = req.body || {};
    if (!pkg || typeof pkg !== 'object') return res.status(400).json({ error: 'package is required' });

    const actor = req.session?.admin?.username || req.session?.admin?.id || 'admin';
    const result = await importRecoveryPackage({ pkg, actor });

    if (result.ok === false && result.code === 'invalid_package') {
      return res.status(400).json({ error: `Invalid recovery package: ${result.reason}` });
    }
    if (result.ok === false && result.code === 'answer_key_present') {
      return res.status(400).json({ error: 'Recovery package rejected: answer key present', found: result.found });
    }
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/** GET /api/admin/attempts/:id/offline/packages — privileged audit view. */
router.get('/api/admin/attempts/:id/offline/packages', requireAdmin, async (req, res) => {
  try {
    const packages = await listRecoveryPackages(parseInt(req.params.id, 10));
    res.json({ packages });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/** GET /api/student/offline/meta — contract meta. */
router.get('/api/student/offline/meta', (req, res) => {
  res.json({ devicePolicies: DEVICE_POLICY, journalStatuses: JOURNAL_STATUS });
});

export default router;
