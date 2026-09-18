/**
 * Deborah — Google Slides Adapter (integration tests, Prompt 59)
 *
 * Service qatlami: PKCE link flow (drive.file scope only, full Drive
 * REJECT — §15), token vault encrypted, createFromCanonical (create →
 * batchUpdate atomik), export, unlink + revoke.
 *
 * 09/2026 (BUG-CANVA-01): vault PostgreSQL'dan Firebase'ga ko'chdi —
 * testlar endi oauth-vault modulini in-memory store bilan mock qiladi
 * (haqiqiy vaultPath kalit logikasi saqlanadi).
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// ── In-memory fake OAuth vault (real vaultPath kalit logikasi bilan) ──
function makeFakeVault(seed = {}) {
  const store = { ...seed }; // vaultPath -> connection
  const pending = {}; // `${provider}:${state}` -> { verifier, actorId, expiresAt }
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
      savePendingOAuth: async (provider, { state = '', verifier = '', actorId = 'admin' } = {}) => {
        if (!state || !verifier) return { ok: false };
        pending[`${provider}:${state}`] = { verifier, actorId, expiresAt: Date.now() + 600000 };
        return { ok: true };
      },
      consumePendingOAuth: async (provider, state) => {
        const k = `${provider}:${state}`;
        const v = pending[k];
        delete pending[k];
        if (!v) return { ok: false };
        if (Date.now() > v.expiresAt) return { ok: false, expired: true };
        return { ok: true, verifier: v.verifier, actorId: v.actorId };
      },
    };
  };
  return { store, pending, factory };
}

function mockAudit() {
  vi.doMock('../../src/modules/auth/audit.js', () => ({
    audit: vi.fn(async () => true),
    AUDIT_ACTIONS: { GOOGLE_LINK: 'google:link', GOOGLE_CREATE: 'google:create', GOOGLE_EXPORT: 'google:export' },
  }));
}

const GP = 'integrations/google-slides/connections/7';

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
  let store;
  let exchangeMock;

  beforeEach(async () => {
    vi.resetModules();
    process.env.GOOGLE_CLIENT_ID = 'gid';
    process.env.GOOGLE_CLIENT_SECRET = 'gsec';
    process.env.GOOGLE_REDIRECT_URI = 'http://x/cb';
    process.env.ENCRYPTION_KEY = 'test-encryption-key-for-vault-123456';
    process.env.SESSION_SECRET = 'test-session-secret-123456';

    const fake = makeFakeVault({});
    store = fake.store;
    exchangeMock = vi.fn(async () => ({ ok: true, accessToken: 'gt_secret', refreshToken: 'grt', expiresIn: 3600, scope: 'https://www.googleapis.com/auth/drive.file' }));

    vi.doMock('../../src/modules/integrations/oauth-vault.js', fake.factory);
    mockAudit();
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
    const row = store[GP];
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
    expect(store[GP]).toBeUndefined();
  });

  it('unlinkGoogleAccount — revokes + deletes vault entry', async () => {
    store[GP] = { user_id: 7, access_token_enc: mod.encryptToken('gt'), refresh_token_enc: mod.encryptToken('grt'), status: 'active' };
    const r = await mod.unlinkGoogleAccount({ actorId: 7 });
    expect(r.ok).toBe(true);
    expect(r.linked).toBe(false);
    expect(store[GP]).toBeUndefined();
  });

  it('pending: sessiyasiz complete linked (BUG-CANVA-02)', async () => {
    const r0 = await mod.startGoogleLink({ session: null, actorId: 'boss' });
    expect(r0.ok).toBe(true);
    const state = new URL(r0.url).searchParams.get('state');
    expect(state).toMatch(/^g_[0-9a-f]{48}$/);
    const r = await mod.completeGoogleLink({ session: {}, code: 'c', state });
    expect(r.ok).toBe(true);
    expect(r.linked).toBe(true);
  });
});

describe('google-slides — create from canonical (§59-12)', () => {
  let mod;
  let store;
  let batchUpdateMock;

  beforeEach(async () => {
    vi.resetModules();
    process.env.ENCRYPTION_KEY = 'test-encryption-key-for-vault-123456';
    process.env.SESSION_SECRET = 'test-session-secret-123456';
    const fake = makeFakeVault({
      [GP]: { user_id: 7, access_token_enc: null, refresh_token_enc: null, scope: 'https://www.googleapis.com/auth/drive.file', status: 'active' },
    });
    store = fake.store;
    batchUpdateMock = vi.fn(async () => ({ ok: true, replies: [] }));
    vi.doMock('../../src/modules/integrations/oauth-vault.js', fake.factory);
    mockAudit();
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
    store[GP].access_token_enc = mod.encryptToken('gt');
    const r = await mod.createFromCanonical({ title: 'Fotosintez', document: canonicalDoc, actorId: 7 });
    expect(r.ok).toBe(true);
    expect(r.presentationId).toBe('P1');
    expect(r.slides).toBe(2);
    // batchUpdate receives atomic request list
    const [buArgs] = batchUpdateMock.mock.calls[0];
    expect(buArgs.requests.length).toBeGreaterThan(2);
    expect(store[GP].presentation_id).toBe('P1');
  });

  it('exportGooglePresentation — returns buffer for pdf', async () => {
    store[GP].access_token_enc = mod.encryptToken('gt');
    const r = await mod.exportGooglePresentation({ presentationId: 'P1', format: 'pdf', actorId: 7 });
    expect(r.ok).toBe(true);
    expect(r.mimeType).toBe('application/pdf');
  });

  it('exportGooglePresentation — rejects bad format', async () => {
    const r = await mod.exportGooglePresentation({ presentationId: 'P1', format: 'exe', actorId: 7 });
    expect(r.ok).toBe(false);
  });
});
