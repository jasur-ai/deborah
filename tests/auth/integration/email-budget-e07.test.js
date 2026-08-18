/**
 * AUTH E-07 — Email budget (P2): admin config UI + CSV + warn banner.
 * -----------------------------------------------------------------
 *  - GET /admin/email-cost/report.csv (admin) → CSV kontrakti
 *  - POST /admin/email-cost/budget valid → redirect saved, DB'ga yoziladi
 *  - POST invalid (0 / >100000) → redirect invalid, yozilmaydi
 *  - Non-admin CSV → redirect /admin/login
 *  - warn daraja → banner ko'rinadi (80%+)
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
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

async function adminBudgetAgent() {
  const agent = await adminAgent();
  const page = await agent.get('/admin/email-cost');
  const csrf = csrfFrom(page.text);
  return { agent, csrf };
}

describe('AUTH E-07 — email budget config + CSV', () => {
  beforeEach(async () => {
    await fb.remove('email_cost');
    await fb.remove('email_budget_config');
    await fb.remove('email_budget_alerts');
    // budget.js config cache'ni tozalash (60s TTL — testlar orasida eski qiymat qolmasligi uchun)
    const mod = await import('../../../src/modules/email/budget.js');
    mod._resetBudgetCache();
  });

  it('1) admin CSV download — kontrakti', async () => {
    const month = new Date().toISOString().slice(0, 7);
    await fb.set(`email_cost/${month}/postmark`, { cost: 1.65, count: 1000, updatedAt: Date.now() });
    const agent = await adminAgent();
    const res = await agent.get('/admin/email-cost/report.csv');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.text.split('\n')[0]).toBe('oy,provider,count,cost_usd');
    expect(res.text).toContain(`${month},postmark,1000,1.65`);
  });

  it('2) non-admin CSV → redirect /admin/login', async () => {
    const res = await supertest(app).get('/admin/email-cost/report.csv');
    expect([302, 401]).toContain(res.status);
    if (res.status === 302) expect(res.headers.location).toContain('/admin/login');
  });

  it('3) POST budget valid → saved + DB yoziladi + dashboard manba DB', async () => {
    const { agent, csrf } = await adminBudgetAgent();
    const post = await agent
      .post('/admin/email-cost/budget')
      .type('form')
      .send({ _csrf: csrf, amount: '75' });
    expect(post.status).toBe(302);
    expect(post.headers.location).toContain('budget=saved');

    const cfgSnap = await fb.get('email_budget_config');
    expect(cfgSnap.exists()).toBe(true);
    expect(cfgSnap.val().amount).toBe(75);

    const page = await agent.get('/admin/email-cost');
    expect(page.text).toContain('Manba: Admin panel (DB)');
    expect(page.text).toContain('75');
  });

  it('4) POST budget invalid (0 / >100000) → invalid redirect, DB yozilmaydi', async () => {
    const { agent, csrf } = await adminBudgetAgent();
    for (const bad of ['0', '100001']) {
      const post = await agent
        .post('/admin/email-cost/budget')
        .type('form')
        .send({ _csrf: csrf, amount: bad });
      expect(post.status).toBe(302);
      expect(post.headers.location).toContain('budget=invalid');
    }
    const cfgSnap = await fb.get('email_budget_config');
    expect(cfgSnap.exists()).toBe(false);
  });

  it('5) warn daraja → banner + CSV link ko\u2018rinadi', async () => {
    const month = new Date().toISOString().slice(0, 7);
    await fb.set('email_budget_config', { amount: 10, updatedBy: 'testadmin', updatedAt: Date.now() });
    await fb.set(`email_cost/${month}/postmark`, { cost: 8.25, count: 5000, updatedAt: Date.now() });
    const agent = await adminAgent();
    const res = await agent.get('/admin/email-cost');
    expect(res.status).toBe(200);
    expect(res.text).toContain('80% ga yaqinlashdi');
    expect(res.text).toContain('email:budget:alert');
    expect(res.text).toContain('/admin/email-cost/report.csv');
    expect(res.text).toContain('Budget holati');
  });
});
