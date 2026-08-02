/**
 * Edikit — Scan, Reconciliation, OMR & OCR API Routes
 *
 * Prompt 43 REST API:
 *   - Scan batch create (idempotent batch_key) + list/detail/summary
 *   - Page ingest (quality gate + QR decode/routing, immutable original)
 *   - Reconciliation queue (manual, human-only resolution, audited)
 *   - Batch status transitions with completion blocker
 *   - OMR marks ingest (confidence classification)
 *   - OCR transcript derivative (handwriting/math) + approve/reject
 *   - Derivatives (dewarp/enhance, hash lineage)
 *   - Admin UI page: /admin/scan
 *
 * Security (Prompt 43 §15, research.md §52.5):
 *   - Original scan immutable; derivative hash lineage.
 *   - QR forged/unreadable → queue, silent drop YO'Q.
 *   - Har bir write path tenant-scoped + idempotent; audit qilinadi.
 */

import { Router } from 'express';
import { requireAdmin } from '../middleware/auth.js';
import {
  SCAN_BATCH_STATUS,
  SCAN_BATCH_STATUS_TRANSITIONS,
  SCAN_PAGE_STATUS,
  QR_STATUS,
  RECONCILIATION_KINDS,
  RECONCILIATION_STATUS,
  QUALITY_FLAGS,
  OMR_CONFIDENCE_STATUS,
  OCR_KINDS,
  OCR_STATUS,
  DERIVATIVE_KINDS,
  SCAN_DEFAULTS,
  createScanBatch,
  getScanBatch,
  listScanBatches,
  ingestScannedPage,
  listScanPages,
  transitionScanBatch,
  createReconciliationTicket,
  listReconciliationQueue,
  resolveReconciliationTicket,
  ingestOmrMarks,
  createOcrTranscript,
  listOcrTranscripts,
  setOcrTranscriptStatus,
  createScanDerivative,
  listDerivatives,
  getScanBatchSummary,
} from '../src/modules/scan/index.js';

const router = Router();

function actorId(req) {
  return req.session?.admin?.id || req.session?.user?.id || null;
}

// ═══════════════════════════════════════════════════════════════════
// META / CONSTANTS
// ═══════════════════════════════════════════════════════════════════

/** GET /api/admin/scan/meta — constants for the admin UI. */
router.get('/api/admin/scan/meta', requireAdmin, (req, res) => {
  res.json({
    batchStatus: SCAN_BATCH_STATUS,
    batchTransitions: SCAN_BATCH_STATUS_TRANSITIONS,
    pageStatus: SCAN_PAGE_STATUS,
    qrStatus: QR_STATUS,
    reconciliationKinds: RECONCILIATION_KINDS,
    reconciliationStatus: RECONCILIATION_STATUS,
    qualityFlags: QUALITY_FLAGS,
    omrConfidence: OMR_CONFIDENCE_STATUS,
    ocrKinds: OCR_KINDS,
    ocrStatus: OCR_STATUS,
    derivativeKinds: DERIVATIVE_KINDS,
    defaults: SCAN_DEFAULTS,
  });
});

// ═══════════════════════════════════════════════════════════════════
// SCAN BATCHES
// ═══════════════════════════════════════════════════════════════════

/** POST /api/admin/scan/batches — create a scan batch (idempotent). */
router.post('/api/admin/scan/batches', requireAdmin, async (req, res) => {
  try {
    const r = await createScanBatch({
      batchKey: req.body?.batchKey,
      paperBatchId: req.body?.paperBatchId ? Number(req.body.paperBatchId) : null,
      expectedPackets: req.body?.expectedPackets || [],
      createdBy: actorId(req),
    });
    res.json(r);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/** GET /api/admin/scan/batches — list scan batches. */
router.get('/api/admin/scan/batches', requireAdmin, async (req, res) => {
  try {
    const rows = await listScanBatches({ status: req.query.status });
    res.json({ ok: true, batches: rows });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/** GET /api/admin/scan/batches/:id — batch summary + pages + open tickets. */
router.get('/api/admin/scan/batches/:id', requireAdmin, async (req, res) => {
  try {
    const summary = await getScanBatchSummary(Number(req.params.id));
    if (!summary) return res.status(404).json({ error: 'Scan batch not found' });
    res.json({ ok: true, ...summary });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════════
// PAGE INGEST
// ═══════════════════════════════════════════════════════════════════

/**
 * POST /api/admin/scan/batches/:id/pages — ingest a scanned page.
 * Body: { imageBase64, qrToken, meta: { dpi, width, height, orientation,
 * blur, skew, shadow, cut, duplexMissing } }
 */
router.post('/api/admin/scan/batches/:id/pages', requireAdmin, async (req, res) => {
  try {
    const imageBase64 = req.body?.imageBase64;
    if (!imageBase64) return res.status(400).json({ error: 'imageBase64 is required' });
    const imageBuffer = Buffer.from(imageBase64, 'base64');
    const r = await ingestScannedPage({
      batchId: Number(req.params.id),
      imageBuffer,
      qrToken: req.body?.qrToken || null,
      meta: req.body?.meta || {},
      createdBy: actorId(req),
    });
    res.json(r);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/** GET /api/admin/scan/batches/:id/pages — list pages in a batch. */
router.get('/api/admin/scan/batches/:id/pages', requireAdmin, async (req, res) => {
  try {
    const rows = await listScanPages({ batchId: Number(req.params.id) });
    res.json({ ok: true, pages: rows });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════════
// RECONCILIATION QUEUE
// ═══════════════════════════════════════════════════════════════════

/** GET /api/admin/scan/batches/:id/queue — reconciliation queue. */
router.get('/api/admin/scan/batches/:id/queue', requireAdmin, async (req, res) => {
  try {
    const rows = await listReconciliationQueue({
      batchId: Number(req.params.id),
      status: req.query.status,
    });
    res.json({ ok: true, tickets: rows });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/** POST /api/admin/scan/queue/:id/resolve — resolve a ticket (manual, audited). */
router.post('/api/admin/scan/queue/:id/resolve', requireAdmin, async (req, res) => {
  try {
    const r = await resolveReconciliationTicket({
      ticketId: Number(req.params.id),
      resolution: req.body?.resolution || '',
      resolvedBy: actorId(req),
    });
    res.json(r);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════════
// BATCH STATUS TRANSITIONS
// ═══════════════════════════════════════════════════════════════════

/** POST /api/admin/scan/batches/:id/transition — status machine (completion blocker). */
router.post('/api/admin/scan/batches/:id/transition', requireAdmin, async (req, res) => {
  try {
    const r = await transitionScanBatch({
      id: Number(req.params.id),
      to: req.body?.to,
      actorUserId: actorId(req),
    });
    res.json(r);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════════
// OMR MARKS
// ═══════════════════════════════════════════════════════════════════

/** POST /api/admin/scan/batches/:id/omr — ingest OMR marks. */
router.post('/api/admin/scan/batches/:id/omr', requireAdmin, async (req, res) => {
  try {
    const r = await ingestOmrMarks({
      batchId: Number(req.params.id),
      marks: req.body?.marks || [],
      createdBy: actorId(req),
    });
    res.json(r);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════════
// OCR TRANSCRIPTS
// ═══════════════════════════════════════════════════════════════════

/** POST /api/admin/scan/batches/:id/ocr — create an OCR transcript derivative. */
router.post('/api/admin/scan/batches/:id/ocr', requireAdmin, async (req, res) => {
  try {
    const r = await createOcrTranscript({
      batchId: Number(req.params.id),
      pageId: req.body?.pageId ? Number(req.body.pageId) : null,
      packetId: req.body?.packetId || null,
      pageIndex: req.body?.pageIndex || 0,
      kind: req.body?.kind || 'handwriting',
      transcriptText: req.body?.transcriptText,
      confidence: req.body?.confidence || 0,
      createdBy: actorId(req),
    });
    res.json(r);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/** GET /api/admin/scan/batches/:id/ocr — list OCR transcripts. */
router.get('/api/admin/scan/batches/:id/ocr', requireAdmin, async (req, res) => {
  try {
    const rows = await listOcrTranscripts({ batchId: Number(req.params.id) });
    res.json({ ok: true, transcripts: rows });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/** POST /api/admin/scan/ocr/:id/status — approve/reject a transcript. */
router.post('/api/admin/scan/ocr/:id/status', requireAdmin, async (req, res) => {
  try {
    const r = await setOcrTranscriptStatus({
      transcriptId: Number(req.params.id),
      status: req.body?.status || 'approved',
      actorUserId: actorId(req),
    });
    res.json(r);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════════
// DERIVATIVES
// ═══════════════════════════════════════════════════════════════════

/** POST /api/admin/scan/derivatives — register an enhancement derivative. */
router.post('/api/admin/scan/derivatives', requireAdmin, async (req, res) => {
  try {
    const r = await createScanDerivative({
      pageId: Number(req.body?.pageId),
      kind: req.body?.kind || 'dewarped',
      imageBuffer: req.body?.imageBase64 ? Buffer.from(req.body.imageBase64, 'base64') : null,
      createdBy: actorId(req),
    });
    res.json(r);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/** GET /api/admin/scan/pages/:id/derivatives — list a page's derivatives. */
router.get('/api/admin/scan/pages/:id/derivatives', requireAdmin, async (req, res) => {
  try {
    const rows = await listDerivatives({ pageId: Number(req.params.id) });
    res.json({ ok: true, derivatives: rows });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════════
// ADMIN UI PAGE
// ═══════════════════════════════════════════════════════════════════

/** GET /admin/scan — scan reconciliation admin page. */
router.get('/admin/scan', requireAdmin, (req, res) => {
  res.render('admin/scan', {
    title: 'Scan & Reconciliation',
    user: req.session.admin,
  });
});

export default router;
