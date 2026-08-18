/**
 * Deborah — AUTH B-02 Email schema — Integration tests
 * ----------------------------------------------------
 *  - Register → welcome email email_log'da (status, emailHash — plaintext yo'q)
 *  - Verification code: codeHash + salt (plaintext code YO'Q)
 *  - MFA secret: secretEnc (AES-256-GCM) — plaintext secret YO'Q
 *  - email_verify/verification_codes xulq-atvori B-02 schema'ga mos
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import supertest from 'supertest';
import { createApp } from '../../server.js';
import { snapshotDb, restoreDb } from '../helpers/setup.js';
import { fb } from '../../firebase/admin.js';
import { safeKey } from '../../utils/helpers.js';
import { hashEmail } from '../../src/modules/email/log.js';
import { setupTotp } from '../../src/modules/auth/mfa-totp.js';

let ipCounter = 200;
function nextIp() {
  ipCounter = 200 + ((ipCounter - 200 + 1) % 54);
  return `203.0.113.${ipCounter}`;
}

let app;
let httpServer;

function csrfFrom(html) {
  const m = html.match(/name="_csrf" value="([^"]+)"/);
  return m ? m[1] : null;
}

async function register(agent, username) {
  const page = await agent.get('/user/login?lang=uz');
  const csrf = csrfFrom(page.text);
  return agent.post('/user/login').set('x-forwarded-for', nextIp()).type('form').send({
    mode: 'reg', consent: 'on', _csrf: csrf, username,
    email: `${username}@test.uz`,
    password: 'parol-2026-x-uzun', lang: 'uz',
  });
}

describe('AUTH B-02 — Email schema', () => {
  beforeAll(async () => {
    await snapshotDb();
    ({ app, httpServer } = await createApp());
    await new Promise((r) => httpServer.listen(0, r));
  });
  afterAll(async () => {
    await restoreDb();
    await new Promise((r) => httpServer.close(r));
  });

  it('register → welcome email email_log da (status sent, emailHash, plaintext yo q)', async () => {
    const username = `b02u_${Date.now()}`;
    const agent = supertest.agent(app);
    const res = await register(agent, username);
    expect([200, 302]).toContain(res.status);

    const email = `${username}@test.uz`;
    const logSnap = await fb.get('email_log');
    const all = logSnap.exists() ? logSnap.val() : {};
    const welcome = Object.values(all).find((r) => r && r.template === 'welcome' && r.emailHash === hashEmail(email));
    expect(welcome).toBeTruthy();
    expect(welcome.status).toBe('sent');
    // Plaintext email HECH QACHON email_log'da
    expect(welcome.email).toBeUndefined();
    expect(Object.values(all).some((r) => r && typeof r.email === 'string')).toBe(false);
  });

  it('verification code: codeHash + salt, plaintext code YOQ (guide §14)', async () => {
    const username = `b02v_${Date.now()}`;
    const agent = supertest.agent(app);
    await register(agent, username);

    // email_verify_last → lookupKey → record
    const lastSnap = await fb.get(`email_verify_last/${safeKey(username)}`);
    expect(lastSnap.exists()).toBe(true);
    const lookupKey = lastSnap.val().lookupKey;
    const recSnap = await fb.get(`email_verify/${lookupKey}`);
    expect(recSnap.exists()).toBe(true);
    const rec = recSnap.val();
    expect(typeof rec.codeHash).toBe('string');
    expect(rec.codeHash).toMatch(/^[a-f0-9]{64}$/); // SHA-256
    expect(typeof rec.salt).toBe('string');
    expect(rec.used).toBe(false);
    expect(rec.expiresAt).toBeGreaterThan(Date.now());
    // Plaintext code yo'q
    expect(rec.code).toBeUndefined();
  });

  it('MFA secret: secretEnc (AES-256-GCM), plaintext secret YOQ', async () => {
    const userId = `b02mfa_${Date.now()}`;
    const setup = await setupTotp(userId, { accountName: 'B02 Tester' });
    expect(setup.ok).toBe(true);

    const snap = await fb.get(`mfa_totp/${safeKey(userId)}`);
    expect(snap.exists()).toBe(true);
    const rec = snap.val();
    expect(typeof rec.secretEnc).toBe('string'); // encryptlangan
    expect(rec.secretEnc).not.toBe(setup.secret); // plaintext emas
    expect(rec.status).toBe('pending');
    // Plaintext secret yo'q
    expect(rec.secret).toBeUndefined();
  });

  it('webhook hard bounce → email_status=bounced + email_log emailHash', async () => {
    const username = `b02b_${Date.now()}`;
    const agent = supertest.agent(app);
    await register(agent, username);
    const email = `${username}@test.uz`;

    const { processEmailWebhook } = await import('../../src/modules/email/webhook.js');
    const res = await processEmailWebhook({ MessageID: 'wb-b02-1', Type: 'HardBounce', Email: email });
    expect(res.ok).toBe(true);
    expect(res.event).toBe('email:bounced');

    // email_log — emailHash, plaintext yo'q
    const logSnap = await fb.get('email_log/wb-b02-1');
    expect(logSnap.exists()).toBe(true);
    expect(logSnap.val().emailHash).toBe(hashEmail(email));
    expect(logSnap.val().email).toBeUndefined();
  });
});
