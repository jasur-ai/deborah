/**
 * Edikit — Realtime / Multi-node Configuration (C5-06)
 * -----------------------------------------------------
 * Tier L va undan yuqori uchun multiple Socket.IO node, shared adapter va
 * durable state ishlashini ta'minlaydigan config + policy moduli.
 *
 * Environment contract:
 *   REALTIME_MODE=single|redis_streams
 *   REDIS_URL=redis://...
 *   SOCKET_RECOVERY_MAX_MS=120000
 *   CAST_NODE_ID=node-01
 *   CAST_MAX_TIER=XL
 */

import CONFIG from '../src/config/env.js';

export const REALTIME_MODES = {
  SINGLE: 'single',
  REDIS_STREAMS: 'redis_streams',
};

export const CAST_TIERS = ['S', 'M', 'L', 'XL', 'XXL'];

/** Tier → expected concurrent session scale (documentation + admission). */
export const TIER_SESSION_CAP = {
  S: 1,
  M: 5,
  L: 20,
  XL: 100,
  XXL: 500,
};

/**
 * Resolved realtime mode.
 * - redis_streams faqat REDIS_URL bilan ishlaydi (bo'lmasa → single fallback + warning).
 */
export function resolveRealtimeMode() {
  if (CONFIG.REALTIME_MODE === REALTIME_MODES.REDIS_STREAMS) {
    if (CONFIG.REDIS_URL) {
      return { mode: REALTIME_MODES.REDIS_STREAMS, degraded: false, reason: null };
    }
    return { mode: REALTIME_MODES.SINGLE, degraded: true, reason: 'REDIS_URL_MISSING' };
  }
  return { mode: REALTIME_MODES.SINGLE, degraded: false, reason: null };
}

/**
 * Redis mavjudmi? (session store ulanishi natijasidan kelib chiqadi)
 * C5-06 (item 14): Redis unavailable bo'lsa new XXL session admission BLOK.
 *
 * @param {object} opts — { redisOk:boolean }
 * @returns {{ admitted:boolean, reason:string|null, tier:boolean }}
 */
export function admissionPolicyForTier(tier = 'S', { redisOk = true } = {}) {
  const tierValid = CAST_TIERS.includes(tier);
  const t = tierValid ? tier : 'S';
  // TIER_SESSION_CAP — hujjatlashtirilgan session cap (admission hozircha faqat
  // XXL Redis talabini tekshiradi; cap monitoring uchun ishlatiladi).
  const sessionCap = TIER_SESSION_CAP[t] || TIER_SESSION_CAP.S;
  const needsRedis = t === 'XXL';
  if (needsRedis && !redisOk) {
    return {
      admitted: false,
      tier: t,
      sessionCap,
      reason: 'XXL_REQUIRES_REDIS',
      message: 'XXL tier faqat multi-node (redis_streams) rejimida ishlaydi. Redis unavailable — yoki REDIS_URL sozlang, yoki pastroq tier tanlang.',
    };
  }
  return { admitted: true, tier: t, sessionCap, reason: null, message: null };
}

/**
 * Connection-state recovery (item 5) — socket.io connectionStateRecovery config.
 * Faqat redis_streams rejimida (Redis session store ichida recovery data saqlanadi).
 */
export function connectionRecoveryConfig() {
  const { mode } = resolveRealtimeMode();
  // socket.io: connectionStateRecovery FALSE bo'lsa o'chiq; truthy object bo'lsa YOQILGAN.
  // { enabled:false, ... } truthy → recovery enable bo'lib qoladi. Shuning uchun
  // single-mode'da to'g'ridan-to'g'ri false qaytaramiz.
  if (mode === REALTIME_MODES.REDIS_STREAMS) {
    return { maxDisconnectionDuration: CONFIG.SOCKET_RECOVERY_MAX_MS };
  }
  return false;
}

/**
 * Sticky session policy (item 6) — long-polling yoqilgan bo'lsa LB sticky kerak.
 * WebSocket-only (item 7) — fallback yo'q, eski browser bloklanadi.
 */
export function lbPolicies() {
  const wsOnly = !!CONFIG.WEBSOCKET_ONLY;
  return {
    stickySessionsRequired: wsOnly ? false : (!!CONFIG.LB_STICKY_SESSIONS || false),
    websocketOnly: wsOnly,
    transports: wsOnly ? ['websocket'] : ['websocket', 'polling'],
    fallbackPolicy: wsOnly
      ? 'websocket_only: eski brauzer/network polling ishlata olmaydi — reconnect kerak'
      : 'polling_allowed: long-polling uchun load balancer STICKY_SESSIONS=true talab qilinadi',
  };
}

/**
 * Server boot log uchun realtime holati (item 1).
 */
export function realtimeStatus({ redisOk = false } = {}) {
  const { mode, degraded, reason } = resolveRealtimeMode();
  return {
    mode,
    degraded: degraded || (mode === REALTIME_MODES.REDIS_STREAMS && !redisOk),
    reason: reason || (mode === REALTIME_MODES.REDIS_STREAMS && !redisOk ? 'REDIS_UNAVAILABLE' : null),
    nodeId: CONFIG.CAST_NODE_ID,
    maxTier: CONFIG.CAST_MAX_TIER,
    recoveryMs: mode === REALTIME_MODES.REDIS_STREAMS ? CONFIG.SOCKET_RECOVERY_MAX_MS : 0,
    redisConfigured: !!CONFIG.REDIS_URL,
    ...lbPolicies(),
  };
}

export default {
  REALTIME_MODES,
  CAST_TIERS,
  TIER_SESSION_CAP,
  resolveRealtimeMode,
  admissionPolicyForTier,
  connectionRecoveryConfig,
  lbPolicies,
  realtimeStatus,
};
