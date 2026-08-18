/**
 * Deborah — Cast Backpressure & Degradation Service (C5-07)
 * --------------------------------------------------------
 * Saturation paytida answer/host command prioritetda qoladi; decorative
 * update (P3) kamayadi. Tugallanish sharti: degraded mode'da accepted-answer
 * ground truth yo'qolmaydi.
 *
 * Priority enum (item 1):
 *   P0 — answer durability/ACK + safety/host command (hech qachon drop qilinmaydi)
 *   P1 — state/recovery
 *   P2 — aggregate counters (evidence, leaderboard refresh)
 *   P3 — animation/reaction/analytics (drop/coalesce mumkin)
 *
 * Thresholdlar (item 2):
 *   T1 — aggregate refresh sekinlashadi (throttle)
 *   T2 — P3 eventlar drop/coalesce
 *   T3 — new large-lobby admission queue
 */

// ── Event priority enum (item 1) ──
export const EVENT_PRIORITY = Object.freeze({
  P0: 0, // answer durability/ACK, safety/host command
  P1: 1, // state/recovery
  P2: 2, // aggregate counters
  P3: 3, // animation/reaction/analytics
});

// ── Default thresholds (item 2) ──
export const DEFAULT_THRESHOLDS = Object.freeze({
  queueDepthT1: 100,  // T1 — aggregate throttle boshlanadi
  queueDepthT2: 400,  // T2 — P3 drop boshlanadi
  queueDepthT3: 800,  // T3 — large-lobby admission queue
  lagMsT1: 250,       // event-loop lag (ms) — T1 boshlanadi
  lagMsT2: 1000,      // lag — T2 boshlanadi
});

/**
 * Command/event → priority mapping (socket command types + event types).
 * Noma'lum → P2 (safe default).
 */
export function classifyPriority(type) {
  const s = String(type || '');
  // P0: answer + host/safety commands — hech qachon drop qilinmaydi
  if (
    /answer|submit/i.test(s) ||
    /close|reveal|pause|resume|start|next|end|lock|block|remove|rotate|wallModerate|hingeDecision|misconception|transfer|poe|orb|quickPrompt/i.test(s)
  ) return EVENT_PRIORITY.P0;
  // P1: state/recovery
  if (/state|recover|snapshot|reconnect|join|rejoin|presence/i.test(s)) return EVENT_PRIORITY.P1;
  // P3: decorative/analytics
  if (/animation|reaction|analytics|confetti|sound|emoji|telemetry/i.test(s)) return EVENT_PRIORITY.P3;
  return EVENT_PRIORITY.P2;
}

/**
 * Degradation level hisoblash (item 3/4/5).
 * @param {object} metrics — { queueDepth:number, lagMs:number }
 * @returns {string} 'normal' | 'degraded1' | 'degraded2' | 'admission_queue'
 */
export function degradationLevel({ queueDepth = 0, lagMs = 0 } = {}) {
  const t = DEFAULT_THRESHOLDS;
  if (queueDepth >= t.queueDepthT3 || lagMs >= t.lagMsT2 * 2) return 'admission_queue';
  if (queueDepth >= t.queueDepthT2 || lagMs >= t.lagMsT2) return 'degraded2';
  if (queueDepth >= t.queueDepthT1 || lagMs >= t.lagMsT1) return 'degraded1';
  return 'normal';
}

/**
 * Threshold 1: aggregate refresh sekinlashtiriladimi? (item 3)
 * P0/P1 ta'sirlanmaydi — faqat P2 aggregate.
 */
export function shouldThrottleAggregate(level, priority = EVENT_PRIORITY.P2) {
  if (level === 'degraded1') return priority >= EVENT_PRIORITY.P2;
  if (level === 'degraded2' || level === 'admission_queue') return true;
  return false;
}

/**
 * Threshold 2: P3 event drop qilinadimi? (item 4)
 * P0/P1/P2 hech qachon drop qilinmaydi — faqat P3.
 */
export function shouldDrop(level, priority = EVENT_PRIORITY.P3) {
  if (priority !== EVENT_PRIORITY.P3) return false; // P0/P1/P2 drop qilinmaydi
  return level === 'degraded2' || level === 'admission_queue';
}

/**
 * Threshold 3: new large-lobby admission qilinadimi? (item 5)
 * Kichik session'lar (<= smallLobbyLimit) o'tadi; katta session
 * admission_queue rejimida bloklanadi.
 * @param {number} participantCount — yangi sessiyaning taxminiy lobbisi
 */
export function shouldQueueAdmission(level, participantCount = 0, { smallLobbyLimit = 30 } = {}) {
  if (level !== 'admission_queue') return false;
  return participantCount > smallLobbyLimit;
}

/**
 * Queue depth + lag monitoring uchun metric snapshot (ops alert, item 11).
 */
export function backpressureSnapshot(metrics = {}) {
  const level = degradationLevel(metrics);
  return {
    level,
    queueDepth: metrics.queueDepth || 0,
    lagMs: metrics.lagMs || 0,
    droppingP3: shouldDrop(level, EVENT_PRIORITY.P3),
    throttlingAggregates: shouldThrottleAggregate(level, EVENT_PRIORITY.P2),
    admissionQueued: level === 'admission_queue',
    at: Date.now(),
  };
}

// ── Static leaderboard fallback (item 8) ──
/**
 * Degraded mode'da leaderboard'ni statik (oxirgi hisoblangan) holatda
 * ko'rsatish — jonli refresh o'chirilganda eski snapshot ko'rinadi.
 */
export function staticLeaderboardFallback({ live, lastSnapshot = null } = {}) {
  if (live !== undefined && lastSnapshot !== null) {
    return { live: !!live, entries: lastSnapshot.entries || [], hiddenCount: lastSnapshot.hiddenCount || 0, stale: !live };
  }
  return { live: false, entries: [], hiddenCount: 0, stale: true };
}

// ── Degradation audit (item 12) ──
/**
 * Degradation start/end safe audit event (identity/raw content YO'Q).
 * @returns {object} audit event
 */
export function degradationAuditEvent({ sessionId = null, action, level, metrics = {} } = {}) {
  return {
    type: `cast:degradation:${action}`, // start | end | throttle | drop | admission
    sessionId,
    level,
    queueDepth: metrics.queueDepth || 0,
    lagMs: metrics.lagMs || 0,
    droppedP3: metrics.droppedP3 || 0,
    at: Date.now(),
    safe: true,
  };
}

export default {
  EVENT_PRIORITY,
  DEFAULT_THRESHOLDS,
  classifyPriority,
  degradationLevel,
  shouldThrottleAggregate,
  shouldDrop,
  shouldQueueAdmission,
  backpressureSnapshot,
  staticLeaderboardFallback,
  degradationAuditEvent,
};
