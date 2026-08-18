/**
 * AUTH A-21 — Final checkpoint: honeypot bot-protection integration test.
 *
 * A-21 §07 (Register audit): honeypot maydon to'ldirilgan register — bot.
 *   - User yaratilmaydi (users/ da record yo'q)
 *   - Silent redirect (bot o'zini muvaffaqiyatli his qiladi)
 *   - Rate limit bucket'iga tegmaydi (tezkor replay honeypot bilan 429 emas)
 *   - Audit event: register blocked (reason honeypot)
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import supertest from 'supertest';
import { createApp } from '../../server.js';
import { snapshotDb, restoreDb } from '../helpers/setup.js';
import { fb } from '../../firebase/admin.js';
import { safeKey } from '../../utils/helpers.js';

let app;
let httpServer;
let ipCounter = 40;

function nextIp() {
  ipCounter += 1;
  return `203.0.115.${ipCounter}`;
}

function csrfFrom(html) {
  const m = html.match(/name="_csrf" value="([^"]+)"/);
  return m ? m[1] : null;
}

describe('AUTH A-21 — checkpoint: honeypot bot protection', () => {
  beforeAll(async () => {
    await snapshotDb();
    ({ app, httpServer } = await createApp());
    await new Promise((r) => httpServer.listen(0, r));
  });

  afterAll(async () => {
    await restoreDb();
    await new Promise((r) => httpServer.close(r));
  });

  it('honeypot to\'ldirilgan register — user yaratilmaydi, silent redirect', async () => {
    const agent = supertest.agent(app);
    const page = await agent.get('/user/login?mode=reg');
    const csrf = csrfFrom(page.text);

    const res = await agent
      .post('/user/login')
      .set('x-forwarded-for', nextIp())
      .type('form')
      .send({
        _csrf: csrf,
        lang: 'uz',
        mode: 'reg', consent: 'on',
        username: `hpbot_${Date.now() % 1000000}`,
        password: 'sirli-parol-2026',
        email: `hpbot_${Date.now()}_${Math.floor(Math.random() * 1000000)}@test.uz`,
        website: 'http://spam.example/',
      });

    // Silent: bot redirect'ni ko'radi (success kabi), xato sahifa emas
    expect([302, 200]).toContain(res.status);

    // User yaratilmagan
    const uname = safeKey(`hpbot_${Date.now() % 1000000}`);
    const snap = await fb.get(`users/${uname}`);
    expect(snap.exists()).toBe(false);
  });

  it('honeypot tezkor takrorlash — rate limit 429 EMAS (bucket\'ga tegmaydi)', async () => {
    const agent = supertest.agent(app);
    const page = await agent.get('/user/login?mode=reg');
    const csrf = csrfFrom(page.text);
    const ip = nextIp();

    // 6 ta tezkor honeypot register — odatiy limit 5/15min, lekin honeypot
    // bucket'ga tegmasligi kerak → 6-chisi ham 429 bo'lmasligi kerak.
    for (let i = 0; i < 6; i += 1) {
      const res = await agent
        .post('/user/login')
        .set('x-forwarded-for', ip)
        .type('form')
        .send({
          _csrf: csrf,
          lang: 'uz',
          mode: 'reg', consent: 'on',
          username: `hprap_${Date.now() % 1000000}_${i}`,
          password: 'sirli-parol-2026',
          email: `hprap_${Date.now()}_${i}_${Math.floor(Math.random() * 1000000)}@test.uz`,
          website: 'spam',
        });
      expect([302, 200]).toContain(res.status);
      expect(res.status).not.toBe(429);
    }
  });

  it('honeypot field register formada mavjud (aria-hidden)', async () => {
    const page = await supertest.agent(app).get('/user/login?mode=reg');
    expect(page.text).toContain('name="website"');
    expect(page.text).toContain('aria-hidden="true"');
  });
});
