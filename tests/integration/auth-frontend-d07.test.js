/**
 * AUTH D-07 — Login frontend render kontrakti (server tomoni)
 * -------------------------------------------------------------
 * Server-rendered login sahifasi invariantlari:
 *   - CSRF hidden input, inline error containerlar, lockout box,
 *     aria-live, auth.js yuklanishi
 *   - XSS: prevUsername to'liq escape qilinadi (inline JS chiqmaydi)
 *   - Xato login → #auth-alert.err + field-level markup (enumeration-safe)
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { snapshotDb, restoreDb, startServer, stopServer } from '../helpers/setup.js';

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

describe('AUTH D-07 — login frontend render kontrakti', () => {
  it('GET /user/login — CSRF, inline error, lockout, aria-live, auth.js mavjud', async () => {
    const res = await fetch(`${serverUrl}/user/login`);
    const html = await res.text();
    expect(res.status).toBe(200);
    expect(html).toContain('name="_csrf"');
    expect(html).toContain('id="form-login"');
    expect(html).toContain('id="lockout-countdown"');
    expect(html).toContain('data-inline-error="login-username"');
    expect(html).toContain('data-inline-error="login-password"');
    expect(html).toContain('aria-live="assertive"');
    expect(html).toContain('/js/auth.js');
    // D-07: inline lockout dublikat script olib tashlangan (auth.js bajaradi)
    expect(html).not.toContain('var total = parseInt');
  });

  it('data-copy EJS-escape: apostrof &#39; sifatida render, JSON.parse ishlaydi', async () => {
    const res = await fetch(`${serverUrl}/user/login`);
    const html = await res.text();
    // login.ejs: data-copy='<%= JSON.stringify({locked, support}) %>' — EJS '<%='
    // HTML-escape qiladi; browser attribute'ni dekodlab beradi. Raw regex entity
    // holida qaytaradi, shuning uchun qo'lda dekodlab JSON.parse tekshiramiz.
    // lockout box'ining data-copy'sini olamiz (passkey bloki ham data-copy
    // ishlatadi — shuning uchun id="lockout-countdown" bilan boshlaymiz)
    const m = html.match(/id="lockout-countdown"[\s\S]*?data-copy='([^']*)'/);
    expect(m, `lockout data-copy topilmadi`).toBeTruthy();
    const decoded = m[1].replace(/&#39;/g, "'").replace(/&#34;/g, '"');
    const copy = JSON.parse(decoded);
    expect(copy.locked).toContain('bloklandi');
    expect(copy.support).toContain('support');
  });

  it('XSS: prevUsername escape qilinadi — inline <script> chiqmaydi', async () => {
    const { csrf, cookie } = await getCsrf();
    const res = await postForm('/user/login', cookie, {
      _csrf: csrf, lang: 'uz', mode: 'login',
      username: '<script>alert(1)</script>',
      password: 'not-the-right-pw',
    });
    const html = await res.text();
    expect(res.status).toBe(200);
    expect(html).not.toContain('<script>alert(1)');
    expect(html).toContain('&lt;script&gt;alert(1)');
  });

  it('Xato login → #auth-alert.err + field-level markup (enumeration-safe)', async () => {
    const { csrf, cookie } = await getCsrf();
    const res = await postForm('/user/login', cookie, {
      _csrf: csrf, lang: 'uz', mode: 'login',
      username: 'no_such_user_d07',
      password: 'wrong-pass-123',
    });
    const html = await res.text();
    expect(res.status).toBe(200);
    expect(html).toMatch(/id="auth-alert"[^>]*class="msg err"/);
    expect(html).toMatch(/data-field="(both|username|password)"/);
  });
});
