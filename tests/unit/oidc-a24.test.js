/**
 * Deborah — AUTH A-24: OIDC hardening unit testlari (OAuth 2.1 / RFC 9700)
 * ---------------------------------------------------------
 * Guide A-24 §06/§07/§08/§11/§15/§20:
 *  - alg allowlist (RS256; HS256 rad — alg confusion)
 *  - issuer EXACT (prefix emas)
 *  - redirect_uri exact match (assertExactRedirectUri)
 *  - refresh token rotatsiya + replay (rotated token qayta ishlatilsa)
 *  - callback rate limit (20/15 daqiqa)
 */

import { describe, it, expect, beforeAll } from 'vitest';
import * as jose from 'jose';

let oidc;
beforeAll(async () => {
  oidc = await import('../../src/modules/auth/oidc.js');
});

const AUD = 'test-client-123.apps.googleusercontent.com';

/** RS256 keypair + local JWKS (haqiqiy verify uchun). */
async function makeJwks() {
  const { publicKey, privateKey } = await jose.generateKeyPair('RS256');
  const pubJwk = await jose.exportJWK(publicKey);
  pubJwk.kid = 'k1';
  const jwks = jose.createLocalJWKSet({ keys: [pubJwk] });
  return { jwks, privateKey };
}

/** RS256 ID token (Google issuer). */
async function signIdToken({ privateKey, sub = 'gsub-1', email = 't@example.com', nonce = 'n1', issuer = 'https://accounts.google.com', audience = AUD, expiresIn = '1h' }) {
  const jwt = new jose.SignJWT({ sub, email, email_verified: true, nonce })
    .setProtectedHeader({ alg: 'RS256', kid: 'k1' })
    .setIssuedAt()
    .setIssuer(issuer)
    .setAudience(audience)
    .setExpirationTime(expiresIn === 'expired' ? Math.floor(Date.now() / 1000) - 3600 : expiresIn);
  return jwt.sign(privateKey);
}

describe('AUTH A-24 — alg allowlist (guide §06)', () => {
  it('HS256 token → RAD (alg confusion himoya)', async () => {
    const { jwks } = await makeJwks();
    // Attacker client_secret bilan HS256 imzolaydi
    const secret = new TextEncoder().encode('attacker-known-client-secret');
    const hs256 = await new jose.SignJWT({ sub: 'evil', email: 'e@e.com', email_verified: true, nonce: 'n1' })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setIssuer('https://accounts.google.com')
      .setAudience(AUD)
      .setExpirationTime('1h')
      .sign(secret);

    const r = await oidc.verifyGoogleIdTokenDetailed(hs256, 'n1', { jwks, audience: AUD });
    expect(r.ok).toBe(false);
    expect(r.error).toBe('alg');
  });

  it('RS256 to`g`ri → qabul (allowlist yopilmaydi)', async () => {
    const { jwks, privateKey } = await makeJwks();
    const token = await signIdToken({ privateKey, nonce: 'n1' });
    const r = await oidc.verifyGoogleIdTokenDetailed(token, 'n1', { jwks, audience: AUD });
    expect(r.ok).toBe(true);
    expect(r.profile.email).toBe('t@example.com');
  });
});

describe('AUTH A-24 — issuer EXACT (guide §07)', () => {
  it('prefix issuer (accounts.google.com.evil.com) → RAD', async () => {
    const { jwks, privateKey } = await makeJwks();
    const token = await signIdToken({ privateKey, nonce: 'n1', issuer: 'https://accounts.google.com.evil.com' });
    const r = await oidc.verifyGoogleIdTokenDetailed(token, 'n1', { jwks, audience: AUD });
    expect(r.ok).toBe(false);
    expect(r.error).toBe('issuer');
  });

  it('bare issuer (accounts.google.com — scheme yo`q) → RAD (faqat exact)', async () => {
    const { jwks, privateKey } = await makeJwks();
    const token = await signIdToken({ privateKey, nonce: 'n1', issuer: 'accounts.google.com' });
    const r = await oidc.verifyGoogleIdTokenDetailed(token, 'n1', { jwks, audience: AUD });
    expect(r.ok).toBe(false);
    expect(r.error).toBe('issuer');
  });

  it('exact issuer → qabul', async () => {
    const { jwks, privateKey } = await makeJwks();
    const token = await signIdToken({ privateKey, nonce: 'n1' });
    const r = await oidc.verifyGoogleIdTokenDetailed(token, 'n1', { jwks, audience: AUD });
    expect(r.ok).toBe(true);
  });
});

describe('AUTH A-24 — aniq xato kodlari (audit uchun)', () => {
  it('nonce mismatch → error "nonce"', async () => {
    const { jwks, privateKey } = await makeJwks();
    const token = await signIdToken({ privateKey, nonce: 'n1' });
    const r = await oidc.verifyGoogleIdTokenDetailed(token, 'WRONG', { jwks, audience: AUD });
    expect(r.ok).toBe(false);
    expect(r.error).toBe('nonce');
  });

  it('expired → error "expired"', async () => {
    const { jwks, privateKey } = await makeJwks();
    const token = await signIdToken({ privateKey, nonce: 'n1', expiresIn: 'expired' });
    const r = await oidc.verifyGoogleIdTokenDetailed(token, 'n1', { jwks, audience: AUD });
    expect(r.ok).toBe(false);
    expect(r.error).toBe('expired');
  });

  it('audience → error "audience"', async () => {
    const { jwks, privateKey } = await makeJwks();
    const token = await signIdToken({ privateKey, nonce: 'n1', audience: 'other-client.apps.googleusercontent.com' });
    const r = await oidc.verifyGoogleIdTokenDetailed(token, 'n1', { jwks, audience: AUD });
    expect(r.ok).toBe(false);
    expect(r.error).toBe('audience');
  });

  it('backward-compat wrapper: profile | null', async () => {
    const { jwks, privateKey } = await makeJwks();
    const token = await signIdToken({ privateKey, nonce: 'n1' });
    expect(await oidc.verifyGoogleIdToken(token, 'n1', { jwks, audience: AUD })).not.toBeNull();
    expect(await oidc.verifyGoogleIdToken(token, 'WRONG', { jwks, audience: AUD })).toBeNull();
  });
});

describe('AUTH A-24 — redirect_uri exact (guide §08)', () => {
  it('config yo`q muhitda fail-closed (false)', () => {
    // Test muhitida GOOGLE_REDIRECT_URI yo'q → registered bo'lmagan → false
    expect(oidc.assertExactRedirectUri({ protocol: 'http', get: () => 'localhost', path: '/auth/google/callback' })).toBe(false);
  });
});

describe('AUTH A-24 — callback rate limit (guide §15)', () => {
  it('20/15 daqiqa per IP — 21-chisi blok', () => {
    for (let i = 0; i < 20; i++) {
      expect(oidc.checkGoogleCallbackLimit('198.51.100.9').allowed).toBe(true);
    }
    const blocked = oidc.checkGoogleCallbackLimit('198.51.100.9');
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
    expect(oidc.checkGoogleCallbackLimit('198.51.100.10').allowed).toBe(true);
  });
});

describe('AUTH A-24 — refresh token rotatsiya + replay (guide §11)', () => {
  it('muvaffaqiyatli rotatsiya — yangi token saqlanadi', async () => {
    const stored = [];
    const r = await oidc.rotateGoogleRefreshToken({
      userKey: 'user-1',
      currentRefreshToken: 'tok-1',
      deps: {
        getStored: async () => 'tok-1',
        setStored: async (k, v) => stored.push(v),
        clearStored: async () => {},
        fetch: async () => ({
          ok: true,
          json: async () => ({ access_token: 'a-new', refresh_token: 'tok-2', expires_in: 3600 }),
        }),
      },
    });
    expect(r.ok).toBe(true);
    expect(r.rotated).toBe(true);
    expect(stored).toContain('tok-2'); // rotatsiya saqlandi
  });

  it('Google yangi refresh bermasa → rotated=false, saqlanmaydi', async () => {
    const stored = [];
    const r = await oidc.rotateGoogleRefreshToken({
      userKey: 'user-1',
      currentRefreshToken: 'tok-1',
      deps: {
        getStored: async () => 'tok-1',
        setStored: async (k, v) => stored.push(v),
        clearStored: async () => {},
        fetch: async () => ({ ok: true, json: async () => ({ access_token: 'a-new' }) }),
      },
    });
    expect(r.ok).toBe(true);
    expect(r.rotated).toBe(false);
    expect(stored).toHaveLength(0);
  });

  it('REPLAY: rotated token qayta ishlatilsa → zanjir invalid + audit signali', async () => {
    let cleared = false;
    const r = await oidc.rotateGoogleRefreshToken({
      userKey: 'user-1',
      currentRefreshToken: 'tok-OLD', // eski (allaqachon rotated)
      deps: {
        getStored: async () => 'tok-NEW', // serverda yangisi bor
        setStored: async () => {},
        clearStored: async () => { cleared = true; },
        fetch: async () => { throw new Error('should not call Google'); },
      },
    });
    expect(r.ok).toBe(false);
    expect(r.error).toBe('replay');
    expect(cleared).toBe(true); // butun zanjir invalid
  });

  it('stored token yo`q → no-stored-token', async () => {
    const r = await oidc.rotateGoogleRefreshToken({
      userKey: 'user-1',
      currentRefreshToken: 'tok-1',
      deps: { getStored: async () => null },
    });
    expect(r.ok).toBe(false);
    expect(r.error).toBe('no-stored-token');
  });

  it('Google exchange fail → exchange-failed', async () => {
    const r = await oidc.rotateGoogleRefreshToken({
      userKey: 'user-1',
      currentRefreshToken: 'tok-1',
      deps: {
        getStored: async () => 'tok-1',
        setStored: async () => {},
        clearStored: async () => {},
        fetch: async () => ({ ok: false, status: 400, text: async () => '{"error":"invalid_grant"}' }),
      },
    });
    expect(r.ok).toBe(false);
    expect(r.error).toBe('exchange-failed');
  });
});
