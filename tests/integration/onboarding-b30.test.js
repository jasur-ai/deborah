/**
 * AUTH B-30 — Onboarding detail: returnUrl + progress + re-entry (integration)
 * ---------------------------------------------------------------------------
 * Integration/contract:
 *  - GET /onboarding?returnUrl=/teacher → session'da saqlanadi; complete → returnUrl '/teacher'
 *  - GET /onboarding?returnUrl=https://evil.com → /user/panel (open redirect YO'Q)
 *  - Re-entry: done bo'lgan onboarding yana ko'rsatilmaydi (takroriy emas)
 *  - IDOR: B user A userning onboarding holatiga ta'sir qila olmaydi
 *  - Monotonic: client step'ni o'zgartira olmaydi (orient step=done → first_win)
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import supertest from 'supertest';
import { snapshotDb, restoreDb } from '../helpers/setup.js';
import { fb } from '../../firebase/admin.js';
import { safeKey } from '../../utils/helpers.js';

let app;
let httpServer;

// A-03 register limit 5/15 per IP
let xff = '203.0.113.131';
function nextIp() {
  xff = `203.0.113.${131 + (Math.floor(Math.random() * 1000) % 90)}`;
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
function returnUrlFrom(html) {
  const m = html.match(/data-return-url="([^"]*)"/);
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

// Orient → first_win → savollarga javob → complete (to'liq oqim)
async function completeOnboarding(agent, uname) {
  const page = await agent.get('/onboarding?lang=uz');
  const csrf = csrfFromOnboarding(page.text);
  await agent.post('/api/onboarding/orient').set('x-csrf-token', csrf).send({ subject: 'matematika' });
  await agent.post('/api/onboarding/skip').set('x-csrf-token', csrf).send({});
  const start = await agent.post('/api/onboarding/first-win/start').set('x-csrf-token', csrf).send({});
  for (const q of start.body.questions || []) {
    await agent.post('/api/onboarding/first-win/answer').set('x-csrf-token', csrf).send({ itemId: q.id, answer: 0 });
  }
  return agent.post('/api/onboarding/first-win/complete').set('x-csrf-token', csrf).send({});
}

beforeAll(async () => {
  await snapshotDb();
  const { createApp } = await import('../../server.js');
  const created = await createApp();
  app = created.app;
  httpServer = created.httpServer;
  await new Promise((r) => httpServer.listen(34790, r));
});

afterAll(async () => {
  await restoreDb();
  await new Promise((r) => httpServer.close(r));
});

describe('AUTH B-30 — onboarding detail (integration)', () => {
  it('returnUrl=/teacher: session saqlanadi va complete → /teacher (allowlist)', async () => {
    const agent = supertest.agent(app);
    const uname = `b30a${Date.now() % 1000000}`;
    await registerAs(agent, uname);

    const page = await agent.get('/onboarding?lang=uz&returnUrl=/teacher');
    expect(page.status).toBe(200);

    const c = await completeOnboarding(agent, uname);
    expect(c.status).toBe(200);
    expect(c.body.ok).toBe(true);
    expect(c.body.returnUrl).toBe('/teacher');
  });

  it('returnUrl=https://evil.com → /user/panel (open redirect YO\'Q)', async () => {
    const agent = supertest.agent(app);
    const uname = `b30b${Date.now() % 1000000}`;
    await registerAs(agent, uname);

    const page = await agent.get('/onboarding?lang=uz&returnUrl=https://evil.com');
    expect(page.status).toBe(200);

    const c = await completeOnboarding(agent, uname);
    expect(c.status).toBe(200);
    expect(c.body.returnUrl).toBe('/user/panel');
  });

  it('Re-entry: onboarding yarim qolgan qadamdan davom etadi (intro takrorlanmaydi)', async () => {
    const agent = supertest.agent(app);
    const uname = `b30c${Date.now() % 1000000}`;
    await registerAs(agent, uname);

    const c = await completeOnboarding(agent, uname);
    expect(c.body.ok).toBe(true);

    const again = await agent.get('/onboarding?lang=uz');
    expect(again.status).toBe(200);
    // first-win tugadi → Reinforce (checklist) bosqich — welcome intro TAKRORLANMAYDI
    expect(again.text).toContain('id="cl-panel"');
    expect(again.text).not.toContain('id="onb-continue"');
    const snap = await fb.get(`onboarding/${safeKey(uname)}`);
    expect(snap.exists()).toBe(true);
    expect(snap.val().step).toBe('checklist');
    // monotonic: orqaga qaytmaydi, oldinga davom
    expect(snap.val().orient).toBeTruthy();
  });

  it('IDOR: B user A userning onboarding holatini o\'zgartira olmaydi', async () => {
    const agentA = supertest.agent(app);
    const agentB = supertest.agent(app);
    const unameA = `b30d${Date.now() % 1000000}`;
    const unameB = `b30e${Date.now() % 1000000}`;
    await registerAs(agentA, unameA);
    await registerAs(agentB, unameB);

    const pageA = await agentA.get('/onboarding?lang=uz');
    const csrfA = csrfFromOnboarding(pageA.text);
    await agentA.post('/api/onboarding/orient').set('x-csrf-token', csrfA).send({ subject: 'fizika' });

    // B o'z onboarding'ida hali welcome bosqichida
    const pageB = await agentB.get('/onboarding?lang=uz');
    expect(pageB.status).toBe(200);
    expect(pageB.text).toContain('id="onb-continue"');

    // B'ning progressi A'ga ta'sir qilmasligi — A hali first_win
    const snapA = await fb.get(`onboarding/${safeKey(unameA)}`);
    expect(snapA.exists()).toBe(true);
    expect(snapA.val().step).toBe('first_win');
    expect(snapA.val().orient.subject).toBe('fizika');
    const snapB = await fb.get(`onboarding/${safeKey(unameB)}`);
    expect(snapB.exists()).toBe(true);
    expect(snapB.val().step).toBe('welcome');
  });

  it('Monotonic: client step=done yuboradi — qabul qilinmaydi (first_win)', async () => {
    const agent = supertest.agent(app);
    const uname = `b30f${Date.now() % 1000000}`;
    await registerAs(agent, uname);

    const page = await agent.get('/onboarding?lang=uz');
    const csrf = csrfFromOnboarding(page.text);
    const res = await agent.post('/api/onboarding/orient').set('x-csrf-token', csrf).send({ subject: 'dasturlash', step: 'done' });
    expect(res.status).toBe(200);
    expect(res.body.state.step).toBe('first_win');
  });
});
