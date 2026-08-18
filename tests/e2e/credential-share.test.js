/**
 * Deborah — Portfolio & Verifiable Credential (e2e/security, Prompt 61)
 *
 * Teacher multi-step flow: portfolio (default-private) → credential
 * definition (draft → publish) → issue (guarded, idempotent) → selective
 * share grant → public verifier (valid) → revoke → verifier (revoked).
 * Security: LLM never issues; raw sensitive submission never in public
 * payload; share grant viewer-bound + revocable.
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

describe('Prompt 61 — teacher portfolio + credential lifecycle', () => {
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

  it('full flow — private portfolio, guarded issue, share, verify, revoke', async () => {
    // 1. Portfolio default-private
    await mod.ensurePortfolio({ userId: 7, displayName: 'Aziz' });
    const item = await mod.addPortfolioItem({ userId: 7, kind: 'reflection', title: 'Reflection' });
    const { items } = await mod.listPortfolio({ userId: 7 });
    expect(items[0].visibility).toBe('private');

    // 2. Definition draft → publish (issuer authority)
    const def = await mod.createCredentialDefinition({ name: 'Matematika', version: 'v1', criteria, issuerAuthority: 'admin', createdBy: 'admin' });
    expect(def.ok).toBe(true);
    const pub = await mod.publishCredentialDefinition({ definitionId: def.definitionId, actorId: 'admin' });
    expect(pub.ok).toBe(true);

    // 3. Issue — guarded (teacher/admin + ratified + approved)
    const issued = await mod.issueCredential({
      definitionId: def.definitionId, userId: 7, recipient: 'aziz@x.com', evidence, criteria,
      issuedBy: 'admin', issuedByRole: 'admin', evidenceRatified: true, teacherApproved: true,
    });
    expect(issued.ok).toBe(true);
    const digest = issued.credential.vcDigest;
    expect(tables.credentials).toHaveLength(1);

    // Idempotent — re-issue returns cached
    const again = await mod.issueCredential({
      definitionId: def.definitionId, userId: 7, recipient: 'aziz@x.com', evidence, criteria,
      issuedBy: 'admin', issuedByRole: 'admin', evidenceRatified: true, teacherApproved: true,
    });
    expect(again.cached).toBe(true);

    // 4. Selective share grant (viewer-bound)
    const grant = await mod.createShareGrant({ userId: 7, itemId: item.itemId, viewerEmail: 'verifier@x.com' });
    expect(grant.ok).toBe(true);
    const v1 = await mod.verifyShareGrant({ token: grant.token, viewerEmail: 'verifier@x.com' });
    expect(v1.verifiable).toBe(true);

    // 5. Public verifier — valid
    const verify1 = await mod.verifyCredential({ vcDigest: digest });
    expect(verify1.verifiable).toBe(true);
    expect(verify1.status).toBe('active');

    // 6. Revoke — verifier shows revoked
    const rev = await mod.revokeCredential({ credentialId: issued.credential.id, reason: 'duplicate evidence', actorId: 'admin' });
    expect(rev.ok).toBe(true);
    const verify2 = await mod.verifyCredential({ vcDigest: digest });
    expect(verify2.verifiable).toBe(true);
    expect(verify2.status).toBe('revoked');

    // 7. Audit trail complete
    expect(auditMock).toHaveBeenCalledWith(expect.objectContaining({ action: 'credential:issue' }));
    expect(auditMock).toHaveBeenCalledWith(expect.objectContaining({ action: 'credential:revoke' }));
    expect(tables.credential_events.some((e) => e.event_type === 'revoke')).toBe(true);
  });

  it('security — raw submission never leaks into serialized outputs', async () => {
    const def = await mod.createCredentialDefinition({ name: 'X', version: 'v1', criteria, issuerAuthority: 'admin' });
    await mod.publishCredentialDefinition({ definitionId: def.definitionId, actorId: 'admin' });
    const issued = await mod.issueCredential({
      definitionId: def.definitionId, userId: 7, recipient: 's@x.com',
      evidence: { ...evidence, submission: 'RAW_SECRET_ANSWER', promptLog: 'secret prompt' },
      criteria, issuedBy: 'admin', issuedByRole: 'admin', evidenceRatified: true, teacherApproved: true,
    });
    expect(issued.ok).toBe(true);

    const ob = mod.serializeOpenBadges({ credential: { id: issued.credential.id, name: 'X', recipient: 's@x.com', vcDigest: issued.credential.vcDigest, evidenceHash: issued.credential.evidenceHash, issuedAt: issued.credential.issuedAt, status: 'active' } });
    expect(ob.ok).toBe(true);
    expect(JSON.stringify(ob.assertion)).not.toContain('RAW_SECRET_ANSWER');
    expect(JSON.stringify(ob.assertion)).not.toContain('secret prompt');

    const vc = mod.serializeVc({ credential: { id: issued.credential.id, name: 'X', recipient: 's@x.com', vcDigest: issued.credential.vcDigest, evidenceHash: issued.credential.evidenceHash, issuedAt: issued.credential.issuedAt, competencyIds: [1, 2], status: 'active' } });
    expect(vc.ok).toBe(true);
    expect(JSON.stringify(vc.vc)).not.toContain('RAW_SECRET_ANSWER');
  });

  it('security — AI role cannot issue even with ratified evidence', async () => {
    const def = await mod.createCredentialDefinition({ name: 'X', version: 'v1', criteria, issuerAuthority: 'admin' });
    await mod.publishCredentialDefinition({ definitionId: def.definitionId, actorId: 'admin' });
    const r = await mod.issueCredential({
      definitionId: def.definitionId, userId: 7, recipient: 's@x.com', evidence, criteria,
      issuedBy: 'claude', issuedByRole: 'ai', evidenceRatified: true, teacherApproved: true,
    });
    expect(r.ok).toBe(false);
    expect(tables.credentials || []).toHaveLength(0);
  });

  it('verifier — unknown digest not verifiable', async () => {
    const r = await mod.verifyCredential({ vcDigest: 'nope' });
    expect(r.verifiable).toBe(false);
  });

  it('portfolio public view — only public items, no raw content_meta', async () => {
    await mod.ensurePortfolio({ userId: 7 });
    const a = await mod.addPortfolioItem({ userId: 7, kind: 'draft', title: 'Yashirin qoralama', contentMeta: { aiUseLevel: 'A3' } });
    await mod.addPortfolioItem({ userId: 7, kind: 'reflection', title: 'Ochiq fikr' });
    await mod.setItemVisibility({ userId: 7, itemId: a.itemId, visibility: 'private' });
    // second item stays private too — only explicit public shows
    const pub = await mod.getPublicPortfolio({ userId: 7 });
    expect(pub.items).toHaveLength(0);
    // make one public
    const second = (await mod.listPortfolio({ userId: 7 })).items[0];
    await mod.setItemVisibility({ userId: 7, itemId: second.id, visibility: 'public' });
    const pub2 = await mod.getPublicPortfolio({ userId: 7 });
    expect(pub2.items.some((i) => i.id === second.id)).toBe(true);
    expect(JSON.stringify(pub2.items)).not.toContain('content_meta');
  });
});
