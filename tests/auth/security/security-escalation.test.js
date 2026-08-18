/**
 * AUTH D-18 §07 — Security: teacher escalation + SSRF + OIDC alg confusion
 * ---------------------------------------------------------------------------
 * 1. Teacher escalation: student → /teacher workspace → 403/404 (stealth);
 *    teacher_pending/rejected → workspace'ga kira olmaydi (A-19 §14).
 * 2. SSRF: opendata fetch allowlist — ruxsat etilmagan host → ssrf_blocked;
 *    HEMIS base URL private/localhost → private_host (hemis-a15 qo'shimcha).
 * 3. OIDC alg confusion: HS256 imzolangan id_token → 'alg' rad (A-24 §06).
 * Manba: A-19 §14, A-24 §06, D-18 §07 (§07 SSRF/alg/escalation).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import supertest from 'supertest';
import { createApp } from '../../../server.js';
import { snapshotDb, restoreDb } from '../../helpers/setup.js';
import { fb } from '../../../firebase/admin.js';

let app, httpServer;
let xff = '203.0.113.240';
function nextIp() {
  xff = `203.0.113.${240 + (Math.floor(Math.random() * 1000) % 20)}`;
  return xff;
}
function csrfFrom(html) {
  const m = html.match(/name="_csrf" value="([^"]+)"/);
  return m ? m[1] : null;
}

async function register(agent, { username, email, role = '', extra = {} }) {
  const page = await agent.get('/user/register');
  const csrf = page.text.match(/name="_csrf" value="([^"]+)"/);
  const res = await agent.post('/user/login').set('x-forwarded-for', nextIp()).type('form').send({
    _csrf: csrf ? csrf[1] : '',
    lang: 'uz', mode: 'reg', consent: 'on',
    username, password: 'sirli-parol-2026-x', email,
    ...(role ? { role } : {}),
    ...extra,
  });
  expect([302, 303]).toContain(res.status);
}

beforeAll(async () => {
  await snapshotDb();
  const created = await createApp();
  app = created.app;
  httpServer = created.httpServer;
  await new Promise((r) => httpServer.listen(0, r));
});
afterAll(async () => {
  if (httpServer) await new Promise((r) => httpServer.close(r));
  await restoreDb();
});

describe('AUTH D-18 §07 — teacher escalation', () => {
  it('student → /teacher workspace → 403 (blok)', async () => {
    const agent = supertest.agent(app);
    const uname = `sesc_${Date.now() % 1000000}`;
    await register(agent, { username: uname, email: `${uname}@test.uz` });

    const res = await agent.get('/teacher').redirects(0);
    expect([403, 302, 404]).toContain(res.status);
  });

  it('teacher_pending → workspace' + "'" + 'ga kira olmaydi (stealth)', async () => {
    const agent = supertest.agent(app);
    const uname = `sescp_${Date.now() % 1000000}`;
    await register(agent, {
      username: uname, email: `${uname}@test.uz`,
      role: 'teacher', extra: { university: 'TATU', subject: 'Matematika', reason: 'Dars beraman' },
    });

    // DB'da teacher_pending ekanini tasdiqlaymiz
    const u = await fb.get(`users/${uname}`);
    expect(u.val().role).toBe('teacher_pending');

    const res = await agent.get('/teacher').redirects(0);
    expect([403, 302, 404]).toContain(res.status);
  });
});

describe('AUTH D-18 §07 — SSRF (opendata + hemis)', () => {
  it('opendata: ruxsat etilmagan host → ssrf_blocked', async () => {
    const { fetchDatasetUrl } = await import('../../../src/modules/opendata/universities.js');
    await expect(fetchDatasetUrl('http://169.254.169.254/latest/meta-data/')).rejects.toMatchObject({
      code: 'ssrf_blocked',
    });
    await expect(fetchDatasetUrl('https://evil.example.com/data.json')).rejects.toMatchObject({
      code: 'ssrf_blocked',
    });
  });

  it('hemis: private/localhost base URL → private_host', async () => {
    const { assertSafeBaseUrl } = await import('../../../src/modules/auth/providers/hemis.js');
    expect(assertSafeBaseUrl('http://localhost:3000')).toMatchObject({ ok: false, reason: 'https_required' });
    expect(assertSafeBaseUrl('https://localhost/api')).toMatchObject({ ok: false, reason: 'private_host' });
    expect(assertSafeBaseUrl('https://10.0.0.5/api')).toMatchObject({ ok: false, reason: 'private_host' });
    expect(assertSafeBaseUrl('https://hemis.uz/api')).toMatchObject({ ok: true });
  });
});

describe('AUTH D-18 §07 — OIDC alg confusion (HS256)', () => {
  it('HS256 imzolangan id_token → alg rad (allowlist RS256)', async () => {
    const { verifyGoogleIdTokenDetailed } = await import('../../../src/modules/auth/oidc.js');
    const { SignJWT } = await import('jose');

    // Attacker client_secret bilan HS256 imzolaydi (google public key bilan emas)
    const token = await new SignJWT({ sub: 'attacker-123', email: 'x@test.uz', email_verified: true, nonce: 'abc' })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setExpirationTime('5m')
      .sign(new TextEncoder().encode('attacker-secret'));

    const r = await verifyGoogleIdTokenDetailed(token, 'abc', {
      fetchJwks: async () => ({ keys: [] }), // google keys yo'q — alg avval rad
    });
    expect(r.ok).toBe(false);
    expect(r.error).toBe('alg');
  });
});
