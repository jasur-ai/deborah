/**
 * Edikit — Portfolio & Verifiable Credential (integration tests, Prompt 61)
 *
 * Service qatlami: issueCredential (guarded + idempotent), revoke/renew/
 * appeal flows, share grant create/verify/revoke, credential verifier
 * (valid/revoked/expired) — through fake DB; audit events traced.
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
    limit: () => builder(table, state),
    async execute() {
      const rows = (tables[table] || []).filter((r) => matches(r, state.wheres));
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

const criteria = {
  competencyIds: [1, 2],
  requiredEvidenceKinds: ['final', 'reflection'],
  minGradeScaled: 7000,
  expiresInDays: 365,
  description: 'DTM Matematika',
};

const evidence = {
  competencyIds: [1, 2],
  ratifiedKinds: ['final', 'reflection'],
  gradeScaled: 8000,
};

describe('credential — service (Prompt 61 §18/19)', () => {
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
        CREDENTIAL_DEFINITION_PUBLISH: 'credential:definition:publish',
        CREDENTIAL_ISSUE: 'credential:issue',
        CREDENTIAL_REVOKE: 'credential:revoke',
        CREDENTIAL_RENEW: 'credential:renew',
      },
    }));
    mod = await import('../../src/modules/credential/index.js');
  });

  it('issue — AI cannot issue (guard)', async () => {
    const r = await mod.issueCredential({
      definitionId: 1, userId: 5, recipient: 's@x.com', evidence, criteria,
      issuedBy: 'ai-bot', issuedByRole: 'ai', evidenceRatified: true, teacherApproved: true,
    });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/AI cannot issue/i);
    expect(auditMock).not.toHaveBeenCalled();
  });

  it('issue — requires published definition', async () => {
    tables.credential_definitions = [{ id: 1, tenant_id: 1, name: 'X', version: 'v1', status: 'draft', criteria: JSON.stringify(criteria), issuer_authority: 'admin' }];
    const r = await mod.issueCredential({
      definitionId: 1, userId: 5, recipient: 's@x.com', evidence, criteria,
      issuedBy: 'admin', issuedByRole: 'admin', evidenceRatified: true, teacherApproved: true,
    });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/published/i);
  });

  it('issue — full flow (publish → issue → audit + credential persisted)', async () => {
    const def = await mod.createCredentialDefinition({ name: 'Matematika', version: 'v1', criteria, issuerAuthority: 'admin', createdBy: 'admin' });
    expect(def.ok).toBe(true);
    await mod.publishCredentialDefinition({ definitionId: def.definitionId, actorId: 'admin' });
    expect(auditMock).toHaveBeenCalledWith(expect.objectContaining({ action: 'credential:definition:publish' }));

    const r = await mod.issueCredential({
      definitionId: def.definitionId, userId: 5, recipient: 's@x.com', evidence, criteria,
      issuedBy: 'admin', issuedByRole: 'admin', evidenceRatified: true, teacherApproved: true,
    });
    expect(r.ok).toBe(true);
    expect(r.credential.vcDigest).toBeTruthy();
    expect(tables.credentials).toHaveLength(1);
    expect(tables.credential_events.some((e) => e.event_type === 'issue')).toBe(true);
    expect(auditMock).toHaveBeenCalledWith(expect.objectContaining({ action: 'credential:issue' }));
  });

  it('issue — idempotent (same evidence → cached, no second row)', async () => {
    const def = await mod.createCredentialDefinition({ name: 'X', version: 'v1', criteria, issuerAuthority: 'admin' });
    await mod.publishCredentialDefinition({ definitionId: def.definitionId, actorId: 'admin' });
    const opts = {
      definitionId: def.definitionId, userId: 5, recipient: 's@x.com', evidence, criteria,
      issuedBy: 'admin', issuedByRole: 'admin', evidenceRatified: true, teacherApproved: true,
    };
    const r1 = await mod.issueCredential(opts);
    const r2 = await mod.issueCredential(opts);
    expect(r2.cached).toBe(true);
    expect(tables.credentials).toHaveLength(1);
    expect(r1.credential.vcDigest).toBe(r2.credential.vcDigest);
  });

  it('issue — not eligible without ratified evidence / min grade', async () => {
    const def = await mod.createCredentialDefinition({ name: 'X', version: 'v1', criteria, issuerAuthority: 'admin' });
    await mod.publishCredentialDefinition({ definitionId: def.definitionId, actorId: 'admin' });
    const r = await mod.issueCredential({
      definitionId: def.definitionId, userId: 5, recipient: 's@x.com',
      evidence: { competencyIds: [1, 2], ratifiedKinds: [], gradeScaled: 5000 }, criteria,
      issuedBy: 'admin', issuedByRole: 'admin', evidenceRatified: true, teacherApproved: true,
    });
    expect(r.ok).toBe(false);
    expect(r.checks.some((c) => c.id === 'min_grade' && !c.ok)).toBe(true);
  });

  it('revoke — FSM guarded + audit; invalid transition rejected', async () => {
    const def = await mod.createCredentialDefinition({ name: 'X', version: 'v1', criteria, issuerAuthority: 'admin' });
    await mod.publishCredentialDefinition({ definitionId: def.definitionId, actorId: 'admin' });
    const issued = await mod.issueCredential({
      definitionId: def.definitionId, userId: 5, recipient: 's@x.com', evidence, criteria,
      issuedBy: 'admin', issuedByRole: 'admin', evidenceRatified: true, teacherApproved: true,
    });
    const r = await mod.revokeCredential({ credentialId: issued.credential.id, reason: 'fraud', actorId: 'admin' });
    expect(r.ok).toBe(true);
    expect(tables.credentials[0].status).toBe('revoked');
    expect(tables.credential_events.some((e) => e.event_type === 'revoke')).toBe(true);
    expect(auditMock).toHaveBeenCalledWith(expect.objectContaining({ action: 'credential:revoke' }));

    // double revoke rejected
    const again = await mod.revokeCredential({ credentialId: issued.credential.id, reason: 'x', actorId: 'admin' });
    expect(again.ok).toBe(false);
  });

  it('renew — expired credential with current eligibility', async () => {
    const def = await mod.createCredentialDefinition({ name: 'X', version: 'v1', criteria, issuerAuthority: 'admin' });
    await mod.publishCredentialDefinition({ definitionId: def.definitionId, actorId: 'admin' });
    const issued = await mod.issueCredential({
      definitionId: def.definitionId, userId: 5, recipient: 's@x.com', evidence, criteria,
      issuedBy: 'admin', issuedByRole: 'admin', evidenceRatified: true, teacherApproved: true,
    });
    tables.credentials[0].status = 'expired';
    const r = await mod.renewCredential({
      credentialId: issued.credential.id, evidence, criteria: { ...criteria, expiresInDays: 365 }, actorId: 'admin',
    });
    expect(r.ok).toBe(true);
    expect(tables.credentials[0].status).toBe('active');
    expect(tables.credentials[0].renewed_from).toBe(issued.credential.id);
    expect(auditMock).toHaveBeenCalledWith(expect.objectContaining({ action: 'credential:renew' }));
  });

  it('appeal — student may appeal a revoked credential once', async () => {
    const def = await mod.createCredentialDefinition({ name: 'X', version: 'v1', criteria, issuerAuthority: 'admin' });
    await mod.publishCredentialDefinition({ definitionId: def.definitionId, actorId: 'admin' });
    const issued = await mod.issueCredential({
      definitionId: def.definitionId, userId: 5, recipient: 's@x.com', evidence, criteria,
      issuedBy: 'admin', issuedByRole: 'admin', evidenceRatified: true, teacherApproved: true,
    });
    await mod.revokeCredential({ credentialId: issued.credential.id, reason: 'dispute', actorId: 'admin' });
    const r = await mod.appealCredential({ credentialId: issued.credential.id, userId: 5, reason: 'not mine', appealCount: 0 });
    expect(r.ok).toBe(true);
    expect(tables.credential_events.some((e) => e.event_type === 'appeal')).toBe(true);
    // not owner
    const r2 = await mod.appealCredential({ credentialId: issued.credential.id, userId: 99, reason: 'x', appealCount: 0 });
    expect(r2.ok).toBe(false);
  });

  it('share grant — create → verify valid → revoke → verify invalid', async () => {
    await mod.ensurePortfolio({ userId: 5, displayName: 'Student' });
    const item = await mod.addPortfolioItem({ userId: 5, kind: 'reflection', title: 'Mening fikrim' });
    expect(item.ok).toBe(true);
    const grant = await mod.createShareGrant({ userId: 5, itemId: item.itemId, viewerEmail: 'v@x.com' });
    expect(grant.ok).toBe(true);

    const v1 = await mod.verifyShareGrant({ token: grant.token, viewerEmail: 'v@x.com' });
    expect(v1.ok).toBe(true);
    expect(v1.verifiable).toBe(true);

    // wrong viewer
    const wrong = await mod.verifyShareGrant({ token: grant.token, viewerEmail: 'other@x.com' });
    expect(wrong.ok).toBe(false);

    const grantRow = tables.share_grants[0];
    const rev = await mod.revokeShareGrant({ userId: 5, grantId: grantRow.id, actorRole: 'user' });
    expect(rev.ok).toBe(true);
    const v2 = await mod.verifyShareGrant({ token: grant.token, viewerEmail: 'v@x.com' });
    expect(v2.ok).toBe(false);
    expect(v2.error).toMatch(/revoked/i);
  });

  it('verify credential — valid then revoked', async () => {
    const def = await mod.createCredentialDefinition({ name: 'X', version: 'v1', criteria, issuerAuthority: 'admin' });
    await mod.publishCredentialDefinition({ definitionId: def.definitionId, actorId: 'admin' });
    const issued = await mod.issueCredential({
      definitionId: def.definitionId, userId: 5, recipient: 's@x.com', evidence, criteria,
      issuedBy: 'admin', issuedByRole: 'admin', evidenceRatified: true, teacherApproved: true,
    });
    const digest = issued.credential.vcDigest;
    const v1 = await mod.verifyCredential({ vcDigest: digest });
    expect(v1.verifiable).toBe(true);
    expect(v1.status).toBe('active');

    await mod.revokeCredential({ credentialId: issued.credential.id, reason: 'fraud', actorId: 'admin' });
    const v2 = await mod.verifyCredential({ vcDigest: digest });
    expect(v2.verifiable).toBe(true);
    expect(v2.status).toBe('revoked');
  });

  it('portfolio — default private; visibility switch', async () => {
    await mod.ensurePortfolio({ userId: 5, displayName: 'Student' });
    const item = await mod.addPortfolioItem({ userId: 5, kind: 'draft', title: 'Qoralama' });
    const { items } = await mod.listPortfolio({ userId: 5, includePrivate: true });
    expect(items[0].visibility).toBe('private');

    const r = await mod.setItemVisibility({ userId: 5, itemId: item.itemId, visibility: 'public' });
    expect(r.ok).toBe(true);
    const pub = await mod.getPublicPortfolio({ userId: 5 });
    expect(pub.items.some((i) => i.id === item.itemId)).toBe(true);
  });
});
