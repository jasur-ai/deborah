/**
 * Deborah — Safe File, Code & Oral Submission Routes
 *
 * Prompt 44 REST API:
 *   - POST /api/student/attempts/:id/uploads         — create resumable session
 *   - POST /api/student/uploads/:sid/chunks          — append chunk (resume)
 *   - POST /api/student/uploads/:sid/finalize        — verify + quarantine
 *   - POST /api/student/attempts/:id/submit/version  — submit version + receipt
 *   - GET  /api/student/attempts/:id/submissions     — version history
 *   - GET  /api/student/receipts/:token/verify       — receipt verification
 *   - POST /api/student/uploads/:sid/transcripts     — media transcript
 *   - Admin: /api/admin/safe-submit/sessions, /api/admin/safe-submit/listen-queue,
 *     POST /api/admin/safe-submit/sessions/:id/quarantine, POST
 *     /api/admin/safe-submit/transcripts/:id/status, /admin/safe-submit page.
 *
 * Security (Prompt 44 §15-16, research.md §16.3):
 *   - requireAuth / requireAdmin; actor id from session (never body).
 *   - Client NEVER sends its own MIME/hash/verdict — server recomputes.
 *   - Quarantine = needs_review, never a penalty; only human reject after
 *     review is a real rejection.
 *   - Har bir write path tenant-scoped + idempotent (session_key UNIQUE,
 *     version_no UNIQUE, receipt_token UNIQUE).
 */

import { Router } from 'express';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import {
  createUploadSession,
  appendUploadChunk,
  finalizeUpload,
  submitVersion,
  listSubmissionVersions,
  verifyStoredReceipt,
  createMediaTranscript,
  listManualListenQueue,
  setTranscriptStatus,
  listUploadSessions,
  getUploadSession,
  listUploadChunks,
  listScanResults,
  resolveQuarantine,
  SAFE_SUBMIT_DEFAULTS,
  SUBMISSION_KINDS,
  UPLOAD_SESSION_STATUS,
  QUARANTINE_STATUS,
  VERSION_STATUS,
  TRANSCRIPT_STATUS,
  SCANNERS,
  SCAN_VERDICTS,
  codeSandboxLimits,
  mediaNormalizeContract,
} from '../src/modules/safe-submit/index.js';

const router = Router();

function actorId(req) {
  return req.session?.user?.id || req.session?.admin?.id || null;
}

// ═══════════════════════════════════════════════════════════════════
// META / CONSTANTS
// ═══════════════════════════════════════════════════════════════════

/** GET /api/admin/safe-submit/meta — constants + limits for the UI. */
router.get('/api/admin/safe-submit/meta', requireAdmin, (req, res) => {
  res.json({
    kinds: SUBMISSION_KINDS,
    sessionStatus: UPLOAD_SESSION_STATUS,
    quarantineStatus: QUARANTINE_STATUS,
    versionStatus: VERSION_STATUS,
    transcriptStatus: TRANSCRIPT_STATUS,
    scanners: SCANNERS,
    scanVerdicts: SCAN_VERDICTS,
    defaults: SAFE_SUBMIT_DEFAULTS,
    codeSandbox: codeSandboxLimits(),
    mediaNormalize: mediaNormalizeContract(),
  });
});

// ═══════════════════════════════════════════════════════════════════
// STUDENT — UPLOAD SESSION
// ═══════════════════════════════════════════════════════════════════

/** POST /api/student/attempts/:id/uploads — create a resumable session. */
router.post('/api/student/attempts/:id/uploads', requireAuth, async (req, res) => {
  try {
    const userId = actorId(req);
    if (!userId) return res.status(401).json({ error: 'Authentication required' });
    const r = await createUploadSession({
      attemptId: Number(req.params.id),
      userId,
      sessionKey: req.body?.sessionKey,
      kind: req.body?.kind,
      declaredMime: req.body?.declaredMime || '',
      expectedSize: Number(req.body?.expectedSize || 0),
      originalName: req.body?.originalName || '',
      briefLimits: req.body?.limits || {},
      briefPolicy: req.body?.policy || {},
    });
    res.json(r);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/** POST /api/student/uploads/:sid/chunks — append a chunk (resume). */
router.post('/api/student/uploads/:sid/chunks', requireAuth, async (req, res) => {
  try {
    const userId = actorId(req);
    if (!userId) return res.status(401).json({ error: 'Authentication required' });
    const { chunkIndex = 0, offset = 0, dataBase64 = '' } = req.body || {};
    if (!dataBase64) return res.status(400).json({ error: 'dataBase64 is required' });
    const chunkData = Buffer.from(dataBase64, 'base64');
    const r = await appendUploadChunk({
      sessionId: Number(req.params.sid),
      userId,
      chunkIndex: Number(chunkIndex),
      offset: Number(offset),
      chunkData,
    });
    res.json(r);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/** POST /api/student/uploads/:sid/finalize — verify + quarantine (fail-closed). */
router.post('/api/student/uploads/:sid/finalize', requireAuth, async (req, res) => {
  try {
    const userId = actorId(req);
    if (!userId) return res.status(401).json({ error: 'Authentication required' });
    const r = await finalizeUpload({
      sessionId: Number(req.params.sid),
      userId,
      fullContent: req.body?.fullContentBase64 ? Buffer.from(req.body.fullContentBase64, 'base64') : null,
    });
    res.json(r);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/** POST /api/student/attempts/:id/submit/version — submit + signed receipt. */
router.post('/api/student/attempts/:id/submit/version', requireAuth, async (req, res) => {
  try {
    const userId = actorId(req);
    if (!userId) return res.status(401).json({ error: 'Authentication required' });
    const r = await submitVersion({
      attemptId: Number(req.params.id),
      userId,
      uploadSessionId: Number(req.body?.uploadSessionId),
      policy: req.body?.policy || {},
    });
    res.json(r);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/** GET /api/student/attempts/:id/submissions — version history. */
router.get('/api/student/attempts/:id/submissions', requireAuth, async (req, res) => {
  try {
    const userId = actorId(req);
    if (!userId) return res.status(401).json({ error: 'Authentication required' });
    const rows = await listSubmissionVersions({ attemptId: Number(req.params.id) });
    res.json({ ok: true, versions: rows });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/** GET /api/student/receipts/:token/verify — client-side receipt verification. */
router.get('/api/student/receipts/:token/verify', requireAuth, async (req, res) => {
  try {
    const r = await verifyStoredReceipt({ receiptToken: req.params.token });
    if (!r) return res.status(404).json({ error: 'Receipt not found' });
    res.json({ ok: r.ok, receipt: { token: r.token, body: r.body } });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/** POST /api/student/uploads/:sid/transcripts — record media transcript. */
router.post('/api/student/uploads/:sid/transcripts', requireAuth, async (req, res) => {
  try {
    const userId = actorId(req);
    if (!userId) return res.status(401).json({ error: 'Authentication required' });
    const r = await createMediaTranscript({
      sessionId: Number(req.params.sid),
      attemptId: Number(req.body?.attemptId),
      userId,
      kind: req.body?.kind || 'oral',
      transcriptText: req.body?.transcriptText || '',
      confidence: Number(req.body?.confidence || 0),
      sourceHash: req.body?.sourceHash || null,
    });
    res.json(r);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════════
// ADMIN — REVIEW & QUARANTINE (human-only)
// ═══════════════════════════════════════════════════════════════════

/** GET /api/admin/safe-submit/sessions — list upload sessions. */
router.get('/api/admin/safe-submit/sessions', requireAdmin, async (req, res) => {
  try {
    const rows = await listUploadSessions({ attemptId: req.query.attemptId ? Number(req.query.attemptId) : null });
    res.json({ ok: true, sessions: rows });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/** GET /api/admin/safe-submit/sessions/:id — session + chunks + scans. */
router.get('/api/admin/safe-submit/sessions/:id', requireAdmin, async (req, res) => {
  try {
    const session = await getUploadSession(Number(req.params.id));
    if (!session) return res.status(404).json({ error: 'Upload session not found' });
    const [chunks, scans] = await Promise.all([
      listUploadChunks({ sessionId: Number(req.params.id) }),
      listScanResults({ sessionId: Number(req.params.id) }),
    ]);
    res.json({ ok: true, session, chunks, scans });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/** POST /api/admin/safe-submit/sessions/:id/quarantine — human review. */
router.post('/api/admin/safe-submit/sessions/:id/quarantine', requireAdmin, async (req, res) => {
  try {
    const r = await resolveQuarantine({
      sessionId: Number(req.params.id),
      action: req.body?.action,
      note: req.body?.note || '',
      actorId: actorId(req),
    });
    res.json(r);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/** GET /api/admin/safe-submit/listen-queue — manual listen queue. */
router.get('/api/admin/safe-submit/listen-queue', requireAdmin, async (req, res) => {
  try {
    const rows = await listManualListenQueue({ status: req.query.status });
    res.json({ ok: true, transcripts: rows });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/** POST /api/admin/safe-submit/transcripts/:id/status — approve/reject. */
router.post('/api/admin/safe-submit/transcripts/:id/status', requireAdmin, async (req, res) => {
  try {
    const r = await setTranscriptStatus({
      transcriptId: Number(req.params.id),
      status: req.body?.status || 'approved',
      actorId: actorId(req),
    });
    res.json(r);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/** GET /admin/safe-submit — safe submission admin page. */
router.get('/admin/safe-submit', requireAdmin, (req, res) => {
  res.render('admin/safe-submit', {
    title: 'Safe Submission',
    user: req.session.admin,
  });
});

export default router;
