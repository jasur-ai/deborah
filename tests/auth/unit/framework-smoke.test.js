/**
 * AUTH D-14 §16 — Unit framework smoke: helper'lar ishlaydi.
 * ---------------------------------------------------------------------------
 * Mock provider'lar markaziy tests/helpers/mock-providers.js da —
 * bu test ularning import/ishlashini tasdiqlaydi (yangi D-15 testlar
 * shu helper'larni qayta ishlatadi).
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import crypto from 'node:crypto';
import {
  makeGoogleJwks,
  signGoogleIdToken,
  MOCK_EMAIL_OPTION,
  spyRandomInt,
  mockTurnstileFetch,
  makeHibpFetch,
} from '../../helpers/mock-providers.js';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('AUTH D-14 §16 — mock provider helper lar ishlaydi', () => {
  it('Google OIDC: JWKS + ID token sign → verify uchun tayyor', async () => {
    const { jwks, privateKey } = await makeGoogleJwks();
    const idToken = await signGoogleIdToken({ privateKey, nonce: 'n1' });
    expect(typeof idToken).toBe('string');
    expect(idToken.split('.')).toHaveLength(3); // JWT: header.payload.signature
    expect(jwks).toBeTruthy();
  });

  it('Google OIDC: expired token yaratish mumkin (muddat tekshiruvi uchun)', async () => {
    const { privateKey } = await makeGoogleJwks();
    const expired = await signGoogleIdToken({ privateKey, expiresIn: 'expired' });
    const payload = JSON.parse(Buffer.from(expired.split('.')[1], 'base64url').toString());
    expect(payload.exp).toBeLessThan(Math.floor(Date.now() / 1000));
  });

  it('Email: mock transport kontrakti', () => {
    expect(MOCK_EMAIL_OPTION.provider).toBe('mock');
  });

  it('Telegram: crypto.randomInt deterministik kod beradi', () => {
    spyRandomInt([111111, 222222]);
    expect(crypto.randomInt(0, 1000000)).toBe(111111);
    expect(crypto.randomInt(0, 1000000)).toBe(222222);
  });

  it('Turnstile: siteverify fetch mock success', async () => {
    const fetchMock = mockTurnstileFetch({ ok: true });
    const r = await fetchMock('https://challenges.cloudflare.com/turnstile/v0/siteverify');
    const body = await r.json();
    expect(body.success).toBe(true);
  });

  it('HIBP: breached javob — SUFFIX:COUNT qatorlari (k-anonymity)', async () => {
    const fetchMock = makeHibpFetch({ breached: true });
    const r = await fetchMock('https://api.pwnedpasswords.com/range/ABC');
    const text = await r.text();
    // 'password' SHA-1 = 5BAA61E4... → suffix = 1E4C9B93F3F0682250B6CF8331B7EE68FD8
    expect(text).toMatch(/1E4C9B93F3F0682250B6CF8331B7EE68FD8:1/);
  });

  it('HIBP: toza javob — hash topilmaydi', async () => {
    const fetchMock = makeHibpFetch({ breached: false });
    const r = await fetchMock('https://api.pwnedpasswords.com/range/ABC');
    const text = await r.text();
    expect(text).not.toMatch(/5BAA61E4C9B93F3F0682250B6CF8331B7EE68FD8/);
  });
});
