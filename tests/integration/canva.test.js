/**
 * Deborah — Canva Button/Connect Adapter (integration tests, Prompt 59)
 *
 * Service qatlami: PKCE link flow (state CSRF → token vault encrypted),
 * Button callback → design mapping + connection upsert, create/import/
 * export flows with mocked Canva API client, unlink + revoke.
 * Tokenlar DB'da plaintext emas — encryptToken orqali saqlanadi (§22.9).
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

describe('canva — link flow (Prompt 59 §9.8/§15)', () => {
  let mod;
  let tables;
  let exchangeMock;

  beforeEach(async () => {
    vi.resetModules();
    process.env.CANVA_CLIENT_ID = 'cid';
    process.env.CANVA_CLIENT_SECRET = 'csec';
    process.env.CANVA_REDIRECT_URI = 'http://x/cb';
    process.env.ENCRYPTION_KEY = 'test-encryption-key-for-vault-123456';

    const fake = makeFakeDb({});
    tables = fake.tables;
    exchangeMock = vi.fn(async () => ({ ok: true, accessToken: 'at_secret', refreshToken: 'rt_secret', expiresIn: 3600 }));

    vi.doMock('../../src/infrastructure/postgres.js', () => ({ getDb: () => fake.db }));
    vi.doMock('../../src/modules/auth/tenant-context.js', () => ({ getCurrentTenant: () => ({ id: 1 }) }));
    vi.doMock('../../src/modules/auth/audit.js', () => ({
      audit: vi.fn(async () => true),
      AUDIT_ACTIONS: {
        CANVA_LINK: 'canva:link',
        CANVA_CALLBACK: 'canva:callback',
        CANVA_CREATE: 'canva:create',
        CANVA_IMPORT: 'canva:import',
        CANVA_EXPORT: 'canva:export',
      },
    }));
    vi.doMock('../../src/modules/canva/canva.client.js', async (importOriginal) => {
      const actual = await importOriginal();
      return {
        ...actual,
        canvaExchangeCode: exchangeMock,
        canvaRevoke: vi.fn(async () => ({ ok: true })),
        canvaCreateDesign: vi.fn(async () => ({ ok: true, designId: 'D_new', designUrl: 'https://www.canva.com/design/D_new/edit' })),
        canvaImportDesign: vi.fn(async () => ({ ok: true, raw: {} })),
        canvaExportDesign: vi.fn(async () => ({ ok: true, raw: {} })),
      };
    });
    mod = await import('../../src/modules/canva/index.js');
  });

  it('startCanvaLink — returns authorize URL with PKCE + state in session', async () => {
    const session = {};
    const r = await mod.startCanvaLink({ session });
    expect(r.ok).toBe(true);
    expect(r.url).toMatch(/canva\.com\/api\/oauth2\/authorize/);
    expect(r.url).toMatch(/code_challenge=.*S256/);
    expect(session.canvaOAuthState).toBeTruthy();
    expect(session.canvaVerifier).toBeTruthy();
  });

  it('completeCanvaLink — rejects mismatched state (CSRF)', async () => {
    const session = { canvaOAuthState: 'expected-state', canvaVerifier: 'v1' };
    const r = await mod.completeCanvaLink({ session, code: 'code1', state: 'wrong-state' });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/CSRF/i);
    expect(exchangeMock).not.toHaveBeenCalled();
  });

  it('completeCanvaLink — stores ENCRYPTED token in vault (no plaintext)', async () => {
    const session = { canvaOAuthState: 'state-1', canvaVerifier: 'verifier-1' };
    const r = await mod.completeCanvaLink({ session, code: 'code1', state: 'state-1', actorId: 7 });
    expect(r.ok).toBe(true);
    expect(r.linked).toBe(true);
    const row = tables.canva_connections.find((c) => c.user_id === 7);
    expect(row).toBeTruthy();
    expect(row.access_token_enc).toMatch(/^v1:/);
    expect(row.access_token_enc).not.toContain('at_secret');
    // Round-trip decrypt check
    expect(mod.decryptToken(row.access_token_enc)).toBe('at_secret');
  });

  it('unlinkCanvaAccount — revokes + deletes vault row', async () => {
    const fake = makeFakeDb({
      canva_connections: [{ id: 1, tenant_id: 1, user_id: 7, access_token_enc: mod.encryptToken('at'), refresh_token_enc: mod.encryptToken('rt'), status: 'active' }],
    });
    // Re-import with the seeded fake DB
    vi.resetModules();
    vi.doMock('../../src/infrastructure/postgres.js', () => ({ getDb: () => fake.db }));
    vi.doMock('../../src/modules/auth/tenant-context.js', () => ({ getCurrentTenant: () => ({ id: 1 }) }));
    vi.doMock('../../src/modules/auth/audit.js', () => ({
      audit: vi.fn(async () => true),
      AUDIT_ACTIONS: { CANVA_LINK: 'canva:link', CANVA_CALLBACK: 'canva:callback', CANVA_CREATE: 'canva:create', CANVA_IMPORT: 'canva:import', CANVA_EXPORT: 'canva:export' },
    }));
    vi.doMock('../../src/modules/canva/canva.client.js', async (importOriginal) => {
      const actual = await importOriginal();
      return { ...actual, canvaRevoke: vi.fn(async () => ({ ok: true })) };
    });
    const m = await import('../../src/modules/canva/index.js');
    const r = await m.unlinkCanvaAccount({ actorId: 7 });
    expect(r.ok).toBe(true);
    expect(fake.tables.canva_connections).toHaveLength(0);
  });
});

describe('canva — Button callback + design flows (Prompt 59 §59-07/08)', () => {
  let mod;
  let tables;

  beforeEach(async () => {
    vi.resetModules();
    process.env.CANVA_CLIENT_ID = 'cid';
    process.env.CANVA_CLIENT_SECRET = 'csec';
    process.env.CANVA_REDIRECT_URI = 'http://x/cb';
    process.env.ENCRYPTION_KEY = 'test-encryption-key-for-vault-123456';
    const fake = makeFakeDb({
      canva_connections: [{ id: 1, tenant_id: 1, user_id: 7, access_token_enc: null, refresh_token_enc: null, status: 'active' }],
    });
    tables = fake.tables;
    vi.doMock('../../src/infrastructure/postgres.js', () => ({ getDb: () => fake.db }));
    vi.doMock('../../src/modules/auth/tenant-context.js', () => ({ getCurrentTenant: () => ({ id: 1 }) }));
    vi.doMock('../../src/modules/auth/audit.js', () => ({
      audit: vi.fn(async () => true),
      AUDIT_ACTIONS: { CANVA_LINK: 'canva:link', CANVA_CALLBACK: 'canva:callback', CANVA_CREATE: 'canva:create', CANVA_IMPORT: 'canva:import', CANVA_EXPORT: 'canva:export' },
    }));
    vi.doMock('../../src/modules/canva/canva.client.js', async (importOriginal) => {
      const actual = await importOriginal();
      return {
        ...actual,
        canvaCreateDesign: vi.fn(async () => ({ ok: true, designId: 'D_new', designUrl: 'https://www.canva.com/design/D_new/edit' })),
        canvaImportDesign: vi.fn(async () => ({ ok: true, raw: {} })),
        canvaExportDesign: vi.fn(async () => ({ ok: true, raw: {} })),
      };
    });
    mod = await import('../../src/modules/canva/index.js');
  });

  it('handleButtonCallback — maps onDesignPublish to connection', async () => {
    const r = await mod.handleButtonCallback({
      payload: { type: 'onDesignPublish', designId: 'DAbc123', designUrl: 'https://www.canva.com/design/DAbc123/edit' },
      actorId: 7,
    });
    expect(r.ok).toBe(true);
    expect(r.designId).toBe('DAbc123');
    const row = tables.canva_connections.find((c) => c.user_id === 7);
    expect(row.design_id).toBe('DAbc123');
    expect(JSON.parse(row.last_callback).type).toBe('onDesignPublish');
  });

  it('handleButtonCallback — rejects unknown callback type', async () => {
    const r = await mod.handleButtonCallback({ payload: { type: 'bogus', designId: 'D1' }, actorId: 7 });
    expect(r.ok).toBe(false);
  });

  it('createCanvaDesign — requires linked connection with token', async () => {
    const r = await mod.createCanvaDesign({ title: 'Deck', actorId: 7 });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/token unavailable/i);
  });

  it('createCanvaDesign — creates design when token available', async () => {
    tables.canva_connections[0].access_token_enc = mod.encryptToken('at');
    const r = await mod.createCanvaDesign({ title: 'Deck', actorId: 7 });
    expect(r.ok).toBe(true);
    expect(r.designId).toBe('D_new');
    expect(tables.canva_connections[0].design_id).toBe('D_new');
  });

  it('importDeckToCanva — rejects unsupported file type', async () => {
    const r = await mod.importDeckToCanva({ designId: 'D1', fileType: 'exe', actorId: 7 });
    expect(r.ok).toBe(false);
  });
});
