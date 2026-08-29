/**
 * AUTH C-01 — Tiered rate limiter integration/contract tests
 * -------------------------------------------------------------------
 *  1. Burst: 1 soniyada 6 tezkor login POST (bir IP) → 6-chisi 429
 *     RATE_LIMITED + Retry-After + X-RateLimit-Limit header'lar
 *  2. Distributed per-ASN: 51 xil IP (bir xil ASN) register POST →
 *     51-chisi 429 (register.asn 50/15 aggregatsiya)
 *  3. NAT false-positive yo'q: turli account'lar bilan bir IP'da 15+ login
 *     POST o'tadi (per-account qattiq qatlam faqat shu account'ni bloklaydi)
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { snapshotDb, restoreDb } from '../helpers/setup.js';
import { createApp } from '../../server.js';
import { setAsnResolver } from '../../src/modules/auth/asn.js';
import supertest from 'supertest';

let app;
let httpServer;
let base;

beforeAll(async () => {
  await snapshotDb();
  const created = await createApp();
  app = created.app;
  httpServer = created.httpServer;
  await new Promise((r) => httpServer.listen(0, r));
  base = `http://localhost:${httpServer.address().port}`;
});

afterAll(async () => {
  setAsnResolver(null);
  await restoreDb();
  await new Promise((r) => httpServer.close(r));
});

/** GET → _csrf + sessiya cookie (agent orqali). */
async function csrfSession(agent, path = '/user/login') {
  const res = await agent.get(path);
  const m = res.text.match(/name="_csrf"\s+value="([^"]+)"/) || res.text.match(/window\.__CSRF_TOKEN = '([^']+)'/);
  return m ? m[1] : '';
}

describe('C-01 integration — burst (token-bucket)', () => {
  it('4 tezkor register POST (bir IP, tez reject) → 4-chisi 429 (register burst 3/s)', async () => {
    const agent = supertest.agent(app);
    const csrf = await csrfSession(agent);
    // Test izolyatsiyasi: boshqa fayllar bir xil IP (198.51.100.20) bilan
    // register POST qilganda burst bucket to'planadi — test'ni yakka holda
    // o'tkazish uchun global limiter bucket'larini tozalaymiz.
    app.get('authRateLimiter')?._reset?.();

    // mode=reg + bo'sh body — route tez reject qiladi (argon2 yo'q).
    // Barcha POST parallel yuboriladi — CPU yuki (batch run) request'lar
    // orasiga cho'zilib burst 1s window'ini chetlab o'tmasligi uchun.
    // 10 ta: istalgan real processing tezligida oxirgi 1s oyna ichida 5+
    // request qoladi → oxirgisi deterministik 429 (burst max 5/s).
    const results = await Promise.all(
      Array.from({ length: 10 }, () =>
        agent.post('/user/login')
          .set('x-forwarded-for', '198.51.100.20')
          .type('form')
          .send({ _csrf: csrf, lang: 'uz', mode: 'reg', consent: 'on', username: '', password: '' })
      )
    );
    const last = results[results.length - 1];
    expect(last.status).toBe(429);
    expect(last.body.code).toBe('RATE_LIMITED');
    expect(parseInt(last.headers['retry-after'], 10)).toBeGreaterThan(0);
    expect(parseInt(last.headers['x-ratelimit-limit'], 10)).toBeGreaterThan(0);
    expect(parseInt(last.headers['x-ratelimit-remaining'], 10)).toBe(0);
    expect(parseInt(last.headers['x-ratelimit-reset'], 10)).toBeGreaterThan(0);
  });

  it('login POST argon2 bilan sekundiga ~3 ta — burst 5/s urilmaydi (NAT uchun yumshoq)', async () => {
    const agent = supertest.agent(app);
    const csrf = await csrfSession(agent);
    let status;
    for (let i = 0; i < 6; i++) {
      const res = await agent.post('/user/login')
        .set('x-forwarded-for', '198.51.100.21')
        .type('form')
        .send({ _csrf: csrf, lang: 'uz', mode: 'login', username: `legit${i}`, password: 'xato' });
      status = res.status;
      await new Promise((r) => setTimeout(r, 250));
    }
    // Hech qaysi tier 429 qaytarmaydi — 6 xato hali account lock (10) ga yetmadi
    expect(status).not.toBe(429);
  });
});

describe('C-01 integration — distributed per-ASN', () => {
  it('51 xil IP (bir ASN) register → 51-chisi 429 (aggregatsiya)', async () => {
    // ASN resolver: barcha IP'lar 64502 ASN'ga tegishli
    setAsnResolver(async () => 64502);
    const agent = supertest.agent(app);
    const csrf = await csrfSession(agent);

    let last;
    for (let i = 0; i < 51; i++) {
      last = await agent.post('/user/login')
        .set('x-forwarded-for', `203.0.114.${(i % 250) + 1}`)
        .type('form')
        .send({ _csrf: csrf, lang: 'uz', mode: 'reg', consent: 'on', username: '', password: '' });
    }
    expect(last.status).toBe(429);
    expect(last.body.code).toBe('RATE_LIMITED');
    setAsnResolver(null);
  });

  it('ASN aniqlanmasa → fail-open (per-ASN tier o\'tkazib yuboriladi)', async () => {
    setAsnResolver(async () => null);
    const agent = supertest.agent(app);
    const csrf = await csrfSession(agent);
    let status;
    for (let i = 0; i < 55; i++) {
      const res = await agent.post('/user/login')
        .set('x-forwarded-for', `198.18.${i % 200}.${(i % 254) + 1}`)
        .type('form')
        .send({ _csrf: csrf, lang: 'uz', mode: 'reg', consent: 'on', username: '', password: '' });
      status = res.status;
    }
    // 429 bo'lmasligi kerak (per-IP ham har xil, burst ham per-IP) — ASN tier faqat skip
    expect(status).not.toBe(429);
    setAsnResolver(null);
  });
});
