/**
 * AUTH B-16 — Teacher approval SLA + pending limited mode
 * -------------------------------------------------------------------
 * Integration:
 *  - SLA progression: 8 kunlik pending → runTeacherSla → escalated
 *  - Pending limited mode: teacher_pending → /teacher blok (403/redirect), API 403
 *  - Rejected ekran: cooldown countdown + disabled Qayta ariza; cooldown
 *    o'tgach → enabled + Apellyatsiya havola
 *  - Appeal: cooldown o'tgan rejected → qayta register → TEACHER_APPEAL audit
 *    + YANGI teacher_applications row
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import supertest from 'supertest';
import { snapshotDb, restoreDb } from '../helpers/setup.js';
import { fb } from '../../firebase/admin.js';
import { safeKey } from '../../utils/helpers.js';
import { hashPassword } from '../../utils/helpers.js';
import { runTeacherSla } from '../../src/modules/auth/teacher-sla.js';

const DAY = 24 * 60 * 60 * 1000;
let app;
let httpServer;
let xff = '203.0.113.51';
function nextIp() {
  xff = `203.0.113.${51 + (Math.floor(Math.random() * 1000) % 40)}`;
  return xff;
}
function csrfFrom(html) {
  const m = html.match(/name="_csrf" value="([^"]+)"/);
  return m ? m[1] : null;
}

/** Parol bilan teacher user (pending/rejected) yaratadi. */
async function mkUser(key, role, opts = {}) {
  const hashed = await hashPassword('parol-2026-x-uzun');
  const base = {
    username: key, email: `${key}@test.uz`, password: hashed, safeKey: key,
    created_at: Date.now(), isVip: false, role, role_version: 1,
  };
  if (role === 'teacher_rejected') {
    const decidedAt = opts.decidedAt || Date.now() - 1000;
    base.teacher_decision_at = decidedAt;
    base.teacher_cooldown_until = opts.cooldownUntil || decidedAt + 30 * DAY;
    base.teacher_rejection_reason = 'Diplom hujjati talab qilinadi';
    base.teacher_application = { university: 'TATU', reason: 'Dars', appliedAt: decidedAt, status: 'rejected', appId: `ta_${key}` };
    // Canonical (real B-14 reject oqimi yozadi) — appeal testi eski row'ni ko'radi
    await fb.set(`teacher_applications/ta_${key}`, {
      id: `ta_${key}`, user_id: key, username: key, email: `${key}@test.uz`,
      full_name: key, university: 'TATU', reason: 'Dars', status: 'rejected',
      reject_reason: 'Diplom hujjati talab qilinadi',
      cooldown_until: base.teacher_cooldown_until,
      created_at: decidedAt, lang: 'uz',
    });
  } else {
    base.teacher_application = { university: 'TATU', reason: 'Dars', appliedAt: Date.now() - (opts.appliedAgeMs || 0), status: 'pending' };
  }
  await fb.set(`users/${key}`, base);
  return key;
}

async function login(agent, username) {
  const page = await agent.get('/user/login?lang=uz');
  const csrf = csrfFrom(page.text);
  const res = await agent.post('/user/login').set('x-forwarded-for', nextIp()).type('form').send({
    _csrf: csrf, username, password: 'parol-2026-x-uzun', lang: 'uz',
  });
  return res;
}

beforeAll(async () => {
  await snapshotDb();
  const { createApp } = await import('../../server.js');
  const created = await createApp();
  app = created.app;
  httpServer = created.httpServer;
  await new Promise((r) => httpServer.listen(34776, r));
});

afterAll(async () => {
  await restoreDb();
  await new Promise((r) => httpServer.close(r));
});

describe('AUTH B-16 — teacher SLA + limited mode', () => {
  it('SLA: 8 kunlik pending → runTeacherSla → escalated', async () => {
    const key = safeKey(`b16sla_${Date.now() % 1000000}`);
    await mkUser(key, 'teacher_pending', { appliedAgeMs: 8 * DAY });
    const appId = `ta_${key}`;
    await fb.set(`teacher_applications/${appId}`, {
      id: appId, user_id: key, username: key, email: `${key}@test.uz`,
      full_name: key, university: 'TATU', reason: 'Dars', status: 'pending',
      created_at: Date.now() - 8 * DAY, lang: 'uz', sla_state: 'normal',
    });

    const r = await runTeacherSla();
    expect(r.escalated).toBe(1);

    const app = await fb.get(`teacher_applications/${appId}`);
    expect(app.val().sla_state).toBe('escalated');
    expect(app.val().escalated_at).toBeGreaterThan(0);
  });

  it('Pending limited mode: /teacher blok + API 403', async () => {
    const key = safeKey(`b16pend_${Date.now() % 1000000}`);
    await mkUser(key, 'teacher_pending');
    const agent = supertest.agent(app);
    const loginRes = await login(agent, key);
    expect(loginRes.status).toBe(302);
    expect(loginRes.headers.location).toContain('/user/teacher-approval');

    // /teacher workspace — pending uchun blok
    const ws = await agent.get('/teacher');
    expect([401, 403, 302]).toContain(ws.status);

    // API — aniq 403 xabar (B-16 §09/§10): user API'lar limited-mode blokidan
    // keyin mount qilingan → 403 "Ruxsat etilmagan rol"
    const api = await agent.get('/user/api/tests/search?q=x').redirects(0);
    expect(api.status).toBe(403);
    expect(api.body.error).toBe('Ruxsat etilmagan rol');
  });

  it('Rejected ekran: cooldown faol → countdown + disabled; o\'tgach → enabled + appeal', async () => {
    const key = safeKey(`b16rej_${Date.now() % 1000000}`);
    await mkUser(key, 'teacher_rejected', { cooldownUntil: Date.now() + 10 * DAY });

    const agent = supertest.agent(app);
    const loginRes = await login(agent, key);
    expect(loginRes.status).toBe(302);

    // Cooldown faol — countdown + disabled qayta ariza + appeal havola
    const page = await agent.get('/user/teacher-approval');
    expect(page.status).toBe(200);
    expect(page.text).toContain('kundan keyin ochiladi');
    expect(page.text).toContain('aria-disabled="true"');
    expect(page.text).toContain('Apellyatsiya');
    expect(page.text).toContain('mailto:support@edikit.uz');

    // Cooldown o'tdi (10 kun o'tmishga) → enabled reapply
    await fb.set(`users/${key}/teacher_cooldown_until`, Date.now() - 1000);
    const page2 = await agent.get('/user/teacher-approval');
    expect(page2.text).not.toContain('aria-disabled="true"');
    expect(page2.text).toContain('/user/register?role=teacher');
  });

  it('Appeal: cooldown o\'tgan rejected → qayta register → TEACHER_APPEAL + yangi row', async () => {
    const key = safeKey(`b16app_${Date.now() % 1000000}`);
    await mkUser(key, 'teacher_rejected', { decidedAt: Date.now() - 31 * DAY });

    const agent = supertest.agent(app);
    const page = await agent.get('/user/login?lang=uz');
    const csrf = csrfFrom(page.text);
    const reg = await agent.post('/user/login').set('x-forwarded-for', nextIp()).type('form').send({
      mode: 'reg', consent: 'on', _csrf: csrf, role: 'teacher', username: key,
      email: `${key}@test.uz`, password: 'parol-2026-x-uzun', lang: 'uz',
      university: 'Yangi OTM', subject: 'Matematika', reason: 'Hujjatlarni topshirdim', // B-29: subject majburiy
    });
    expect(reg.status).toBe(302);

    // Role qayta teacher_pending
    const user = await fb.get(`users/${key}`);
    expect(user.val().role).toBe('teacher_pending');

    // YANGI canonical row (2 ta: rejected + yangi)
    const apps = await fb.get('teacher_applications');
    const mine = apps.exists() ? Object.values(apps.val()).filter((a) => a.user_id === key) : [];
    expect(mine.length).toBeGreaterThanOrEqual(2);
    const newest = mine.sort((a, b) => b.created_at - a.created_at)[0];
    expect(newest.university).toBe('Yangi OTM');
    expect(newest.status).toBe('pending');

    // TEACHER_APPEAL audit yozildi (auth_audit/{dayKey}/{ts}_{rand})
    const audit = await fb.get('auth_audit');
    const events = audit.exists()
      ? Object.values(audit.val()).flatMap((day) => (day && typeof day === 'object' ? Object.values(day) : []))
      : [];
    const appeal = events.find((e) => e && e.action === 'teacher:appeal' && e.actor_id === key);
    expect(appeal).toBeTruthy();
  });
});
