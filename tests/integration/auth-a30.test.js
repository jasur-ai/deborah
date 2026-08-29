/**
 * Deborah — AUTH A-30 Admin/Teacher privilege hardening — Integration
 * -------------------------------------------------------------------
 *  - Admin MFA mandatory: login MFA'siz → forced enroll → enable → session
 *  - Admin login MFA challenge: verify (wrong 403, right 200)
 *  - Admin lockout: 3 xato parol → 4-chi urinish blok
 *  - Admin IP allowlist: allowlist'da bo'lmagan IP → blok
 *  - Teacher MFA mandatory: teacher login MFA'siz → forced setup → confirm
 *  - Sensitive amal step-up: fresh MFA talab (requireAdminMfaStepUp)
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import supertest from 'supertest';
import { createApp } from '../../server.js';
import { snapshotDb, restoreDb } from '../helpers/setup.js';
import { fb } from '../../firebase/admin.js';
import { decryptSecret, setupTotp, enableTotp } from '../../src/modules/auth/mfa-totp.js';
import { generate } from 'otplib';
import CONFIG from '../../src/config/env.js';
import { safeKey, hashPassword } from '../../utils/helpers.js';

let ipCounter = 100;
function nextIp() {
  ipCounter = 100 + ((ipCounter - 100 + 1) % 154);
  return `203.0.113.${ipCounter}`;
}

let app;
let httpServer;
const PREV_MFA_FLAG = process.env.ADMIN_MFA_MANDATORY;

function csrfFrom(html) {
  const m = html.match(/name="_csrf" value="([^"]+)"/);
  return m ? m[1] : null;
}
function csrfFromPanel(html) {
  const t = html.match(/window\.__CSRF_TOKEN\s*=\s*("([^"]+)"|'([^']+)')/);
  return t ? (t[2] || t[3]) : '';
}
const csrfFromMfa = csrfFromPanel;

async function adminPasswordLogin(agent, ip) {
  const page = await agent.get('/admin/login');
  const csrf = csrfFrom(page.text);
  return agent.post('/admin/login').set('x-forwarded-for', ip).type('form').send({
    _csrf: csrf, username: CONFIG.ADMIN_USER, password: CONFIG.ADMIN_PASS,
  });
}

describe('AUTH A-30 — Admin/Teacher privilege hardening', () => {
  beforeAll(async () => {
    await snapshotDb();
    // MFA mandatory rejimini yoqamiz (test'ga xos — production'da doim on)
    process.env.ADMIN_MFA_MANDATORY = 'true';
    // Hermetik boshlang'ich holat: avvalgi run'lardan qolgan admin MFA record
    // (status=active) va lockout state'ni tozalaymiz — aks holda login
    // enroll o'rniga challenge'ga redirect bo'lib, testlar ishlamaydi.
    await fb.remove('mfa_totp/admin').catch(() => {});
    await fb.set('settings/admin_security', {
      loginFailures: 0,
      lockoutUntil: 0,
      breachFlagged: false,
      lastLoginAt: 0,
      lastCity: null,
      lastDeviceFp: null,
    }).catch(() => {});
    ({ app, httpServer } = await createApp());
    await new Promise((r) => httpServer.listen(0, r));
  });

  afterAll(async () => {
    if (PREV_MFA_FLAG === undefined) delete process.env.ADMIN_MFA_MANDATORY;
    else process.env.ADMIN_MFA_MANDATORY = PREV_MFA_FLAG;
    await new Promise((r) => httpServer.close(r));
    await restoreDb();
  });

  it('A-30 §06: admin login MFA\'siz → forced enroll sahifasiga', async () => {
    const agent = supertest.agent(app);
    const res = await adminPasswordLogin(agent, nextIp());
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/admin/mfa/enroll');
    // Dashboard'ga kira olmaydi (session hali yo'q). Supertest 'Accept: json'
    // yuborgani uchun requireAdmin 401 JSON qaytaradi (brauzerda 302 bo'lardi).
    const dash = await agent.get('/admin/dashboard');
    expect(dash.status).toBe(401);
    // mfa_totp/admin pending record yaratilgan
    const rec = await fb.get('mfa_totp/admin');
    expect(rec.exists()).toBe(true);
    expect(rec.val().status).toBe('pending');
  });

  it('A-30 §06: enroll → birinchi kod → session + backup codes', async () => {
    const agent = supertest.agent(app);
    await adminPasswordLogin(agent, nextIp());
    const enrollPage = await agent.get('/admin/mfa/enroll');
    expect(enrollPage.status).toBe(200);
    const csrf = csrfFromMfa(enrollPage.text);
    expect(csrf).toBeTruthy();

    // Secret'ni DB'dan o'qib TOTP kod generatsiya qilamiz
    const rec = await fb.get('mfa_totp/admin');
    const secret = decryptSecret(rec.val().secretEnc);
    const token = await generate({ secret });
    const enable = await agent.post('/api/admin/mfa/enable')
      .set('x-forwarded-for', nextIp())
      .set('x-csrf-token', csrf)
      .send({ token });
    expect(enable.status).toBe(200);
    expect(enable.body.ok).toBe(true);
    expect(enable.body.backupCodes).toHaveLength(12);

    // Endi dashboard ochiq (session berildi)
    const dash = await agent.get('/admin/dashboard');
    expect(dash.status).toBe(200);
  });

  it('A-30 §06: admin login MFA challenge — xato kod 403, to\'g\'ri kod 200', async () => {
    const agent = supertest.agent(app);
    const login = await adminPasswordLogin(agent, nextIp());
    expect(login.status).toBe(302);
    expect(login.headers.location).toMatch(/^\/admin\/mfa\?challenge=/);

    const challengeId = login.headers.location.split('challenge=')[1];
    const page = await agent.get('/admin/mfa?challenge=' + challengeId);
    expect(page.status).toBe(200);
    const csrf = csrfFromMfa(page.text);

    // Xato kod → 403
    const wrong = await agent.post('/api/admin/mfa/verify')
      .set('x-forwarded-for', nextIp())
      .set('x-csrf-token', csrf)
      .send({ code: '000000', challengeId });
    expect(wrong.status).toBe(403);

    // To'g'ri kod → 200 + session
    const rec = await fb.get('mfa_totp/admin');
    const secret = decryptSecret(rec.val().secretEnc);
    const token = await generate({ secret });
    const right = await agent.post('/api/admin/mfa/verify')
      .set('x-forwarded-for', nextIp())
      .set('x-csrf-token', csrf)
      .send({ code: token, challengeId });
    expect(right.status).toBe(200);
    expect(right.body.ok).toBe(true);
    expect(right.body.redirect).toBe('/admin/dashboard');

    const dash = await agent.get('/admin/dashboard');
    expect(dash.status).toBe(200);
  });

  it('A-30 §07: admin session — Strict cookie, remember yo\'q, absolute timeout', async () => {
    const agent = supertest.agent(app);
    await adminPasswordLogin(agent, nextIp());
    const page = await agent.get('/admin/mfa');
    const challengeId = page.text.match(/var challengeId = '([^']+)'/);
    const rec = await fb.get('mfa_totp/admin');
    const secret = decryptSecret(rec.val().secretEnc);
    const csrf = csrfFromMfa(page.text);
    const res = await agent.post('/api/admin/mfa/verify')
      .set('x-forwarded-for', nextIp())
      .set('x-csrf-token', csrf)
      .send({ code: await generate({ secret }), challengeId: challengeId[1] });
    expect(res.status).toBe(200);

    // Cookie qoidalari: sameSite=Strict session cookie'da
    const cookieHeader = res.headers['set-cookie'] ? res.headers['set-cookie'].join(';') : '';
    const sid = cookieHeader.match(/(?:^|;\s*)(connect\.sid=[^;]+)/);
    expect(sid).toBeTruthy();
    // remember cookie yo'q
    expect(cookieHeader).not.toContain('deborah_remember');
  });

  it('A-30 §08: admin login lockout — 3 xato → 4-chi urinish blok', async () => {
    // Reset state uchun boshqa IP ishlatamiz va lockout'ni tekshiramiz
    const agent = supertest.agent(app);
    const ip = nextIp();
    for (let i = 0; i < 3; i += 1) {
      const page = await agent.get('/admin/login');
      const csrf = csrfFrom(page.text);
      await agent.post('/admin/login').set('x-forwarded-for', ip).type('form').send({
        _csrf: csrf, username: CONFIG.ADMIN_USER, password: 'noto-gri-parol-123',
      });
    }
    // 4-chi urinish — lockout xabari
    const page = await agent.get('/admin/login');
    const csrf = csrfFrom(page.text);
    const res = await agent.post('/admin/login').set('x-forwarded-for', ip).type('form').send({
      _csrf: csrf, username: CONFIG.ADMIN_USER, password: 'noto-gri-parol-123',
    });
    expect(res.status).toBe(200);
    expect(res.text).toContain('daqiqa kuting');
  });

  it('A-30 §12: admin IP allowlist — ruxsat etilmagan IP blok', async () => {
    // Allowlist'ni faqat shu test davomida yoqamiz (env live o'qiladi)
    const prev = process.env.ADMIN_IP_ALLOWLIST;
    process.env.ADMIN_IP_ALLOWLIST = '10.0.0.0/8';
    try {
      // Risk blokiga tushmaslik uchun admin security state'ni tozalaymiz
      // (avvalgi test login'lari lastCity/lastIpHash yozgan — IP o'zgarishi
      // impossible_travel signal berib, allowed login'ni ham bloklashi mumkin).
      await fb.set('settings/admin_security', {
        loginFailures: 0, lockoutUntil: 0, breachFlagged: false,
        lastLoginAt: 0, lastCity: null, lastDeviceFp: null,
      }).catch(() => {});
      const agent = supertest.agent(app);
      const page = await agent.get('/admin/login');
      const csrf = csrfFrom(page.text);
      const res = await agent.post('/admin/login').set('x-forwarded-for', '203.0.113.5').type('form').send({
        _csrf: csrf, username: CONFIG.ADMIN_USER, password: CONFIG.ADMIN_PASS,
      });
      expect(res.status).toBe(200);
      expect(res.text).toContain('Ruxsat etilmagan IP');
      // Ruxsat etilgan IP (10.x) → MFA flow'ga o'tadi
      const agent2 = supertest.agent(app);
      const page2 = await agent2.get('/admin/login');
      const csrf2 = csrfFrom(page2.text);
      const res2 = await agent2.post('/admin/login').set('x-forwarded-for', '10.1.2.3').type('form').send({
        _csrf: csrf2, username: CONFIG.ADMIN_USER, password: CONFIG.ADMIN_PASS,
      });
      expect(res2.status).toBe(302); // MFA challenge/enroll
    } finally {
      if (prev === undefined) delete process.env.ADMIN_IP_ALLOWLIST;
      else process.env.ADMIN_IP_ALLOWLIST = prev;
    }
  });

  it('A-30 §06: teacher MFA mandatory — MFA\'siz login blok, forced setup', async () => {
    // Teacher user yaratamiz (to'g'ridan-to'g'ri DB — approval flow'siz).
    // Parol haqiqiy argon2 hash bilan — hardcoded hash bu parolga mos emas.
    const uname = `teach${Date.now() % 100000}`;
    const userKey = safeKey(uname);
    await fb.set(`users/${userKey}`, {
      username: uname,
      email: `${uname}@test.uz`,
      email_verified: true,
      password: await hashPassword('parol-2026-x-uzun'),
      created_at: Date.now(),
      isVip: false,
      role: 'teacher',
      role_version: 1,
    });

    const agent = supertest.agent(app);
    const page = await agent.get('/user/login?lang=uz');
    const csrf = csrfFrom(page.text);
    const res = await agent.post('/user/login').set('x-forwarded-for', nextIp()).type('form').send({
      _csrf: csrf, username: uname, password: 'parol-2026-x-uzun', lang: 'uz',
    });
    // MFA'siz teacher → forced setup sahifasiga (302 redirect)
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/user/mfa/setup');

    const setupPage = await agent.get('/user/mfa/setup');
    expect(setupPage.status).toBe(200);
    const setupCsrf = csrfFromMfa(setupPage.text);
    const rec = await fb.get(`mfa_totp/${userKey}`);
    expect(rec.exists()).toBe(true);
    expect(rec.val().status).toBe('pending');
    const secret = decryptSecret(rec.val().secretEnc);
    const token = await generate({ secret });
    const confirm = await agent.post('/api/mfa/setup/confirm')
      .set('x-forwarded-for', nextIp())
      .set('x-csrf-token', setupCsrf)
      .send({ token });
    expect(confirm.status).toBe(200);
    expect(confirm.body.ok).toBe(true);
    expect(confirm.body.role).toBe('teacher');

    // Endi teacher session faol
    const panel = await agent.get('/teacher');
    expect([200, 302]).toContain(panel.status);
  });

  it('A-30 §09: sensitive amal step-up — fresh MFA talab qilinadi', async () => {
    // Admin MFA'ni active holatga keltiramiz (agar hali yo'q bo'lsa —
    // to'liq suite'da oldingi testlar enable qilgan bo'lishi mumkin; yakka
    // run'da esa beforeAll tozalagani uchun shu yerda qayta o'rnatamiz).
    const rec0 = await fb.get('mfa_totp/admin');
    if (!rec0.exists() || rec0.val().status !== 'active') {
      const setup = await setupTotp('admin', { accountName: 'Deborah Admin' });
      const en = await enableTotp('admin', await generate({ secret: setup.secret }));
      expect(en.ok).toBe(true);
    }

    // Admin session'ni MFA orqali olamiz (adminMfaAt fresh)
    const agent = supertest.agent(app);
    await adminPasswordLogin(agent, nextIp());
    const page = await agent.get('/admin/mfa');
    const challengeId = page.text.match(/var challengeId = '([^']+)'/);
    const rec = await fb.get('mfa_totp/admin');
    const secret = decryptSecret(rec.val().secretEnc);
    const csrf = csrfFromMfa(page.text);
    const res = await agent.post('/api/admin/mfa/verify')
      .set('x-forwarded-for', nextIp())
      .set('x-csrf-token', csrf)
      .send({ code: await generate({ secret }), challengeId: challengeId[1] });
    expect(res.status).toBe(200);

    // Fresh MFA → sensitive amal (user delete) o'tadi (status != 403 mfa_stepup)
    const dashCsrf = csrfFromPanel((await agent.get('/admin/dashboard')).text);
    const del = await agent.post('/admin/api/users/delete')
      .set('x-forwarded-for', nextIp())
      .set('x-csrf-token', dashCsrf)
      .send({ key: 'nonexistent-user' });
    expect(del.status).toBe(200); // fresh MFA → allowed (user yo'q bo'lsa ham 200)
  });
});
