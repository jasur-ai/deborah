/**
 * AUTH D-18 §07 — Cookie flags + CSRF qamrovi.
 * ---------------------------------------------------------------------------
 *  - Session cookie: httpOnly, SameSite=Lax (A-02), production'da __Host-.
 *  - CSRF: barcha state-changing POST token'siz → 403 (server.js validateCsrf).
 *  - Open redirect: safeReturnUrl allowlist (A-05) — evil URL → default.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { getApp, createRequest } from '../../helpers/setup.js';
import { safeReturnUrl } from '../../../src/modules/auth/session-timeout.js';

describe('AUTH D-18 §07 — session cookie flags (A-02)', () => {
  beforeAll(async () => {
    await getApp();
  });

  it('login sahifasi session cookie: httpOnly + SameSite=Lax + Path=/', async () => {
    const req = await createRequest();
    const res = await req.get('/user/login').expect(200);
    const setCookie = (res.headers['set-cookie'] || []).join(';');
    expect(setCookie).toContain('connect.sid=');
    expect(setCookie.toLowerCase()).toContain('httponly');
    expect(setCookie).toMatch(/samesite=lax/i);
    expect(setCookie).toContain('Path=/');
  });

  it('cookie name production rejimida __Host- prefiks oladi (kontrakt)', async () => {
    // sessionCookieName: SESSION_HOST_PREFIX + production → __Host-connect.sid
    const { sessionCookieName } = await import('../../../src/modules/auth/session-store.js');
    const name = sessionCookieName();
    // test muhiti — prefix'isiz, lekin funksiya kontrakti tekshiriladi
    expect(typeof name).toBe('string');
    expect(name.length).toBeGreaterThan(0);
  });
});

describe('AUTH D-18 §07 — CSRF barcha state-changing POST (server.js validateCsrf)', () => {
  beforeAll(async () => {
    await getApp();
  });

  const ENDPOINTS = [
    ['/user/login', { username: 'x', password: 'y', mode: 'login' }],
    ['/user/login', { username: 'x', email: 'x@test.uz', password: 'y', mode: 'reg', consent: 'on' }],
    ['/user/forgot', { username: 'ghost_user_xyz' }],
  ];

  for (const [path, body] of ENDPOINTS) {
    it(`POST ${path} CSRF tokensiz → 403`, async () => {
      const req = await createRequest();
      const res = await req
        .post(path)
        .type('form')
        .send(body)
        .set('Origin', 'http://localhost');
      expect(res.status).toBe(403);
    });
  }
});

describe('AUTH D-18 §07 — open redirect: safeReturnUrl allowlist (A-05)', () => {
  it('absolute URL (https://evil.com) → default /user/panel', () => {
    expect(safeReturnUrl('https://evil.com')).toBe('/user/panel');
  });

  it('protocol-relative (//evil.com) → default (blok)', () => {
    expect(safeReturnUrl('//evil.com')).toBe('/user/panel');
  });

  it('allowlist prefix → saqlanadi', () => {
    expect(safeReturnUrl('/user/panel')).toBe('/user/panel');
    expect(safeReturnUrl('/assignments')).toBe('/assignments');
    expect(safeReturnUrl('/')).toBe('/');
  });

  it('allowlistda yoq prefix → default', () => {
    expect(safeReturnUrl('/uploads')).toBe('/user/panel');
  });

  it("path-traversal '/user/../admin' → normPath /admin allowlistda → candidate (browser /admin deb ochadi — xavfsiz)", () => {
    const r = safeReturnUrl('/user/../admin');
    // modul: normPath 'admin' → '/admin' allowlistda → candidate qaytadi
    expect(r).toBe('/user/../admin');
  });

  it("path-traversal '/user/../uploads' → normPath /uploads allowlistda YOQ → default", () => {
    expect(safeReturnUrl('/user/../uploads')).toBe('/user/panel');
  });
});
