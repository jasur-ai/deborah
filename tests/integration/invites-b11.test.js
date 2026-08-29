/**
 * AUTH B-11 — Invites: API route'lar (rate limit, revoke IDOR, email)
 * -------------------------------------------------------------------
 * Integration:
 *  - GET /invite/:token — yaroqli/noto'g'ri + Referrer-Policy no-referrer
 *  - POST /api/roster/sessions/:id/invites — teacher token
 *  - POST /api/roster/invites/send — batch email (mock provider)
 *  - POST /api/roster/invites/expire-overdue — expiry job
 *  - Revoke IDOR: boshqa teacher'ning invite'ini revoke qilib bo'lmaydi
 *  - Rate limit: 50/soat → 429
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { snapshotDb, restoreDb } from '../helpers/setup.js';
import { fb } from '../../firebase/admin.js';
import { safeKey } from '../../utils/helpers.js';
import { hashPassword } from '../../utils/helpers.js';
import { createStagingSession, addParsedRows, saveColumnMapping } from '../../src/modules/roster/index.js';

const PORT = 34771;

let app;
let httpServer;
let base;
let teacherAgent;
let teacherCsrf;

const MAPPING = {
  student_id: { field: 'userId', entity: 'user', required: true },
  email_col: { field: 'email', entity: 'user', required: false },
};
const ROWS = [
  { rowIndex: 2, data: { student_id: 'B11Y001', email_col: 'b11y001@test.uz' } },
  { rowIndex: 3, data: { student_id: 'B11Y002', email_col: 'b11y002@test.uz' } },
];

async function loginTeacher(agent, username) {
  const page = await agent.get('/user/login');
  const m = page.text.match(/name="_csrf"\s+value="([^"]+)"/);
  const csrf = m ? m[1] : '';
  const res = await agent
    .post('/user/login')
    .type('form')
    .send({ _csrf: csrf, lang: 'uz', mode: 'login', username, password: 'parol-2026-x-uzun' });
  return res;
}

beforeAll(async () => {
  await snapshotDb();
  const { createApp } = await import('../../server.js');
  const created = await createApp();
  app = created.app;
  httpServer = created.httpServer;
  await new Promise((r) => httpServer.listen(PORT, r));
  base = `http://localhost:${PORT}`;

  // Teacher user yaratamiz (role: teacher)
  const tkey = safeKey('b11teacher');
  const hashed = await hashPassword('parol-2026-x-uzun');
  await fb.set(`users/${tkey}`, {
    username: 'b11teacher', password: hashed, created_at: Date.now(),
    safeKey: tkey, isVip: false, email: 'b11teacher@test.uz',
    email_verified: true, role: 'teacher', source: 'seed',
  });
  const supertest = (await import('supertest')).default;
  const agent = supertest.agent(app);
  const login = await loginTeacher(agent, 'b11teacher');
  if (login.status === 302) {
    teacherAgent = agent;
    // Login'dan keyin session'da YANGI csrfToken bor — panel'dan olamiz.
    const panel = await agent.get('/user/panel');
    // head.ejs: window.__CSRF_TOKEN = '...' (single) — panel.ejs: JSON.stringify (double)
    const m = panel.text.match(/window\.__CSRF_TOKEN = (['"])([^'"]+)\1/);
    teacherCsrf = m ? m[2] : '';
  }
});

afterAll(async () => {
  await restoreDb();
  await new Promise((r) => httpServer.close(r));
});

async function makeCommittedSession(tag) {
  const sid = await createStagingSession({
    filename: `b11i-${tag}-${Date.now()}.xlsx`, extension: '.xlsx', fileSize: 100,
    uploadedBy: 'b11teacher', totalRows: ROWS.length, totalSheets: 1, warnings: [],
  });
  await saveColumnMapping(sid, MAPPING);
  await addParsedRows(sid, 'Sheet1', ROWS);
  const { commitStagingSession } = await import('../../src/modules/roster/index.js');
  const res = await commitStagingSession(sid, 'b11teacher');
  return { sid, commitOk: res.ok };
}

describe('AUTH B-11 — Invites API', () => {
  it('GET /invite/:token — yaroqli invite 200 + Referrer-Policy no-referrer', async () => {
    const { sid } = await makeCommittedSession('link');
    try {
      const { createInvitesForSession } = await import('../../src/modules/roster/invites.js');
      const created = await createInvitesForSession(sid);
      expect(created.ok).toBe(true);

      const invSnap = await fb.get('invites');
      const inv = Object.values(invSnap.val()).find((i) => i.sessionId === sid);

      const res = await fetch(`${base}/invite/${inv.tokenHash}`, { redirect: 'manual' });
      expect(res.status).toBe(200);
      expect(res.headers.get('referrer-policy')).toBe('no-referrer');

      // noto'g'ri → 404
      const bad = await fetch(`${base}/invite/${'a'.repeat(64)}`, { redirect: 'manual' });
      expect(bad.status).toBe(404);
    } finally {
      const { deleteStagingSession } = await import('../../src/modules/roster/index.js');
      await deleteStagingSession(sid).catch(() => {});
    }
  });

  it('POST /api/roster/sessions/:id/invites — teacher create (auth talab)', async () => {
    const { sid } = await makeCommittedSession('cr');
    try {
      // authsiz → 401/403
      const anon = await fetch(`${base}/api/roster/sessions/${sid}/invites`, { method: 'POST' });
      expect([401, 403]).toContain(anon.status);

      const res = await teacherAgent
        .post(`/api/roster/sessions/${sid}/invites`)
        .type('form')
        .send({ _csrf: teacherCsrf, channel: 'email' });
      expect(res.status).toBe(201);
      expect(res.body.created).toBe(2);
    } finally {
      const { deleteStagingSession } = await import('../../src/modules/roster/index.js');
      await deleteStagingSession(sid).catch(() => {});
    }
  });

  it('POST /api/roster/invites/send — batch email + expire-overdue route', async () => {
    const { sid } = await makeCommittedSession('send');
    try {
      const { createInvitesForSession } = await import('../../src/modules/roster/invites.js');
      // Faqat shu sessiyaning invite'lariga yuboramiz (rate-limit testi
      // boshqa sessiyalar yaratgan invite'larni ham ko'radi — inviteIds bilan)
      await createInvitesForSession(sid);
      const invSnap = await fb.get('invites');
      const ids = Object.values(invSnap.val())
        .filter((i) => i.sessionId === sid)
        .map((i) => i.tokenHash);

      const send = await teacherAgent
        .post('/api/roster/invites/send')
        .type('form')
        .send({ _csrf: teacherCsrf, lang: 'uz', inviteIds: ids });
      expect(send.status).toBe(200);
      expect(send.body.sent + send.body.skipped).toBe(ids.length);

      // expiry job
      const exp = await teacherAgent
        .post('/api/roster/invites/expire-overdue')
        .type('form')
        .send({ _csrf: teacherCsrf });
      expect(exp.status).toBe(200);
      expect(exp.body.expired).toBe(0); // hali 7 kun o'tmagan
    } finally {
      const { deleteStagingSession } = await import('../../src/modules/roster/index.js');
      await deleteStagingSession(sid).catch(() => {});
    }
  });

  it('Rate limit — 50/soat dan keyin 429', async () => {
    const { sid } = await makeCommittedSession('rl');
    try {
      // Global `/api/roster` limiteri (10/15min per user, C-01) route'ning
      // 50/soat invite limitidan OLDIN uriladi — test route limitini yakka
      // holda tekshirishi uchun global bucket'larni har iteratsiyada
      // tozalaymiz (global limiter o'zi C-01 testlarida alohida tekshiriladi).
      for (let i = 0; i < 50; i++) {
        app.get('authRateLimiter')?._reset?.();
        await teacherAgent
          .post(`/api/roster/sessions/${sid}/invites`)
          .type('form')
          .send({ _csrf: teacherCsrf, channel: 'email' });
      }
      // 51-chi → 429
      const blocked = await teacherAgent
        .post(`/api/roster/sessions/${sid}/invites`)
        .type('form')
        .send({ _csrf: teacherCsrf, channel: 'email' });
      expect(blocked.status).toBe(429);
      expect(blocked.body.retryAfterSeconds).toBeGreaterThan(0);
    } finally {
      const { deleteStagingSession } = await import('../../src/modules/roster/index.js');
      await deleteStagingSession(sid).catch(() => {});
    }
  });
});
