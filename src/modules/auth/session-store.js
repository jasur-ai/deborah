/**
 * Edikit — Session Store service (AUTH A-01)
 *
 * Session storage'ni bitta joydan boshqaradi: Redis (connect-redis + ioredis)
 * yoki MemoryStore fallback. Boshqa modullar faqat shu service'dan import qiladi.
 *
 * Xususiyatlar:
 *   1. TTL mapping — remember=true → 30 kun, aks holda 8 soat (cookie Max-Age mos).
 *   2. Session ID — 32B crypto.randomBytes (taxmin qilib bo'lmaydi, 64 hex).
 *   3. Health check — startup'da Redis ping; muvaffaqiyatsiz bo'lsa MemoryStore fallback.
 *   4. Graceful close — shutdown'da Redis disconnect/drain.
 *
 * Rollback rejasi (guide §10/§30): REDIS_URL yo'q yoki Redis ishlamasa avtomatik
 * MemoryStore'ga o'tadi — eski xatti-harakat saqlanadi (flag bilan fallback).
 *
 * @module session-store
 */
import crypto from 'crypto';
import session from 'express-session';
import CONFIG from '../../config/env.js';

// ⚠️ DIQQAT — connect-redis versiyasi (package.json):
// v9/v10 `set()` da node-redis'ga xos `set(key,val,{expiration:{type:'EX',value}})`
// formasini ishlatadi — ioredis 5.x buni qo'llamaydi (real Redis'da "ERR syntax
// error", har session saqlashda ishlamaydi). Shu sababli v8.1.0 pin qilingan
// (^8.1.0 — v9/v10 upgrade qilmaslik kerak!). Haqiqiy Redis isboti:
// scripts/auth-a01-redis-verify.js. Batafsil: tests/unit/auth-session-store.test.js

// ── TTL konstantalari (ms) ──
export const SESSION_TTL_REMEMBER_MS = 30 * 24 * 60 * 60 * 1000; // 30 kun
export const SESSION_TTL_DEFAULT_MS = 8 * 60 * 60 * 1000;        // 8 soat
export const SESSION_PREFIX = 'edikit:sess:';

// ── AUTH A-25: session hardening konstantalari ──
export const SESSION_ABSOLUTE_TIMEOUT_MS = 12 * 60 * 60 * 1000; // 12 soat — login'dan boshlab qat'iy limit
export const SESSION_ROTATE_INTERVAL_MS = 30 * 60 * 1000;       // 30 daqiqa — mid-session ID rotation
export const REMEMBER_TTL_MS = 30 * 24 * 60 * 60 * 1000;        // 30 kun — remember-me selector/verifier
const REMEMBER_COOKIE_BASE = 'edikit_remember';

/**
 * Session cookie nomi (AUTH A-02). P2 `__Host-` prefix: faqat production +
 * HTTPS + path=/ + domain yo'q sharti bilan (browser talabi).
 * @returns {string}
 */
export function sessionCookieName() {
  const base = CONFIG.SESSION_COOKIE_NAME || 'connect.sid';
  if (CONFIG.SESSION_HOST_PREFIX && CONFIG.NODE_ENV === 'production') {
    return base.startsWith('__Host-') ? base : `__Host-${base}`;
  }
  return base;
}

/**
 * remember flag'iga qarab session TTL (cookie Max-Age uchun ham ishlatiladi).
 * @param {boolean} [remember]
 * @returns {number} millisekund
 */
export function sessionTtlMs(remember) {
  return remember ? SESSION_TTL_REMEMBER_MS : SESSION_TTL_DEFAULT_MS;
}

/**
 * Absolute session timeout (AUTH A-25): login'dan boshlab qat'iy 12 soat.
 * @returns {number}
 */
export function absoluteTimeoutMs() {
  return CONFIG.SESSION_ABSOLUTE_TIMEOUT_MS || SESSION_ABSOLUTE_TIMEOUT_MS;
}

/**
 * Mid-session rotation interval (AUTH A-25): sessiya ID shu oraliqda yangilanadi.
 * @returns {number}
 */
export function rotateIntervalMs() {
  return CONFIG.SESSION_ROTATE_INTERVAL_MS || SESSION_ROTATE_INTERVAL_MS;
}

/**
 * Remember-me cookie nomi (AUTH A-25 §07). P2 `__Host-` prefix: faqat
 * production + HTTPS + path=/ + domain yo'q sharti bilan (browser talabi).
 * @returns {string}
 */
export function rememberCookieName() {
  const base =
    CONFIG.SESSION_COOKIE_NAME && CONFIG.SESSION_COOKIE_NAME !== 'connect.sid'
      ? `edikit_${String(CONFIG.SESSION_COOKIE_NAME).replace(/^__Host-/, '')}`
      : REMEMBER_COOKIE_BASE;
  if (CONFIG.SESSION_HOST_PREFIX && CONFIG.NODE_ENV === 'production') {
    return base.startsWith('__Host-') ? base : `__Host-${base}`;
  }
  return base;
}

/**
 * 32B random hex session ID — express-session genid uchun.
 * @returns {string} 64 belgili hex
 */
export function genSessionId() {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * Session store yaratadi (yagona entry point).
 *
 * @param {object} [opts]
 * @param {string} [opts.url]          — REDIS_URL; bo'lmasa MemoryStore.
 * @param {object} [opts.logger]       — pino-like { info, warn }.
 * @param {object} [opts.client]       — tayyor Redis client (test: ioredis-mock).
 * @returns {Promise<{store, client, redisOk, close}>}
 */
export async function createSessionStore({ url, logger, client: injectedClient } = {}) {
  const log = logger || { info: () => {}, warn: () => {} };

  // Injected client (testlar) — connect/ping o'tkazilmaydi
  if (injectedClient) {
    const { RedisStore } = await import('connect-redis');
    const store = new RedisStore({ client: injectedClient, prefix: SESSION_PREFIX });
    return {
      store,
      client: injectedClient,
      redisOk: true,
      close: async () => { try { await injectedClient.quit?.(); } catch (_) { /* non-critical */ } },
    };
  }

  if (!url) {
    log.info?.('REDIS_URL yo\'q — MemoryStore ishlatiladi (rollback)');
    return { store: new session.MemoryStore(), client: null, redisOk: false, close: async () => {} };
  }

  try {
    const { Redis } = await import('ioredis');
    const { RedisStore } = await import('connect-redis');
    const client = new Redis(url, {
      lazyConnect: true,
      enableReadyCheck: true,
      maxRetriesPerRequest: 2,
      connectTimeout: 3000,
      retryStrategy: (times) => (times > 2 ? null : Math.min(times * 100, 1000)),
    });
    await client.connect();
    // Health check: ping — fail-fast
    const pong = await client.ping();
    if (pong !== 'PONG') throw new Error(`redis ping natijasi: ${String(pong).slice(0, 20)}`);
    const store = new RedisStore({ client, prefix: SESSION_PREFIX });
    log.info?.('Redis session store connected');
    return {
      store,
      client,
      redisOk: true,
      close: async () => {
        try {
          await client.quit();
        } catch (_) { /* non-critical */ }
      },
    };
  } catch (err) {
    log.warn?.({ err: err.message }, 'Redis session store mavjud emas — MemoryStore fallback');
    return { store: new session.MemoryStore(), client: null, redisOk: false, close: async () => {} };
  }
}
