/**
 * AUTH B-15 — Teacher approval: admin ro'yxat + approve/reject UI
 * -------------------------------------------------------------------
 * Integration:
 *  - GET /admin/teachers?filter=all → pending+approved+rejected, subject/experience ko'rinadi
 *  - filter=pending / rejected — faqat tegishli status
 *  - qidiruv (q=) — username/email/university/subject bo'yicha
 *  - pagination — 25 pending → 1-sahifa 20, 2-sahifa 5
 *  - XSS — reject reason HTML-escape qilinadi
 *  - PII minimal — ro'yxatda faqat admin uchun zarur maydonlar
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import supertest from 'supertest';
import { snapshotDb, restoreDb } from '../helpers/setup.js';
import { fb } from '../../firebase/admin.js';

let app;
let httpServer;
let xff = '203.0.113.251';
function nextIp() {
  xff = `203.0.113.${251 + (Math.floor(Math.random() * 1000) % 4)}`; // 251–254 (255+ invalid IP)
  return xff;
}
function csrfFrom(html) {
  const m = html.match(/name="_csrf" value="([^"]+)"/);
  return m ? m[1] : null;
}

/** Canonical + inline ariza bilan teacher user yaratadi. */
async function mkTeacher(key, { role, subject = 'Matematika', university = 'TATU', reason = 'Dars beraman' }) {
  const appliedAt = Date.now();
  await fb.set(`users/${key}`, {
    username: key, email: `${key}@test.uz`, role, role_version: 1,
    teacher_application: { university, reason, appliedAt, status: role === 'teacher_pending' ? 'pending' : (role === 'teacher' ? 'approved' : 'rejected') },
    ...(role === 'teacher_rejected' ? { teacher_rejection_reason: '<script>alert(1)</script> Hujjat yetarli emas', teacher_decision_at: appliedAt - 1000 } : {}),
  });
  await fb.set(`teacher_applications/ta_${key}`, {
    id: `ta_${key}`, user_id: key, username: key, email: `${key}@test.uz`,
    full_name: key, university, subject, experience: '5 yil', reason,
    status: role === 'teacher_pending' ? 'pending' : (role === 'teacher' ? 'approved' : 'rejected'),
    created_at: appliedAt, lang: 'uz',
  });
}

async function loginAsAdmin() {
  const agent = supertest.agent(app);
  const page = await agent.get('/admin/login');
  const csrf = csrfFrom(page.text);
  const login = await agent.post('/admin/login').set('x-forwarded-for', nextIp()).type('form').send({
    _csrf: csrf, username: process.env.ADMIN_USER || 'admin', password: process.env.ADMIN_PASS || 'admin',
  });
  expect([302, 200]).toContain(login.status);
  return agent;
}

beforeAll(async () => {
  await snapshotDb();
  const { createApp } = await import('../../server.js');
  const created = await createApp();
  app = created.app;
  httpServer = created.httpServer;
  await new Promise((r) => httpServer.listen(34775, r));
});

afterAll(async () => {
  await restoreDb();
  await new Promise((r) => httpServer.close(r));
});

describe('AUTH B-15 — admin teacher paneli', () => {
  it('filter=all: pending+approved+rejected + subject/experience ko\'rinadi', async () => {
    await mkTeacher('b15all_p', { role: 'teacher_pending' });
    await mkTeacher('b15all_a', { role: 'teacher', subject: 'Fizika' });
    await mkTeacher('b15all_r', { role: 'teacher_rejected' });

    const agent = await loginAsAdmin();
    const res = await agent.get('/admin/teachers?filter=all');
    expect(res.status).toBe(200);
    expect(res.text).toContain('b15all_p');
    expect(res.text).toContain('b15all_a');
    expect(res.text).toContain('b15all_r');
    // B-14 canonical field'lar UI'da (subject/experience/full_name)
    expect(res.text).toContain('Matematika');
    expect(res.text).toContain('Fizika');
    expect(res.text).toContain('5 yil');
    // Filter tablar + qidiruv maydoni + modal
    expect(res.text).toContain('filter=approved');
    expect(res.text).toContain('id="t-q"');
    expect(res.text).toContain('aria-modal="true"');
  });

  it('filter=pending / rejected — faqat tegishli status', async () => {
    const agent = await loginAsAdmin();
    const pend = await agent.get('/admin/teachers?filter=pending');
    expect(pend.text).toContain('b15all_p');
    expect(pend.text).not.toContain('b15all_a');
    expect(pend.text).not.toContain('b15all_r');

    const rej = await agent.get('/admin/teachers?filter=rejected');
    expect(rej.text).toContain('b15all_r');
    expect(rej.text).not.toContain('b15all_p');
  });

  it('qidiruv (q=) — subject bo\'yicha filter', async () => {
    const agent = await loginAsAdmin();
    const res = await agent.get('/admin/teachers?filter=all&q=Fizika');
    expect(res.status).toBe(200);
    expect(res.text).toContain('b15all_a');
    expect(res.text).not.toContain('b15all_p'); // Matematika — qidiruvda yo'q
  });

  it('pagination — 25 pending → sahifa 1: 20, sahifa 2: 5', async () => {
    const base = `b15pg_${Date.now() % 1000}`;
    for (let i = 0; i < 25; i++) await mkTeacher(`${base}_${i}`, { role: 'teacher_pending' });

    const agent = await loginAsAdmin();
    const p1 = await agent.get('/admin/teachers?filter=pending&page=1');
    expect(p1.status).toBe(200);
    expect(p1.text).toContain('1 / 2');
    // Sahifa 1: 20 qator jami (26 pending: b15all_p eng eski — 1-o'rin,
    // qolgan 19 = b15pg_*). (tr data-id faqat <tr> da sanaladi.)
    const rows1 = (p1.text.match(/<tr data-id="b15pg_[^"]+"/g) || []).length;
    expect(rows1).toBe(19);
    expect(p1.text).toContain('b15all_p'); // eng eski ariza ham 1-sahifada

    const p2 = await agent.get('/admin/teachers?filter=pending&page=2');
    const rows2 = (p2.text.match(/<tr data-id="b15pg_[^"]+"/g) || []).length;
    expect(rows2).toBe(6); // 26 - 20
    expect(p2.text).toContain('2 / 2');
  });

  it('XSS — reject reason HTML-escape qilinadi', async () => {
    await mkTeacher('b15xss', { role: 'teacher_rejected' });
    const agent = await loginAsAdmin();
    const res = await agent.get('/admin/teachers?filter=rejected');
    expect(res.status).toBe(200);
    // <script> qochirilgan holda keladi (EJS escape), yalang'och script YO'Q
    expect(res.text).not.toContain('<script>alert(1)</script>');
    expect(res.text).toContain('&lt;script&gt;');
  });
});
