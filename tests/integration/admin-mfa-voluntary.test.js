/**
 * S30 — Admin IXTIYORIY MFA enroll regress testlari.
 *
 * Muammo: ADMIN_MFA_MANDATORY off bo'lgan muhitda admin MFA ni umuman
 * yoqib bo'lmasdi — /admin/mfa 302 (challenge yo'q), /admin/mfa/enroll 302
 * (pending yo'q) → profil "MFA yo'q" va QR/kalit chiqmaydi.
 *
 * S30 fix kontrakti:
 *   1) Logged-in admin + MFA active EMAS → GET /admin/mfa/enroll 200
 *      (QR + secret), voluntary:true.
 *   2) POST /api/admin/mfa/enable (togri kod) → {ok, voluntary:true,
 *      backupCodes} — SESSIYA saqlanadi (qayta grantAdminSession emas).
 *   3) MFA ACTIVE bo'lgach — keyingi login MFA challenge beradi
 *      (mandatory flag'dan qat'i nazar; aks holda ixtiyoriy MFA bypass).
 *   4) GET /admin/profile — mfaEnrolled DB statusidan (true).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createApp } from '../../server.js';
import { generate } from 'otplib';
import { enableTotp, getMfaStatus } from '../../src/modules/auth/mfa-totp.js';
import { fb } from '../../firebase/admin.js';

let app, httpServer, adminAgent;
const IP = '127.0.0.9';

async function adminLogin(agent) {
  const page = await agent.get('/admin/login').set('x-forwarded-for', IP);
  const csrf = page.text.match(/name="_csrf" value="([^"]+)"/)[1];
  return agent.post('/admin/login').set('x-forwarded-for', IP).type('form')
    .send({ username: process.env.ADMIN_USER, password: process.env.ADMIN_PASS, _csrf: csrf, lang: 'uz' })
    .redirects(0);
}

describe('S30: admin ixtiyoriy MFA', () => {
  beforeAll(async () => {
    ({ app, httpServer } = await createApp());
    await new Promise((r) => httpServer.listen(0, r));
  });
  afterAll(async () => {
    await httpServer.close();
    // MUHIM: vitest run ichida barcha test fayllari BITTA temp DB ulashadi.
    // Active mfa_totp/admin qolsa — keyingi admin login testlari MFA challenge
    // oladi (S30 login sharti). Shuning uchun DB holatini tiklaymiz.
    await fb.remove('mfa_totp/admin').catch(() => {});
    await fb.remove('mfa_backup/admin').catch(() => {});
  });

  it('flag off: login session beradi (MFA yo`q — legacy yo‘l saqlanadi)', async () => {
    const { default: Supertest } = await import('supertest');
    adminAgent = Supertest.agent(app);
    const res = await adminLogin(adminAgent);
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/admin/dashboard');
    const st = await getMfaStatus('admin');
    expect(st.status).not.toBe('active');
  });

  it('GET /admin/mfa/enroll → 200 + QR/secret (voluntary)', async () => {
    const res = await adminAgent.get('/admin/mfa/enroll');
    expect(res.status).toBe(200);
    expect(res.text).toContain('id="secret"');
    expect(res.text).toContain('__CSRF_TOKEN');
  });

  it('enable (to‘g‘ri kod) → {ok, voluntary:true, backupCodes} — sessiya tirik', async () => {
    const enrollPage = await adminAgent.get('/admin/mfa/enroll');
    const secret = enrollPage.text.match(/id="secret">([A-Z2-7]+)</)[1];
    const csrf = enrollPage.text.match(/__CSRF_TOKEN = '([a-f0-9]+)'/)[1];
    const code = await generate({ type: 'totp', secret });
    const res = await adminAgent.post('/api/admin/mfa/enable')
      .set('x-csrf-token', csrf).send({ token: String(code) });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.voluntary).toBe(true);
    expect(Array.isArray(res.body.backupCodes)).toBe(true);
    // sessiya saqlandi — dashboard hali ochiq
    const dash = await adminAgent.get('/admin/dashboard');
    expect(dash.status).toBe(200);
  });

  it('keyingi login → MFA challenge (mandatory flag off bo‘lsa ham)', async () => {
    const { default: Supertest } = await import('supertest');
    const fresh = Supertest.agent(app);
    const res = await adminLogin(fresh);
    expect(res.status).toBe(302);
    expect(res.headers.location).toMatch(/^\/admin\/mfa\?challenge=/);
    expect((await getMfaStatus('admin')).status).toBe('active');
  });

  it('MFA active → GET /admin/mfa/enroll profile‘ga redirect (qayta enroll yo‘q)', async () => {
    const res = await adminAgent.get('/admin/mfa/enroll').redirects(0);
    expect(res.status).toBe(302);
    expect(res.headers.location).toMatch(/\/admin\/profile/);
  });
});
