/**
 * Deborah — Data Classification, Privacy, Retention & Purge (e2e/security, Prompt 65)
 *
 * Full critical-journey (research.md §27): asset inventory (D0-D6) → legal
 * hold (fail-open bo'lmaydi) → DSAR export/delete → purge worker (multi-store
 * receipts) → delete DSAR fulfill. Security: D4 UZ tashqariga chiqmaydi,
 * KMS D3+ majburiy, legal hold purge'ni bloklaydi, audit trail.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  assertLegalHoldFailClosed,
  computeRetention,
  buildDeletionReceipt,
} from '../../src/modules/data-governance/data-governance.schema.js';

// ── Chainable in-memory fake DB (Kysely-ish) ──
function makeFakeDb(seed = {}) {
  const tables = {};
  for (const [name, rows] of Object.entries(seed)) tables[name] = rows.map((r) => ({ ...r }));
  let nextId = 1;

  const matches = (row, wheres) =>
    (wheres || []).every(([col, op, val]) => {
      if (op === '=') return row[col] === val;
      if (op === 'in') return Array.isArray(val) && val.includes(row[col]);
      return true;
    });

  const builder = (table, state = {}) => ({
    select: (cols) => builder(table, { ...state, cols }),
    selectAll: () => builder(table, { ...state, cols: null }),
    where: (col, op, val) => builder(table, { ...state, wheres: [...(state.wheres || []), [col, op, val]] }),
    orderBy: () => builder(table, state),
    limit: (n) => builder(table, { ...state, limitN: n }),
    async execute() {
      let rows = (tables[table] || []).filter((r) => matches(r, state.wheres));
      if (state.limitN) rows = rows.slice(0, state.limitN);
      if (state.cols === null) return rows.map((r) => ({ ...r }));
      return rows;
    },
    async executeTakeFirst() {
      const rows = await this.execute();
      return rows[0] || null;
    },
  });

  const db = {
    selectFrom: (table) => builder(table),
    insertInto: (table) => ({
      values: (row) => ({
        returning: (cols) => ({
          async executeTakeFirst() {
            const id = nextId++;
            (tables[table] = tables[table] || []).push({ id, ...row });
            const o = {};
            for (const c of cols) o[c] = { id, ...row }[c];
            return o;
          },
          async execute() {
            const id = nextId++;
            (tables[table] = tables[table] || []).push({ id, ...row });
          },
        }),
        async execute() {
          const id = nextId++;
          (tables[table] = tables[table] || []).push({ id, ...row });
        },
      }),
    }),
    updateTable: (table) => ({
      set: (patch) => ({
        where: () => ({
          where: () => ({
            async execute() {
              for (const row of tables[table] || []) Object.assign(row, patch);
            },
          }),
          async execute() {
            for (const row of tables[table] || []) Object.assign(row, patch);
          },
        }),
        async execute() {
          for (const row of tables[table] || []) Object.assign(row, patch);
        },
      }),
    }),
  };
  return { db, tables };
}

describe('Prompt 65 — data governance UAT', () => {
  let mod;
  let tables;
  let auditMock;

  beforeEach(async () => {
    vi.resetModules();
    const fake = makeFakeDb({});
    tables = fake.tables;
    auditMock = vi.fn(async () => true);
    vi.doMock('../../src/infrastructure/postgres.js', () => ({ getDb: () => fake.db }));
    vi.doMock('../../src/modules/auth/tenant-context.js', () => ({ getCurrentTenant: () => ({ id: 1 }) }));
    vi.doMock('../../src/modules/auth/audit.js', () => ({
      audit: auditMock,
      AUDIT_ACTIONS: {
        DATA_GOV_ASSET_REGISTER: 'data-gov:asset:register',
        DATA_GOV_HOLD_PLACE: 'data-gov:hold:place',
        DATA_GOV_HOLD_RELEASE: 'data-gov:hold:release',
        DATA_GOV_DSAR_CREATE: 'data-gov:dsar:create',
        DATA_GOV_DSAR_STATUS: 'data-gov:dsar:status',
        DATA_GOV_PURGE_RUN: 'data-gov:purge:run',
      },
    }));
    mod = await import('../../src/modules/data-governance/index.js');
  });

  it('full journey — asset inventory → legal hold → DSAR export/delete → purge receipts → fulfill', async () => {
    // 1. Register a PII asset (auto-classified D4, UZ boundary, KMS)
    const asset = await mod.registerDataAsset({
      assetName: 'student_records', assetType: 'table', storeName: 'postgres',
      containsPii: true, kmsEnabled: true, region: 'UZ', retentionDays: 365, legalBasis: 'consent', createdBy: 'admin',
    });
    expect(asset.ok).toBe(true);
    expect(asset.dataClass).toBe('D4');
    const assetId = tables.data_assets[0].id;

    // 2. D4 outside UZ rejected (security guard)
    const leak = await mod.registerDataAsset({ assetName: 'leak', assetType: 'object', containsPii: true, kmsEnabled: true, region: 'EU' });
    expect(leak.ok).toBe(false);
    expect(leak.error).toMatch(/UZ boundary/i);

    // 3. Export DSAR — create → in_progress → fulfilled (no purge needed)
    const exportDsar = await mod.createDsarRequest({ subjectKey: 's-2026-001', requestType: 'export', requestedBy: 'privacy-officer' });
    expect(exportDsar.ok).toBe(true);
    await mod.transitionDsar({ dsarId: exportDsar.dsarId, to: 'in_progress' });
    const exportFulfilled = await mod.transitionDsar({ dsarId: exportDsar.dsarId, to: 'fulfilled', fulfilledBy: 'privacy-officer' });
    expect(exportFulfilled.ok).toBe(true);

    // 4. Legal hold placed on subject
    const hold = await mod.placeLegalHold({ subjectKey: 's-2026-001', reason: 'regulatory investigation', source: 'regulatory', startedBy: 'admin' });
    expect(hold.ok).toBe(true);

    // 5. Delete DSAR requested — purge blocked by legal hold (fail-closed)
    const deleteDsar = await mod.createDsarRequest({ subjectKey: 's-2026-001', requestType: 'delete', requestedBy: 'privacy-officer' });
    await mod.transitionDsar({ dsarId: deleteDsar.dsarId, to: 'in_progress' });

    const blockedPurge = await mod.runPurgeWorker({ assetId, storeNames: ['postgres', 's3'], subjectKey: 's-2026-001', purgedBy: 'admin' });
    expect(blockedPurge.ok).toBe(false);
    expect(blockedPurge.blockedByLegalHold).toBe(true);
    expect(tables.deletion_receipts || []).toHaveLength(0); // nothing deleted while held

    // 6. Release hold → purge all derived stores → receipts
    await mod.releaseLegalHold({ holdId: hold.holdId, releasedBy: 'admin' });
    const purge = await mod.runPurgeWorker({ assetId, storeNames: ['postgres', 's3'], subjectKey: 's-2026-001', purgedBy: 'admin' });
    expect(purge.ok).toBe(true);
    expect(purge.receipts).toHaveLength(2);
    expect(purge.receipts.every((r) => r.status === 'purged')).toBe(true);

    const receipts = await mod.listDeletionReceipts({ assetId });
    expect(receipts).toHaveLength(2);
    expect(receipts.every((r) => r.receipt_hash)).toBe(true);

    // 7. Delete DSAR fulfill — all stores purged → OK
    const deleteFulfilled = await mod.transitionDsar({
      dsarId: deleteDsar.dsarId, to: 'fulfilled', fulfilledBy: 'privacy-officer',
      assetStores: ['postgres', 's3'],
      receipts: receipts.map((r) => ({ storeName: r.store_name, status: r.status })),
    });
    expect(deleteFulfilled.ok).toBe(true);

    // 8. Summary reflects lifecycle
    const s = await mod.getDataGovernanceSummary();
    expect(s.ok).toBe(true);
    expect(s.assets).toBe(1);
    expect(s.activeHolds).toBe(0);
    expect(s.dsarOpen).toBe(0);
    expect(s.purgedReceipts).toBe(2);

    // 9. Audit trail — every privileged action recorded
    for (const action of ['data-gov:asset:register', 'data-gov:hold:place', 'data-gov:hold:release', 'data-gov:dsar:create', 'data-gov:dsar:status', 'data-gov:purge:run']) {
      expect(auditMock).toHaveBeenCalledWith(expect.objectContaining({ action }));
    }
  });

  it('security — legal hold fail-open never happens; purge without hold check blocked', async () => {
    const a = await mod.registerDataAsset({ assetName: 'x', assetType: 'cache', createdBy: 'admin' });
    const assetId = tables.data_assets[0].id;

    // Direct schema guard: unchecked hold → blocked
    const rawGuard = assertLegalHoldFailClosed({ holdActive: false, holdChecked: false });
    expect(rawGuard.ok).toBe(false);
    const activeGuard = assertLegalHoldFailClosed({ holdActive: true, holdChecked: true });
    expect(activeGuard.ok).toBe(false);
  });

  it('retention + receipt determinism', async () => {
    const r = computeRetention({ retentionDays: 30, storedAt: new Date('2026-01-01T00:00:00Z') });
    expect(r.purgeAfter.toISOString()).toBe('2026-01-31T00:00:00.000Z');

    const h1 = buildDeletionReceipt({ tenantId: 1, assetId: 9, storeName: 'redis', purgedAt: '2026-07-01T00:00:00Z' });
    const h2 = buildDeletionReceipt({ tenantId: 1, assetId: 9, storeName: 'redis', purgedAt: '2026-07-01T00:00:00Z' });
    expect(h1).toBe(h2);
  });
});
