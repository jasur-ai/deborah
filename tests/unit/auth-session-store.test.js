/**
 * AUTH A-01 — Session store unit testlar
 * ioredis-mock ishlatiladi — real Redis talab qilinmaydi (guide §28).
 */
import { describe, it, expect, vi } from 'vitest';
import Redis from 'ioredis-mock';
import {
  genSessionId,
  sessionTtlMs,
  SESSION_TTL_REMEMBER_MS,
  SESSION_TTL_DEFAULT_MS,
  SESSION_PREFIX,
  createSessionStore,
} from '../../src/modules/auth/session-store.js';

describe('AUTH A-01 — session-store (Redis session foundation)', () => {
  it('genSessionId: 32B random hex (64 belgi) va unikal', () => {
    const a = genSessionId();
    const b = genSessionId();
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(a).not.toBe(b);
  });

  it('sessionTtlMs: remember → 30 kun; default → 8 soat', () => {
    expect(sessionTtlMs(true)).toBe(SESSION_TTL_REMEMBER_MS);
    expect(sessionTtlMs(true)).toBe(30 * 24 * 60 * 60 * 1000);
    expect(sessionTtlMs(false)).toBe(SESSION_TTL_DEFAULT_MS);
    expect(sessionTtlMs(false)).toBe(8 * 60 * 60 * 1000);
    expect(sessionTtlMs(undefined)).toBe(SESSION_TTL_DEFAULT_MS);
  });

  it('REDIS_URL yo\'q bo\'lsa MemoryStore fallback (rollback rejasi)', async () => {
    const r = await createSessionStore({});
    expect(r.redisOk).toBe(false);
    expect(r.client).toBeNull();
    expect(r.store).toBeTruthy();
    await r.close();
  });

  it('Redis (ioredis-mock): store set/get/destroy ishlaydi', async () => {
    const client = new Redis();
    const r = await createSessionStore({ client });
    expect(r.redisOk).toBe(true);

    const sess = { cookie: { maxAge: 60000 }, user: { safeKey: 'ali' } };
    await new Promise((resolve, reject) =>
      r.store.set('sess-abc', sess, (err) => (err ? reject(err) : resolve()))
    );

    const got = await new Promise((resolve, reject) =>
      r.store.get('sess-abc', (err, s) => (err ? reject(err) : resolve(s)))
    );
    expect(got).toBeTruthy();
    expect(got.user.safeKey).toBe('ali');

    await new Promise((resolve, reject) =>
      r.store.destroy('sess-abc', (err) => (err ? reject(err) : resolve()))
    );
    const gone = await new Promise((resolve, reject) =>
      r.store.get('sess-abc', (err, s) => (err ? reject(err) : resolve(s)))
    );
    expect(gone).toBeNull();

    await r.close();
  });

  it('prefix edikit:sess: — Redis kalitlari izolyatsiya qilingan', async () => {
    const client = new Redis();
    const r = await createSessionStore({ client });
    const sess = { cookie: { maxAge: 60000 } };
    await new Promise((resolve, reject) =>
      r.store.set('k1', sess, (err) => (err ? reject(err) : resolve()))
    );
    const keys = await client.keys(`${SESSION_PREFIX}*`);
    expect(keys).toHaveLength(1);
    expect(keys[0]).toBe(`${SESSION_PREFIX}k1`);
    await r.close();
  });

  it('Redis TTL per-session derive: connect-redis 8.1.0 sess.cookie.expires dan hisoblaydi', async () => {
    // connect-redis 8.1.0 _getTTL() manba (dist/connect-redis.cjs):
    //   if sess?.cookie?.expires → ceil((expires - now)/1000)  (per-session)
    //   else → statik this.ttl (undefined bo'lsa key destroy qilinadi)
    // Bizning store hech qanday statik ttl bermaydi (to'g'ri — remember 30 kun /
    // default 8 soat per-session mapping cookie.expires orqali ishlaydi).
    // DIQQAT: connect-redis v10 ioredis bilan ishlamaydi (set() da node-redis'ga
    // xos `expiration:{type,value}` formasini ishlatadi → real Redis'da syntax
    // error). Shu sababli v8.1.0 o'rnatildi (ioredis-mos `set(key,val,ttl)`).
    // Haqiqiy Redis tekshiruvi: scripts/auth-a01-redis-verify.js (Docker).
    const client = new Redis();
    const r = await createSessionStore({ client });
    expect(r.redisOk).toBe(true);
    // cookie.expires'li sessiya round-trip qiladi (payload saqlanadi)
    const sess = { cookie: { expires: new Date(Date.now() + SESSION_TTL_REMEMBER_MS) }, user: { safeKey: 'ali' } };
    await new Promise((resolve, reject) =>
      r.store.set('rem-1', sess, (err) => (err ? reject(err) : resolve()))
    );
    const got = await new Promise((resolve, reject) =>
      r.store.get('rem-1', (err, s) => (err ? reject(err) : resolve(s)))
    );
    expect(got.user.safeKey).toBe('ali');
    expect(new Date(got.cookie.expires).getTime()).toBeGreaterThan(Date.now());
    await r.close();
  });

  it('fallback: Redis ulanishi muvaffaqiyatsiz bo\'lsa MemoryStore', async () => {
    const warn = vi.fn();
    const r = await createSessionStore({
      url: 'redis://127.0.0.1:1', // ishlab turgan port emas
      logger: { info: vi.fn(), warn },
    });
    // retryStrategy 2 urinishdan keyin to'xtaydi → tez fallback
    expect(r.redisOk).toBe(false);
    expect(r.client).toBeNull();
  });
});
