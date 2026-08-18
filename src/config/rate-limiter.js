/**
 * Edikit — Rate Limiter Configuration
 *
 * Centralized rate limits for both HTTP and Socket.io.
 * HTTP uses express-rate-limit; Socket uses in-memory sliding window.
 *
 * Limits:
 *   HTTP:
 *     login:      20 req / 15 min (per IP)
 *     general:   100 req / 15 min (per IP) — POST/PUT/PATCH/DELETE
 *     admin-api:  60 req / 15 min (per IP) — /admin/api/*
 *     user-api:   60 req / 15 min (per IP) — /user/api/*
 *
 *   Socket:
 *     connection:  10 conn / 60 s  (per IP)
 *     player:answer: 20 / 60 s     (per socket)
 *     player:join:    10 / 60 s    (per socket)
 *     host:create:     5 / 60 s    (per socket)
 *     host:start:      5 / 60 s    (per socket)
 *     host:next:      10 / 60 s    (per socket)
 *     host:forceNext:  5 / 60 s    (per socket)
 *     host:end:        3 / 60 s    (per socket)
 *     player:checkCode: 30 / 60 s  (per socket)
 *     player:checkName: 30 / 60 s  (per socket)
 *     arena:botAnswer: 60 / 60 s   (per socket)
 *     arena:watch:     10 / 60 s   (per socket)
 */

// ── HTTP Rate Limits (used by express-rate-limit) ──

export const HTTP_LIMITS = {
  /** Login endpoint — prevent brute force */
  login: {
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 20,
    message: { error: "Ko'p urinish. Iltimos, 15 daqiqa kuting." },
    skip: (req) => req.method !== 'POST',
  },

  /** AUTH A-30 §08: Admin login — qattiqroq. QATTIQ himoya failure-based
   *  lockout (3 xato → 15 daqiqa, admin-security.js) — bu yerda tarmoq
   *  backstop (request-based 10/15; 3 request yetarli emas — legit admin
   *  ham OTP xatosini takrorlashi mumkin). */
  adminLogin: {
    windowMs: 15 * 60 * 1000,
    max: 10,
    message: { error: "Ko'p urinish. Iltimos, 15 daqiqa kuting." },
    skip: (req) => req.method !== 'POST',
  },

  /** General API — all state-changing endpoints */
  general: {
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100,
    message: { error: 'So\'rovlar limiti tugadi. Birozdan keyin urinib ko\'ring.' },
  },

  /** Admin API — /admin/api/* */
  adminApi: {
    windowMs: 15 * 60 * 1000,
    max: 60,
    message: { error: 'Admin API limiti tugadi.' },
  },

  /** User API — /user/api/* */
  userApi: {
    windowMs: 15 * 60 * 1000,
    max: 60,
    message: { error: 'API limiti tugadi. Birozdan keyin urinib ko\'ring.' },
  },
};

// ── Socket.io Rate Limits ──

export const SOCKET_LIMITS = {
  /** Per-IP connection limit */
  connection: {
    windowMs: 60 * 1000,  // 60 seconds
    max: 10,              // max 10 connections per IP
  },

  /** Per-socket event limits (events per 60 seconds) */
  events: {
    'player:answer':   { max: 20,  windowMs: 60 * 1000 },
    'player:join':     { max: 10,  windowMs: 60 * 1000 },
    'player:rejoin':   { max: 10,  windowMs: 60 * 1000 },
    'player:checkCode':{ max: 30,  windowMs: 60 * 1000 },
    'player:checkName':{ max: 30,  windowMs: 60 * 1000 },
    'host:create':     { max: 5,   windowMs: 60 * 1000 },
    'host:start':      { max: 5,   windowMs: 60 * 1000 },
    'host:next':       { max: 10,  windowMs: 60 * 1000 },
    'host:forceNext':  { max: 5,   windowMs: 60 * 1000 },
    'host:end':        { max: 3,   windowMs: 60 * 1000 },
    'arena:botAnswer': { max: 60,  windowMs: 60 * 1000 },
    'arena:watch':     { max: 10,  windowMs: 60 * 1000 },
    'arena:leave':     { max: 10,  windowMs: 60 * 1000 },
  },
};

// ── Sliding window rate limiter for Socket.io ──

class SlidingWindowCounter {
  constructor(max, windowMs) {
    this.max = max;
    this.windowMs = windowMs;
    /** Map<key, Array<timestamp>> — timestamps of recent hits */
    this._buckets = new Map();
  }

  /** Check if key is allowed. If allowed, record the hit. Returns { allowed, remaining, resetMs } */
  check(key) {
    const now = Date.now();
    const cutoff = now - this.windowMs;

    let timestamps = this._buckets.get(key);
    if (!timestamps) {
      timestamps = [];
      this._buckets.set(key, timestamps);
    }

    // Prune old entries
    while (timestamps.length > 0 && timestamps[0] < cutoff) {
      timestamps.shift();
    }

    const remaining = this.max - timestamps.length;

    if (remaining <= 0) {
      // Calculate when the bucket resets (oldest timestamp + window)
      const resetMs = timestamps.length > 0
        ? (timestamps[0] + this.windowMs) - now
        : this.windowMs;
      return { allowed: false, remaining: 0, resetMs: Math.max(resetMs, 1000) };
    }

    // Record this hit
    timestamps.push(now);
    return { allowed: true, remaining: remaining - 1, resetMs: 0 };
  }

  /** Get the number of tracked keys (for testing/debugging) */
  get size() {
    return this._buckets.size;
  }

  /** Clear all buckets (for testing) */
  clear() {
    this._buckets.clear();
  }
}

// ── Per-IP connection counter (separate from event limiter) ──

class ConnectionCounter {
  constructor(max, windowMs) {
    this.max = max;
    this.windowMs = windowMs;
    this._connections = new Map();
  }

  /** Register a new connection from IP. Returns { allowed, current } */
  register(ip) {
    const now = Date.now();
    const cutoff = now - this.windowMs;

    let entries = this._connections.get(ip);
    if (!entries) {
      entries = [];
      this._connections.set(ip, entries);
    }

    // Prune old entries
    while (entries.length > 0 && entries[0] < cutoff) {
      entries.shift();
    }

    if (entries.length >= this.max) {
      const resetMs = entries.length > 0
        ? (entries[0] + this.windowMs) - now
        : this.windowMs;
      return { allowed: false, current: entries.length, resetMs: Math.max(resetMs, 1000) };
    }

    entries.push(now);
    return { allowed: true, current: entries.length, resetMs: 0 };
  }

  /** Remove a connection record (on disconnect) */
  unregister(ip) {
    const entries = this._connections.get(ip);
    if (entries && entries.length > 0) {
      entries.pop(); // Remove the most recent entry (FIFO)
      if (entries.length === 0) {
        this._connections.delete(ip);
      }
    }
  }

  /** Get the number of tracked IPs (for testing) */
  get size() {
    return this._connections.size;
  }

  /** Clear all IP connection records (for testing) */
  clear() {
    this._connections.clear();
  }
}

// ── Singleton exports ──

export function createEventRateLimiter() {
  const counters = {};
  for (const [event, cfg] of Object.entries(SOCKET_LIMITS.events)) {
    counters[event] = new SlidingWindowCounter(cfg.max, cfg.windowMs);
  }
  return counters;
}

export function createConnectionRateLimiter() {
  const cfg = SOCKET_LIMITS.connection;
  return new ConnectionCounter(cfg.max, cfg.windowMs);
}

export { SlidingWindowCounter, ConnectionCounter };
