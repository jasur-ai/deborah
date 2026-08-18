/**
 * AUTH D-03 — Redis to'liq service (session + cache + rate limit + risk)
 * -------------------------------------------------------------------
 * Yagona Redis client factory + yordamchi util'lar:
 *   - `createRedisService({ url, logger })` — ioredis client, retry, health
 *     (fail-open: Redis yo'q bo'lsa in-memory fallback — rollback rejasi).
 *   - Cache: `cacheGet/cacheSet` (TTL har doim, PII yo'q).
 *   - Idempotency: `acquireIdempotencyLock` (SETNX + TTL) — attempt/answer,
 *     resend kabi takroriy POST'lar uchun.
 *   - Risk counters: `incrCounter/saddCounter` (velocity, stuffing — TTL 15min).
 *   - Audit: Redis xatolari `redis:error` (alert uchun).
 *
 * Key prefix: `auth:{tenant?}:{type}:{scope}` — tenant scope qo'llab-quvvatlangan
 * (default tenant `default`). Secret/PII hech qachon key yoki value'da emas.
 *
 * D-31 qo'shimchalari (session detail):
 *   - Sorted-set parallel session limit (A-02) — `parallelSessionsAdd` (Lua
 *     ATOMIC: ZADD + ZREMRANGEBYSCORE + ZCARD — race yo'q, §07/§21).
 *   - pub/sub cross-node revoke — `publishRevoke/onRevoke` (§09); bir node
 *     revoke qilsa boshqalarida darhol (p95 < 100ms, §27).
 *   - Failover degrade mode — `degradeMode()/health()` (§10/§26): Redis down
 *     bo'lsa login qattiq EMAS (fallback DB), rate per-account, risk qayta.
 *
 * Key namespace (D-31 §24): sess:{id}, rl:{ip}, risk:{user}, sessset:{user}.
 *
 * Test'da ioredis-mock (D-03 §28) — NODE_ENV=test'da tarmoqqa chiqmaydi.
 */
import crypto from 'crypto';
import { EventEmitter } from 'events';

// ── Audit (dinamik import — yengil modul) ──
async function auditRedisError(details = {}) {
  try {
    const { logAuthEvent, AUDIT_ACTIONS } = await import('./audit.js');
    await logAuthEvent({
      action: AUDIT_ACTIONS.REDIS_ERROR,
      outcome: 'error',
      actorId: null,
      details: { op: details.op, reason: String(details.err?.message || details.reason || 'unknown').slice(0, 120) },
    });
  } catch { /* audit muhim emas */ }
}

/** HMAC-hash — PII raw Redis'da emas (faqat hash). */
function hashScope(scope) {
  const secret = process.env.SESSION_SECRET || 'redis-service';
  return crypto.createHash('sha256').update(`${secret}:${String(scope)}`).digest('hex').slice(0, 24);
}

/** Key builder — `auth:{type}:{hash(scope)}` (tenant scope bilan). */
function keyFor(type, scope, tenant = 'default') {
  return `auth:${tenant}:${type}:${hashScope(scope)}`;
}

/**
 * Redis service yaratadi.
 * @param {object} [opts]
 * @param {string} [opts.url]        — REDIS_URL; bo'lmasa in-memory fallback.
 * @param {object} [opts.logger]     — pino-like { info, warn }.
 * @param {object} [opts.client]     — injected client (test: ioredis-mock).
 * @returns {Promise<{ client, ok, close, cacheGet, cacheSet, acquireIdempotencyLock, incrCounter, saddCounter, ping }>}
 */
export async function createRedisService({ url, logger, client: injectedClient } = {}) {
  const log = logger || { info: () => {}, warn: () => {} };
  const mem = new Map(); // in-memory fallback store: key → { value, expiresAt }
  let client = null;
  let ok = false;

  if (injectedClient) {
    client = injectedClient;
    ok = true;
  } else if (url) {
    try {
      const { Redis } = await import('ioredis');
      client = new Redis(url, {
        lazyConnect: true,
        enableReadyCheck: true,
        maxRetriesPerRequest: 2,
        connectTimeout: 3000,
        retryStrategy: (times) => (times > 2 ? null : Math.min(times * 100, 1000)),
      });
      await client.connect();
      const pong = await client.ping();
      if (pong !== 'PONG') throw new Error(`redis ping: ${String(pong).slice(0, 20)}`);
      ok = true;
      log.info?.('Redis service connected');
    } catch (err) {
      log.warn?.({ err: err.message }, 'Redis mavjud emas — in-memory fallback');
      client = null;
      ok = false;
    }
  } else {
    log.info?.('REDIS_URL yo\'q — Redis service in-memory fallback');
  }

  /** Memory fallback helper. */
  function memGet(key) {
    const rec = mem.get(key);
    if (!rec) return null;
    if (rec.expiresAt && rec.expiresAt < Date.now()) { mem.delete(key); return null; }
    return rec.value;
  }

  /** Cache read — Redis GET yoki memory. Xato → null (fail-open). */
  async function cacheGet(key, type = 'generic', tenant = 'default') {
    const fullKey = keyFor(type, key, tenant);
    if (ok && client) {
      try {
        const v = await client.get(fullKey);
        return v === null || v === undefined ? null : v;
      } catch (err) {
        auditRedisError({ op: 'cacheGet', err }).catch(() => {});
        return null;
      }
    }
    return memGet(fullKey);
  }

  /** Cache write — TTL har doim (ms). Xato → audit (fail-open). */
  async function cacheSet(key, value, ttlMs, type = 'generic', tenant = 'default') {
    const fullKey = keyFor(type, key, tenant);
    const ttlSec = Math.max(1, Math.ceil(ttlMs / 1000));
    if (ok && client) {
      try {
        await client.set(fullKey, String(value), 'EX', ttlSec);
        return true;
      } catch (err) {
        auditRedisError({ op: 'cacheSet', err }).catch(() => {});
        return false;
      }
    }
    mem.set(fullKey, { value: String(value), expiresAt: Date.now() + ttlMs });
    return true;
  }

  /**
   * Idempotency lock (SETNX + TTL). Takroriy write (attempt/answer, resend)
   * bir vaqtda ikkita request bajarilmasligi uchun.
   * @returns {Promise<boolean>} — lock olingan bo'lsa true.
   */
  async function acquireIdempotencyLock(key, ttlMs = 15000, tenant = 'default') {
    const fullKey = keyFor('idem', key, tenant);
    const ttlSec = Math.max(1, Math.ceil(ttlMs / 1000));
    if (ok && client) {
      try {
        const res = await client.set(fullKey, '1', 'EX', ttlSec, 'NX');
        return res === 'OK';
      } catch (err) {
        auditRedisError({ op: 'idemLock', err }).catch(() => {});
        return true; // fail-open — Redis xatosi idempotency'ni bloklamaydi
      }
    }
    if (mem.has(fullKey)) {
      const rec = mem.get(fullKey);
      if (rec.expiresAt > Date.now()) return false;
    }
    mem.set(fullKey, { value: '1', expiresAt: Date.now() + ttlMs });
    return true;
  }

  /** Idempotency lock bo'shatish (optional — TTL yetarli). */
  async function releaseIdempotencyLock(key, tenant = 'default') {
    const fullKey = keyFor('idem', key, tenant);
    if (ok && client) {
      try { await client.del(fullKey); } catch { /* TTL yetarli */ }
      return;
    }
    mem.delete(fullKey);
  }

  /**
   * Risk counter (velocity/stuffing — D-03 §09): INCR + EXPIRE (TTL 15 min).
   * @returns {Promise<number>} — joriy counter.
   */
  async function incrCounter(scope, ttlMs = 15 * 60 * 1000, type = 'risk', tenant = 'default') {
    const fullKey = keyFor(type, scope, tenant);
    const ttlSec = Math.max(1, Math.ceil(ttlMs / 1000));
    if (ok && client) {
      try {
        const n = await client.incr(fullKey);
        if (n === 1) await client.expire(fullKey, ttlSec);
        return n;
      } catch (err) {
        auditRedisError({ op: 'incrCounter', err }).catch(() => {});
        return 1;
      }
    }
    const cur = Number(memGet(fullKey) || 0) + 1;
    mem.set(fullKey, { value: String(cur), expiresAt: Date.now() + ttlMs });
    return cur;
  }

  /** Risk velocity (unique values to'plami): SADD + EXPIRE. */
  async function saddCounter(scope, member, ttlMs = 10 * 60 * 1000, type = 'velocity', tenant = 'default') {
    const fullKey = keyFor(type, scope, tenant);
    const ttlSec = Math.max(1, Math.ceil(ttlMs / 1000));
    if (ok && client) {
      try {
        const added = await client.sadd(fullKey, String(member));
        if (added === 1) await client.expire(fullKey, ttlSec);
        const size = await client.scard(fullKey);
        return size;
      } catch (err) {
        auditRedisError({ op: 'saddCounter', err }).catch(() => {});
        return 1;
      }
    }
    const set = new Set((memGet(fullKey) || '').split('|').filter(Boolean));
    set.add(String(member));
    mem.set(fullKey, { value: [...set].join('|'), expiresAt: Date.now() + ttlMs });
    return set.size;
  }

  /** Health: ping. Redis yo'q bo'lsa false. */
  async function ping() {
    if (!ok || !client) return false;
    try { return (await client.ping()) === 'PONG'; } catch { return false; }
  }

  /* ------------------------------------------------------------------------ */
  /* D-31 — parallel session limit (sorted-set + Lua ATOMIC, A-02 §06)        */
  /* ------------------------------------------------------------------------ */
  // Lua: ZADD (score=now) + limit'dan oshsa eng eski'ni o'chir + count qaytar.
  // Bitta EVAL — parallel login/revoke race YO'Q (§07/§21/§25).
  const PARALLEL_ADD_LUA = `
    local key = KEYS[1]
    local member = ARGV[1]
    local now = tonumber(ARGV[2])
    local limit = tonumber(ARGV[3])
    redis.call('ZADD', key, now, member)
    local count = redis.call('ZCARD', key)
    if count > limit then
      local excess = count - limit
      local oldest = redis.call('ZRANGE', key, 0, excess - 1)
      for i, m in ipairs(oldest) do redis.call('ZREM', key, m) end
      count = redis.call('ZCARD', key)
    end
    return count
  `;

  /**
   * Parallel session'ni sorted-set'ga qo'shadi (ATOMIC — race yo'q, §07).
   * Limit'dan oshsa eng eski session'lar o'chiriladi (A-02).
   * @returns {Promise<{ ok, count, evicted }>}
   */
  async function parallelSessionsAdd(userKey, sessionId, { limit = 5, ttlMs = 30 * 24 * 60 * 60 * 1000, tenant = 'default' } = {}) {
    const fullKey = `auth:${tenant}:sessset:${userKey}`; // D-31 §24 namespace
    const ttlSec = Math.max(1, Math.ceil(ttlMs / 1000));
    const now = Date.now();
    if (ok && client) {
      try {
        const count = await client.eval(PARALLEL_ADD_LUA, 1, fullKey, String(sessionId), String(now), String(limit));
        await client.expire(fullKey, ttlSec);
        return { ok: true, count: Number(count), evicted: Number(count) > limit ? 1 : 0 };
      } catch (err) {
        auditRedisError({ op: 'parallelSessionsAdd', err }).catch(() => {});
        // fallback: memory'dagi raqobatsiz versiya (test/degrade)
      }
    }
    // Memory fallback (in-memory / degrade) — sorted-set ekvivalenti array
    const rec = memGet(fullKey) ? JSON.parse(memGet(fullKey)) : [];
    rec.push({ id: String(sessionId), at: now });
    rec.sort((a, b) => a.at - b.at);
    let evicted = 0;
    while (rec.length > limit) { rec.shift(); evicted += 1; }
    mem.set(fullKey, { value: JSON.stringify(rec), expiresAt: Date.now() + ttlMs });
    return { ok: true, count: rec.length, evicted };
  }

  /** Sorted-set'dan session'ni o'chiradi (revoke §07). */
  async function parallelSessionsRemove(userKey, sessionId, { tenant = 'default' } = {}) {
    const fullKey = `auth:${tenant}:sessset:${userKey}`;
    if (ok && client) {
      try {
        await client.zrem(fullKey, String(sessionId));
        return { ok: true };
      } catch (err) {
        auditRedisError({ op: 'parallelSessionsRemove', err }).catch(() => {});
      }
    }
    const rec = memGet(fullKey) ? JSON.parse(memGet(fullKey)) : [];
    const next = rec.filter((r) => r.id !== String(sessionId));
    mem.set(fullKey, { value: JSON.stringify(next), expiresAt: (mem.get(fullKey)?.expiresAt) || Date.now() + 15 * 60 * 1000 });
    return { ok: true };
  }

  /** Parallel session soni (§06 sorted-set). */
  async function parallelSessionsCount(userKey, { tenant = 'default' } = {}) {
    const fullKey = `auth:${tenant}:sessset:${userKey}`;
    if (ok && client) {
      try {
        return Number(await client.zcard(fullKey));
      } catch (err) {
        auditRedisError({ op: 'parallelSessionsCount', err }).catch(() => {});
      }
    }
    const rec = memGet(fullKey) ? JSON.parse(memGet(fullKey)) : [];
    return rec.length;
  }

  /** Eng eski session ID (eviction uchun — A-02). */
  async function parallelSessionsOldest(userKey, { tenant = 'default' } = {}) {
    const fullKey = `auth:${tenant}:sessset:${userKey}`;
    if (ok && client) {
      try {
        const r = await client.zrange(fullKey, 0, 0);
        return r.length ? r[0] : null;
      } catch (err) {
        auditRedisError({ op: 'parallelSessionsOldest', err }).catch(() => {});
      }
    }
    const rec = memGet(fullKey) ? JSON.parse(memGet(fullKey)) : [];
    return rec.length ? rec[0].id : null;
  }

  /* ------------------------------------------------------------------------ */
  /* D-31 — pub/sub cross-node revoke (§09/§27)                               */
  /* ------------------------------------------------------------------------ */
  const REVOKE_CHANNEL = 'auth:revoke';
  const localEmitter = new EventEmitter(); // memory fallback: bir jarayon ichida
  let subClient = null;

  /**
   * Revoke event publish qiladi — boshqa node'lar darhol biladi (§09).
   * payload: { sessionId, userId, ts } — PII minimal (§12).
   */
  async function publishRevoke({ sessionId, userId = null, reason = 'revoke' } = {}) {
    const payload = JSON.stringify({ sessionId: String(sessionId), userId, reason, ts: Date.now() });
    if (ok && client) {
      try {
        await client.publish(REVOKE_CHANNEL, payload);
        return true;
      } catch (err) {
        auditRedisError({ op: 'publishRevoke', err }).catch(() => {});
        localEmitter.emit(REVOKE_CHANNEL, payload); // fail-open: lokal ham eshitadi
        return false;
      }
    }
    localEmitter.emit(REVOKE_CHANNEL, payload);
    return true;
  }

  /**
   * Revoke event'larni eshitadi (barcha node'lar subscribe qiladi).
   * @returns {Promise<() => void>} — unsubscribe funksiyasi.
   */
  async function onRevoke(handler) {
    const listener = (payload) => {
      try { handler(JSON.parse(payload)); } catch (_) { /* bad message — skip */ }
    };
    if (ok && client) {
      try {
        if (!subClient) {
          subClient = client.duplicate();
          await subClient.subscribe(REVOKE_CHANNEL);
          subClient.on('message', (ch, msg) => { if (ch === REVOKE_CHANNEL) localEmitter.emit(REVOKE_CHANNEL, msg); });
        }
      } catch (err) {
        auditRedisError({ op: 'onRevoke', err }).catch(() => {});
      }
    }
    localEmitter.on(REVOKE_CHANNEL, listener);
    return () => localEmitter.off(REVOKE_CHANNEL, listener);
  }

  /* ------------------------------------------------------------------------ */
  /* D-31 — failover degrade mode (§10/§26)                                   */
  /* ------------------------------------------------------------------------ */
  let degradedAt = null;

  /** Degrade mode holati: Redis down → true (login qattiq EMAS, fallback DB). */
  async function health() {
    const healthy = await ping();
    if (!healthy && ok) {
      ok = false; // Redis tushdi — degrade mode
      degradedAt = Date.now();
    } else if (healthy && !ok) {
      ok = true; // Redis qaytdi
      degradedAt = null;
    }
    return {
      ok: healthy,
      degrade: !healthy,
      degradedAt,
      // Failover siyosati (§26): sessions yo'qoladi → re-login ACCEPT;
      // rate limit DB fallback (per-account, C-01); risk cache qayta hisob.
    };
  }

  async function close() {
    if (subClient) { try { await subClient.quit(); } catch { /* non-critical */ } subClient = null; }
    if (ok && client && !injectedClient) {
      try { await client.quit(); } catch { /* non-critical */ }
    }
    mem.clear();
  }

  return {
    client, ok, close, cacheGet, cacheSet, acquireIdempotencyLock, releaseIdempotencyLock,
    incrCounter, saddCounter, ping, health,
    parallelSessionsAdd, parallelSessionsRemove, parallelSessionsCount, parallelSessionsOldest,
    publishRevoke, onRevoke,
  };
}
