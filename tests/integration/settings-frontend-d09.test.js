/**
 * AUTH D-09 — Settings frontend render + PATCH kontrakti (server tomoni, wsl qismi)
 * -------------------------------------------------------------------------------
 *  - GET /user/settings (auth): 4 accordion section (aria-expanded/aria-controls),
 *    __SETTINGS_COPY__ + __SETTINGS_PROFILE__, /js/settings.js yuklanishi.
 *  - GET /user/settings (authsiz): 401/redirect — IDOR/himoya.
 *  - PATCH /api/settings/profile: Zod xatosi 400, muvaffaqiyat 200 + audit
 *    `settings:saved`, IDOR yo'q (client body userKey qabul qilinmaydi → strict schema 400).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import supertest from 'supertest';
import { createApp } from '../../server.js';
import { snapshotDb, restoreDb } from '../helpers/setup.js';
import { fb } from '../../firebase/admin.js';

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

/** A-03 register limiteri (5/IP/15min) kesishmasligi uchun har testga alohida IP. */
let ipCounter = 0;
function nextIp() {
  ipCounter += 1;
  return `203.0.113.1${String(ipCounter).padStart(2, '0')}`;
}

/** Yangi user register + login — settings uchun sessiya. */
async function loginAs(username) {
  const ip = nextIp();
  const agent = supertest.agent(app);
  let page = await agent.get('/user/login?lang=uz');
  const csrf = csrfFrom(page.text);
  await agent
    .post('/user/login')
    .set('x-forwarded-for', ip)
    .type('form')
    .send({ mode: 'reg', consent: 'on', _csrf: csrf, username, email: `${username}@test.uz`, password: PASSWORD, lang: 'uz' });
  page = await agent.get('/user/login?lang=uz');
  const csrf2 = csrfFrom(page.text);
  await agent
    .post('/user/login')
    .set('x-forwarded-for', ip)
    .type('form')
    .send({ _csrf: csrf2, username, password: PASSWORD, lang: 'uz' });
  return agent;
}

describe('AUTH D-09 — GET /user/settings', () => {
  it('authsiz → 401 (himoya)', async () => {
    const res = await fetch(`${base}/user/settings`);
    expect([401, 302]).toContain(res.status);
  });

  it('auth bilan → 200: 4 section + aria + settings.js + copy/profile', async () => {
    const agent = await loginAs('d09wsl1');
    const res = await agent.get('/user/settings');
    expect(res.status).toBe(200);
    const html = res.text;
    // 4 accordion section
    for (const id of ['acc-profile', 'acc-security', 'acc-privacy', 'acc-notif']) {
      expect(html).toContain(`id="${id}"`);
    }
    // A11y: aria-expanded + aria-controls
    expect(html).toContain('aria-expanded="true"');
    expect(html).toContain('aria-controls="acc-profile"');
    expect(html).toContain('role="switch"');
    expect(html).toContain('aria-checked');
    // JS + i18n kontrakti
    expect(html).toContain('/js/settings.js');
    expect(html).toContain('window.__SETTINGS_COPY__');
    expect(html).toContain('window.__SETTINGS_PROFILE__');
    // Profil qiymatlari server tomondan keladi
    expect(html).toContain('d09wsl1');
  });
});

describe('AUTH D-09 — PATCH /user/api/settings/profile', () => {
  /** settings sahifasidan CSRF token olish (head.ejs __CSRF_TOKEN). */
  async function csrfOf(agent) {
    const page = await agent.get('/user/settings');
    const m = page.text.match(/window\.__CSRF_TOKEN\s*=\s*'([^']+)'/);
    return m ? m[1] : '';
  }

  it('Zod xatosi (noto\'g\'ri lang) → 400 + fields', async () => {
    const agent = await loginAs('d09wsl2');
    const csrf = await csrfOf(agent);
    const res = await agent.patch('/user/api/settings/profile').set('X-CSRF-Token', csrf).send({ lang: 'fr' });
    expect(res.status).toBe(400);
    expect(res.body.ok).toBe(false);
    expect(res.body.error).toBe('invalid_profile');
  });

  it('IDOR: body\'da userKey kiritilsa → strict schema 400 (qabul qilinmaydi)', async () => {
    const agent = await loginAs('d09wsl3');
    const csrf = await csrfOf(agent);
    const res = await agent.patch('/user/api/settings/profile').set('X-CSRF-Token', csrf).send({ userKey: 'admin', name: 'Hacker' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_profile');
  });

  it('bo\'sh body → 400', async () => {
    const agent = await loginAs('d09wsl4');
    const csrf = await csrfOf(agent);
    const res = await agent.patch('/user/api/settings/profile').set('X-CSRF-Token', csrf).send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('empty_body');
  });

  it('name+lang+theme saqlanadi (nested settings), audit `settings:saved` yoziladi', async () => {
    const agent = await loginAs('d09wsl5');
    const csrf = await csrfOf(agent);
    const res = await agent.patch('/user/api/settings/profile').set('X-CSRF-Token', csrf).send({ name: 'Yangi Ism', lang: 'ru', theme: 'dark' });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.saved.sort()).toEqual(['lang', 'name', 'theme']);

    // Server-side tasdiq: nested settings/lang (literal kalit EMAS)
    const users = await fb.get('users');
    const u = Object.values(users.val() || {}).find((x) => x && x.username === 'd09wsl5');
    expect(u).toBeTruthy();
    expect(u.name).toBe('Yangi Ism');
    expect(u.settings).toEqual({ lang: 'ru', theme: 'dark' });
    expect(u['settings/lang']).toBeUndefined();

    // Audit: settings:saved mavjud (auth_audit/<dayKey>/<key> — dayKey ichida)
    const audit = await fb.get('auth_audit');
    const entries = [];
    if (audit.exists()) {
      for (const day of Object.values(audit.val())) {
        if (day && typeof day === 'object') {
          for (const e of Object.values(day)) {
            if (e && e.action === 'settings:saved') entries.push(e);
          }
        }
      }
    }
    expect(entries.length).toBeGreaterThan(0);
    expect(entries.some((e) => e.actor_id === 'd09wsl5' || (e.detail && e.detail.changed && e.detail.changed.includes('name')))).toBe(true);
  });

  it('idempotent: takroriy PATCH → 200', async () => {
    const agent = await loginAs('d09wsl6');
    const csrf = await csrfOf(agent);
    const r1 = await agent.patch('/user/api/settings/profile').set('X-CSRF-Token', csrf).send({ name: 'Qayta' });
    const r2 = await agent.patch('/user/api/settings/profile').set('X-CSRF-Token', csrf).send({ name: 'Qayta' });
    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);
  });
});
