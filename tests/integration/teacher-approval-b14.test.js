/**
 * AUTH B-14 — Teacher approval: state machine + schema
 * -------------------------------------------------------------------
 * Integration:
 *  - teacher register → role teacher_pending + canonical teacher_applications record
 *  - admin approve → role teacher + collection approved + reviewed_by
 *  - reject → teacher_rejected + cooldown_until; cooldown faol → qayta ariza blok;
 *    cooldown o'tdi → qayta ariza → teacher_pending + YANGI record
 *  - security: non-admin approve blok; IDOR — student'ni approve qilib bo'lmaydi
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import supertest from 'supertest';
import { snapshotDb, restoreDb } from '../helpers/setup.js';
import { fb } from '../../firebase/admin.js';

let app;
let httpServer;

// A-03 register limit 5/15 per IP — har register unikal IP talab qiladi.
let xff = '203.0.113.201';
function nextIp() {
  xff = `203.0.113.${201 + (Math.floor(Math.random() * 1000) % 54)}`; // 201–254 (255+ invalid IP)
  return xff;
}

function csrfFrom(html) {
  const m = html.match(/name="_csrf" value="([^"]+)"/);
  return m ? m[1] : null;
}
function csrfFromTeachersPage(html) {
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
  return { csrf: csrfFromTeachersPage(tpage.text), page: tpage };
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

async function registerAs(agent, { username, email, teacher = false, university = '', subject = 'Matematika', reason = '' }) {
  const page = await agent.get('/user/login?lang=uz');
  const csrf = csrfFrom(page.text);
  const body = { mode: 'reg', consent: 'on', _csrf: csrf, username, email, password: 'parol-2026-x-uzun', lang: 'uz' };
  if (teacher) {
    body.role = 'teacher';
    body.university = university;
    body.subject = subject; // B-29: teacher maydonlari majburiy
    body.reason = reason;
  }
  const res = await agent.post('/user/login').set('x-forwarded-for', nextIp()).type('form').send(body);
  return res;
}

beforeAll(async () => {
  await snapshotDb();
  const { createApp } = await import('../../server.js');
  const created = await createApp();
  app = created.app;
  httpServer = created.httpServer;
  await new Promise((r) => httpServer.listen(34774, r));
});

afterAll(async () => {
  await restoreDb();
  await new Promise((r) => httpServer.close(r));
});

describe('AUTH B-14 — teacher approval state machine (integration)', () => {
  it('teacher register → teacher_pending + canonical teacher_applications record', async () => {
    const agent = supertest.agent(app);
    const uname = `b14reg_${Date.now() % 1000000}`;
    const res = await registerAs(agent, {
      username: uname, email: `${uname}@test.uz`, teacher: true,
      university: 'TATU', reason: 'Kompyuter fanidan dars beraman',
    });
    expect(res.status).toBe(302);
    expect(res.headers.location).toContain('/user/teacher-approval');

    const user = await fb.get(`users/${uname}`);
    expect(user.exists()).toBe(true);
    expect(user.val().role).toBe('teacher_pending');
    expect(user.val().teacher_application.university).toBe('TATU');

    // Canonical record mavjud (B-14 §07)
    const apps = await fb.get('teacher_applications');
    const mine = apps.exists()
      ? Object.values(apps.val()).filter((a) => a.user_id === uname && a.university === 'TATU')
      : [];
    expect(mine.length).toBe(1);
    expect(mine[0].status).toBe('pending');
    expect(mine[0].created_at).toBeGreaterThan(0);
  });

  it('admin approve → role teacher + canonical record approved + reviewed_by', async () => {
    const agent = supertest.agent(app);
    const uname = `b14app_${Date.now() % 1000000}`;
    await registerAs(agent, { username: uname, email: `${uname}@test.uz`, teacher: true, university: 'TATU' });

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
    expect(approve.body.role).toBe('teacher');

    const user = await fb.get(`users/${uname}`);
    expect(user.val().role).toBe('teacher');
    expect(user.val().teacher_cooldown_until).toBeFalsy(); // approve'da cooldown yo'q

    // Canonical record yangilandi
    const apps = await fb.get('teacher_applications');
    const mine = Object.values(apps.val()).filter((a) => a.user_id === uname);
    expect(mine.length).toBe(1);
    expect(mine[0].status).toBe('approved');
    expect(mine[0].reviewed_by).toBe(process.env.ADMIN_USER || 'admin');
    expect(mine[0].justification).toContain('Diplom');
  });

  it('reject → teacher_rejected + cooldown; qayta ariza blok; cooldown o\'tgach qabul', async () => {
    const agent = supertest.agent(app);
    const uname = `b14rej_${Date.now() % 1000000}`;
    await registerAs(agent, { username: uname, email: `${uname}@test.uz`, teacher: true, university: 'X' });

    // Admin reject (sabab majburiy)
    const admin = supertest.agent(app);
    const { csrf: acsrf } = await loginAsAdmin(admin);
    await adminReauth(admin, acsrf);
    const reject = await admin
      .post(`/admin/api/teachers/${uname}/reject`)
      .set('x-csrf-token', acsrf)
      .set('x-forwarded-for', xff)
      .send({ justification: 'Diplom hujjati talab qilinadi' });
    expect(reject.status).toBe(200);

    const user = await fb.get(`users/${uname}`);
    expect(user.val().role).toBe('teacher_rejected');
    expect(user.val().teacher_cooldown_until).toBeGreaterThan(Date.now());

    // Cooldown faol — qayta ariza blok (register sahifasida teacherCooldown)
    const agent2 = supertest.agent(app);
    const again = await registerAs(agent2, {
      username: uname, email: `${uname}@test.uz`, teacher: true, university: 'Yangi OTM',
    });
    expect([302, 200]).toContain(again.status);
    if (again.status === 200) {
      expect(again.text).toContain('30 kun');
    }
    const still = await fb.get(`users/${uname}`);
    expect(still.val().role).toBe('teacher_rejected');

    // Cooldown o'tdi (decision_at'ni o'tmishga) → qayta ariza → teacher_pending
    const decidedAt = await fb.get(`users/${uname}/teacher_decision_at`);
    await fb.set(`users/${uname}/teacher_decision_at`, decidedAt.val() - 31 * 24 * 60 * 60 * 1000);
    const agent3 = supertest.agent(app);
    const appeal = await registerAs(agent3, {
      username: uname, email: `${uname}@test.uz`, teacher: true, university: 'Yangi OTM',
      reason: 'Hujjatlarni topshirdim',
    });
    expect(appeal.status).toBe(302);
    const after = await fb.get(`users/${uname}`);
    expect(after.val().role).toBe('teacher_pending');

    // YANGI canonical record (appId o'zgargan)
    const apps = await fb.get('teacher_applications');
    const mine = Object.values(apps.val()).filter((a) => a.user_id === uname);
    expect(mine.length).toBe(2);
    const newest = mine.sort((a, b) => b.created_at - a.created_at)[0];
    expect(newest.university).toBe('Yangi OTM');
    expect(newest.status).toBe('pending');
  });

  it('security: non-admin approve qila olmaydi; IDOR — student approve qilib bo\'lmaydi', async () => {
    const agent = supertest.agent(app);
    const uname = `b14sec_${Date.now() % 1000000}`;
    await registerAs(agent, { username: uname, email: `${uname}@test.uz`, teacher: true, university: 'X' });

    // Oddiy student user approve qilmoqchi — blok
    const sagent = supertest.agent(app);
    const lpage = await sagent.get('/user/login?lang=uz');
    const lcsrf = csrfFrom(lpage.text);
    await sagent.post('/user/login').set('x-forwarded-for', nextIp()).type('form').send({
      _csrf: lcsrf, username: `stu_${Date.now() % 1000000}`, password: 'parol-2026-x-uzun', lang: 'uz',
    });
    // Ro'yxatdan o'tmagan student — bevosita endpointga urinish
    const sneak = await sagent
      .post(`/admin/api/teachers/${uname}/approve`)
      .set('x-csrf-token', 'fake')
      .send({ justification: 'x'.repeat(12) });
    expect([401, 403]).toContain(sneak.status);

    // IDOR: admin student'ni approve qilmoqchi → 409 not_pending / invalid
    const admin = supertest.agent(app);
    const { csrf: acsrf } = await loginAsAdmin(admin);
    await adminReauth(admin, acsrf);
    const studentName = `stu_${Date.now() % 1000000}`;
    // Student user yaratamiz (teacher_pending EMAS)
    await fb.set(`users/${studentName}`, {
      username: studentName, role: 'student', role_version: 1, email: `${studentName}@test.uz`,
    });
    const idor = await admin
      .post(`/admin/api/teachers/${studentName}/approve`)
      .set('x-csrf-token', acsrf)
      .set('x-forwarded-for', xff)
      .send({ justification: 'x'.repeat(12) });
    expect(idor.status).toBe(409);
    expect(idor.body.role).toBe('student');
  });
});
