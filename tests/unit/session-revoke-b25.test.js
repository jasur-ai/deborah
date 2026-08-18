/**
 * AUTH B-25 — Session invalidation: revokeByUser unit tests
 * ---------------------------------------------------------
 * 1) revokeByUser(userId, { exceptSessionId }) — except saqlanadi, qolganlar
 *    store.destroy + local DB tracking'dan o'chadi.
 * 2) Idempotent — ikkinchi chaqiruv count 0 (hech narsa o'zgarmaydi).
 * 3) Store destroy — har revoke qilingan sessiya uchun chaqiriladi.
 * 4) No-store fail-safe — store registratsiya qilinmagan bo'lsa ham DB
 *    tracking tozalanadi (client cookie'ga ishonilmaydi — §15).
 * 5) Audit — SESSIONS_REVOKED faqat revoked > 0 bo'lganda.
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

const auditMock = vi.fn(async () => true);
vi.mock('../../src/modules/auth/audit.js', () => ({
  audit: (...args) => auditMock(...args),
  AUDIT_ACTIONS: {
    SESSION_REVOKE: 'session:revoke',
    SESSIONS_REVOKED: 'session:revoked:bulk',
  },
}));

const {
  recordSession,
  revokeByUser,
  setSessionStore,
  getUserSessions,
} = await import('../../src/modules/auth/session-manager.js');

const USER = 'b25_user';

function makeStore() {
  const destroyed = [];
  return {
    destroyed,
    destroy: vi.fn((sid, cb) => {
      destroyed.push(sid);
      if (typeof cb === 'function') cb(null);
    }),
  };
}

async function seedSessions(store, sids) {
  for (const sid of sids) {
    await recordSession({ userId: USER, sessionId: sid, ipAddress: '10.0.0.1' });
  }
}

beforeEach(async () => {
  Object.keys(testStore).forEach((k) => delete testStore[k]);
  auditMock.mockClear();
  setSessionStore(null);
});

describe('AUTH B-25 revokeByUser', () => {
  it('exceptSessionId saqlanadi, qolganlari store.destroy + DB dan o‘chadi', async () => {
    const store = makeStore();
    setSessionStore(store);
    await seedSessions(store, ['sid1', 'sid2', 'sid3']);

    const res = await revokeByUser(USER, { exceptSessionId: 'sid2', reason: 'test' });
    expect(res.ok).toBe(true);
    expect(res.count).toBe(2);
    expect(store.destroyed).toEqual(expect.arrayContaining(['sid1', 'sid3']));
    expect(store.destroyed).not.toContain('sid2');
    // DB tracking — except qolgan
    const sessions = await getUserSessions(USER);
    expect(Object.keys(sessions)).toHaveLength(1);
    expect(sessions[sessions ? Object.keys(sessions)[0] : ''] && Object.values(sessions)[0].sessionId).toBe('sid2');
    // Audit — 1 marta, bulk action
    expect(auditMock).toHaveBeenCalledTimes(1);
    expect(auditMock.mock.calls[0][0].action).toBe('session:revoked:bulk');
  });

  it('idempotent — ikkinchi chaqiruv count 0', async () => {
    const store = makeStore();
    setSessionStore(store);
    await seedSessions(store, ['sidA', 'sidB']);

    const r1 = await revokeByUser(USER, { exceptSessionId: 'sidA' });
    expect(r1.count).toBe(1);
    const r2 = await revokeByUser(USER, { exceptSessionId: 'sidA' });
    expect(r2.count).toBe(0);
    expect(auditMock).toHaveBeenCalledTimes(1); // faqat birinchi marta
  });

  it('except yo‘q bo‘lsa barcha sessiyalar revoke', async () => {
    const store = makeStore();
    setSessionStore(store);
    await seedSessions(store, ['sidX', 'sidY']);
    const res = await revokeByUser(USER, { reason: 'reset' });
    expect(res.count).toBe(2);
    expect(store.destroyed).toHaveLength(2);
    expect(await getUserSessions(USER)).toEqual({});
  });

  it('store registratsiya qilinmagan bo‘lsa ham DB tracking tozalanadi (fail-safe)', async () => {
    await seedSessions(null, ['sidN1', 'sidN2']); // store yo'q
    const res = await revokeByUser(USER, { reason: 'x' });
    expect(res.ok).toBe(true);
    expect(res.count).toBe(2);
    expect(await getUserSessions(USER)).toEqual({});
  });

  it('userId yo‘q → ok:false, hech narsa o‘zgarmaydi', async () => {
    const res = await revokeByUser('', { reason: 'x' });
    expect(res.ok).toBe(false);
    expect(res.count).toBe(0);
    expect(auditMock).not.toHaveBeenCalled();
  });
});
