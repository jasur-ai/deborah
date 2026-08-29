import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// fb mock — local-db'ga o'xshash get/set API (vi.hoisted — hoisting xavfsiz)
// Nested read: `a/b/c` so'ralsa `a/b` da ob'ekt bo'lsa uning `c` maydonini qaytaradi
// (real local-db xatti-harakati — idempotency check uchun kerak).
const { db, readPath } = vi.hoisted(() => {
  const db = new Map();
  function readPath(path) {
    if (db.has(path)) return { exists: () => true, val: () => db.get(path) };
    const idx = path.lastIndexOf('/');
    if (idx > 0) {
      const parent = db.get(path.slice(0, idx));
      if (parent && typeof parent === 'object' && path.slice(idx + 1) in parent) {
        return { exists: () => true, val: () => parent[path.slice(idx + 1)] };
      }
    }
    return { exists: () => false, val: () => null };
  }
  return { db, readPath };
});

vi.mock('../../firebase/admin.js', () => ({
  fb: {
    get: async (path) => readPath(path),
    set: async (path, val) => {
      db.set(path, val);
      return { ok: true };
    },
  },
}));

import { processEmailWebhook, isHardBounce, classifyEvent } from '../../src/modules/email/webhook.js';

describe('AUTH A-23 — Email webhook (unit)', () => {
  beforeEach(() => {
    db.clear();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('hard bounce (Postmark) → email_status=bounced + suppress yozuvi', async () => {
    db.set('users_email_index/user_test_uz', 'user1');
    const r = await processEmailWebhook({
      MessageID: 'pm-1',
      Type: 'HardBounce',
      Email: 'user@test.uz',
    });
    expect(r.ok).toBe(true);
    expect(r.event).toBe('email:bounced');
    const status = db.get('users/user1/email_status');
    expect(status).toBe('bounced');
    expect(db.get('email_suppressed/user_test_uz')).toBeTruthy();
    expect(db.get('email_log/pm-1').event).toBe('email:bounced');
  });

  it('soft bounce (Transient) → suppress EMAS, faqat log', async () => {
    db.set('users_email_index/user_test_uz', 'user1');
    const r = await processEmailWebhook({
      MessageID: 'pm-2',
      Type: 'Transient',
      Email: 'user@test.uz',
    });
    expect(r.event).toBe('email:bounced');
    expect(db.get('users/user1/email_status')).toBeUndefined();
    expect(db.get('email_suppressed/user@test.uz')).toBeUndefined();
  });

  it('SES format (Permanent bounce) → ham suppress', async () => {
    db.set('users_email_index/user_test_uz', 'user1');
    const r = await processEmailWebhook({
      MessageId: 'ses-1',
      notificationType: 'Bounce',
      bounce: { bounceType: 'Permanent' },
      mail: { destination: ['user@test.uz'] },
    });
    expect(r.event).toBe('email:bounced');
    expect(db.get('users/user1/email_status')).toBe('bounced');
  });

  it('complaint → audit event, suppress yo`q', async () => {
    db.set('users_email_index/user_test_uz', 'user1');
    const r = await processEmailWebhook({
      MessageID: 'pm-3',
      Type: 'SpamComplaint',
      Email: 'user@test.uz',
    });
    expect(r.event).toBe('email:complaint');
    expect(db.get('users/user1/email_status')).toBeUndefined();
  });

  it('idempotency: bir xil messageId + event ikkinchi marta duplicate', async () => {
    const payload = { MessageID: 'pm-4', Type: 'HardBounce', Email: 'user@test.uz' };
    db.set('users_email_index/user_test_uz', 'user1');
    await processEmailWebhook(payload);
    const r2 = await processEmailWebhook(payload);
    expect(r2.duplicate).toBe(true);
    expect(r2.event).toBe('email:bounced');
  });

  it('messageId yo`q → error', async () => {
    const r = await processEmailWebhook({ Type: 'HardBounce' });
    expect(r.ok).toBe(false);
    expect(r.error).toBe('no-message-id');
  });

  it('Delivery → delivered (B-31); Open/Click → ignored (log emas)', async () => {
    const r = await processEmailWebhook({ MessageID: 'pm-5', Type: 'Delivery' });
    expect(r.ok).toBe(true);
    expect(r.event).toBe('email:delivered');
    // Open/Click hali ham ignored — log'ga yozilmaydi
    const open = await processEmailWebhook({ MessageID: 'pm-6', Type: 'Open' });
    expect(open.ok).toBe(true);
    expect(open.event).toBe('ignored');
    const click = await processEmailWebhook({ MessageID: 'pm-7', Type: 'Click' });
    expect(click.event).toBe('ignored');
  });

  it('isHardBounce: Postmark + SES kombinatsiyalari', () => {
    expect(isHardBounce({ Type: 'HardBounce' })).toBe(true);
    expect(isHardBounce({ Type: 'Transient' })).toBe(false);
    expect(isHardBounce({ bounce: { bounceType: 'Permanent' } })).toBe(true);
    expect(isHardBounce({ bounce: { bounceType: 'Transient' } })).toBe(false);
  });

  it('classifyEvent: turli raw type`lar', () => {
    expect(classifyEvent({ Type: 'HardBounce' })).toBe('email:bounced');
    expect(classifyEvent({ notificationType: 'Complaint' })).toBe('email:complaint');
    expect(classifyEvent({ Type: 'Open' })).toBeNull();
  });
});
