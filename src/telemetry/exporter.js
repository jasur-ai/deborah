/**
 * AUTH D-05 — OTLP/HTTP (JSON) exporter + deterministic sampler.
 *
 * - OTLP/HTTP JSON format: POST {endpoint}/v1/traces (self-hosted collector,
 *   UZ data law — trace'lar UZ'da qoladi).
 * - Sampler: traceId birinchi baytiga deterministik (bir xil trace doim bir
 *   xil qaror) — prod'da xarajat uchun 10% (env.js OTEL_SAMPLE_RATE).
 * - Fail-open: collector ishlamasa hech narsa buzilmaydi (telemetry xatosi
 *   app'ni ta'sirlantirmaydi).
 * - Redaction: span attribute'larini export vaqtida QAYTA redact qiladi
 *   (D-04 qoidasi — trace'da parol/token/OTP/PII hech qachon).
 */

import { redactForTelemetry, redactText } from './redaction.js';

const DEFAULT_OTLP_ENDPOINT = 'http://localhost:4318/v1/traces';

/**
 * Deterministic trace sampler: bir xil traceId har doim bir xil natija.
 * @param {string} traceId - 32 hex
 * @param {number} rate - 0..1 (1 = hammasi, 0.1 = 10%)
 * @returns {boolean}
 */
export function shouldSample(traceId, rate = 1) {
  if (!traceId || rate >= 1) return true;
  if (rate <= 0) return false;
  const firstByte = parseInt(traceId.slice(0, 2), 16);
  if (Number.isNaN(firstByte)) return true;
  return firstByte / 255 < rate;
}

/** OTel span kind int mapping. */
function spanKindToInt(kind) {
  switch (kind) {
    case 'server': return 2;
    case 'client': return 3;
    case 'producer': return 4;
    case 'consumer': return 5;
    default: return 1; // internal
  }
}

/** OTLP KeyValue list — barcha qiymatlar string (redacted). */
function toKeyValue(attrs = {}) {
  return Object.entries(attrs).map(([key, value]) => ({
    key: redactText(String(key)),
    value: { stringValue: redactText(String(value ?? '')) },
  }));
}

/**
 * Span'lar ro'yxatini OTLP/HTTP JSON ExportTraceServiceRequest'ga aylantiradi.
 * PII yo'q: attribute key/value'lar redactText + redactForTelemetry orqali.
 * @param {object[]} spans - tracer.endSpan bilan yozilgan spanlar
 * @returns {object} OTLP JSON payload
 */
export function buildOtlpPayload(spans) {
  const otlpSpans = (Array.isArray(spans) ? spans : [spans]).map((s) => ({
    traceId: s.traceId,
    spanId: s.spanId,
    parentSpanId: s.parentSpanId || undefined,
    name: redactText(s.name),
    kind: spanKindToInt(s.kind),
    startTimeUnixNano: String(Math.max(0, s.startTime || Date.now()) * 1e6),
    endTimeUnixNano: String(Math.max(0, s.endTime || Date.now()) * 1e6),
    attributes: toKeyValue(redactForTelemetry(s.attributes || {})),
    status: {
      code: s.status === 'error' ? 2 : s.status === 'ok' ? 1 : 0,
      message: redactText(s.statusMessage || ''),
    },
    events: (s.events || []).map((e) => ({
      timeUnixNano: String(Math.max(0, e.time || Date.now()) * 1e6),
      name: redactText(e.name),
      attributes: toKeyValue(redactForTelemetry(e.attributes || {})),
    })),
  }));
  return {
    resourceSpans: [{
      resource: { attributes: toKeyValue({ 'service.name': 'edikit-auth' }) },
      scopeSpans: [{ scope: { name: 'edikit', version: '1.0.0' }, spans: otlpSpans }],
    }],
  };
}

/**
 * OTLP/HTTP exporter factory — tracer.setSpanExporter uchun.
 * Batched (maxBatch yoki 1s interval), fail-open, PII yo'q.
 * @param {{ endpoint?: string, sampleRate?: number, fetchFn?: Function,
 *   timeoutMs?: number, maxBatch?: number }} opts
 * @returns {{ push: (span: object) => void, flush: () => Promise<void> }}
 */
export function createOtlpHttpExporter({
  endpoint,
  sampleRate = 1,
  fetchFn = globalThis.fetch,
  timeoutMs = 5000,
  maxBatch = 128,
} = {}) {
  const url = String(endpoint || DEFAULT_OTLP_ENDPOINT).replace(/\/+$/, '');
  let queue = [];
  let flushTimer = null;

  const flush = async () => {
    const batch = queue;
    queue = [];
    if (!batch.length) return;
    try {
      await fetchFn(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(buildOtlpPayload(batch)),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (_) {
      // Fail-open: collector xatosi trace'ni tashlab yuboradi, app buzilmaydi.
    }
  };

  const push = (span) => {
    if (!shouldSample(span.traceId, sampleRate)) return;
    queue.push(span);
    if (queue.length >= maxBatch) {
      if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
      void flush();
    } else if (!flushTimer) {
      flushTimer = setTimeout(() => { flushTimer = null; void flush(); }, 1000);
      if (flushTimer.unref) flushTimer.unref();
    }
  };

  const flushSync = async () => {
    if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
    await flush();
  };

  return { push, flush: flushSync, buildOtlpPayload };
}

export default { shouldSample, buildOtlpPayload, createOtlpHttpExporter };
