/**
 * AUTH B-31 — Email queue integration testlari
 * -------------------------------------------------------------------
 * - Reset request → navbatga (urgent) → worker to'kadi → job 'sent'
 * - Webhook Delivery → email_log status 'delivered' (B-31 §11)
 * - Webhook HardBounce → email_suppressed + user email_status 'bounced'
 * - Throttle: limit parametri — har sikl faqat N job
 * - Idempotency: bir xil key duplicate (ikkilamchi yuborish yo'q)
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { snapshotDb, restoreDb, startServer, stopServer } from '../helpers/setup.js';
import { fb } from '../../firebase/admin.js';
import { safeKey } from '../../utils/helpers.js';
import {
  enqueueEmail,
  processEmailQueue,
  EMAIL_QUEUE_PATH,
} from '../../src/modules/email/queue.js';
import { processEmailWebhook } from '../../src/modules/email/webhook.js';
import { hashEmail, EMAIL_LOG_PATH } from '../../src/modules/email/log.js';

let serverUrl;
let xff = '203.0.113.171';

function nextIp() {
  // IPv4 okteti <= 255 — express-rate-limit noto'g'ri IP'ni rad etadi
  xff = `203.0.113.${171 + (Math.floor(Math.random() * 1000) % 80)}`;
  return xff;
}

beforeAll(async () => {
  snapshotDb();
  serverUrl = await startServer();
}, 90000);

afterAll(async () => {
  await stopServer();
  restoreDb();
});

beforeEach(async () => {
  // Test izolyatsiyasi — qoldiq job'lar keyingi testni buzmasin
  await fb.remove(EMAIL_QUEUE_PATH).catch(() => {});
  await fb.remove('email_idempotency').catch(() => {});
});

/** Verified user ro'yxatdan o'tkazadi (reset flow uchun). */
async function registerVerified(uname) {
  const page = await fetch(`${serverUrl}/user/login?lang=uz`);
  const html = await page.text();
  const m = html.match(/name="_csrf" value="([^"]+)"/);
  const csrf = m ? m[1] : null;
  // Set-Cookie'da lang (D-11 persist) + connect.sid ikkalasi bor — headers.get
  // ularni vergul bilan birlashtiradi va cookie buziladi. Faqat sessiya cookie.
  const setCookies = typeof page.headers.getSetCookie === 'function' ? page.headers.getSetCookie() : [];
  const sidCookie = setCookies.find((c) => c.startsWith('connect.sid=')) || '';
  const cookies = (sidCookie || page.headers.get('set-cookie') || '').split(';')[0];

  const res = await fetch(`${serverUrl}/user/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: cookies, 'x-forwarded-for': nextIp() },
    body: new URLSearchParams({
      mode: 'reg', consent: 'on', _csrf: csrf, username: uname, email: `${uname}@test.uz`,
      password: 'parol-2026-x-uzun', lang: 'uz',
    }),
    redirect: 'manual',
  });
  if (![302, 200].includes(res.status)) {
    const b = await res.text();
    console.log('B31 DEBUG status:', res.status, 'body:', b.slice(0, 120), 'csrf:', csrf, 'cookie-len:', cookies.length);
  }
  expect([302, 200]).toContain(res.status);
  await fb.set(`users/${safeKey(uname)}/email_verified`, true);
  return { cookies, csrf };
}

describe('AUTH B-31 — email queue (integration)', () => {
  it('Reset request → navbatga (urgent) → worker to\'kadi → job sent + email_log reset', async () => {
    const uname = `b31r${Date.now() % 1000000}`;
    await registerVerified(uname);

    // reset/request auth talab qilmaydi — yangi sessiya + csrf (register
    // sessiyasi CSRF boshqa sessiyaga bog'liq bo'lardi)
    const fresh = await fetch(`${serverUrl}/user/login?lang=uz`);
    const freshHtml = await fresh.text();
    const csrf = freshHtml.match(/name="_csrf" value="([^"]+)"/)[1];
    // lang (D-11 persist) cookie birinchi — faqat sessiya cookie olinadi
    const freshCookies = typeof fresh.headers.getSetCookie === 'function' ? fresh.headers.getSetCookie() : [];
    const freshSid = freshCookies.find((c) => c.startsWith('connect.sid=')) || '';
    const cookie = (freshSid || fresh.headers.get('set-cookie') || '').split(';')[0];

    const res = await fetch(`${serverUrl}/api/reset/request`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: cookie,
        'x-forwarded-for': nextIp(),
        'x-csrf-token': csrf,
      },
      body: JSON.stringify({ account: uname, lang: 'uz' }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.message).toBe('reset.sent');

    // Navbatda urgent reset job bor
    const snap = await fb.get(EMAIL_QUEUE_PATH);
    expect(snap.exists()).toBe(true);
    const jobs = Object.values(snap.val()).filter((j) => j && j.status === 'queued' && j.template === 'reset');
    expect(jobs.length).toBe(1);
    const job = jobs[0];
    expect(job.priority).toBe(0); // urgent
    expect(job.data.userKey).toBe(safeKey(uname));
    // PII: plaintext email job'da YO'Q
    expect(JSON.stringify(job)).not.toContain(`${uname}@test.uz`);

    // Worker to'kadi (mock send) — to'g'ri recipient'ga boradi
    const got = [];
    const r = await processEmailQueue({ deps: { sendEmail: async (msg) => { got.push(msg.to); return { ok: true, messageId: 'b31m1' }; } } });
    expect(r.sent).toBe(1);
    expect(got).toContain(`${uname}@test.uz`);

    // Job sent + email_log'da reset record
    const after = await fb.get(EMAIL_QUEUE_PATH);
    const sentJob = Object.values(after.val()).find((j) => j.template === 'reset');
    expect(sentJob.status).toBe('sent');
    const logSnap = await fb.get(EMAIL_LOG_PATH);
    const records = Object.values(logSnap.val() || {}).filter((l) => l.template === 'reset');
    expect(records.length).toBeGreaterThanOrEqual(1);
  });

  it('Webhook Delivery → email_log status delivered (B-31 §11)', async () => {
    const email = 'b31delivered@test.uz';
    const r = await processEmailWebhook({
      MessageID: 'pm-del-1',
      Type: 'Delivery',
      Email: email,
    });
    expect(r.ok).toBe(true);
    expect(r.event).toBe('email:delivered');
    const rec = (await fb.get(`${EMAIL_LOG_PATH}/${safeKey('pm-del-1')}`)).val();
    expect(rec.status).toBe('delivered');
    expect(rec.emailHash).toBe(hashEmail(email));
  });

  it('Webhook HardBounce → suppress + user email_status bounced', async () => {
    const uname = `b31b${Date.now() % 1000000}`;
    await registerVerified(uname);
    const email = `${uname}@test.uz`;

    const r = await processEmailWebhook({
      MessageID: 'pm-bounce-1',
      Type: 'HardBounce',
      Email: email,
    });
    expect(r.ok).toBe(true);
    expect(r.event).toBe('email:bounced');

    const suppressed = await fb.get(`email_suppressed/${safeKey(email)}`);
    expect(suppressed.exists()).toBe(true);
    expect(suppressed.val().reason).toBe('hard-bounce');
    const user = (await fb.get(`users/${safeKey(uname)}`)).val();
    expect(user.email_status).toBe('bounced');
    const rec = (await fb.get(`${EMAIL_LOG_PATH}/${safeKey('pm-bounce-1')}`)).val();
    expect(rec.status).toBe('bounced');
  });

  it('Throttle: limit=1 bo\'lsa har sikl faqat 1 job to\'kiladi', async () => {
    for (let i = 0; i < 3; i++) {
      await fb.set(`users/${safeKey(`b31t${i}`)}/email`, `b31t${i}@test.uz`);
      await enqueueEmail({ template: 'welcome', data: { userKey: `b31t${i}` } });
    }
    const r1 = await processEmailQueue({ limit: 1, deps: { sendEmail: async () => ({ ok: true, messageId: 't1' }) } });
    expect(r1.sent).toBe(1);
    // Qolgan 2 ta hali queued
    const snap = await fb.get(EMAIL_QUEUE_PATH);
    const queued = Object.values(snap.val()).filter((j) => j.status === 'queued').length;
    expect(queued).toBe(2);
  });

  it('Idempotency: bir xil key → duplicate, yuborish soni 1', async () => {
    await fb.set(`users/${safeKey('b31idem')}/email`, 'b31idem@test.uz');
    const key = `b31-idem-${Date.now()}`;
    const first = await enqueueEmail({ template: 'welcome', data: { userKey: 'b31idem' }, idempotencyKey: key });
    const second = await enqueueEmail({ template: 'welcome', data: { userKey: 'b31idem' }, idempotencyKey: key });
    expect(first.ok).toBe(true);
    expect(second.duplicate).toBe(true);

    let sent = 0;
    await processEmailQueue({ deps: { sendEmail: async () => { sent++; return { ok: true, messageId: 'i1' }; } } });
    expect(sent).toBe(1); // faqat bitta real yuborish
  });
});
