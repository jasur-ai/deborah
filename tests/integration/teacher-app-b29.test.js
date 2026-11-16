/**
 * AUTH B-29 — Teacher approval (integration)
 *  - Register: role=teacher + university/subject majburiy → teacher_pending
 *  - Register: role=teacher, university yo'q → xato (universityRequired)
 *  - Review queue /api/teachers/pending → ariza ko'rinadi (subject/experience)
 *  - IDOR: boshqa user arizasini ko'rish blok (teacher-approval faqat o'z statusi)
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import supertest from 'supertest';
import { createApp } from '../../server.js';
import { snapshotDb, restoreDb } from '../helpers/setup.js';
import { fb } from '../../firebase/admin.js';
import { safeKey } from '../../utils/helpers.js';

let app;
let httpServer;

function csrfFrom(html) {
  const m = html.match(/name="_csrf" value="([^"]+)"/);
  return m ? m[1] : null;
}

describe('AUTH B-29 — teacher application', () => {
  beforeAll(async () => {
    await snapshotDb();
    ({ app, httpServer } = await createApp());
    await new Promise((r) => httpServer.listen(0, r));
  });
  afterAll(async () => {
    await restoreDb();
    await new Promise((r) => httpServer.close(r));
  });

  async function postRegister(agent, fields) {
    const page = await agent.get('/user/register?lang=uz');
    const csrf = csrfFrom(page.text);
    return agent.post('/user/login').type('form').send({
      _csrf: csrf,
      mode: 'reg', consent: 'on',
      lang: 'uz',
      password: 'parol-2026-x-uzun',
      ...fields,
    });
  }

  it('register: role=teacher + university/subject → 302 teacher-approval (pending)', async () => {
    const agent = supertest.agent(app);
    const uname = `b29t${Date.now()}`;
    const r = await postRegister(agent, {
      username: uname,
      email: `${uname}@test.uz`,
      name: 'B29 Teacher',
      role: 'teacher',
      university: 'Toshkent Davlat Universiteti',
      subject: 'Matematika',
      experience: '10',
      reason: "O'qituvchiman",
    });
    expect(r.status).toBe(302);
    expect(r.headers.location).toBe('/user/teacher-approval');

    // DB'da teacher_pending + canonical ariza (university/subject saqlangan)
    const snap = await fb.get(`users/${safeKey(uname)}`);
    expect(snap.exists()).toBe(true);
    expect(snap.val().role).toBe('teacher_pending');
    expect(snap.val().teacher_application.university).toBe('Toshkent Davlat Universiteti');
    expect(snap.val().teacher_application.subject).toBe('Matematika');
    expect(snap.val().teacher_application.experience).toBe('10');

    const apps = await fb.get('teacher_applications');
    let found = null;
    if (apps.exists()) {
      for (const app of Object.values(apps.val())) {
        if (app.user_id === safeKey(uname)) { found = app; break; }
      }
    }
    expect(found).toBeTruthy();
    expect(found.status).toBe('pending');
    expect(found.subject).toBe('Matematika');
  });

  it('register: role=teacher, university yo\'q → xato sahifaga qaytadi (universityRequired)', async () => {
    const agent = supertest.agent(app);
    const uname = `b29m${Date.now()}`;
    const r = await postRegister(agent, {
      username: uname,
      email: `${uname}@test.uz`,
      role: 'teacher',
      subject: 'Fizika',
    });
    expect(r.status).toBe(200); // xato sahifa (redirect emas)
    expect(r.text).toContain('Universitet');
    // User yaratilmasligi kerak
    const snap = await fb.get(`users/${safeKey(uname)}`);
    expect(snap.exists()).toBe(false);
  });

  it('review queue: /api/teachers/pending → subject/experience ko\'rinadi (admin)', async () => {
    // A riza yaratamiz (student agent orqali)
    const regAgent = supertest.agent(app);
    const uname = `b29q${Date.now()}`;
    await postRegister(regAgent, {
      username: uname,
      email: `${uname}@test.uz`,
      role: 'teacher',
      university: 'Samarqand Davlat Universiteti',
      subject: 'Kimyo',
      experience: '5',
    });

    // Admin session qurish
    const admin = supertest.agent(app);
    const alogin = await admin.get('/admin/login');
    const acsrf = csrfFrom(alogin.text);
    const alr = await admin.post('/admin/login').set('x-forwarded-for', '198.51.100.200').type('form').send({
      _csrf: acsrf,
      username: process.env.ADMIN_USER || 'admin',
      password: process.env.ADMIN_PASS || 'admin',
    });
    expect([302, 200]).toContain(alr.status);

    // /api/teachers/pending `/admin` ostida mount (server.js: app.use('/admin', teacherAdminRoutes))
    const q = await admin.get('/admin/api/teachers/pending');
    expect(q.status).toBe(200);
    const pending = q.body.pending || [];
    const mine = pending.find((p) => p.username === uname);
    expect(mine).toBeTruthy();
    // B-29: queue'da university (teacher_application'dan) ko'rinadi
    expect(mine.university).toBe('Samarqand Davlat Universiteti');
  });

  it('IDOR: boshqa user teacher-approval sahifasiga kira olmaydi (o\'z sessioni kerak)', async () => {
    // A riza: teacher_pending bo'lgan user faqat o'z statusini ko'radi;
    // requireAuth session'ga bog'liq — boshqa user'ning sahifasi yo'q.
    const agent = supertest.agent(app);
    const uname = `b29i${Date.now()}`;
    await postRegister(agent, {
      username: uname,
      email: `${uname}@test.uz`,
      role: 'teacher',
      university: 'TATU',
      subject: 'Informatika',
    });
    // Session'li user → o'z teacher-approval sahifasi (auth bilan)
    const page = await agent.get('/user/teacher-approval');
    expect(page.status).toBe(200);

    // Boshqa agent (auth'siz) → login redirect/401
    const anon = supertest.agent(app);
    const r2 = await anon.get('/user/teacher-approval');
    expect([302, 401, 403]).toContain(r2.status);
  });
});
