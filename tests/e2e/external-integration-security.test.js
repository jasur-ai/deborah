/**
 * Deborah — External Integration Boundary (e2e/security, Prompt 66)
 *
 * Full critical-journey (research.md §12 identity assurance, §30 Google
 * login ≠ shaxs): connection registry → HEMIS pull → ratified-only grade
 * push (§15) → pull-back reconciliation → OneID account link (takeover
 * guard — subject mismatch REJECTED) → token vault envelope store/revoke.
 *
 * Security: account takeover (research §30.3), scraping/undocumented
 * endpoint taqiqlanadi, token reuse guard, idempotency.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  assertOneidAccountLink,
  assertRatifiedOnlyPush,
  assertDocumentedEndpoint,
  assertNoTokenReuse,
  buildTokenEnvelope,
  decryptTokenEnvelope,
  classifyOneidMismatch,
} from '../../src/modules/external-integration/external-integration.schema.js';

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

describe('external-integration — e2e/security critical journey', () => {
  let mod;
  let tables;
  let auditMock;

  beforeEach(async () => {
    vi.resetModules();
    const fake = makeFakeDb({
      users: [
        { id: 42, tenant_id: 1, pinfl: '31001990012345' }, // victim — verified identity
        { id: 7, tenant_id: 1, pinfl: '31001990012345' },
      ],
    });
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

  it('full journey — connection → pull → ratified push → reconcile → OneID link → vault', async () => {
    // 1. Connections
    await mod.registerConnection({ provider: 'hemis', mode: 'sandbox', createdBy: 'admin' });
    await mod.registerConnection({ provider: 'oneid', mode: 'sandbox', createdBy: 'admin' });
    const hemis = tables.external_connections.find((c) => c.provider === 'hemis');
    const oneid = tables.external_connections.find((c) => c.provider === 'oneid');
    expect(hemis).toBeTruthy();
    expect(oneid).toBeTruthy();

    // 2. HEMIS pull → staging (sandbox fixture, 3 students)
    const pull = await mod.hemisPullToStaging({ connectionId: hemis.id, createdBy: 'admin' });
    expect(pull.ok).toBe(true);
    expect(pull.rows).toHaveLength(3);

    // 3. Ratified-only grade push — rejected for provisional, accepted for ratified
    const rej = await mod.pushRatifiedGrades({ connectionId: hemis.id, grades: [{ externalId: 'HEM-2026-001', finalGrade: 88 }], decision: 'provisional' });
    expect(rej.ok).toBe(false);
    const push = await mod.pushRatifiedGrades({ connectionId: hemis.id, grades: [{ externalId: 'HEM-2026-001', finalGrade: 88 }], decision: 'ratified', createdBy: 'admin' });
    expect(push.ok).toBe(true);

    // 4. Pull-back reconciliation
    const recon = await mod.runReconciliation({ connectionId: hemis.id, localRows: [], keyField: 'studentId', createdBy: 'admin' });
    expect(recon.ok).toBe(true);
    expect(recon.diff.addedCount).toBeGreaterThan(0);

    // 5. OneID account link — matching subject (PINFL) linked
    const pinfl = '31001990012345';
    const linked = await mod.oneidLinkAccount({ connectionId: oneid.id, userId: 42, pinfl, createdBy: 'admin' });
    expect(linked.ok).toBe(true);
    expect(linked.identity.status).toBe('linked');
    expect(linked.identity.provider_subject).toBe(pinfl);
    expect(auditMock).toHaveBeenCalledWith(expect.objectContaining({ action: 'ext:oneid:link' }));

    // 6. Token vault — envelope store + metadata-only listing
    const tok = await mod.tokenVaultStore({ connectionId: oneid.id, tokenType: 'access', token: 'oneid-secret-token', scopes: ['identity.verify'], masterKey: 'a-very-long-master-key-123456', createdBy: 'admin' });
    expect(tok.ok).toBe(true);
    const listed = await mod.listVaultTokens();
    expect(listed[0].token).toBeUndefined();

    const summary = await mod.getExternalIntegrationSummary();
    expect(summary.ok).toBe(true);
    expect(summary.connections).toBe(2);
    expect(summary.identitiesLinked).toBe(1);
    expect(summary.tokensActive).toBe(1);
  });

  it('SECURITY — OneID account-link takeover rejected on subject mismatch (§30.3)', async () => {
    await mod.registerConnection({ provider: 'oneid', mode: 'sandbox', createdBy: 'admin' });
    const oneid = tables.external_connections.find((c) => c.provider === 'oneid');

    // Victim's STORED verified PINFL = 31001990012345; attacker supplies a
    // different subject (99999999999999) — takeover → reject (fail-closed).
    const r = await mod.oneidLinkAccount({ connectionId: oneid.id, userId: 42, pinfl: '99999999999999', createdBy: 'admin' });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/takeover|match/i);
    expect(tables.external_identities || []).toHaveLength(0); // nothing created

    // Schema-level guard (unit of the same rule)
    expect(assertOneidAccountLink({ providerSubject: 'VICTIM', localSubject: 'ATTACKER', assuranceLevel: 'I2' }).ok).toBe(false);
    expect(classifyOneidMismatch({ providerSubject: 'VICTIM', localSubject: 'ATTACKER' }).verdict).toBe('pending');
  });

  it('SECURITY — scraping / undocumented endpoint / token reuse blocked', async () => {
    // Endpoint allowlist
    expect(assertDocumentedEndpoint({ provider: 'hemis', endpoint: '/api/v1/students' }).ok).toBe(true);
    expect(assertDocumentedEndpoint({ provider: 'hemis', endpoint: '/api/v1/secret/export-all' }).ok).toBe(false);

    // Token reuse guard
    expect(assertNoTokenReuse({ tokenScopes: ['roster.read'], requiredScopes: ['grades.write'] }).ok).toBe(false);
    expect(assertNoTokenReuse({ tokenScopes: ['roster.read', 'grades.write'], requiredScopes: ['grades.write'] }).ok).toBe(true);

    // Ratified-only push
    expect(assertRatifiedOnlyPush({ decision: 'rejected' }).ok).toBe(false);
    expect(assertRatifiedOnlyPush({ decision: 'ratified' }).ok).toBe(true);
  });

  it('SECURITY — token vault envelope: plaintext never leaks; wrong key fails', async () => {
    const env = buildTokenEnvelope({ plaintext: 'ultra-secret', masterKey: 'a-very-long-master-key-123456' });
    expect(env.ok).toBe(true);
    expect(env.ciphertext).not.toContain('ultra-secret');

    const okDec = decryptTokenEnvelope({ ciphertext: env.ciphertext, iv: env.iv, keyRef: env.keyRef, masterKey: 'a-very-long-master-key-123456' });
    expect(okDec.ok).toBe(true);
    expect(okDec.plaintext).toBe('ultra-secret');

    const badDec = decryptTokenEnvelope({ ciphertext: env.ciphertext, iv: env.iv, keyRef: env.keyRef, masterKey: 'wrong-key-000000000000000000' });
    expect(badDec.ok).toBe(false);
  });

  it('OneID link → revoke lifecycle', async () => {
    await mod.registerConnection({ provider: 'oneid', mode: 'sandbox', createdBy: 'admin' });
    const oneid = tables.external_connections.find((c) => c.provider === 'oneid');

    const linked = await mod.oneidLinkAccount({ connectionId: oneid.id, userId: 7, pinfl: '31001990012345', createdBy: 'admin' });
    expect(linked.ok).toBe(true);

    const revoked = await mod.oneidRevokeLink({ linkId: linked.identity.id, revokedBy: 'admin' });
    expect(revoked.ok).toBe(true);
    expect(revoked.identity.status).toBe('revoked');
    expect(auditMock).toHaveBeenCalledWith(expect.objectContaining({ action: 'ext:oneid:revoke' }));

    const list = await mod.listIdentities();
    expect(list).toHaveLength(1);
    expect(list[0].status).toBe('revoked');
  });
});
