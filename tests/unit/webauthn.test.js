/**
 * Deborah — WebAuthn (Passkey) Service Unit Tests (AUTH A-27)
 *
 * Haqiqiy kripto bilan: sun'iy authenticator (tests/helpers) simplewebauthn
 * v13 verification pipeline'ini to'liq bosib o'tadi — origin/rpId/challenge/
 * counter/imzo hammasi real tekshiriladi.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
// @simplewebauthn/server import'i ~15s (katta graflar: @peculiar/x509, @noble/*).
// Statik import warm-up qiladi — aks holda sovuq start'da birinchi test
// testTimeout (10s) dan oshib flaky bo'ladi.
import '@simplewebauthn/server';
import {
  createKeyPair,
  createRegistrationResponse,
  createAuthenticationResponse,
} from '../helpers/webauthn-authenticator.js';

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
      update: vi.fn(async () => {}),
      remove: vi.fn(async (path) => {
        const r = navigate(testStore, path);
        if (r.found && r.parent) delete r.parent[r.key];
        else if (r.found) Object.keys(testStore).forEach((k) => delete testStore[k]);
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
    PASSKEY_AUTH: 'passkey:authenticate',
    PASSKEY_FAIL: 'passkey:fail',
    PASSKEY_RENAME: 'passkey:rename', // E-05
  },
}));

const RP = { id: 'localhost', origin: 'http://localhost:3000' };

describe('WebAuthn / Passkey Service (AUTH A-27)', () => {
  let w;

  beforeAll(() => {
    // rpFromRequest host-derivation testi ishonchli bo'lishi uchun env toza
    delete process.env.RP_ID;
    delete process.env.RP_ORIGIN;
  });

  beforeEach(async () => {
    vi.clearAllMocks();
    Object.keys(testStore).forEach((k) => delete testStore[k]);
    w = await import('../../src/modules/auth/webauthn.js');
    w.setRpConfig({ name: 'Deborah Test', id: 'localhost', origin: 'http://localhost:3000' });
  });

  describe('RP Configuration', () => {
    it('returns current RP config and rpFromRequest', () => {
      expect(w.getRpConfig().name).toBe('Deborah Test');
      const req = { protocol: 'http', get: (h) => (h === 'host' ? 'deborah.test:4000' : undefined) };
      const rp = w.rpFromRequest(req);
      expect(rp.id).toBe('deborah.test');
      expect(rp.origin).toBe('http://deborah.test:4000');
    });
  });

  describe('Registration Challenge', () => {
    it('generates discoverable (residentKey required) options + stores challenge', async () => {
      const session = {};
      const options = await w.generateRegistrationChallenge(session, { userId: 'u1', userName: 'user1' }, RP);
      expect(options).not.toBeNull();
      expect(options.rp.id).toBe('localhost');
      expect(options.pubKeyCredParams.map((p) => p.alg)).toEqual(expect.arrayContaining([-7, -257, -8]));
      expect(options.authenticatorSelection.residentKey).toBe('required');
      expect(session.webauthnChallenge.type).toBe('registration');
      expect(session.webauthnChallenge.userId).toBe('u1');
      expect(session.webauthnChallenge.challenge).toBe(options.challenge);
    });

    it('returns null for missing userId', async () => {
      expect(await w.generateRegistrationChallenge({}, {}, RP)).toBeNull();
    });
  });

  describe('Registration Verification', () => {
    it('rejects when no active challenge', async () => {
      const r = await w.verifyRegistrationResponseFlow({}, { id: 'x' }, RP);
      expect(r.ok).toBe(false);
      expect(r.error).toBe('no_challenge');
    });

    it('rejects expired challenge', async () => {
      const session = { webauthnChallenge: { challenge: 'abc', type: 'registration', userId: 'u', createdAt: Date.now() - 6 * 60 * 1000 } };
      const r = await w.verifyRegistrationResponseFlow(session, { id: 'c' }, RP);
      expect(r.ok).toBe(false);
      expect(r.error).toBe('challenge_expired');
    });

    it('accepts a valid registration (full crypto pipeline)', async () => {
      const kp = createKeyPair();
      const session = {};
      const options = await w.generateRegistrationChallenge(session, { userId: 'u1', userName: 'user1' }, RP);
      const resp = createRegistrationResponse({ rpId: RP.id, origin: RP.origin, challenge: options.challenge, ...kp });
      const r = await w.verifyRegistrationResponseFlow(session, resp, RP);
      expect(r.ok).toBe(true);
      expect(r.credential.id).toBe(resp.id);
      expect(r.credential.counter).toBe(0);
      expect(session.webauthnChallenge).toBeUndefined(); // single-use
      // stored in DB with correct shape
      const snap = await (await import('../../firebase/admin.js')).fb.get(`passkeys/${resp.id}`);
      expect(snap.exists()).toBe(true);
      expect(snap.val().publicKey).toBeTruthy();
      expect(snap.val().userId).toBe('u1');
    });

    it('rejects wrong origin (cross-origin attestation)', async () => {
      const kp = createKeyPair();
      const session = {};
      const options = await w.generateRegistrationChallenge(session, { userId: 'u1', userName: 'user1' }, RP);
      const resp = createRegistrationResponse({ rpId: RP.id, origin: 'https://evil.com', challenge: options.challenge, ...kp });
      const r = await w.verifyRegistrationResponseFlow(session, resp, RP);
      expect(r.ok).toBe(false);
    });

    it('rejects wrong challenge (replay/CSRF-style)', async () => {
      const kp = createKeyPair();
      const session = {};
      await w.generateRegistrationChallenge(session, { userId: 'u1', userName: 'user1' }, RP);
      const resp = createRegistrationResponse({ rpId: RP.id, origin: RP.origin, challenge: 'different-challenge', ...kp });
      const r = await w.verifyRegistrationResponseFlow(session, resp, RP);
      expect(r.ok).toBe(false);
    });

    it('rejects duplicate credential', async () => {
      const kp = createKeyPair();
      const session = {};
      const options = await w.generateRegistrationChallenge(session, { userId: 'u1', userName: 'user1' }, RP);
      const resp = createRegistrationResponse({ rpId: RP.id, origin: RP.origin, challenge: options.challenge, ...kp });
      // index'ni oldindan seed qilib "allaqachon bor" holatni simulyatsiya qilamiz
      const { fb } = await import('../../firebase/admin.js');
      await fb.set('passkeys_index/u1', [{ id: resp.id, createdAt: Date.now() }]);
      const r = await w.verifyRegistrationResponseFlow(session, resp, RP);
      expect(r.ok).toBe(false);
      expect(r.error).toBe('duplicate');
    });

    it('rejects when max credentials reached', async () => {
      const kp = createKeyPair();
      const session = {};
      const options = await w.generateRegistrationChallenge(session, { userId: 'u1', userName: 'user1' }, RP);
      const resp = createRegistrationResponse({ rpId: RP.id, origin: RP.origin, challenge: options.challenge, ...kp });
      const { fb } = await import('../../firebase/admin.js');
      const seed = Array.from({ length: 25 }, (_, i) => ({ id: `seed-${i}`, createdAt: Date.now() }));
      await fb.set('passkeys_index/u1', seed);
      const r = await w.verifyRegistrationResponseFlow(session, resp, RP);
      expect(r.ok).toBe(false);
      expect(r.error).toBe('limit_reached');
    });
  });

  describe('Authentication Challenge', () => {
    it('scopes allowCredentials when userId provided', async () => {
      const { fb } = await import('../../firebase/admin.js');
      await fb.set('passkeys_index/u2', [{ id: 'cred-a', createdAt: Date.now() }]);
      const session = {};
      const options = await w.generateAuthenticationChallenge(session, { userId: 'u2' }, RP);
      expect(options.allowCredentials.map((c) => c.id)).toEqual(['cred-a']);
      expect(session.webauthnChallenge.type).toBe('authentication');
    });

    it('userless (discoverable) when no userId → no allowCredentials', async () => {
      const session = {};
      const options = await w.generateAuthenticationChallenge(session, {}, RP);
      expect(options.allowCredentials).toBeUndefined();
    });
  });

  describe('Authentication Verification', () => {
    async function register(kp, userId) {
      const session = {};
      const options = await w.generateRegistrationChallenge(session, { userId, userName: userId }, RP);
      const resp = createRegistrationResponse({ rpId: RP.id, origin: RP.origin, challenge: options.challenge, ...kp });
      const r = await w.verifyRegistrationResponseFlow(session, resp, RP);
      expect(r.ok).toBe(true);
      return { resp, publicKey: kp.publicKey, privateKey: kp.privateKey, userId };
    }

    it('rejects unknown credential', async () => {
      const session = { webauthnChallenge: { challenge: 'x', type: 'authentication', createdAt: Date.now() } };
      const r = await w.verifyAuthenticationResponseFlow(session, { id: 'unknown', response: {} }, RP);
      expect(r.ok).toBe(false);
      expect(r.error).toBe('unknown_credential');
    });

    it('accepts a valid assertion and updates counter', async () => {
      const kp = createKeyPair();
      const { resp } = await register(kp, 'vu');
      const credId = Buffer.from(resp.rawId, 'base64url');
      const session = {};
      const options = await w.generateAuthenticationChallenge(session, {}, RP);
      const assertion = createAuthenticationResponse({
        rpId: RP.id, origin: RP.origin, challenge: options.challenge,
        credId, publicKey: kp.publicKey, privateKey: kp.privateKey, counter: 1,
      });
      const r = await w.verifyAuthenticationResponseFlow(session, assertion, RP);
      expect(r.ok).toBe(true);
      expect(r.userId).toBe('vu');
      const { fb } = await import('../../firebase/admin.js');
      const snap = await fb.get(`passkeys/${resp.id}`);
      expect(snap.val().counter).toBe(1);
      expect(session.webauthnChallenge).toBeUndefined(); // single-use
    });

    it('rejects counter regression (cloned authenticator)', async () => {
      const kp = createKeyPair();
      const { resp } = await register(kp, 'cr');
      const credId = Buffer.from(resp.rawId, 'base64url');
      // stored counter 0; yangi assertion counter 0 (regression emas) — avval 1 ga ko'taramiz
      const { fb } = await import('../../firebase/admin.js');
      await fb.set(`passkeys/${resp.id}/counter`, 5);
      const session = {};
      const options = await w.generateAuthenticationChallenge(session, {}, RP);
      const assertion = createAuthenticationResponse({
        rpId: RP.id, origin: RP.origin, challenge: options.challenge,
        credId, publicKey: kp.publicKey, privateKey: kp.privateKey, counter: 3,
      });
      const r = await w.verifyAuthenticationResponseFlow(session, assertion, RP);
      expect(r.ok).toBe(false);
      expect(r.error).toBe('counter_regression');
    });

    it('rejects counter replay (equal counter, stored > 0)', async () => {
      const kp = createKeyPair();
      const { resp } = await register(kp, 'rp');
      const credId = Buffer.from(resp.rawId, 'base64url');
      const { fb } = await import('../../firebase/admin.js');
      await fb.set(`passkeys/${resp.id}/counter`, 5);
      const session = {};
      const options = await w.generateAuthenticationChallenge(session, {}, RP);
      const assertion = createAuthenticationResponse({
        rpId: RP.id, origin: RP.origin, challenge: options.challenge,
        credId, publicKey: kp.publicKey, privateKey: kp.privateKey, counter: 5,
      });
      const r = await w.verifyAuthenticationResponseFlow(session, assertion, RP);
      expect(r.ok).toBe(false);
      expect(r.error).toBe('counter_replay');
    });

    it('rejects wrong origin on assertion', async () => {
      const kp = createKeyPair();
      const { resp } = await register(kp, 'wo');
      const credId = Buffer.from(resp.rawId, 'base64url');
      const session = {};
      const options = await w.generateAuthenticationChallenge(session, {}, RP);
      const assertion = createAuthenticationResponse({
        rpId: RP.id, origin: 'https://evil.com', challenge: options.challenge,
        credId, publicKey: kp.publicKey, privateKey: kp.privateKey, counter: 1,
      });
      const r = await w.verifyAuthenticationResponseFlow(session, assertion, RP);
      expect(r.ok).toBe(false);
    });

    it('allows counter 0→0 (never-incrementing authenticator)', async () => {
      const kp = createKeyPair();
      const { resp } = await register(kp, 'z0');
      const credId = Buffer.from(resp.rawId, 'base64url');
      const session = {};
      const options = await w.generateAuthenticationChallenge(session, {}, RP);
      const assertion = createAuthenticationResponse({
        rpId: RP.id, origin: RP.origin, challenge: options.challenge,
        credId, publicKey: kp.publicKey, privateKey: kp.privateKey, counter: 0,
      });
      const r = await w.verifyAuthenticationResponseFlow(session, assertion, RP);
      expect(r.ok).toBe(true);
    });
  });

  describe('Passkey Management', () => {
    it('lists, counts and removes passkeys (owner-only)', async () => {
      const kp = createKeyPair();
      const session = {};
      const options = await w.generateRegistrationChallenge(session, { userId: 'mg', userName: 'mg' }, RP);
      const resp = createRegistrationResponse({ rpId: RP.id, origin: RP.origin, challenge: options.challenge, ...kp });
      await w.verifyRegistrationResponseFlow(session, resp, RP);

      expect(await w.countPasskeys('mg')).toBe(1);
      const list = await w.listPasskeys('mg');
      expect(list.length).toBe(1);
      expect(list[0].id).toBe(resp.id);

      // IDOR: boshqa user o'chira olmaydi
      expect((await w.removePasskey(resp.id, 'attacker')).ok).toBe(false);
      // Owner o'chiradi
      expect((await w.removePasskey(resp.id, 'mg')).ok).toBe(true);
      expect(await w.hasPasskeys('mg')).toBe(false);
    });

    it('hasPasskeys reflects registration', async () => {
      expect(await w.hasPasskeys('hu')).toBe(false);
      const kp = createKeyPair();
      const session = {};
      const options = await w.generateRegistrationChallenge(session, { userId: 'hu', userName: 'hu' }, RP);
      const resp = createRegistrationResponse({ rpId: RP.id, origin: RP.origin, challenge: options.challenge, ...kp });
      await w.verifyRegistrationResponseFlow(session, resp, RP);
      expect(await w.hasPasskeys('hu')).toBe(true);
    });
  });

  describe('Passkey Rename (E-05: multi-device boshqaruv)', () => {
    async function registerOne(userId) {
      const kp = createKeyPair();
      const session = {};
      const options = await w.generateRegistrationChallenge(session, { userId, userName: userId }, RP);
      const resp = createRegistrationResponse({ rpId: RP.id, origin: RP.origin, challenge: options.challenge, ...kp });
      const r = await w.verifyRegistrationResponseFlow(session, resp, RP);
      expect(r.ok).toBe(true);
      return resp.id;
    }

    it('renames own passkey (trim + audit PASSKEY_RENAME)', async () => {
      const credId = await registerOne('rn1');
      const r = await w.renamePasskey(credId, 'rn1', '   iPhone 15 Pro  ');
      expect(r.ok).toBe(true);
      expect(r.credential.deviceName).toBe('iPhone 15 Pro');

      const { fb } = await import('../../firebase/admin.js');
      const snap = await fb.get(`passkeys/${credId}`);
      expect(snap.val().deviceName).toBe('iPhone 15 Pro');

      const { audit } = await import('../../src/modules/auth/audit.js');
      expect(audit).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'passkey:rename', userId: 'rn1' }),
      );
    });

    it('rejects invalid names (empty, too long, control chars)', async () => {
      const credId = await registerOne('rn2');
      expect((await w.renamePasskey(credId, 'rn2', '   ')).error).toBe('invalid_name');
      expect((await w.renamePasskey(credId, 'rn2', 'x'.repeat(51))).error).toBe('invalid_name');
      expect((await w.renamePasskey(credId, 'rn2', 'bad\u0000name')).error).toBe('invalid_name');
      expect((await w.renamePasskey(credId, 'rn2', 'tab\tname')).error).toBe('invalid_name');
      // Saqlangan nom o'zgarmadi
      const { fb } = await import('../../firebase/admin.js');
      const snap = await fb.get(`passkeys/${credId}`);
      expect(snap.val().deviceName).toBe('Qurilma');
    });

    it('rejects rename of another user\'s passkey (IDOR → not_found)', async () => {
      const credId = await registerOne('rn3owner');
      const r = await w.renamePasskey(credId, 'rn3attacker', 'Stolen');
      expect(r.ok).toBe(false);
      expect(r.error).toBe('not_found');
      const { fb } = await import('../../firebase/admin.js');
      const snap = await fb.get(`passkeys/${credId}`);
      expect(snap.val().deviceName).toBe('Qurilma');
    });

    it('rejects rename of unknown credential', async () => {
      const r = await w.renamePasskey('does-not-exist', 'rn4', 'Any');
      expect(r.ok).toBe(false);
      expect(r.error).toBe('not_found');
    });
  });
});
