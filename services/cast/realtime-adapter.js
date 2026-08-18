/**
 * Edikit — Realtime Adapter Factory (C5-06)
 * -------------------------------------------
 * Socket.IO adapter'ni REALTIME_MODE bo'yicha tanlaydi:
 *   - single          → adapter qo'shilmaydi (process-local rooms)
 *   - redis_streams   → @socket.io/redis-streams-adapter (shared rooms)
 *
 * Adapter'lar ixtiyoriy dependency — import muvaffaqiyatsiz bo'lsa
 * single-mode fallback + warning (live boot'ni buzmaydi).
 */

import { REALTIME_MODES, resolveRealtimeMode } from '../../config/realtime.js';

/**
 * Socket.IO Server'ga adapter qo'llash.
 *
 * @param {import('socket.io').Server} io — Socket.IO server
 * @param {object} opts — { redisClient }
 * @returns {Promise<{mode:string, adapterApplied:boolean, error:string|null, degraded:boolean}>}
 */
export async function applyRealtimeAdapter(io, { redisClient = null } = {}) {
  const { mode, degraded, reason } = resolveRealtimeMode();

  if (mode === REALTIME_MODES.SINGLE) {
    return {
      mode,
      adapterApplied: false,
      error: null,
      degraded: !!degraded,
      reason: reason || 'single-node: shared adapter kerak emas',
    };
  }

  // redis_streams
  if (!redisClient) {
    return {
      mode,
      adapterApplied: false,
      error: 'REDIS_CLIENT_MISSING',
      degraded: true,
      reason: 'redis_streams rejimi talab qiladi, lekin Redis client berilmagan',
    };
  }

  try {
    const { createAdapter } = await import('@socket.io/redis-streams-adapter');
    io.adapter(createAdapter(redisClient));
    return {
      mode,
      adapterApplied: true,
      error: null,
      degraded: false,
      reason: 'Redis Streams adapter ulandi — cross-node room broadcast',
    };
  } catch (err) {
    return {
      mode,
      adapterApplied: false,
      error: err.message || 'ADAPTER_IMPORT_FAILED',
      degraded: true,
      reason: '@socket.io/redis-streams-adapter o\x27rnatilmagan — single-node fallback',
    };
  }
}

export default { applyRealtimeAdapter };
