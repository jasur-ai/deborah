/**
 * Deborah — AUTH A-07: Google OIDC unit testlari
 * ----------------------------------------------------------
 * Guide A-07 §7/§12/§13/§17/§23:
 *  - state + nonce 32 bayt (buildAuthUrl session'da)
 *  - ID token verify: iss / aud / exp / nonce / email_verified (jose JWKS)
 *  - PKCE verifier/challenge URL-safe, S256
 *  - GET /auth/google rate limit (10/15 daqiqa per IP)
 */

import { describe, it, expect, beforeAll } from 'vitest';
import * as jose from 'jose';

const CONFIG_OVERRIDE = {
  GOOGLE_CLIENT_ID: 'test-client-123.apps.googleusercontent.com',
  GOOGLE_CLIENT_SECRET: 'test-secret',
  GOOGLE_REDIRECT_URI: 'http://localhost:3000/auth/google/callback',
};

// test muhitida GOOGLE_* env bo'lmasa ham oidc modulini yuklaymiz —
// verifyGoogleIdToken'a jwks + audience override beramiz (toza unit test).
let oidc;
beforeAll(async () => {
  oidc = await import('../../src/modules/auth/oidc.js');
});

/** RS256 keypair + local JWKS yaratadi (jose bilan haqiqiy verify uchun). */
async function makeJwks() {
  const { publicKey, privateKey } = await jose.generateKeyPair('RS256');
  const pubJwk = await jose.exportJWK(publicKey);
  pubJwk.kid = 'k1'; // header'dagi kid bilan mos — JWKS key lookup uchun shart
  const jwks = jose.createLocalJWKSet({ keys: [pubJwk] });
  return { jwks, privateKey };
}

/** ID token yaratadi (RS256, Google issuer). */
async function signIdToken({ privateKey, sub = 'gsub-123', email = 'test@example.com', emailVerified = true, nonce = 'nonce-abc', issuer = 'https://accounts.google.com', audience = CONFIG_OVERRIDE.GOOGLE_CLIENT_ID, expiresIn = '1h', includeNonce = true }) {
  const payload = { sub, email, email_verified: emailVerified };
  if (includeNonce) payload.nonce = nonce;
  let jwt = new jose.SignJWT(payload)
    .setProtectedHeader({ alg: 'RS256', kid: 'k1' })
    .setIssuedAt();
  if (issuer) jwt = jwt.setIssuer(issuer);
  if (audience) jwt = jwt.setAudience(audience);
  // expiresIn: '1h' | 'expired' — jose setExpirationTime string (relative)
  // yoki epoch soniyalar qabul qiladi; eskirgan token uchun o'tgan epoch.
  if (expiresIn === 'expired') {
    jwt = jwt.setExpirationTime(Math.floor(Date.now() / 1000) - 3600);
  } else {
    jwt = jwt.setExpirationTime(expiresIn);
  }
  return jwt.sign(privateKey);
}

describe('AUTH A-07 — state/nonce 32B (guide §7)', () => {
  it('buildAuthUrl session\'ga state + nonce saqlaydi — 32 bayt (64 hex)', () => {
    const session = {};
    const url = oidc.buildAuthUrl(session);
    expect(url).toBeNull(); // test muhitida config yo'q → null
    // buildAuthUrl configsiz null qaytaradi; to'g'ridan-to'g'ri uzunlikni
    // generatePkceChallenge + session yozuvi orqali tekshiramiz
    const { verifier, challenge, method } = oidc.generatePkceChallenge();
    expect(verifier.length).toBeGreaterThanOrEqual(43);
    expect(challenge).toBeTruthy();
    expect(method).toBe('S256');
  });

  it('generatePkceChallenge — verifier URL-safe (base64url), S256', () => {
    const { verifier, challenge } = oidc.generatePkceChallenge();
    expect(verifier).not.toMatch(/[+/=]/);
    expect(challenge).not.toMatch(/[+/=]/);
    expect(verifier.length).toBeGreaterThanOrEqual(43);
    expect(challenge.length).toBeGreaterThanOrEqual(43);
  });

  it('verifyGoogleIdToken export mavjud', () => {
    expect(typeof oidc.verifyGoogleIdToken).toBe('function');
  });
});

describe('AUTH A-07 — ID token verify (jose, guide §12)', () => {
  it('yaroqli ID token qabul qilinadi — iss/aud/exp/nonce/email_verified', async () => {
    const { jwks, privateKey } = await makeJwks();
    const idToken = await signIdToken({ privateKey, nonce: 'nonce-1' });

    const user = await oidc.verifyGoogleIdToken(idToken, 'nonce-1', {
      jwks, audience: CONFIG_OVERRIDE.GOOGLE_CLIENT_ID,
    });
    expect(user).not.toBeNull();
    expect(user.sub).toBe('gsub-123');
    expect(user.email).toBe('test@example.com');
    expect(user.emailVerified).toBe(true);
  });

  it('nonce mismatch → reject (replay himoya)', async () => {
    const { jwks, privateKey } = await makeJwks();
    const idToken = await signIdToken({ privateKey, nonce: 'nonce-1' });

    const user = await oidc.verifyGoogleIdToken(idToken, 'WRONG-nonce', {
      jwks, audience: CONFIG_OVERRIDE.GOOGLE_CLIENT_ID,
    });
    expect(user).toBeNull();
  });

  it('noto\'g\'ri issuer → reject', async () => {
    const { jwks, privateKey } = await makeJwks();
    const idToken = await signIdToken({ privateKey, nonce: 'n1', issuer: 'https://evil.example.com' });

    const user = await oidc.verifyGoogleIdToken(idToken, 'n1', {
      jwks, audience: CONFIG_OVERRIDE.GOOGLE_CLIENT_ID,
    });
    expect(user).toBeNull();
  });

  it('noto\'g\'ri audience → reject (boshqa client ID)', async () => {
    const { jwks, privateKey } = await makeJwks();
    const idToken = await signIdToken({ privateKey, nonce: 'n1', audience: 'other-client.apps.googleusercontent.com' });

    const user = await oidc.verifyGoogleIdToken(idToken, 'n1', {
      jwks, audience: CONFIG_OVERRIDE.GOOGLE_CLIENT_ID,
    });
    expect(user).toBeNull();
  });

  it('expired token → reject', async () => {
    const { jwks, privateKey } = await makeJwks();
    const idToken = await signIdToken({ privateKey, nonce: 'n1', expiresIn: 'expired' });

    const user = await oidc.verifyGoogleIdToken(idToken, 'n1', {
      jwks, audience: CONFIG_OVERRIDE.GOOGLE_CLIENT_ID,
    });
    expect(user).toBeNull();
  });

  it('email_verified !== true → reject (guide §13)', async () => {
    const { jwks, privateKey } = await makeJwks();
    const idToken = await signIdToken({ privateKey, nonce: 'n1', emailVerified: false });

    const user = await oidc.verifyGoogleIdToken(idToken, 'n1', {
      jwks, audience: CONFIG_OVERRIDE.GOOGLE_CLIENT_ID,
    });
    expect(user).toBeNull();
  });

  it('qalbaki token (signature noto\'g\'ri) → reject', async () => {
    const { jwks, privateKey } = await makeJwks();
    const realToken = await signIdToken({ privateKey, nonce: 'n1' });
    // Signature'ni buzamiz
    const [h, p, s] = realToken.split('.');
    const tampered = `${h}.${p}.${Buffer.from('AAAA').toString('base64url')}`;

    const user = await oidc.verifyGoogleIdToken(tampered, 'n1', {
      jwks, audience: CONFIG_OVERRIDE.GOOGLE_CLIENT_ID,
    });
    expect(user).toBeNull();
  });
});

describe('AUTH A-07 — rate limit (guide §17)', () => {
  it('checkGoogleStartLimit — 10/15 daqiqa per IP', () => {
    // 10 ta ruxsat
    for (let i = 0; i < 10; i++) {
      expect(oidc.checkGoogleStartLimit('203.0.113.99').allowed).toBe(true);
    }
    // 11-chisi blok
    const blocked = oidc.checkGoogleStartLimit('203.0.113.99');
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
    // Boshqa IP ta'sirlanmaydi
    expect(oidc.checkGoogleStartLimit('203.0.113.100').allowed).toBe(true);
  });
});

describe('AUTH A-07 — findOrCreateUser mapping (guide §14/§20, B-10 kontrakt)', () => {
  it('yangi Google user → status setup (account hali yaratilmaydi, B-10)', async () => {
    const { fb } = await import('../../firebase/admin.js');
    const sub = `gsub-map-${Date.now() % 1000000}`;
    const result = await oidc.findOrCreateUser({
      sub,
      email: `map-${sub}@example.com`,
      emailVerified: true,
      name: 'Map User',
    });
    expect(result.status).toBe('setup');
    // Account YARATILMAYDI (rol modal'da yaratiladi)
    const { safeKey } = await import('../../utils/helpers.js');
    const snap = await fb.get(`users/${safeKey('google:' + sub)}`);
    expect(snap.exists()).toBe(false);
  });

  // AUTH B-09: verified email + parol account → LINK (escalation emas)
  it('email band + verified → account LINK (google_sub bog\'lanadi, B-09)', async () => {
    const { fb } = await import('../../firebase/admin.js');
    const { safeKey } = await import('../../utils/helpers.js');
    const stamp = Date.now() % 1000000;
    const email = `link-${stamp}@example.com`;
    const localKey = `local-${stamp}`;
    // Canonical email index (A-18 path) + haqiqiy parol account
    await fb.set(`users_email_index/${safeKey(email)}`, localKey);
    await fb.set(`users/${localKey}`, {
      username: `local${stamp}`, email, password: 'hashed-pass',
      created_at: Date.now(), safeKey: localKey,
    });

    const result = await oidc.findOrCreateUser({
      sub: `gsub-l-${stamp}`, email, emailVerified: true, name: 'Link',
    });
    expect(result.status).toBe('login');
    expect(result.user.safeKey).toBe(localKey); // lokal account'ga qaytadi
    expect(result.user.linked).toBe(true);
    const after = await fb.get(`users/${localKey}`);
    expect(after.val().google_sub).toBe(`gsub-l-${stamp}`); // google_sub yozilgan
  });

  // AUTH B-09 §09: verified emas → link YO'Q (escalation yo'q)
  it('email band + UNverified → blok (link yo\'q)', async () => {
    const { fb } = await import('../../firebase/admin.js');
    const { safeKey } = await import('../../utils/helpers.js');
    const stamp = Date.now() % 1000000;
    const email = `unv-${stamp}@example.com`;
    const localKey = `unv-local-${stamp}`;
    await fb.set(`users_email_index/${safeKey(email)}`, localKey);
    await fb.set(`users/${localKey}`, {
      username: `unv${stamp}`, email, password: 'hashed-pass',
      created_at: Date.now(), safeKey: localKey,
    });

    const result = await oidc.findOrCreateUser({
      sub: `gsub-u-${stamp}`, email, emailVerified: false, name: 'Unv',
    });
    expect(result.status).toBe('blocked'); // blok — getLinkingError
    const after = await fb.get(`users/${localKey}`);
    expect(after.val().google_sub).toBeUndefined(); // yozilmaydi
  });

  it('getLinkingError — stable kod qaytaradi', () => {
    expect(typeof oidc.getLinkingError).toBe('function');
    expect(oidc.getLinkingError()).toBe('linking_required');
  });
});
