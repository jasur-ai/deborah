/**
 * Deborah — Socket.io Rate Limiter Middleware
 *
 * Two-layer rate limiting for Socket.io:
 *   1. Per-IP connection limiting (max N connections / 60s)
 *   2. Per-socket event throttling (max N events / window)
 *
 * Usage:
 *   import { createSocketRateLimiter } from './middleware/socket-rate-limiter.js';
 *   const rl = createSocketRateLimiter();
 *   rl.apply(io);
 *   setupSocketHandlers(io, socket, rl);
 */

import { createEventRateLimiter, createConnectionRateLimiter } from '../src/config/rate-limiter.js';
import { getLogger } from '../src/config/logger.js';

export function createSocketRateLimiter() {
  const connLimiter = createConnectionRateLimiter();
  const eventCounters = createEventRateLimiter();

  /**
   * Apply connection rate limiting to a Socket.io server (io.use middleware).
   * Event rate limiting is applied via wrap() in each handler registration.
   */
  function apply(io) {
    const log = getLogger();

    // ── Layer 1: Connection rate limiting (io.use middleware) ──
    io.use((socket, next) => {
      const ip = socket.handshake.address || socket.conn?.remoteAddress || 'unknown';
      const result = connLimiter.register(ip);

      if (!result.allowed) {
        log.warn({
          event: 'socket:rate:connection_blocked',
          ip,
          current: result.current,
          resetMs: result.resetMs,
        }, `Connection blocked (rate limit): ${ip}`);
        return next(new Error(`Rate limited. Try again in ${Math.ceil(result.resetMs / 1000)}s.`));
      }

      socket._rateLimitIp = ip;
      next();
    });
  }

  /**
   * Wrap a socket event handler with per-event rate limiting.
   * Usage: socket.on('player:answer', rl.wrap('player:answer', handler));
   */
  function wrap(eventName, handler) {
    const counter = eventCounters[eventName];
    if (!counter) return handler; // No limit configured — pass through

    return function wrappedHandler(data, ackCallback) {
      const socketId = this?.id || 'unknown';
      const result = counter.check(socketId);

      if (!result.allowed) {
        getLogger().warn({
          event: `socket:rate:${eventName}`,
          socketId,
          remaining: result.remaining,
          resetMs: result.resetMs,
        }, `Event rate limited: ${eventName} (${socketId})`);

        if (typeof ackCallback === 'function') {
          return ackCallback({
            status: 'error',
            code: 'RATE_LIMITED',
            message: `Too many requests. Try again in ${Math.ceil(result.resetMs / 1000)}s.`,
          });
        }

        try { this?.emit?.('error', { code: 'RATE_LIMITED', message: `Too many ${eventName} requests.` }); } catch (_) {}
        return;
      }

      return handler.call(this, data, ackCallback);
    };
  }

  /**
   * Clean up connection record on socket disconnect.
   */
  function onDisconnect(socket) {
    if (socket._rateLimitIp) {
      connLimiter.unregister(socket._rateLimitIp);
    }
  }

  /**
   * Get rate limit stats for health/status endpoint.
   */
  function getStats() {
    const stats = { connections: connLimiter.size, events: {} };
    for (const [event, counter] of Object.entries(eventCounters)) {
      stats.events[event] = counter.size;
    }
    return stats;
  }

  /**
   * Reset all rate limiters (for testing).
   */
  function reset() {
    connLimiter.clear();
    for (const counter of Object.values(eventCounters)) counter.clear();
  }

  return { apply, wrap, onDisconnect, getStats, reset };
}
