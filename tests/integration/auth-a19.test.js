import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import supertest from 'supertest';
import { createApp } from '../../server.js';
import { snapshotDb, restoreDb, getApp } from '../helpers/setup.js';
import { fb } from '../../firebase/admin.js';

// AUTH A-03 register limit 5/15 per IP — har register unikal IP talab qiladi.
let xff = '203.0.113.101';
function nextIp() {
  xff = `203.0.113.${101 + (Math.floor(Math.random() * 1000) % 100)}`;
  return xff;
}

let app;
let httpServer;

function csrfFrom(html) {
  const m = html.match(/name="_csrf" value="([^"]+)"/);
  return m ? m[1] : null;
}

// Admin login'dan keyin session regenerate bo'ladi — CSRF yangilanadi.
// Yangi CSRF'ni /admin/teachers sahifasidagi JS const dan olamiz.
function csrfFromTeachersPage(html) {
  const m = html.match(/const CSRF = "([^"]*)"/);
  return m ? m[1] : null;
}

async function loginAsAdmin(agent) {
  const ip = nextIp();
  const page = await agent.get('/admin/login');
  const csrf = csrfFrom(page.text);
  const login = await agent.post('/admin/login').set('x-forwarded-for', ip).type('form').send({
    _csrf: csrf,
    username: process.env.ADMIN_USER || 'admin',
    password: process.env.ADMIN_PASS || 'admin',
  });
  expect([302, 200]).toContain(login.status);
  // Login'dan keyin yangi CSRF token (session regenerate qilingan)
  const tpage = await agent.get('/admin/teachers');
  return { csrf: csrfFromTeachersPage(tpage.text), page: tpage };
}

// AUTH A-25 §09: approve/reject sensitive amal — admin re-auth (10 daqiqa TTL)
async function adminReauth(agent, csrf) {
  const r = await agent
    .post('/api/admin/reauth')
    .set('x-csrf-token', csrf || 'x')
    .set('x-forwarded-for', xff)
    .send({ password: process.env.ADMIN_PASS || 'admin' });
  expect(r.status).toBe(200);
  expect(r.body.ok).toBe(true);
}

async function registerAs(app_, agent, { username, email, password = 'parol-2026-x-uzun', teacher = false, university = '', subject = '', reason = '' }) {
  const ip = nextIp();
  const page = await agent.get('/user/login?lang=uz');
  const csrf = csrfFrom(page.text);
  const body = { mode: 'reg', consent: 'on', _csrf: csrf, username, email, password, lang: 'uz' };
  if (teacher) {
    body.role = 'teacher';
    // B-29: university + subject teacher application uchun majburiy
    body.university = university || 'Toshkent Davlat Universiteti';
    body.subject = subject || 'Matematika';
    body.reason = reason;
  }
  const res = await agent.post('/user/login').set('x-forwarded-for', ip).type('form').send(body);
  return { res, csrf };
}

describe('AUTH A-19 — teacher approval flow', () => {
  beforeAll(async () => {
    await snapshotDb();
    ({ app, httpServer } = await createApp());
    await new Promise((r) => httpServer.listen(0, r));
  });
  afterAll(async () => {
    await restoreDb();
    await new Promise((r) => httpServer.close(r));
  });

  it('teacher register → teacher_pending + cheklangan rejim ekraniga redirect', async () => {
    const agent = supertest.agent(app);
    const uname = `a19t_${Date.now() % 1000000}`;
    const { res } = await registerAs(app, agent, {
      username: uname,
      email: `${uname}@test.uz`,
      teacher: true,
      university: 'Toshkent Davlat Universiteti',
      reason: 'Matematika o\'qituvchisi',
    });
    expect(res.status).toBe(302);
    expect(res.headers.location).toContain('/user/teacher-approval');

    const user = await fb.get(`users/${uname}`);
    expect(user.exists()).toBe(true);
    expect(user.val().role).toBe('teacher_pending');
    expect(user.val().teacher_application.university).toBe('Toshkent Davlat Universiteti');

    // Cheklangan rejim sahifasi — "ko'rib chiqilmoqda"
    const statusPage = await agent.get('/user/teacher-approval');
    expect(statusPage.status).toBe(200);
    expect(statusPage.text).toContain('ko\'rib chiqilmoqda');
  });

  it('student register → student, panelga boradi', async () => {
    const agent = supertest.agent(app);
    const uname = `a19s_${Date.now() % 1000000}`;
    const { res } = await registerAs(app, agent, {
      username: uname,
      email: `${uname}@test.uz`,
    });
    expect(res.status).toBe(302);
    expect(res.headers.location).toContain('/user/panel');
    const user = await fb.get(`users/${uname}`);
    expect(user.val().role).toBe('student');
  });

  it('admin pending ro\'yxatda ariza ko\'rinadi', async () => {
    const agent = supertest.agent(app);
    await loginAsAdmin(agent);

    const list = await agent.get('/admin/teachers');
    expect(list.status).toBe(200);
    expect(list.text).toContain('Teacher arizalari');
  });

  it('approve → teacher; eski sessiya bekor (role_version); /teacher ishlaydi', async () => {
    const agent = supertest.agent(app);
    const uname = `a19app_${Date.now() % 1000000}`;
    await registerAs(app, agent, {
      username: uname,
      email: `${uname}@test.uz`,
      teacher: true,
      university: 'TATU',
    });

    // Admin approve qiladi (AUTH A-25: reauth + justification majburiy)
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
    const user = await fb.get(`users/${uname}`);
    expect(user.val().role).toBe('teacher');
    expect(user.val().role_version).toBeGreaterThan(1);

    // A-31 review fix: role_version o'zgarishi endi eski sessiyani HAQIQATAN
    // bekor qiladi (invalidateIfStale har 60s tekshiradi — avval hech qachon
    // ishlamasdi). Eski (teacher_pending) sessiya bilan ishlab bo'lmaydi:
    // 401 JSON (supertest Accept:json) yoki 302 → /user/login.
    const stalePage = await agent.get('/user/teacher-approval');
    if (stalePage.status === 401) {
      expect(stalePage.body.error).toBeTruthy();
    } else {
      expect(stalePage.status).toBe(302);
      expect(stalePage.headers.location).toContain('/user/login');
    }

    // Qayta login (teacher rolida) → /teacher workspace ochiladi
    const agent2 = supertest.agent(app);
    const loginPage = await agent2.get('/user/login?lang=uz');
    const lcsrf = csrfFrom(loginPage.text);
    const login = await agent2.post('/user/login').type('form').send({
      _csrf: lcsrf, username: uname, password: 'parol-2026-x-uzun', lang: 'uz',
    });
    expect(login.status).toBe(302);
    expect(login.headers.location).toBe('/teacher');
    const ws = await agent2.get('/teacher');
    expect([200, 302]).toContain(ws.status);
  });

  it('reject → teacher_rejected + sabab ko\'rinadi', async () => {
    const agent = supertest.agent(app);
    const uname = `a19rej_${Date.now() % 1000000}`;
    await registerAs(app, agent, {
      username: uname,
      email: `${uname}@test.uz`,
      teacher: true,
      university: 'SamDU',
      reason: 'Fizika',
    });

    const admin = supertest.agent(app);
    const { csrf: acsrf } = await loginAsAdmin(admin);
    await adminReauth(admin, acsrf);
    const reason = 'Diplom nusxasi kerak';
    const reject = await admin
      .post(`/admin/api/teachers/${uname}/reject`)
      .set('x-csrf-token', acsrf)
      .set('x-forwarded-for', xff)
      .send({ justification: reason });
    expect(reject.status).toBe(200);
    expect(reject.body.ok).toBe(true);

    const user = await fb.get(`users/${uname}`);
    expect(user.val().role).toBe('teacher_rejected');
    expect(user.val().teacher_rejection_reason).toBe(reason);

    // Rejected teacher — eski sessiya role_version o'zgarishi bilan bekor
    // (A-31 review fix). Qayta login → rad etilgan ekran.
    const agent2 = supertest.agent(app);
    const loginPage = await agent2.get('/user/login?lang=uz');
    const lcsrf = csrfFrom(loginPage.text);
    const login = await agent2.post('/user/login').type('form').send({
      _csrf: lcsrf, username: uname, password: 'parol-2026-x-uzun', lang: 'uz',
    });
    expect(login.status).toBe(302);
    expect(login.headers.location).toContain('/user/teacher-approval');
    const statusPage = await agent2.get('/user/teacher-approval');
    expect(statusPage.status).toBe(200);
    expect(statusPage.text).toContain('rad etildi');
    expect(statusPage.text).toContain(reason);
  });

  it('security: non-admin approve qila olmaydi', async () => {
    const agent = supertest.agent(app);
    const uname = `a19na_${Date.now() % 1000000}`;
    await registerAs(app, agent, {
      username: uname,
      email: `${uname}@test.uz`,
      teacher: true,
    });
    // Student sessiya (register'da yaratilgan) bilan approve API'ga urinish
    const page = await agent.get('/user/panel');
    const csrf = csrfFrom(page.text);
    const attempt = await agent
      .post(`/admin/api/teachers/${uname}/approve`)
      .set('x-csrf-token', csrf || 'x')
      .set('x-forwarded-for', xff)
      .send({});
    expect([401, 403, 404]).toContain(attempt.status);
    const user = await fb.get(`users/${uname}`);
    expect(user.val().role).toBe('teacher_pending');
  });

  it('security: rejected/pending teacher workspace va student data ko\'rmaydi', async () => {
    // Pending teacher /teacher va /user/create-test sahifalariga kira olmaydi
    const agent = supertest.agent(app);
    const uname = `a19blk_${Date.now() % 1000000}`;
    await registerAs(app, agent, {
      username: uname,
      email: `${uname}@test.uz`,
      teacher: true,
    });
    // stealth: supesert '*' Accept → JSON 403; brauzer HTML so'rovi 404
    const teacherWs = await agent.get('/teacher');
    expect([403, 404]).toContain(teacherWs.status);
    const createTest = await agent.get('/user/create-test');
    // create-test requireRole('teacher') emas — lekin panel'da ham test yaratish
    // faqat teacher uchun. Hech bo'lmasa workspace 403/404 bo'lishi kerak.
    expect([403, 404]).toContain(createTest.status);
  });

  it('security: IDOR — boshqa userning arizasini admin bo\'lmagan o\'zgartira olmaydi', async () => {
    const agent = supertest.agent(app);
    const uname = `a19idor_${Date.now() % 1000000}`;
    await registerAs(app, agent, {
      username: uname,
      email: `${uname}@test.uz`,
      teacher: true,
    });
    // Boshqa student boshqa user'ni reject qilishga urinadi
    const other = supertest.agent(app);
    await registerAs(app, other, {
      username: `a19idor2_${Date.now() % 1000000}`,
      email: `a19idor2_${Date.now() % 1000000}@test.uz`,
    });
    const page = await other.get('/user/panel');
    const csrf = csrfFrom(page.text);
    const attempt = await other
      .post(`/admin/api/teachers/${uname}/reject`)
      .set('x-csrf-token', csrf || 'x')
      .set('x-forwarded-for', xff)
      .send({ reason: 'hack' });
    expect([401, 403, 404]).toContain(attempt.status);
    const user = await fb.get(`users/${uname}`);
    expect(user.val().role).toBe('teacher_pending');
  });
});
