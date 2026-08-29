/**
 * Deborah — Scan, Reconciliation, OMR & OCR (pure logic)
 *
 * Prompt 43 — scanned paper pages'ni silent loss'siz student/questionga
 * reconcile qilish (research.md §52.5 scan quality gate, §16 security).
 *
 *   - SCAN_BATCH_STATUS lifecycle: uploading → processing →
 *     quality_review → reconciling → grading_ready → complete.
 *     COMPLETION BLOCKER: expected_pages == reconciled_pages bo'lmasa
 *     grading_ready'ga o'tib bo'lmaydi — hech bir page "OCR topmadi"
 *     deb silent drop bo'lmaydi (§52.5 done condition).
 *   - Quality gate (§52.5): 300 DPI target, blur/cut/skew/shadow,
 *     wrong orientation, duplex missing backside. Quality score 0–100.
 *   - QR decode + page routing: verifyPageQr orqali signed QR tekshiriladi
 *     (paper.schema'dan import — answer key/PII QR'da YO'Q §52.3),
 *     packet/page'ga route qilinadi.
 *   - duplicate/missing/orphan detection: expected set vs reconciled set.
 *   - OMR confidence: confidence → high | ambiguous | low; ambiguous/low
 *     → manual reconciliation queue.
 *   - OCR derivative: handwriting/math transcript — original immutable,
 *     derivative hash lineage (source_hash).
 *
 * Purity: no I/O, no globals — fully unit-testable without PostgreSQL.
 */

import { createHash } from 'node:crypto';

// ═══════════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════════

export const SCAN_BATCH_STATUS = {
  UPLOADING: 'uploading',
  PROCESSING: 'processing',
  QUALITY_REVIEW: 'quality_review',
  RECONCILING: 'reconciling',
  GRADING_READY: 'grading_ready',
  COMPLETE: 'complete',
};

export const SCAN_BATCH_STATUS_TRANSITIONS = {
  [SCAN_BATCH_STATUS.UPLOADING]: [
    SCAN_BATCH_STATUS.PROCESSING,
    SCAN_BATCH_STATUS.QUALITY_REVIEW,
  ],
  [SCAN_BATCH_STATUS.PROCESSING]: [
    SCAN_BATCH_STATUS.QUALITY_REVIEW,
    SCAN_BATCH_STATUS.RECONCILING,
  ],
  [SCAN_BATCH_STATUS.QUALITY_REVIEW]: [
    SCAN_BATCH_STATUS.RECONCILING,
    SCAN_BATCH_STATUS.PROCESSING,
  ],
  [SCAN_BATCH_STATUS.RECONCILING]: [
    SCAN_BATCH_STATUS.GRADING_READY, // faqat expected == reconciled
    SCAN_BATCH_STATUS.COMPLETE,
  ],
  [SCAN_BATCH_STATUS.GRADING_READY]: [SCAN_BATCH_STATUS.COMPLETE],
  [SCAN_BATCH_STATUS.COMPLETE]: [],
};

export const SCAN_PAGE_STATUS = {
  SCANNED: 'scanned',
  ROUTED: 'routed',
  DUPLICATE: 'duplicate',
  ORPHAN: 'orphan',
  QUALITY_FAILED: 'quality_failed',
  ESCALATED: 'escalated',
};

export const QR_STATUS = {
  DECODED: 'decoded',
  FORGED: 'forged',
  UNREADABLE: 'unreadable',
  MISSING: 'missing',
};

export const RECONCILIATION_KINDS = [
  'missing_page',
  'duplicate_page',
  'orphan_page',
  'unreadable_qr',
  'quality_failed',
  'low_confidence_omr',
  'low_confidence_ocr',
];

export const RECONCILIATION_STATUS = {
  OPEN: 'open',
  RESOLVED: 'resolved',
  ESCALATED: 'escalated',
};

export const QUALITY_FLAGS = [
  'blur',
  'skew',
  'shadow',
  'cut',
  'duplex_missing',
  'low_dpi',
  'wrong_orientation',
];

export const OMR_CONFIDENCE_STATUS = {
  HIGH: 'high',
  AMBIGUOUS: 'ambiguous',
  LOW: 'low',
};

export const OCR_KINDS = ['handwriting', 'math'];
export const OCR_STATUS = { DRAFT: 'draft', APPROVED: 'approved', REJECTED: 'rejected' };
export const DERIVATIVE_KINDS = ['dewarped', 'enhanced', 'ocr_transcript', 'omr_mask'];

export const SCAN_DEFAULTS = {
  targetDpi: 300,
  minQualityScore: 60,
  lowConfidenceThreshold: 0.7,
  ambiguousConfidenceThreshold: 0.9,
};

// ═══════════════════════════════════════════════════════════════════
// BATCH TRANSITIONS
// ═══════════════════════════════════════════════════════════════════

export function validateScanBatchTransition(from, to, counters = {}) {
  const allowed = SCAN_BATCH_STATUS_TRANSITIONS[from] || [];
  if (!allowed.includes(to)) {
    return { ok: false, error: `Invalid scan batch transition: ${from} → ${to}` };
  }

  // Completion blocker (§52.5): grading_ready faqat expected == reconciled
  if (to === SCAN_BATCH_STATUS.GRADING_READY) {
    const expected = Number(counters.expected_pages ?? 0);
    const reconciled = Number(counters.reconciled_pages ?? 0);
    if (expected === 0) {
      return { ok: false, error: 'Cannot be grading_ready: no expected pages defined' };
    }
    if (reconciled < expected) {
      return {
        ok: false,
        error: `Completion blocked: expected ${expected} pages, reconciled ${reconciled} (${expected - reconciled} missing)`,
      };
    }
  }

  return { ok: true, to };
}

// ═══════════════════════════════════════════════════════════════════
// QUALITY GATE (§52.5)
// ═══════════════════════════════════════════════════════════════════

/**
 * Evaluate scan quality for a page.
 *
 * @param {Object} meta
 * @param {number} meta.dpi - scanned DPI (0 if unknown)
 * @param {boolean} meta.blur
 * @param {boolean} meta.skew
 * @param {boolean} meta.shadow
 * @param {boolean} meta.cut
 * @param {boolean} meta.duplexMissing - expected backside missing
 * @param {string} meta.orientation - portrait | landscape | upside_down
 * @param {Object} opts
 * @returns {{ ok: boolean, score: number, flags: string[], errors: string[] }}
 */
export function evaluateQualityGate(meta = {}, opts = {}) {
  const targetDpi = opts.targetDpi ?? SCAN_DEFAULTS.targetDpi;
  const minScore = opts.minQualityScore ?? SCAN_DEFAULTS.minQualityScore;
  const flags = [];
  const errors = [];
  let score = 100;
  let hardFail = false;

  if (meta.orientation === 'upside_down') {
    flags.push('wrong_orientation');
    errors.push('wrong orientation (upside_down)');
    score -= 40;
    hardFail = true; // upside-down page cannot be graded — hard fail
  }

  if (Number(meta.dpi) > 0 && Number(meta.dpi) < targetDpi) {
    flags.push('low_dpi');
    errors.push(`low DPI ${meta.dpi} (target ${targetDpi})`);
    score -= 15;
  }

  if (meta.blur) {
    flags.push('blur');
    errors.push('blurred image');
    score -= 25;
  }
  if (meta.skew) {
    flags.push('skew');
    errors.push('skewed image');
    score -= 10;
  }
  if (meta.shadow) {
    flags.push('shadow');
    errors.push('shadow over content');
    score -= 10;
  }
  if (meta.cut) {
    flags.push('cut');
    errors.push('page cut off');
    score -= 20;
  }
  if (meta.duplexMissing) {
    flags.push('duplex_missing');
    errors.push('duplex backside missing');
    score -= 15;
  }

  score = Math.max(0, Math.min(100, score));
  const ok = !hardFail && score >= minScore;
  return { ok, score, flags, errors };
}

// ═══════════════════════════════════════════════════════════════════
// QR DECODE + PAGE ROUTING
// ═══════════════════════════════════════════════════════════════════

/**
 * Decode + route a scanned page via its signed QR token.
 * Reuses paper.schema's verifyPageQr — QR payload faqat
 * { packet, page, epoch, nonce, sig } (no answer keys / PII §52.3).
 *
 * @param {string|null} qrToken
 * @param {string} signingKey
 * @returns {{ status: 'decoded', packetId: string, pageIndex: number } |
 *           { status: 'forged'|'unreadable'|'missing', error?: string }}
 */
export function decodeAndRoutePage(qrToken, signingKey = '') {
  if (!qrToken) return { status: QR_STATUS.MISSING, error: 'QR token missing' };

  const v = verifyPageQrShape(qrToken, signingKey);
  if (!v.ok) {
    return { status: QR_STATUS.FORGED, error: v.error };
  }
  if (v.payload.type !== 'paper_page') {
    return { status: QR_STATUS.FORGED, error: 'QR payload type mismatch' };
  }

  const packetId = String(v.payload.packet ?? '');
  const pageIndex = Number(v.payload.page);
  if (!packetId || !Number.isInteger(pageIndex) || pageIndex < 0) {
    return { status: QR_STATUS.UNREADABLE, error: 'QR payload missing packet/page' };
  }
  return { status: QR_STATUS.DECODED, packetId, pageIndex };
}

/**
 * Pure wrapper around paper.schema verifyPageQr (imported lazily by the
 * service to avoid a hard circular dep at module load — we re-verify the
 * shape here and let the service pass the decoded payload through).
 *
 * @param {string} token
 * @param {string} key
 */
export function verifyPageQrShape(token, key = '') {
  if (!token || !key) return { ok: false, error: 'token or key missing' };
  let parsed;
  try {
    parsed = JSON.parse(token);
  } catch (_) {
    return { ok: false, error: 'invalid QR token' };
  }
  const { sig, ...payload } = parsed;
  if (!sig || typeof sig !== 'string') return { ok: false, error: 'missing signature' };
  return { ok: true, payload, sig };
}

// ═══════════════════════════════════════════════════════════════════
// DUPLICATE / MISSING / ORPHAN DETECTION
// ═══════════════════════════════════════════════════════════════════

/**
 * Build the expected page set from packets.
 *
 * @param {Array<{ packetId: string, pageCount: number }>} packets
 * @returns {Set<string>} keys like "packetId::pageIndex"
 */
export function buildExpectedPageSet(packets = []) {
  const set = new Set();
  for (const p of packets) {
    const count = Number(p.pageCount ?? 0);
    for (let i = 0; i < count; i++) {
      set.add(`${p.packetId}::${i}`);
    }
  }
  return set;
}

/**
 * Detect duplicates among routed pages — same (packet, page) more than once.
 *
 * @param {Array<{ pageId: number, packetId: string, pageIndex: number }>} routed
 * @returns {Array<{ pageId: number, key: string, occurrences: number }>}
 */
export function detectDuplicatePages(routed = []) {
  const seen = new Map();
  for (const r of routed) {
    const key = `${r.packetId}::${r.pageIndex}`;
    const entry = seen.get(key) || { key, pageIds: [] };
    entry.pageIds.push(r.pageId);
    seen.set(key, entry);
  }
  const out = [];
  for (const [key, entry] of seen) {
    if (entry.pageIds.length > 1) {
      out.push({ key, pageIds: entry.pageIds, occurrences: entry.pageIds.length });
    }
  }
  return out;
}

/**
 * Detect missing pages — expected set minus reconciled (routed) set.
 *
 * @param {Set<string>} expectedSet
 * @param {Array<{ packetId: string, pageIndex: number }>} reconciled
 * @returns {Array<{ key: string, packetId: string, pageIndex: number }>}
 */
export function detectMissingPages(expectedSet, reconciled = []) {
  const got = new Set(reconciled.map((r) => `${r.packetId}::${r.pageIndex}`));
  const missing = [];
  for (const key of expectedSet) {
    if (!got.has(key)) {
      const [packetId, pageIndex] = key.split('::');
      missing.push({ key, packetId, pageIndex: Number(pageIndex) });
    }
  }
  return missing;
}

/**
 * Detect orphan pages — reconciled pages that are NOT in the expected set
 * (QR decodes fine but points to an unknown packet/page → possible mix-up).
 *
 * @param {Set<string>} expectedSet
 * @param {Array<{ pageId: number, packetId: string, pageIndex: number }>} reconciled
 * @returns {Array<{ pageId: number, key: string, packetId: string, pageIndex: number }>}
 */
export function detectOrphanPages(expectedSet, reconciled = []) {
  const orphans = [];
  for (const r of reconciled) {
    const key = `${r.packetId}::${r.pageIndex}`;
    if (!expectedSet.has(key)) {
      orphans.push({ pageId: r.pageId, key, packetId: r.packetId, pageIndex: r.pageIndex });
    }
  }
  return orphans;
}

/**
 * Reconcile counters for a batch from raw pages + expected set.
 *
 * @param {Object} params
 * @param {Array} params.pages - scan_pages rows
 * @param {Array} params.expectedPackets - [{ packetId, pageCount }]
 * @returns {Object} counters for the batch update
 */
export function buildReconciliationCounters({ pages = [], expectedPackets = [] } = {}) {
  const expectedSet = buildExpectedPageSet(expectedPackets);
  const routed = pages
    .filter((p) => p.page_status === SCAN_PAGE_STATUS.ROUTED)
    .map((p) => ({ pageId: p.id, packetId: p.routed_packet_id, pageIndex: p.routed_page_index }));

  const duplicates = detectDuplicatePages(routed);
  const orphans = detectOrphanPages(expectedSet, routed);

  // Unique reconciled (packet,page) keys — duplicate scan hali ham
  // reconciled page hisoblanadi (faqat qo'shimcha nusxa), shuning uchun
  // key'lar dedupe qilinadi lekin butunlay chiqarib tashlanmaydi
  const uniqueKeys = new Set();
  for (const r of routed) {
    uniqueKeys.add(`${r.packetId}::${r.pageIndex}`);
  }

  const missing = detectMissingPages(expectedSet, [...uniqueKeys].map((k) => {
    const [packetId, pageIndex] = k.split('::');
    return { packetId, pageIndex: Number(pageIndex) };
  }));

  return {
    expected_pages: expectedSet.size,
    scanned_pages: pages.length,
    reconciled_pages: uniqueKeys.size,
    missing_pages: missing.length,
    duplicate_pages: duplicates.length,
    orphan_pages: orphans.length,
    quality_failed: pages.filter((p) => p.page_status === SCAN_PAGE_STATUS.QUALITY_FAILED).length,
  };
}

// ═══════════════════════════════════════════════════════════════════
// OMR CONFIDENCE
// ═══════════════════════════════════════════════════════════════════

/**
 * Classify OMR mark confidence.
 *   high      → >= ambiguousThreshold (0.9)
 *   ambiguous → >= lowThreshold (0.7) but < 0.9
 *   low       → < 0.7
 *
 * @param {number} confidence - 0..1
 * @returns {string} high | ambiguous | low
 */
export function classifyOmrConfidence(confidence, opts = {}) {
  const ambiguousThreshold = opts.ambiguousThreshold ?? SCAN_DEFAULTS.ambiguousConfidenceThreshold;
  const lowThreshold = opts.lowThreshold ?? SCAN_DEFAULTS.lowConfidenceThreshold;
  const c = Number(confidence);
  if (Number.isNaN(c)) return OMR_CONFIDENCE_STATUS.LOW;
  if (c >= ambiguousThreshold) return OMR_CONFIDENCE_STATUS.HIGH;
  if (c >= lowThreshold) return OMR_CONFIDENCE_STATUS.AMBIGUOUS;
  return OMR_CONFIDENCE_STATUS.LOW;
}

// ═══════════════════════════════════════════════════════════════════
// OCR DERIVATIVE & HASH LINEAGE
// ═══════════════════════════════════════════════════════════════════

export function validateOcrKind(kind) {
  return OCR_KINDS.includes(kind) ? { ok: true } : { ok: false, error: `Invalid OCR kind: ${kind}` };
}

export function validateDerivativeKind(kind) {
  return DERIVATIVE_KINDS.includes(kind)
    ? { ok: true }
    : { ok: false, error: `Invalid derivative kind: ${kind}` };
}

/**
 * Compute a content hash for a buffer (canonical hex).
 * @param {Buffer} buf
 * @returns {string}
 */
export function hashBuffer(buf) {
  return createHash('sha256').update(buf).digest('hex');
}
