import { describe, it, expect, beforeEach } from 'vitest';
import { vi } from 'vitest';

// ── fb mock: nested-path daraxt (fb.set('a/b/c') firebase semantikasi) ──
const store = vi.hoisted(() => {
  const db = {};
  const set = async (path, value) => {
    const parts = path.split('/');
    let cur = db;
    for (let i = 0; i < parts.length - 1; i++) {
      const k = parts[i];
      if (typeof cur[k] !== 'object' || cur[k] === null) cur[k] = {};
      cur = cur[k];
    }
    cur[parts[parts.length - 1]] = value;
  };
  const get = async (path) => {
    const parts = path.split('/');
    let cur = db;
    for (const k of parts) {
      if (cur === null || typeof cur !== 'object') return { exists: () => false, val: () => undefined };
      cur = cur[k];
    }
    return { exists: () => cur !== undefined, val: () => cur };
  };
  const remove = async (path) => {
    const parts = path.split('/');
    let cur = db;
    for (let i = 0; i < parts.length - 1; i++) {
      if (!cur || typeof cur !== 'object') return;
      cur = cur[parts[i]];
    }
    if (cur) delete cur[parts[parts.length - 1]];
  };
  const reset = () => { for (const k of Object.keys(db)) delete db[k]; };
  return { db, set, get, remove, reset };
});

vi.mock('../../firebase/admin.js', () => ({
  fb: { get: store.get, set: store.set, remove: store.remove },
}));

import {
  createRememberPair,
  hashVerifier,
  deviceHash,
  parseRememberCookie,
  serializeRememberCookie,
  saveRememberToken,
  findRememberToken,
  restoreRememberToken,
  revokeRememberToken,
} from '../../src/modules/auth/remember-me.js';

const USER = 'a25u_test_user';

function seedToken({ selector, verifier, dh = 'devhash', createdAt = Date.now(), revoked = false }) {
  store.set(`remember_tokens/${selector}`, {
    userId: USER,
    verifierHash: hashVerifier(verifier),
    deviceHash: dh,
    createdAt,
    lastUsedAt: createdAt,
    revoked,
  });
}

beforeEach(() => {
  store.reset();
});

describe('AUTH A-25 — remember-me selector/verifier', () => {
  it('createRememberPair: selector 16B hex + verifier 32B hex, noyob juftlik', () => {
    const a = createRememberPair();
    const b = createRememberPair();
    expect(a.selector).toMatch(/^[0-9a-f]{32}$/);
    expect(a.verifier).toMatch(/^[0-9a-f]{64}$/);
    expect(a.selector).not.toBe(b.selector);
    expect(a.verifier).not.toBe(b.verifier);
  });

  it('hashVerifier: deterministik, plaintext saqlanmaydi', () => {
    expect(hashVerifier('abc')).toBe(hashVerifier('abc'));
    expect(hashVerifier('abc')).not.toBe('abc');
  });

  it('deviceHash: deterministik va PII emas', () => {
    expect(deviceHash('ua1', '1.2.3.4')).toBe(deviceHash('ua1', '1.2.3.4'));
    expect(deviceHash('ua1', '1.2.3.4')).not.toBe(deviceHash('ua2', '1.2.3.4'));
  });

  it('parseRememberCookie: format validatsiyasi', () => {
    const pair = createRememberPair();
    const raw = serializeRememberCookie(pair);
    expect(parseRememberCookie(raw)).toEqual(pair);
    expect(parseRememberCookie('')).toBeNull();
    expect(parseRememberCookie('short:verifier')).toBeNull();
    expect(parseRememberCookie(`${'0'.repeat(32)}:${'z'.repeat(64)}`)).toBeNull();
  });

  it('saveRememberToken + findRememberToken: DB yozuvi', async () => {
    const pair = createRememberPair();
    await saveRememberToken({ userId: USER, selector: pair.selector, verifierHash: hashVerifier(pair.verifier), deviceHash: 'dh' });
    const rec = await findRememberToken(pair.selector);
    expect(rec.userId).toBe(USER);
    expect(rec.revoked).toBe(false);
  });

  it('restore: muvaffaqiyat → rotate (yangi juftlik, eski revoke)', async () => {
    const pair = createRememberPair();
    seedToken({ selector: pair.selector, verifier: pair.verifier });
    const r = await restoreRememberToken({ selector: pair.selector, verifier: pair.verifier, deviceHash: 'devhash' });
    expect(r).not.toBeNull();
    expect(r.userId).toBe(USER);
    expect(r.newPair.selector).not.toBe(pair.selector);
    expect(r.newPair.verifier).not.toBe(pair.verifier);
    // eski token revoke qilingan
    const old = await findRememberToken(pair.selector);
    expect(old.revoked).toBe(true);
    // yangi token mavjud
    const fresh = await findRememberToken(r.newPair.selector);
    expect(fresh.userId).toBe(USER);
  });

  it('restore: wrong verifier → null + revoke (replay himoyasi)', async () => {
    const pair = createRememberPair();
    seedToken({ selector: pair.selector, verifier: pair.verifier });
    const r = await restoreRememberToken({ selector: pair.selector, verifier: '0'.repeat(64), deviceHash: 'devhash' });
    expect(r).toBeNull();
    const rec = await findRememberToken(pair.selector);
    expect(rec.revoked).toBe(true);
  });

  it('restore: device hash farqi → null + revoke (theft)', async () => {
    const pair = createRememberPair();
    seedToken({ selector: pair.selector, verifier: pair.verifier });
    const r = await restoreRememberToken({ selector: pair.selector, verifier: pair.verifier, deviceHash: 'boshqa-qurilma' });
    expect(r).toBeNull();
    const rec = await findRememberToken(pair.selector);
    expect(rec.revoked).toBe(true);
  });

  it('restore: revoked token → null', async () => {
    const pair = createRememberPair();
    seedToken({ selector: pair.selector, verifier: pair.verifier, revoked: true });
    const r = await restoreRememberToken({ selector: pair.selector, verifier: pair.verifier, deviceHash: 'devhash' });
    expect(r).toBeNull();
  });

  it('restore: 30 kundan eski token → null (expiry)', async () => {
    const pair = createRememberPair();
    seedToken({ selector: pair.selector, verifier: pair.verifier, createdAt: Date.now() - 31 * 24 * 60 * 60 * 1000 });
    const r = await restoreRememberToken({ selector: pair.selector, verifier: pair.verifier, deviceHash: 'devhash' });
    expect(r).toBeNull();
    const rec = await findRememberToken(pair.selector);
    expect(rec.revoked).toBe(true);
  });

  it('revokeRememberToken: revoked flag + yomon selector xavfsiz', async () => {
    const pair = createRememberPair();
    seedToken({ selector: pair.selector, verifier: pair.verifier });
    await revokeRememberToken(pair.selector);
    expect((await findRememberToken(pair.selector)).revoked).toBe(true);
    await expect(revokeRememberToken('../../../etc')).resolves.toBeUndefined();
  });
});
