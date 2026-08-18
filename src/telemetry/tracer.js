/**
 * Deborah — Lightweight Tracer (Prompt 69 §07-09)
 *
 * OTel API yuzasiga mos, ammo tashqi SDK talab qilmaydigan yengil tracer:
 *   - W3C tracecontext (traceparent: 00-<traceId32>-<spanId16>-01) inject/extract
 *   - Span model: traceId, spanId, parentSpanId, name, kind, attributes, status
 *   - In-memory span sink + export hook (exporter orqali istalgan backendga)
 *   - Attribute redaction: redaction.js orqali — answer key/token/PII hech
 *     qachon span atributlariga tushmaydi (research §16, §38.3)
 *
 * PURE: faqat xotirada ishlaydi, I/O yo'q. Exporter o'rnatilmasa spanlar
 * xotirada saqlanadi (test va SLO dashboard uchun).
 */

import crypto from 'crypto';
import { runWithTrace, getTraceContext } from './context.js';
import { redactForTelemetry, redactText } from './redaction.js';

// ── Span kinds (OTel semantics) ──
export const SPAN_KIND = {
  INTERNAL: 'internal',
  SERVER: 'server',
  CLIENT: 'client',
  PRODUCER: 'producer',
  CONSUMER: 'consumer',
};

// ── Span status ──
export const SPAN_STATUS = {
  UNSET: 'unset',
  OK: 'ok',
  ERROR: 'error',
};

// ── In-memory span sink (export hook bilan) ──
const spans = [];
let exporter = null;
let maxSpans = 10000;

/**
 * Configure the exporter. Called once at startup.
 * @param {(span: object) => void} fn - Span tugaganda chaqiriladi.
 * @param {{ maxSpans?: number }} opts
 */
export function setSpanExporter(fn, opts = {}) {
  exporter = typeof fn === 'function' ? fn : null;
  if (opts.maxSpans) maxSpans = opts.maxSpans;
}

/** Generate a 128-bit trace ID (32 hex). */
export function generateTraceId() {
  return crypto.randomBytes(16).toString('hex');
}

/** Generate a 64-bit span ID (16 hex). */
export function generateSpanId() {
  return crypto.randomBytes(8).toString('hex');
}

/** Valid 32-hex trace ID pattern. */
const TRACE_ID_RE = /^[0-9a-f]{32}$/;
/** Valid 16-hex span ID pattern. */
const SPAN_ID_RE = /^[0-9a-f]{16}$/;

/**
 * Parse a W3C traceparent header.
 * @param {string} header - e.g. "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01"
 * @returns {{ traceId: string, spanId: string, sampled: boolean } | null}
 */
export function parseTraceparent(header) {
  if (typeof header !== 'string') return null;
  const parts = header.trim().split('-');
  if (parts.length !== 4) return null;
  const [version, traceId, spanId, flags] = parts;
  if (version !== '00') return null;
  if (!TRACE_ID_RE.test(traceId) || !SPAN_ID_RE.test(spanId)) return null;
  return {
    traceId,
    spanId,
    sampled: (parseInt(flags, 16) & 1) === 1,
  };
}

/**
 * Build a W3C traceparent header for a trace context.
 * @param {{ traceId: string, spanId: string, sampled?: boolean }} ctx
 * @returns {string}
 */
export function buildTraceparent(ctx) {
  if (!ctx || !ctx.traceId || !ctx.spanId) return '';
  const flags = ctx.sampled === false ? '00' : '01';
  return `00-${ctx.traceId}-${ctx.spanId}-${flags}`;
}

// ── Span lifecycle ──

/**
 * Start a new span.
 * @param {string} name
 * @param {{ kind?: string, attributes?: object, parent?: object|null, traceId?: string, spanId?: string }} opts
 * @returns {object} span handle
 */
export function startSpan(name, opts = {}) {
  const current = opts.parent !== undefined ? opts.parent : getTraceContext();
  const traceId = opts.traceId || current?.traceId || generateTraceId();
  const parentSpanId = opts.spanId ? null : (current?.spanId || null);
  const spanId = opts.spanId || generateSpanId();

  const span = {
    name: redactText(name),
    kind: opts.kind || SPAN_KIND.INTERNAL,
    traceId,
    spanId,
    parentSpanId,
    attributes: redactForTelemetry(opts.attributes || {}),
    status: SPAN_STATUS.UNSET,
    statusMessage: '',
    startTime: Date.now(),
    endTime: null,
    events: [],
    hasEnded: false,
  };
  return span;
}

/**
 * Run a function inside a new span (auto start/end + error capture).
 * @param {string} name
 * @param {(span: object) => any} fn - sync yoki async
 * @param {{ kind?: string, attributes?: object, parent?: object }} opts
 * @returns {*} fn natijasi
 */
export function withSpan(name, fn, opts = {}) {
  const span = startSpan(name, opts);
  const ctx = { traceId: span.traceId, spanId: span.spanId, sampled: true };
  return runWithTrace(ctx, async () => {
    try {
      const result = await fn(span);
      endSpan(span, { status: SPAN_STATUS.OK });
      return result;
    } catch (err) {
      endSpan(span, { status: SPAN_STATUS.ERROR, statusMessage: err?.message || 'error', error: err });
      throw err;
    }
  });
}

/**
 * End a span, record it, and optionally export.
 * @param {object} span
 * @param {{ status?: string, statusMessage?: string, attributes?: object, error?: Error }} opts
 */
export function endSpan(span, opts = {}) {
  if (!span || span.hasEnded) return;
  span.endTime = Date.now();
  span.durationMs = span.endTime - span.startTime;
  if (opts.attributes) {
    span.attributes = { ...span.attributes, ...redactForTelemetry(opts.attributes) };
  }
  if (opts.status) span.status = opts.status;
  if (opts.statusMessage) span.statusMessage = redactText(opts.statusMessage);
  if (opts.error) {
    span.status = SPAN_STATUS.ERROR;
    span.statusMessage = redactText(opts.error.message || 'error');
    span.events.push({
      name: 'exception',
      time: Date.now(),
      attributes: { 'exception.message': redactText(opts.error.message || '') },
    });
  }
  span.hasEnded = true;
  spans.push(span);
  if (spans.length > maxSpans) spans.shift();
  if (exporter) {
    try { exporter(span); } catch (_) { /* exporter xatosi telemetryni buzmasin */ }
  }
  return span;
}

/**
 * Set an attribute on a live span (redacted).
 * @param {object} span
 * @param {string} key
 * @param {*} value
 */
export function setSpanAttribute(span, key, value) {
  if (!span || span.hasEnded) return;
  span.attributes[key] = redactForTelemetry(value);
}

/** Add an event to a live span (redacted). */
export function addSpanEvent(span, name, attributes = {}) {
  if (!span || span.hasEnded) return;
  span.events.push({ name: redactText(name), time: Date.now(), attributes: redactForTelemetry(attributes) });
}

/**
 * Get all recorded spans (deep copy — export uchun).
 * @returns {object[]}
 */
export function getSpans() {
  return spans.map((s) => ({ ...s, attributes: { ...s.attributes }, events: s.events.map((e) => ({ ...e, attributes: { ...e.attributes } })) }));
}

/** Clear recorded spans (test / rolling window). */
export function clearSpans() {
  spans.length = 0;
}

/**
 * Extract a trace context from request headers (if traceparent present),
 * otherwise create a fresh root context.
 * @param {{ traceparent?: string }} headers
 * @returns {{ traceId: string, spanId: string, sampled: boolean, fromHeader: boolean }}
 */
export function contextFromHeaders(headers = {}) {
  const parsed = parseTraceparent(headers.traceparent || headers['traceparent']);
  if (parsed) {
    return { ...parsed, fromHeader: true };
  }
  return { traceId: generateTraceId(), spanId: generateSpanId(), sampled: true, fromHeader: false };
}

export default {
  SPAN_KIND,
  SPAN_STATUS,
  setSpanExporter,
  generateTraceId,
  generateSpanId,
  parseTraceparent,
  buildTraceparent,
  startSpan,
  withSpan,
  endSpan,
  setSpanAttribute,
  addSpanEvent,
  getSpans,
  clearSpans,
  contextFromHeaders,
};
