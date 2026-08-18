/**
 * AUTH B-27 — POST /api/validate/password-breach
 *  - Faqat SHA-1 hex qabul qilinadi (parol EMAS — network trace'da bo'lmasin)
 *  - k-anonymity: server HIBP'ga faqat 5-belgi prefix so'raydi
 *  - HIBP offline → fail-open (NIST: signup buzilmaydi)
 *  - Rate limit 20/15min per-IP
 *  - CSRF talab qilinadi (global validateCsrf)
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

describe('AUTH B-27 — /api/validate/password-breach', () => {
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
    const page = await agent.get('/user/login');
    const csrf = csrfFrom(page.text);
    expect(csrf).toBeTruthy();
    return fn(agent, csrf);
  }

  it('400: parol emas, faqat SHA-1 qabul qilinadi (parol yuborilsa rad)', async () => {
    await withCsrf(async (agent, csrf) => {
      const r = await agent
        .post('/api/validate/password-breach')
        .set('X-CSRF-Token', csrf)
        .send({ password: 'supersecret123' });
      expect(r.status).toBe(400);
      expect(r.body.error).toBe('required');
    });
  });

  it('400: noto\'g\'ri format (40-hex emas)', async () => {
    await withCsrf(async (agent, csrf) => {
      const r = await agent
        .post('/api/validate/password-breach')
        .set('X-CSRF-Token', csrf)
        .send({ sha1: 'CBFDAC6008F9CAB4' });
      expect(r.status).toBe(400);
    });
  });

  it('200: yaroqli SHA-1 → test rejimida fail-open (breached=false, checked=false)', async () => {
    await withCsrf(async (agent, csrf) => {
      const r = await agent
        .post('/api/validate/password-breach')
        .set('X-CSRF-Token', csrf)
        .send({ sha1: 'CBFDAC6008F9CAB4083784CBD1874F76618D2A97'.toUpperCase() });
      expect(r.status).toBe(200);
      expect(r.body.ok).toBe(true);
      expect(r.body.breached).toBe(false);
      expect(r.body.checked).toBe(false);
    });
  });

  it('403: CSRF yo\'q → rad etiladi', async () => {
    const agent = supertest.agent(app);
    const r = await agent
      .post('/api/validate/password-breach')
      .send({ sha1: 'CBFDAC6008F9CAB4083784CBD1874F76618D2A97' });
    expect(r.status).toBe(403);
  });

  it('429: tez-tez so\'rovlar rate-limit qilinadi', async () => {
    let limited = null;
    for (let i = 0; i < 25; i++) {
      const r = await withCsrf(async (agent, csrf) =>
        agent
          .post('/api/validate/password-breach')
          .set('X-CSRF-Token', csrf)
          .send({ sha1: `CBFDAC6008F9CAB4083784CBD1874F76618D2A${String(i).padStart(2, '0')}` }),
      );
      if (r.status === 429) { limited = r.body.error; break; }
    }
    expect(limited).toBe('rate_limited');
  });
});
