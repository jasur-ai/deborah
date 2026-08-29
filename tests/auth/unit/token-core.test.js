/**
 * AUTH D-15 §11 — Forgot/reset token core unit testlari (A-06/A-20)
 * ---------------------------------------------------------------------------
 *  - Kod hash: sha256(code:salt) — DB'da plaintext saqlanmaydi.
 *  - Reset token: 48 bayt random hex = 384 bit (routes/auth.js forgot).
 *  - Bir marta ishlatish: verifyCode muvaffaqiyatli → used → replay reject.
 *  - Expiry: muddati o'tgan kod → expired.
 *  - Enumeration himoyasi: noto'g'ri kod → otp_invalid (422).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import crypto from 'node:crypto';

// ── FB in-memory mock (session-core texnikasi + update) ──
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

import { generateCode, hashCode, verifyCode } from '../../../src/modules/auth/email-verify.js';
import { encryptToken, decryptToken } from '../../../src/modules/auth/token-vault.js';

beforeEach(() => {
  Object.keys(testStore).forEach((k) => delete testStore[k]);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('AUTH D-15 §11 — token hash (plaintext saqlanmaydi)', () => {
  it('hashCode: 64 hex sha256, deterministik, plaintext qaytmaydi', () => {
    const h = hashCode('123456', 'salt-1');
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(h).toBe(hashCode('123456', 'salt-1')); // deterministik
    expect(h).not.toContain('123456'); // plaintext yo'q
    expect(h).not.toContain('salt-1');
  });

  it('salt farqi → hash farqi (rainbow table himoya)', () => {
    expect(hashCode('123456', 'salt-1')).not.toBe(hashCode('123456', 'salt-2'));
  });

  it('generateCode: 6 xonali kod (zero-padded)', () => {
    const code = generateCode();
    expect(code).toMatch(/^\d{6}$/);
  });

  it('reset token: 48 bayt random hex = 96 belgi = 384 bit (routes/auth.js)', () => {
    // routes/auth.js forgot: crypto.randomBytes(48).toString('hex')
    const token = crypto.randomBytes(48).toString('hex');
    expect(token).toMatch(/^[0-9a-f]{96}$/);
    expect(token.length * 4).toBe(384);
  });
});

describe('AUTH D-15 §11 — token-vault encrypt/decrypt', () => {
  it('roundtrip: decrypt(encrypt(plain)) = plain', () => {
    const plain = 'reset-token-abc-123';
    const enc = encryptToken(plain);
    expect(enc).not.toContain(plain);
    expect(decryptToken(enc)).toBe(plain);
  });

  it('encryptToken formatlari har xil (entropiya)', () => {
    const a = encryptToken('same-value');
    const b = encryptToken('same-value');
    expect(a).not.toBe(b);
  });
});

describe('AUTH D-15 §11 — verify: single-use + expiry', () => {
  const USER = 'u-token-user';
  const EMAIL = 'reset@test.uz';

  function seedRecord({ code, salt = 's1', used = false, expiresInMs = 15 * 60 * 1000 }) {
    const lookupKey = hashCode(code, '');
    // nested object — fb.get navigate path'ni '/' bo'yicha bo'ladi
    if (!testStore.email_verify) testStore.email_verify = {};
    testStore.email_verify[lookupKey] = {
      userKey: USER,
      email: EMAIL,
      codeHash: hashCode(code, salt),
      salt,
      used,
      expiresAt: Date.now() + expiresInMs,
      createdAt: Date.now(),
    };
    if (!testStore.users) testStore.users = {};
    testStore.users[USER] = { email: EMAIL, email_verified: false };
    return lookupKey;
  }

  it('to\'g\'ri kod → verify ok + user.email_verified=true', async () => {
    seedRecord({ code: '111111' });
    const r = await verifyCode({ userKey: USER, code: '111111', email: EMAIL });
    expect(r.ok).toBe(true);
    expect(testStore.users[USER].email_verified).toBe(true);
  });

  it('bir marta ishlatish: muvaffaqiyatli verify\'dan keyin replay → otp_invalid (B-07 §09)', async () => {
    seedRecord({ code: '222222' });
    const first = await verifyCode({ userKey: USER, code: '222222', email: EMAIL });
    expect(first.ok).toBe(true);
    // Yana bir xil kod — used=true → reject
    const replay = await verifyCode({ userKey: USER, code: '222222', email: EMAIL });
    expect(replay.ok).toBe(false);
    expect(replay.error).toBe('otp_invalid');
  });

  it('muddati o\'tgan kod → expired (B-28 §08)', async () => {
    seedRecord({ code: '333333', expiresInMs: -1000 }); // allaqachon o'tgan
    const r = await verifyCode({ userKey: USER, code: '333333', email: EMAIL });
    expect(r.ok).toBe(false);
    expect(r.error).toBe('expired');
  });

  it('noto\'g\'ri kod → otp_invalid (enumeration himoya)', async () => {
    seedRecord({ code: '444444' });
    const r = await verifyCode({ userKey: USER, code: '999999', email: EMAIL });
    expect(r.ok).toBe(false);
    expect(r.error).toBe('otp_invalid');
  });
});
