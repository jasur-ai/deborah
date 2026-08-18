/**
 * AUTH D-17 §08/§12 — Journey: teacher register → pending → approve → teacher;
 * HEMIS roster staging → commit (B-14/15/16, A-10/11, C-11)
 * ---------------------------------------------------------------------------
 * End-to-end HTTP oqim (in-process supertest — child server emas, flake yo'q):
 *  1. Teacher register (role=teacher + university/subject/reason) → teacher_pending.
 *  2. Admin login + reauth → approve → role=teacher (role_version++).
 *  3. Eski sessiya bekor (A-31 fix); qayta login → /teacher.
 *  4. HEMIS CSV upload (admin sessiyasi — MFA step-up bypass) → map → preview → commit
 *     → DB'da user/enroll yaratildi (A-11 idempotency hash qayta commit'da reject).
 * Manba: B-14 §05, B-15, B-16, A-19, A-25 §09, A-10 §26, A-11 §10, C-11.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import supertest from 'supertest';
import { createApp } from '../../../server.js';
import { snapshotDb, restoreDb } from '../../helpers/setup.js';
import { fb } from '../../../firebase/admin.js';

let app, httpServer;
let xff = '203.0.113.180';
function nextIp() {
  xff = `203.0.113.${180 + (Math.floor(Math.random() * 1000) % 60)}`;
  return xff;
}
function csrfFrom(html) {
  const m = html.match(/name="_csrf" value="([^"]+)"/);
  return m ? m[1] : null;
}
function csrfFromAdminPage(html) {
  const m = html.match(/const CSRF = "([^"]*)"/);
  return m ? m[1] : null;
}

async function loginAsAdmin(agent) {
  const page = await agent.get('/admin/login');
  const csrf = csrfFrom(page.text);
  const login = await agent.post('/admin/login').set('x-forwarded-for', nextIp()).type('form').send({
    _csrf: csrf,
    username: process.env.ADMIN_USER || 'admin',
    password: process.env.ADMIN_PASS || 'admin',
  });
  expect([302, 200]).toContain(login.status);
  const tpage = await agent.get('/admin/teachers');
  return { csrf: csrfFromAdminPage(tpage.text), page: tpage };
}

async function adminReauth(agent, csrf) {
  const r = await agent
    .post('/api/admin/reauth')
    .set('x-csrf-token', csrf || 'x')
    .set('x-forwarded-for', xff)
    .send({ password: process.env.ADMIN_PASS || 'admin' });
  expect(r.status).toBe(200);
  expect(r.body.ok).toBe(true);
}

const HEMIS_CSV = 'talaba_id,F.I.Sh,guruh,kurs,fan\nJ0001,Aliyev Ali,A,2026,MATH101\nJ0002,Valiyev Vali,A,2026,MATH101\n';

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

describe('AUTH D-17 §08 — teacher approval journey', () => {
  it('teacher register → teacher_pending → admin approve → teacher → /teacher', async () => {
    const agent = supertest.agent(app);
    const uname = `jthr_${Date.now() % 1000000}`;
    const page = await agent.get('/user/register');
    const csrf = page.text.match(/name="_csrf" value="([^"]+)"/);
    const reg = await agent.post('/user/login').set('x-forwarded-for', nextIp()).type('form').send({
      _csrf: csrf ? csrf[1] : '',
      lang: 'uz', mode: 'reg', consent: 'on',
      username: uname, email: `${uname}@test.uz`, password: 'sirli-parol-2026-x',
      role: 'teacher', university: 'TATU', subject: 'Informatika', reason: 'Dars beraman',
    });
    expect([302, 303]).toContain(reg.status);

    // DB: teacher_pending + ariza yozildi
    const user = await fb.get(`users/${uname}`);
    expect(user.val().role).toBe('teacher_pending');
    expect(user.val().teacher_application.university).toBe('TATU');
    expect(user.val().teacher_application.subject).toBe('Informatika');

    // Cheklangan rejim ekrani
    const statusPage = await agent.get('/user/teacher-approval');
    expect(statusPage.status).toBe(200);

    // Admin approve (A-25: reauth + justification majburiy)
    const admin = supertest.agent(app);
    const { csrf: acsrf } = await loginAsAdmin(admin);
    await adminReauth(admin, acsrf);
    const approve = await admin
      .post(`/admin/api/teachers/${uname}/approve`)
      .set('x-csrf-token', acsrf)
      .set('x-forwarded-for', xff)
      .send({ justification: 'Diplom va tajriba tekshirildi, mos keldi' });
    expect(approve.status).toBe(200);
    expect(approve.body.ok).toBe(true);

    // DB: role teacher + role_version oshdi
    const after = await fb.get(`users/${uname}`);
    expect(after.val().role).toBe('teacher');
    expect(after.val().role_version).toBeGreaterThan(1);

    // Eski (teacher_pending) sessiya bekor — 401 yoki 302 → login
    const stale = await agent.get('/user/teacher-approval');
    if (stale.status === 401) {
      expect(stale.body.error).toBeTruthy();
    } else {
      expect(stale.status).toBe(302);
      expect(stale.headers.location).toContain('/user/login');
    }

    // Qayta login → /teacher
    const agent2 = supertest.agent(app);
    const loginPage = await agent2.get('/user/login?lang=uz');
    const lcsrf = csrfFrom(loginPage.text);
    const login = await agent2.post('/user/login').set('x-forwarded-for', nextIp()).type('form').send({
      _csrf: lcsrf, username: uname, password: 'sirli-parol-2026-x', lang: 'uz',
    });
    expect(login.status).toBe(302);
    expect(login.headers.location).toBe('/teacher');
  });
});

describe('AUTH D-17 §12 — HEMIS roster journey (admin sessiya)', () => {
  it('upload → map → preview → commit → DB user/enroll yaratildi; qayta commit reject', async () => {
    const admin = supertest.agent(app);
    const { csrf: acsrf } = await loginAsAdmin(admin);
    await adminReauth(admin, acsrf);

    // 1) Upload (multipart CSV) — admin sessiya MFA step-up'ni bypass qiladi (C-11)
    const up = await admin
      .post('/api/roster/upload')
      .set('x-csrf-token', acsrf)
      .set('x-forwarded-for', xff)
      .attach('file', Buffer.from(HEMIS_CSV, 'utf-8'), 'hemis.csv');
    expect(up.status).toBe(201);
    const { sessionId } = up.body;
    expect(sessionId).toBeTruthy();

    // 2) Map — avto-detect (A-11)
    const mapRes = await admin
      .post(`/api/roster/sessions/${sessionId}/map`)
      .set('x-csrf-token', acsrf)
      .send({});
    expect(mapRes.status).toBe(200);
    expect(mapRes.body.autoDetected).toBe(true);
    expect(mapRes.body.unmapped.length).toBe(0);

    // 3) Preview — idempotency hash olamiz
    const preview = await admin
      .get(`/api/roster/sessions/${sessionId}/preview`)
      .set('x-csrf-token', acsrf);
    expect(preview.status).toBe(200);
    const hash = preview.body.hash;
    expect(hash).toBeTruthy();

    // 4) Commit → DB'da user/enroll (A-11 §10)
    const commit = await admin
      .post(`/api/roster/sessions/${sessionId}/commit`)
      .set('x-csrf-token', acsrf)
      .send({ hash });
    expect(commit.status).toBe(200);
    expect(commit.body.ok).toBe(true);
    expect(commit.body.stats.createdUsers).toBe(2);

    // safeKey → lowercase ('j0001'); ism display_name'da (username kolonkasi yo'q)
    const u1 = await fb.get('users/j0001');
    expect(u1.exists()).toBe(true);
    expect(u1.val().display_name).toBe('Aliyev Ali');
    expect(u1.val().role).toBe('student');

    // 5) Qayta commit — idempotency hash reject (A-11 §10)
    const replay = await admin
      .post(`/api/roster/sessions/${sessionId}/commit`)
      .set('x-csrf-token', acsrf)
      .send({ hash });
    expect([400, 409]).toContain(replay.status);
  });
});
