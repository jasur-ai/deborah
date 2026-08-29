/**
 * AUTH D-11 — i18n to'liq: locale persist + BCP-47 lang attr + switcher (wsl qismi)
 * ---------------------------------------------------------------------------------
 *  - §09: `?lang=` → cookie SET (endi faqat o'qilmas, yoziladi ham); keyingi
 *    tashrif cookie orqali bir xil tilda ochiladi.
 *  - §13: `<html lang>` BCP-47 to'g'ri — uz-cyrl → `uz-Cyrl` (uz-Latn → `uz`).
 *  - §14: switcher native nomlar (O'zbekcha, Ўзбекча, Русский, English).
 *  - D-10: admin dashboard KPI/sidebar i18n fallback (adminCopy || hardcoded).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import supertest from 'supertest';
import { createApp } from '../../server.js';
import { snapshotDb, restoreDb } from '../helpers/setup.js';

let app;
let httpServer;

beforeAll(async () => {
  snapshotDb();
  const created = await createApp();
  app = created.app;
  httpServer = created.httpServer;
  await new Promise((r) => httpServer.listen(0, r));
});

afterAll(async () => {
  await new Promise((r) => httpServer.close(r));
  restoreDb();
});

const ADMIN_USER = 'testadmin';
const ADMIN_PASS = 'testpass';

function csrfFrom(html) {
  const m = html.match(/name="_csrf"\s+value="([^"]+)"/) || html.match(/window\.__CSRF_TOKEN = '([^']+)'/);
  return m ? m[1] : '';
}

describe('AUTH D-11 — locale persist (§09)', () => {
  it('?lang=uz-cyrl → Set-Cookie lang; keyingi tashrif cookie bilan ochiladi', async () => {
    const agent = supertest.agent(app);
    // Switcher orqali uz-cyrl tanlash
    const r1 = await agent.get('/user/login?lang=uz-cyrl');
    expect(r1.status).toBe(200);
    const setCookie = r1.headers['set-cookie'] || [];
    const langCookie = setCookie.find((c) => c.startsWith('lang='));
    expect(langCookie).toBeTruthy();
    expect(langCookie).toContain('uz-cyrl');

    // Keyingi tashrif — query'siz, cookie yetarli (server resolveAuthLang(req.cookies.lang))
    const r2 = await agent.get('/user/login');
    expect(r2.status).toBe(200);
    expect(r2.text).toContain('lang="uz-Cyrl"');
    // Kirish sahifasi copy uz-cyrl variantida
    expect(r2.text).toContain('Ўзбекча');
  });

  it('noto\'g\'ri ?lang qiymati cookie\'ga yozilmaydi (whitelist)', async () => {
    const agent = supertest.agent(app);
    const r = await agent.get('/user/login?lang=xx-hack');
    const setCookie = r.headers['set-cookie'] || [];
    expect(setCookie.some((c) => c.startsWith('lang='))).toBe(false);
  });
});

describe('AUTH D-11 — BCP-47 lang attr (§13)', () => {
  it('login: uz → lang="uz", uz-cyrl → lang="uz-Cyrl", ru → lang="ru", en → lang="en"', async () => {
    const cases = [
      ['uz', 'lang="uz"'],
      ['uz-cyrl', 'lang="uz-Cyrl"'],
      ['ru', 'lang="ru"'],
      ['en', 'lang="en"'],
    ];
    for (const [q, expected] of cases) {
      const res = await fetch(`http://localhost:${httpServer.address().port}/user/login?lang=${q}`);
      const html = await res.text();
      expect(html, q).toContain(expected);
    }
  });

  it('register: uz-cyrl → lang="uz-Cyrl"', async () => {
    const res = await fetch(`http://localhost:${httpServer.address().port}/user/register?lang=uz-cyrl`);
    expect(await res.text()).toContain('lang="uz-Cyrl"');
  });
});

describe('AUTH D-11 — switcher native nomlar (§14)', () => {
  it('login: O\'zbekcha / Ўзбекча / Русский / English (native, flag emas)', async () => {
    const res = await fetch(`http://localhost:${httpServer.address().port}/user/login`);
    const html = await res.text();
    // EJS `<%=` apostrofni &#39; qilib escape qiladi (browser dekodlaydi)
    expect(html).toContain('O&#39;zbekcha');
    for (const name of ['Ўзбекча', 'Русский', 'English']) {
      expect(html).toContain(name);
    }
    // hreflang BCP-47 (switcher link)
    expect(html).toContain('hreflang="uz-Cyrl"');
  });
});

describe('AUTH D-11 — admin dashboard i18n fallback (D-10 kontrakti)', () => {
  it('admin dashboard: KPI/sidebar adminCopy bilan render (fallback yoki kalit)', async () => {
    const agent = supertest.agent(app);
    const page = await agent.get('/admin/login');
    const csrf = csrfFrom(page.text);
    await agent
      .post('/admin/login')
      .type('form')
      .send({ _csrf: csrf, username: ADMIN_USER, password: ADMIN_PASS });
    const res = await agent.get('/admin/dashboard?lang=en');
    expect(res.status).toBe(200);
    expect(res.text).toContain('window.__ADMIN_COPY__');
    // KPI label fallback ishlaydi — render buzilmaydi
    expect(res.text).toContain('stat-lbl');
    expect(res.text).not.toContain('<%=');
  });
});
