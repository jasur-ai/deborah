/**
 * Edikit — E-01a: Canonical OneID (identity.js)
 * ---------------------------------------------------------------------------
 * `oneid_sub` generatsiya + mapping: ensureOneId (idempotent), linkProviderToOneId,
 * resolveOneId, removeOneIdMapping. In-memory mock FB (hermetic — real DB tegsiz).
 */
import { describe, it, expect } from 'vitest';
import {
  generateOneId,
  ensureOneId,
  linkProviderToOneId,
  resolveOneId,
  removeOneIdMapping,
  syncLinkedOneIds,
  backfillOneIds,
} from '../../../src/modules/auth/identity.js';

/** In-memory mock Firebase — nested path'lar parent'ga merge qilinadi (RDB xulqi). */
function createMockDb() {
  const store = new Map();
  // 'a/b/c' → store.get('a')?.b?.c (deep get)
  const deepGet = (p) => {
    const seg = p.split('/');
    let cur = store.get(seg[0]);
    for (let i = 1; i < seg.length && cur !== undefined && cur !== null; i++) cur = cur[seg[i]];
    return cur;
  };
  const deepHas = (p) => deepGet(p) !== undefined;
  const deepSet = (p, v) => {
    const seg = p.split('/');
    if (seg.length === 1) { store.set(seg[0], v); return; }
    const first = seg[0];
    let obj = store.get(first);
    if (obj === undefined || obj === null || typeof obj !== 'object') { obj = {}; store.set(first, obj); }
    let cur = obj;
    for (let i = 1; i < seg.length - 1; i++) {
      if (cur[seg[i]] === undefined || typeof cur[seg[i]] !== 'object') cur[seg[i]] = {};
      cur = cur[seg[i]];
    }
    cur[seg[seg.length - 1]] = v;
  };
  const deepRemove = (p) => {
    const seg = p.split('/');
    if (seg.length === 1) { store.delete(seg[0]); return; }
    const first = seg[0];
    const obj = store.get(first);
    if (obj === undefined || typeof obj !== 'object') return;
    let cur = obj;
    for (let i = 1; i < seg.length - 1; i++) {
      if (cur[seg[i]] === undefined || typeof cur[seg[i]] !== 'object') return;
      cur = cur[seg[i]];
    }
    delete cur[seg[seg.length - 1]];
  };
  return {
    store,
    get: async (p) => ({ exists: () => deepHas(p), val: () => deepGet(p) }),
    set: async (p, v) => { deepSet(p, v); },
    remove: async (p) => { deepRemove(p); },
  };
}

describe('E-01a — Canonical OneID', () => {
  it('1) generateOneId — prefiks + 32 hex (128-bit)', () => {
    const id = generateOneId();
    expect(id.startsWith('oid_')).toBe(true);
    expect(id.length).toBe(4 + 32);
  });

  it('2) generateOneId — har safar yangi (kolliziya yo\'q)', () => {
    const a = generateOneId();
    const b = generateOneId();
    expect(a).not.toBe(b);
  });

  it('3) ensureOneId — yangi user\'ga OneID yaratadi', async () => {
    const db = createMockDb();
    await db.set('users/user-a', { username: 'alice', google_sub: 'g1' });
    const r = await ensureOneId('user-a', { fbGet: db.get, fbSet: db.set });
    expect(r.ok).toBe(true);
    expect(r.created).toBe(true);
    expect(r.oneId.startsWith('oid_')).toBe(true);
    // user record'ga yozildi
    expect((await db.get('users/user-a')).val().oneid_sub).toBe(r.oneId);
    // mapping yaratildi
    expect((await db.get(`identity/${r.oneId}`)).exists()).toBe(true);
  });

  it('4) ensureOneId — idempotent: takroriy chaqiruv bir xil OneID', async () => {
    const db = createMockDb();
    await db.set('users/user-a', { username: 'alice' });
    const r1 = await ensureOneId('user-a', { fbGet: db.get, fbSet: db.set });
    const r2 = await ensureOneId('user-a', { fbGet: db.get, fbSet: db.set });
    expect(r2.ok).toBe(true);
    expect(r2.created).toBe(false);
    expect(r2.oneId).toBe(r1.oneId);
  });

  it('5) ensureOneId — mavjud oneid_sub qaytariladi (backfill)', async () => {
    const db = createMockDb();
    await db.set('users/user-b', { username: 'bob', oneid_sub: 'oid_existing' });
    const r = await ensureOneId('user-b', { fbGet: db.get, fbSet: db.set });
    expect(r.oneId).toBe('oid_existing');
    expect(r.created).toBe(false);
  });

  it('6) ensureOneId — user yo\'q → xato', async () => {
    const db = createMockDb();
    const r = await ensureOneId('ghost', { fbGet: db.get, fbSet: db.set });
    expect(r.ok).toBe(false);
    expect(r.error).toBe('user-not-found');
  });

  it('7) linkProviderToOneId — provider bog\'lanadi', async () => {
    const db = createMockDb();
    const oneId = generateOneId();
    await db.set(`identity/${oneId}`, { userKey: 'user-a', providers: {}, createdAt: 1 });
    const r = await linkProviderToOneId(oneId, 'google', 'sub-123', { fbGet: db.get, fbSet: db.set });
    expect(r.ok).toBe(true);
    const map = (await db.get(`identity/${oneId}`)).val();
    expect(map.providers.google.subject).toBe('sub-123');
  });

  it('8) linkProviderToOneId — oneid yo\'q → xato', async () => {
    const db = createMockDb();
    const r = await linkProviderToOneId('oid_nope', 'google', 's1', { fbGet: db.get, fbSet: db.set });
    expect(r.ok).toBe(false);
    expect(r.error).toBe('oneid-not-found');
  });

  it('9) resolveOneId — userKey va providers qaytaradi', async () => {
    const db = createMockDb();
    const oneId = generateOneId();
    await db.set(`identity/${oneId}`, {
      userKey: 'user-x',
      providers: { hemis: { subject: 'h1', linkedAt: 1 } },
      createdAt: 1,
    });
    const r = await resolveOneId(oneId, { fbGet: db.get });
    expect(r.ok).toBe(true);
    expect(r.userKey).toBe('user-x');
    expect(r.providers.hemis.subject).toBe('h1');
  });

  it('10) resolveOneId — noma\'lum → ok:false', async () => {
    const db = createMockDb();
    const r = await resolveOneId('oid_unknown', { fbGet: db.get });
    expect(r.ok).toBe(false);
    expect(r.userKey).toBeNull();
  });

  it('11) removeOneIdMapping — mapping o\'chadi (DSAR)', async () => {
    const db = createMockDb();
    const oneId = generateOneId();
    await db.set(`identity/${oneId}`, { userKey: 'user-a' });
    const r = await removeOneIdMapping(oneId, { fbRemove: db.remove });
    expect(r.ok).toBe(true);
    expect((await db.get(`identity/${oneId}`)).exists()).toBe(false);
  });

  it("12) syncLinkedOneIds — ikkala user'da ham yo'q → yangi OneID (A asosiy)", async () => {
    const db = createMockDb();
    await db.set('users/user-a', { email: 'a@x.io', name: 'A' });
    await db.set('users/user-b', { email: 'b@x.io', name: 'B' });
    const r = await syncLinkedOneIds('user-a', 'user-b', { fbSet: db.set, fbGet: db.get, fbRemove: db.remove });
    expect(r.ok).toBe(true);
    expect(r.oneId).toBeTruthy();
    const a = (await db.get('users/user-a')).val().oneid_sub;
    const b = (await db.get('users/user-b')).val().oneid_sub;
    expect(a).toBe(r.oneId);
    expect(b).toBe(r.oneId);
  });

  it("13) syncLinkedOneIds — A'da bor, B'da yo'q → B A'ning OneID'ini oladi", async () => {
    const db = createMockDb();
    const oneId = generateOneId();
    await db.set('users/user-a', { email: 'a@x.io', oneid_sub: oneId });
    await db.set('users/user-b', { email: 'b@x.io' });
    const r = await syncLinkedOneIds('user-a', 'user-b', { fbSet: db.set, fbGet: db.get, fbRemove: db.remove });
    expect(r.ok).toBe(true);
    expect(r.oneId).toBe(oneId);
    expect((await db.get('users/user-b')).val().oneid_sub).toBe(oneId);
  });

  it('14) syncLinkedOneIds — ikkalasida ham bor va bir xil → idempotent', async () => {
    const db = createMockDb();
    const oneId = generateOneId();
    await db.set('users/user-a', { email: 'a@x.io', oneid_sub: oneId });
    await db.set('users/user-b', { email: 'b@x.io', oneid_sub: oneId });
    const r = await syncLinkedOneIds('user-a', 'user-b', { fbSet: db.set, fbGet: db.get, fbRemove: db.remove });
    expect(r.ok).toBe(true);
    expect(r.oneId).toBe(oneId);
    expect((await db.get('users/user-a')).val().oneid_sub).toBe(oneId);
    expect((await db.get('users/user-b')).val().oneid_sub).toBe(oneId);
  });

  it("15) syncLinkedOneIds — farqli OneID'lar → B'ning mapping'i A'ga ko'chadi, B yangilanadi", async () => {
    const db = createMockDb();
    const idA = generateOneId();
    const idB = generateOneId();
    await db.set('users/user-a', { email: 'a@x.io', oneid_sub: idA });
    await db.set('users/user-b', { email: 'b@x.io', oneid_sub: idB });
    await db.set(`identity/${idA}`, { userKey: 'user-a', providers: {} });
    await db.set(`identity/${idB}`, { userKey: 'user-b', providers: { telegram: { subject: 'tg1', linkedAt: 1 } } });
    const r = await syncLinkedOneIds('user-a', 'user-b', { fbSet: db.set, fbGet: db.get, fbRemove: db.remove });
    expect(r.ok).toBe(true);
    expect(r.oneId).toBe(idA);
    expect((await db.get('users/user-b')).val().oneid_sub).toBe(idA);
    // Eski mapping o'chdi
    expect((await db.get(`identity/${idB}`)).exists()).toBe(false);
    // Provider ko'chdi
    const map = (await db.get(`identity/${idA}`)).val();
    expect(map.providers.telegram.subject).toBe('tg1');
  });

  it('16) syncLinkedOneIds — user topilmasa → ok:false (fail-soft)', async () => {
    const db = createMockDb();
    await db.set('users/user-a', { email: 'a@x.io' });
    const r = await syncLinkedOneIds('user-a', 'ghost', { fbSet: db.set, fbGet: db.get, fbRemove: db.remove });
    expect(r.ok).toBe(false);
    expect(r.error).toBe('user-not-found');
  });

  it('17) syncLinkedOneIds — bir xil key → ok:false', async () => {
    const db = createMockDb();
    const r = await syncLinkedOneIds('user-a', 'user-a', { fbSet: db.set, fbGet: db.get, fbRemove: db.remove });
    expect(r.ok).toBe(false);
    expect(r.error).toBe('same-user');
  });

  it("18) backfillOneIds — oneid_sub yo'q user'larga OneID beradi", async () => {
    const db = createMockDb();
    await db.set('users/user-a', { email: 'a@x.io' });
    await db.set('users/user-b', { email: 'b@x.io' });
    const r = await backfillOneIds({ fbGet: db.get, fbSet: db.set });
    expect(r.ok).toBe(true);
    expect(r.processed).toBe(2);
    expect(r.created).toBe(2);
    expect(r.skipped).toBe(0);
    const a = (await db.get('users/user-a')).val().oneid_sub;
    const b = (await db.get('users/user-b')).val().oneid_sub;
    expect(a).toBeTruthy();
    expect(b).toBeTruthy();
    expect(a).not.toBe(b);
  });

  it('19) backfillOneIds — idempotent: ikkinchi yugurish yangi OneID yaratmaydi', async () => {
    const db = createMockDb();
    await db.set('users/user-a', { email: 'a@x.io' });
    await db.set('users/user-b', { email: 'b@x.io' });
    await backfillOneIds({ fbGet: db.get, fbSet: db.set });
    const idBefore = (await db.get('users/user-a')).val().oneid_sub;
    const r2 = await backfillOneIds({ fbGet: db.get, fbSet: db.set });
    expect(r2.ok).toBe(true);
    expect(r2.created).toBe(0);
    expect(r2.skipped).toBe(2);
    expect((await db.get('users/user-a')).val().oneid_sub).toBe(idBefore);
  });

  it('20) backfillOneIds — aralash: 1 ta mavjud + 1 ta yangi', async () => {
    const db = createMockDb();
    const oneId = generateOneId();
    await db.set('users/user-a', { email: 'a@x.io', oneid_sub: oneId });
    await db.set('users/user-b', { email: 'b@x.io' });
    const r = await backfillOneIds({ fbGet: db.get, fbSet: db.set });
    expect(r.processed).toBe(2);
    expect(r.created).toBe(1);
    expect(r.skipped).toBe(1);
    expect((await db.get('users/user-a')).val().oneid_sub).toBe(oneId);
    expect((await db.get('users/user-b')).val().oneid_sub).toBeTruthy();
  });

  it("21) backfillOneIds — users bo'lmasa → 0", async () => {
    const db = createMockDb();
    const r = await backfillOneIds({ fbGet: db.get, fbSet: db.set });
    expect(r.ok).toBe(true);
    expect(r.processed).toBe(0);
    expect(r.created).toBe(0);
  });
});
