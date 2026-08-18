/**
 * AUTH B-36 — Teacher extra e2e: appeal, bulk invite, co-teacher scope
 * ---------------------------------------------------------------------
 *  1. Appeal: rejected teacher → cooldown 429 → (vaqt o'tdi) → appeal 200 →
 *     admin queue'da yangi ariza
 *  2. Bulk invite: admin CSV upload → report {created, skipped, errors};
 *     qayta upload → duplicate skip
 *  3. Co-teacher: owner qo'shadi; boshqa teacher → course_owned 403;
 *     boshqa kursga GET → 403 (scope)
 *  4. Escalation: co_teacher rol admin emas, co-teacher qo'sha olmaydi
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { snapshotDb, restoreDb } from '../helpers/setup.js';
import { createApp } from '../../server.js';
import supertest from 'supertest';
import { fb } from '../../firebase/admin.js';
import { safeKey } from '../../utils/helpers.js';

const PW = 'parol-2026-x-uzun';

let app;
let httpServer;

beforeAll(async () => {
  await snapshotDb();
  const created = await createApp();
  app = created.app;
  httpServer = created.httpServer;
  await new Promise((r) => httpServer.listen(0, r));
});

afterAll(async () => {
  await restoreDb();
  await new Promise((r) => httpServer.close(r));
});

function csrfFrom(html) {
  const m = html.match(/name="_csrf"\s+value="([^"]+)"/);
  return m ? m[1] : '';
}

async function registerTeacher({ username, email, university = 'Toshkent Davlat Universiteti', subject = 'Matematika' }) {
  const agent = supertest.agent(app);
  const page = await agent.get('/user/register');
  const csrf = csrfFrom(page.text);
  const r = await agent.post('/user/login').type('form').set('x-forwarded-for', '203.0.113.42').send({
    _csrf: csrf, lang: 'uz', mode: 'reg', consent: 'on', username, email, password: PW,
    role: 'teacher', university, subject, experience: '5',
  });
  expect(r.status).toBe(302);
  return agent;
}

async function loginUser(username) {
  const agent = supertest.agent(app);
  const page = await agent.get('/user/login');
  const csrf = csrfFrom(page.text);
  const r = await agent.post('/user/login').type('form').set('x-forwarded-for', '203.0.113.43').send({
    _csrf: csrf, lang: 'uz', mode: 'login', username, password: PW,
  });
  expect([302, 200]).toContain(r.status);
  // pending/rejected teacher'lar panel'ga kira olmaydi — teacher-approval
  // sahifasidan CSRF olamiz (fallback).
  let csrfPage = await agent.get('/user/panel');
  let m = csrfPage.text.match(/__CSRF_TOKEN\s*=\s*'([^']+)'/);
  if (!m) {
    csrfPage = await agent.get('/user/teacher-approval');
    m = csrfPage.text.match(/__CSRF_TOKEN\s*=\s*'([^']+)'/);
  }
  agent.__csrf = m ? m[1] : '';
  return agent;
}

async function adminAgent() {
  const admin = supertest.agent(app);
  const page = await admin.get('/admin/login');
  const csrf = csrfFrom(page.text);
  const adminUser = process.env.ADMIN_USER || 'admin';
  const adminPass = process.env.ADMIN_PASS || 'admin';
  const alr = await admin.post('/admin/login').set('x-forwarded-for', '198.51.100.200').type('form').send({
    _csrf: csrf, username: adminUser, password: adminPass,
  });
  expect([302, 200]).toContain(alr.status);
  const dash = await admin.get('/admin');
  const m = dash.text.match(/__CSRF_TOKEN\s*=\s*'([^']+)'/) || dash.text.match(/const CSRF = '([^']+)'/);
  admin.__csrf = m ? m[1] : '';
  await admin.post('/api/admin/reauth').send({ password: adminPass }).set('x-csrf-token', admin.__csrf);
  return admin;
}

/** Admin: teacher'ni rad etish / tasdiqlash (teachers queue). */
const JUST = 'Test qarori — sabab yetarli (B-36 test)';
async function decideTeacher(admin, username, decision) {
  const q = await admin.get('/admin/api/teachers/pending');
  const pending = q.body.pending || q.body.teachers || [];
  const mine = pending.find((p) => p.username === username || p.userKey === username);
  if (!mine) throw new Error(`pending da topilmadi: ${username}`);
  const r = await admin.post(`/admin/api/teachers/${mine.id}/${decision}`)
    .set('x-csrf-token', admin.__csrf)
    .send({ justification: JUST });
  expect([200, 302]).toContain(r.status);
}

describe('AUTH B-36 — appeal flow', () => {
  it('rejected teacher: cooldown active → 429; vaqt o\'tgach appeal → 200 + admin queue', async () => {
    const stamp = Date.now() % 1000000;
    const uname = `b36ap${stamp}`;
    await registerTeacher({ username: uname, email: `${uname}@test.uz` });

    // Admin rad etadi
    const admin = await adminAgent();
    await decideTeacher(admin, uname, 'reject');

    // Sessiyani yangilash (role o'zgargan)
    const agent = await loginUser(uname);

    // Cooldown faol → 429
    const c = await agent.post('/api/teacher/appeal')
      .set('x-csrf-token', agent.__csrf)
      .send({ reason: 'Rad etish qarori bilan rozi emasman, sabab noto\'g\'ri tushunilgan.' });
    expect(c.status).toBe(429);
    expect(c.body.error).toBe('cooldown_active');

    // Vaqt o'tdi (teacher_decision_at 40 kun oldin)
    await fb.set(`users/${safeKey(uname)}/teacher_decision_at`, Date.now() - 40 * 86400000);

    const a = await agent.post('/api/teacher/appeal')
      .set('x-csrf-token', agent.__csrf)
      .send({ reason: 'Rad etish qarori bilan rozi emasman, sabab noto\'g\'ri tushunilgan.' });
    expect(a.status).toBe(200);
    expect(a.body.ok).toBe(true);

    // Admin queue'da yangi pending ariza
    const q = await admin.get('/admin/api/teachers/pending');
    const list = q.body.pending || q.body.teachers || [];
    expect(list.some((p) => p.username === uname || p.userKey === uname)).toBe(true);
  });

  it('qisqa sabab (<20) → 400 (cooldown o\'tgach); teacher_pending user → 403', async () => {
    const stamp = Date.now() % 1000000;
    const uname = `b36x${stamp}`;
    await registerTeacher({ username: uname, email: `${uname}@test.uz` });
    // Hali rejected emas — 403
    const agent = await loginUser(uname);
    const before = await agent.post('/api/teacher/appeal').set('x-csrf-token', agent.__csrf).send({ reason: 'qisqa sabab xxxxxxxx' });
    expect(before.status).toBe(403);
    expect(before.body.error).toBe('only_rejected_teacher');

    // Reject + cooldown o'tdi → qisqa sabab 400
    const admin = await adminAgent();
    await decideTeacher(admin, uname, 'reject');
    await fb.set(`users/${safeKey(uname)}/teacher_decision_at`, Date.now() - 40 * 86400000);
    const agent2 = await loginUser(uname);
    const r = await agent2.post('/api/teacher/appeal').set('x-csrf-token', agent2.__csrf).send({ reason: 'qisqa' });
    expect(r.status).toBe(400);
    expect(r.body.error).toBe('reason_length');
  });
});

describe('AUTH B-36 — bulk teacher invite (admin)', () => {
  it('CSV upload → report; qayta upload → duplicate skip', async () => {
    const admin = await adminAgent();
    const stamp = Date.now() % 1000000;

    const csv = [
      'email,ism',
      `bulk1_${stamp}@test.uz,Bir`,
      `bulk2_${stamp}@test.uz,Ikki`,
      'not-valid-email,Uch',
    ].join('\n');

    const r1 = await admin.post('/admin/api/teachers/bulk-invite')
      .set('x-csrf-token', admin.__csrf)
      .attach('file', Buffer.from(csv, 'utf8'), { filename: 'teachers.csv', contentType: 'text/csv' });
    expect(r1.status).toBe(200);
    expect(r1.body.report.created).toBe(2);
    expect(r1.body.report.invalid).toBe(1);
    expect(r1.body.report.parsed).toBe(2);

    // Qayta upload — hammasi duplicate skip
    const r2 = await admin.post('/admin/api/teachers/bulk-invite')
      .set('x-csrf-token', admin.__csrf)
      .attach('file', Buffer.from(csv, 'utf8'), { filename: 'teachers.csv', contentType: 'text/csv' });
    expect(r2.status).toBe(200);
    expect(r2.body.report.created).toBe(0);
    expect(r2.body.report.skipped).toBe(2);
  });
});

describe('AUTH B-36 — co-teacher scope', () => {
  it('owner qo\'shadi; boshqa teacher course_owned 403; boshqa kurs 403', async () => {
    const stamp = Date.now() % 1000000;
    const own = `b36o${stamp}`;
    const other = `b36p${stamp}`;
    await registerTeacher({ username: own, email: `${own}@test.uz` });
    await registerTeacher({ username: other, email: `${other}@test.uz` });

    // Admin ikkalasini ham tasdiqlaydi
    const admin = await adminAgent();
    await decideTeacher(admin, own, 'approve');
    await decideTeacher(admin, other, 'approve');

    const a = await loginUser(own);
    const add = await a.post('/api/teacher/co-teachers').set('x-csrf-token', a.__csrf)
      .send({ courseCode: 'math-101', email: `cot1_${stamp}@test.uz`, name: 'Co' });
    expect([200, 409]).toContain(add.status); // limit yoki ok

    // Boshqa teacher — kurs tegishli emas → 403
    const b = await loginUser(other);
    const steal = await b.post('/api/teacher/co-teachers').set('x-csrf-token', b.__csrf)
      .send({ courseCode: 'math-101', email: `cot2_${stamp}@test.uz` });
    expect(steal.status).toBe(403);
    expect(steal.body.error).toBe('course_owned');

    // Owner ro'yxatni ko'radi; boshqa teacher boshqa kursda → 403 (scope)
    const mine = await a.get('/api/teacher/co-teachers?courseCode=math-101');
    expect([200, 403]).toContain(mine.status);
    if (mine.status === 200) {
      expect(mine.body.owner).toBe(safeKey(own));
    }
    const wrongCourse = await b.get('/api/teacher/co-teachers?courseCode=math-101');
    expect(wrongCourse.status).toBe(403);
  });
});

describe('AUTH B-36 — escalation yo\'q', () => {
  it('co_teacher rol: co-teacher qo\'sha olmaydi, admin\'ga kira olmaydi', async () => {
    // To'g'ridan-to'g'ri co_teacher rol'li user yaratamiz (accept oqimi unit'da)
    const uname = `b36co${Date.now() % 1000000}`;
    await fb.set(`users/${safeKey(uname)}`, { username: uname, password: PW, role: 'co_teacher', email: `${uname}@test.uz` });
    await fb.set(`users_email_index/${safeKey(`${uname}@test.uz`)}`, safeKey(uname));

    const agent = await loginUser(uname);
    const add = await agent.post('/api/teacher/co-teachers').set('x-csrf-token', agent.__csrf)
      .send({ courseCode: 'x', email: 'y@test.uz' });
    expect(add.status).toBe(403);
    expect(add.body.error).toBe('teacher_only');

    // Admin API'ga kira olmaydi (401/302 — sessiya admin emas)
    const adminApi = await agent.get('/admin/api/signup-reviews');
    expect([302, 401, 403]).toContain(adminApi.status);
  });
});
