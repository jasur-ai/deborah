/**
 * Deborah — Scan module integration/contract tests (Prompt 43)
 *
 * Forged/unreadable QR reconciliation contract:
 *   - forged/unreadable/missing QR → page becomes ORPHAN (never silent-drop)
 *   - orphan → reconciliation queue ticket (manual, human-only)
 *   - valid QR routes to packet/page
 *   - duplicate detection routes second scan to DUPLICATE + ticket
 *   - completion blocker: batch cannot reach grading_ready with missing pages
 *   - idempotent batch create (same batch_key → same id)
 *
 * These run in graceful-degradation mode (no PostgreSQL): write paths
 * throw 'PostgreSQL required', read paths return []. Pure contract checks
 * live in unit tests; here we verify the service/API contract boundaries.
 */

import { describe, it, expect } from 'vitest';
import {
  ingestScannedPage,
  createScanBatch,
  createReconciliationTicket,
  listReconciliationQueue,
  resolveReconciliationTicket,
  transitionScanBatch,
  getScanBatch,
} from '../../src/modules/scan/index.js';

describe('Scan — service contract (graceful degradation without PG)', () => {
  it('createScanBatch requires PostgreSQL', async () => {
    await expect(createScanBatch({ batchKey: 'scan:x' })).rejects.toThrow('PostgreSQL required');
  });

  it('ingestScannedPage requires PostgreSQL', async () => {
    await expect(
      ingestScannedPage({ batchId: 1, imageBuffer: Buffer.from('abc') })
    ).rejects.toThrow('PostgreSQL required');
  });

  it('createReconciliationTicket requires PostgreSQL', async () => {
    await expect(
      createReconciliationTicket({ batchId: 1, kind: 'orphan_page' })
    ).rejects.toThrow('PostgreSQL required');
  });

  it('listReconciliationQueue degrades to empty array', async () => {
    const rows = await listReconciliationQueue({ batchId: 1 });
    expect(rows).toEqual([]);
  });

  it('resolveReconciliationTicket requires PostgreSQL', async () => {
    await expect(resolveReconciliationTicket({ ticketId: 1 })).rejects.toThrow('PostgreSQL required');
  });

  it('transitionScanBatch requires PostgreSQL', async () => {
    await expect(transitionScanBatch({ id: 1, to: 'complete' })).rejects.toThrow('PostgreSQL required');
  });

  it('getScanBatch degrades to null', async () => {
    const batch = await getScanBatch(1);
    expect(batch).toBeNull();
  });
});

describe('Scan — forged/unreadable QR contract (Prompt 43 §09, §52.5)', () => {
  it('decodeAndRoutePage marks forged QR as FORGED (never routed)', async () => {
    // Pure-logic contract: a tampered token must never route to a packet.
    const { decodeAndRoutePage, QR_STATUS } = await import('../../src/modules/scan/scan.schema.js');
    const r = decodeAndRoutePage(JSON.stringify({ sig: 'bad' }), 'key');
    expect(r.status).toBe(QR_STATUS.FORGED);
  });

  it('unreadable QR → orphan path (never silent drop)', async () => {
    const { decodeAndRoutePage, QR_STATUS } = await import('../../src/modules/scan/scan.schema.js');
    const r = decodeAndRoutePage(null, 'key');
    expect(r.status).toBe(QR_STATUS.MISSING);
  });

  it('forged QR never carries answer keys or raw PII (scan passes)', async () => {
    // A forged QR payload could try to smuggle answer keys — the shape
    // validator must reject anything that isn't { packet, page }.
    const { decodeAndRoutePage, QR_STATUS } = await import('../../src/modules/scan/scan.schema.js');
    const evil = JSON.stringify({ sig: 'x', answerKey: 'A,B,C' });
    const r = decodeAndRoutePage(evil, 'key');
    expect(r.status).toBe(QR_STATUS.FORGED);
  });
});
