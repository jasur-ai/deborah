/**
 * AUTH B-13 — Invite accept (Google + parol) + enrollment
 * -------------------------------------------------------------------
 * Integration:
 *  - Google accept: /auth/google?invite={64-hex} → callback → google-setup
 *    POST → invite USED + usedBy + enrollment + invite_status accepted
 *  - Replay: bitta invite boshqa Google account bilan → setup xato, account YO'Q
 *  - Parol replay: accept ikki marta → 409 Conflict
 *  - Expired invite Google bilan → xato (muddati), account YO'Q
 *  - 64-hex hash sessiyada to'liq saqlanadi (48 kesilmaydi)
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { snapshotDb, restoreDb } from '../helpers/setup.js';
import { fb } from '../../firebase/admin.js';
import { safeKey } from '../../utils/helpers.js';
import { createStagingSession, addParsedRows, saveColumnMapping } from '../../src/modules/roster/index.js';
import { createInvitesForSession } from '../../src/modules/roster/invites.js';

const PORT = vi.hoisted(() => 34773);
vi.hoisted(() => {
  process.env.GOOGLE_CLIENT_ID = 'b13-test.apps.googleusercontent.com';
  process.env.GOOGLE_CLIENT_SECRET = 'b13-test-secret';
  process.env.GOOGLE_REDIRECT_URI = 'http://localhost:34773/auth/google/callback';
});

let mockGoogleUser = {
  sub: 'gsub-b13-1', email: 'b13-1@test.uz', emailVerified: true,
  name: 'B13 User', picture: '',
};
vi.mock('../../src/modules/auth/oidc.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    completeOidcLogin: vi.fn(async () => ({
      success: true,
      needsSetup: true,
      googleUser: mockGoogleUser,
    })),
  };
});

let app;
let httpServer;
let base;
let invites = {}; // identity -> invite

const MAPPING = {
  student_id: { field: 'userId', entity: 'user', required: true },
  email_col: { field: 'email', entity: 'user', required: false },
};
const ROWS = [
  { rowIndex: 2, data: { student_id: 'B13Y001', email_col: 'b13y001@test.uz', fan: 'Fizika', guruh: '2-guruh' } },
  { rowIndex: 3, data: { student_id: 'B13Y003', email_col: 'b13y003@test.uz', fan: 'Informatika', guruh: '3-guruh' } },
  { rowIndex: 4, data: { student_id: 'B13Y004', email_col: 'b13y004@test.uz', fan: 'Biologiya', guruh: '4-guruh' } },
];

beforeAll(async () => {
  await snapshotDb();
  const { createApp } = await import('../../server.js');
  const created = await createApp();
  app = created.app;
  httpServer = created.httpServer;
  await new Promise((r) => httpServer.listen(PORT, r));
  base = `http://localhost:${PORT}`;

  const sid = await createStagingSession({
    filename: `b13-${Date.now()}.xlsx`, extension: '.xlsx', fileSize: 100,
    uploadedBy: 'admin', totalRows: ROWS.length, totalSheets: 1, warnings: [],
  });
  await saveColumnMapping(sid, MAPPING);
  await addParsedRows(sid, 'Sheet1', ROWS);
  const { commitStagingSession } = await import('../../src/modules/roster/index.js');
  const res = await commitStagingSession(sid, 'admin');
  if (!res.ok) throw new Error(`commit failed: ${res.error}`);
  const createdInvites = await createInvitesForSession(sid);
  expect(createdInvites.created).toBe(3);

  const snap = await fb.get('invites');
  for (const inv of Object.values(snap.val()).filter((i) => i.sessionId === sid)) {
    invites[inv.identity] = inv;
  }
});

afterAll(async () => {
  await restoreDb();
  await new Promise((r) => httpServer.close(r));
});

function freshGoogle(tag) {
  const stamp = Date.now() % 1000000;
  mockGoogleUser = {
    sub: `gsub-${tag}-${stamp}`,
    email: `b13-${tag}-${stamp}@test.uz`,
    emailVerified: true,
    name: `User ${tag}`,
    picture: '',
  };
  return mockGoogleUser;
}

async function runCallback(agent) {
  return agent
    .get('/auth/google/callback?code=test-code&state=test-state')
    .set('Host', `localhost:${PORT}`);
}

async function googleSetupCsrf(agent) {
  const page = await agent.get('/user/google-setup');
  const m = page.text.match(/name="_csrf"\s+value="([^"]+)"/);
  return { page, csrf: m ? m[1] : '' };
}

describe('AUTH B-13 — Google accept + enrollment', () => {
  it('Google accept: 64-hex hash sessiyada to\'liq; invite USED + enrollment', async () => {
    const supertest = await import('supertest');
    const agent = supertest.default.agent(app);
    const inv = invites.B13Y001;
    expect(inv.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    freshGoogle('acc');

    // 1. GET /auth/google?invite={64-hex} → session oidcInvite (to'liq 64)
    const start = await agent.get(`/auth/google?invite=${inv.tokenHash}`);
    expect(start.status).toBe(302);
    // 2. callback → pendingGoogle
    const cb = await runCallback(agent);
    expect(cb.status).toBe(302);
    expect(cb.headers.location).toContain('/user/google-setup');
    // 3. Setup sahifasi — invite prefilled (48'ga kesilmagan!)
    const { csrf, page } = await googleSetupCsrf(agent);
    expect(page.status).toBe(200);
    expect(page.text).toContain(`value="${inv.tokenHash}"`);

    // 4. POST role=student, invite body'da emas — pending.invite ishlaydi
    const post = await agent
      .post('/user/google-setup')
      .type('form')
      .send({ _csrf: csrf, lang: 'uz', role: 'student', invite: '' });
    expect(post.status).toBe(302);
    expect(post.headers.location).toContain('/user/panel');

    // User yaratildi + invite accepted
    const userKey = safeKey(`google:${mockGoogleUser.sub}`);
    const user = await fb.get(`users/${userKey}`);
    expect(user.exists()).toBe(true);
    expect(user.val().invite_status).toBe('accepted');
    expect(user.val().group).toBe('2-guruh');
    expect(user.val().role).toBe('student');

    // Invite USED + usedBy + usedProvider google
    const after = await fb.get(`invites/${inv.tokenHash}`);
    expect(after.val().status).toBe('used');
    expect(after.val().usedBy).toBe(userKey);
    expect(after.val().usedProvider).toBe('google');

    // Enrollment
    const enroll = await fb.get(`enrollments/${userKey}_Fizika`);
    expect(enroll.exists()).toBe(true);
    expect(enroll.val().groupCode).toBe('2-guruh');
  });

  it('Replay: bitta invite boshqa Google account bilan → xato, account YO\'Q', async () => {
    const supertest = await import('supertest');
    const agent = supertest.default.agent(app);
    const inv = invites.B13Y001; // avvalgi testda USED bo'ldi
    freshGoogle('rep');

    await runCallback(agent);
    const { csrf } = await googleSetupCsrf(agent);
    const post = await agent
      .post('/user/google-setup')
      .type('form')
      .send({ _csrf: csrf, lang: 'uz', role: 'student', invite: inv.tokenHash });
    // Setup sahifasida qayta render + xato (account yaratilmaydi)
    expect(post.status).toBe(200);
    expect(post.text).toContain('allaqachon ishlatilgan');

    // Ikkinchi account YO'Q
    const user2 = await fb.get(`users/${safeKey(`google:${mockGoogleUser.sub}`)}`);
    expect(user2.exists()).toBe(false);
  });

  it('Parol replay: accept ikki marta → 409 Conflict', async () => {
    const inv = invites.B13Y003;
    const username = `b13rep_${Date.now() % 100000}`;
    const body = { token: inv.tokenHash, username, password: 'parol-2026-x-uzun', consent: true };

    const r1 = await fetch(`${base}/api/roster/invites/accept`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    expect(r1.status).toBe(200);
    const b1 = await r1.json();
    expect(b1.ok).toBe(true);

    const r2 = await fetch(`${base}/api/roster/invites/accept`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    expect(r2.status).toBe(409);
    const b2 = await r2.json();
    expect(b2.ok).toBe(false);
    expect(b2.error).toContain('ishlatilgan');
  });

  it('Expired invite Google bilan → xato (muddati), account YO\'Q', async () => {
    const supertest = await import('supertest');
    const agent = supertest.default.agent(app);
    const inv = invites.B13Y004;
    await fb.set(`invites/${inv.tokenHash}/expiresAt`, Date.now() - 1000);
    freshGoogle('exp');

    await runCallback(agent);
    const { csrf } = await googleSetupCsrf(agent);
    const post = await agent
      .post('/user/google-setup')
      .type('form')
      .send({ _csrf: csrf, lang: 'uz', role: 'student', invite: inv.tokenHash });
    expect(post.status).toBe(200);
    expect(post.text).toContain('muddati');

    const user = await fb.get(`users/${safeKey(`google:${mockGoogleUser.sub}`)}`);
    expect(user.exists()).toBe(false);
  });
});
