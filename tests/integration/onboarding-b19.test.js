/**
 * AUTH B-19 — Onboarding: Reinforce (checklist) + welcome (integration)
 * -------------------------------------------------------------------
 *  - first-win complete → checklist ekran (5 item render + progress)
 *  - POST checklist profil done → 200 progress 2/5
 *  - barcha done → step=done; GET /onboarding → done ekran
 *  - IDOR: B user A userning checklist'ini o'zgartira olmaydi (user-scoped)
 *  - CSRF'siz → 403; first_win locked
 *  - welcome: runWelcomeSequence API orqali Day 0/1 emas (job — unit'da), lekin
 *    route'ga ta'sir yo'q
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import supertest from 'supertest';
import { snapshotDb, restoreDb } from '../helpers/setup.js';
import { fb } from '../../firebase/admin.js';
import { safeKey } from '../../utils/helpers.js';

let app;
let httpServer;

let xff = '203.0.113.201';
function nextIp() {
  // IPv4 okteti <= 255 — express-rate-limit noto'g'ri IP'ni rad etadi
  xff = `203.0.113.${201 + (Math.floor(Math.random() * 1000) % 50)}`;
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

async function completeFirstWin(agent, csrf) {
  await agent.post('/api/onboarding/first-win/start').set('x-csrf-token', csrf).send({});
  const start = await agent.post('/api/onboarding/first-win/start').set('x-csrf-token', csrf).send({});
  for (const q of start.body.questions || []) {
    await agent.post('/api/onboarding/first-win/answer').set('x-csrf-token', csrf).send({ itemId: q.id, answer: 0 });
  }
  const c = await agent.post('/api/onboarding/first-win/complete').set('x-csrf-token', csrf).send({});
  return c;
}

beforeAll(async () => {
  await snapshotDb();
  const { createApp } = await import('../../server.js');
  const created = await createApp();
  app = created.app;
  httpServer = created.httpServer;
  await new Promise((r) => httpServer.listen(34779, r));
});

afterAll(async () => {
  await restoreDb();
  await new Promise((r) => httpServer.close(r));
});

describe('AUTH B-19 — checklist (integration)', () => {
  it('first-win complete → GET /onboarding checklist ekran (5 item + progress)', async () => {
    const agent = supertest.agent(app);
    const uname = `b19a${Date.now() % 1000000}`;
    await registerAs(agent, uname);
    const csrf = await orientToFirstWin(agent, 'matematika');
    const c = await completeFirstWin(agent, csrf);
    expect(c.status).toBe(200);
    expect(c.body.state.step).toBe('checklist');

    const page = await agent.get('/onboarding?lang=uz');
    expect(page.status).toBe(200);
    expect(page.text).toContain('id="cl-list"');
    expect(page.text).toContain('Birinchi qadamlar');
    // first_win item — avtomatik done (locked)
    expect(page.text).toContain('data-item="first_win"');
    expect(page.text).toContain('Tayyor: 1/5');
    expect(csrfFromOnboarding(page.text)).toBeTruthy();
  });

  it('POST checklist profil done → 200 progress 2/5; step hali checklist', async () => {
    const agent = supertest.agent(app);
    const uname = `b19b${Date.now() % 1000000}`;
    await registerAs(agent, uname);
    const csrf = await orientToFirstWin(agent, 'dasturlash');
    await completeFirstWin(agent, csrf);

    const r = await agent
      .post('/api/onboarding/checklist')
      .set('x-csrf-token', csrf)
      .set('x-forwarded-for', nextIp())
      .send({ itemId: 'profil', done: true });
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(true);
    expect(r.body.progress.done).toBe(2);
    expect(r.body.step).toBe('checklist');
  });

  it('barcha done → step=done (§07); GET /onboarding → done ekran', async () => {
    const agent = supertest.agent(app);
    const uname = `b19c${Date.now() % 1000000}`;
    await registerAs(agent, uname);
    const csrf = await orientToFirstWin(agent, 'tarix');
    await completeFirstWin(agent, csrf);

    for (const itemId of ['profil', 'telegram', 'kalendar', 'streak']) {
      await agent.post('/api/onboarding/checklist').set('x-csrf-token', csrf).send({ itemId, done: true });
    }
    const last = await agent
      .post('/api/onboarding/checklist')
      .set('x-csrf-token', csrf)
      .send({ itemId: 'streak', done: true });
    expect(last.body.step).toBe('done');
    expect(last.body.progress.percent).toBe(100);

    // DB canonical
    const snap = await fb.get(`onboarding/${safeKey(uname)}`);
    expect(snap.val().step).toBe('done');
    expect(snap.val().checklist.completedAt).toBeTruthy();

    const page = await agent.get('/onboarding?lang=uz');
    expect(page.status).toBe(200);
    expect(page.text).toContain('Barcha qadamlar bajarildi!');
  });

  it('first_win locked: client done=false yuborsa → 400 first_win_locked', async () => {
    const agent = supertest.agent(app);
    const uname = `b19d${Date.now() % 1000000}`;
    await registerAs(agent, uname);
    const csrf = await orientToFirstWin(agent, 'matematika');
    await completeFirstWin(agent, csrf);

    const r = await agent.post('/api/onboarding/checklist').set('x-csrf-token', csrf).send({ itemId: 'first_win', done: false });
    expect(r.status).toBe(400);
    expect(r.body.error).toBe('first_win_locked');
  });

  it("IDOR: B user A userning checklist'ini o'zgartira olmaydi (user-scoped)", async () => {
    const agentA = supertest.agent(app);
    const unameA = `b19ea${Date.now() % 1000000}`;
    await registerAs(agentA, unameA);
    const csrfA = await orientToFirstWin(agentA, 'matematika');
    await completeFirstWin(agentA, csrfA);
    await agentA.post('/api/onboarding/checklist').set('x-csrf-token', csrfA).send({ itemId: 'profil', done: true });

    // B user — o'z checklist'i yo'q (faqat orient)
    const agentB = supertest.agent(app);
    const unameB = `b19eb${Date.now() % 1000000}`;
    await registerAs(agentB, unameB);
    const csrfB = await orientToFirstWin(agentB, 'dasturlash');

    const r = await agentB.post('/api/onboarding/checklist').set('x-csrf-token', csrfB).send({ itemId: 'profil', done: true });
    expect(r.status).toBe(409); // not_in_checklist (first-win tugamagan)
    expect(r.body.error).toBe('not_in_checklist');
    // A holati buzilmagan
    const snapA = await fb.get(`onboarding/${safeKey(unameA)}`);
    expect(snapA.val().checklist.items.find((x) => x.itemId === 'profil').done).toBe(true);
  });

  it("CSRF'siz checklist POST → 403", async () => {
    const agent = supertest.agent(app);
    const uname = `b19f${Date.now() % 1000000}`;
    await registerAs(agent, uname);
    const csrf = await orientToFirstWin(agent, 'matematika');
    await completeFirstWin(agent, csrf);

    const r = await agent.post('/api/onboarding/checklist').send({ itemId: 'profil', done: true });
    expect(r.status).toBe(403);
  });
});
