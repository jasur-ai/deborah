/**
 * Edikit — WebAuthn (Passkey) Service Unit Tests
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Shared store (resettable from beforeEach) ──
const testStore = {};

vi.mock('../../firebase/admin.js', () => {
  function navigate(store, path) {
    const parts = path.split('/').filter(Boolean);
    let current = store;
    for (let i = 0; i < parts.length; i++) {
      if (current === null || typeof current !== 'object' || !(parts[i] in current)) {
        return { found: false, parent: current, key: parts[i] };
      }
      if (i === parts.length - 1) return { found: true, value: current[parts[i]], parent: current, key: parts[i] };
      current = current[parts[i]];
    }
    return { found: true, value: current, parent: null, key: null };
  }

  return {
    fb: {
      get: vi.fn(async (path) => {
        const r = navigate(testStore, path);
        return { exists: () => r.found, val: () => (r.found ? JSON.parse(JSON.stringify(r.value)) : null) };
      }),
      set: vi.fn(async (path, value) => {
        const parts = path.split('/').filter(Boolean);
        let cur = testStore;
        for (let i = 0; i < parts.length - 1; i++) {
          if (!(parts[i] in cur) || typeof cur[parts[i]] !== 'object') cur[parts[i]] = {};
          cur = cur[parts[i]];
        }
        cur[parts[parts.length - 1]] = JSON.parse(JSON.stringify(value));
      }),
      update: vi.fn(async (path, value) => {
        const parts = path.split('/').filter(Boolean);
        let cur = testStore;
        for (let i = 0; i < parts.length - 1; i++) {
          if (!(parts[i] in cur) || typeof cur[parts[i]] !== 'object') cur[parts[i]] = {};
          cur = cur[parts[i]];
        }
        cur[parts[parts.length - 1]] = { ...(cur[parts[parts.length - 1]] || {}), ...JSON.parse(JSON.stringify(value)) };
      }),
      remove: vi.fn(async (path) => {
        const r = navigate(testStore, path);
        if (r.found && r.parent) delete r.parent[r.key];
        else if (r.found) Object.keys(testStore).forEach(k => delete testStore[k]);
      }),
    },
    default: {},
  };
});

vi.mock('../../src/modules/auth/audit.js', () => ({
  audit: vi.fn(async () => true),
  AUDIT_ACTIONS: {
    PASSKEY_REGISTER: 'passkey:register',
    PASSKEY_REMOVE: 'passkey:remove',
  },
}));

describe('WebAuthn / Passkey Service', () => {
  let webauthn;

  beforeEach(async () => {
    vi.clearAllMocks();
    Object.keys(testStore).forEach(k => delete testStore[k]);
    webauthn = await import('../../src/modules/auth/webauthn.js');
    webauthn.setRpConfig({ name: 'Edikit Test', id: 'localhost', origin: 'http://localhost:3000' });
  });

  describe('RP Configuration', () => {
    it('should return current RP config', () => {
      const config = webauthn.getRpConfig();
      expect(config).toHaveProperty('name', 'Edikit Test');
    });
    it('should allow updating RP config', () => {
      webauthn.setRpConfig({ name: 'Updated', id: 'test.local' });
      expect(webauthn.getRpConfig().name).toBe('Updated');
    });
  });

  describe('Registration Challenge', () => {
    it('should generate a valid registration challenge', async () => {
      const session = { user: { safeKey: 'test_user', username: 'testuser', displayName: 'Test User' } };
      const options = await webauthn.generateRegistrationChallenge(session);
      expect(options).not.toBeNull();
      expect(options.publicKey.rp.name).toBe('Edikit Test');
      expect(options.publicKey).toHaveProperty('challenge');
      expect(options.publicKey.pubKeyCredParams.length).toBeGreaterThanOrEqual(2);
    });

    it('should store challenge in session', async () => {
      const session = { user: { safeKey: 'test_user', username: 'testuser' } };
      await webauthn.generateRegistrationChallenge(session);
      expect(session.webauthnChallenge.type).toBe('registration');
      expect(session.webauthnChallenge.userId).toBe('test_user');
    });

    it('should return null for missing userId', async () => {
      expect(await webauthn.generateRegistrationChallenge({})).toBeNull();
    });
  });

  describe('Registration Response Verification', () => {
    it('should reject when no active challenge', async () => {
      const result = await webauthn.verifyRegistrationResponse({}, { id: 'cred1' });
      expect(result.ok).toBe(false);
    });

    it('should reject expired challenge', async () => {
      const session = { webauthnChallenge: { challenge: 'abc', type: 'registration', userId: 'u', createdAt: Date.now() - 6 * 60 * 1000 } };
      const result = await webauthn.verifyRegistrationResponse(session, { id: 'c1' });
      expect(result.ok).toBe(false);
    });

    it('should accept valid registration response', async () => {
      const session = { webauthnChallenge: { challenge: 'abc', type: 'registration', userId: 'test_user', createdAt: Date.now() } };
      const result = await webauthn.verifyRegistrationResponse(session, {
        id: 'cred_id_1', rawId: 'cred_id_1',
        response: { clientDataJSON: Buffer.from(JSON.stringify({ origin: 'http://localhost:3000' })).toString('base64'), publicKey: 'pk1', deviceName: 'Device 1' },
      });
      expect(result.ok).toBe(true);
      expect(result.credentialRecord.counter).toBe(1);
      expect(session.webauthnChallenge).toBeUndefined();
    });

    it('should store credential and list it', async () => {
      const session = { webauthnChallenge: { challenge: 'd', type: 'registration', userId: 'user2', createdAt: Date.now() } };
      await webauthn.verifyRegistrationResponse(session, {
        id: 'cred_2', rawId: 'cred_2',
        response: { clientDataJSON: Buffer.from(JSON.stringify({ origin: 'http://localhost:3000' })).toString('base64'), deviceName: 'Touch ID' },
      });
      const list = await webauthn.listPasskeys('user2');
      expect(list.length).toBe(1);
      expect(list[0].deviceName).toBe('Touch ID');
    });
  });

  describe('Authentication Flow', () => {
    it('should return null for user with no passkeys', async () => {
      expect(await webauthn.generateAuthenticationChallenge({}, 'nobody')).toBeNull();
    });

    it('should generate auth challenge for user with passkeys', async () => {
      const rs = { webauthnChallenge: { challenge: 'r', type: 'registration', userId: 'auth_u', createdAt: Date.now() } };
      await webauthn.verifyRegistrationResponse(rs, {
        id: 'auth_c', rawId: 'auth_c',
        response: { clientDataJSON: Buffer.from(JSON.stringify({ origin: 'http://localhost:3000' })).toString('base64') },
      });
      const as = {};
      const opts = await webauthn.generateAuthenticationChallenge(as, 'auth_u');
      expect(opts.publicKey.allowCredentials.length).toBe(1);
      expect(opts.publicKey.allowCredentials[0].id).toBe('auth_c');
      expect(as.webauthnChallenge.type).toBe('authentication');
    });

    it('should reject unknown credential', async () => {
      const session = { webauthnChallenge: { challenge: 'x', type: 'authentication', userId: 'u', createdAt: Date.now() } };
      const result = await webauthn.verifyAuthenticationResponse(session, { id: 'unknown', rawId: 'unknown', response: {} });
      expect(result.ok).toBe(false);
    });

    it('should accept valid authentication and update counter', async () => {
      const rs = { webauthnChallenge: { challenge: 'r', type: 'registration', userId: 'vu', createdAt: Date.now() } };
      await webauthn.verifyRegistrationResponse(rs, {
        id: 'vc', rawId: 'vc',
        response: { clientDataJSON: Buffer.from(JSON.stringify({ origin: 'http://localhost:3000' })).toString('base64'), publicKey: 'pk' },
      });
      const as = { webauthnChallenge: { challenge: 'a', type: 'authentication', userId: 'vu', createdAt: Date.now() } };
      const { default: crypto } = await import('crypto');
      const rpIdHash = crypto.createHash('sha256').update('localhost').digest();
      const authBuf = Buffer.alloc(37);
      rpIdHash.copy(authBuf, 0, 0, 32);
      authBuf.writeUInt32BE(2, 33);
      const result = await webauthn.verifyAuthenticationResponse(as, {
        id: 'vc', rawId: 'vc',
        response: {
          clientDataJSON: Buffer.from(JSON.stringify({ origin: 'http://localhost:3000', type: 'webauthn.get' })).toString('base64'),
          authenticatorData: authBuf.toString('base64'),
        },
      });
      expect(result.ok).toBe(true);
      expect(result.userId).toBe('vu');
      expect(result.credentialRecord.counter).toBe(2);
    });

    it('should reject wrong origin', async () => {
      const rs = { webauthnChallenge: { challenge: 'r', type: 'registration', userId: 'ou', createdAt: Date.now() } };
      await webauthn.verifyRegistrationResponse(rs, {
        id: 'oc', rawId: 'oc',
        response: { clientDataJSON: Buffer.from(JSON.stringify({ origin: 'http://localhost:3000' })).toString('base64') },
      });
      const as = { webauthnChallenge: { challenge: 'a', type: 'authentication', userId: 'ou', createdAt: Date.now() } };
      const result = await webauthn.verifyAuthenticationResponse(as, {
        id: 'oc', rawId: 'oc',
        response: { clientDataJSON: Buffer.from(JSON.stringify({ origin: 'https://evil.com' })).toString('base64') },
      });
      expect(result.ok).toBe(false);
    });
  });

  describe('Passkey Management', () => {
    it('should remove a passkey', async () => {
      const rs = { webauthnChallenge: { challenge: 'r', type: 'registration', userId: 'ru', createdAt: Date.now() } };
      await webauthn.verifyRegistrationResponse(rs, {
        id: 'rc', rawId: 'rc',
        response: { clientDataJSON: Buffer.from(JSON.stringify({ origin: 'http://localhost:3000' })).toString('base64') },
      });
      expect((await webauthn.removePasskey('rc', 'ru')).ok).toBe(true);
      expect(await webauthn.listPasskeys('ru')).toEqual([]);
    });

    it('should reject removing another user credential', async () => {
      const rs = { webauthnChallenge: { challenge: 'r', type: 'registration', userId: 'owner', createdAt: Date.now() } };
      await webauthn.verifyRegistrationResponse(rs, {
        id: 'oc2', rawId: 'oc2',
        response: { clientDataJSON: Buffer.from(JSON.stringify({ origin: 'http://localhost:3000' })).toString('base64') },
      });
      expect((await webauthn.removePasskey('oc2', 'attacker')).ok).toBe(false);
    });

    it('hasPasskeys returns correct values', async () => {
      expect(await webauthn.hasPasskeys('new_u')).toBe(false);
      const rs = { webauthnChallenge: { challenge: 'r', type: 'registration', userId: 'hu', createdAt: Date.now() } };
      await webauthn.verifyRegistrationResponse(rs, {
        id: 'hc', rawId: 'hc',
        response: { clientDataJSON: Buffer.from(JSON.stringify({ origin: 'http://localhost:3000' })).toString('base64') },
      });
      expect(await webauthn.hasPasskeys('hu')).toBe(true);
    });
  });
});
