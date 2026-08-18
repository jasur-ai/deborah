/**
 * Edikit — Cast Analytics Event Pipeline (C5-04)
 * -----------------------------------------------
 * Product/reliability analytics — structured, PII-minimized eventlar.
 *
 * Boshqaruv tamoyillari:
 * - Raw academic response telemetry pipeline'ga KIRMAYDI (tugallanish sharti).
 * - Payload'da faqat pseudonymous IDs + latency bucket.
 * - Schema validationdan o'tmasa → DROP + safe metric (hech qachon crash emas).
 * - Provider unavailable bo'lsa → buffer/drop (live Castga ta'sir yo'q).
 * - Retention class event bilan birga yoziladi (aggregate — 395 kun).
 * - Teacher ranking metric YO'Q (item 12).
 */

import { bucketNetworkQuality } from './resilience-service.js';
import { DATA_CLASSES } from './data-policy.js';

export const ANALYTICS_VERSION = 'analytics_v1';
export const ANALYTICS_RETENTION_CLASS = DATA_CLASSES.AGGREGATE;

// ── Event taxonomy (item 1) ──
export const ANALYTICS_CATEGORIES = Object.freeze({
  SETUP: 'setup',
  LOBBY: 'lobby',
  QUESTION: 'question',
  PEDAGOGIC: 'pedagogic',
  RECOVERY: 'recovery',
});

export const ANALYTICS_EVENTS = Object.freeze({
  // Setup (item 2)
  SETUP_OPENED: 'setup_opened',
  MODE_SELECTED: 'mode_selected',
  SETTING_CHANGED: 'setting_changed',
  WARNING_SHOWN: 'warning_shown',
  WARNING_RESOLVED: 'warning_resolved',
  VALIDATED: 'validated',
  CREATED: 'created',
  // Lobby (item 3)
  JOINED: 'joined',
  REJOINED: 'rejoined',
  REJECTED: 'rejected',
  LOCKED: 'lobby_locked',
  REMOVED: 'removed',
  STARTED: 'started',
  // Question (item 4)
  PREVIEWED: 'previewed',
  OPENED: 'opened',
  READY: 'ready',
  SUBMITTED: 'submitted',
  ACKNOWLEDGED: 'acknowledged',
  EXTENDED: 'extended',
  PAUSED: 'paused',
  LOCKED_Q: 'locked_q',
  REVEALED: 'revealed',
  // Pedagogic (item 5)
  CONFIDENCE: 'confidence',
  DISCUSSION: 'discussion',
  REVOTE: 'revote',
  HINT: 'hint',
  RETEACH: 'reteach',
  TRANSFER: 'transfer',
  MISCONCEPTION: 'misconception',
  QUICK_PROMPT: 'quick_prompt',
  REDEMPTION: 'redemption',
  // Recovery (item 6)
  DISCONNECTED: 'disconnected',
  RECONNECT_ATTEMPTED: 'reconnect_attempted',
  STATE_RECOVERED: 'state_recovered',
  SNAPSHOT_LOADED: 'snapshot_loaded',
  PENDING_ANSWER_RETRIED: 'pending_answer_retried',
  HOST_TAKEOVER: 'host_takeover',
});

/** Category → event turlari mapping. */
export const EVENT_CATEGORY_MAP = Object.freeze({
  [ANALYTICS_EVENTS.SETUP_OPENED]: ANALYTICS_CATEGORIES.SETUP,
  [ANALYTICS_EVENTS.MODE_SELECTED]: ANALYTICS_CATEGORIES.SETUP,
  [ANALYTICS_EVENTS.SETTING_CHANGED]: ANALYTICS_CATEGORIES.SETUP,
  [ANALYTICS_EVENTS.WARNING_SHOWN]: ANALYTICS_CATEGORIES.SETUP,
  [ANALYTICS_EVENTS.WARNING_RESOLVED]: ANALYTICS_CATEGORIES.SETUP,
  [ANALYTICS_EVENTS.VALIDATED]: ANALYTICS_CATEGORIES.SETUP,
  [ANALYTICS_EVENTS.CREATED]: ANALYTICS_CATEGORIES.SETUP,
  [ANALYTICS_EVENTS.JOINED]: ANALYTICS_CATEGORIES.LOBBY,
  [ANALYTICS_EVENTS.REJOINED]: ANALYTICS_CATEGORIES.LOBBY,
  [ANALYTICS_EVENTS.REJECTED]: ANALYTICS_CATEGORIES.LOBBY,
  [ANALYTICS_EVENTS.LOCKED]: ANALYTICS_CATEGORIES.LOBBY,
  [ANALYTICS_EVENTS.REMOVED]: ANALYTICS_CATEGORIES.LOBBY,
  [ANALYTICS_EVENTS.STARTED]: ANALYTICS_CATEGORIES.LOBBY,
  [ANALYTICS_EVENTS.PREVIEWED]: ANALYTICS_CATEGORIES.QUESTION,
  [ANALYTICS_EVENTS.OPENED]: ANALYTICS_CATEGORIES.QUESTION,
  [ANALYTICS_EVENTS.READY]: ANALYTICS_CATEGORIES.QUESTION,
  [ANALYTICS_EVENTS.SUBMITTED]: ANALYTICS_CATEGORIES.QUESTION,
  [ANALYTICS_EVENTS.ACKNOWLEDGED]: ANALYTICS_CATEGORIES.QUESTION,
  [ANALYTICS_EVENTS.EXTENDED]: ANALYTICS_CATEGORIES.QUESTION,
  [ANALYTICS_EVENTS.PAUSED]: ANALYTICS_CATEGORIES.QUESTION,
  [ANALYTICS_EVENTS.LOCKED_Q]: ANALYTICS_CATEGORIES.QUESTION,
  [ANALYTICS_EVENTS.REVEALED]: ANALYTICS_CATEGORIES.QUESTION,
  [ANALYTICS_EVENTS.CONFIDENCE]: ANALYTICS_CATEGORIES.PEDAGOGIC,
  [ANALYTICS_EVENTS.DISCUSSION]: ANALYTICS_CATEGORIES.PEDAGOGIC,
  [ANALYTICS_EVENTS.REVOTE]: ANALYTICS_CATEGORIES.PEDAGOGIC,
  [ANALYTICS_EVENTS.HINT]: ANALYTICS_CATEGORIES.PEDAGOGIC,
  [ANALYTICS_EVENTS.RETEACH]: ANALYTICS_CATEGORIES.PEDAGOGIC,
  [ANALYTICS_EVENTS.TRANSFER]: ANALYTICS_CATEGORIES.PEDAGOGIC,
  [ANALYTICS_EVENTS.MISCONCEPTION]: ANALYTICS_CATEGORIES.PEDAGOGIC,
  [ANALYTICS_EVENTS.QUICK_PROMPT]: ANALYTICS_CATEGORIES.PEDAGOGIC,
  [ANALYTICS_EVENTS.REDEMPTION]: ANALYTICS_CATEGORIES.PEDAGOGIC,
  [ANALYTICS_EVENTS.DISCONNECTED]: ANALYTICS_CATEGORIES.RECOVERY,
  [ANALYTICS_EVENTS.RECONNECT_ATTEMPTED]: ANALYTICS_CATEGORIES.RECOVERY,
  [ANALYTICS_EVENTS.STATE_RECOVERED]: ANALYTICS_CATEGORIES.RECOVERY,
  [ANALYTICS_EVENTS.SNAPSHOT_LOADED]: ANALYTICS_CATEGORIES.RECOVERY,
  [ANALYTICS_EVENTS.PENDING_ANSWER_RETRIED]: ANALYTICS_CATEGORIES.RECOVERY,
  [ANALYTICS_EVENTS.HOST_TAKEOVER]: ANALYTICS_CATEGORIES.RECOVERY,
});

// ── Allowed scalar keys (item 8: PII / answer key / token REJECT) ──
// Raw answer/open text, answer key, full name, email, accommodation, tokenlar
// bu ro'yxatda EMAS → validation rad etadi.
export const ANALYTICS_ALLOWED_KEYS = new Set([
  // Identifikatsiya (pseudonymous only)
  'sessionId', 'actorKey', 'presetId',
  // Timing / latency
  'ms', 'latencyMs', 'retries', 'attemptNo', 'phase', 'reason',
  // Metadata
  'delivery', 'mode', 'setting', 'questionId', 'count', 'p95Ms',
  'revoteGain', 'timeoutCount', 'recoveryCount', 'a11yUsed', 'teacherActionCount',
  'category', 'type', 'at', 'retentionClass', 'version',
  // Buckets
  'bucket', 'setupMs', 'joinMs', 'ackMs',
]);

// ── Forbidden payload patterns (PII / answer key fixture rejection) ──
export const ANALYTICS_FORBIDDEN_PATTERNS = [
  /password/i,
  /token/i,
  /secret/i,
  /api[_ -]?key/i,
  /private[_ -]?key/i,
  /email/i,
  /phone/i,
  /passport/i,
  /answer[_ -]?key/i,
  /correct[_ -]?answer/i,
  /selectedOptionIds/i,
  /optionIds/i,
  /full[_ -]?name/i,
  /accommodation/i,
  /raw[_ -]?text/i,
  /storedText/i,
];

// ── Schema validation (item 9) ──
// Validationdan o'tmasa DROP + safe metric (crash emas).
export function validateAnalyticsEvent(ev) {
  const errors = [];
  if (!ev || typeof ev !== 'object') return { ok: false, errors: ['NOT_OBJECT'] };
  if (!ev.type) {
    errors.push('UNKNOWN_EVENT_TYPE');
  } else {
    // type ham KEY (SETUP_OPENED) ham VALUE (setup_opened) shaklida berilishi mumkin
    const upper = String(ev.type).toUpperCase();
    if (!Object.values(ANALYTICS_EVENTS).includes(ev.type) && !ANALYTICS_EVENTS[upper]) {
      errors.push('UNKNOWN_EVENT_TYPE');
    }
  }
  if (!ev.sessionId || typeof ev.sessionId !== 'string' || ev.sessionId.length > 64) {
    errors.push('INVALID_SESSION_ID');
  }
  if (ev.at !== undefined && typeof ev.at !== 'number') errors.push('INVALID_AT');
  // Allowed keys
  for (const key of Object.keys(ev || {})) {
    if (key === 'type' || key === 'at' || key === 'sessionId') continue;
    if (!ANALYTICS_ALLOWED_KEYS.has(key)) errors.push(`DISALLOWED_KEY:${key}`);
  }
  // Forbidden patterns (string values)
  const payloadStr = JSON.stringify(ev);
  for (const re of ANALYTICS_FORBIDDEN_PATTERNS) {
    if (re.test(payloadStr)) errors.push(`FORBIDDEN:${re.source}`);
  }
  return { ok: errors.length === 0, errors };
}

/**
 * Event yaratish — pseudonymous IDs + latency bucket (item 7).
 * @param {object} input
 * @param {string} input.type — ANALYTICS_EVENTS'dan
 * @param {string} input.sessionId
 * @param {object} [input.meta] — allowed scalar fields
 * @param {object} [input.network] — {latencyMs, lossPercent, sampleCount}
 * @returns {object} analytics event
 */
export function buildAnalyticsEvent({ type, sessionId, meta = {}, network = {}, at = Date.now() }) {
  const ev = {
    type,
    sessionId,
    at,
    retentionClass: ANALYTICS_RETENTION_CLASS,
    version: ANALYTICS_VERSION,
  };
  // Latency bucket (item 7) — faqat bucket, raw latency emas (PII-minimized)
  const bucket = bucketNetworkQuality({
    latencyMs: network.latencyMs || 0,
    lossPercent: network.lossPercent || 0,
    sampleCount: network.sampleCount || 0,
  });
  if (bucket !== 'unknown') ev.bucket = bucket;
  // Allowed scalar meta'lar
  for (const [k, v] of Object.entries(meta || {})) {
    if (ANALYTICS_ALLOWED_KEYS.has(k) && (v === null || ['string', 'number', 'boolean'].includes(typeof v))) {
      ev[k] = v;
    }
  }
  return ev;
}

// ── Buffer / drop policy (item 13) ──
// Provider unavailable bo'lsa live Castga ta'sir qilmasdan buffer/drop.
const MAX_BUFFER_SIZE = 500;
export class AnalyticsBuffer {
  constructor({ maxSize = MAX_BUFFER_SIZE } = {}) {
    this.items = [];
    this.maxSize = maxSize;
    this.dropped = 0;
    this.accepted = 0;
  }
  push(ev) {
    if (this.items.length >= this.maxSize) {
      this.dropped++; // overflow — drop + safe metric
      return { ok: false, reason: 'BUFFER_FULL' };
    }
    this.items.push(ev);
    this.accepted++;
    return { ok: true };
  }
  drain() {
    const out = this.items;
    this.items = [];
    return out;
  }
  size() { return this.items.length; }
  stats() { return { buffered: this.items.length, accepted: this.accepted, dropped: this.dropped }; }
}

/**
 * Safe emit — provider mavjud bo'lsa yuboradi, yo'q bo'lsa buffer/drop.
 * Hech qachon throw qilmaydi (live Castga ta'sir yo'q).
 * @param {AnalyticsBuffer} buffer
 * @param {object} ev — valid analytics event
 * @param {Function} [providerSend] — async (events) => void
 */
export async function safeEmit(buffer, ev, providerSend = null) {
  const validated = validateAnalyticsEvent(ev);
  if (!validated.ok) {
    buffer.push({ ...ev, dropped: true, dropReason: validated.errors.join(',') });
    return { ok: false, reason: 'INVALID_EVENT', errors: validated.errors };
  }
  if (providerSend) {
    try {
      await providerSend([ev]);
      return { ok: true };
    } catch (_) {
      // Provider outage — buffer/drop, live Castga ta'sir yo'q
    }
  }
  return buffer.push(ev);
}

// ── Product metric dashboard (item 11) ──
// Item 12: teacher ranking metric YO'Q — faqat aggregate product metrics.
export function summarizeProductMetrics(events = []) {
  const valid = (events || []).filter((e) => validateAnalyticsEvent(e).ok);
  const byType = {};
  for (const e of valid) byType[e.type] = (byType[e.type] || 0) + 1;

  // Setup time (ms values from setup_opened → created)
  const setupTimes = valid.filter((e) => e.type === 'created' && typeof e.setupMs === 'number').map((e) => e.setupMs);

  // Launch success: created / validated
  const created = byType[ANALYTICS_EVENTS.CREATED] || 0;
  const validated = byType[ANALYTICS_EVENTS.VALIDATED] || 0;
  const launchSuccess = validated > 0 ? Math.round((created / validated) * 1000) / 10 : null;

  // Join latency (ms)
  const joinLatencies = valid.filter((e) => e.type === 'joined' && typeof e.joinMs === 'number').map((e) => e.joinMs);

  // ACK p95
  const ackMs = valid.filter((e) => typeof e.ackMs === 'number').map((e) => e.ackMs);
  const p95 = percentile(ackMs, 0.95);

  const recoveryCount = (byType[ANALYTICS_EVENTS.STATE_RECOVERED] || 0) + (byType[ANALYTICS_EVENTS.SNAPSHOT_LOADED] || 0);
  const timeoutCount = byType[ANALYTICS_EVENTS.PENDING_ANSWER_RETRIED] || 0;
  const teacherActionCount =
    (byType[ANALYTICS_EVENTS.MISCONCEPTION] || 0) +
    (byType[ANALYTICS_EVENTS.HINT] || 0) +
    (byType[ANALYTICS_EVENTS.RETEACH] || 0);
  const revoteCount = byType[ANALYTICS_EVENTS.REVOTE] || 0;
  const a11yUsed = valid.filter((e) => e.a11yUsed === true).length;

  return {
    version: ANALYTICS_VERSION,
    eventCount: valid.length,
    byType,
    setupTimeMsAvg: setupTimes.length ? Math.round(setupTimes.reduce((s, v) => s + v, 0) / setupTimes.length) : null,
    launchSuccessPercent: launchSuccess,
    joinLatencyAvgMs: joinLatencies.length ? Math.round(joinLatencies.reduce((s, v) => s + v, 0) / joinLatencies.length) : null,
    ackP95Ms: p95,
    recoveryCount,
    timeoutCount,
    teacherActionCount,
    revoteCount,
    a11yUsed,
    // Item 12: ranking metric yo'q
    rankingMetricAvailable: false,
  };
}

function percentile(values, q) {
  if (!values || values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil(q * sorted.length) - 1));
  return sorted[idx];
}

/** Event count dedupe (test: bir xil eventId ikki marta hisoblanmaydi). */
export function dedupeEvents(events = []) {
  const seen = new Set();
  const out = [];
  for (const e of events) {
    const key = e.eventId || `${e.type}|${e.sessionId}|${e.at}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(e);
  }
  return out;
}

export default {
  ANALYTICS_VERSION,
  ANALYTICS_RETENTION_CLASS,
  ANALYTICS_CATEGORIES,
  ANALYTICS_EVENTS,
  EVENT_CATEGORY_MAP,
  ANALYTICS_ALLOWED_KEYS,
  ANALYTICS_FORBIDDEN_PATTERNS,
  validateAnalyticsEvent,
  buildAnalyticsEvent,
  AnalyticsBuffer,
  safeEmit,
  summarizeProductMetrics,
  dedupeEvents,
};
