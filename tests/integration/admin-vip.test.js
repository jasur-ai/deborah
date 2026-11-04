import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import supertest from 'supertest';
import { snapshotDb, restoreDb } from '../helpers/setup.js';
import { createApp } from '../../server.js';
import { fb } from '../../firebase/admin.js';
import { safeKey } from '../../utils/helpers.js';

let app;
let httpServer;

function csrfFrom(html) {
  const match = html.match(/name="_csrf"\s+value="([^"]+)"/) ||
    html.match(/window\.__CSRF_TOKEN = '([^']+)'/);
  return match?.[1] || '';
}

async function adminAgent() {
  const agent = supertest.agent(app);
  const loginPage = await agent.get('/admin/login');
  const login = await agent.post('/admin/login').type('form').send({
    _csrf: csrfFrom(loginPage.text),
    username: process.env.ADMIN_USER || 'testadmin',
    password: process.env.ADMIN_PASS || 'testpass',
  });
  expect(login.status).toBe(302);
  expect(login.headers.location || '').toContain('/admin');

  const dashboard = await agent.get('/admin/dashboard');
  expect(dashboard.status).toBe(200);
  return { agent, csrf: csrfFrom(dashboard.text) };
}

beforeAll(async () => {
  await snapshotDb();
  const created = await createApp();
  app = created.app;
  httpServer = created.httpServer;
  await new Promise((resolve) => httpServer.listen(0, resolve));
});

afterAll(async () => {
  if (httpServer?.listening) await new Promise((resolve) => httpServer.close(resolve));
  await restoreDb();
});

describe('Admin VIP grants', () => {
  it('grants two students consecutively, including a Google account keyed by provider ID', async () => {
    const suffix = `${Date.now()}_${Math.floor(Math.random() * 1_000_000)}`;
    const googleKey = `google_vip_${suffix}`;
    const googleUsername = `vip_google_${suffix}`;
    const directKey = safeKey(`vip_student_${suffix}`);

    await fb.set(`users/${googleKey}`, {
      username: googleUsername,
      role: 'student',
      status: 'active',
      isVip: false,
      password: 'original-login-hash',
    });
    await fb.set(`users/${directKey}`, {
      username: directKey,
      role: 'student',
      status: 'active',
      isVip: false,
      password: 'original-login-hash',
    });

    const { agent, csrf } = await adminAgent();
    const first = await agent.post('/admin/api/vip/grant')
      .set('x-csrf-token', csrf)
      .send({ username: googleUsername });
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({ success: true, username: googleUsername });

    const googleAfter = (await fb.get(`users/${googleKey}`)).val();
    expect(googleAfter.isVip).toBe(true);
    expect(googleAfter.password).toBe('original-login-hash');

    const second = await agent.post('/admin/api/vip/grant')
      .set('x-csrf-token', csrf)
      .send({ username: directKey });
    expect(second.status).toBe(200);
    expect(second.body).toMatchObject({ success: true, username: directKey });
    expect((await fb.get(`users/${directKey}/isVip`)).val()).toBe(true);
  });

  it('revokes a Google-keyed account by its displayed username', async () => {
    const suffix = `${Date.now()}_${Math.floor(Math.random() * 1_000_000)}`;
    const providerKey = `google_vip_revoke_${suffix}`;
    const username = `vip_revoke_${suffix}`;
    await fb.set(`users/${providerKey}`, {
      username,
      role: 'student',
      status: 'active',
      isVip: true,
    });

    const { agent, csrf } = await adminAgent();
    const response = await agent.post('/admin/api/vip/revoke')
      .set('x-csrf-token', csrf)
      .send({ username });
    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect((await fb.get(`users/${providerKey}/isVip`)).val()).toBe(false);
  });
});
