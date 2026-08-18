/**
 * AUTH C-02 — Lockout state machine (progressive + permanent + release)
 * -------------------------------------------------------------------
 *  1. Progressive: strike 1 → 15 daqiqa; strike 2 → 60 daqiqa; strike 3 → 120 daqiqa
 *  2. Success login → counter=0 + lock_strikes reset
 *  3. Permanent: status='blocked' → checkUserLockout.permanent=true (admin qarori)
 *  4. supportUnlock: lockout erta release (audit); permanent'ni rad etadi
 *  5. adminBlockUser / adminUnblockUser: status='blocked' set/remove + audit
 *  6. A-03 kontrakti: 10 xato → 900s (strike 1) saqlanadi
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const testStore = {};

vi.mock('../../firebase/admin.js', () => {
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
  return {
    fb: {
      get: vi.fn(async (path) => {
        const r = navigate(testStore, path);
        return { exists: () => r.found, val: () => (r.found ? JSON.parse(JSON.stringify(r.value)) : null) };
      }),
      set: vi.fn(async (path, value) => {
        const parts = path.split('/').filter(Boolean);
        let cur = testStore;
        for (let i = 0; i < parts.length - 1; i++) {
          if (!(parts[i] in cur) || typeof cur[parts[i]] !== 'object') cur[parts[i]] = {};
          cur = cur[parts[i]];
        }
        cur[parts[parts.length - 1]] = JSON.parse(JSON.stringify(value));
      }),
      remove: vi.fn(async (path) => {
        const r = navigate(testStore, path);
        if (r.found && r.parent) delete r.parent[r.key];
      }),
    },
    default: {},
  };
});

vi.mock('../../config/env.js', () => ({
  default: {
    NODE_ENV: 'test',
    AUTH_LOCKOUT_IP_FAILURES: 5,
    AUTH_LOCKOUT_IP_MS: 5 * 60 * 1000,
    AUTH_LOCKOUT_USER_FAILURES: 10,
    AUTH_LOCKOUT_USER_MS: 15 * 60 * 1000,
    AUTH_JITTER_MAX_MS: 600,
    AUTH_REGISTER_MAX: 5,
    AUTH_RESET_MAX: 3,
  },
}));

import { fb } from '../../firebase/admin.js';
import {
  recordFailure,
  recordSuccess,
  checkUserLockout,
  supportUnlock,
  adminBlockUser,
  adminUnblockUser,
  LOCKOUT_ERROR_CODE,
  _resetStores,
} from '../../src/modules/auth/lockout.js';
import { logAuthEvent, AUDIT_ACTIONS } from '../../src/modules/auth/audit.js';

const auditSpy = vi.fn();

describe('C-02 lockout state machine', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.keys(testStore).forEach(k => delete testStore[k]);
    _resetStores();
  });

  it('A-03 kontrakti: 10 xato → strike 1 → 900s (15 daqiqa)', async () => {
    let last;
    for (let i = 0; i < 10; i++) {
      last = await recordFailure({ userKey: 'user', ip: '203.0.113.7', method: 'password' });
    }
    expect(last.locked).toBe(true);
    expect(last.retryAfterSeconds).toBe(900);
    const strikes = await fb.get('users/user/lock_strikes');
    expect(strikes.val()).toBe(1);
    const chk = await checkUserLockout('user');
    expect(chk.locked).toBe(true);
    expect(chk.permanent).toBe(false);
    expect(chk.strike).toBe(1);
  });

  it('progressive: strike 2 → 3600s (1 soat)', async () => {
    // strike 1 holatini yozamiz, keyin lock muddati o'tdi deb hisoblaymiz
    await fb.set('users/user/failed_attempts', 10);
    await fb.set('users/user/lock_strikes', 1);
    await fb.set('users/user/locked_until', Date.now() - 1000); // muddati o'tgan
    const rec = await recordFailure({ userKey: 'user', ip: '203.0.113.8' });
    expect(rec.locked).toBe(true);
    expect(rec.retryAfterSeconds).toBe(3600); // 60 daqiqa
    const strikes = await fb.get('users/user/lock_strikes');
    expect(strikes.val()).toBe(2);
  });

  it('progressive: strike 3 → 7200s (2 soat + support)', async () => {
    await fb.set('users/user/failed_attempts', 10);
    await fb.set('users/user/lock_strikes', 2);
    await fb.set('users/user/locked_until', Date.now() - 1000);
    const rec = await recordFailure({ userKey: 'user', ip: '203.0.113.9' });
    expect(rec.retryAfterSeconds).toBe(7200);
    expect(rec.locked).toBe(true);
  });

  it('success login → failed_attempts=0 + lock_strikes o\'chadi (reset)', async () => {
    await fb.set('users/u1/failed_attempts', 10);
    await fb.set('users/u1/lock_strikes', 2);
    await fb.set('users/u1/locked_until', Date.now() + 60_000);
    await recordSuccess({ userKey: 'u1', ip: '198.51.100.4' });
    const fa = await fb.get('users/u1/failed_attempts');
    expect(fa.val()).toBe(0);
    const ls = await fb.get('users/u1/lock_strikes');
    expect(ls.exists()).toBe(false);
    const lu = await fb.get('users/u1/locked_until');
    expect(lu.exists()).toBe(false);
  });

  it('permanent: status=blocked → checkUserLockout.permanent=true (retryAfter 0)', async () => {
    await fb.set('users/bad/status', 'blocked');
    await fb.set('users/bad/lock_strikes', 2);
    const chk = await checkUserLockout('bad');
    expect(chk.locked).toBe(true);
    expect(chk.permanent).toBe(true);
    expect(chk.retryAfterSeconds).toBe(0);
    expect(chk.strike).toBe(2);
  });

  it('supportUnlock: lockout erta release + hisoblagichlar tozalanadi', async () => {
    await fb.set('users/u2/failed_attempts', 11);
    await fb.set('users/u2/lock_strikes', 2);
    await fb.set('users/u2/locked_until', Date.now() + 3600_000);
    const res = await supportUnlock('u2', { actorId: 'support-bot', ip: '203.0.113.10' });
    expect(res.ok).toBe(true);
    const chk = await checkUserLockout('u2');
    expect(chk.locked).toBe(false);
    const fa = await fb.get('users/u2/failed_attempts');
    expect(fa.val()).toBe(0);
    const ls = await fb.get('users/u2/lock_strikes');
    expect(ls.exists()).toBe(false);
    // audit yozildi (logAuthEvent spy'ga tushmaydi — audit() ichki; faqat holatni tekshiramiz)
  });

  it('supportUnlock: permanent blokni rad etadi', async () => {
    await fb.set('users/bad/status', 'blocked');
    const res = await supportUnlock('bad');
    expect(res.ok).toBe(false);
    expect(res.code).toBe('ACCOUNT_BLOCKED');
    const st = await fb.get('users/bad/status');
    expect(st.val()).toBe('blocked'); // o\'zgarmadi
  });

  it('adminBlockUser: status=blocked + blocked_at + reason yoziladi', async () => {
    await adminBlockUser('u3', { actorId: 'admin1', ip: '203.0.113.11', reason: 'abuse' });
    const st = await fb.get('users/u3/status');
    expect(st.val()).toBe('blocked');
    const at = await fb.get('users/u3/blocked_at');
    expect(typeof at.val()).toBe('number');
    const reason = await fb.get('users/u3/blocked_reason');
    expect(reason.val()).toBe('abuse');
    // permanent blokda login bloklanadi
    const chk = await checkUserLockout('u3');
    expect(chk.permanent).toBe(true);
  });

  it('adminUnblockUser: status olib tashlanadi + counter tozalanadi', async () => {
    await fb.set('users/u4/status', 'blocked');
    await fb.set('users/u4/failed_attempts', 8);
    await adminUnblockUser('u4', { actorId: 'admin1', ip: '203.0.113.12' });
    const st = await fb.get('users/u4/status');
    expect(st.exists()).toBe(false);
    const fa = await fb.get('users/u4/failed_attempts');
    expect(fa.val()).toBe(0);
    const chk = await checkUserLockout('u4');
    expect(chk.locked).toBe(false);
  });

  it('bypass emas: turli IP\'dan ham per-account tutadi', async () => {
    // 10 xato turli IP'lar bilan — account qattiq qatlam baribir bloklaydi
    let last;
    for (let i = 0; i < 10; i++) {
      last = await recordFailure({ userKey: 'victim', ip: `203.0.113.${100 + i}` });
    }
    expect(last.locked).toBe(true);
    const chk = await checkUserLockout('victim');
    expect(chk.locked).toBe(true);
  });
});
