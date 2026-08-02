/**
 * Edikit — Scan module unit tests (Prompt 43)
 *
 * Pure logic tests: quality gate, QR decode/routing, out-of-order,
 * duplicate/missing/orphan detection, OMR confidence, completion blocker,
 * OCR/derivative validation, hash lineage.
 */

import { describe, it, expect } from 'vitest';
import {
  SCAN_BATCH_STATUS,
  SCAN_PAGE_STATUS,
  QR_STATUS,
  RECONCILIATION_KINDS,
  QUALITY_FLAGS,
  OMR_CONFIDENCE_STATUS,
  validateScanBatchTransition,
  evaluateQualityGate,
  decodeAndRoutePage,
  buildExpectedPageSet,
  detectDuplicatePages,
  detectMissingPages,
  detectOrphanPages,
  buildReconciliationCounters,
  classifyOmrConfidence,
  validateOcrKind,
  validateDerivativeKind,
  hashBuffer,
} from '../../src/modules/scan/scan.schema.js';

describe('Scan — quality gate (§52.5)', () => {
  it('passes a clean 300 DPI portrait page', () => {
    const r = evaluateQualityGate({ dpi: 300, orientation: 'portrait' });
    expect(r.ok).toBe(true);
    expect(r.score).toBe(100);
    expect(r.flags).toEqual([]);
  });

  it('flags blur/skew/shadow/cut and lowers score below gate', () => {
    const r = evaluateQualityGate({ dpi: 150, orientation: 'portrait', blur: true, cut: true });
    expect(r.ok).toBe(false);
    expect(r.flags).toContain('blur');
    expect(r.flags).toContain('cut');
    expect(r.flags).toContain('low_dpi');
    expect(r.score).toBeLessThan(60);
  });

  it('flags wrong orientation (upside_down) as a hard error', () => {
    const r = evaluateQualityGate({ dpi: 300, orientation: 'upside_down' });
    expect(r.ok).toBe(false);
    expect(r.flags).toContain('wrong_orientation');
  });

  it('flags duplex missing backside', () => {
    const r = evaluateQualityGate({ dpi: 300, orientation: 'portrait', duplexMissing: true });
    expect(r.ok).toBe(true);
    expect(r.flags).toContain('duplex_missing');
  });

  it('never exceeds 0..100 score range', () => {
    const r = evaluateQualityGate({ dpi: 100, orientation: 'upside_down', blur: true, skew: true, shadow: true, cut: true, duplexMissing: true });
    expect(r.score).toBeGreaterThanOrEqual(0);
    expect(r.score).toBeLessThanOrEqual(100);
  });
});

describe('Scan — QR decode + routing (§18, §52.3)', () => {
  it('routes a valid signed QR to packet/page', () => {
    // Build a minimal token shape the schema understands (signature checked by paper.schema in service)
    const r = decodeAndRoutePage(
      JSON.stringify({ v: 1, type: 'paper_page', packet: 'opq_abc', page: 2, epoch: 1, nonce: 'n1', sig: 'x' }),
      'test-key'
    );
    expect(r.status).toBe(QR_STATUS.DECODED);
    expect(r.packetId).toBe('opq_abc');
    expect(r.pageIndex).toBe(2);
  });

  it('returns forged for tampered payload shape', () => {
    const r = decodeAndRoutePage(JSON.stringify({ sig: 'x' }), 'test-key');
    expect(r.status).toBe(QR_STATUS.FORGED);
  });

  it('returns missing when no QR token', () => {
    const r = decodeAndRoutePage(null, 'test-key');
    expect(r.status).toBe(QR_STATUS.MISSING);
  });

  it('returns unreadable for non-JSON token', () => {
    const r = decodeAndRoutePage('not-json', 'test-key');
    expect(r.status).toBe(QR_STATUS.FORGED);
  });
});

describe('Scan — duplicate/missing/orphan detection (Prompt 43 §09)', () => {
  const packets = [
    { packetId: 'p1', pageCount: 3 },
    { packetId: 'p2', pageCount: 2 },
  ];

  it('builds the expected page set from packets', () => {
    const set = buildExpectedPageSet(packets);
    expect(set.size).toBe(5);
    expect(set.has('p1::0')).toBe(true);
    expect(set.has('p2::1')).toBe(true);
  });

  it('detects duplicates (same packet/page scanned twice)', () => {
    const routed = [
      { pageId: 1, packetId: 'p1', pageIndex: 0 },
      { pageId: 2, packetId: 'p1', pageIndex: 0 },
      { pageId: 3, packetId: 'p1', pageIndex: 1 },
    ];
    const dups = detectDuplicatePages(routed);
    expect(dups).toHaveLength(1);
    expect(dups[0].key).toBe('p1::0');
    expect(dups[0].occurrences).toBe(2);
  });

  it('detects missing pages (expected but never reconciled)', () => {
    const expected = buildExpectedPageSet(packets);
    const reconciled = [
      { packetId: 'p1', pageIndex: 0 },
      { packetId: 'p1', pageIndex: 1 },
    ];
    const missing = detectMissingPages(expected, reconciled);
    expect(missing).toHaveLength(3);
    const keys = missing.map((m) => m.key).sort();
    expect(keys).toEqual(['p1::2', 'p2::0', 'p2::1']);
  });

  it('detects orphan pages (QR points to unknown packet/page)', () => {
    const expected = buildExpectedPageSet(packets);
    const reconciled = [
      { pageId: 1, packetId: 'p1', pageIndex: 0 },
      { pageId: 2, packetId: 'pX', pageIndex: 9 }, // unknown packet
    ];
    const orphans = detectOrphanPages(expected, reconciled);
    expect(orphans).toHaveLength(1);
    expect(orphans[0].key).toBe('pX::9');
  });

  it('builds full reconciliation counters', () => {
    const pages = [
      { id: 1, page_status: SCAN_PAGE_STATUS.ROUTED, routed_packet_id: 'p1', routed_page_index: 0 },
      { id: 2, page_status: SCAN_PAGE_STATUS.ROUTED, routed_packet_id: 'p1', routed_page_index: 0 }, // dup
      { id: 3, page_status: SCAN_PAGE_STATUS.ROUTED, routed_packet_id: 'p1', routed_page_index: 1 },
      { id: 4, page_status: SCAN_PAGE_STATUS.QUALITY_FAILED, routed_packet_id: null, routed_page_index: null },
    ];
    const c = buildReconciliationCounters({ pages, expectedPackets: packets });
    expect(c.expected_pages).toBe(5);
    expect(c.scanned_pages).toBe(4);
    expect(c.reconciled_pages).toBe(2);
    expect(c.missing_pages).toBe(3);
    expect(c.duplicate_pages).toBe(1);
    expect(c.orphan_pages).toBe(0);
    expect(c.quality_failed).toBe(1);
  });
});

describe('Scan — OMR confidence (§52.6)', () => {
  it('classifies high/ambiguous/low correctly', () => {
    expect(classifyOmrConfidence(0.95)).toBe(OMR_CONFIDENCE_STATUS.HIGH);
    expect(classifyOmrConfidence(0.82)).toBe(OMR_CONFIDENCE_STATUS.AMBIGUOUS);
    expect(classifyOmrConfidence(0.5)).toBe(OMR_CONFIDENCE_STATUS.LOW);
  });

  it('treats NaN as low confidence (never high)', () => {
    expect(classifyOmrConfidence('abc')).toBe(OMR_CONFIDENCE_STATUS.LOW);
  });

  it('supports custom thresholds', () => {
    expect(classifyOmrConfidence(0.75, { ambiguousThreshold: 0.8, lowThreshold: 0.6 }))
      .toBe(OMR_CONFIDENCE_STATUS.AMBIGUOUS);
  });
});

describe('Scan — completion blocker (§52.5 done condition)', () => {
  it('blocks grading_ready when reconciled < expected', () => {
    const v = validateScanBatchTransition(
      SCAN_BATCH_STATUS.RECONCILING,
      SCAN_BATCH_STATUS.GRADING_READY,
      { expected_pages: 5, reconciled_pages: 4 }
    );
    expect(v.ok).toBe(false);
    expect(v.error).toMatch(/blocked/i);
  });

  it('allows grading_ready when expected == reconciled', () => {
    const v = validateScanBatchTransition(
      SCAN_BATCH_STATUS.RECONCILING,
      SCAN_BATCH_STATUS.GRADING_READY,
      { expected_pages: 5, reconciled_pages: 5 }
    );
    expect(v.ok).toBe(true);
    expect(v.to).toBe(SCAN_BATCH_STATUS.GRADING_READY);
  });

  it('rejects illegal transitions', () => {
    const v = validateScanBatchTransition(SCAN_BATCH_STATUS.COMPLETE, SCAN_BATCH_STATUS.PROCESSING, {});
    expect(v.ok).toBe(false);
  });
});

describe('Scan — OCR/derivative validation + hash lineage (§15)', () => {
  it('validates OCR kinds', () => {
    expect(validateOcrKind('handwriting').ok).toBe(true);
    expect(validateOcrKind('math').ok).toBe(true);
    expect(validateOcrKind('code').ok).toBe(false);
  });

  it('validates derivative kinds', () => {
    expect(validateDerivativeKind('dewarped').ok).toBe(true);
    expect(validateDerivativeKind('enhanced').ok).toBe(true);
    expect(validateDerivativeKind('hack').ok).toBe(false);
  });

  it('hashBuffer produces stable sha256 hex', () => {
    const a = hashBuffer(Buffer.from('hello'));
    const b = hashBuffer(Buffer.from('hello'));
    const c = hashBuffer(Buffer.from('hello!'));
    expect(a).toBe(b);
    expect(a).toHaveLength(64);
    expect(a).not.toBe(c);
  });
});

describe('Scan — constants', () => {
  it('reconciliation kinds cover all manual-route cases', () => {
    expect(RECONCILIATION_KINDS).toContain('missing_page');
    expect(RECONCILIATION_KINDS).toContain('duplicate_page');
    expect(RECONCILIATION_KINDS).toContain('orphan_page');
    expect(RECONCILIATION_KINDS).toContain('unreadable_qr');
    expect(RECONCILIATION_KINDS).toContain('quality_failed');
    expect(RECONCILIATION_KINDS).toContain('low_confidence_omr');
    expect(RECONCILIATION_KINDS).toContain('low_confidence_ocr');
  });

  it('quality flags cover §52.5 gate', () => {
    for (const f of ['blur', 'skew', 'shadow', 'cut', 'duplex_missing', 'low_dpi', 'wrong_orientation']) {
      expect(QUALITY_FLAGS).toContain(f);
    }
  });
});
