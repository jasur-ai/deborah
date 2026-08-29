/**
 * Deborah — "Profilim" integratsiya testlari
 * ------------------------------------------------
 *  - /user/profile: auth ro'yxatsiz → login redirect; ro'yxatdan → 200
 *  - /api/profile/me: to'liq shakl (username/email/role/mfa/hasPassword)
 *  - /api/profile/backup-codes:
 *      · MFA o'chiq → 400 mfa_disabled
 *      · noto'g'ri parol → 403
 *      · MFA yoqilgach: TOTP kod bilan → 12 ta yangi kod
 *      · parol bilan ham → 12 ta kod
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import supertest from 'supertest';
import { createApp } from '../../server.js';
import { snapshotDb, restoreDb } from '../helpers/setup.js';
import { generate } from 'otplib';
import { fb } from '../../firebase/admin.js';
import { hashPass } from '../../utils/helpers.js';

let app;
let ipCounter = 0;
const nextIp = () => `10.77.${Math.floor(ipCounter / 250) % 250}.${(ipCounter++ % 250) + 1}`;

function csrfFrom(html) {
  const m = String(html).match(/name="_csrf"[^>]*value="([a-f0-9]+)"/i)
    || String(html).match(/value="([a-f0-9]+)"[^>]*name="_csrf"/i)
    || String(html).match(/window\.__CSRF_TOKEN\s*=\s*'([a-f0-9]+)'/);
  return m ? m[1] : null;
}

async function registerUser(agent, username) {
  const page = await agent.get('/user/login?lang=uz');
  const csrf = csrfFrom(page.text);
  const res = await agent.post('/user/login').set('x-forwarded-for', nextIp()).type('form').send({
    mode: 'reg', consent: 'on', _csrf: csrf, username,
    email: `${username}@test.uz`, password: 'parol-2026-x-uzun', lang: 'uz',
  });
  return res;
}

describe('Profilim — hamma rollar uchun', () => {
  beforeAll(async () => {
    await snapshotDb();
    ({ app } = await createApp());
  });
  afterAll(async () => {
    await restoreDb();
  });

  it('ro\u2018yxatsiz /user/profile → login redirect', async () => {
    const agent = supertest.agent(app);
    const res = await agent.get('/user/profile').set('Accept', 'text/html');
    expect([302, 303]).toContain(res.status);
    expect(res.headers.location).toContain('/user/login');
  });

  it('ro\u2018yxatdan o\u2018tgan user: sahifa 200 + ma\u2019lumotlar ko\u2018rinadi', async () => {
    const agent = supertest.agent(app);
    const uname = `prof_${Date.now() % 1000000}`;
    await registerUser(agent, uname);
    const res = await agent.get('/user/profile').set('Accept', 'text/html');
    expect(res.status).toBe(200);
    expect(res.text).toContain('Profilim');
    expect(res.text).toContain(uname);
    expect(res.text).toContain('Zaxira kodlar');
  });

  it('/api/profile/me — to\u2018liq shakl', async () => {
    const agent = supertest.agent(app);
    const uname = `profm_${Date.now() % 1000000}`;
    await registerUser(agent, uname);
    const res = await agent.get('/api/profile/me');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    const p = res.body.profile;
    expect(p.username).toBe(uname);
    expect(p.email).toBe(`${uname}@test.uz`);
    expect(p.role).toBe('student');
    expect(p.mfa.status).toBe('none');
    expect(p.hasPassword).toBe(true);
    // parol hash'i hech qachon javobda yo'q
    expect(JSON.stringify(res.body)).not.toContain('argon2');
  });

  it('MFA o\u2018chiq → backup-codes 400 mfa_disabled', async () => {
    const agent = supertest.agent(app);
    const uname = `profbd_${Date.now() % 1000000}`;
    await registerUser(agent, uname);
    const csrf = csrfFrom((await agent.get('/user/panel')).text);
    const res = await agent.post('/api/profile/backup-codes')
      .set('x-csrf-token', csrf).send({ password: 'parol-2026-x-uzun' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('mfa_disabled');
  });

  it('MFA yoqilgancha: noto\u2018g\u2018ri parol → 403; parol bilan → 12 ta kod (TOTP so\u2018ralmaydi)', async () => {
    const agent = supertest.agent(app);
    const uname = `profmfa_${Date.now() % 1000000}`;
    await registerUser(agent, uname);
    // MFA faqat privileged rollarda — teacher'ga ko'taramiz (rol versiyasiga tegmaymiz)
    await fb.set(`users/${uname}/role`, 'teacher');
    const csrf = csrfFrom((await agent.get('/user/panel')).text);

    // MFA yoqish (faza 1 + 2)
    const setup = await agent.post('/api/mfa/totp/setup').set('x-csrf-token', csrf).send({});
    expect(setup.status).toBe(200);
    const token = await generate({ secret: setup.body.secret });
    const enable = await agent.post('/api/mfa/totp/enable').set('x-csrf-token', csrf).send({ token });
    expect(enable.body.ok).toBe(true);

    // Noto'g'ri parol → 403
    const bad = await agent.post('/api/profile/backup-codes')
      .set('x-csrf-token', csrf).send({ password: 'noto-gri-parol' });
    expect(bad.status).toBe(403);
    expect(bad.body.error).toBe('wrong_credentials');

    // Parol yuborilmasa → 400 password_required (Authenticator kodi ENDI yo'l emas)
    const noPass = await agent.post('/api/profile/backup-codes')
      .set('x-csrf-token', csrf).send({ mfaCode: '123456' });
    expect(noPass.status).toBe(400);
    expect(noPass.body.error).toBe('password_required');

    // Parol bilan → 12 ta kod
    const viaPass = await agent.post('/api/profile/backup-codes')
      .set('x-csrf-token', csrf).send({ password: 'parol-2026-x-uzun' });
    expect(viaPass.status).toBe(200);
    expect(viaPass.body.backupCodes).toHaveLength(12);
    viaPass.body.backupCodes.forEach((c) => {
      expect(c).toMatch(/^[0-9a-f]{10}$/);
    });
  });

  it('LEGACY sha256 parol (eski akkaunt): to\u2018g\u2018ri parol → 200 + 12 kod + argon2 migratsiya', async () => {
    const agent = supertest.agent(app);
    const uname = `profleg_${Date.now() % 1000000}`;
    const pass = 'parol-2026-x-uzun';
    await registerUser(agent, uname);
    await fb.set(`users/${uname}/role`, 'teacher');
    const csrf = csrfFrom((await agent.get('/user/panel')).text);

    // MFA yoqish
    const setup = await agent.post('/api/mfa/totp/setup').set('x-csrf-token', csrf).send({});
    expect(setup.status).toBe(200);
    const token = await generate({ secret: setup.body.secret });
    await agent.post('/api/mfa/totp/enable').set('x-csrf-token', csrf).send({ token });

    // ESKI formatga qaytaramiz (foydalanuvchining holati): sha256(qb_{userKey}_{pass})
    await fb.set(`users/${uname}/password`, hashPass(pass, uname));

    // To'g'ri parol → 200 (avval 403 berardi — verifyPassword argon2'gina edi)
    const res = await agent.post('/api/profile/backup-codes')
      .set('x-csrf-token', csrf).send({ password: pass });
    expect(res.status).toBe(200);
    expect(res.body.backupCodes).toHaveLength(12);

    // Hash argon2'ga migratsiya bo'ldi
    const after = await fb.get(`users/${uname}/password`);
    expect(after.val().startsWith('$argon2')).toBe(true);
  });

  it('LEGACY sha256 XATO parol → 403 (migratsiya bo\u2018lmaydi)', async () => {
    const agent = supertest.agent(app);
    const uname = `proflg2_${Date.now() % 1000000}`;
    const pass = 'parol-2026-x-uzun';
    await registerUser(agent, uname);
    await fb.set(`users/${uname}/role`, 'teacher');
    const csrf = csrfFrom((await agent.get('/user/panel')).text);
    const setup = await agent.post('/api/mfa/totp/setup').set('x-csrf-token', csrf).send({});
    const token = await generate({ secret: setup.body.secret });
    await agent.post('/api/mfa/totp/enable').set('x-csrf-token', csrf).send({ token });
    await fb.set(`users/${uname}/password`, hashPass(pass, uname));

    const res = await agent.post('/api/profile/backup-codes')
      .set('x-csrf-token', csrf).send({ password: 'xato-parol-123' });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('wrong_credentials');
    const after = await fb.get(`users/${uname}/password`);
    expect(after.val().startsWith('$argon2')).toBe(false); // migratsiya bo'lmadi
  });

  it('talaba MFA yoqolmaydi: /api/mfa/totp/setup → 403 mfa_not_allowed', async () => {
    const agent = supertest.agent(app);
    const uname = `profstu_${Date.now() % 1000000}`;
    await registerUser(agent, uname); // role=student qoladi
    const csrf = csrfFrom((await agent.get('/user/panel')).text);
    const res = await agent.post('/api/mfa/totp/setup').set('x-csrf-token', csrf).send({});
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('mfa_not_allowed');
  });
});
