/**
 * Edikit — Session Manager Unit Tests
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
        else if (r.found) Object.keys(testStore).forEach(k => delete testStore[k]);
      }),
    },
    default: {},
  };
});

vi.mock('../../src/modules/auth/audit.js', () => ({
  audit: vi.fn(async () => true),
  AUDIT_ACTIONS: { SESSION_REVOKE: 'session:revoke', RECOVERY_CODE_USED: 'recovery:code:used', RECOVERY_CODE_REVOKE: 'recovery:code:revoke' },
}));

describe('Session Manager', () => {
  let sm;

  beforeEach(async () => {
    vi.clearAllMocks();
    Object.keys(testStore).forEach(k => delete testStore[k]);
    sm = await import('../../src/modules/auth/session-manager.js');
  });

  describe('Session Recording & Listing', () => {
    it('should record and list sessions', async () => {
      await sm.recordSession({ userId: 'list_user', sessionId: 'sess_a', ipAddress: '1.2.3.4' });
      await sm.recordSession({ userId: 'list_user', sessionId: 'sess_b', ipAddress: '5.6.7.8' });
      const sessions = await sm.getUserSessions('list_user');
      expect(Object.keys(sessions)).toEqual(['sess_a', 'sess_b']);
    });

    it('should return false for missing params', async () => {
      expect(await sm.recordSession({})).toBe(false);
      expect(await sm.recordSession({ userId: 'u' })).toBe(false);
    });

    it('should return empty for no sessions', async () => {
      expect(await sm.getUserSessions('nobody')).toEqual({});
    });
  });

  describe('Session Touch', () => {
    it('should update lastActiveAt', async () => {
      await sm.recordSession({ userId: 'tu', sessionId: 'st1' });
      await new Promise(r => setTimeout(r, 5));
      await sm.touchSession('tu', 'st1');
      const sess = await sm.getUserSessions('tu');
      expect(sess.st1.lastActiveAt).toBeGreaterThan(sess.st1.createdAt);
    });
  });

  describe('Session Revocation', () => {
    it('should revoke a specific session', async () => {
      await sm.recordSession({ userId: 'ru', sessionId: 'r1' });
      await sm.recordSession({ userId: 'ru', sessionId: 'r2' });
      expect((await sm.revokeSession('ru', 'r1')).ok).toBe(true);
      const sessions = await sm.getUserSessions('ru');
      expect(sessions.r1).toBeUndefined();
      expect(sessions.r2).toBeDefined();
    });

    it('should return error for non-existent session', async () => {
      const result = await sm.revokeSession('ru', 'nonexistent');
      expect(result.ok).toBe(false);
    });

    it('should revoke all except current', async () => {
      await sm.recordSession({ userId: 'mu', sessionId: 'cur' });
      await sm.recordSession({ userId: 'mu', sessionId: 'o1' });
      await sm.recordSession({ userId: 'mu', sessionId: 'o2' });
      const result = await sm.revokeOtherSessions('mu', 'cur');
      expect(result.count).toBe(2);
      const sessions = await sm.getUserSessions('mu');
      expect(Object.keys(sessions)).toEqual(['cur']);
    });
  });

  describe('Session Limit', () => {
    it('should enforce max sessions per user', async () => {
      for (let i = 0; i < 22; i++) await sm.recordSession({ userId: 'lu', sessionId: `s_${i}` });
      const sessions = await sm.getUserSessions('lu');
      expect(Object.keys(sessions).length).toBeLessThanOrEqual(20);
    });
  });

  describe('Recovery Codes', () => {
    it('should generate 8 codes', async () => {
      const result = await sm.generateRecoveryCodes('rc_u');
      expect(result.ok).toBe(true);
      expect(result.codes.length).toBe(8);
    });

    it('should verify a valid code', async () => {
      const { codes } = await sm.generateRecoveryCodes('vu');
      expect((await sm.verifyRecoveryCode('vu', codes[0])).ok).toBe(true);
    });

    it('should reject invalid code', async () => {
      expect((await sm.verifyRecoveryCode('vu', 'BADCODE')).ok).toBe(false);
    });

    it('should reject used code', async () => {
      const { codes } = await sm.generateRecoveryCodes('du');
      await sm.verifyRecoveryCode('du', codes[0]);
      expect((await sm.verifyRecoveryCode('du', codes[0])).ok).toBe(false);
    });

    it('should count remaining codes', async () => {
      const { codes } = await sm.generateRecoveryCodes('rmu');
      await sm.verifyRecoveryCode('rmu', codes[0]);
      await sm.verifyRecoveryCode('rmu', codes[1]);
      const status = await sm.getRecoveryCodeStatus('rmu');
      expect(status.total).toBe(8);
      expect(status.used).toBe(2);
      expect(status.remaining).toBe(6);
    });

    it('should return empty status for no codes', async () => {
      const status = await sm.getRecoveryCodeStatus('nobody');
      expect(status.hasCodes).toBe(false);
    });

    it('should revoke all codes', async () => {
      await sm.generateRecoveryCodes('rru');
      await sm.revokeRecoveryCodes('rru');
      expect((await sm.getRecoveryCodeStatus('rru')).hasCodes).toBe(false);
    });
  });
});
