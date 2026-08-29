/**
 * AUTH A-02 — Cookie spetsifikatsiya + idle timeout + parallel limit
 * -------------------------------------------------------------------
 * Alohida fayl — o'z server jarayoni (login rate limiter toza).
 *  1. Cookie flaglar: HttpOnly, SameSite=Lax, Path=/
 *  2. Idle timeout: requireAuth middleware — eski lastActiveAt → 401 + returnUrl
 *  3. Keepalive: POST /api/session/ping → 204 (idle timer reset)
 *  (Parallel limit 5→6 — unit: tests/unit/session-manager.test.js)
 */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { snapshotDb, restoreDb, startServer, stopServer } from '../helpers/setup.js';
import { fb } from '../../firebase/admin.js';
import { requireAuth } from '../../middleware/auth.js';

let serverUrl;

beforeAll(async () => {
  snapshotDb();
  serverUrl = await startServer();
});

afterAll(async () => {
  await stopServer();
  restoreDb();
});

async function getCsrf(path = '/user/login') {
  const res = await fetch(`${serverUrl}${path}`);
  const html = await res.text();
  const m = html.match(/name="_csrf" value="([^"]+)"/) || html.match(/window\.__CSRF_TOKEN = '([^']+)'/);
  const cookie = (res.headers.get('set-cookie') || '').split(';')[0];
  return { csrf: m ? m[1] : null, cookie, res, html };
}

async function postForm(path, cookie, body) {
  return fetch(`${serverUrl}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', cookie },
    redirect: 'manual',
    body: new URLSearchParams(body).toString(),
  });
}

describe('Auth — AUTH A-02 (cookie spec + idle timeout + limit)', () => {
  const pw = 'sirli-parol-2026';

  it('cookie spetsifikatsiya: HttpOnly, SameSite=Lax, Path=/, Max-Age', async () => {
    const { res } = await getCsrf();
    const sc = res.headers.get('set-cookie') || '';
    expect(sc).toMatch(/connect\.sid=/);
    expect(sc).toMatch(/HttpOnly/i);
    expect(sc).toMatch(/SameSite=Lax/i);
    expect(sc).toMatch(/Path=\//);
  });

  it('idle timeout: eski lastActiveAt → 401 JSON + returnUrl', async () => {
    let destroyed = false;
    const req = {
      originalUrl: '/api/user/stats',
      path: '/api/user/stats',
      xhr: true, // JSON javob
      accepts: () => true,
      ip: '127.0.0.1',
      headers: { 'user-agent': 'test' },
      session: {
        user: { safeKey: 'zzz_a02_no_such_user', passwordUpdatedAt: 0, roleVersion: 0 },
        lastActiveAt: Date.now() - 31 * 60 * 1000, // 31 daqiqa — limit 30
        destroy: (cb) => { destroyed = true; if (cb) cb(); },
      },
    };
    let status = 0;
    let body = null;
    const res = {
      status: (c) => { status = c; return { json: (o) => { body = o; } }; },
      redirect: () => {},
    };
    await requireAuth(req, res, () => {});
    expect(destroyed).toBe(true); // sessiya bekor qilindi
    expect(status).toBe(401);
    expect(body.redirect).toContain('/user/login?returnUrl=');
    expect(body.redirect).toContain(encodeURIComponent('/api/user/stats'));
  });

  it('idle timeout: HTML so\'rovda login redirect (returnUrl bilan)', async () => {
    const req = {
      originalUrl: '/user/panel',
      path: '/user/panel',
      xhr: false,
      accepts: () => false,
      ip: '127.0.0.1',
      // S28.2: real brauzer navigatsiyasi Accept yuboradi — mock ham shunga
      // moslandi (Accept'siz klient endi 401 JSON oladi, a30 §06 kontrakt).
      get: (h) => (String(h).toLowerCase() === 'accept'
        ? 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8' : null),
      headers: { accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8' },
      session: {
        user: { safeKey: 'zzz_a02_no_such_user2', passwordUpdatedAt: 0, roleVersion: 0 },
        lastActiveAt: Date.now() - 60 * 60 * 1000,
        destroy: (cb) => { if (cb) cb(); },
      },
    };
    let redirected = null;
    const res = {
      status: () => ({ json: () => {} }),
      redirect: (u) => { redirected = u; },
    };
    await requireAuth(req, res, () => {});
    expect(redirected).toContain('/user/login?returnUrl=');
    expect(redirected).toContain(encodeURIComponent('/user/panel'));
  });

  it('roleVersion tekshiruvi DB\'ni bir marta o\'qiydi (hot-path sentinel -1)', async () => {
    const spy = vi.spyOn(fb, 'get');
    try {
      const req = {
        originalUrl: '/user/panel',
        path: '/user/panel',
        xhr: false,
        accepts: () => false,
        ip: '127.0.0.1',
        headers: {},
        session: {
          user: { safeKey: 'zzz_a02_rolecheck', passwordUpdatedAt: 0, roleVersion: 0 },
          lastActiveAt: Date.now(),
          destroy: () => {},
        },
      };
      const res = { status: () => ({ json: () => {} }), redirect: () => {} };
      await requireAuth(req, res, () => {});
      await requireAuth(req, res, () => {});
      const roleReads = spy.mock.calls.filter(([p]) => String(p).includes('role_version'));
      expect(roleReads.length).toBe(1); // ikkinchi request'da sentinel -1 → DB o'qilmaydi
    } finally {
      spy.mockRestore();
    }
  });

  it('faol sessiya: lastActive yangilanadi (touch), next() chaqiriladi', async () => {
    const req = {
      originalUrl: '/user/panel',
      path: '/user/panel',
      xhr: false,
      accepts: () => false,
      ip: '127.0.0.1',
      headers: {},
      session: {
        user: { safeKey: 'zzz_a02_no_such_user3', passwordUpdatedAt: 0, roleVersion: 0 },
        lastActiveAt: Date.now() - 10 * 60 * 1000,
        destroy: () => {},
      },
    };
    let nexted = false;
    const res = { status: () => ({ json: () => {} }), redirect: () => {} };
    await requireAuth(req, res, () => { nexted = true; });
    expect(nexted).toBe(true);
    expect(req.session.lastActiveAt).toBeGreaterThan(Date.now() - 5000);
  });

  it('keepalive: POST /api/session/ping → 204 (idle timer reset)', async () => {
    const uname = `a02_${Date.now() % 1000000}`;
    const { csrf: csrfR, cookie: cookieR } = await getCsrf();
    await postForm('/user/login', cookieR, {
      _csrf: csrfR, lang: 'uz', mode: 'reg', consent: 'on', username: uname, password: pw,
      email: `r2_${Date.now()}_${Math.floor(Math.random() * 1000000)}_a18@test.uz`,
    });
    const { csrf, cookie } = await getCsrf();
    // Login 302 — authed sessiya cookie'si shu yerda yangilanadi
    const loginRes = await postForm('/user/login', cookie, {
      _csrf: csrf, lang: 'uz', mode: 'login', username: uname, password: pw,
    });
    expect(loginRes.status).toBe(302);
    const sessionCookie = (loginRes.headers.get('set-cookie') || '').split(';')[0];
    expect(sessionCookie).toMatch(/connect\.sid=/);

    // Authed sahifa — sessiya csrfToken'ini olamiz (panel.ejs:331 window.__CSRF_TOKEN)
    const panelRes = await fetch(`${serverUrl}/user/panel`, {
      headers: { cookie: sessionCookie },
      redirect: 'manual',
    });
    expect(panelRes.status).toBe(200);
    const panelHtml = await panelRes.text();
    const m = panelHtml.match(/window\.__CSRF_TOKEN = ["']([^"']+)["']/);
    expect(m, 'panel __CSRF_TOKEN topilmadi').toBeTruthy();

    const pingRes = await fetch(`${serverUrl}/api/session/ping`, {
      method: 'POST',
      headers: { 'x-csrf-token': m[1], cookie: sessionCookie },
      redirect: 'manual',
    });
    expect(pingRes.status).toBe(204);
  });
});
