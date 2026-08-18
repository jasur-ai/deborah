/**
 * Edikit — Cast Resilience & Network Service (C4-02)
 * ---------------------------------------------------
 * Hybrid va low-bandwidth mode support.
 *
 * - Delivery type: in_room | remote | hybrid (participant record'da).
 * - Network quality buckets (item 8): answer record'dan ALOHIDA telemetry.
 * - Technical failure vs no-response alohida (item 9).
 * - In-room/remote coverage split (item 14).
 * - Delivery fingerprint (item 15) — report'ga qo'shiladi.
 * - Remote network issue → wrong answer EMAS (tugallanish sharti).
 */

import {
  DELIVERY_TYPES,
  NETWORK_BUCKETS,
  NETWORK_BUCKET_THRESHOLDS,
} from '../../utils/cast-constants.js';

export { DELIVERY_TYPES, NETWORK_BUCKETS };

/**
 * Resolve delivery type from config + participant join choice.
 * Remote participant o'zini remote deb belgilaydi (join payload).
 * @param {object} config — session config
 * @param {string} [declaredDelivery] — participant join'dagi delivery type
 * @returns {string} in_room | remote
 */
export function resolveParticipantDelivery(config, declaredDelivery) {
  const delivery = config?.participation?.delivery || DELIVERY_TYPES.IN_ROOM;
  if (delivery === DELIVERY_TYPES.REMOTE) return DELIVERY_TYPES.REMOTE;
  if (delivery === DELIVERY_TYPES.HYBRID) {
    // Hybrid: declared 'remote' bo'lsa remote, aks holda in_room
    return declaredDelivery === DELIVERY_TYPES.REMOTE ? DELIVERY_TYPES.REMOTE : DELIVERY_TYPES.IN_ROOM;
  }
  return DELIVERY_TYPES.IN_ROOM;
}

/**
 * Bucket network quality (item 8).
 * Pure — server-side telemetry bucketlama.
 *
 * @param {object} sample
 * @param {number} sample.latencyMs — round-trip latency (0 bo'lsa noma'lum)
 * @param {number} sample.lossPercent — packet loss percent
 * @param {number} sample.sampleCount — so'nggi davrdagi sinovlar soni
 * @returns {string} good | degraded | poor | unknown
 */
export function bucketNetworkQuality({ latencyMs = 0, lossPercent = 0, sampleCount = 0 } = {}) {
  if (!sampleCount || (latencyMs <= 0 && lossPercent <= 0)) return 'unknown';
  const t = NETWORK_BUCKET_THRESHOLDS;
  if (latencyMs > t.POOR_LATENCY_MS || lossPercent >= t.POOR_LOSS_PERCENT) return NETWORK_BUCKETS.POOR;
  if (latencyMs >= t.DEGRADED_LATENCY_MS || lossPercent >= t.DEGRADED_LOSS_PERCENT) return NETWORK_BUCKETS.DEGRADED;
  return NETWORK_BUCKETS.GOOD;
}

/**
 * Network bucket → report label (item 8).
 */
export function networkBucketLabel(bucket) {
  const labels = {
    good: 'good',
    degraded: 'degraded',
    poor: 'poor',
    unknown: 'unknown',
  };
  return labels[bucket] || 'unknown';
}

/**
 * Delivery fingerprint (item 15) — report/reportga qo'shiladigan stable key.
 * Delivery konfiguratsiyasining o'zgarishi fingerprint'ni o'zgartiradi.
 * @returns {string}
 */
export function deliveryFingerprint(config = {}) {
  const participation = config?.participation || {};
  const resilience = config?.resilience || {};
  const parts = [
    participation.delivery || DELIVERY_TYPES.IN_ROOM,
    participation.paperCardMode ? 'paper' : 'device',
    resilience.reconnectGraceMs ?? 120000,
    resilience.networkTelemetry !== false ? 'net' : 'no-net',
    resilience.lowBandwidth?.enabled ? 'lbw' : 'full',
  ];
  return parts.join('|');
}

/**
 * Technical failure classification (item 9).
 * Remote participant: network bucket poor/degraded + no answer → technical_failure
 * (wrong answer EMAS). In-room: no answer + online → no_response.
 *
 * @param {object} input
 * @param {object} input.participant — { delivery, networkBucket, presence, late }
 * @param {boolean} input.hasAnswer
 * @returns {string} 'accepted' | 'late_join' | 'disconnected' | 'technical_failure' | 'no_response'
 */
export function classifyStatus({ participant = {}, hasAnswer = false }) {
  if (hasAnswer) return 'accepted';
  if (participant.late) return 'late_join';
  if (participant.presence === 'offline') return 'disconnected';
  // Remote + degraded/poor network + no answer → technical failure
  const remote = participant.delivery === DELIVERY_TYPES.REMOTE;
  const bucket = participant.networkBucket;
  if (remote && (bucket === NETWORK_BUCKETS.POOR || bucket === NETWORK_BUCKETS.DEGRADED)) {
    return 'technical_failure';
  }
  return 'no_response';
}

/**
 * In-room / remote coverage split (item 14).
 * @param {object} participants — {pid: participant}
 * @returns {{ inRoom: {total, active, answered}, remote: {total, active, answered}, coverage: object }}
 */
export function splitCoverageByDelivery(participants = {}, answers = {}) {
  const inRoom = { total: 0, active: 0, answered: 0 };
  const remote = { total: 0, active: 0, answered: 0 };
  for (const [pid, p] of Object.entries(participants || {})) {
    const bucket = p.delivery === DELIVERY_TYPES.REMOTE ? remote : inRoom;
    bucket.total++;
    if (p.presence !== 'offline') bucket.active++;
    if (answers[pid]) bucket.answered++;
  }
  return {
    inRoom: { ...inRoom, responseRate: inRoom.total ? Math.round((inRoom.answered / inRoom.total) * 100) : 0 },
    remote: { ...remote, responseRate: remote.total ? Math.round((remote.answered / remote.total) * 100) : 0 },
    coverage: {
      inRoom: inRoom.total ? Math.round((inRoom.active / inRoom.total) * 100) : 0,
      remote: remote.total ? Math.round((remote.active / remote.total) * 100) : 0,
    },
  };
}

/**
 * Low-bandwidth policy helper (item 10/11): media derivative va payload.
 */
export function lowBandwidthPolicy(config = {}) {
  const lbw = config?.resilience?.lowBandwidth || {};
  return {
    enabled: !!lbw.enabled,
    decorativeEventsOff: lbw.decorativeEventsOff !== false,
    maxMediaKb: lbw.maxMediaKb ?? 120,
  };
}

export default {
  DELIVERY_TYPES,
  NETWORK_BUCKETS,
  resolveParticipantDelivery,
  bucketNetworkQuality,
  networkBucketLabel,
  deliveryFingerprint,
  classifyStatus,
  splitCoverageByDelivery,
  lowBandwidthPolicy,
};
