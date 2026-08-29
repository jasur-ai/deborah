/**
 * AUTH D-08 — Passkey frontend render kontrakti (server tomoni, wsl qismi)
 * -------------------------------------------------------------------------
 *  - GET /user/login: autocomplete="username webauthn" (Conditional UI §09),
 *    /js/passkey-login.js yuklanishi, passkey container data-copy (i18n).
 *  - GET /user/security-profile (auth): passkey-card data-copy passkeySettings,
 *    aria-live (live-region §13), min-height:44px (touch target §13),
 *    /js/passkey-settings.js yuklanishi.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import supertest from 'supertest';
import { createApp } from '../../server.js';
import { snapshotDb, restoreDb } from '../helpers/setup.js';

let app;
let httpServer;
let base;

beforeAll(async () => {
  snapshotDb();
  const created = await createApp();
  app = created.app;
  httpServer = created.httpServer;
  await new Promise((r) => httpServer.listen(0, r));
  base = `http://localhost:${httpServer.address().port}`;
});

afterAll(async () => {
  await new Promise((r) => httpServer.close(r));
  restoreDb();
});

function csrfFrom(html) {
  const m = html.match(/name="_csrf" value="([^"]+)"/);
  return m ? m[1] : null;
}

const PASSWORD = 'parol-2026-x-uzun';

/** YAngi user register + login — security-profile uchun sessiya. */
async function loginAs(username) {
  const agent = supertest.agent(app);
  let page = await agent.get('/user/login?lang=uz');
  const csrf = csrfFrom(page.text);
  await agent
    .post('/user/login')
    .set('x-forwarded-for', '203.0.113.177')
    .type('form')
    .send({ mode: 'reg', consent: 'on', _csrf: csrf, username, email: `${username}@test.uz`, password: PASSWORD, lang: 'uz' });
  page = await agent.get('/user/login?lang=uz');
  const csrf2 = csrfFrom(page.text);
  await agent
    .post('/user/login')
    .set('x-forwarded-for', '203.0.113.177')
    .type('form')
    .send({ _csrf: csrf2, username, password: PASSWORD, lang: 'uz' });
  return agent;
}

describe('AUTH D-08 — login sahifasi (Conditional UI §09)', () => {
  it('GET /user/login — autocomplete="username webauthn" + passkey-login.js + data-copy', async () => {
    const res = await fetch(`${base}/user/login`);
    const html = await res.text();
    expect(res.status).toBe(200);
    // §09: Conditional UI trigger — page-load autocomplete
    expect(html).toContain('autocomplete="username webauthn"');
    expect(html).toContain('id="passkey-login"');
    expect(html).toContain('/js/passkey-login.js');
    expect(html).toContain('/js/device-fingerprint.js');
    // i18n copy: passkeyError login blokidan keladi
    const m = html.match(/id="passkey-login"[\s\S]*?data-copy='([^']*)'/);
    expect(m, 'passkey-login data-copy topilmadi').toBeTruthy();
    const decoded = m[1].replace(/&#39;/g, "'").replace(/&#34;/g, '"');
    const copy = JSON.parse(decoded);
    expect(copy.error).toBeTruthy();
    expect(copy.rate).toBeTruthy();
  });
});

describe('AUTH D-08 — security-profile passkey paneli (§10, §13, §15)', () => {
  it('GET /user/security-profile — passkey-card data-copy + aria-live + 44px + passkey-settings.js', async () => {
    const agent = await loginAs('d08pkuser');
    const res = await agent.get('/user/security-profile');
    const html = res.text;
    expect(res.status).toBe(200);
    // §10: settings paneli
    expect(html).toContain('id="passkey-card"');
    expect(html).toContain('id="passkey-add-btn"');
    expect(html).toContain('id="passkey-reauth-pw"');
    expect(html).toContain('/js/passkey-settings.js');
    // §15: i18n copy — passkeySettings (4 til server'dan keladi)
    const m = html.match(/id="passkey-card"[\s\S]*?data-copy='([^']*)'/);
    expect(m, 'passkey-card data-copy topilmadi').toBeTruthy();
    const decoded = m[1].replace(/&#39;/g, "'").replace(/&#34;/g, '"');
    const pk = JSON.parse(decoded);
    expect(pk.title).toBeTruthy();
    expect(pk.add).toBeTruthy();
    expect(pk.remove).toBeTruthy();
    expect(pk.reauthSubmit).toBeTruthy();
    expect(pk.recoveryNote).toBeTruthy();
    // §13: live-region + touch target
    expect(html).toMatch(/id="passkey-list"[^>]*role="status"[^>]*aria-live="polite"/);
    expect(html).toContain('min-height:44px');
    expect(html).toContain('role="alert"');
  });

  it('i18n: en tili — passkeySettings inglizcha render qilinadi', async () => {
    const agent = supertest.agent(app);
    const page = await agent.get('/user/login?lang=en');
    const csrf = csrfFrom(page.text);
    const uname = 'd08enuser';
    await agent
      .post('/user/login')
      .set('x-forwarded-for', '203.0.113.178')
      .type('form')
      .send({ mode: 'reg', consent: 'on', _csrf: csrf, username: uname, email: `${uname}@test.uz`, password: PASSWORD, lang: 'en' });
    const page2 = await agent.get('/user/login?lang=en');
    const csrf2 = csrfFrom(page2.text);
    await agent
      .post('/user/login')
      .set('x-forwarded-for', '203.0.113.178')
      .type('form')
      .send({ _csrf: csrf2, username: uname, password: PASSWORD, lang: 'en' });
    const res = await agent.get('/user/security-profile');
    const html = res.text;
    expect(res.status).toBe(200);
    const m = html.match(/id="passkey-card"[\s\S]*?data-copy='([^']*)'/);
    expect(m).toBeTruthy();
    const pk = JSON.parse(m[1].replace(/&#39;/g, "'").replace(/&#34;/g, '"'));
    expect(pk.title).toContain('Passkeys');
    expect(pk.recoveryNote).toContain('lose');
  });
});
