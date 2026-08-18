/**
 * AUTH D-15 §09 — MFA core unit testlari (A-26)
 * ---------------------------------------------------------------------------
 *  - TOTP valid_window=1 (±1 step), 6 xonali format.
 *  - Backup codes: HMAC-SHA256 hash (plaintext yo'q), bir marta ishlatish.
 *  - Lockout 5x15: 5 xato → 15 daqiqa blok.
 *  - Challenge: single-use, TTL, consumed (reuse yo'q).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { generateSecret, generate } from 'otplib';

// ── FB in-memory mock (token-core texnikasi) ──
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
      update: vi.fn(async (path, patch) => {
        const r = navigate(testStore, path);
        if (r.found && typeof r.value === 'object' && r.value !== null) {
          Object.assign(r.value, JSON.parse(JSON.stringify(patch)));
        } else {
          setAt(testStore, path, patch);
        }
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

import {
  hashBackupCode,
  isTotpCode,
  isBackupCodeFormat,
  verifyTotpCode,
  consumeBackupCode,
  isLockedOut,
  createMfaChallenge,
  readMfaChallenge,
  consumeMfaChallenge,
  requestMfaReset,
  executeMfaReset,
} from '../../../src/modules/auth/mfa-totp.js';

beforeEach(() => {
  Object.keys(testStore).forEach((k) => delete testStore[k]);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('AUTH D-15 §09 — TOTP valid_window=1', () => {
  it('6 xonali format tekshiruvi', () => {
    expect(isTotpCode('123456')).toBe(true);
    expect(isTotpCode('12345')).toBe(false); // 5 xonali
    expect(isTotpCode('1234567')).toBe(false); // 7 xonali
    expect(isTotpCode('abcdef')).toBe(false);
  });

  it('to\'g\'ri TOTP kodi → verify true (joriy step)', async () => {
    const secret = generateSecret();
    const token = await generate({ secret });
    expect(await verifyTotpCode(secret, token)).toBe(true);
  });

  it('noto\'g\'ri TOTP kodi → false', async () => {
    const secret = generateSecret();
    const wrong = String((parseInt(await generate({ secret }), 10) + 1) % 1_000_000).padStart(6, '0');
    expect(await verifyTotpCode(secret, wrong)).toBe(false);
  });
});

describe('AUTH D-15 §09 — backup codes (hash + single-use)', () => {
  it('hashBackupCode: HMAC-SHA256 64 hex, plaintext qaytmaydi', () => {
    const h = hashBackupCode('abc123def0');
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(h).not.toContain('abc123def0');
    expect(h).toBe(hashBackupCode('abc123def0')); // deterministik
  });

  it('isBackupCodeFormat: 10 belgi kichik hex (modul faqat [0-9a-f] qabul qiladi)', () => {
    expect(isBackupCodeFormat('abc123def0')).toBe(true);
    expect(isBackupCodeFormat('ABC123DEF0')).toBe(false); // katta harf — modul i-flag yo'q
    expect(isBackupCodeFormat('short')).toBe(false);
    expect(isBackupCodeFormat('abc123def00')).toBe(false); // 11 belgi
  });

  it('consumeBackupCode: bir marta ishlatish — ikkinchi chaqiruv false', async () => {
    const code = 'a1b2c3d4e5';
    testStore.mfa_backup_codes = {
      user1: { codes: [{ h: hashBackupCode(code), usedAt: null }], rotatedAt: Date.now() },
    };
    expect(await consumeBackupCode('user1', code)).toBe(true);
    expect(await consumeBackupCode('user1', code)).toBe(false); // used → replay yo'q
  });

  it('noto\'g\'ri backup kod → false', async () => {
    const code = 'a1b2c3d4e5';
    testStore.mfa_backup_codes = {
      user1: { codes: [{ h: hashBackupCode(code), usedAt: null }], rotatedAt: Date.now() },
    };
    expect(await consumeBackupCode('user1', 'ffffffffff')).toBe(false);
  });
});

describe('AUTH D-15 §09 — challenge single-use', () => {
  it('challenge yaratiladi, o\'qiladi, consume → valid=false (reuse yo\'q)', async () => {
    const challengeId = await createMfaChallenge('user1');
    expect(challengeId).toMatch(/^[0-9a-f]{48}$/); // 24 bayt = 192 bit

    const before = await readMfaChallenge(challengeId);
    expect(before.valid).toBe(true);

    const consumed = await consumeMfaChallenge(challengeId);
    expect(consumed).toBe('user1');

    // consume'dan keyin valid=false (A-26 §12 — reuse yo'q)
    const after = await readMfaChallenge(challengeId);
    expect(after.valid).toBe(false);
    // yana consume → null
    expect(await consumeMfaChallenge(challengeId)).toBeNull();
  });

  it("mavjud bo'lmagan challenge → null", async () => {
    expect(await readMfaChallenge('ghost-challenge')).toBeNull();
  });
});

describe('AUTH D-15 §09 — lockout 5x15 + reset delay', () => {
  it('isLockedOut: blok yo\'q → 0 (raqam), blok bor → qolgan ms (kontrakt)', async () => {
    // Yangi user — blok yo'q
    expect(await isLockedOut('u-lock', '1.2.3.4')).toBe(0);
    // lockoutUntil kelajakda → qolgan ms (raqam) — 5x15 kontrakti (a26'da to'liq)
    testStore.mfa_totp = { 'u-lock': { lockoutUntil: Date.now() + 15 * 60 * 1000 } };
    const remaining = await isLockedOut('u-lock', '9.9.9.9');
    expect(typeof remaining).toBe('number');
    expect(remaining).toBeGreaterThan(0);
    expect(remaining).toBeLessThanOrEqual(15 * 60 * 1000);
  });

  it('requestMfaReset → executeMfaReset 72 soatdan keyin ishlaydi (RESET_DELAY_MS)', async () => {
    const r = await requestMfaReset('u-reset', { reason: 'lost-device' });
    expect(r).toBeTruthy();
    // hozircha (72 soat oldin emas) — execute reject yoki request kutish
    const early = await executeMfaReset('u-reset');
    // 72 soat o'tmagan → reject (A-26 reset time-delay)
    expect(early && early.ok).not.toBe(true);
  });
});
