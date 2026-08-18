/**
 * AUTH D-10 — Admin frontend kontrakti (server tomoni, wsl qismi)
 * -----------------------------------------------------------------
 *  - Non-admin blok: /admin/users|audit|teachers → redirect /admin/login.
 *  - Admin: sahifalar 200 + `window.__ADMIN_COPY__` (4 til admin copy kontrakti).
 *  - CSV eksport formula-injection himoyasi (§26): `=`/`+`/`-`/`@` bilan
 *    boshlanadigan hujayra `'` prefiks bilan chiqadi (OWASP / ODF 1.2).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import supertest from 'supertest';
import { createApp } from '../../server.js';
import { snapshotDb, restoreDb } from '../helpers/setup.js';
import { fb } from '../../firebase/admin.js';

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

/** Admin sessiyasi — testadmin/testpass (vitest.config env). */
async function adminAgent() {
  const agent = supertest.agent(app);
  const page = await agent.get('/admin/login');
  const csrf = csrfFrom(page.text);
  await agent
    .post('/admin/login')
    .type('form')
    .send({ _csrf: csrf, username: ADMIN_USER, password: ADMIN_PASS });
  return agent;
}

describe('AUTH D-10 — non-admin blok', () => {
  it('oddiy user /admin/users → redirect /admin/login (stop condition §23)', async () => {
    const res = await supertest(app).get('/admin/users');
    expect([302, 401]).toContain(res.status);
    if (res.status === 302) expect(res.headers.location).toContain('/admin/login');
  });
});

describe('AUTH D-10 — admin sahifalar + __ADMIN_COPY__', () => {
  it('GET /admin/users|audit|teachers → 200 + __ADMIN_COPY__', async () => {
    const agent = await adminAgent();
    for (const path of ['/admin/users', '/admin/audit', '/admin/teachers']) {
      const res = await agent.get(path);
      expect(res.status, path).toBe(200);
      expect(res.text, path).toContain('window.__ADMIN_COPY__');
      // users/audit tashqi JS, teachers inline script (fayl yo'q)
      if (path !== '/admin/teachers') expect(res.text, path).toContain('/js/admin/');
    }
  });
});

describe('AUTH D-10 — CSV eksport formula-injection himoyasi (§26)', () => {
  it('`=` bilan boshlanadigan qiymat `\'` prefiks bilan chiqadi', async () => {
    // Xavfli actor_id — Excel formula sifatida ishga tushishi mumkin edi.
    const { logAuthEvent, AUDIT_ACTIONS } = await import('../../src/modules/auth/audit.js');
    await logAuthEvent({
      action: AUDIT_ACTIONS.USER_LOGIN,
      outcome: 'success',
      method: 'password',
      actorId: '=HYPERLINK("http://evil.uz")',
      ipAddress: '203.0.113.201',
      userAgent: 'd10-test',
      details: {},
    });
    // O'qilganini kafolatlash (listAuthAudit 30 kun oynasi ichida)
    const audit = await fb.get('auth_audit');
    let found = 0;
    if (audit.exists()) {
      for (const day of Object.values(audit.val())) {
        if (day && typeof day === 'object') {
          for (const e of Object.values(day)) {
            if (e && e.actor_id && String(e.actor_id).startsWith('=')) found++;
          }
        }
      }
    }
    expect(found).toBeGreaterThan(0);

    const agent = await adminAgent();
    const res = await agent.get('/admin/api/audit/export');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
    // Formula-injection: `=` boshida → `'=` prefiks (matn sifatida ochiladi)
    expect(res.text).toContain("'=HYPERLINK(");
    // Xom `=HYPERLINK` formula shaklida EMMAS (sarlavha qatori emas)
    expect(res.text).not.toMatch(/,"=HYPERLINK\(/);
  });

  it('`+`/`-`/`@` va bo\'shliq bilan boshlangan qiymatlar ham himoyalanadi', async () => {
    const { logAuthEvent, AUDIT_ACTIONS } = await import('../../src/modules/auth/audit.js');
    for (const evil of ['+SUM(1,1)', '-2+3', '@cmd', ' =1+1']) {
      await logAuthEvent({
        action: AUDIT_ACTIONS.USER_LOGIN,
        outcome: 'failed',
        method: 'password',
        actorId: evil,
        ipAddress: '203.0.113.202',
        userAgent: 'd10-test',
        details: {},
      });
    }
    const agent = await adminAgent();
    const res = await agent.get('/admin/api/audit/export');
    expect(res.status).toBe(200);
    // Seed qilingan qiymatlar: `'` prefiks bilan chiqishi kafolat (xom emas)
    for (const evil of ['+SUM(1,1)', '-2+3', '@cmd', ' =1+1']) {
      expect(res.text).toContain(`'${evil}`);
    }
    // Xom (himoyasiz) ko'rinish YO'Q
    expect(res.text).not.toContain('"+SUM(1,1)"');
    expect(res.text).not.toContain('"@cmd"');
  });
});
