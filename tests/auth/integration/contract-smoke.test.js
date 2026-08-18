/**
 * AUTH D-14 §17 — Integration/contract smoke: supertest setup ishlaydi.
 * ---------------------------------------------------------------------------
 * tests/helpers/setup.js (getApp + createRequest) — shared app + DB izolyatsiya.
 * Bu test auth kontraktining asosiy endpointlarini tekshiradi.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getApp, createRequest } from '../../helpers/setup.js';

describe('AUTH D-14 §17 — integration contract smoke', () => {
  beforeAll(async () => {
    await getApp();
  });

  it('GET /user/login → 200 + CSRF token + lang', async () => {
    const req = await createRequest();
    const res = await req.get('/user/login').expect(200);
    expect(res.text).toContain('login-username');
    expect(res.text).toContain('_csrf');
    expect(res.text).toContain('lang');
  });

  it('GET /user/register → 200 (alohida register sahifasi)', async () => {
    const req = await createRequest();
    const res = await req.get('/user/register').expect(200);
    expect(res.text).toContain('reg-username');
    expect(res.text).toContain('reg-email');
  });

  it('GET /admin/login → 200', async () => {
    const req = await createRequest();
    const res = await req.get('/admin/login').expect(200);
    expect(res.status).toBe(200);
  });

  it('authsiz /user/settings → redirect (401 → login)', async () => {
    const req = await createRequest();
    const res = await req.get('/user/settings');
    expect([302, 401]).toContain(res.status);
  });
});
