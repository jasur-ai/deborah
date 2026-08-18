/**
 * AUTH B-31 — Email queue unit testlari
 * -------------------------------------------------------------------
 * - enqueue: template validatsiya, no-recipient-ref rad, idempotency duplicate
 * - PII: job'da plaintext email/OTP/parol YO'Q (faqat userKey/inviteTokenHash)
 * - priority: urgent (reset) normal'dan oldin to'kiladi
 * - retry: transient fail → attempts+1, backoff 1m/5m/15m
 * - DLQ: 3 marta fail → deadletter; recipient topilmasa → darhol deadletter
 * - recipient resolution: userKey → users/{key}/email; inviteTokenHash → invites/{hash}/email
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { fb } from '../../firebase/admin.js';
import { snapshotDb, restoreDb } from '../helpers/setup.js';
import { safeKey } from '../../utils/helpers.js';
import {
  enqueueEmail,
  processEmailQueue,
  queueDepth,
  deadLetterDepth,
  EMAIL_QUEUE_PATH,
  EMAIL_IDEMPOTENCY_PATH,
  EMAIL_RETRY_BACKOFFS_MS,
  QUEUE_TEMPLATES,
} from '../../src/modules/email/queue.js';

describe('AUTH B-31 — email queue (unit)', () => {
  beforeAll(async () => {
    await snapshotDb();
  });
  afterAll(async () => {
    await restoreDb();
  });
  beforeEach(async () => {
    // Test izolyatsiyasi — har test oldidan queue + idempotency toza
    await fb.remove(EMAIL_QUEUE_PATH).catch(() => {});
    await fb.remove(EMAIL_IDEMPOTENCY_PATH).catch(() => {});
  });

  it('enqueue: noma\'lum template rad; recipient referanssiz rad', async () => {
    const bad = await enqueueEmail({ template: 'nope', data: { userKey: 'x' } });
    expect(bad.ok).toBe(false);
    expect(bad.error).toBe('unknown-template');
    const noRef = await enqueueEmail({ template: 'reset', data: { lang: 'uz' } });
    expect(noRef.ok).toBe(false);
    expect(noRef.error).toBe('no-recipient-ref');
  });

  it('enqueue: job saqlanadi — plaintext email/OTP/parol YO\'Q (PII minimal)', async () => {
    await fb.set(`users/${safeKey('b31pii')}/email`, 'b31pii@test.uz');
    const r = await enqueueEmail({
      template: 'welcome',
      data: { userKey: 'b31pii', lang: 'uz', username: 'B31' },
      idempotencyKey: 'b31-pii-key',
      tag: 'welcome',
    });
    expect(r.ok).toBe(true);

    const snap = await fb.get(`${EMAIL_QUEUE_PATH}/${r.jobId}`);
    expect(snap.exists()).toBe(true);
    const job = snap.val();
    expect(job.status).toBe('queued');
    expect(job.template).toBe('welcome');
    expect(job.tag).toBe('welcome');
    // PII: plaintext email, OTP, parol YO'Q
    const raw = JSON.stringify(job);
    expect(raw).not.toContain('b31pii@test.uz');
    expect(raw).not.toContain('parol');
    expect(raw).not.toContain('@');
    // Queue template'lar ro'yxati to'liq
    expect(QUEUE_TEMPLATES).toContain('reset');
    expect(QUEUE_TEMPLATES).toContain('verify');
    expect(QUEUE_TEMPLATES).toContain('welcome');
  });

  it('idempotency: bir xil key ikkinchi marta enqueue → duplicate (yangi job YO\'Q)', async () => {
    const key = `b31-dup-${Date.now()}`;
    const first = await enqueueEmail({ template: 'welcome', data: { userKey: 'b31pii' }, idempotencyKey: key });
    const second = await enqueueEmail({ template: 'welcome', data: { userKey: 'b31pii' }, idempotencyKey: key });
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    expect(second.duplicate).toBe(true);
    // Idempotency record yozildi
    const seen = await fb.get(`${EMAIL_IDEMPOTENCY_PATH}/${safeKey(key)}`);
    expect(seen.exists()).toBe(true);
  });

  it('priority: urgent (reset) normal (welcome) dan oldin to\'kiladi', async () => {
    // Qasddan normal'ni AVVAL enqueue qilamiz — priority ustun keladi
    const normal = await enqueueEmail({ template: 'welcome', data: { userKey: 'b31pii' }, priority: 'normal' });
    const urgent = await enqueueEmail({ template: 'reset', data: { userKey: 'b31pii', resetUrl: 'https://x.uz/user/reset?token=t1' }, priority: 'urgent' });
    expect(urgent.ok).toBe(true);
    expect(normal.ok).toBe(true);

    const order = [];
    const r = await processEmailQueue({
      limit: 10,
      deps: { sendEmail: async (msg) => { order.push(msg.tag); return { ok: true, messageId: `mock-${order.length}` }; } },
    });
    expect(r.sent).toBe(2);
    expect(order).toEqual(['reset', 'welcome']); // urgent birinchi
  });

  it('retry: transient fail → attempts+1, backoff 1m; 2-fail → 5m; 3-fail → DLQ', async () => {
    await fb.set(`users/${safeKey('b31retry')}/email`, 'b31retry@test.uz');
    const r = await enqueueEmail({ template: 'welcome', data: { userKey: 'b31retry' } });
    const jobId = r.jobId;

    // 1-urinish fail → retry, nextRetryAt = now + 1m
    const now = Date.now();
    const r1 = await processEmailQueue({ now, deps: { sendEmail: async () => { throw new Error('timeout'); } } });
    expect(r1.retried).toBe(1);
    let job = (await fb.get(`${EMAIL_QUEUE_PATH}/${jobId}`)).val();
    expect(job.status).toBe('queued');
    expect(job.attempts).toBe(1);
    expect(job.nextRetryAt).toBe(now + EMAIL_RETRY_BACKOFFS_MS[0]);

    // 2-urinish fail → nextRetryAt = +5m
    const r2 = await processEmailQueue({ now: now + EMAIL_RETRY_BACKOFFS_MS[0], deps: { sendEmail: async () => { throw new Error('timeout'); } } });
    expect(r2.retried).toBe(1);
    job = (await fb.get(`${EMAIL_QUEUE_PATH}/${jobId}`)).val();
    expect(job.attempts).toBe(2);
    expect(job.nextRetryAt).toBe(now + EMAIL_RETRY_BACKOFFS_MS[0] + EMAIL_RETRY_BACKOFFS_MS[1]);

    // 3-urinish fail → DLQ
    const r3 = await processEmailQueue({ now: now + EMAIL_RETRY_BACKOFFS_MS[0] + EMAIL_RETRY_BACKOFFS_MS[1], deps: { sendEmail: async () => { throw new Error('timeout'); } } });
    expect(r3.deadletter).toBe(1);
    job = (await fb.get(`${EMAIL_QUEUE_PATH}/${jobId}`)).val();
    expect(job.status).toBe('deadletter');
    expect(await deadLetterDepth()).toBeGreaterThanOrEqual(1);
  });

  it('recipient topilmasa → darhol DLQ (retry foyda bermaydi)', async () => {
    const r = await enqueueEmail({ template: 'welcome', data: { userKey: 'b31-no-such-user' } });
    const res = await processEmailQueue({ deps: { sendEmail: async () => ({ ok: true }) } });
    expect(res.deadletter).toBe(1);
    const job = (await fb.get(`${EMAIL_QUEUE_PATH}/${r.jobId}`)).val();
    expect(job.status).toBe('deadletter');
  });

  it('recipient resolution: userKey va inviteTokenHash orqali (send paytida)', async () => {
    await fb.set(`users/${safeKey('b31resolve')}/email`, 'b31resolve@test.uz');
    const r1 = await enqueueEmail({ template: 'welcome', data: { userKey: 'b31resolve' } });
    await fb.set(`invites/${safeKey('b31inv')}`, { email: 'invite@test.uz', status: 'pending' });
    const r2 = await enqueueEmail({ template: 'invite', data: { inviteTokenHash: safeKey('b31inv'), inviteUrl: 'https://x.uz/invite/abc', courseCode: 'A', groupCode: 'G1' }, priority: 'normal' });

    const got = [];
    const res = await processEmailQueue({
      limit: 10,
      deps: { sendEmail: async (msg) => { got.push(msg.to); return { ok: true, messageId: 'm1' }; } },
    });
    expect(res.sent).toBe(2);
    expect(got).toContain('b31resolve@test.uz');
    expect(got).toContain('invite@test.uz');
    expect(r1.ok).toBe(true);
    expect(r2.ok).toBe(true);
  });

  it("queueDepth: queued job'lar soni; sent job'lar hisobga kirmaydi", async () => {
    await fb.set(`users/${safeKey('b31depth')}/email`, 'b31depth@test.uz');
    const before = await queueDepth();
    const r = await enqueueEmail({ template: 'welcome', data: { userKey: 'b31depth' } });
    expect(await queueDepth()).toBe(before + 1);
    await processEmailQueue({ deps: { sendEmail: async () => ({ ok: true, messageId: 'm2' }) } });
    const job = (await fb.get(`${EMAIL_QUEUE_PATH}/${r.jobId}`)).val();
    expect(job.status).toBe('sent');
  });
});
