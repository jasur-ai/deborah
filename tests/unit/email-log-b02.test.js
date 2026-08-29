/**
 * AUTH B-02 — Email schema (email_log, verification_codes) unit testlari
 * ---------------------------------------------------------------------
 * - hashEmail: deterministik HMAC-SHA256 (DSAR uchun), plaintext qaytmaydi
 * - logEmailRecord: emailHash saqlaydi, plaintext email YO'Q
 * - provider.sendEmail: sent/failed status'lar email_log'ga yoziladi
 * - webhook: email_log'da emailHash (PII minimal)
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { fb } from '../../firebase/admin.js';
import { snapshotDb, restoreDb } from '../helpers/setup.js';
import { hashEmail, logEmailRecord, EMAIL_LOG_STATUS } from '../../src/modules/email/log.js';
import { sendEmail } from '../../src/modules/email/provider.js';
import { processEmailWebhook } from '../../src/modules/email/webhook.js';

describe('AUTH B-02 — email log', () => {
  beforeAll(async () => {
    await snapshotDb();
  });
  afterAll(async () => {
    await restoreDb();
  });

  it('hashEmail: deterministik (bir xil email → bir xil hash)', () => {
    const h1 = hashEmail('Test@Example.uz');
    const h2 = hashEmail('test@example.uz'); // lowercase normalizatsiya
    expect(h1).toBe(h2);
    expect(h1).toMatch(/^[a-f0-9]{64}$/); // HMAC-SHA256 hex
  });

  it('hashEmail: turli email → turli hash; null → null', () => {
    expect(hashEmail('a@x.uz')).not.toBe(hashEmail('b@x.uz'));
    expect(hashEmail(null)).toBe(null);
    expect(hashEmail('')).toBe(null);
  });

  it('hashEmail: hash dan email qaytarib bo lmaydi (plaintext yo q)', () => {
    const h = hashEmail('secret@x.uz');
    expect(String(h)).not.toContain('secret');
    expect(String(h)).not.toContain('@');
  });

  it('logEmailRecord: emailHash saqlanadi, plaintext email YOQ', async () => {
    const { id } = await logEmailRecord({
      email: 'alisher@x.uz',
      template: 'welcome',
      status: 'sent',
      providerMsgId: 'msg-1',
    });
    expect(id).toBeTruthy();
    const snap = await fb.get(`email_log/${id}`);
    expect(snap.exists()).toBe(true);
    const rec = snap.val();
    expect(rec.emailHash).toBe(hashEmail('alisher@x.uz'));
    expect(rec.template).toBe('welcome');
    expect(rec.status).toBe('sent');
    expect(rec.providerMsgId).toBe('msg-1');
    expect(rec.email).toBeUndefined(); // plaintext HECH QACHON
    expect(rec.error).toBe(null);
  });

  it('logEmailRecord: idempotent — bir xil id qayta yoziladi', async () => {
    await logEmailRecord({ email: 'dup@x.uz', template: 'verify', status: 'sent', id: 'fixed-id-1' });
    await logEmailRecord({ email: 'dup@x.uz', template: 'verify', status: 'sent', id: 'fixed-id-1' });
    const snap = await fb.get('email_log/fixed-id-1');
    expect(snap.exists()).toBe(true);
  });

  it('provider.sendEmail (mock): success → email_log status=sent + messageId', async () => {
    const res = await sendEmail({
      to: 'student@x.uz',
      subject: 'Salom',
      html: '<p>Hi</p>',
      tag: 'welcome',
    }, { sendImpl: async () => ({ messageId: 'mock-abc-1' }) });

    expect(res.ok).toBe(true);
    expect(res.messageId).toBe('mock-abc-1');
    const snap = await fb.get(`email_log/mock-abc-1`);
    expect(snap.exists()).toBe(true);
    const rec = snap.val();
    expect(rec.status).toBe('sent');
    expect(rec.template).toBe('welcome');
    expect(rec.emailHash).toBe(hashEmail('student@x.uz'));
    expect(rec.email).toBeUndefined();
  });

  it('provider.sendEmail: failure → email_log status=failed + error', async () => {
    const res = await sendEmail({
      to: 'fail@x.uz',
      subject: 'X',
      html: '<p>x</p>',
      tag: 'reset',
    }, { sendImpl: async () => { throw new Error('boom'); } });

    expect(res.ok).toBe(false);
    // Retry 3x (1s/3s/9s) — test'da kutishni qisqartiramiz? sendImpl throw
    // hammasida: 1+3=4s. Timeout xavfini kamaytirish uchun tez tekshiruv:
    // email_log'da failed record borligini tekshiramiz (id random — oxirgi yozuv)
    const logSnap = await fb.get('email_log');
    const all = logSnap.exists() ? logSnap.val() : {};
    const failed = Object.values(all).find((r) => r && r.status === 'failed' && r.template === 'reset');
    expect(failed).toBeTruthy();
    expect(failed.error).toContain('boom');
    expect(failed.emailHash).toBe(hashEmail('fail@x.uz'));
    expect(failed.email).toBeUndefined();
  });

  it('webhook: email_log record emailHash ishlatadi (PII minimal)', async () => {
    const payload = { MessageID: 'wb-42', Type: 'HardBounce', Email: 'bounce@x.uz' };
    const res = await processEmailWebhook(payload);
    expect(res.ok).toBe(true);
    expect(res.event).toBe('email:bounced');
    const snap = await fb.get('email_log/wb-42');
    expect(snap.exists()).toBe(true);
    const rec = snap.val();
    expect(rec.emailHash).toBe(hashEmail('bounce@x.uz'));
    expect(rec.email).toBeUndefined(); // plaintext yo'q
  });

  it('webhook MERGE: sent record overwrite emas, status=bounced qo shiladi (review fix)', async () => {
    // Provider 'sent' record yozadi
    await logEmailRecord({
      email: 'merge@x.uz',
      template: 'welcome',
      status: 'sent',
      providerMsgId: 'wb-merge-1',
      id: 'wb-merge-1',
    });
    // Keyin bounce webhook keladi — merge qilinishi kerak
    const res = await processEmailWebhook({ MessageID: 'wb-merge-1', Type: 'HardBounce', Email: 'merge@x.uz' });
    expect(res.event).toBe('email:bounced');
    const rec = (await fb.get('email_log/wb-merge-1')).val();
    // Provider ma'lumotlari saqlanadi
    expect(rec.template).toBe('welcome');
    expect(rec.providerMsgId).toBe('wb-merge-1');
    // Status yangilanadi (schema enum)
    expect(rec.status).toBe('bounced');
    expect(rec.event).toBe('email:bounced');
    expect(rec.emailHash).toBe(hashEmail('merge@x.uz'));
  });

  it('EMAIL_LOG_STATUS enum 6 holat', () => {
    expect(EMAIL_LOG_STATUS).toEqual(['queued', 'sent', 'delivered', 'bounced', 'complained', 'failed']);
  });
});
