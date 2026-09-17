/**
 * Deborah — Canva Button/Connect Adapter (integration tests, Prompt 59)
 *
 * Service qatlami: PKCE link flow (state CSRF → token vault encrypted),
 * Button callback → design mapping + connection upsert, create/import/
 * export flows with mocked Canva API client, unlink + revoke.
 * Tokenlar vault'da plaintext emas — encryptToken orqali saqlanadi (§22.9).
 *
 * 09/2026 (BUG-CANVA-01): vault PostgreSQL'dan Firebase'ga ko'chdi —
 * testlar endi oauth-vault modulini in-memory store bilan mock qiladi
 * (haqiqiy vaultPath kalit logikasi saqlanadi).
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// ── In-memory fake OAuth vault (real vaultPath kalit logikasi bilan) ──
function makeFakeVault(seed = {}) {
  const store = { ...seed }; // vaultPath -> connection
  const factory = async (importOriginal) => {
    const actual = await importOriginal();
    return {
      ...actual,
      loadConnection: async (provider, actorId) => store[actual.vaultPath(provider, actorId)] ?? null,
      saveConnection: async (provider, actorId, data) => {
        const payload = { ...(data || {}), updated_at: 'test-now' };
        store[actual.vaultPath(provider, actorId)] = payload;
        return payload;
      },
      patchConnection: async (provider, actorId, patch) => {
        const p = actual.vaultPath(provider, actorId);
        store[p] = { ...(store[p] || {}), ...(patch || {}), updated_at: 'test-now' };
        return store[p];
      },
      deleteConnection: async (provider, actorId) => {
        delete store[actual.vaultPath(provider, actorId)];
        return true;
      },
    };
  };
  return { store, factory };
}

function mockAudit() {
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
}

describe('canva — link flow (Prompt 59 §9.8/§15)', () => {
  let mod;
  let store;
  let exchangeMock;

  beforeEach(async () => {
    vi.resetModules();
    process.env.CANVA_CLIENT_ID = 'cid';
    process.env.CANVA_CLIENT_SECRET = 'csec';
    process.env.CANVA_REDIRECT_URI = 'http://x/cb';
    process.env.ENCRYPTION_KEY = 'test-encryption-key-for-vault-123456';

    const fake = makeFakeVault({});
    store = fake.store;
    exchangeMock = vi.fn(async () => ({ ok: true, accessToken: 'at_secret', refreshToken: 'rt_secret', expiresIn: 3600 }));

    vi.doMock('../../src/modules/integrations/oauth-vault.js', fake.factory);
    mockAudit();
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
    expect(r.url).toMatch(/canva\.com\/api\/oauth\/authorize\?/);
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
    const row = store['integrations/canva/connections/7'];
    expect(row).toBeTruthy();
    expect(row.access_token_enc).toMatch(/^v1:/);
    expect(row.access_token_enc).not.toContain('at_secret');
    // Round-trip decrypt check
    expect(mod.decryptToken(row.access_token_enc)).toBe('at_secret');
    // Session temp qiymatlar tozalangan
    expect(session.canvaOAuthState).toBeUndefined();
    expect(session.canvaVerifier).toBeUndefined();
  });

  it('unlinkCanvaAccount — revokes + deletes vault row', async () => {
    const fake = makeFakeVault({
      'integrations/canva/connections/7': {
        user_id: 7, access_token_enc: 'v1:seed-at', refresh_token_enc: 'v1:seed-rt', status: 'active',
      },
    });
    // Re-import with the seeded fake vault
    vi.resetModules();
    vi.doMock('../../src/modules/integrations/oauth-vault.js', fake.factory);
    mockAudit();
    vi.doMock('../../src/modules/canva/canva.client.js', async (importOriginal) => {
      const actual = await importOriginal();
      return { ...actual, canvaRevoke: vi.fn(async () => ({ ok: true })) };
    });
    const m = await import('../../src/modules/canva/index.js');
    const r = await m.unlinkCanvaAccount({ actorId: 7 });
    expect(r.ok).toBe(true);
    expect(fake.store['integrations/canva/connections/7']).toBeUndefined();
  });

  it('unlinkCanvaAccount — no connection → linked:false (idempotent)', async () => {
    const r = await mod.unlinkCanvaAccount({ actorId: 999 });
    expect(r.ok).toBe(true);
    expect(r.linked).toBe(false);
  });
});

describe('canva — Button callback + design flows (Prompt 59 §59-07/08)', () => {
  let mod;
  let store;

  beforeEach(async () => {
    vi.resetModules();
    process.env.CANVA_CLIENT_ID = 'cid';
    process.env.CANVA_CLIENT_SECRET = 'csec';
    process.env.CANVA_REDIRECT_URI = 'http://x/cb';
    process.env.ENCRYPTION_KEY = 'test-encryption-key-for-vault-123456';
    const fake = makeFakeVault({
      'integrations/canva/connections/7': {
        user_id: 7, access_token_enc: null, refresh_token_enc: null, status: 'active',
      },
    });
    store = fake.store;
    vi.doMock('../../src/modules/integrations/oauth-vault.js', fake.factory);
    mockAudit();
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
    const row = store['integrations/canva/connections/7'];
    expect(row.design_id).toBe('DAbc123');
    expect(row.last_callback.type).toBe('onDesignPublish');
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
    store['integrations/canva/connections/7'].access_token_enc = mod.encryptToken('at');
    const r = await mod.createCanvaDesign({ title: 'Deck', actorId: 7 });
    expect(r.ok).toBe(true);
    expect(r.designId).toBe('D_new');
    expect(store['integrations/canva/connections/7'].design_id).toBe('D_new');
  });

  it('importDeckToCanva — rejects unsupported file type', async () => {
    const r = await mod.importDeckToCanva({ designId: 'D1', fileType: 'exe', actorId: 7 });
    expect(r.ok).toBe(false);
  });
});
