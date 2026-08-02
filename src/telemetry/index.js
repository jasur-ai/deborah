/**
 * Edikit — Telemetry Facade (Prompt 69)
 *
 * OTel-style observability uchun yagona kirish nuqtasi:
 *   - Tracer (W3C traceparent, AsyncLocalStorage context propagation)
 *   - Metrics registry (counters/histograms/gauges)
 *   - SLO evaluation + burn-rate
 *   - Alert rules + runbook annotations
 *   - PII/answer/token redaction
 *
 * research.md §38: HTTP, Socket, DB, Redis, queue va provider bir trace ID
 * bilan; Socket spanlarida student PII emas, hashed/internal IDs.
 */

export * from './context.js';
export * from './redaction.js';
export * from './tracer.js';
export * from './metrics.js';
export * from './slo.js';
export * from './alerts.js';

// ── Convenience re-exports ──
import * as tracer from './tracer.js';
import * as metrics from './metrics.js';
import * as slo from './slo.js';
import * as alerts from './alerts.js';
import { runWithTrace } from './context.js';

/**
 * Trace context'ni request header'laridan olish (traceparent yoki yangi root).
 * HTTP middleware'da ishlatiladi.
 * @param {{ traceparent?: string }} headers
 */
export function traceContextFromRequest(headers = {}) {
  return tracer.contextFromHeaders(headers);
}

/**
 * Trace context ichida ishlash — HTTP middleware + socket wrapper uchun.
 * @param {{ traceId, spanId, sampled }} ctx
 * @param {Function} fn
 */
export function withTraceContext(ctx, fn) {
  return runWithTrace(ctx, fn);
}

/**
 * Record a domain metric (research §38.2).
 * @param {string} name
 * @param {number} value
 * @param {{ type?: 'counter'|'histogram'|'gauge', unit?: string, help?: string, labels?: object }} opts
 */
export function recordMetric(name, value = 1, opts = {}) {
  return metrics.recordMetric(name, value, opts);
}

/** Snapshot metrics + SLO + alerts — observability dashboard uchun. */
export function telemetrySnapshot(opts = {}) {
  const snapshot = metrics.snapshotMetrics();
  const sloResults = slo.evaluateSlo(snapshot, opts);
  const firedAlerts = alerts.evaluateAlerts(snapshot, opts);
  return {
    metrics: snapshot,
    slos: sloResults,
    alerts: firedAlerts,
    ts: Date.now(),
  };
}

export default { ...tracer, ...metrics, ...slo, ...alerts, traceContextFromRequest, withTraceContext, recordMetric, telemetrySnapshot };
