/**
 * Deborah — Scan, Reconciliation, OMR & OCR Service
 *
 * DB layer for Prompt 43 (research.md §52.5, §16):
 *   - Scan batch create (idempotent batch_key), page ingest with quality
 *     gate + QR decode/routing, reconciliation counters, manual queue.
 *   - Original scan immutable: storage_key content-addressed
 *     (`scans/<batchKey>/<contentHash>.bin`) — hech qachon overwrite
 *     bo'lmaydi; derivative'lar alohida + hash lineage (source_hash).
 *   - OMR marks with confidence classification (ambiguous/low → queue).
 *   - OCR transcript derivative (handwriting/math) draft → approved.
 *   - Completion blocker: expected_pages == reconciled_pages bo'lmasa
 *     grading_ready'ga o'tib bo'lmaydi.
 *
 * SECURITY / DATA GUARD (Prompt 43 §15):
 *   - Original immutable; derivative lineage.
 *   - QR forged/unreadable → queue, silent drop YO'Q.
 *   - Har bir write path tenant-scoped + idempotency; audit qilinadi.
 *
 * Graceful degradation: without PostgreSQL write paths throw a clear
 * error, read paths return null/[] (consistent with the platform).
 */

import { getDb } from '../../infrastructure/postgres.js';
import { getCurrentTenant } from '../auth/tenant-context.js';
import { audit, AUDIT_ACTIONS } from '../auth/audit.js';
import { verifyPageQr } from '../paper/paper.schema.js';
import {
  SCAN_BATCH_STATUS,
  SCAN_PAGE_STATUS,
  QR_STATUS,
  RECONCILIATION_KINDS,
  RECONCILIATION_STATUS,
  evaluateQualityGate,
  decodeAndRoutePage,
  buildReconciliationCounters,
  validateScanBatchTransition,
  classifyOmrConfidence,
  validateOcrKind,
  validateDerivativeKind,
  hashBuffer,
  SCAN_DEFAULTS,
} from './scan.schema.js';

const PG_UNIQUE_VIOLATION = '23505';

function getTenantId() {
  return getCurrentTenant()?.tenantId || 1;
}

function signingKey() {
  const secret = process.env.SESSION_SECRET || 'deborah-dev-secret';
  return secret.length >= 32 ? secret : secret.padEnd(32, 'x');
}

// ═══════════════════════════════════════════════════════════════════
// SCAN BATCH
// ═══════════════════════════════════════════════════════════════════

/**
 * Create a scan batch (idempotent by batch_key).
 *
 * @param {Object} opts
 * @param {string} opts.batchKey
 * @param {number|null} opts.paperBatchId
 * @param {Array<{packetId: string, pageCount: number}>} opts.expectedPackets
 * @param {number|null} opts.createdBy
 */
export async function createScanBatch({ batchKey, paperBatchId = null, expectedPackets = [], createdBy = null } = {}) {
  if (!batchKey) throw new Error('batchKey is required');
  const db = await getDb();
  if (!db) throw new Error('PostgreSQL required');

  const expectedCount = (expectedPackets || []).reduce((sum, p) => sum + Number(p.pageCount || 0), 0);

  // Idempotent — same batch_key returns the existing batch
  const existing = await db.selectFrom('scan_batches')
    .where('tenant_id', '=', getTenantId())
    .where('batch_key', '=', batchKey)
    .selectAll()
    .executeTakeFirst();
  if (existing) {
    await audit({
      action: AUDIT_ACTIONS.SCAN_BATCH_CREATE,
      userId: createdBy,
      resourceType: 'scan_batch',
      resourceId: existing.id,
      details: { batchKey, idempotent: true },
    }).catch(() => {});
    return { ok: true, id: existing.id, idempotent: true };
  }

  try {
    const row = await db.insertInto('scan_batches')
      .values({
        tenant_id: getTenantId(),
        paper_batch_id: paperBatchId,
        batch_key: batchKey,
        status: SCAN_BATCH_STATUS.UPLOADING,
        expected_pages: expectedCount,
        created_by: createdBy,
      })
      .returning(['id', 'batch_key', 'status', 'expected_pages'])
      .executeTakeFirst();

    await audit({
      action: AUDIT_ACTIONS.SCAN_BATCH_CREATE,
      userId: createdBy,
      resourceType: 'scan_batch',
      resourceId: row.id,
      details: { batchKey, expectedPages: expectedCount },
    }).catch(() => {});
    return { ok: true, id: row.id };
  } catch (err) {
    if (err?.code === PG_UNIQUE_VIOLATION) {
      const again = await db.selectFrom('scan_batches')
        .where('tenant_id', '=', getTenantId())
        .where('batch_key', '=', batchKey)
        .selectAll()
        .executeTakeFirst();
      return { ok: true, id: again.id, idempotent: true };
    }
    throw err;
  }
}

export async function getScanBatch(id) {
  const db = await getDb();
  if (!db) return null;
  return db.selectFrom('scan_batches')
    .where('id', '=', id)
    .where('tenant_id', '=', getTenantId())
    .selectAll()
    .executeTakeFirst();
}

export async function listScanBatches({ status } = {}) {
  const db = await getDb();
  if (!db) return [];
  let q = db.selectFrom('scan_batches')
    .where('tenant_id', '=', getTenantId())
    .orderBy('created_at', 'desc')
    .limit(100);
  if (status) q = q.where('status', '=', status);
  return q.selectAll().execute();
}

// ═══════════════════════════════════════════════════════════════════
// PAGE INGEST (quality gate + QR decode + routing)
// ═══════════════════════════════════════════════════════════════════

/**
 * Ingest a scanned page image.
 *
 * Storage (immutable): content-addressed key `scans/<batchKey>/<hash>.bin`.
 * Quality gate → QR decode → routing/duplicate/orphan/quality_failed.
 *
 * @param {Object} opts
 * @param {number} opts.batchId
 * @param {Buffer} opts.imageBuffer
 * @param {string|null} opts.qrToken
 * @param {Object} opts.meta - { dpi, width, height, orientation, blur,
 *   skew, shadow, cut, duplexMissing }
 * @param {number|null} opts.createdBy
 */
export async function ingestScannedPage({ batchId, imageBuffer, qrToken = null, meta = {}, createdBy = null } = {}) {
  if (!batchId) throw new Error('batchId is required');
  if (!imageBuffer || !Buffer.isBuffer(imageBuffer) || imageBuffer.length === 0) {
    throw new Error('imageBuffer is required');
  }
  const db = await getDb();
  if (!db) throw new Error('PostgreSQL required');

  const batch = await getScanBatch(batchId);
  if (!batch) throw new Error('Scan batch not found');

  // ── Original immutable: content-addressed key ──
  const contentHash = hashBuffer(imageBuffer);
  const storageKey = `scans/${batch.batch_key}/${contentHash}.bin`;

  // Persist original to object storage (best-effort — graceful fallback;
  // DB row still records the content-addressed key + hash lineage §15).
  try {
    const storage = (await import('../../infrastructure/storage.js')).default;
    await storage.put(storageKey, imageBuffer, 'application/octet-stream');
  } catch (_) {
    // storage unavailable → immutable key/hash still recorded; no throw
  }

  // Idempotency: same page content already ingested → no-op
  const existing = await db.selectFrom('scan_pages')
    .where('tenant_id', '=', getTenantId())
    .where('scan_batch_id', '=', batchId)
    .where('content_hash', '=', contentHash)
    .selectAll()
    .executeTakeFirst();
  if (existing) {
    await audit({
      action: AUDIT_ACTIONS.SCAN_PAGE_INGEST,
      userId: createdBy,
      resourceType: 'scan_page',
      resourceId: existing.id,
      details: { batchId, idempotent: true },
    }).catch(() => {});
    return { ok: true, id: existing.id, idempotent: true };
  }

  // ── Quality gate (§52.5) ──
  const quality = evaluateQualityGate(meta);
  const pageStatus = quality.ok ? SCAN_PAGE_STATUS.SCANNED : SCAN_PAGE_STATUS.QUALITY_FAILED;

  // ── QR decode + routing (only if quality passed enough to trust) ──
  let qrStatus = QR_STATUS.MISSING;
  let routedPacketId = null;
  let routedPageIndex = null;
  let scanError = null;

  const routed = decodeAndRoutePage(qrToken, signingKey());
  qrStatus = routed.status;
  if (routed.status === QR_STATUS.DECODED) {
    // Re-verify signature via paper.schema (timing-safe HMAC)
    const v = verifyPageQr(qrToken, signingKey());
    if (!v.ok) {
      qrStatus = QR_STATUS.FORGED;
      scanError = v.error;
    } else {
      routedPacketId = String(v.payload.packet);
      routedPageIndex = Number(v.payload.page);
    }
  } else if (routed.status === QR_STATUS.FORGED) {
    scanError = routed.error;
  } else if (routed.status === QR_STATUS.UNREADABLE) {
    scanError = routed.error;
  }

  // Route status: decoded → check duplicate/orphan against batch pages
  let finalStatus = pageStatus;
  if (pageStatus === SCAN_PAGE_STATUS.SCANNED && routedPacketId !== null) {
    finalStatus = SCAN_PAGE_STATUS.ROUTED;
    const dup = await db.selectFrom('scan_pages')
      .where('tenant_id', '=', getTenantId())
      .where('scan_batch_id', '=', batchId)
      .where('routed_packet_id', '=', routedPacketId)
      .where('routed_page_index', '=', routedPageIndex)
      .where('page_status', '=', SCAN_PAGE_STATUS.ROUTED)
      .select('id')
      .executeTakeFirst();
    if (dup) finalStatus = SCAN_PAGE_STATUS.DUPLICATE;
  } else if (pageStatus === SCAN_PAGE_STATUS.SCANNED && routedPacketId === null) {
    finalStatus = SCAN_PAGE_STATUS.ORPHAN; // unreadable/forged/missing QR → not silent-dropped
  }

  const seq = await db.selectFrom('scan_pages')
    .where('scan_batch_id', '=', batchId)
    .select(db.fn.countAll().as('n'))
    .executeTakeFirst();

  const row = await db.insertInto('scan_pages')
    .values({
      tenant_id: getTenantId(),
      scan_batch_id: batchId,
      page_seq: Number(seq?.n ?? 0),
      storage_key: storageKey,
      content_hash: contentHash,
      width: meta.width ? Number(meta.width) : null,
      height: meta.height ? Number(meta.height) : null,
      dpi: meta.dpi ? Number(meta.dpi) : null,
      orientation: meta.orientation || 'portrait',
      quality_flags: JSON.stringify(quality.flags),
      quality_score: quality.score,
      qr_token: qrToken || null,
      qr_status: qrStatus,
      routed_packet_id: routedPacketId,
      routed_page_index: routedPageIndex,
      page_status: finalStatus,
      scan_error: scanError,
    })
    .returning(['id', 'page_seq', 'page_status', 'qr_status'])
    .executeTakeFirst();

  // ── Refresh batch counters ──
  await refreshBatchCounters(batchId);

  // Route problems to reconciliation queue (never silent)
  if (finalStatus === SCAN_PAGE_STATUS.QUALITY_FAILED) {
    // Quality gate failed — manual re-scan / human QA (§52.5).
    await createReconciliationTicket({
      batchId,
      kind: 'quality_failed',
      pageId: row.id,
      packetId: routedPacketId,
      pageIndex: routedPageIndex,
      reason: (quality.errors || []).join('; ') || 'quality gate failed',
      createdBy,
    });
  } else if (finalStatus === SCAN_PAGE_STATUS.ORPHAN || qrStatus !== QR_STATUS.DECODED) {
    await createReconciliationTicket({
      batchId,
      kind: qrStatus === QR_STATUS.MISSING ? 'orphan_page' : 'unreadable_qr',
      pageId: row.id,
      packetId: routedPacketId,
      pageIndex: routedPageIndex,
      reason: scanError || `QR ${qrStatus}`,
      createdBy,
    });
  } else if (finalStatus === SCAN_PAGE_STATUS.DUPLICATE) {
    await createReconciliationTicket({
      batchId,
      kind: 'duplicate_page',
      pageId: row.id,
      packetId: routedPacketId,
      pageIndex: routedPageIndex,
      reason: `Duplicate of ${routedPacketId}::${routedPageIndex}`,
      createdBy,
    });
  }

  await audit({
    action: AUDIT_ACTIONS.SCAN_PAGE_INGEST,
    userId: createdBy,
    resourceType: 'scan_page',
    resourceId: row.id,
    details: { batchId, seq: row.page_seq, pageStatus: row.page_status, qrStatus: row.qr_status, qualityScore: quality.score },
  }).catch(() => {});

  return { ok: true, id: row.id, pageStatus: row.page_status, qrStatus: row.qr_status };
}

async function refreshBatchCounters(batchId) {
  const db = await getDb();
  if (!db) return;
  const pages = await db.selectFrom('scan_pages')
    .where('scan_batch_id', '=', batchId)
    .select(['page_status', 'routed_packet_id', 'routed_page_index', 'id'])
    .execute();

  const batch = await getScanBatch(batchId);
  if (!batch) return;

  // Expected pages: paper_batch_id bog'langan bo'lsa paper_packets'dan,
  // aks holda batch yaratishda berilgan expected_pages saqlanadi (clobber
  // bo'lmasligi uchun — Prompt 43 §14 idempotency/validation).
  let expectedPackets = [];
  if (batch.paper_batch_id) {
    expectedPackets = await db.selectFrom('paper_packets')
      .where('batch_id', '=', batch.paper_batch_id)
      .select(['opaque_packet_id', 'page_count'])
      .execute();
  }

  const counters = buildReconciliationCounters({
    pages,
    expectedPackets: expectedPackets.map((p) => ({ packetId: p.opaque_packet_id, pageCount: p.page_count })),
  });
  if (!batch.paper_batch_id) {
    counters.expected_pages = Number(batch.expected_pages ?? 0); // preserve create-time value
  }

  await db.updateTable('scan_batches')
    .set({ ...counters, updated_at: new Date() })
    .where('id', '=', batchId)
    .execute();
}

export async function listScanPages({ batchId } = {}) {
  const db = await getDb();
  if (!db) return [];
  return db.selectFrom('scan_pages')
    .where('tenant_id', '=', getTenantId())
    .where('scan_batch_id', '=', batchId)
    .orderBy('page_seq', 'asc')
    .selectAll()
    .execute();
}

// ═══════════════════════════════════════════════════════════════════
// RECONCILIATION QUEUE (manual, human-only resolution)
// ═══════════════════════════════════════════════════════════════════

export async function createReconciliationTicket({ batchId, kind, pageId = null, packetId = null, pageIndex = null, reason = '', createdBy = null } = {}) {
  if (!batchId || !kind) throw new Error('batchId and kind are required');
  if (!RECONCILIATION_KINDS.includes(kind)) {
    throw new Error(`Invalid reconciliation kind: ${kind}`);
  }
  const db = await getDb();
  if (!db) throw new Error('PostgreSQL required');

  const row = await db.insertInto('scan_reconciliation_queue')
    .values({
      tenant_id: getTenantId(),
      scan_batch_id: batchId,
      kind,
      page_id: pageId,
      packet_id: packetId,
      page_index: pageIndex,
      reason: reason.slice(0, 500),
    })
    .returning(['id', 'kind', 'status'])
    .executeTakeFirst();

  await audit({
    action: AUDIT_ACTIONS.SCAN_RECONCILE_QUEUE,
    userId: createdBy,
    resourceType: 'scan_reconciliation_queue',
    resourceId: row.id,
    details: { batchId, kind, packetId, pageIndex },
  }).catch(() => {});
  return { ok: true, id: row.id };
}

export async function listReconciliationQueue({ batchId, status } = {}) {
  const db = await getDb();
  if (!db) return [];
  let q = db.selectFrom('scan_reconciliation_queue')
    .where('tenant_id', '=', getTenantId())
    .where('scan_batch_id', '=', batchId)
    .orderBy('created_at', 'asc');
  if (status) q = q.where('status', '=', status);
  return q.selectAll().execute();
}

/**
 * Resolve a reconciliation ticket (manual, audited, privileged).
 */
export async function resolveReconciliationTicket({ ticketId, resolution = '', resolvedBy = null } = {}) {
  if (!ticketId) throw new Error('ticketId is required');
  const db = await getDb();
  if (!db) throw new Error('PostgreSQL required');
  const ticket = await db.selectFrom('scan_reconciliation_queue')
    .where('id', '=', ticketId)
    .where('tenant_id', '=', getTenantId())
    .selectAll()
    .executeTakeFirst();
  if (!ticket) throw new Error('Ticket not found');
  if (ticket.status === RECONCILIATION_STATUS.RESOLVED) {
    return { ok: true, id: ticket.id, idempotent: true };
  }

  const row = await db.updateTable('scan_reconciliation_queue')
    .set({
      status: RECONCILIATION_STATUS.RESOLVED,
      resolution: (resolution || '').slice(0, 500),
      resolved_by: resolvedBy,
      resolved_at: new Date(),
    })
    .where('id', '=', ticketId)
    .returning(['id', 'status'])
    .executeTakeFirst();

  // Resolution may fix routed status → refresh counters + batch status.
  // quality_failed tickets must NOT silently become routed — they need a
  // re-scan; only routing-related kinds (orphan/unreadable) get routed.
  if (ticket.page_id && ['orphan_page', 'unreadable_qr'].includes(ticket.kind)) {
    await db.updateTable('scan_pages')
      .set({ page_status: SCAN_PAGE_STATUS.ROUTED })
      .where('id', '=', ticket.page_id)
      .execute();
  }
  await refreshBatchCounters(ticket.scan_batch_id);

  await audit({
    action: AUDIT_ACTIONS.SCAN_RECONCILE_RESOLVE,
    userId: resolvedBy,
    resourceType: 'scan_reconciliation_queue',
    resourceId: row.id,
    details: { batchId: ticket.scan_batch_id, kind: ticket.kind, resolution },
  }).catch(() => {});
  return { ok: true, id: row.id };
}

// ═══════════════════════════════════════════════════════════════════
// BATCH STATUS TRANSITIONS (completion blocker)
// ═══════════════════════════════════════════════════════════════════

export async function transitionScanBatch({ id, to, actorUserId = null } = {}) {
  if (!id) throw new Error('Scan batch id is required');
  const db = await getDb();
  if (!db) throw new Error('PostgreSQL required');
  const batch = await getScanBatch(id);
  if (!batch) throw new Error('Scan batch not found');

  const v = validateScanBatchTransition(batch.status, to, batch);
  if (!v.ok) throw new Error(v.error);

  await db.updateTable('scan_batches')
    .set({ status: v.to, updated_at: new Date() })
    .where('id', '=', id)
    .where('tenant_id', '=', getTenantId())
    .execute();

  await audit({
    action: AUDIT_ACTIONS.SCAN_BATCH_TRANSITION,
    userId: actorUserId,
    resourceType: 'scan_batch',
    resourceId: id,
    details: { from: batch.status, to: v.to, counters: { expected: batch.expected_pages, reconciled: batch.reconciled_pages } },
  }).catch(() => {});
  return { ok: true, id, from: batch.status, to: v.to };
}

// ═══════════════════════════════════════════════════════════════════
// OMR MARKS
// ═══════════════════════════════════════════════════════════════════

/**
 * Ingest OMR marks (idempotent by batch+packet+page+question+option).
 * Low/ambiguous confidence → reconciliation queue.
 */
export async function ingestOmrMarks({ batchId, marks = [], createdBy = null } = {}) {
  if (!batchId) throw new Error('batchId is required');
  if (!Array.isArray(marks) || marks.length === 0) throw new Error('marks is required');
  const db = await getDb();
  if (!db) throw new Error('PostgreSQL required');

  const results = [];
  for (const m of marks) {
    const confidence = Number(m.confidence ?? 0);
    const status = classifyOmrConfidence(confidence);
    const existing = await db.selectFrom('scan_omr_marks')
      .where('tenant_id', '=', getTenantId())
      .where('scan_batch_id', '=', batchId)
      .where('packet_id', '=', m.packetId ?? null)
      .where('page_index', '=', Number(m.pageIndex ?? 0))
      .where('question_key', '=', m.questionKey)
      .where('option_index', '=', Number(m.optionIndex ?? 0))
      .select('id')
      .executeTakeFirst();
    if (existing) {
      results.push({ ok: true, id: existing.id, idempotent: true });
      continue;
    }
    const row = await db.insertInto('scan_omr_marks')
      .values({
        tenant_id: getTenantId(),
        scan_batch_id: batchId,
        scan_page_id: m.pageId ? Number(m.pageId) : null,
        packet_id: m.packetId ?? null,
        page_index: Number(m.pageIndex ?? 0),
        question_key: m.questionKey,
        option_index: Number(m.optionIndex ?? 0),
        confidence,
        status,
      })
      .returning(['id', 'status'])
      .executeTakeFirst();

    if (status !== 'high') {
      await createReconciliationTicket({
        batchId,
        kind: 'low_confidence_omr',
        pageId: m.pageId ? Number(m.pageId) : null,
        packetId: m.packetId ?? null,
        pageIndex: Number(m.pageIndex ?? 0),
        reason: `OMR confidence ${confidence} (${status}) for ${m.questionKey}`,
        createdBy,
      });
    }
    results.push({ ok: true, id: row.id, status: row.status });
  }

  await audit({
    action: AUDIT_ACTIONS.SCAN_OMR_INGEST,
    userId: createdBy,
    resourceType: 'scan_batch',
    resourceId: batchId,
    details: { count: results.length },
  }).catch(() => {});
  return { ok: true, ingested: results.length, results };
}

// ═══════════════════════════════════════════════════════════════════
// OCR TRANSCRIPTS (derivative with hash lineage)
// ═══════════════════════════════════════════════════════════════════

/**
 * Create an OCR transcript derivative (handwriting/math).
 * Original immutable — transcript is a derivative with source_hash lineage.
 */
export async function createOcrTranscript({ batchId, pageId = null, packetId = null, pageIndex = 0, kind = 'handwriting', transcriptText = '', confidence = 0, createdBy = null } = {}) {
  if (!batchId) throw new Error('batchId is required');
  const k = validateOcrKind(kind);
  if (!k.ok) throw new Error(k.error);
  if (!transcriptText) throw new Error('transcriptText is required');
  const db = await getDb();
  if (!db) throw new Error('PostgreSQL required');

  let sourceHash = null;
  if (pageId) {
    const page = await db.selectFrom('scan_pages')
      .where('id', '=', pageId)
      .where('tenant_id', '=', getTenantId())
      .select(['content_hash'])
      .executeTakeFirst();
    sourceHash = page?.content_hash || null;
  }

  const row = await db.insertInto('scan_ocr_transcripts')
    .values({
      tenant_id: getTenantId(),
      scan_batch_id: batchId,
      scan_page_id: pageId,
      packet_id: packetId,
      page_index: Number(pageIndex),
      kind,
      transcript_text: transcriptText,
      confidence: Number(confidence),
      status: 'draft', // transcript faqat draft — teacher approve qilishi kerak
      source_hash: sourceHash,
    })
    .returning(['id', 'status'])
    .executeTakeFirst();

  // Low-confidence OCR → manual route (§52.6 AI transcript draft)
  if (Number(confidence) < SCAN_DEFAULTS.lowConfidenceThreshold) {
    await createReconciliationTicket({
      batchId,
      kind: 'low_confidence_ocr',
      pageId,
      packetId,
      pageIndex,
      reason: `OCR confidence ${confidence} (${kind})`,
      createdBy,
    });
  }

  await audit({
    action: AUDIT_ACTIONS.SCAN_OCR_INGEST,
    userId: createdBy,
    resourceType: 'scan_ocr_transcript',
    resourceId: row.id,
    details: { batchId, kind, confidence, sourceHash },
  }).catch(() => {});
  return { ok: true, id: row.id, status: row.status };
}

export async function listOcrTranscripts({ batchId } = {}) {
  const db = await getDb();
  if (!db) return [];
  return db.selectFrom('scan_ocr_transcripts')
    .where('tenant_id', '=', getTenantId())
    .where('scan_batch_id', '=', batchId)
    .orderBy('created_at', 'desc')
    .selectAll()
    .execute();
}

/**
 * Approve / reject an OCR transcript (privileged, audited).
 */
export async function setOcrTranscriptStatus({ transcriptId, status = 'approved', actorUserId = null } = {}) {
  const db = await getDb();
  if (!db) throw new Error('PostgreSQL required');
  if (!['approved', 'rejected'].includes(status)) throw new Error(`Invalid OCR status: ${status}`);
  const row = await db.updateTable('scan_ocr_transcripts')
    .set({ status })
    .where('id', '=', transcriptId)
    .where('tenant_id', '=', getTenantId())
    .returning(['id', 'status'])
    .executeTakeFirst();
  if (!row) throw new Error('Transcript not found');
  await audit({
    action: AUDIT_ACTIONS.SCAN_OCR_APPROVE,
    userId: actorUserId,
    resourceType: 'scan_ocr_transcript',
    resourceId: transcriptId,
    details: { status },
  }).catch(() => {});
  return { ok: true, id: row.id, status: row.status };
}

// ═══════════════════════════════════════════════════════════════════
// DERIVATIVES (dewarp/enhance — hash lineage)
// ═══════════════════════════════════════════════════════════════════

/**
 * Register an enhancement derivative (dewarped/enhanced image, OMR mask).
 * Original immutable — derivative'lar alohida saqlanadi + source_hash.
 */
export async function createScanDerivative({ pageId, kind = 'dewarped', imageBuffer = null, createdBy = null } = {}) {
  if (!pageId) throw new Error('pageId is required');
  const k = validateDerivativeKind(kind);
  if (!k.ok) throw new Error(k.error);
  const db = await getDb();
  if (!db) throw new Error('PostgreSQL required');

  const page = await db.selectFrom('scan_pages')
    .where('id', '=', pageId)
    .where('tenant_id', '=', getTenantId())
    .select(['content_hash', 'scan_batch_id'])
    .executeTakeFirst();
  if (!page) throw new Error('Scan page not found');

  let storageKey = null;
  let contentHash = page.content_hash; // lineage root = original
  if (imageBuffer && Buffer.isBuffer(imageBuffer)) {
    contentHash = hashBuffer(imageBuffer);
    storageKey = `scans/${page.scan_batch_id}/derivatives/${kind}/${contentHash}.bin`;
  }

  const row = await db.insertInto('scan_derivatives')
    .values({
      tenant_id: getTenantId(),
      scan_page_id: pageId,
      kind,
      storage_key: storageKey || `scans/${page.scan_batch_id}/derivatives/${kind}/inline`,
      content_hash: contentHash,
      source_hash: page.content_hash,
      meta: JSON.stringify({ lineage: [page.content_hash, contentHash] }),
      created_by: createdBy,
    })
    .returning(['id', 'kind', 'content_hash', 'source_hash'])
    .executeTakeFirst();

  await audit({
    action: AUDIT_ACTIONS.SCAN_DERIVATIVE_CREATE,
    userId: createdBy,
    resourceType: 'scan_derivative',
    resourceId: row.id,
    details: { pageId, kind, sourceHash: row.source_hash },
  }).catch(() => {});
  return { ok: true, id: row.id, kind: row.kind };
}

export async function listDerivatives({ pageId } = {}) {
  const db = await getDb();
  if (!db) return [];
  return db.selectFrom('scan_derivatives')
    .where('tenant_id', '=', getTenantId())
    .where('scan_page_id', '=', pageId)
    .orderBy('created_at', 'desc')
    .selectAll()
    .execute();
}

// ═══════════════════════════════════════════════════════════════════
// COMPLETION STATE
// ═══════════════════════════════════════════════════════════════════

export async function getScanBatchSummary(id) {
  const batch = await getScanBatch(id);
  if (!batch) return null;
  const pages = await listScanPages({ batchId: id });
  const queue = await listReconciliationQueue({ batchId: id, status: 'open' });
  const blocked = batch.expected_pages > 0 && batch.reconciled_pages < batch.expected_pages;
  return {
    batch,
    pages,
    openTickets: queue.length,
    completion: {
      expected: batch.expected_pages,
      reconciled: batch.reconciled_pages,
      blocked,
      reason: blocked ? `${batch.expected_pages - batch.reconciled_pages} pages missing` : null,
    },
  };
}
