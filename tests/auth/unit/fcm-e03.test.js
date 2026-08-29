/**
 * AUTH E-03 — FCM device-token push provider unit testlari.
 * ---------------------------------------------------------------------------
 *  - fcmEnabled / isValidFcmToken validatsiya
 *  - registerFcmToken: yaratish, idempotent, per-user limit (5), invalid
 *  - removeFcmToken / removeAllFcmTokens
 *  - sendFcmNotification: success, NotRegistered → token o'chadi, network fail
 *    → token saqlanadi, disabled, no_token
 *  - cleanupFcmTokens: 180 kun eski token tozalanadi
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const testStore = {};

vi.mock('../../../firebase/admin.js', () => {
  function navigate(store, path) {
    const parts = path.split('/').filter(Boolean);
    let current = store;
    for (let i = 0; i < parts.length; i++) {
      if (current === null || typeof current !== 'object' || !(parts[i] in current))
        return { found: false, parent: current, key: parts[i] };
      if (i === parts.length - 1) return { found: true, value: current[parts[i]], parent: current, key: parts[i] };
      current = current[parts[i]];
    }
    return { found: true, value: current, parent: null, key: null };
  }
  function setAt(store, path, value) {
    const parts = path.split('/').filter(Boolean);
    let cur = store;
    for (let i = 0; i < parts.length - 1; i++) {
      if (!(parts[i] in cur) || typeof cur[parts[i]] !== 'object') cur[parts[i]] = {};
      cur = cur[parts[i]];
    }
    cur[parts[parts.length - 1]] = JSON.parse(JSON.stringify(value));
  }
  return {
    fb: {
      get: vi.fn(async (path) => {
        const r = navigate(testStore, path);
        return { exists: () => r.found, val: () => (r.found ? JSON.parse(JSON.stringify(r.value)) : null) };
      }),
      set: vi.fn(async (path, value) => setAt(testStore, path, value)),
      update: vi.fn(async () => {}),
      remove: vi.fn(async (path) => {
        const r = navigate(testStore, path);
        if (r.found && r.parent) delete r.parent[r.key];
        else if (r.found) Object.keys(testStore).forEach((k) => delete testStore[k]);
      }),
    },
    default: {},
  };
});

vi.mock('../../../src/modules/auth/audit.js', () => ({
  audit: vi.fn(async () => true),
  logAuthEvent: vi.fn(async () => true),
  AUDIT_ACTIONS: {
    PUSH_SENT: 'push:sent',
    PUSH_FAILED: 'push:failed',
    PUSH_SUBSCRIBED: 'push:subscribed',
    PUSH_UNSUBSCRIBED: 'push:unsubscribed',
  },
}));

// notifications / push modullari — cap va quiet hours'ni nazorat qilamiz
vi.mock('../../../src/modules/student/notifications.js', () => ({
  checkNotifRate: vi.fn(async () => ({ allowed: true })),
  recordNotifSent: vi.fn(async () => {}),
}));
vi.mock('../../../src/modules/student/push.js', () => ({
  isQuietHours: vi.fn(() => false),
}));

import {
  fcmEnabled,
  isValidFcmToken,
  registerFcmToken,
  removeFcmToken,
  removeAllFcmTokens,
  getUserFcmTokens,
  sendFcmNotification,
  cleanupFcmTokens,
  _fcmConfig,
} from '../../../src/modules/student/fcm.js';
import { fb } from '../../../firebase/admin.js';

const OLD_ENV = { ...process.env };
const TOKEN = 'fA'.repeat(80); // 160 belgi — haqiqiy FCM uzunligiga yaqin

beforeEach(() => {
  Object.keys(testStore).forEach((k) => delete testStore[k]);
  process.env.FCM_ENABLED = 'true';
  process.env.FCM_SERVER_KEY = 'test-server-key';
  vi.clearAllMocks();
  global.fetch = vi.fn();
});

afterEach(() => {
  process.env = { ...OLD_ENV };
  delete global.fetch;
});

describe('fcmEnabled / isValidFcmToken', () => {
  it('FCM_SERVER_KEY bor bolsa enabled', () => {
    expect(fcmEnabled()).toBe(true);
    expect(_fcmConfig().maxTokensPerUser).toBe(5);
  });

  it('FCM_SERVER_KEY yoq bolsa disabled', () => {
    delete process.env.FCM_SERVER_KEY;
    expect(fcmEnabled()).toBe(false);
  });

  it('FCM_ENABLED=false bolsa disabled', () => {
    process.env.FCM_ENABLED = 'false';
    expect(fcmEnabled()).toBe(false);
  });

  it('valid tokenlar qabul qilinadi; invalid rad etiladi', () => {
    expect(isValidFcmToken(TOKEN)).toBe(true);
    expect(isValidFcmToken('')).toBe(false);
    expect(isValidFcmToken('short')).toBe(false);
    expect(isValidFcmToken('a'.repeat(600))).toBe(false);
    expect(isValidFcmToken(`has space ${TOKEN}`)).toBe(false);
    expect(isValidFcmToken(`bad\u0000token`)).toBe(false);
    expect(isValidFcmToken(123)).toBe(false);
  });
});

describe('registerFcmToken', () => {
  it('token saqlaydi (idempotent — takroriy created=false)', async () => {
    const r1 = await registerFcmToken({ userId: 'u1', token: TOKEN, platform: 'android' });
    expect(r1.ok).toBe(true);
    expect(r1.created).toBe(true);
    const r2 = await registerFcmToken({ userId: 'u1', token: TOKEN, platform: 'android' });
    expect(r2.ok).toBe(true);
    expect(r2.created).toBe(false);
    const tokens = await getUserFcmTokens('u1');
    expect(tokens.length).toBe(1);
    expect(tokens[0].token).toBe(TOKEN);
    expect(tokens[0].platform).toBe('android');
  });

  it('platform normalizatsiya — notogri qiymat → android', async () => {
    await registerFcmToken({ userId: 'u1', token: TOKEN, platform: 'windows' });
    const tokens = await getUserFcmTokens('u1');
    expect(tokens[0].platform).toBe('android');
  });

  it('invalid token rad etiladi', async () => {
    const r = await registerFcmToken({ userId: 'u1', token: 'short', platform: 'ios' });
    expect(r.ok).toBe(false);
    expect(r.error).toBe('invalid_token');
  });

  it('per-user limit 5 — oshganda 429 error', async () => {
    for (let i = 0; i < 5; i++) {
      const t = `${i}-${TOKEN}`;
      const r = await registerFcmToken({ userId: 'u1', token: t });
      expect(r.ok).toBe(true);
    }
    const sixth = await registerFcmToken({ userId: 'u1', token: `6-${TOKEN}` });
    expect(sixth.ok).toBe(false);
    expect(sixth.error).toBe('limit_reached');
  });
});

describe('removeFcmToken / removeAllFcmTokens', () => {
  it('bitta token ochiriladi', async () => {
    await registerFcmToken({ userId: 'u1', token: TOKEN });
    const r = await removeFcmToken({ userId: 'u1', token: TOKEN });
    expect(r.ok).toBe(true);
    expect((await getUserFcmTokens('u1')).length).toBe(0);
  });

  it('removeAllFcmTokens barchasini ochiradi (logout/DSAR)', async () => {
    await registerFcmToken({ userId: 'u1', token: `a-${TOKEN}` });
    await registerFcmToken({ userId: 'u1', token: `b-${TOKEN}` });
    const r = await removeAllFcmTokens('u1');
    expect(r.ok).toBe(true);
    expect((await getUserFcmTokens('u1')).length).toBe(0);
  });
});

describe('sendFcmNotification', () => {
  it('success → sent=1 + recordNotifSent (audit)', async () => {
    await registerFcmToken({ userId: 'u1', token: TOKEN });
    global.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({ success: 1, failure: 0, results: [{ message_id: 'm1' }] }),
    });
    const r = await sendFcmNotification({ userId: 'u1', type: 'result', title: 'Natija tayyor', body: 'Koring', url: '/panel' });
    expect(r.ok).toBe(true);
    expect(r.sent).toBe(1);
    expect(global.fetch).toHaveBeenCalledWith(
      'https://fcm.googleapis.com/fcm/send',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('NotRegistered → token ochiriladi', async () => {
    await registerFcmToken({ userId: 'u1', token: TOKEN });
    global.fetch.mockResolvedValue({
      ok: false,
      json: async () => ({ success: 0, failure: 1, results: [{ error: 'NotRegistered' }] }),
    });
    const r = await sendFcmNotification({ userId: 'u1', type: 'result', title: 'T', body: 'B' });
    expect(r.ok).toBe(false);
    expect(r.failed).toBe(1);
    expect((await getUserFcmTokens('u1')).length).toBe(0); // token o'chirildi
  });

  it('network fail → token saqlanadi (vaqtinchalik)', async () => {
    await registerFcmToken({ userId: 'u1', token: TOKEN });
    global.fetch.mockRejectedValue(new Error('ECONNRESET'));
    const r = await sendFcmNotification({ userId: 'u1', type: 'result', title: 'T', body: 'B' });
    expect(r.ok).toBe(false);
    expect(r.failed).toBe(1);
    expect((await getUserFcmTokens('u1')).length).toBe(1); // token qoladi
  });

  it('disabled → fcm_disabled', async () => {
    await registerFcmToken({ userId: 'u1', token: TOKEN });
    delete process.env.FCM_SERVER_KEY;
    const r = await sendFcmNotification({ userId: 'u1', type: 'result', title: 'T' });
    expect(r.ok).toBe(false);
    expect(r.error).toBe('fcm_disabled');
  });

  it('token yoq → no_token (fetch chaqirilmaydi)', async () => {
    const r = await sendFcmNotification({ userId: 'u1', type: 'result', title: 'T' });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('no_token');
    expect(global.fetch).not.toHaveBeenCalled();
  });
});

describe('cleanupFcmTokens', () => {
  it('180 kundan eski token tozalanadi, yangi qoladi', async () => {
    const now = Date.now();
    await fb.set(`users/u1/fcm_tokens/old`, {
      token: 'old-token', created_at: now - 200 * 24 * 60 * 60 * 1000, last_used_at: now - 200 * 24 * 60 * 60 * 1000,
    });
    await fb.set(`users/u1/fcm_tokens/new`, {
      token: 'new-token', created_at: now, last_used_at: now,
    });
    const r = await cleanupFcmTokens();
    expect(r.removed).toBeGreaterThanOrEqual(1);
    const tokens = await getUserFcmTokens('u1');
    expect(tokens.length).toBe(1);
    expect(tokens[0].token).toBe('new-token');
  });
});
