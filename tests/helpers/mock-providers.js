/**
 * Deborah — Mock Providers Helper (AUTH D-14 §07)
 * ---------------------------------------------------------------------------
 * Markaziy mock provider'lar — har testda qayta yozmaslik uchun.
 * Texnikalar mavjud unit testlardan ko'chirildi (o'sha testlarga tegilmadi):
 *   - Google OIDC: jose RS256 JWKS + ID token sign (oidc-a07 usuli)
 *   - Email: provider='mock' (email-provider-a23 usuli — modul ichida bor)
 *   - Telegram: crypto.randomInt spy (telegram-a16 usuli)
 *   - Turnstile: siteverify fetch javobi (bot-guard-b08 usuli)
 *   - HIBP: fetchImpl DI (hibp-a22 usuli)
 *   - HEMIS: A-14 live-test harness tarmoqqa chiqmaydi — mock shart emas
 *
 * Xavfsizlik: barcha secret'lar test fixture (haqiqiy emas, D-14 §13).
 */

import * as jose from 'jose';
import crypto from 'node:crypto';

// ── Google OIDC ──
// oidc-a07.test.js usuli: haqiqiy RS256 keypair + lokal JWKS → verify
// haqiqiy kriptografik tekshiruv bilan ishlaydi.

/** RS256 keypair + lokal JWKS yaratadi. */
export async function makeGoogleJwks() {
  const { publicKey, privateKey } = await jose.generateKeyPair('RS256');
  const pubJwk = await jose.exportJWK(publicKey);
  pubJwk.kid = 'k1';
  const jwks = jose.createLocalJWKSet({ keys: [pubJwk] });
  return { jwks, privateKey };
}

/**
 * Google ID token sign qiladi (RS256, Google issuer).
 * expiresIn: '1h' | 'expired' — eskirgan token uchun o'tgan epoch.
 */
export async function signGoogleIdToken({
  privateKey,
  sub = 'gsub-123',
  email = 'test@example.com',
  emailVerified = true,
  nonce = 'nonce-abc',
  issuer = 'https://accounts.google.com',
  audience = 'test-client-123.apps.googleusercontent.com',
  expiresIn = '1h',
  includeNonce = true,
}) {
  const payload = { sub, email, email_verified: emailVerified };
  if (includeNonce) payload.nonce = nonce;
  let jwt = new jose.SignJWT(payload)
    .setProtectedHeader({ alg: 'RS256', kid: 'k1' })
    .setIssuedAt();
  if (issuer) jwt = jwt.setIssuer(issuer);
  if (audience) jwt = jwt.setAudience(audience);
  if (expiresIn === 'expired') {
    jwt = jwt.setExpirationTime(Math.floor(Date.now() / 1000) - 3600);
  } else {
    jwt = jwt.setExpirationTime(expiresIn);
  }
  return jwt.sign(privateKey);
}

// ── Email (mock transport) ──
// email-provider-a23 usuli: `provider: 'mock'` — hech qaerga yubormaydi.
// Modul ichida built-in; bu helper kontraktni hujjatlashtiradi.

export const MOCK_EMAIL_OPTION = { provider: 'mock' };

// ── Telegram (code generation) ──
// telegram-a16 usuli: crypto.randomInt spy — deterministik kod.

/**
 * crypto.randomInt'ni spy qiladi — ketma-ket kodlar beradi.
 * @param {number[]} sequence har bir chaqiruv uchun kod
 */
export function spyRandomInt(sequence) {
  const spied = vi.spyOn(crypto, 'randomInt').mockImplementation(() => {
    const next = sequence.shift();
    if (typeof next === 'undefined') throw new Error('mock-providers: sequence tugadi');
    return next;
  });
  return spied;
}

// ── Turnstile (siteverify fetch) ──
// bot-guard-b08 usuli: fetch javobini mock qilish.
// Bot-guard moduli fetch'ni global ishlatadi — vi.stubGlobal bilan.

/** Turnstile siteverify fetch mock — `ok:true` yoki `ok:false`. */
export function mockTurnstileFetch({ ok = true, errorCodes = [] } = {}) {
  const fetchMock = vi.fn(async () => ({
    ok: true,
    json: async () => ({ success: ok, 'error-codes': errorCodes }),
  }));
  return fetchMock;
}

// ── HIBP (breach check) ──
// hibp-a22 usuli: `fetchImpl` dependency injection — modul ichida DI bor.

/** HIBP fetch mock — breached yoki toza javob. */
export function makeHibpFetch({ breached = false, status = 200 } = {}) {
  return vi.fn(async (url) => {
    if (status !== 200) {
      return { ok: false, status };
    }
    if (breached) {
      // HIBP javob formati: SUFFIX:COUNT — 'password' SHA-1 = 5BAA61E4... →
      // prefix 5 belgi (5BAA6), suffix = 1E4C9B93F3F0682250B6CF8331B7EE68FD8
      return { ok: true, status: 200, text: async () => '1E4C9B93F3F0682250B6CF8331B7EE68FD8:1\n0000000000000000000000000000000000000000:2\n' };
    }
    return { ok: true, status: 200, text: async () => '0000000000000000000000000000000000000000:2\n' };
  });
}
