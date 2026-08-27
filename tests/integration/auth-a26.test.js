import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import supertest from 'supertest';
import { createApp } from '../../server.js';
import { snapshotDb, restoreDb } from '../helpers/setup.js';
import { fb } from '../../firebase/admin.js';
import { decryptSecret, hashBackupCode } from '../../src/modules/auth/mfa-totp.js';
import { generate } from 'otplib';

// Counter — har chaqiruvda +1, 100–254 oralig'ida (154 ta IP — 7 test uchun
// yetarli, per-IP lockout boshqa testga yuqmaydi). Random emas.
let ipCounter = 100;
function nextIp() {
  ipCounter = 100 + ((ipCounter - 100 + 1) % 154);
  return `203.0.113.${ipCounter}`;
}

let app;
let httpServer;

function csrfFrom(html) {
  const m = html.match(/name="_csrf" value="([^"]+)"/);
  return m ? m[1] : null;
}
function csrfFromPanel(html) {
  const t = html.match(/window\.__CSRF_TOKEN\s*=\s*("([^"]+)"|'([^']+)')/);
  return t ? (t[2] || t[3]) : '';
}
// MFA sahifasi ham window.__CSRF_TOKEN ishlatadi — shu regex ikkalasida ishlaydi
const csrfFromMfa = csrfFromPanel;

async function registerUser(agent, username, opts = {}) {
  const page = await agent.get('/user/login?lang=uz');
  const csrf = csrfFrom(page.text);
  const body = {
    mode: 'reg', consent: 'on', _csrf: csrf, username,
    email: opts.email || `${username}@test.uz`,
    password: 'parol-2026-x-uzun', lang: 'uz',
  };
  const res = await agent.post('/user/login').set('x-forwarded-for', nextIp()).type('form').send(body);
  // 2026-08-27: MFA faqat admin/o'qituvchi — test userini teacher'ga ko'tiramiz
  // (role_version builmaydi — sessiya tirik qoladi; login challenge DB roleni o'qiydi)
  try { await fb.set(`users/${username}/role`, "teacher"); } catch (_) {}
  return res;
}

// Login YANGI agent bilan — register allaqachon session yaratadi (redirectIfAuth
// oldindan login qilgan agentni /user/panel ga yuborib, CSRF null qoldiradi).
async function login(username) {
  const fresh = supertest.agent(app);
  const page = await fresh.get('/user/login?lang=uz');
  const csrf = csrfFrom(page.text);
  const ip = nextIp();
  const res = await fresh.post('/user/login').set('x-forwarded-for', ip).type('form').send({
    _csrf: csrf, username, password: 'parol-2026-x-uzun', lang: 'uz',
  });
  return { agent: fresh, res, ip };
}

describe('AUTH A-26 — MFA/TOTP flow', () => {
  beforeAll(async () => {
    await snapshotDb();
    ({ app, httpServer } = await createApp());
    await new Promise((r) => httpServer.listen(0, r));
  });
  // Har testda in-memory rate-limit bucket'larni tozalaymiz — MFA ip limiti
  // (20/15min) bitta test faylida 26+ POST bilan to'planib qolgan testlarni
  // 429 bilan bloklamasligi uchun (per-IP xavfi faqat parallel bot'larga
  // qarshi; izolyatsiya qilingan testlar uchun reset xavfsiz).
  beforeEach(() => {
    app.get('authRateLimiter')?._reset?.();
  });
  afterAll(async () => {
    await restoreDb();
    await new Promise((r) => httpServer.close(r));
  });

  it('setup → enable (TOTP) → MFA active; qayta setup 409', async () => {
    const agent = supertest.agent(app);
    const uname = `a26a_${Date.now() % 1000000}`;
    await registerUser(agent, uname);
    const { res: loginRes } = await login(uname);
    expect(loginRes.status).toBe(302);

    const csrf = csrfFromPanel((await agent.get('/user/panel')).text);

    // setup
    const setup = await agent.post('/api/mfa/totp/setup').set('x-csrf-token', csrf).send({});
    expect(setup.status).toBe(200);
    expect(setup.body.ok).toBe(true);
    expect(setup.body.secret).toMatch(/^[A-Z2-7]+$/);
    expect(setup.body.otpauth).toContain('otpauth://totp/');
    expect(setup.body.qr).toMatch(/^data:image\/png;base64,/);

    // enable with correct TOTP code
    const token = await generate({ secret: setup.body.secret });
    const enable = await agent.post('/api/mfa/totp/enable').set('x-csrf-token', csrf).send({ token });
    expect(enable.status).toBe(200);
    expect(enable.body.ok).toBe(true);
    expect(enable.body.backupCodes).toHaveLength(12);

    // DB: secret encrypt, status active
    const rec = await fb.get(`mfa_totp/${uname}`);
    expect(rec.exists()).toBe(true);
    expect(rec.val().status).toBe('active');
    expect(decryptSecret(rec.val().secretEnc)).toBe(setup.body.secret);

    // qayta setup → 409
    const again = await agent.post('/api/mfa/totp/setup').set('x-csrf-token', csrf).send({});
    expect(again.status).toBe(409);

    // status endpoint
    const status = await agent.get('/api/mfa/status');
    expect(status.body.ok).toBe(true);
    expect(status.body.status).toBe('active');
    expect(status.body.backupCodesRemaining).toBe(12);
  });

  it('login challenge: parol to\'g\'ri, MFA active → redirect /user/mfa, session BERILMAYDI', async () => {
    const agent = supertest.agent(app);
    const uname = `a26b_${Date.now() % 1000000}`;
    await registerUser(agent, uname);
    await login(uname);
    const csrf = csrfFromPanel((await agent.get('/user/panel')).text);
    const setup = await agent.post('/api/mfa/totp/setup').set('x-csrf-token', csrf).send({});
    const token = await generate({ secret: setup.body.secret });
    await agent.post('/api/mfa/totp/enable').set('x-csrf-token', csrf).send({ token });
    await agent.get('/user/logout').redirects(0).catch(() => {});

    // Yangi brauzer: parol bilan login → MFA challenge (login() yangi agent beradi)
    const { agent: fresh, res: loginRes } = await login(uname);
    expect(loginRes.status).toBe(302);
    expect(loginRes.headers.location).toMatch(/^\/user\/mfa\?challenge=/);

    // Session HENUZ berilmagan — /user/panel 302 (login'ga) yoki 401
    const panel = await fresh.get('/user/panel');
    expect([302, 401]).toContain(panel.status);

    // MFA sahifa ochiladi
    const mfaPage = await fresh.get(loginRes.headers.location);
    expect(mfaPage.status).toBe(200);
    expect(mfaPage.text).toContain('Ikki bosqichli tekshiruv');

    // Kodni verify → session beriladi
    const challengeId = loginRes.headers.location.split('challenge=')[1];
    const verify = await fresh.post('/api/mfa/verify').set('x-csrf-token', csrfFromMfa(mfaPage.text)).send({
      code: await generate({ secret: setup.body.secret }),
      challengeId,
    });
    expect(verify.status).toBe(200);
    expect(verify.body.ok).toBe(true);

    // Endi session bor
    const panel2 = await fresh.get('/user/panel');
    expect(panel2.status).toBe(200);
  });

  it('login challenge: noto\'g\'ri kod → 403; challenge reuse → 401', async () => {
    const agent = supertest.agent(app);
    const uname = `a26c_${Date.now() % 1000000}`;
    await registerUser(agent, uname);
    await login(uname);
    const csrf = csrfFromPanel((await agent.get('/user/panel')).text);
    const setup = await agent.post('/api/mfa/totp/setup').set('x-csrf-token', csrf).send({});
    const token = await generate({ secret: setup.body.secret });
    await agent.post('/api/mfa/totp/enable').set('x-csrf-token', csrf).send({ token });
    await agent.get('/user/logout').redirects(0).catch(() => {});

    const { agent: fresh, res: loginRes } = await login(uname);
    const challengeId = loginRes.headers.location.split('challenge=')[1];
    const mfaPage = await fresh.get(loginRes.headers.location);

    // Noto'g'ri kod
    const bad = await fresh.post('/api/mfa/verify').set('x-csrf-token', csrfFromMfa(mfaPage.text)).send({
      code: '000000', challengeId,
    });
    expect(bad.status).toBe(403);
    expect(bad.body.error).toBe('invalid_code');

    // Challenge hali consumed emas — to'g'ri kod bilan ishlaydi
    const good = await fresh.post('/api/mfa/verify').set('x-csrf-token', csrfFromMfa(mfaPage.text)).send({
      code: await generate({ secret: setup.body.secret }),
      challengeId,
    });
    expect(good.status).toBe(200);
    expect(good.body.ok).toBe(true);

    // Muvaffaqiyatli verify session'ni regenerate qiladi (yangi CSRF) —
    // panel'dan yangi CSRF olamiz, reuse'ni sinash uchun
    const panelAfter = await fresh.get('/user/panel');
    const csrfNew = csrfFromPanel(panelAfter.text);
    // Reuse → 401 (challenge consumed + pendingMfa session'dan o'chirilgan —
    // no_pending_challenge yoki challenge_invalid, ikkalasi ham to'g'ri himoya)
    const reuse = await fresh.post('/api/mfa/verify').set('x-csrf-token', csrfNew).send({
      code: await generate({ secret: setup.body.secret }),
      challengeId,
    });
    expect(reuse.status).toBe(401);
    expect(['no_pending_challenge', 'challenge_invalid']).toContain(reuse.body.error);
  });

  it('login challenge: backup code bilan kirish ishlaydi, replay himoya', async () => {
    const agent = supertest.agent(app);
    const uname = `a26d_${Date.now() % 1000000}`;
    await registerUser(agent, uname);
    await login(uname);
    const csrf = csrfFromPanel((await agent.get('/user/panel')).text);
    const setup = await agent.post('/api/mfa/totp/setup').set('x-csrf-token', csrf).send({});
    const token = await generate({ secret: setup.body.secret });
    const enable = await agent.post('/api/mfa/totp/enable').set('x-csrf-token', csrf).send({ token });
    const backupCode = enable.body.backupCodes[0];
    await agent.get('/user/logout').redirects(0).catch(() => {});

    const { agent: fresh, res: loginRes } = await login(uname);
    const challengeId = loginRes.headers.location.split('challenge=')[1];
    const mfaPage = await fresh.get(loginRes.headers.location);

    const verify = await fresh.post('/api/mfa/verify').set('x-csrf-token', csrfFromMfa(mfaPage.text)).send({
      code: backupCode, challengeId,
    });
    expect(verify.status).toBe(200);
    expect(verify.body.ok).toBe(true);

    // Backup code used bo'lgan
    const bc = await fb.get(`mfa_backup_codes/${uname}`);
    const target = bc.val().codes.find((c) => c.h === hashBackupCode(backupCode));
    expect(target.usedAt).toBeGreaterThan(0);
    // Status: fresh agent (verify'dan keyingi session) bilan
    const status = await fresh.get('/api/mfa/status');
    expect(status.body.ok).toBe(true);
    expect(status.body.backupCodesRemaining).toBe(11); // 12 dan 1 tasi ishlatildi
  });

  it('5 xato urinish → 429 lockout (15 daqiqa)', async () => {
    const agent = supertest.agent(app);
    const uname = `a26e_${Date.now() % 1000000}`;
    await registerUser(agent, uname);
    await login(uname);
    const csrf = csrfFromPanel((await agent.get('/user/panel')).text);
    const setup = await agent.post('/api/mfa/totp/setup').set('x-csrf-token', csrf).send({});
    const token = await generate({ secret: setup.body.secret });
    await agent.post('/api/mfa/totp/enable').set('x-csrf-token', csrf).send({ token });
    await agent.get('/user/logout').redirects(0).catch(() => {});

    const { agent: fresh, res: loginRes, ip } = await login(uname);
    const challengeId = loginRes.headers.location.split('challenge=')[1];
    const mfaPage = await fresh.get(loginRes.headers.location);
    const csrf2 = csrfFromMfa(mfaPage.text);

    for (let i = 0; i < 5; i += 1) {
      await fresh.post('/api/mfa/verify').set('x-csrf-token', csrf2).set('x-forwarded-for', ip).send({
        code: '000000', challengeId,
      });
    }
    const locked = await fresh.post('/api/mfa/verify').set('x-csrf-token', csrf2).set('x-forwarded-for', ip).send({
      code: '000000', challengeId,
    });
    expect(locked.status).toBe(429);
    expect(locked.body.error).toBe('locked');
  });

  it('rotate backup codes: yangi 12 ta, status 12', async () => {
    const agent = supertest.agent(app);
    const uname = `a26f_${Date.now() % 1000000}`;
    await registerUser(agent, uname);
    await login(uname);
    const csrf = csrfFromPanel((await agent.get('/user/panel')).text);
    const setup = await agent.post('/api/mfa/totp/setup').set('x-csrf-token', csrf).send({});
    const token = await generate({ secret: setup.body.secret });
    await agent.post('/api/mfa/totp/enable').set('x-csrf-token', csrf).send({ token });

    // rotate sensitive — reauth talab (login session'ida reauthedAt yo'q)
    const noReauth = await agent.post('/api/mfa/totp/backup/rotate').set('x-csrf-token', csrf).send({});
    expect(noReauth.status).toBe(403);
    expect(noReauth.body.error).toBe('reauth_required');

    const reauth = await agent.post('/api/auth/reauth').set('x-csrf-token', csrf).send({ password: 'parol-2026-x-uzun' });
    expect(reauth.status).toBe(200);

    const rotate = await agent.post('/api/mfa/totp/backup/rotate').set('x-csrf-token', csrf).send({});
    expect(rotate.status).toBe(200);
    expect(rotate.body.backupCodes).toHaveLength(12);
    const status = await agent.get('/api/mfa/status');
    expect(status.body.backupCodesRemaining).toBe(12);
  });

  it('disable: reauth talab (403 reauth_required) — so\'ng reauth bilan 200', async () => {
    const agent = supertest.agent(app);
    const uname = `a26g_${Date.now() % 1000000}`;
    await registerUser(agent, uname);
    await login(uname);
    const csrf = csrfFromPanel((await agent.get('/user/panel')).text);
    const setup = await agent.post('/api/mfa/totp/setup').set('x-csrf-token', csrf).send({});
    const token = await generate({ secret: setup.body.secret });
    await agent.post('/api/mfa/totp/enable').set('x-csrf-token', csrf).send({ token });

    // reauth YO'Q → 403
    const noReauth = await agent.post('/api/mfa/totp/disable').set('x-csrf-token', csrf).send({});
    expect(noReauth.status).toBe(403);
    expect(noReauth.body.error).toBe('reauth_required');

    // reauth (parol) → disable 200
    const reauth = await agent.post('/api/auth/reauth').set('x-csrf-token', csrf).send({ password: 'parol-2026-x-uzun' });
    console.log('[DBG a26 disable] reauth', reauth.status, JSON.stringify(reauth.body));
    expect(reauth.status).toBe(200);
    const disable = await agent.post('/api/mfa/totp/disable').set('x-csrf-token', csrf).send({});
    console.log('[DBG a26 disable] disable', disable.status, JSON.stringify(disable.body));
    expect(disable.status).toBe(200);
    expect(disable.body.ok).toBe(true);

    const status = await agent.get('/api/mfa/status');
    expect(status.body.status).toBe('none');
  });
});
