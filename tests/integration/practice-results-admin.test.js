/** End-to-end storage contract for personal Mock/PRE practice and admin aggregates. */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { snapshotDb, restoreDb } from '../helpers/setup.js';
import { createApp } from '../../server.js';
import { fb } from '../../firebase/admin.js';
import { safeKey } from '../../utils/helpers.js';
import supertest from 'supertest';

let app;
let httpServer;

beforeAll(async () => {
  await snapshotDb();
  const created = await createApp();
  app = created.app;
  httpServer = created.httpServer;
  await new Promise((resolve) => httpServer.listen(0, resolve));
});

afterAll(async () => {
  await restoreDb();
  await new Promise((resolve) => httpServer.close(resolve));
});

const PASSWORD = 'practice-result-test-2026';
const ADMIN_USER = process.env.ADMIN_USER || 'testadmin';
const ADMIN_PASS = process.env.ADMIN_PASS || 'testpass';

function csrfFrom(html) {
  const match = html.match(/window\.__CSRF_TOKEN\s*=\s*'([^']+)'/)
    || html.match(/name="_csrf"\s+value="([^"]+)"/);
  return match?.[1] || '';
}

async function signInAdmin() {
  const agent = supertest.agent(app);
  const loginPage = await agent.get('/admin/login');
  const response = await agent.post('/admin/login')
    .set('x-forwarded-for', `203.0.113.${Math.floor(Math.random() * 100) + 1}`)
    .type('form')
    .send({ _csrf: csrfFrom(loginPage.text), username: ADMIN_USER, password: ADMIN_PASS });
  if (response.headers.location?.includes('/admin/mfa')) {
    throw new Error('The integration test expects the non-mandatory-MFA test configuration.');
  }
  return agent;
}

async function registerStudent(username) {
  const agent = supertest.agent(app);
  const loginPage = await agent.get('/user/login');
  const response = await agent.post('/user/login')
    .set('x-forwarded-for', `198.51.100.${Math.floor(Math.random() * 100) + 1}`)
    .type('form')
    .send({
      _csrf: csrfFrom(loginPage.text),
      lang: 'uz',
      mode: 'reg',
      consent: 'on',
      username,
      password: PASSWORD,
      email: `${username}_${Date.now()}@test.uz`,
    });
  expect(response.status).toBe(302);
  return agent;
}

function question(text, correctLetter) {
  const options = [
    { text: `${text} A`, letter: 'A', isCorrect: correctLetter === 'A' },
    { text: `${text} B`, letter: 'B', isCorrect: correctLetter === 'B' },
  ];
  return {
    num: 1,
    text,
    correctLetter,
    correctText: options.find((option) => option.isCorrect).text,
    options,
  };
}

describe('Mock/PRE result persistence and admin summaries', () => {
  it('saves full Mock/PRE attempts, excludes retry, and shows aggregate results per catalog item', async () => {
    const admin = await signInAdmin();
    const dashboard = await admin.get('/admin/dashboard');
    const csrf = csrfFrom(dashboard.text);
    expect(csrf).toBeTruthy();

    const mockName = `result_mock_${Date.now()}`;
    const mockQuestions = [question('Mock savol 1', 'A'), question('Mock savol 2', 'B')];
    const fanSave = await admin.post('/admin/api/fans/save')
      .set('x-csrf-token', csrf)
      .send({ name: mockName, questions: mockQuestions });
    expect(fanSave.status).toBe(200);
    expect(fanSave.body.success).toBe(true);

    const preTitle = `result_pre_${Date.now()}`;
    const preKey = safeKey(preTitle) + '_group';
    const preSave = await admin.post('/admin/api/pre-groups/save')
      .set('x-csrf-token', csrf)
      .send({
        title: preTitle,
        editKey: preKey,
        chunks: [{ id: 'sub-1', name: 'Subtest 1', questions: [question('PRE savol 1', 'A'), question('PRE savol 2', 'B')] }],
      });
    expect(preSave.status).toBe(200);
    expect(preSave.body.success).toBe(true);

    const userName = `prres_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
    const student = await registerStudent(userName);
    const practicePage = await student.get(`/user/practice?source=mock&key=${encodeURIComponent(fanSave.body.key)}`);
    expect(practicePage.status).toBe(200);
    const userCsrf = csrfFrom(practicePage.text);

    const mockFull = await student.post(`/user/api/practice/grade?source=mock&key=${encodeURIComponent(fanSave.body.key)}`)
      .set('x-csrf-token', userCsrf)
      .send({
        source: 'mock', key: fanSave.body.key, questionIds: [0, 1], answers: [0, 1],
        kind: 'full', times: [4, 5], focusViolations: 0,
      });
    expect(mockFull.status).toBe(200);
    expect(mockFull.body.saved).toBe(true);
    expect(mockFull.body.percent).toBe(100);

    const retry = await student.post(`/user/api/practice/grade?source=mock&key=${encodeURIComponent(fanSave.body.key)}`)
      .set('x-csrf-token', userCsrf)
      .send({
        source: 'mock', key: fanSave.body.key, questionIds: [0, 1], answers: [0, 1],
        kind: 'retry', subset: [0], times: [3], focusViolations: 0,
      });
    expect(retry.status).toBe(200);
    expect(retry.body.saved).toBe(false);

    const prePage = await student.get(`/user/practice?source=pre&key=${encodeURIComponent(preKey)}&chunk=sub-1`);
    expect(prePage.status).toBe(200);
    const preFull = await student.post(`/user/api/practice/grade?source=pre&key=${encodeURIComponent(preKey)}&chunk=sub-1`)
      .set('x-csrf-token', userCsrf)
      .send({ source: 'pre', key: preKey, chunk: 'sub-1', answers: [0, 1], kind: 'full', times: [5, 6] });
    expect(preFull.status).toBe(200);
    expect(preFull.body.saved).toBe(true);

    const history = (await fb.get(`users/${safeKey(userName)}/practice_history`)).val() || {};
    const saved = Object.values(history);
    expect(saved).toHaveLength(2);
    expect(saved.some((entry) => entry.practiceSource === 'mock' && entry.practiceKey === fanSave.body.key)).toBe(true);
    expect(saved.some((entry) => entry.practiceSource === 'pre' && entry.practiceKey === preKey && entry.practiceChunk === 'sub-1')).toBe(true);

    const fansApi = await admin.get('/admin/api/fans');
    const fan = fansApi.body.fans.find((entry) => entry.key === fanSave.body.key);
    expect(fan.practiceResults).toMatchObject({ attempts: 1, participants: 1, averagePercent: 100, bestPercent: 100 });

    const preApi = await admin.get('/admin/api/pre-groups');
    const group = preApi.body.groups.find((entry) => entry.key === preKey);
    expect(group.practiceResults).toMatchObject({ attempts: 1, participants: 1, averagePercent: 100, bestPercent: 100 });
    expect(group.chunkResults[0].practiceResults).toMatchObject({ attempts: 1, participants: 1, averagePercent: 100, bestPercent: 100 });
    expect(JSON.stringify(fan.practiceResults)).not.toContain(userName);
    expect(JSON.stringify(group.practiceResults)).not.toContain(userName);
  });
});
