/**
 * AUTH B-17 — Onboarding: state machine + Orient (integration)
 * -------------------------------------------------------------------
 * Integration/contract:
 *  - GET /onboarding auth talab (anonim → redirect login)
 *  - Yangi user: GET /onboarding → 200 "Xush kelibsiz, {username}! 🎓" + stepper + CSRF
 *  - POST /api/onboarding/orient → first_win; qayta kirish → alreadyDone ekran
 *  - POST /api/onboarding/skip → first_win (skip bonus)
 *  - Security: CSRF'siz orient POST → 403; step manipulatsiya → ignored (monotonic);
 *    IDOR — B user A userning holatiga ta'sir qila olmaydi; demo API answer key DTO'da YO'Q
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import supertest from 'supertest';
import { snapshotDb, restoreDb } from '../helpers/setup.js';
import { fb } from '../../firebase/admin.js';
import { safeKey } from '../../utils/helpers.js';

let app;
let httpServer;

// A-03 register limit 5/15 per IP
let xff = '203.0.113.151';
function nextIp() {
  xff = `203.0.113.${151 + (Math.floor(Math.random() * 1000) % 90)}`;
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
  return res;
}

beforeAll(async () => {
  await snapshotDb();
  const { createApp } = await import('../../server.js');
  const created = await createApp();
  app = created.app;
  httpServer = created.httpServer;
  await new Promise((r) => httpServer.listen(34775, r));
});

afterAll(async () => {
  await restoreDb();
  await new Promise((r) => httpServer.close(r));
});

describe('AUTH B-17 — onboarding (integration)', () => {
  it('GET /onboarding auth talab: anonim → login redirect / 401', async () => {
    const agent = supertest.agent(app);
    const res = await agent.get('/onboarding');
    // requireAuth: HTML brauzer → redirect; API-ish so'rov (Accept: *\/*) → 401
    expect([302, 401]).toContain(res.status);
    if (res.status === 302) {
      expect(res.headers.location).toContain('/user/login');
    }
  });

  it('Yangi user: GET /onboarding → Orient ekran (Xush kelibsiz + stepper + CSRF)', async () => {
    const agent = supertest.agent(app);
    const uname = `b17a${Date.now() % 1000000}`;
    await registerAs(agent, uname);

    const page = await agent.get('/onboarding?lang=uz');
    expect(page.status).toBe(200);
    expect(page.text).toContain(`Xush kelibsiz, ${uname}! 🎓`);
    // Stepper 3 bosqich
    expect(page.text).toContain('Orientatsiya');
    expect(page.text).toContain('Aktivatsiya');
    expect(page.text).toContain('Mustahkamlash');
    expect(page.text).toContain('id="onb-continue"');
    expect(page.text).toContain('id="onb-skip"');
    // CSRF view'ga chiqadi
    expect(csrfFromOnboarding(page.text)).toBeTruthy();
  });

  it('POST orient → first_win; qayta kirish → alreadyDone ekran (monotonic)', async () => {
    const agent = supertest.agent(app);
    const uname = `b17b${Date.now() % 1000000}`;
    await registerAs(agent, uname);
    const page = await agent.get('/onboarding?lang=uz');
    const csrf = csrfFromOnboarding(page.text);

    const orient = await agent
      .post('/api/onboarding/orient')
      .set('x-csrf-token', csrf)
      .set('x-forwarded-for', nextIp())
      .send({ subject: 'matematika', goal: 'Kirish imtihoniga tayyorlanish' });
    expect(orient.status).toBe(200);
    expect(orient.body.ok).toBe(true);
    expect(orient.body.state.step).toBe('first_win');

    // DB'da onboarding record — user-scoped
    const snap = await fb.get(`onboarding/${safeKey(uname)}`);
    expect(snap.exists()).toBe(true);
    expect(snap.val().step).toBe('first_win');
    expect(snap.val().orient.subject).toBe('matematika');

    // Qayta kirish → B-18: first_win holatida Activate ekran (fw-begin)
    const again = await agent.get('/onboarding?lang=uz');
    expect(again.status).toBe(200);
    expect(again.text).toContain('id="fw-begin"');
    expect(again.text).toContain('Aktivatsiya');
  });

  it('Step manipulatsiya: POST orient step=done parametri QABUL QILINMAYDI (monotonic)', async () => {
    const agent = supertest.agent(app);
    const uname = `b17c${Date.now() % 1000000}`;
    await registerAs(agent, uname);
    const page = await agent.get('/onboarding?lang=uz');
    const csrf = csrfFromOnboarding(page.text);

    const res = await agent
      .post('/api/onboarding/orient')
      .set('x-csrf-token', csrf)
      .send({ subject: 'dasturlash', step: 'done' });
    expect(res.status).toBe(200);
    // Client step'ni o'zgartira olmaydi — first_win, done EMAS
    expect(res.body.state.step).toBe('first_win');
    const snap = await fb.get(`onboarding/${safeKey(uname)}`);
    expect(snap.val().step).toBe('first_win');
  });

  it('POST skip → first_win + skipped flag; qayta orient o\'zgarmaydi', async () => {
    const agent = supertest.agent(app);
    const uname = `b17d${Date.now() % 1000000}`;
    await registerAs(agent, uname);
    const page = await agent.get('/onboarding?lang=uz');
    const csrf = csrfFromOnboarding(page.text);

    const skip = await agent
      .post('/api/onboarding/skip')
      .set('x-csrf-token', csrf)
      .send({});
    expect(skip.status).toBe(200);
    expect(skip.body.state.step).toBe('first_win');
    const snap = await fb.get(`onboarding/${safeKey(uname)}`);
    expect(snap.val().orient.skipped).toBe(true);

    // Skip'dan keyin orient submit → alreadyAdvanced
    const orient = await agent
      .post('/api/onboarding/orient')
      .set('x-csrf-token', csrf)
      .send({ subject: 'tarix' });
    expect(orient.body.alreadyAdvanced).toBe(true);
  });

  it('Security: CSRF yo\'q orient POST → 403', async () => {
    const agent = supertest.agent(app);
    const uname = `b17e${Date.now() % 1000000}`;
    await registerAs(agent, uname);
    const res = await agent
      .post('/api/onboarding/orient')
      .set('x-forwarded-for', nextIp())
      .send({ subject: 'matematika' });
    expect(res.status).toBe(403);
  });

  it('Security: IDOR — B user A userning onboarding holatiga ta\'sir qila olmaydi', async () => {
    const agentA = supertest.agent(app);
    const unameA = `b17fa${Date.now() % 1000000}`;
    await registerAs(agentA, unameA);
    const pageA = await agentA.get('/onboarding?lang=uz');
    const csrfA = csrfFromOnboarding(pageA.text);
    await agentA.post('/api/onboarding/orient').set('x-csrf-token', csrfA).send({ subject: 'matematika' });

    const agentB = supertest.agent(app);
    const unameB = `b17fb${Date.now() % 1000000}`;
    await registerAs(agentB, unameB);
    // B o'z orient'ini yuboradi
    const pageB = await agentB.get('/onboarding?lang=uz');
    const csrfB = csrfFromOnboarding(pageB.text);
    await agentB.post('/api/onboarding/orient').set('x-csrf-token', csrfB).send({ subject: 'tarix' });

    // A holati o'zgarmadi (B ta'sir qila olmadi)
    const aSnap = await fb.get(`onboarding/${safeKey(unameA)}`);
    expect(aSnap.val().orient.subject).toBe('matematika');
    const bSnap = await fb.get(`onboarding/${safeKey(unameB)}`);
    expect(bSnap.val().orient.subject).toBe('tarix');
  });

  it('Demo API: public DTO (correct YO\'Q) + server-side answer check', async () => {
    const agent = supertest.agent(app);
    const uname = `b17g${Date.now() % 1000000}`;
    await registerAs(agent, uname);

    const demo = await agent.get('/api/onboarding/demo?subject=matematika&lang=uz');
    expect(demo.status).toBe(200);
    expect(demo.body.ok).toBe(true);
    expect(demo.body.question.text).toBeTruthy();
    expect(demo.body.question.options.length).toBeGreaterThanOrEqual(2);
    expect(demo.body.question.correct).toBeUndefined();

    const page = await agent.get('/onboarding?lang=uz');
    const csrf = csrfFromOnboarding(page.text);
    const ans = await agent.post('/api/onboarding/demo/answer').set('x-csrf-token', csrf).send({
      subject: 'matematika', questionId: demo.body.question.id, answer: 1,
    });
    expect(ans.status).toBe(200);
    expect(ans.body.correct).toBe(true);
  });
});
