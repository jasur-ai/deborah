/**
 * AUTH D-15 §07 — Session core unit testlari (A-01/A-02/A-25)
 * ---------------------------------------------------------------------------
 *  - ID entropy: 32B random hex = 256-bit (express-session genid).
 *  - TTL / revoke: recordSession + revokeByUser.
 *  - Idle timeout (30 daqiqa) / absolute timeout.
 *  - Parallel limit A-02: 5 session; 6-chisi kelganda eng eski revoke.
 *  - Remember me A-25: selector/verifier pair + verifier hash (plaintext yo'q).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── FB in-memory mock (session-manager.test.js texnikasi) ──
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

vi.mock('../../../src/modules/auth/audit.js', () => ({
  audit: vi.fn(async () => {}),
  AUDIT_ACTIONS: { SESSION_LIMIT_REACHED: 'session:limit-reached' },
  __esModule: true,
}));

import { genSessionId } from '../../../src/modules/auth/session-store.js';
import { recordSession, revokeByUser, getUserSessions } from '../../../src/modules/auth/session-manager.js';
import {
  DEFAULT_IDLE_TIMEOUT_MS,
  isSessionExpired,
  isAbsoluteExpired,
  shouldTouch,
} from '../../../src/modules/auth/session-timeout.js';
import { createRememberPair, hashVerifier, serializeRememberCookie, parseRememberCookie } from '../../../src/modules/auth/remember-me.js';

beforeEach(() => {
  Object.keys(testStore).forEach((k) => delete testStore[k]);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('AUTH D-15 §07 — session ID entropy (256-bit)', () => {
  it('genSessionId 64 hex belgi = 32 bayt = 256 bit', () => {
    const id = genSessionId();
    expect(id).toMatch(/^[0-9a-f]{64}$/);
    // 64 hex belgi × 4 bit = 256 bit
    expect(id.length * 4).toBe(256);
  });

  it('ikkita ID har xil (kolliziya yo\'q)', () => {
    expect(genSessionId()).not.toBe(genSessionId());
  });
});

describe('AUTH D-15 §07 — TTL / revoke', () => {
  it('recordSession yozadi, revokeByUser o\'chiradi', async () => {
    await recordSession({ userId: 'u1', sessionId: 'aaa', ipAddress: '1.2.3.4', authMethod: 'password' });
    await recordSession({ userId: 'u1', sessionId: 'bbb', ipAddress: '5.6.7.8', authMethod: 'google' });

    const sessions = await getUserSessions('u1');
    expect(Object.keys(sessions)).toHaveLength(2);

    const r = await revokeByUser('u1', { reason: 'logout' });
    expect(r.ok).toBe(true);
    expect(r.count).toBe(2);
    const after = await getUserSessions('u1');
    expect(Object.keys(after || {})).toHaveLength(0);
  });

  it('exceptSessionId — joriy sessiya saqlanadi', async () => {
    await recordSession({ userId: 'u1', sessionId: 'keep-this', ipAddress: '1.2.3.4' });
    await recordSession({ userId: 'u1', sessionId: 'drop-this', ipAddress: '5.6.7.8' });
    const r = await revokeByUser('u1', { exceptSessionId: 'keep-this', reason: 'security' });
    expect(r.count).toBe(1);
    const after = await getUserSessions('u1');
    expect(Object.keys(after || {})).toHaveLength(1);
  });

  it('sessiya yo\'q user → count 0', async () => {
    const r = await revokeByUser('ghost-user', { reason: 'security' });
    expect(r.ok).toBe(true);
    expect(r.count).toBe(0);
  });
});

describe('AUTH D-15 §07 — idle / absolute timeout', () => {
  it('idle 30 daqiqa: faol sessiya expired EMAS, 31 daqiqa → expired', () => {
    const now = 1_000_000_000_000;
    expect(isSessionExpired(now, now + DEFAULT_IDLE_TIMEOUT_MS - 1000)).toBe(false);
    expect(isSessionExpired(now, now + DEFAULT_IDLE_TIMEOUT_MS + 1000)).toBe(true);
  });

  it('shouldTouch — 5 daqiqadan keyin touch kerak', () => {
    const now = 1_000_000_000_000;
    expect(shouldTouch(now, now + 4 * 60 * 1000)).toBe(false);
    expect(shouldTouch(now, now + 6 * 60 * 1000)).toBe(true);
  });

  it('absolute timeout: startedAt + absolute → expired', () => {
    const now = 1_000_000_000_000;
    // absolute 1 soat beramiz
    expect(isAbsoluteExpired(now, now + 59 * 60 * 1000, 60 * 60 * 1000)).toBe(false);
    expect(isAbsoluteExpired(now, now + 61 * 60 * 1000, 60 * 60 * 1000)).toBe(true);
  });
});

describe('AUTH D-15 §07 — parallel limit (A-02)', () => {
  it('5 session chegarasi: 6-chisi kelganda eng eski revoke', async () => {
    // createdAt farqlanishi uchun ketma-ket yozamiz
    for (let i = 1; i <= 5; i++) {
      await recordSession({ userId: 'u1', sessionId: `sess-${i}`, ipAddress: `10.0.0.${i}` });
      testStore.sessions.u1[`sess-${i}`] = { ...testStore.sessions.u1[`sess-${i}`], createdAt: 1_000_000_000_000 + i * 1000 };
    }
    const before = await getUserSessions('u1');
    expect(Object.keys(before)).toHaveLength(5);

    await recordSession({ userId: 'u1', sessionId: 'sess-6', ipAddress: '10.0.0.6' });
    const after = await getUserSessions('u1');
    const keys = Object.keys(after);
    expect(keys).toHaveLength(5);
    // eng eski (sess-1) revoke bo'ldi
    expect(keys.some((k) => k.includes('sess-1'))).toBe(false);
    expect(keys.some((k) => k.includes('sess-6'))).toBe(true);
  });
});

describe('AUTH D-15 §07 — remember me (A-25 selector/verifier)', () => {
  it('selector + verifier ajratilgan; verifier plaintext emas (hash)', () => {
    const pair = createRememberPair();
    expect(pair.selector).toBeTruthy();
    expect(pair.verifier).toBeTruthy();
    expect(pair.selector).not.toBe(pair.verifier);
    const vh = hashVerifier(pair.verifier);
    expect(vh).not.toContain(pair.verifier); // plaintext saqlanmaydi
    expect(vh).toMatch(/^[0-9a-f]{64}$/); // sha256
  });

  it('cookie serialize/parse roundtrip', () => {
    const pair = createRememberPair();
    const cookie = serializeRememberCookie(pair);
    expect(cookie).toContain(pair.selector);
    const parsed = parseRememberCookie(cookie);
    expect(parsed.selector).toBe(pair.selector);
    expect(parsed.verifier).toBe(pair.verifier);
  });

  it('buzilgan cookie → null (parse himoya)', () => {
    expect(parseRememberCookie('garbage-without-colon')).toBeNull();
    expect(parseRememberCookie('')).toBeNull();
  });
});
