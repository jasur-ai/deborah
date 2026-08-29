/**
 * AUTH D-14 §18 — Security guards: CSRF + OIDC replay.
 * ---------------------------------------------------------------------------
 * - CSRF: barcha state-changing POST'lar uchun server.js validateCsrf —
 *   token'siz POST → 403.
 * - OIDC replay: nonce callback himoyasi — mock-providers helper ishlatilib,
 *   real RS256 token sign + verify (helper'ning ishlashini isbotlaydi).
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getApp, createRequest, snapshotDb, restoreDb } from '../../helpers/setup.js';
import { makeGoogleJwks, signGoogleIdToken } from '../../helpers/mock-providers.js';

const CONFIG = {
  GOOGLE_CLIENT_ID: 'test-client-123.apps.googleusercontent.com',
};

describe('AUTH D-14 §18 — CSRF guard', () => {
  beforeAll(async () => {
    snapshotDb();
    await getApp();
  });

  afterAll(() => {
    restoreDb();
  });

  it('POST /user/login CSRF tokensiz → 403 (validateCsrf)', async () => {
    const req = await createRequest();
    const res = await req
      .post('/user/login')
      .type('form')
      .send({ username: 'testuser', password: 'wrongpass', mode: 'login' })
      .set('Origin', 'http://localhost');
    expect(res.status).toBe(403);
  });

  it('GET /user/login CSRF token render qiladi (formda hidden)', async () => {
    const req = await createRequest();
    const res = await req.get('/user/login').expect(200);
    expect(res.text).toMatch(/name="_csrf"/);
    // token 64 hex (32 bayt)
    const m = res.text.match(/name="_csrf" value="([0-9a-f]{64})"/);
    expect(m).toBeTruthy();
  });
});

describe('AUTH D-14 §18 — OIDC nonce replay himoyasi', () => {
  it('nonce mismatch → verify reject (null)', async () => {
    const { jwks, privateKey } = await makeGoogleJwks();
    const idToken = await signGoogleIdToken({ privateKey, nonce: 'nonce-1' });
    const oidc = await import('../../../src/modules/auth/oidc.js');
    const user = await oidc.verifyGoogleIdToken(idToken, 'WRONG-nonce', {
      jwks,
      audience: CONFIG.GOOGLE_CLIENT_ID,
    });
    expect(user).toBeNull();
  });

  it("nonce to'g'ri → verify qabul qiladi (replay emas)", async () => {
    const { jwks, privateKey } = await makeGoogleJwks();
    const idToken = await signGoogleIdToken({ privateKey, nonce: 'nonce-1', email: 'user@test.uz' });
    const oidc = await import('../../../src/modules/auth/oidc.js');
    const user = await oidc.verifyGoogleIdToken(idToken, 'nonce-1', {
      jwks,
      audience: CONFIG.GOOGLE_CLIENT_ID,
    });
    expect(user).not.toBeNull();
    expect(user.email).toBe('user@test.uz');
  });

  it('expired token → verify reject', async () => {
    const { jwks, privateKey } = await makeGoogleJwks();
    const idToken = await signGoogleIdToken({ privateKey, nonce: 'n1', expiresIn: 'expired' });
    const oidc = await import('../../../src/modules/auth/oidc.js');
    const user = await oidc.verifyGoogleIdToken(idToken, 'n1', {
      jwks,
      audience: CONFIG.GOOGLE_CLIENT_ID,
    });
    expect(user).toBeNull();
  });
});
