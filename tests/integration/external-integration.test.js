/**
 * Edikit — External Integration Boundary (integration tests, Prompt 66)
 *
 * Service qatlami (fake DB): connection registry (idempotent, mode guard),
 * HEMIS pull→staging→diff (idempotency key), ratified-only grade push
 * (§15), retry/DLQ backoff, pull-back reconciliation, token vault
 * envelope store/revoke, summary.
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
    updateTable: (table) => {
      const state = { patch: null, wheres: [] };
      const b = {
        set: (patch) => { state.patch = patch; return b; },
        where: (col, op, val) => { state.wheres.push([col, op, val]); return b; },
        async execute() {
          for (const row of tables[table] || []) {
            if (matches(row, state.wheres)) Object.assign(row, state.patch);
          }
        },
        returning: (cols) => ({
          async executeTakeFirst() {
            let found = null;
            for (const row of tables[table] || []) {
              if (matches(row, state.wheres)) { Object.assign(row, state.patch); found = row; }
            }
            if (!found) return null;
            const o = {};
            for (const c of cols) o[c] = found[c];
            return o;
          },
        }),
      };
      return b;
    },
  };

  return { db, tables };
}

describe('external-integration — service layer (fake DB)', () => {
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
        EXT_CONNECTION_REGISTER: 'ext:connection:register',
        EXT_HEMIS_PULL: 'ext:hemis:pull',
        EXT_GRADE_PUSH: 'ext:grade:push',
        EXT_JOB_RETRY: 'ext:job:retry',
        EXT_JOB_DLQ: 'ext:job:dlq',
        EXT_RECONCILE: 'ext:reconcile:run',
        EXT_ONEID_LINK: 'ext:oneid:link',
        EXT_ONEID_REVOKE: 'ext:oneid:revoke',
        EXT_TOKEN_STORE: 'ext:token:store',
        EXT_TOKEN_REVOKE: 'ext:token:revoke',
      },
    }));
    mod = await import('../../src/modules/external-integration/index.js');
  });

  it('connection — register idempotent, sandbox default, audit', async () => {
    const r = await mod.registerConnection({ provider: 'hemis', mode: 'sandbox', createdBy: 'admin' });
    expect(r.ok).toBe(true);
    expect(r.connection.provider).toBe('hemis');
    expect(tables.external_connections).toHaveLength(1);
    expect(auditMock).toHaveBeenCalledWith(expect.objectContaining({ action: 'ext:connection:register' }));

    const again = await mod.registerConnection({ provider: 'hemis', mode: 'sandbox', createdBy: 'admin' });
    expect(again.ok).toBe(true);
    expect(again.updated).toBe(true);
    expect(tables.external_connections).toHaveLength(1);
  });

  it('connection — live mode blocked without official contract (sandbox-only)', async () => {
    // isLiveMode() returns false because env vars are unset → live rejected.
    const r = await mod.registerConnection({ provider: 'hemis', mode: 'live', baseUrl: 'https://hemis.uz', createdBy: 'admin' });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/official/);
  });

  it('HEMIS pull → staging — idempotent by payload hash', async () => {
    await mod.registerConnection({ provider: 'hemis', mode: 'sandbox', createdBy: 'admin' });
    const conn = tables.external_connections[0];

    const p1 = await mod.hemisPullToStaging({ connectionId: conn.id, createdBy: 'admin' });
    expect(p1.ok).toBe(true);
    expect(p1.rows).toHaveLength(3);
    expect(p1.rows[0].studentId).toBe('HEM-2026-001');
    expect(tables.external_sync_jobs).toHaveLength(1);

    const p2 = await mod.hemisPullToStaging({ connectionId: conn.id, createdBy: 'admin' });
    expect(p2.ok).toBe(true);
    expect(p2.idempotent).toBe(true);
    expect(tables.external_sync_jobs).toHaveLength(1); // no duplicate job
    expect(auditMock).toHaveBeenCalledWith(expect.objectContaining({ action: 'ext:hemis:pull' }));
  });

  it('grade push — ratified-only (§15); provisional rejected before any job', async () => {
    await mod.registerConnection({ provider: 'hemis', mode: 'sandbox', createdBy: 'admin' });
    const conn = tables.external_connections[0];

    const rej = await mod.pushRatifiedGrades({
      connectionId: conn.id, grades: [{ externalId: 'HEM-2026-001', finalGrade: 88 }], decision: 'provisional', createdBy: 'admin',
    });
    expect(rej.ok).toBe(false);
    expect(rej.error).toMatch(/ratified/);
    expect(tables.external_sync_jobs || []).toHaveLength(0);

    const ok = await mod.pushRatifiedGrades({
      connectionId: conn.id, grades: [{ externalId: 'HEM-2026-001', finalGrade: 88 }], decision: 'ratified', createdBy: 'admin',
    });
    expect(ok.ok).toBe(true);
    expect(ok.externalRefs).toHaveLength(1);
    expect(tables.external_sync_jobs).toHaveLength(1);
    expect(auditMock).toHaveBeenCalledWith(expect.objectContaining({ action: 'ext:grade:push' }));

    // idempotent — same payload → same job
    const again = await mod.pushRatifiedGrades({
      connectionId: conn.id, grades: [{ externalId: 'HEM-2026-001', finalGrade: 88 }], decision: 'ratified', createdBy: 'admin',
    });
    expect(again.idempotent).toBe(true);
    expect(tables.external_sync_jobs).toHaveLength(1);
  });

  it('retry — backoff guard; exhausted → dead-letter', async () => {
    await mod.registerConnection({ provider: 'hemis', mode: 'sandbox', createdBy: 'admin' });
    const conn = tables.external_connections[0];

    // Create a failed job directly in the fake table
    const job = await mod.pushRatifiedGrades({
      connectionId: conn.id, grades: [{ externalId: 'X', finalGrade: 1 }], decision: 'ratified', createdBy: 'admin',
    });
    const jobId = job.job.id;
    // Simulate failed status + attempts maxed
    tables.external_sync_jobs.find((j) => j.id === jobId).status = 'failed';
    tables.external_sync_jobs.find((j) => j.id === jobId).attempts = 5;

    const retry = await mod.retrySyncJob({ jobId, createdBy: 'admin' });
    expect(retry.ok).toBe(false);
    expect(retry.deadLettered).toBe(true);
    expect(tables.external_sync_jobs.find((j) => j.id === jobId).status).toBe('dead_letter');
    expect(auditMock).toHaveBeenCalledWith(expect.objectContaining({ action: 'ext:job:dlq' }));
  });

  it('retry — within attempts → running + backoff scheduled', async () => {
    await mod.registerConnection({ provider: 'hemis', mode: 'sandbox', createdBy: 'admin' });
    const conn = tables.external_connections[0];
    const job = await mod.pushRatifiedGrades({
      connectionId: conn.id, grades: [{ externalId: 'Y', finalGrade: 2 }], decision: 'ratified', createdBy: 'admin',
    });
    const jobId = job.job.id;
    tables.external_sync_jobs.find((j) => j.id === jobId).status = 'failed';
    tables.external_sync_jobs.find((j) => j.id === jobId).attempts = 1;
    tables.external_sync_jobs.find((j) => j.id === jobId).next_retry_at = null;

    const retry = await mod.retrySyncJob({ jobId, createdBy: 'admin' });
    expect(retry.ok).toBe(true);
    expect(retry.job.status).toBe('running');
    expect(retry.job.attempts).toBe(2);
    expect(retry.job.next_retry_at).toBeTruthy();
  });

  it('pull-back reconciliation — diff added/removed/changed', async () => {
    await mod.registerConnection({ provider: 'hemis', mode: 'sandbox', createdBy: 'admin' });
    const conn = tables.external_connections[0];

    const r = await mod.runReconciliation({
      connectionId: conn.id,
      externalRows: [
        { externalId: 'A', firstName: 'x', lastName: 'y', pinfl: '1' },
        { externalId: 'B', firstName: 'x', lastName: 'y', pinfl: '2' },
      ],
      localRows: [
        { externalId: 'A', firstName: 'x', lastName: 'y', pinfl: '1' },
        { externalId: 'C', firstName: 'q', lastName: 'w', pinfl: '3' },
      ],
      keyField: 'externalId',
      createdBy: 'admin',
    });
    expect(r.ok).toBe(true);
    expect(r.diff.addedCount).toBe(1);
    expect(r.diff.removedCount).toBe(1);
    expect(r.diff.changedCount).toBe(0);
    expect(auditMock).toHaveBeenCalledWith(expect.objectContaining({ action: 'ext:reconcile:run' }));
  });

  it('token vault — envelope store + revoke; metadata only listing', async () => {
    await mod.registerConnection({ provider: 'oneid', mode: 'sandbox', createdBy: 'admin' });
    const conn = tables.external_connections[0];

    const stored = await mod.tokenVaultStore({
      connectionId: conn.id, tokenType: 'access', token: 'super-secret-token', scopes: ['identity.verify'],
      masterKey: 'a-very-long-master-key-123456', createdBy: 'admin',
    });
    expect(stored.ok).toBe(true);
    const row = tables.token_vault.find((t) => t.id === stored.tokenId);
    expect(row.ciphertext).toBeTruthy();
    expect(row.ciphertext).not.toContain('super-secret-token'); // no plaintext
    expect(auditMock).toHaveBeenCalledWith(expect.objectContaining({ action: 'ext:token:store' }));

    const listed = await mod.listVaultTokens();
    expect(listed[0].token).toBeUndefined(); // metadata only — no secret leak

    const revoked = await mod.tokenVaultRevoke({ tokenId: stored.tokenId, revokedBy: 'admin' });
    expect(revoked.ok).toBe(true);
    expect(tables.token_vault.find((t) => t.id === stored.tokenId).revoked_at).toBeTruthy();
    expect(auditMock).toHaveBeenCalledWith(expect.objectContaining({ action: 'ext:token:revoke' }));
  });

  it('summary — counts connections/jobs/identities/tokens', async () => {
    await mod.registerConnection({ provider: 'hemis', mode: 'sandbox', createdBy: 'admin' });
    await mod.registerConnection({ provider: 'oneid', mode: 'sandbox', createdBy: 'admin' });
    const conn = tables.external_connections[0];
    await mod.hemisPullToStaging({ connectionId: conn.id, createdBy: 'admin' });

    const s = await mod.getExternalIntegrationSummary();
    expect(s.ok).toBe(true);
    expect(s.connections).toBe(2);
    expect(s.connectionsByProvider.hemis).toBe(1);
    expect(s.jobs).toBe(1);
    expect(s.jobsByStatus.success).toBe(1);
  });
});
