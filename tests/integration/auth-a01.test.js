/**
 * AUTH A-01 — Redis session foundation: remember TTL + session record
 * -------------------------------------------------------------------
 * Alohida fayl — o'z server jarayonini boshlaydi (login rate limiter toza).
 * Store-agnostic: MemoryStore/Redis bilan ham ishlaydi.
 * Eslatma: express-session v1.19 Max-Age emas, faqat Expires emit qiladi.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { snapshotDb, restoreDb, startServer, stopServer } from '../helpers/setup.js';
import { fb } from '../../firebase/admin.js';
import { safeKey } from '../../utils/helpers.js';

let serverUrl;

beforeAll(async () => {
  snapshotDb();
  serverUrl = await startServer();
});

afterAll(async () => {
  await stopServer();
  restoreDb();
});

/** CSRF token + cookie'ni olish (sessiya bilan bog'langan). */
async function getCsrf(path = '/user/login') {
  const res = await fetch(`${serverUrl}${path}`);
  const html = await res.text();
  const m = html.match(/name="_csrf" value="([^"]+)"/);
  const cookie = (res.headers.get('set-cookie') || '').split(';')[0];
  return { csrf: m ? m[1] : null, cookie, res };
}

/** CSRF'li POST — cookie + body bilan. */
async function postForm(path, cookie, body) {
  return fetch(`${serverUrl}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      cookie,
    },
    redirect: 'manual',
    body: new URLSearchParams(body).toString(),
  });
}

describe('Auth — AUTH A-01 (remember TTL + session record)', () => {
  const pw = 'sirli-parol-2026';

  async function registerAndLogin(remember) {
    const uname = `a01_${Date.now() % 1000000}`;
    const { csrf: csrfR, cookie: cookieR } = await getCsrf();
    await postForm('/user/login', cookieR, {
      _csrf: csrfR, lang: 'uz', mode: 'reg', consent: 'on', username: uname, password: pw,
      email: `r1_${Date.now()}_${Math.floor(Math.random() * 1000000)}_a18@test.uz`,
    });
    const { csrf, cookie } = await getCsrf();
    const body = {
      _csrf: csrf, lang: 'uz', mode: 'login', username: uname, password: pw,
    };
    if (remember) body.remember = 'on';
    const res = await postForm('/user/login', cookie, body);
    const sc = res.headers.get('set-cookie') || '';
    return { res, sc, uname };
  }

  /** Set-Cookie'dagi Expires`gacha qolgan vaqt (ms) */
  function expiresIn(sc) {
    const m = sc.match(/Expires=([^;]+)/);
    expect(m, `Expires yo'q: ${sc.slice(0, 80)}`).toBeTruthy();
    return new Date(m[1]).getTime() - Date.now();
  }

  it('remember=on → cookie Expires ~30 kun', async () => {
    const { res, sc } = await registerAndLogin(true);
    expect(res.status).toBe(302);
    expect(sc).toMatch(/connect\.sid=/);
    const delta = expiresIn(sc);
    expect(delta).toBeGreaterThan(29 * 24 * 60 * 60 * 1000);
    expect(delta).toBeLessThan(31 * 24 * 60 * 60 * 1000);
  });

  it("remember yo'q → cookie Expires ~8 soat", async () => {
    const { res, sc } = await registerAndLogin(false);
    expect(res.status).toBe(302);
    expect(sc).toMatch(/connect\.sid=/);
    const delta = expiresIn(sc);
    expect(delta).toBeGreaterThan(7.5 * 60 * 60 * 1000);
    expect(delta).toBeLessThan(8.5 * 60 * 60 * 1000);
  });

  it('session record: remember, expiresAt, ipHash (PII minimal) yoziladi', async () => {
    const { res, sc, uname } = await registerAndLogin(true);
    expect(res.status).toBe(302);
    // Cookie URL-encoded: s%3A<sid>.signature
    const rawSid = (sc.match(/connect\.sid=s%3A([^.]+)/) || [])[1];
    expect(rawSid).toMatch(/^[0-9a-f]{64}$/);
    // recordSession fire-and-forget (route non-critical) — yozilishini kutaveramiz
    let entry;
    for (let i = 0; i < 20 && !entry; i++) {
      const snap = await fb.get(`sessions/${safeKey(uname)}`);
      const rec = snap.exists() ? snap.val() : {};
      entry = Object.values(rec).find((s) => s.sessionId === rawSid);
      if (!entry) await new Promise((r) => setTimeout(r, 75));
    }
    expect(entry).toBeTruthy();
    expect(entry.remember).toBe(true);
    expect(entry.authMethod).toBe('password');
    expect(entry.expiresAt).toBeGreaterThan(Date.now());
    expect(entry.expiresAt - entry.createdAt).toBe(30 * 24 * 60 * 60 * 1000);
    expect(entry.ipHash).toMatch(/^[0-9a-f]{64}$/);
  });
});
