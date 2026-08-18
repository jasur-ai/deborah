/**
 * Deborah — Cast Observability (C5-08)
 * -----------------------------------
 * Live health metrics + PII-safe structured logs + support-bundle inputs.
 *
 * Privacy contract:
 *   - ANSWER KEY, raw response, open text, token, cookie, full URL, name/email
 *     va secretlar TELEMETRIYA/LOG'GA TUSHMAYDI (sanitizeLog before emit).
 *   - Trace/correlation ID (W3C traceparent) REST→Socket→store bo'ylab olib
 *     yuriladi — `withCorrelation` + `propagateTraceFromCommand`.
 *
 * PURE module: no socket/db imports — faqat hisob-kitob va sanitizatsiya.
 */

// ── Ring buffer (percentile hisoblash uchun) ──
export class RingBuffer {
  constructor(capacity = 500) {
    this.capacity = Math.max(16, capacity);
    this.buf = new Array(this.capacity);
    this.len = 0;
    this.head = 0;
  }
  push(v) {
    if (typeof v !== 'number' || !Number.isFinite(v)) return;
    this.buf[(this.head + this.len) % this.capacity] = v;
    if (this.len < this.capacity) this.len += 1;
    else this.head = (this.head + 1) % this.capacity;
  }
  values() {
    const out = [];
    for (let i = 0; i < this.len; i += 1) out.push(this.buf[(this.head + i) % this.capacity]);
    return out.sort((a, b) => a - b);
  }
  percentile(p) {
    const v = this.values();
    if (!v.length) return null;
    const idx = Math.min(v.length - 1, Math.max(0, Math.floor((p / 100) * v.length)));
    return v[idx];
  }
  p50() { return this.percentile(50); }
  p95() { return this.percentile(95); }
  p99() { return this.percentile(99); }
  get size() { return this.len; }
}

// ── Ack percentile buckets ──
export const ACK_BUCKETS = Object.freeze({
  answer: new RingBuffer(1000),
  host: new RingBuffer(500),
  join: new RingBuffer(500),
  state: new RingBuffer(500),
  other: new RingBuffer(500),
});

// ── Cast metric counters (monotonic, since boot) ──
export const METRIC_COUNTERS = Object.freeze({
  connections: 0,        // socket connection (join+director+projector)
  joins: 0,              // successful participant join
  rejoins: 0,            // reconnect/rejoin
  retries: 0,            // client retry (same commandId resend)
  duplicates: 0,         // duplicate command (already processed commandId)
  acks: 0,               // ACK sent
  ackErrors: 0,          // ACK with ok:false
  recovery: 0,           // connection state recovery attempts
  recoverySuccess: 0,
  eventDrops: 0,         // P3 analytics drops (backpressure)
  revisionDrifts: 0,     // expectedRevision mismatch
  failedRequests: 0,     // REST API 4xx/5xx
});

// Ring buffer for Redis lag / DB queue (sample-based gauges)
export const GAUGE_SAMPLES = Object.freeze({
  redisLagMs: new RingBuffer(300),
  dbQueueDepth: new RingBuffer(300),
  projectorStaleMs: new RingBuffer(300),
  moderationAgeMs: new RingBuffer(300),
});

// ── Structured log schema (item 2) ──
// Barcha cast log'lari shu schema'ga mos keladi; maydonlar sanitized.
export const LOG_SCHEMA = Object.freeze({
  v: 1,
  scope: 'cast',
  ts: 0,              // epoch ms
  traceId: null,      // correlation ID (W3C traceparent root)
  spanId: null,
  sessionId: null,
  command: null,      // cast:<type>
  actorRole: null,    // teacher | participant | system
  level: 'info',
  msg: '',
  meta: {},           // sanitized payload meta
});

/**
 * Build a structured cast log object.
 * @param {object} input — { level, msg, command, sessionId, actorRole, traceId, spanId, meta }
 */
export function buildLogEntry(input = {}) {
  return {
    ...LOG_SCHEMA,
    v: LOG_SCHEMA.v,
    scope: LOG_SCHEMA.scope,
    ts: Date.now(),
    level: input.level || 'info',
    msg: input.msg || '',
    command: input.command || null,
    sessionId: input.sessionId || null,
    actorRole: input.actorRole || null,
    traceId: input.traceId || null,
    spanId: input.spanId || null,
    meta: sanitizeLog(input.meta || {}),
  };
}

// ── Log sanitizer (item 3) ──
// Answer key, raw answer, open text, token, cookie, full URL, name/email,
// secret'larni redact qiladi. Keng qamrovli key-pattern + value scanner.
const SENSITIVE_KEYS = [
  /^(q?_?correct|correct_answer|answer_key|answerkey)$/i,
  /correct.*(index|option|answer)|answer.*(key|correct)/i,
  /^(raw_response|raw_body|raw|essay|submission_text|health_evidence|camera_frame|capture|response_text|open_text|text_answer)$/i,
  /(essay|response|evidence|submission|open)(_text|_body|_content)?$/i,
  /^(password|pass|secret|token|access_token|refresh_token|api_key|apikey|authorization|cookie|session_id|jwt|csrf|csrfToken)$/i,
  /(token|secret|apikey|api_key|password|credential|csrf)/i,
  /^(email|phone|address|passport|full_name|first_name|last_name|birth_date|student_name|name|fullName|firstName|lastName|studentName|birthDate|emailAddress)$/i,
  /url$/i, // full URL'lar path/query'da PII olib yurishi mumkin — redact
];

// Value scanner: tokenga o'xshash uzun tasodifiy stringlar redact
const TOKEN_LIKE = /^(eyJ[A-Za-z0-9_-]{10,}|[A-Za-z0-9_-]{32,})$/;

/**
 * Is a key sensitive (must be redacted from logs/telemetry)?
 */
export function isSensitiveKey(key) {
  const k = String(key || '').toLowerCase().trim();
  if (!k) return false;
  return SENSITIVE_KEYS.some((re) => re.test(k));
}

function isSensitiveValue(v) {
  if (typeof v !== 'string') return false;
  if (v.length > 80) return true; // uzun string — raw content ehtimoli
  return TOKEN_LIKE.test(v.trim());
}

/**
 * Deep-sanitize an object for logs/telemetry export.
 * Recursive, PURE.
 */
export function sanitizeLog(obj, depth = 0) {
  if (depth > 6) return '[DEPTH]';
  if (obj === null || obj === undefined) return obj;
  if (Array.isArray(obj)) return obj.map((x) => sanitizeLog(x, depth + 1));
  if (typeof obj !== 'object') {
    return typeof obj === 'string' && isSensitiveValue(obj) ? '[REDACTED]' : obj;
  }
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (isSensitiveKey(k)) {
      out[k] = '[REDACTED]';
      continue;
    }
    out[k] = sanitizeLog(v, depth + 1);
  }
  return out;
}

/**
 * Redact free-text (open response, moderator note) before logging.
 */
export function redactFreeText(text) {
  if (typeof text !== 'string') return text;
  if (!text.trim()) return text;
  return `[REDACTED:${String(text.length)}ch]`;
}

// ── Teacher health status map (item 5) ──
// Backpressure level + lag → UX status: Barqaror / Kechikish yuqori / Tiklanmoqda
export const TEACHER_HEALTH = Object.freeze({
  STABLE: 'Barqaror',
  HIGH_LATENCY: 'Kechikish yuqori',
  RECOVERING: 'Tiklanmoqda',
});

/**
 * Map runtime signals to a teacher-facing health status.
 * @param {object} s — { backpressureLevel, lagMs, recovering }
 */
export function teacherHealthStatus({ backpressureLevel = 'normal', lagMs = 0, recovering = false } = {}) {
  if (recovering) return TEACHER_HEALTH.RECOVERING;
  if (backpressureLevel === 'degraded2' || backpressureLevel === 'admission_queue') {
    return TEACHER_HEALTH.HIGH_LATENCY;
  }
  if (lagMs >= 1000) return TEACHER_HEALTH.HIGH_LATENCY;
  if (lagMs >= 400) return TEACHER_HEALTH.RECOVERING;
  return TEACHER_HEALTH.STABLE;
}

// ── Correlation / trace propagation (item 4) ──
/**
 * Parse a W3C traceparent header into { traceId, spanId, sampled }.
 */
export function parseTraceparent(header) {
  if (typeof header !== 'string') return null;
  const m = header.trim().match(/^00-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/);
  if (!m) return null;
  return { traceId: m[1], spanId: m[2], sampled: (parseInt(m[3], 16) & 0x01) === 0x01 };
}

/**
 * Build a traceparent header (root span) for a command envelope.
 */
export function newTraceContext() {
  const traceId = cryptoRandomHex(32);
  const spanId = cryptoRandomHex(16);
  return { traceId, spanId, traceparent: `00-${traceId}-${spanId}-01` };
}

function cryptoRandomHex(len) {
  const bytes = Math.ceil(len / 2);
  let out = '';
  for (let i = 0; i < bytes; i += 1) {
    out += Math.floor(Math.random() * 256).toString(16).padStart(2, '0');
  }
  return out.slice(0, len);
}

/**
 * Extract correlation context from an incoming socket command.
 * - `data.traceparent` (client propagated) yoki
 * - `data.traceId` (legacy) yoki
 * - yangi root trace
 */
export function traceFromCommand(data = {}) {
  if (data.traceparent) {
    const t = parseTraceparent(data.traceparent);
    if (t) return { ...t, traceparent: data.traceparent };
  }
  if (data.traceId && /^[0-9a-f]{32}$/.test(String(data.traceId))) {
    return { traceId: data.traceId, spanId: cryptoRandomHex(16), traceparent: `00-${data.traceId}-${cryptoRandomHex(16)}-01` };
  }
  return newTraceContext();
}

// ── Snapshot (health endpoint / dashboard uchun) ──
/**
 * Build a sanitized cast metrics snapshot.
 * @param {object} opts — { connections, lagMs, dbQueue, projectorStale, moderationAge, bpLevel, recovering }
 */
export function castTelemetrySnapshot(opts = {}) {
  const counters = { ...(opts.counters || castCounters()) };
  const ack = {
    answer: { p50: ACK_BUCKETS.answer.p50(), p95: ACK_BUCKETS.answer.p95(), p99: ACK_BUCKETS.answer.p99() },
    host: { p50: ACK_BUCKETS.host.p50(), p95: ACK_BUCKETS.host.p95(), p99: ACK_BUCKETS.host.p99() },
    join: { p50: ACK_BUCKETS.join.p50(), p95: ACK_BUCKETS.join.p95(), p99: ACK_BUCKETS.join.p99() },
    state: { p50: ACK_BUCKETS.state.p50(), p95: ACK_BUCKETS.state.p95(), p99: ACK_BUCKETS.state.p99() },
  };
  return {
    scope: 'cast',
    ts: Date.now(),
    counters,
    ack, // ms; null = no sample yet
    gauges: {
      redisLagMs: { p50: GAUGE_SAMPLES.redisLagMs.p50(), p99: GAUGE_SAMPLES.redisLagMs.p99(), samples: GAUGE_SAMPLES.redisLagMs.size },
      dbQueueDepth: { p50: GAUGE_SAMPLES.dbQueueDepth.p50(), p99: GAUGE_SAMPLES.dbQueueDepth.p99(), samples: GAUGE_SAMPLES.dbQueueDepth.size },
      projectorStaleMs: { p50: GAUGE_SAMPLES.projectorStaleMs.p50(), samples: GAUGE_SAMPLES.projectorStaleMs.size },
      moderationAgeMs: { p50: GAUGE_SAMPLES.moderationAgeMs.p50(), samples: GAUGE_SAMPLES.moderationAgeMs.size },
    },
    health: {
      backpressureLevel: opts.bpLevel || 'normal',
      lagMs: opts.lagMs || 0,
      dbQueue: opts.dbQueue || 0,
      projectorStale: opts.projectorStale || 0,
      moderationAge: opts.moderationAge || 0,
      teacher: teacherHealthStatus({
        backpressureLevel: opts.bpLevel || 'normal',
        lagMs: opts.lagMs || 0,
        recovering: !!opts.recovering,
      }),
    },
  };
}

// ── Mutable counters (module-level, socket handler hook'laydi) ──
const counters = { ...METRIC_COUNTERS };

export function incCounter(name, by = 1) {
  if (!(name in METRIC_COUNTERS)) return;
  counters[name] += by;
}

export function resetCastTelemetry() {
  for (const k of Object.keys(counters)) counters[k] = 0;
  for (const b of Object.values(ACK_BUCKETS)) { while (b.len) b.len -= 1; }
  for (const g of Object.values(GAUGE_SAMPLES)) { while (g.len) g.len -= 1; }
}

export function castCounters() {
  return { ...counters };
}

/**
 * Record an ACK timing (ms) into the right bucket.
 * @param {string} kind — answer | host | join | state | other
 * @param {number} ms
 */
export function recordAckTiming(kind, ms) {
  const bucket = ACK_BUCKETS[kind] || ACK_BUCKETS.other;
  bucket.push(ms);
  counters.acks += 1;
}

export default {
  RingBuffer,
  buildLogEntry,
  sanitizeLog,
  redactFreeText,
  isSensitiveKey,
  teacherHealthStatus,
  TEACHER_HEALTH,
  parseTraceparent,
  traceFromCommand,
  newTraceContext,
  castTelemetrySnapshot,
  incCounter,
  resetCastTelemetry,
  castCounters,
  recordAckTiming,
};
