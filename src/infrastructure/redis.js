/**
 * Edikit — Redis Infrastructure
 *
 * Provides:
 *   1. Redis client (ioredis) with lifecycle
 *   2. Health check
 *   3. Graceful shutdown
 *
 * Gracefully degrades if REDIS_URL is not configured.
 * All functions are async-safe — the ioredis module is loaded on first access.
 */

import CONFIG from '../config/env.js';

let _redis = undefined;
let _initAttempted = false;
let _redisModPromise = null;

/**
 * Lazy-load the ioredis module (called at most once).
 */
function getRedisModule() {
  if (!_redisModPromise) {
    _redisModPromise = import('ioredis').then(
      (mod) => mod.default || mod,
      (err) => {
        console.error('ioredis module load failed:', err.message);
        return null;
      }
    );
  }
  return _redisModPromise;
}

/**
 * Get the Redis client instance (singleton).
 * Returns null if REDIS_URL is not configured or module unavailable.
 */
export async function getRedis() {
  if (_initAttempted) return _redis ?? null;
  _initAttempted = true;

  if (!CONFIG.REDIS_URL) {
    _redis = undefined;
    return null;
  }

  try {
    const Redis = await getRedisModule();
    if (!Redis) {
      _redis = undefined;
      return null;
    }

    _redis = new Redis(CONFIG.REDIS_URL, {
      maxRetriesPerRequest: 3,
      retryStrategy(times) {
        if (times > 3) return null;
        return Math.min(times * 200, 2000);
      },
      lazyConnect: true,
    });

    _redis.on('error', (err) => {
      console.error('Redis client error:', err.message);
    });

    _redis.on('connect', () => {
      console.log('Redis connected');
    });

    _redis.on('close', () => {
      console.log('Redis connection closed');
    });

    return _redis;
  } catch (err) {
    console.error('Redis client creation failed:', err.message);
    _redis = undefined;
    return null;
  }
}

/**
 * Connect Redis lazily.
 */
export async function connectRedis() {
  const client = await getRedis();
  if (!client || client.status === 'ready') return;

  try {
    await client.connect();
  } catch (err) {
    console.error('Redis connect failed:', err.message);
  }
}

/**
 * Check Redis health by sending PING.
 */
export async function checkRedisHealth() {
  const client = await getRedis();
  if (!client) {
    return { ok: false, reason: 'redis not configured (REDIS_URL)' };
  }

  const start = Date.now();
  try {
    if (client.status !== 'ready') {
      await connectRedis();
    }
    const result = await client.ping();
    return { ok: result === 'PONG', latency: Date.now() - start };
  } catch (err) {
    return { ok: false, reason: err.message, latency: Date.now() - start };
  }
}

/**
 * Close Redis connection gracefully.
 */
export async function closeRedis() {
  if (_redis) {
    try {
      if (_redis.status === 'ready') {
        await _redis.quit();
      } else {
        _redis.disconnect();
      }
    } catch (_) {}
    _redis = undefined;
    _initAttempted = false;
    console.log('Redis connection closed');
  }
}
