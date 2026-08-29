import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import supertest from 'supertest';
import { createApp } from '../../server.js';
import { snapshotDb, restoreDb } from '../helpers/setup.js';
import { fb } from '../../firebase/admin.js';

// AUTH A-03 register limit 5/15 per IP — har register unikal IP talab qiladi.
let xff = '203.0.113.151';
function nextIp() {
  xff = `203.0.113.${151 + (Math.floor(Math.random() * 1000) % 100)}`;
  return xff;
}

let app;
let httpServer;

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

async function registerUser(agent, username, opts = {}) {
  const page = await agent.get('/user/login?lang=uz');
  const csrf = csrfFrom(page.text);
  const body = {
    mode: 'reg', consent: 'on', _csrf: csrf, username,
    email: opts.email || `${username}@test.uz`,
    password: 'parol-2026-x-uzun', lang: 'uz',
  };
  if (opts.teacher) {
    body.role = 'teacher';
    body.university = opts.university || 'TATU';
    body.subject = opts.subject || 'Matematika'; // B-29: subject majburiy
    body.reason = opts.reason || 'Matematika';
  }
  const res = await agent.post('/user/login').set('x-forwarded-for', nextIp()).type('form').send(body);
  return res;
}

describe('AUTH A-25 — session hardening + teacher approval (Entra PIM)', () => {
  beforeAll(async () => {
    await snapshotDb();
    ({ app, httpServer } = await createApp());
    await new Promise((r) => httpServer.listen(0, r));
  });
  afterAll(async () => {
    await restoreDb();
    await new Promise((r) => httpServer.close(r));
  });

  it('remember-me: login remember=on → cookie; yangi brauzer cookie orqali tiklana oladi (rotate)', async () => {
    const agent = supertest.agent(app);
    const uname = `a25rm_${Date.now() % 1000000}`;
    await registerUser(agent, uname);

    // Yangi brauzer (sessiya yo'q): login remember=on
    const loginAgent = supertest.agent(app);
    const page = await loginAgent.get('/user/login?lang=uz');
    const csrf = csrfFrom(page.text);
    const loginIp = nextIp(); // device-bound: login va restore BIR XIL IP bo'lishi shart
    const login = await loginAgent
      .post('/user/login')
      .set('x-forwarded-for', loginIp)
      .type('form')
      .send({ _csrf: csrf, username: uname, password: 'parol-2026-x-uzun', remember: 'on', lang: 'uz' });
    expect(login.status).toBe(302);

    const setCookies = login.headers['set-cookie'] || [];
    const rememberCookie = setCookies.find((c) => c.startsWith('deborah_remember='));
    expect(rememberCookie).toBeTruthy();
    // Express res.cookie URL-encode qiladi (`:` → `%3A`) — decode qilamiz
    const cookieValue = decodeURIComponent(rememberCookie.split(';')[0].replace('deborah_remember=', ''));
    const oldSelector = cookieValue.split(':')[0];
    expect(oldSelector).toMatch(/^[0-9a-f]{32}$/);

    // "Yangi brauzer": faqat remember cookie — sessiya yo'q (bir xil IP+UA)
    const fresh = supertest.agent(app);
    fresh.jar.setCookie(rememberCookie.split(';')[0]);
    const panel = await fresh.get('/user/panel').set('x-forwarded-for', loginIp);
    expect(panel.status).toBe(200);

    // Rotation: eski token revoke bo'lgan
    const oldRec = await fb.get(`remember_tokens/${oldSelector}`);
    expect(oldRec.exists()).toBe(true);
    expect(oldRec.val().revoked).toBe(true);
  });

  it('remember-me: cookie yo\'q bo\'lsa restore bo\'lmaydi', async () => {
    const fresh = supertest.agent(app);
    const panel = await fresh.get('/user/panel');
    expect([302, 401]).toContain(panel.status);
  });

  it('teacher approve: justification majburiy (min 10 belgi) → 400', async () => {
    const agent = supertest.agent(app);
    const uname = `a25j_${Date.now() % 1000000}`;
    await registerUser(agent, uname, { teacher: true });

    const admin = supertest.agent(app);
    const { csrf: acsrf } = await loginAsAdmin(admin);
    await adminReauth(admin, acsrf);

    // justification yo'q → 400
    const noJust = await admin
      .post(`/admin/api/teachers/${uname}/approve`)
      .set('x-csrf-token', acsrf)
      .set('x-forwarded-for', xff)
      .send({});
    expect(noJust.status).toBe(400);
    expect(noJust.body.error).toBe('justification_required');

    // qisqa justification → 400
    const shortJust = await admin
      .post(`/admin/api/teachers/${uname}/approve`)
      .set('x-csrf-token', acsrf)
      .set('x-forwarded-for', xff)
      .send({ justification: 'qisqa' });
    expect(shortJust.status).toBe(400);

    // user hali pending
    const user = await fb.get(`users/${uname}`);
    expect(user.val().role).toBe('teacher_pending');
  });

  it('teacher approve: admin re-auth talab (reauth_required → 403)', async () => {
    const agent = supertest.agent(app);
    const uname = `a25ra_${Date.now() % 1000000}`;
    await registerUser(agent, uname, { teacher: true });

    const admin = supertest.agent(app);
    const { csrf: acsrf } = await loginAsAdmin(admin); // reauth YO'Q

    const approve = await admin
      .post(`/admin/api/teachers/${uname}/approve`)
      .set('x-csrf-token', acsrf)
      .set('x-forwarded-for', xff)
      .send({ justification: 'Hujjatlar tekshirildi, mos keldi' });
    expect(approve.status).toBe(403);
    expect(approve.body.error).toBe('reauth_required');

    const user = await fb.get(`users/${uname}`);
    expect(user.val().role).toBe('teacher_pending');
  });

  it('teacher approve: reauth + justification bilan → 200, audit justification saqlanadi', async () => {
    const agent = supertest.agent(app);
    const uname = `a25ok_${Date.now() % 1000000}`;
    await registerUser(agent, uname, { teacher: true });

    const admin = supertest.agent(app);
    const { csrf: acsrf } = await loginAsAdmin(admin);
    await adminReauth(admin, acsrf);
    const justification = 'Diplom va ish tajribasi tekshirildi, talablarga javob beradi';
    const approve = await admin
      .post(`/admin/api/teachers/${uname}/approve`)
      .set('x-csrf-token', acsrf)
      .set('x-forwarded-for', xff)
      .send({ justification });
    expect(approve.status).toBe(200);
    expect(approve.body.ok).toBe(true);

    const user = await fb.get(`users/${uname}`);
    expect(user.val().role).toBe('teacher');
  });

  it('teacher_rejected: 30 kun cooldown — qayta register bloklanadi', async () => {
    const agent = supertest.agent(app);
    const uname = `a25cd_${Date.now() % 1000000}`;
    await registerUser(agent, uname, { teacher: true });

    const admin = supertest.agent(app);
    const { csrf: acsrf } = await loginAsAdmin(admin);
    await adminReauth(admin, acsrf);
    const reject = await admin
      .post(`/admin/api/teachers/${uname}/reject`)
      .set('x-csrf-token', acsrf)
      .set('x-forwarded-for', xff)
      .send({ justification: 'Diplom tasdiqlanmadi, hujjatlar yetarli emas' });
    expect(reject.status).toBe(200);

    // Qayta register (teacher sifatida) → cooldown xabari
    const again = supertest.agent(app);
    const re = await registerUser(again, uname, { teacher: true });
    expect(re.status).toBe(200);
    expect(re.text).toContain('30 kun');

    // Rol o'zgarmagan — hali teacher_rejected
    const user = await fb.get(`users/${uname}`);
    expect(user.val().role).toBe('teacher_rejected');
  });

  it('admin UI: 7 kundan oshgan ariza — Eskalatsiya belgisi', async () => {
    const agent = supertest.agent(app);
    const uname = `a25esc_${Date.now() % 1000000}`;
    await registerUser(agent, uname, { teacher: true });
    // Ariza 8 kun oldin topshirilgan bo'lsin
    await fb.set(`users/${uname}/teacher_application/appliedAt`, Date.now() - 8 * 24 * 60 * 60 * 1000);

    const admin = supertest.agent(app);
    await loginAsAdmin(admin);
    const page = await admin.get('/admin/teachers');
    expect(page.status).toBe(200);
    expect(page.text).toContain('Eskalatsiya');
  });

  it('reauth: noto\'g\'ri parol → 403; 5+ urinish → 429 rate-limited (A-25 review fix)', async () => {
    const agent = supertest.agent(app);
    const uname = `a25rl_${Date.now() % 1000000}`;
    await registerUser(agent, uname);
    // login (session olish)
    const loginAgent = supertest.agent(app);
    const page = await loginAgent.get('/user/login?lang=uz');
    const csrf = csrfFrom(page.text);
    const ip = nextIp();
    const login = await loginAgent
      .post('/user/login')
      .set('x-forwarded-for', ip)
      .type('form')
      .send({ _csrf: csrf, username: uname, password: 'parol-2026-x-uzun', lang: 'uz' });
    expect(login.status).toBe(302);

    // Login session'ni regenerate qiladi — yangi CSRF'ni panel'dan olamiz
    const panel = await loginAgent.get('/user/panel').set('x-forwarded-for', ip);
    const t = panel.text.match(/window\.__CSRF_TOKEN\s*=\s*("([^"]+)"|'([^']+)')/);
    const csrfAfter = t ? (t[2] || t[3]) : csrf;

    // Noto'g'ri parol bilan urinishlar
    let last;
    for (let i = 0; i < 6; i += 1) {
      last = await loginAgent
        .post('/api/auth/reauth')
        .set('x-csrf-token', csrfAfter)
        .set('x-forwarded-for', ip)
        .send({ password: 'notogri-parol' });
    }
    // 5-urinishdan keyin limit → 429 (in-memory per-user limiter)
    expect(last.status).toBe(429);
    expect(last.body.error).toBe('rate-limited');
  });
});
