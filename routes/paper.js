/**
 * Edikit — Paper Packet, QR & Chain of Custody API Routes
 *
 * Prompt 42 REST API:
 *   - Batch generation: paper_batches + paper_packets + paper_pages
 *     (idempotent batch_key / opaque_packet_id / qr_token UNIQUE)
 *   - Per-page signed QR (no answer keys / raw PII) + content hashes
 *   - Detachable identity cover (cover_identity, separate from body)
 *   - Batch status lifecycle + custody ledger (append-only HMAC chain)
 *   - QR verify endpoint (authenticity + replay detection)
 *   - Short-lived batch download token (scoped + expiry)
 *   - Admin UI page: /admin/paper
 *
 * Security (Prompt 42 §15, research.md §52.3):
 *   - QR payload faqat { packet, page, epoch, nonce, sig }
 *   - Secret scan (scanPaperForSecrets) generate paytida
 *   - Download token short-lived + scope-langan
 *   - Har bir write path tenant-scoped + idempotent; audit qilinadi
 */

import { Router } from 'express';
import { requireAdmin } from '../middleware/auth.js';
import {
  // schema (pure)
  CUSTODY_EVENT_TYPES,
  PAPER_BATCH_STATUS,
  PAPER_BATCH_STATUS_TRANSITIONS,
  PAPER_RENDER_FLAGS,
  // service
  generatePaperBatch,
  getPaperBatch,
  listPaperBatches,
  listPackets,
  listPacketPages,
  transitionPaperBatch,
  recordCustodyEvent,
  listCustodyEvents,
  verifyScannedPageQr,
  createBatchDownloadToken,
  verifyBatchDownloadToken,
} from '../src/modules/paper/index.js';

const router = Router();

function actorId(req) {
  return req.session?.admin?.id || req.session?.user?.id || null;
}

// ═══════════════════════════════════════════════════════════════════
// META / CONSTANTS
// ═══════════════════════════════════════════════════════════════════

/** GET /api/admin/paper/meta — constants for the admin UI. */
router.get('/api/admin/paper/meta', requireAdmin, (req, res) => {
  res.json({
    custodyEventTypes: CUSTODY_EVENT_TYPES,
    batchStatus: PAPER_BATCH_STATUS,
    batchTransitions: PAPER_BATCH_STATUS_TRANSITIONS,
    renderFlags: PAPER_RENDER_FLAGS,
  });
});

// ═══════════════════════════════════════════════════════════════════
// BATCH GENERATION
// ═══════════════════════════════════════════════════════════════════

/** POST /api/admin/paper/batches — generate a paper batch (idempotent). */
router.post('/api/admin/paper/batches', requireAdmin, async (req, res) => {
  try {
    const r = await generatePaperBatch({
      batchKey: req.body?.batchKey,
      assignmentId: req.body?.assignmentId,
      runId: req.body?.runId ? Number(req.body.runId) : null,
      students: req.body?.students || [],
      pageHashes: req.body?.pageHashes || {},
      epoch: req.body?.epoch || 1,
      createdBy: actorId(req),
    });
    res.json(r);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/** GET /api/admin/paper/batches — list batches. */
router.get('/api/admin/paper/batches', requireAdmin, async (req, res) => {
  try {
    const rows = await listPaperBatches({
      assignmentId: req.query.assignmentId ? Number(req.query.assignmentId) : undefined,
      status: req.query.status,
    });
    res.json({ ok: true, batches: rows });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/** GET /api/admin/paper/batches/:id — batch detail + packets + pages + custody. */
router.get('/api/admin/paper/batches/:id', requireAdmin, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const batch = await getPaperBatch(id);
    if (!batch) return res.status(404).json({ error: 'Batch not found' });
    const packets = await listPackets({ batchId: id });
    const custody = await listCustodyEvents({ batchId: id });
    res.json({ ok: true, batch, packets, custody });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════════
// BATCH STATUS + CUSTODY
// ═══════════════════════════════════════════════════════════════════

/** POST /api/admin/paper/batches/:id/transition — status machine step. */
router.post('/api/admin/paper/batches/:id/transition', requireAdmin, async (req, res) => {
  try {
    const r = await transitionPaperBatch({
      id: Number(req.params.id),
      to: req.body?.to,
      actorUserId: actorId(req),
    });
    res.json(r);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/** POST /api/admin/paper/batches/:id/custody — record a custody event. */
router.post('/api/admin/paper/batches/:id/custody', requireAdmin, async (req, res) => {
  try {
    const r = await recordCustodyEvent({
      batchId: Number(req.params.id),
      data: req.body || {},
      actorUserId: actorId(req),
    });
    res.json(r);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/** GET /api/admin/paper/batches/:id/custody — custody chain. */
router.get('/api/admin/paper/batches/:id/custody', requireAdmin, async (req, res) => {
  try {
    const rows = await listCustodyEvents({ batchId: Number(req.params.id) });
    res.json({ ok: true, custody: rows });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════════
// QR VERIFY + DOWNLOAD
// ═══════════════════════════════════════════════════════════════════

/** POST /api/admin/paper/qr/verify — verify a scanned page QR. */
router.post('/api/admin/paper/qr/verify', requireAdmin, async (req, res) => {
  try {
    const r = await verifyScannedPageQr({ token: req.body?.token, actorUserId: actorId(req) });
    res.json(r);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/** POST /api/admin/paper/batches/:id/download-token — short-lived download token. */
router.post('/api/admin/paper/batches/:id/download-token', requireAdmin, async (req, res) => {
  try {
    const r = await createBatchDownloadToken({
      batchId: Number(req.params.id),
      expiresInMinutes: req.body?.expiresInMinutes || 15,
      userId: actorId(req),
    });
    res.json(r);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/** POST /api/admin/paper/download/verify — verify a download token. */
router.post('/api/admin/paper/download/verify', requireAdmin, async (req, res) => {
  try {
    const r = await verifyBatchDownloadToken({
      token: req.body?.token,
      batchId: req.body?.batchId,
    });
    res.json(r);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════════
// UI PAGE
// ═══════════════════════════════════════════════════════════════════

/** GET /admin/paper — paper packet / custody UI. */
router.get('/admin/paper', (req, res) => {
  if (!req.session?.admin) return res.redirect('/admin/login');
  res.render('admin/paper', {
    title: 'Qog\'oz paketlar va custody',
    admin: req.session.admin,
  });
});

export default router;
