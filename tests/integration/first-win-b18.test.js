/**
 * AUTH B-18 — Onboarding: Activate (first-win) — integration/contract
 * -------------------------------------------------------------------
 *  - start → 5 savol (public DTO — answer key server'da, correct/explain YO'Q)
 *  - start→answer×5→complete → summary + ACTIVATION EVENT (step=checklist)
 *  - Replay: duplicate answer → 409; complete'dan keyin start → 409
 *  - IDOR: B user A userning savoliga javob bera olmaydi (no_active_attempt)
 *  - CSRF'siz POST → 403
 *  - TTFV: start→complete < 5 daqiqa (timing)
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import supertest from 'supertest';
import { snapshotDb, restoreDb } from '../helpers/setup.js';
import { fb } from '../../firebase/admin.js';
import { safeKey } from '../../utils/helpers.js';

let app;
let httpServer;

let xff = '203.0.113.181';
function nextIp() {
  // IPv4 okteti <= 255 — express-rate-limit noto'g'ri IP'ni rad etadi
  xff = `203.0.113.${181 + (Math.floor(Math.random() * 1000) % 70)}`;
  return xff;
}

function csrfFrom(html) {
  const m = html.match(/name="_csrf" value="([^"]+)"/);
  return m ? m[1] : null;
}
function csrfFromOnboarding(html) {
  const m = html.match(/var CSRF = "([^"]*)"/);
  return m ? m[1] : null;
}

async function registerAs(agent, uname) {
  const page = await agent.get('/user/login?lang=uz');
  const csrf = csrfFrom(page.text);
  const res = await agent.post('/user/login').set('x-forwarded-for', nextIp()).type('form').send({
    mode: 'reg', consent: 'on', _csrf: csrf, username: uname, email: `${uname}@test.uz`,
    password: 'parol-2026-x-uzun', lang: 'uz',
  });
  expect([302, 200]).toContain(res.status);
}

async function orientToFirstWin(agent, subject) {
  const page = await agent.get('/onboarding?lang=uz');
  const csrf = csrfFromOnboarding(page.text);
  await agent
    .post('/api/onboarding/orient')
    .set('x-csrf-token', csrf)
    .set('x-forwarded-for', nextIp())
    .send({ subject });
  return csrf;
}

beforeAll(async () => {
  await snapshotDb();
  const { createApp } = await import('../../server.js');
  const created = await createApp();
  app = created.app;
  httpServer = created.httpServer;
  await new Promise((r) => httpServer.listen(34778, r));
});

afterAll(async () => {
  await restoreDb();
  await new Promise((r) => httpServer.close(r));
});

describe('AUTH B-18 — first-win (integration)', () => {
  it('GET /onboarding first_win holatida → Activate ekran (fw-begin)', async () => {
    const agent = supertest.agent(app);
    const uname = `b18a${Date.now() % 1000000}`;
    await registerAs(agent, uname);
    await orientToFirstWin(agent, 'matematika');

    const page = await agent.get('/onboarding?lang=uz');
    expect(page.status).toBe(200);
    expect(page.text).toContain('id="fw-begin"');
    expect(page.text).toContain('Aktivatsiya');
    expect(csrfFromOnboarding(page.text)).toBeTruthy();
  });

  it('POST first-win/start → 5 savol, public DTO — answer key YO\'Q (§07/§16)', async () => {
    const agent = supertest.agent(app);
    const uname = `b18b${Date.now() % 1000000}`;
    await registerAs(agent, uname);
    const csrf = await orientToFirstWin(agent, 'matematika');

    const start = await agent
      .post('/api/onboarding/first-win/start')
      .set('x-csrf-token', csrf)
      .set('x-forwarded-for', nextIp())
      .send({ subject: 'matematika' });
    expect(start.status).toBe(200);
    expect(start.body.ok).toBe(true);
    expect(start.body.total).toBe(5);
    expect(start.body.questions.length).toBe(5);
    for (const q of start.body.questions) {
      expect(q.id).toBeTruthy();
      expect(q.options.length).toBeGreaterThanOrEqual(2);
      expect(q.correct).toBeUndefined();
      expect(q.explain).toBeUndefined();
    }
  });

  it('start→answer×5→complete → ACTIVATION EVENT (step=checklist) + TTFV < 5 min', async () => {
    const agent = supertest.agent(app);
    const uname = `b18c${Date.now() % 1000000}`;
    await registerAs(agent, uname);
    const csrf = await orientToFirstWin(agent, 'matematika');
    const t0 = Date.now();

    const start = await agent
      .post('/api/onboarding/first-win/start')
      .set('x-csrf-token', csrf)
      .set('x-forwarded-for', nextIp())
      .send({});
    expect(start.body.ok).toBe(true);
    const questions = start.body.questions;

    for (const q of questions) {
      const ans = await agent
        .post('/api/onboarding/first-win/answer')
        .set('x-csrf-token', csrf)
        .set('x-forwarded-for', nextIp())
        .send({ itemId: q.id, answer: 0 });
      expect(ans.status).toBe(200);
      expect(ans.body.ok).toBe(true);
      expect(typeof ans.body.correct).toBe('boolean');
      expect(ans.body.explain.length).toBeGreaterThan(10); // §08 izoh majburiy
    }

    const complete = await agent
      .post('/api/onboarding/first-win/complete')
      .set('x-csrf-token', csrf)
      .set('x-forwarded-for', nextIp())
      .send({});
    expect(complete.status).toBe(200);
    expect(complete.body.ok).toBe(true);
    const s = complete.body.summary;
    expect(s.total).toBe(5);
    expect(s.score).toBeGreaterThanOrEqual(0);
    expect(s.percent).toBeGreaterThanOrEqual(0);
    expect(s.answers.length).toBe(5);
    expect(s.message.length).toBeGreaterThan(10);

    // ACTIVATION EVENT — step=checklist + activated_at (§10)
    const snap = await fb.get(`onboarding/${safeKey(uname)}`);
    expect(snap.exists()).toBe(true);
    expect(snap.val().step).toBe('checklist');
    expect(snap.val().activated_at).toBeTruthy();
    expect(snap.val().firstWin.completedAt).toBeTruthy();
    expect(snap.val().firstWin.score).toBe(s.score);

    // TTFV (§11): start → complete < 5 daqiqa
    const ttFV = Date.now() - t0;
    expect(ttFV).toBeLessThan(5 * 60 * 1000);

    // Qayta start → 409 not_in_first_win
    const restart = await agent
      .post('/api/onboarding/first-win/start')
      .set('x-csrf-token', csrf)
      .send({});
    expect(restart.status).toBe(409);
  });

  it('Replay: duplicate answer → 409; not_all_answered → complete 400', async () => {
    const agent = supertest.agent(app);
    const uname = `b18d${Date.now() % 1000000}`;
    await registerAs(agent, uname);
    const csrf = await orientToFirstWin(agent, 'tarix');

    await agent.post('/api/onboarding/first-win/start').set('x-csrf-token', csrf).send({});
    const start = await agent.post('/api/onboarding/first-win/start').set('x-csrf-token', csrf).send({});
    expect(start.body.alreadyStarted).toBe(true); // idempotent start

    // complete hali hammasi javob berilmagan → 400
    const early = await agent.post('/api/onboarding/first-win/complete').set('x-csrf-token', csrf).send({});
    expect(early.status).toBe(400);
    expect(early.body.error).toBe('not_all_answered');

    const q = start.body.questions[0];
    const a1 = await agent.post('/api/onboarding/first-win/answer').set('x-csrf-token', csrf).send({ itemId: q.id, answer: 1 });
    expect(a1.status).toBe(200);
    // Duplicate → 409
    const dup = await agent.post('/api/onboarding/first-win/answer').set('x-csrf-token', csrf).send({ itemId: q.id, answer: 0 });
    expect(dup.status).toBe(409);
    expect(dup.body.error).toBe('duplicate_answer');
  });

  it('IDOR: B user A userning savoliga javob bera olmaydi (no_active_attempt)', async () => {
    const agentA = supertest.agent(app);
    const unameA = `b18ea${Date.now() % 1000000}`;
    await registerAs(agentA, unameA);
    const csrfA = await orientToFirstWin(agentA, 'dasturlash');
    const startA = await agentA.post('/api/onboarding/first-win/start').set('x-csrf-token', csrfA).send({});
    const qA = startA.body.questions[0];

    // B user — o'z attempt'i yo'q
    const agentB = supertest.agent(app);
    const unameB = `b18eb${Date.now() % 1000000}`;
    await registerAs(agentB, unameB);
    const csrfB = await orientToFirstWin(agentB, 'dasturlash');

    const res = await agentB
      .post('/api/onboarding/first-win/answer')
      .set('x-csrf-token', csrfB)
      .send({ itemId: qA.id, answer: 0 });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('no_active_attempt');
    // A holati buzilmagan
    const snapA = await fb.get(`onboarding/${safeKey(unameA)}`);
    expect(snapA.val().firstWin.answers.length).toBe(0);
  });

  it("CSRF'siz first-win POST → 403 (global validateCsrf)", async () => {
    const agent = supertest.agent(app);
    const uname = `b18f${Date.now() % 1000000}`;
    await registerAs(agent, uname);
    await orientToFirstWin(agent, 'matematika');

    const noCsrf = await agent.post('/api/onboarding/first-win/start').send({ subject: 'matematika' });
    expect(noCsrf.status).toBe(403);
  });
});
