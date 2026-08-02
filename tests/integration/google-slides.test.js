/**
 * Edikit — Google Slides Adapter (integration tests, Prompt 59)
 *
 * Service qatlami: PKCE link flow (drive.file scope only, full Drive
 * REJECT — §15), token vault encrypted, createFromCanonical (create →
 * batchUpdate atomik), export, unlink + revoke.
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
    async execute() {
      const rows = (tables[table] || []).filter((r) => matches(r, state.wheres));
      if (state.cols === null) return rows.map((r) => ({ ...r }));
      if (state.cols) {
        const cols = Array.isArray(state.cols) ? state.cols : [state.cols];
        return rows.map((r) => {
          const o = {};
          for (const c of cols) o[c] = r[c];
          return o;
        });
      }
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
        onConflict: (ocFn) => {
          let conflictCols = null;
          const columns = (cols) => {
            conflictCols = cols;
            return {
              doUpdateSet: (updater) => ({
                async execute() {
                  const existing = (tables[table] || []).find((r) =>
                    (conflictCols || []).every((c) => r[c] === row[c])
                  );
                  if (existing) {
                    const patch = typeof updater === 'function' ? updater(() => ({ __op: '+', __col: '', __val: 0 })) : updater;
                    for (const [k, v] of Object.entries(patch)) existing[k] = v;
                  } else {
                    const id = nextId++;
                    (tables[table] = tables[table] || []).push({ id, ...row });
                  }
                },
              }),
            };
          };
          return ocFn({ columns });
        },
      }),
    }),
    updateTable: (table) => ({
      set: (patch) => {
        let wheres = [];
        const chain = {
          where: (col, op, val) => {
            wheres = [...wheres, [col, op, val]];
            return chain;
          },
          async execute() {
            for (const r of tables[table] || []) {
              if (matches(r, wheres)) Object.assign(r, patch);
            }
          },
        };
        return chain;
      },
    }),
    deleteFrom: (table) => {
      let wheres = [];
      const chain = {
        where: (col, op, val) => {
          wheres = [...wheres, [col, op, val]];
          return chain;
        },
        async execute() {
          tables[table] = (tables[table] || []).filter((r) => !matches(r, wheres));
        },
      };
      return chain;
    },
  };
  return { db, tables };
}

const canonicalDoc = {
  title: 'Fotosintez',
  slides: [
    {
      id: 's1',
      title: 'Kirish',
      blocks: [
        { type: 'heading', content: { heading: 'Fotosintez' } },
        { type: 'bullets', content: { items: ['Xlorofill', 'Quyosh nuri'] } },
      ],
    },
    { id: 's2', title: 'Xulosa', blocks: [{ type: 'text', content: { text: 'Short' } }] },
  ],
};

describe('google-slides — link flow (Prompt 59 §9.9/§15)', () => {
  let mod;
  let tables;
  let exchangeMock;

  beforeEach(async () => {
    vi.resetModules();
    process.env.GOOGLE_CLIENT_ID = 'gid';
    process.env.GOOGLE_CLIENT_SECRET = 'gsec';
    process.env.GOOGLE_REDIRECT_URI = 'http://x/cb';
    process.env.ENCRYPTION_KEY = 'test-encryption-key-for-vault-123456';
    process.env.SESSION_SECRET = 'test-session-secret-123456';

    const fake = makeFakeDb({});
    tables = fake.tables;
    exchangeMock = vi.fn(async () => ({ ok: true, accessToken: 'gt_secret', refreshToken: 'grt', expiresIn: 3600, scope: 'https://www.googleapis.com/auth/drive.file' }));

    vi.doMock('../../src/infrastructure/postgres.js', () => ({ getDb: () => fake.db }));
    vi.doMock('../../src/modules/auth/tenant-context.js', () => ({ getCurrentTenant: () => ({ id: 1 }) }));
    vi.doMock('../../src/modules/auth/audit.js', () => ({
      audit: vi.fn(async () => true),
      AUDIT_ACTIONS: { GOOGLE_LINK: 'google:link', GOOGLE_CREATE: 'google:create', GOOGLE_EXPORT: 'google:export' },
    }));
    vi.doMock('../../src/modules/google-slides/google-slides.client.js', async (importOriginal) => {
      const actual = await importOriginal();
      return {
        ...actual,
        googleExchangeCode: exchangeMock,
        googleRevoke: vi.fn(async () => ({ ok: true })),
        googleCreatePresentation: vi.fn(async () => ({ ok: true, presentationId: 'P1', presentationUrl: 'https://docs.google.com/presentation/d/P1' })),
        googleBatchUpdate: vi.fn(async () => ({ ok: true, replies: [] })),
        googleExportPresentation: vi.fn(async () => ({ ok: true, buffer: Buffer.from('pdf'), size: 3, mimeType: 'application/pdf' })),
      };
    });
    mod = await import('../../src/modules/google-slides/index.js');
  });

  it('startGoogleLink — authorize URL uses drive.file scope only', async () => {
    const session = {};
    const r = await mod.startGoogleLink({ session });
    expect(r.ok).toBe(true);
    expect(r.url).toMatch(/accounts\.google\.com/);
    expect(r.url).toMatch(/drive\.file/);
    expect(r.url).not.toContain('auth/drive');
    expect(session.googleSlidesState).toBeTruthy();
  });

  it('completeGoogleLink — rejects mismatched state (CSRF)', async () => {
    const session = { googleSlidesState: 'expected', googleSlidesVerifier: 'v1' };
    const r = await mod.completeGoogleLink({ session, code: 'c', state: 'wrong' });
    expect(r.ok).toBe(false);
    expect(exchangeMock).not.toHaveBeenCalled();
  });

  it('completeGoogleLink — stores ENCRYPTED token with drive.file scope', async () => {
    const session = { googleSlidesState: 'state-1', googleSlidesVerifier: 'verifier-1' };
    const r = await mod.completeGoogleLink({ session, code: 'c', state: 'state-1', actorId: 7 });
    expect(r.ok).toBe(true);
    const row = tables.google_connections.find((c) => c.user_id === 7);
    expect(row).toBeTruthy();
    expect(row.access_token_enc).toMatch(/^v1:/);
    expect(row.scope).toContain('drive.file');
    expect(mod.decryptToken(row.access_token_enc)).toBe('gt_secret');
  });

  it('completeGoogleLink — REJECTS full Drive scope response (§15)', async () => {
    exchangeMock.mockResolvedValueOnce({ ok: true, accessToken: 'x', refreshToken: 'y', expiresIn: 3600, scope: 'https://www.googleapis.com/auth/drive' });
    const session = { googleSlidesState: 'state-1', googleSlidesVerifier: 'verifier-1' };
    const r = await mod.completeGoogleLink({ session, code: 'c', state: 'state-1', actorId: 7 });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/forbidden/i);
    expect(tables.google_connections || []).toHaveLength(0);
  });
});

describe('google-slides — create from canonical (§59-12)', () => {
  let mod;
  let tables;
  let batchUpdateMock;

  beforeEach(async () => {
    vi.resetModules();
    process.env.ENCRYPTION_KEY = 'test-encryption-key-for-vault-123456';
    process.env.SESSION_SECRET = 'test-session-secret-123456';
    const fake = makeFakeDb({
      google_connections: [{ id: 1, tenant_id: 1, user_id: 7, access_token_enc: null, refresh_token_enc: null, scope: 'https://www.googleapis.com/auth/drive.file', status: 'active' }],
    });
    tables = fake.tables;
    batchUpdateMock = vi.fn(async () => ({ ok: true, replies: [] }));
    vi.doMock('../../src/infrastructure/postgres.js', () => ({ getDb: () => fake.db }));
    vi.doMock('../../src/modules/auth/tenant-context.js', () => ({ getCurrentTenant: () => ({ id: 1 }) }));
    vi.doMock('../../src/modules/auth/audit.js', () => ({
      audit: vi.fn(async () => true),
      AUDIT_ACTIONS: { GOOGLE_LINK: 'google:link', GOOGLE_CREATE: 'google:create', GOOGLE_EXPORT: 'google:export' },
    }));
    vi.doMock('../../src/modules/google-slides/google-slides.client.js', async (importOriginal) => {
      const actual = await importOriginal();
      return {
        ...actual,
        googleCreatePresentation: vi.fn(async () => ({ ok: true, presentationId: 'P1', presentationUrl: 'https://docs.google.com/presentation/d/P1' })),
        googleBatchUpdate: batchUpdateMock,
        googleExportPresentation: vi.fn(async () => ({ ok: true, buffer: Buffer.from('pdf'), size: 3, mimeType: 'application/pdf' })),
      };
    });
    mod = await import('../../src/modules/google-slides/index.js');
  });

  it('createFromCanonical — requires canonical document with slides', async () => {
    const r = await mod.createFromCanonical({ title: 'X', document: {} });
    expect(r.ok).toBe(false);
  });

  it('createFromCanonical — requires linked connection', async () => {
    const r = await mod.createFromCanonical({ title: 'X', document: canonicalDoc, actorId: 999 });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/google not linked/i);
  });

  it('createFromCanonical — creates presentation + batchUpdate (atomik) and persists', async () => {
    tables.google_connections[0].access_token_enc = mod.encryptToken('gt');
    const r = await mod.createFromCanonical({ title: 'Fotosintez', document: canonicalDoc, actorId: 7 });
    expect(r.ok).toBe(true);
    expect(r.presentationId).toBe('P1');
    expect(r.slides).toBe(2);
    // batchUpdate receives atomic request list
    const [buArgs] = batchUpdateMock.mock.calls[0];
    expect(buArgs.requests.length).toBeGreaterThan(2);
    expect(tables.google_connections[0].presentation_id).toBe('P1');
  });

  it('exportGooglePresentation — returns buffer for pdf', async () => {
    tables.google_connections[0].access_token_enc = mod.encryptToken('gt');
    const r = await mod.exportGooglePresentation({ presentationId: 'P1', format: 'pdf', actorId: 7 });
    expect(r.ok).toBe(true);
    expect(r.mimeType).toBe('application/pdf');
  });

  it('exportGooglePresentation — rejects bad format', async () => {
    const r = await mod.exportGooglePresentation({ presentationId: 'P1', format: 'exe', actorId: 7 });
    expect(r.ok).toBe(false);
  });
});
