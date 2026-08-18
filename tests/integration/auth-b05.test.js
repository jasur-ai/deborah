/**
 * Deborah — AUTH B-05 Email validatsiya endpoint — Integration tests
 * -------------------------------------------------------------------
 *  - POST /api/validate/email: disposable → blok, typo → suggestion,
 *    CSRF talab qilinadi (global validateCsrf)
 *  - Register: disposable email hali ham blok (server check)
 *  - Javobda email (PII) yo'q
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import supertest from 'supertest';
import { createApp } from '../../server.js';
import { snapshotDb, restoreDb } from '../helpers/setup.js';

let app;
let httpServer;

function csrfFrom(html) {
  const m = html.match(/name="_csrf" value="([^"]+)"/);
  return m ? m[1] : null;
}

describe('AUTH B-05 — /api/validate/email', () => {
  beforeAll(async () => {
    await snapshotDb();
    ({ app, httpServer } = await createApp());
    await new Promise((r) => httpServer.listen(0, r));
  });
  afterAll(async () => {
    await restoreDb();
    await new Promise((r) => httpServer.close(r));
  });

  async function withCsrf(fn) {
    const agent = supertest.agent(app);
    const page = await agent.get('/user/register?lang=uz');
    const csrf = csrfFrom(page.text);
    return { agent, csrf };
  }

  it('disposable email → { ok:false, reason:disposable }', async () => {
    const { agent, csrf } = await withCsrf();
    const res = await agent.post('/api/validate/email').set('x-csrf-token', csrf).send({ email: 'user@mailinator.com' });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(false);
    expect(res.body.reason).toBe('disposable');
    expect(res.body.suggestion).toBeNull();
  });

  it('typo domen → suggestion (gmial.com → gmail.com)', async () => {
    const { agent, csrf } = await withCsrf();
    const res = await agent.post('/api/validate/email').set('x-csrf-token', csrf).send({ email: 'user@gmial.com' });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true); // MX test'da fail-open
    expect(res.body.suggestion).toBe('gmail.com');
  });

  it('to\'g\'ri email → ok, suggestion yo\'q', async () => {
    const { agent, csrf } = await withCsrf();
    const res = await agent.post('/api/validate/email').set('x-csrf-token', csrf).send({ email: 'user@deborah.uz' });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.suggestion).toBeNull();
    // PII: javobda email yoki PII maydon yo'q
    expect(JSON.stringify(res.body)).not.toContain('user@deborah.uz');
  });

  it('CSRF yo\'q → 403 (global validateCsrf)', async () => {
    const res = await supertest(app).post('/api/validate/email').send({ email: 'a@b.com' });
    expect(res.status).toBe(403);
  });

  it('syntax xato → reason syntax', async () => {
    const { agent, csrf } = await withCsrf();
    const res = await agent.post('/api/validate/email').set('x-csrf-token', csrf).send({ email: 'not-an-email' });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(false);
    expect(res.body.reason).toBe('syntax');
  });

  it('register disposable hali ham blok (server check)', async () => {
    const agent = supertest.agent(app);
    const page = await agent.get('/user/register?lang=uz');
    const csrf = csrfFrom(page.text);
    const res = await agent.post('/user/login').type('form').send({
      mode: 'reg', consent: 'on', _csrf: csrf, lang: 'uz',
      username: `b05d_${Date.now() % 1000000}`,
      email: 'user@mailinator.com',
      password: 'parol-2026-x-uzun',
    });
    expect(res.status).toBe(200);
    expect(res.text).toContain('data-field="email"');
  });
});
