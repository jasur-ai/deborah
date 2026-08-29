/**
 * AUTH D-32 §26 — Email cost dashboard (admin UI) integration testi.
 * -----------------------------------------------------------------
 *  - Non-admin /admin/email-cost → redirect /admin/login (stop §23).
 *  - Admin: sahifa 200 + "Email xarajat" + budget holati ko'rinadi.
 *  - email_cost/{YYYY-MM}/{provider} yozuvlari jadvalda aks etadi.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import supertest from 'supertest';
import { createApp } from '../../../server.js';
import { snapshotDb, restoreDb } from '../../helpers/setup.js';
import { fb } from '../../../firebase/admin.js';

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

describe('AUTH D-32 §26 — email cost dashboard', () => {
  it('1) non-admin /admin/email-cost → redirect /admin/login', async () => {
    const res = await supertest(app).get('/admin/email-cost');
    expect([302, 401]).toContain(res.status);
    if (res.status === 302) expect(res.headers.location).toContain('/admin/login');
  });

  it('2) admin /admin/email-cost → 200 + sahifa kontrakti', async () => {
    const agent = await adminAgent();
    const res = await agent.get('/admin/email-cost');
    expect(res.status).toBe(200);
    expect(res.text).toContain('Email xarajat');
    expect(res.text).toContain('Joriy oy');
    expect(res.text).toContain('Budget holati');
  });

  it('3) email_cost yozuvlari jadvalda ko\u2018rinadi', async () => {
    const month = new Date().toISOString().slice(0, 7);
    await fb.set(`email_cost/${month}/mock`, { cost: 1.25, count: 5, updatedAt: Date.now() });
    const agent = await adminAgent();
    const res = await agent.get('/admin/email-cost');
    expect(res.status).toBe(200);
    expect(res.text).toContain(month);
    expect(res.text).toContain('mock');
    expect(res.text).toContain('1.25');
  });
});
