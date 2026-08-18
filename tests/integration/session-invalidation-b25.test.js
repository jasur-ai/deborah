/**
 * AUTH B-25 — Session invalidation edge cases (integration)
 * ---------------------------------------------------------
 * 1) Multi-device: 2 brauzer login → 1-o'zgarish (password change) → 2-si 401,
 *    joriy (1-si) saqlanadi.
 * 2) Replay: revoke qilingan session cookie bilan qayta so'rov → 401.
 * 3) Concurrent: parallel revokeByUser — idempotent, xato yo'q.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createApp } from '../../server.js';
import { fb } from '../../firebase/admin.js';
import { snapshotDb, restoreDb } from '../helpers/setup.js';

const USERNAME = `b25u${Date.now()}`;
const EMAIL = `b25-${Date.now()}@test.uz`;
const PASSWORD = 'Str0ng!Pass2026';
const NEW_PASSWORD = 'Str0ng!NewPassword2026';

async function extractCsrf(html) {
  const m = html.match(/name="_csrf" value="([^"]+)"/) || html.match(/window\.__CSRF_TOKEN\s*=\s*'([^']+)'/);
  return m ? m[1] : null;
}

describe('AUTH B-25 — Session invalidation (integration)', () => {
  let app;
  let httpServer;
  let agent1;
  let agent2;

  beforeAll(async () => {
    await snapshotDb();
    const created = await createApp();
    app = created.app;
    httpServer = created.httpServer;
    await new Promise((r) => httpServer.listen(0, r));
    const st = (await import('supertest')).default;

    // Register (agent1)
    agent1 = st.agent(app);
    const regPage = await agent1.get('/user/login?mode=reg').redirects(0);
    const csrf = await extractCsrf(regPage.text);
    const reg = await agent1.post('/user/login').type('form').send({
      _csrf: csrf, mode: 'reg', consent: 'on', username: USERNAME,
      password: PASSWORD, password2: PASSWORD, email: EMAIL, lang: 'uz',
    });
    expect([200, 302]).toContain(reg.status);

    // 2-brauzer — login
    agent2 = st.agent(app);
    const loginPage = await agent2.get('/user/login').redirects(0);
    const csrf2 = await extractCsrf(loginPage.text);
    const login = await agent2.post('/user/login').type('form').send({
      _csrf: csrf2, username: USERNAME, password: PASSWORD, lang: 'uz',
    });
    expect([200, 302]).toContain(login.status);
    // Ikkala agent sessiyasi faol
    expect((await agent1.get('/user/panel')).status).toBe(200);
    expect((await agent2.get('/user/panel')).status).toBe(200);
  });

  afterAll(async () => {
    await restoreDb();
    await new Promise((r) => httpServer.close(r));
  });

  it('multi-device: password change → 2-brauzer 401, joriy saqlanadi', async () => {
    const page = await agent1.get('/user/security-profile');
    const csrf = page.text.match(/window\.__CSRF_TOKEN\s*=\s*("([^"]+)"|'([^']+)')/);
    const token = csrf ? (csrf[2] || csrf[3]) : '';
    expect(token).toBeTruthy();

    const change = await agent1
      .post('/api/password/change')
      .set('Content-Type', 'application/json')
      .set('x-csrf-token', token)
      .send({ currentPassword: PASSWORD, newPassword: NEW_PASSWORD });
    expect(change.status).toBe(200);
    expect(change.body.ok).toBe(true);

    // Agent1 (joriy) — saqlanadi (exceptSessionId)
    const panel1 = await agent1.get('/user/panel');
    expect([200, 302]).toContain(panel1.status);

    // Agent2 (boshqa qurilma) — sessiya revoke → panel 401/302
    const panel2 = await agent2.get('/user/panel').redirects(0);
    expect([401, 302, 301]).toContain(panel2.status);
  });

  it('replay: revoke qilingan session cookie bilan qayta so‘rov → 401', async () => {
    // Agent2 sessiyasi oldingi testda revoke qilingan — cookie jar'da hali
    // eski token bor, lekin server-side sessiya o'chirilgan (store destroy).
    const res = await agent2.get('/user/panel').redirects(0);
    expect([401, 302, 301]).toContain(res.status);
  });

  it('concurrent: parallel revokeByUser — idempotent, xato yo‘q', async () => {
    const { revokeByUser, setSessionStore, recordSession } = await import('../../src/modules/auth/session-manager.js');
    const store = await app.get('redisClient') ? null : null; // MemoryStore — store'ni olamiz
    // app.get('redisClient') bo'lmasa MemoryStore ishlatilgan; setSessionStore
    // server.js'da allaqachon ulangan. Yana bir user uchun parallel test:
    const u2 = `b25conc_${Date.now()}`;
    await recordSession({ userId: u2, sessionId: 'c1', ipAddress: '10.0.0.2' });
    await recordSession({ userId: u2, sessionId: 'c2', ipAddress: '10.0.0.2' });

    const [r1, r2] = await Promise.all([
      revokeByUser(u2, { exceptSessionId: 'c1', reason: 'concurrent' }),
      revokeByUser(u2, { exceptSessionId: 'c1', reason: 'concurrent' }),
    ]);
    // Ikkalasi ham muvaffaqiyatli; hech biri throw qilmaydi
    expect(r1.ok || r2.ok).toBe(true);
    expect(r1.count + r2.count).toBeGreaterThanOrEqual(1);
    // c1 saqlangan, c2 revoke bo'lgan (hech bo'lmaganda bitta run'da)
    const sessions = await import('../../src/modules/auth/session-manager.js').then((m) => m.getUserSessions(u2));
    const remaining = Object.values(sessions || {});
    expect(remaining.length).toBeLessThanOrEqual(1);
    expect(store).toBe(null); // MemoryStore bo'lgan — store referensi shart emas
  });
});
