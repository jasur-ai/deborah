/**
 * Edikit — AUTH C-08 User management — Unit tests
 * ---------------------------------------------------------------
 *  - adminBlockUser: status=blocked + blocked_at + reason; audit ACCOUNT_BLOCKED
 *  - adminUnblockUser: status=active; audit
 *  - revokeByUser: session recordlar bekor (session-manager)
 *  - supportUnlock: lockout release (C-02)
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
        else if (r.found) Object.keys(testStore).forEach((k) => delete testStore[k]);
      }),
    },
    default: {},
  };
});

const auditEvents = [];
vi.mock('../../src/modules/auth/audit.js', () => ({
  audit: vi.fn(async () => true),
  logAuthEvent: vi.fn(async ({ action, outcome, details }) => {
    auditEvents.push({ action, outcome, details });
    return true;
  }),
  AUDIT_ACTIONS: {
    ACCOUNT_BLOCKED: 'account:blocked',
    ACCOUNT_UNBLOCKED: 'account:unblocked',
    LOCKOUT_RELEASED: 'lockout:released',
    ADMIN_ACTION: 'admin:action',
  },
}));

import { adminBlockUser, adminUnblockUser, supportUnlock } from '../../src/modules/auth/lockout.js';
import { fb } from '../../firebase/admin.js';

const USER = 'testuser';

beforeEach(() => {
  Object.keys(testStore).forEach((k) => delete testStore[k]);
  auditEvents.length = 0;
  // User record yaratamiz
  testStore.users = {
    [USER]: { username: USER, role: 'student', status: 'active', created_at: 1000, role_version: 1 },
  };
});

describe('adminBlockUser (C-08 §08)', () => {
  it('blok → status=blocked + blocked_at + reason + audit', async () => {
    const r = await adminBlockUser(USER, {
      actorId: 'admin', ip: '203.0.113.5', userAgent: 'ua',
      reason: 'Spam hisob', // C-08 §29: sabab majburiy
    });
    expect(r.ok).toBe(true);
    const snap = await fb.get(`users/${USER}`);
    expect(snap.val().status).toBe('blocked');
    expect(snap.val().blocked_at).toBeGreaterThan(0);
    expect(snap.val().blocked_reason).toBe('Spam hisob');
    expect(auditEvents.some((e) => e.action === 'account:blocked' && e.details.actor === 'admin')).toBe(true);
  });
});

describe('adminUnblockUser (C-08 §09)', () => {
  it('aktivlash → status maydoni olib tashlanadi (API u.status||active → active) + audit', async () => {
    testStore.users[USER].status = 'blocked';
    const r = await adminUnblockUser(USER, { actorId: 'admin', ip: '203.0.113.5', userAgent: 'ua' });
    expect(r.ok).toBe(true);
    const snap = await fb.get(`users/${USER}`);
    // status maydoni o'chiriladi (C-08 API: u.status || 'active' → active ko'rsatadi)
    expect(snap.val().status).toBeUndefined();
    expect(snap.val().blocked_at).toBeUndefined();
    expect(auditEvents.some((e) => e.action === 'account:unblocked')).toBe(true);
  });
});

describe('supportUnlock (C-08 support flow, C-02)', () => {
  it('lockout release → user status o zgartirilmaydi (blok emas, faqat lockout)', async () => {
    // Lockout state'ni yaratamiz
    testStore.userFailureLocks = { [USER]: { failures: 6, lockedUntil: Date.now() + 60000 } };
    const r = await supportUnlock(USER, { actorId: 'admin', ip: '203.0.113.5', userAgent: 'ua' });
    expect(r.ok).toBe(true);
    // Bloklangan emas — status o'zgarmaydi (support unlock faqat lockout release)
    const snap = await fb.get(`users/${USER}`);
    expect(snap.val().status).toBe('active');
    expect(auditEvents.some((e) => e.action === 'lockout:released')).toBe(true);
  });
});
