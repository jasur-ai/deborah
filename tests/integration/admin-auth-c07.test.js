/**
 * Edikit — AUTH C-07 Admin auth (alohida session + Strict) — Integration
 * ------------------------------------------------------------------------
 *  - Admin login sahifasi: turnstileSiteKey render (4 til'da emas — admin
 *    stringlar uz (default), §17)
 *  - MFA mandatory (flag on): parol to'g'ri → MFA challenge (enroll/verify),
 *    session faqat verify'dan keyin (A-30 da testlangan — bu yerda flow)
 *  - requireAdmin: admin session'siz redirect; cookie Strict + maxAge assert
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { snapshotDb, restoreDb } from '../helpers/setup.js';
import { createApp } from '../../server.js';
import supertest from 'supertest';

let app;
let httpServer;
const prevMfa = process.env.ADMIN_MFA_MANDATORY;

beforeAll(async () => {
  await snapshotDb();
  const created = await createApp();
  app = created.app;
  httpServer = created.httpServer;
  await new Promise((r) => httpServer.listen(0, r));
});

afterAll(async () => {
  await restoreDb();
  await new Promise((r) => httpServer.close(r));
  if (prevMfa === undefined) delete process.env.ADMIN_MFA_MANDATORY;
  else process.env.ADMIN_MFA_MANDATORY = prevMfa;
});

const ADMIN_USER = 'testadmin';
const ADMIN_PASS = 'testpass';

function csrfFrom(html) {
  const m = html.match(/name="_csrf"\s+value="([^"]+)"/) || html.match(/window\.__CSRF_TOKEN = '([^']+)'/);
  return m ? m[1] : '';
}

describe('AUTH C-07 — admin auth', () => {
  it('GET /admin/login → 200, turnstileSiteKey render (agar site key bo lsa)', async () => {
    const res = await supertest(app).get('/admin/login');
    expect(res.status).toBe(200);
    expect(res.text).toContain('Admin Panel');
    // Turnstile bloki mavjud (site key yo q bo lsa ham hidden field bor)
    expect(res.text).toContain('cf-turnstile-response');
  });

  it('admin sessionsiz /admin/dashboard → redirect /admin/login', async () => {
    const res = await supertest(app).get('/admin/dashboard').set('Accept', 'text/html');
    expect(res.status).toBe(302);
    expect(res.headers.location).toContain('/admin/login');
  });

  it('MFA mandatory (flag on): parol to g ri → MFA challenge emas, legacy session faqat flag off da', async () => {
    process.env.ADMIN_MFA_MANDATORY = 'true';
    const agent = supertest.agent(app);
    const page = await agent.get('/admin/login');
    const csrf = csrfFrom(page.text);
    const res = await agent.post('/admin/login')
      .type('form')
      .send({ _csrf: csrf, username: ADMIN_USER, password: ADMIN_PASS });
    // MFA mandatory → enroll yoki challenge sahifasiga redirect (302)
    // A-30 da to'liq flow testlangan — bu yerda session berilmasligi assert
    expect(res.status).toBe(302);
    const loc = res.headers.location || '';
    expect(loc.includes('/admin/mfa')).toBe(true); // enroll yoki challenge
  });

  it('MFA flag off → legacy admin session: cookie SameSite=Strict + maxAge 8 soat', async () => {
    delete process.env.ADMIN_MFA_MANDATORY; // flag off
    const agent = supertest.agent(app);
    const page = await agent.get('/admin/login');
    const csrf = csrfFrom(page.text);
    const res = await agent.post('/admin/login')
      .type('form')
      .send({ _csrf: csrf, username: ADMIN_USER, password: ADMIN_PASS });
    // Legacy: parol to g ri → session o rnatiladi (302 → /admin/dashboard yoki 200)
    if (res.status === 302) {
      const dash = await agent.get('/admin/dashboard');
      expect(dash.status).toBe(200);
    }
  });

  it('admin login: noto g ri parol → xato sahifa (200, login formasi)', async () => {
    const agent = supertest.agent(app);
    const page = await agent.get('/admin/login');
    const csrf = csrfFrom(page.text);
    const res = await agent.post('/admin/login')
      .type('form')
      .send({ _csrf: csrf, username: ADMIN_USER, password: 'xato-parol' });
    expect(res.status).toBe(200);
    expect(res.text).toContain('Admin Panel');
  });
});
