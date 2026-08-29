/**
 * Deborah — Data Classification, Privacy, Retention & Purge (integration tests, Prompt 65)
 *
 * Service qatlami (fake DB): asset registration (idempotent, classification,
 * KMS/UZ guards), legal hold place/release, purge worker legal-hold
 * fail-closed block, DSAR create/transition (delete requires all stores
 * purged), deletion receipts, summary.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

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

describe('data-governance — service (Prompt 65)', () => {
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

  it('asset — register idempotent, PII → D4, KMS/UZ guards, audit', async () => {
    const r = await mod.registerDataAsset({
      assetName: 'students', assetType: 'table', storeName: 'postgres',
      containsPii: true, kmsEnabled: true, region: 'UZ', retentionDays: 365, legalBasis: 'consent', createdBy: 'admin',
    });
    expect(r.ok).toBe(true);
    expect(r.dataClass).toBe('D4');
    expect(tables.data_assets).toHaveLength(1);
    expect(tables.data_assets[0].uz_boundary).toBe(true);
    expect(tables.data_assets[0].kms_required).toBe(true);
    expect(auditMock).toHaveBeenCalledWith(expect.objectContaining({ action: 'data-gov:asset:register' }));

    // idempotent
    const again = await mod.registerDataAsset({ assetName: 'students', assetType: 'table', storeName: 'postgres', containsPii: true, kmsEnabled: true, region: 'UZ', createdBy: 'admin' });
    expect(again.ok).toBe(true);
    expect(again.updated).toBe(true);
    expect(tables.data_assets).toHaveLength(1);

    // KMS guard — D4 without KMS rejected
    const noKms = await mod.registerDataAsset({ assetName: 'pii2', assetType: 'table', containsPii: true, kmsEnabled: false, region: 'UZ' });
    expect(noKms.ok).toBe(false);

    // UZ boundary guard — D4 outside UZ rejected
    const outside = await mod.registerDataAsset({ assetName: 'pii3', assetType: 'table', containsPii: true, kmsEnabled: true, region: 'EU' });
    expect(outside.ok).toBe(false);
  });

  it('purge worker — legal hold fail-closed blocks purge (§15)', async () => {
    const a = await mod.registerDataAsset({ assetName: 'scores', assetType: 'table', storeName: 'postgres', createdBy: 'admin' });
    const assetId = tables.data_assets[0].id;

    // Place legal hold on subject
    const hold = await mod.placeLegalHold({ subjectKey: 's-2026-001', reason: 'court order', source: 'court', startedBy: 'admin' });
    expect(hold.ok).toBe(true);

    // Purge with legal hold → blocked (fail-closed)
    const blocked = await mod.runPurgeWorker({ assetId, storeNames: ['postgres'], subjectKey: 's-2026-001', purgedBy: 'admin' });
    expect(blocked.ok).toBe(false);
    expect(blocked.blockedByLegalHold).toBe(true);
    expect(tables.deletion_receipts || []).toHaveLength(0);

    // Release hold → purge proceeds
    await mod.releaseLegalHold({ holdId: hold.holdId, releasedBy: 'admin' });
    const purged = await mod.runPurgeWorker({ assetId, storeNames: ['postgres'], subjectKey: 's-2026-001', purgedBy: 'admin' });
    expect(purged.ok).toBe(true);
    expect(purged.receipts).toHaveLength(1);
    expect(purged.receipts[0].status).toBe('purged');
    expect(purged.receipts[0].receiptHash).toMatch(/^[0-9a-f]{8}$/);
    expect(auditMock).toHaveBeenCalledWith(expect.objectContaining({ action: 'data-gov:purge:run' }));

    const receipts = await mod.listDeletionReceipts({ assetId });
    expect(receipts).toHaveLength(1);
    expect(receipts[0].status).toBe('purged');
  });

  it('DSAR — create/transition; delete requires all stores purged', async () => {
    const d = await mod.createDsarRequest({ subjectKey: 's-2026-001', requestType: 'delete', requestedBy: 'privacy-officer' });
    expect(d.ok).toBe(true);
    expect(auditMock).toHaveBeenCalledWith(expect.objectContaining({ action: 'data-gov:dsar:create' }));

    // received → in_progress OK
    await mod.transitionDsar({ dsarId: d.dsarId, to: 'in_progress', fulfilledBy: 'privacy-officer' });

    // fulfill without purging all stores → rejected
    const incomplete = await mod.transitionDsar({
      dsarId: d.dsarId, to: 'fulfilled', fulfilledBy: 'privacy-officer',
      assetStores: ['postgres', 's3'], receipts: [{ storeName: 'postgres', status: 'purged' }],
    });
    expect(incomplete.ok).toBe(false);
    expect(incomplete.error).toMatch(/missing stores: s3/);

    // fulfill with all stores purged → OK
    const ok = await mod.transitionDsar({
      dsarId: d.dsarId, to: 'fulfilled', fulfilledBy: 'privacy-officer',
      assetStores: ['postgres', 's3'], receipts: [{ storeName: 'postgres', status: 'purged' }, { storeName: 's3', status: 'purged' }],
    });
    expect(ok.ok).toBe(true);
    expect(auditMock).toHaveBeenCalledWith(expect.objectContaining({ action: 'data-gov:dsar:status' }));

    // terminal
    const reopen = await mod.transitionDsar({ dsarId: d.dsarId, to: 'in_progress' });
    expect(reopen.ok).toBe(false);
  });

  it('summary — counts and class distribution', async () => {
    await mod.registerDataAsset({ assetName: 'a1', assetType: 'table', createdBy: 'admin' });
    await mod.registerDataAsset({ assetName: 'a2', assetType: 'object', containsPii: true, kmsEnabled: true, region: 'UZ', createdBy: 'admin' });
    await mod.placeLegalHold({ subjectKey: 's1', reason: 'r', startedBy: 'admin' });
    await mod.createDsarRequest({ subjectKey: 's1', requestType: 'access' });

    const s = await mod.getDataGovernanceSummary();
    expect(s.ok).toBe(true);
    expect(s.assets).toBe(2);
    expect(s.byClass.D4).toBe(1);
    expect(s.activeHolds).toBe(1);
    expect(s.dsarRequests).toBe(1);
  });
});
