/**
 * Edikit — AUTH A-31 Massive Final Checkpoint + sign-off — Integration
 * -------------------------------------------------------------------
 * A fazasining yakuniy security sertifikatlashi. Mavjud testlarda qamralgan
 * mavzular (CSRF 403, returnUrl allowlist, enumeration javob bir xilligi)
 * bu yerda qayta sinalmaydi — FAQAT bo'shliqlar:
 *  - Session fixation: login oldi session ID ≠ login keyin (to'liq o'lchov)
 *  - Cookie flags: HttpOnly + SameSite session cookie'da
 *  - Enumeration TIMING: mavjud/yo'q user javob vaqti (jitter + dummy hash)
 *  - MFA challenge bypass: challenge faqat bir marta ishlatiladi (replay blok)
 *  - Teacher escalation: student o'z rolini teacher qilib o'zgartira olmaydi
 *  - Session invalidation: parol o'zgarishi boshqa sessiyani o'ldiradi
 *  - Admin MFA bypass: ADMIN_MFA_MANDATORY=true da MFA'siz dashboard yo'q
 *  - Secret/PII leak: parol/javobda hech qachon raw parol chiqmaydi
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import supertest from 'supertest';
import { createApp } from '../../server.js';
import { snapshotDb, restoreDb } from '../helpers/setup.js';
import { fb } from '../../firebase/admin.js';
import { safeKey, hashPassword } from '../../utils/helpers.js';
import { generate } from 'otplib';

let app;
let httpServer;

// Register limiti 5/15min per IP (A-03) — har test alohida IP ishlatadi
let ipCounter = 200;
function nextIp() {
  ipCounter = 200 + ((ipCounter - 200 + 1) % 54);
  return `198.51.100.${ipCounter}`;
}

function csrfFrom(html) {
  const m = html.match(/name="_csrf" value="([^"]+)"/);
  return m ? m[1] : null;
}
function csrfFromPanel(html) {
  const m = html.match(/window\.__CSRF_TOKEN\s*=\s*("([^"]+)"|'([^']+)')/);
  return m ? (m[2] || m[3]) : '';
}
async function registerUser(agent, uname, password = 'parol-2026-x-uzun', email, ip = null) {
  const page = await agent.get('/user/login?lang=uz');
  const csrf = csrfFrom(page.text);
  let req = agent.post('/user/login');
  if (ip) req = req.set('x-forwarded-for', ip);
  const res = await req.type('form').send({
    mode: 'reg', consent: 'on', lang: 'uz', _csrf: csrf, username: uname,
    email: email || `${uname}@test.uz`, password,
  });
  return res;
}
async function loginUser(agent, uname, password = 'parol-2026-x-uzun') {
  const page = await agent.get('/user/login?lang=uz');
  const csrf = csrfFrom(page.text);
  const res = await agent.post('/user/login').type('form').send({
    _csrf: csrf, username: uname, password, lang: 'uz',
  });
  return res;
}

describe('AUTH A-31 — Massive Final Checkpoint', () => {
  beforeAll(async () => {
    await snapshotDb();
    ({ app, httpServer } = await createApp());
    await new Promise((r) => httpServer.listen(0, r));
  });

  afterAll(async () => {
    await new Promise((r) => httpServer.close(r));
    await restoreDb();
  });

  it('A-31 §01: session fixation — login oldi ID ≠ login keyin (regenerate)', async () => {
    const uname = `fix${Date.now() % 100000}`;
    const regAgent = supertest.agent(app);
    await registerUser(regAgent, uname, 'parol-2026-x-uzun', null, nextIp());
    // Login uchun YANGI agent (register auto-login session'ini olib yurmaydi)
    const agent = supertest.agent(app);
    const pre = await agent.get('/user/login');
    const sidBefore = (pre.headers['set-cookie'] || []).find((c) => c.includes('connect.sid'));
    const idBefore = sidBefore ? sidBefore.split(';')[0] : null;
    expect(idBefore).toBeTruthy();
    const res = await loginUser(agent, uname);
    expect([200, 302]).toContain(res.status);
    // Login RESPONSE'ning Set-Cookie'si — login session'ni regenerate qilgan
    const sidAfter = (res.headers['set-cookie'] || []).find((c) => c.includes('connect.sid'));
    const idAfter = sidAfter ? sidAfter.split(';')[0] : null;
    // Login regenerate qiladi — session ID o'zgargan, fixation mumkin emas
    expect(idAfter).toBeTruthy();
    expect(idAfter).not.toBe(idBefore);
  });

  it('A-31 §02: cookie flags — session cookie HttpOnly + SameSite', async () => {
    const agent = supertest.agent(app);
    const res = await agent.get('/user/login');
    const sc = (res.headers['set-cookie'] || []).find((c) => c.includes('connect.sid'));
    expect(sc).toBeTruthy();
    expect(sc).toContain('HttpOnly');
    expect(sc).toContain('SameSite=Lax');
  });

  it('A-31 §03: enumeration timing — mavjud va yoq user javob vaqti yaqin', async () => {
    const uname = `timing${Date.now() % 100000}`;
    const agent1 = supertest.agent(app);
    await registerUser(agent1, uname, 'parol-2026-x-uzun', null, nextIp());
    // Jitter random — single sample flaky bo'ladi (A-31 review). Har bir yo'l
    // uchun 3 tadan o'lchab O'RTACHA olamiz.
    async function avgMs(username) {
      let total = 0;
      for (let i = 0; i < 3; i += 1) {
        const a = supertest.agent(app);
        await a.get('/user/login');
        const c = csrfFrom((await a.get('/user/login')).text);
        const t = Date.now();
        await a.post('/user/login').type('form').send({ _csrf: c, username, password: 'xato-parol-123', lang: 'uz' });
        total += Date.now() - t;
      }
      return total / 3;
    }
    const ms1 = await avgMs(uname); // mavjud user, xato parol
    const ms2 = await avgMs('yoq_user_999999'); // yo'q user — dummy hash + jitter
    // O'rtacha farq 3x dan oshmasligi kerak — enumeration timing orqali
    // userni aniqlab bo'lmasligi (jitter + dummy argon2 tenglashtiradi).
    const ratio = Math.max(ms1, ms2) / Math.max(1, Math.min(ms1, ms2));
    expect(ratio).toBeLessThan(3);
    // Ikki yo'l ham sekin bo'lishi shart — yo'q user TEZ javob qaytarmasligi
    // (dummy argon2 verify bajariladi). Early-return bo'lsa ~5ms bo'lardi;
    // argon2 m=65536 tez mashinada 40-80ms — 40ms floor yetarli.
    expect(Math.min(ms1, ms2)).toBeGreaterThan(40);
  });

  it('A-31 §04: MFA challenge — replay blok (bir marta ishlatiladi)', async () => {
    const uname = `mfareplay${Date.now() % 100000}`;
    const userKey = safeKey(uname);
    await registerUser(supertest.agent(app), uname, 'parol-2026-x-uzun', null, nextIp());
    // MFA'ni to'g'ridan-to'g'ri yoqamiz (setup+enable)
    const { setupTotp, enableTotp } = await import('../../src/modules/auth/mfa-totp.js');
    const setup = await setupTotp(userKey, { accountName: uname });
    await enableTotp(userKey, await generate({ secret: setup.secret }));

    // Login → challenge
    const agent = supertest.agent(app);
    const login = await loginUser(agent, uname);
    expect(login.headers.location).toMatch(/^\/user\/mfa\?challenge=/);
    const challengeId = login.headers.location.split('challenge=')[1];

    const mfaPage = await agent.get(`/user/mfa?challenge=${challengeId}`);
    const csrf = csrfFromPanel(mfaPage.text);
    const code = await generate({ secret: setup.secret });
    const ok = await agent.post('/api/mfa/verify')
      .set('x-csrf-token', csrf)
      .send({ code, challengeId });
    expect(ok.status).toBe(200);
    // Session berildi
    const panel = await agent.get('/user/panel');
    expect([200, 302]).toContain(panel.status);
    // Replay — challenge endi consumed, session bor bo'lsa ham 400/401
    const replay = await agent.post('/api/mfa/verify')
      .set('x-csrf-token', csrf)
      .send({ code, challengeId });
    expect([400, 401, 403]).toContain(replay.status);
  });

  it('A-31 §05: teacher escalation — student oz rolini teacher qila olmaydi', async () => {
    const uname = `esc${Date.now() % 100000}`;
    const userKey = safeKey(uname);
    const agent = supertest.agent(app);
    await registerUser(agent, uname, 'parol-2026-x-uzun', null, nextIp());
    await loginUser(agent, uname);
    // Roli student bo'lishi kerak
    const u = await fb.get(`users/${userKey}`);
    expect(u.val().role).toBe('student');
    // Direct DB write bilan rol o'zgarishi mumkin — lekin session roleVersion
    // tekshiradi. Endi role'ni DB'da o'zgartirsak, eski sessiya invalid bo'ladi.
    await fb.set(`users/${userKey}/role`, 'teacher');
    await fb.set(`users/${userKey}/role_version`, 2);
    const panel = await agent.get('/user/panel');
    // Eski sessiya BEKOR qilinishi kerak (A-31 review fix — roleVersion har
    // 60s tekshiriladi). 401 JSON (supertest Accept:json) yoki 302 → /user/login.
    if (panel.status === 401) {
      expect(panel.body.error).toBeTruthy();
    } else {
      expect(panel.status).toBe(302);
      expect(panel.headers.location).toContain('/user/login');
    }
  });

  it('A-31 §06: session invalidation — parol ozgarishi boshqa sessiyani oldiradi', async () => {
    const uname = `pwchange${Date.now() % 100000}`;
    const userKey = safeKey(uname);
    const agent = supertest.agent(app);
    await registerUser(agent, uname, 'parol-2026-x-uzun', null, nextIp());
    await loginUser(agent, uname);
    const csrf = csrfFromPanel((await agent.get('/user/panel')).text);
    // Parolni o'zgartiramiz (DB'da to'g'ridan-to'g'ri — session invalidation signal)
    await fb.set(`users/${userKey}/password`, await hashPassword('yangi-parol-2026'));
    await fb.set(`users/${userKey}/password_updated_at`, Date.now());
    // Eski sessiya endi ishonchsiz — requireAuth uni o'ldiradi
    const panel = await agent.get('/user/panel');
    // Sessiya bekor: 401 JSON yoki 302 → /user/login (aniq destination)
    if (panel.status === 401) {
      expect(panel.body.error).toBeTruthy();
    } else {
      expect(panel.status).toBe(302);
      expect(panel.headers.location).toContain('/user/login');
    }
  });

  it('A-31 §07: raw parol hech qayerda chiqmaydi (secret/PII leak)', async () => {
    const uname = `leak${Date.now() % 100000}`;
    // A-22 NIST siyosati: min 8 + harf + raqam; zxcvbn score >= 3.
    // 'parol-2026-x-uzun' barcha A-testlarida o'tadigan sinalgan parol.
    const password = 'parol-2026-x-uzun';
    const agent = supertest.agent(app);
    const reg = await registerUser(agent, uname, password, null, nextIp());
    // Register muvaffaqiyatli (302 redirect) — user yaratilgan
    expect([200, 302]).toContain(reg.status);
    // Register javobida parol chiqmasin
    expect(reg.text || '').not.toContain(password);
    // DB'da parol hash bo'lishi kerak (plaintext emas)
    const u = await fb.get(`users/${safeKey(uname)}`);
    const stored = u.val().password;
    expect(stored.startsWith('$argon2')).toBe(true);
    expect(stored).not.toContain(password);
    // Login javobida ham chiqmasin
    const agent2 = supertest.agent(app);
    const login = await loginUser(agent2, uname, password);
    expect(login.text).not.toContain(password);
  });

  it('A-31 §08: admin MFA mandatory — MFA sozlanmasa dashboard yopiq', async () => {
    // Flag'ni yoqamiz (live process.env — adminMfaMandatory o'qiydi)
    const prev = process.env.ADMIN_MFA_MANDATORY;
    process.env.ADMIN_MFA_MANDATORY = 'true';
    try {
      await fb.remove('mfa_totp/admin').catch(() => {});
      await fb.set('settings/admin_security', {
        loginFailures: 0, lockoutUntil: 0, breachFlagged: false,
        lastLoginAt: 0, lastCity: null, lastDeviceFp: null,
      }).catch(() => {});
      const agent = supertest.agent(app);
      const page = await agent.get('/admin/login');
      const csrf = csrfFrom(page.text);
      const res = await agent.post('/admin/login').type('form').send({
        _csrf: csrf, username: process.env.ADMIN_USER || 'admin',
        password: process.env.ADMIN_PASS || 'admin',
      });
      // MFA'siz → forced enroll sahifasiga (dashboard emas)
      expect(res.status).toBe(302);
      expect(res.headers.location).toBe('/admin/mfa/enroll');
      // Dashboard'ga kira olmaydi
      const dash = await agent.get('/admin/dashboard');
      expect([302, 401]).toContain(dash.status);
      expect(dash.status).not.toBe(200);
    } finally {
      if (prev === undefined) delete process.env.ADMIN_MFA_MANDATORY;
      else process.env.ADMIN_MFA_MANDATORY = prev;
    }
  });
});
