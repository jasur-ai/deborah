import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  pushEnabled,
  vapidPublicKey,
  isQuietHours,
  addPushSubscription,
  removePushSubscription,
  getUserPushSubscriptions,
  cleanupPushSubscriptions,
  _pushConfig,
} from '../../src/modules/student/push.js';
import { fb } from '../../firebase/admin.js';

// VAPID env'larini test uchun o'rnatamiz
const OLD_ENV = { ...process.env };

beforeEach(() => {
  process.env.VAPID_PUBLIC_KEY = 'test-public-key';
  process.env.VAPID_PRIVATE_KEY = 'test-private-key';
  process.env.PUSH_ENABLED = 'true';
});

afterEach(() => {
  process.env = { ...OLD_ENV };
});

describe('pushEnabled / vapidPublicKey', () => {
  it('VAPID juftligi bor bo\'lsa enabled', () => {
    expect(pushEnabled()).toBe(true);
    expect(vapidPublicKey()).toBe('test-public-key');
  });

  it('VAPID yo\'q bo\'lsa disabled', () => {
    delete process.env.VAPID_PRIVATE_KEY;
    expect(pushEnabled()).toBe(false);
  });

  it('PUSH_ENABLED=false bo\'lsa disabled', () => {
    process.env.PUSH_ENABLED = 'false';
    expect(pushEnabled()).toBe(false);
  });
});

describe('isQuietHours (§10)', () => {
  it('22:00-08:00 default quiet hours — kechki soat quiet', () => {
    process.env.PUSH_QUIET_START = '22';
    process.env.PUSH_QUIET_END = '8';
    const t23 = new Date('2026-01-15T23:00:00').getTime();
    const t06 = new Date('2026-01-15T06:00:00').getTime();
    expect(isQuietHours(t23)).toBe(true);
    expect(isQuietHours(t06)).toBe(true);
  });

  it('kunduzgi soat quiet emas', () => {
    process.env.PUSH_QUIET_START = '22';
    process.env.PUSH_QUIET_END = '8';
    const t12 = new Date('2026-01-15T12:00:00').getTime();
    expect(isQuietHours(t12)).toBe(false);
  });
});

describe('addPushSubscription (§08)', () => {
  it('subscription saqlaydi va idempotent — takroriy POST created=false', async () => {
    const endpoint = 'https://fcm.googleapis.com/send/abc123def456';
    const keys = { p256dh: 'AAAA', auth: 'BBBB' };
    const r1 = await addPushSubscription({ userId: 'user-x', endpoint, keys });
    expect(r1.ok).toBe(true);
    expect(r1.created).toBe(true);
    const r2 = await addPushSubscription({ userId: 'user-x', endpoint, keys });
    expect(r2.ok).toBe(true);
    expect(r2.created).toBe(false);
    const subs = await getUserPushSubscriptions('user-x');
    expect(subs.length).toBe(1);
    expect(subs[0].endpoint).toBe(endpoint);
  });

  it('endpoint bo\'lmasa invalid', async () => {
    const r = await addPushSubscription({ userId: 'user-x', endpoint: '' });
    expect(r.ok).toBe(false);
    expect(r.error).toBe('invalid_subscription');
  });

  it('removePushSubscription o\'chiradi', async () => {
    const endpoint = 'https://fcm.googleapis.com/send/xyz789';
    await addPushSubscription({ userId: 'user-y', endpoint, keys: { p256dh: 'A', auth: 'B' } });
    const r = await removePushSubscription({ userId: 'user-y', endpoint });
    expect(r.ok).toBe(true);
    const subs = await getUserPushSubscriptions('user-y');
    expect(subs.length).toBe(0);
  });
});

describe('cleanupPushSubscriptions (§29)', () => {
  it('180 kundan eski subscription tozalanadi', async () => {
    // old subscription — 200 kun oldin
    const oldEndpoint = 'https://fcm.googleapis.com/send/old-1';
    const uKey = 'cleanup-user';
    const now = Date.now();
    await fb.set(`users/${uKey}/push_subs/old`, {
      endpoint: oldEndpoint,
      keys: { p256dh: 'A', auth: 'B' },
      created_at: now - 200 * 24 * 60 * 60 * 1000,
      last_used_at: now - 200 * 24 * 60 * 60 * 1000,
    });
    // yangi subscription — qoladi
    await fb.set(`users/${uKey}/push_subs/new`, {
      endpoint: 'https://fcm.googleapis.com/send/new-1',
      keys: { p256dh: 'A', auth: 'B' },
      created_at: now,
      last_used_at: now,
    });
    const r = await cleanupPushSubscriptions();
    expect(r.removed).toBeGreaterThanOrEqual(1);
    const subs = await getUserPushSubscriptions(uKey);
    expect(subs.length).toBe(1);
    expect(subs[0].endpoint).toBe('https://fcm.googleapis.com/send/new-1');
  });
});
