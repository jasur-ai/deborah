/**
 * Deborah — Telemetry unit tests (Prompt 69)
 *
 *   - W3C traceparent parse/build (context propagation)
 *   - AsyncLocalStorage context propagation
 *   - Span lifecycle: attributes redaction (answer key/token/PII never leak)
 *   - Metrics registry: counter/histogram/gauge + percentiles
 *   - SLO: availability + burn-rate math
 *   - Alerts: SLO burn-rate, provider circuit, cost/quota, runbook annotations
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  parseTraceparent,
  buildTraceparent,
  startSpan,
  endSpan,
  withSpan,
  getSpans,
  clearSpans,
  contextFromHeaders,
  incrementCounter,
  observeHistogram,
  setGauge,
  snapshotMetrics,
  clearMetrics,
  computeAvailability,
  computeLatencyP95,
  evaluateSlo,
  evaluateAlerts,
  RUNBOOKS,
  redactForTelemetry,
  isSensitiveKey,
} from '../../src/telemetry/index.js';

beforeEach(() => {
  clearSpans();
  clearMetrics();
});

// ═══════════════════════════════════════════════════════════════════
// TRACE CONTEXT PROPAGATION (W3C tracecontext)
// ═══════════════════════════════════════════════════════════════════

describe('trace — W3C traceparent', () => {
  it('parses a valid traceparent header', () => {
    const ctx = parseTraceparent('00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01');
    expect(ctx.traceId).toBe('4bf92f3577b34da6a3ce929d0e0e4736');
    expect(ctx.spanId).toBe('00f067aa0ba902b7');
    expect(ctx.sampled).toBe(true);
  });

  it('rejects invalid traceparent', () => {
    expect(parseTraceparent('bad')).toBeNull();
    expect(parseTraceparent('01-xyz-abc-01')).toBeNull();
    expect(parseTraceparent('')).toBeNull();
    expect(parseTraceparent(null)).toBeNull();
  });

  it('builds a round-trip traceparent', () => {
    const ctx = { traceId: '4bf92f3577b34da6a3ce929d0e0e4736', spanId: '00f067aa0ba902b7', sampled: true };
    const header = buildTraceparent(ctx);
    expect(header).toBe('00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01');
    expect(parseTraceparent(header)).toEqual(ctx);
  });

  it('contextFromHeaders uses incoming traceparent when present', () => {
    const ctx = contextFromHeaders({ traceparent: '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01' });
    expect(ctx.traceId).toBe('4bf92f3577b34da6a3ce929d0e0e4736');
    expect(ctx.fromHeader).toBe(true);
  });

  it('contextFromHeaders creates a fresh root when absent', () => {
    const ctx = contextFromHeaders({});
    expect(ctx.traceId).toMatch(/^[0-9a-f]{32}$/);
    expect(ctx.fromHeader).toBe(false);
  });
});

describe('trace — AsyncLocalStorage propagation', () => {
  it('propagates traceId/spanId across async boundaries', async () => {
    const span = startSpan('root');
    const ctx = { traceId: span.traceId, spanId: span.spanId };
    const { runWithTrace, getTraceContext } = await import('../../src/telemetry/context.js');
    const result = await runWithTrace(ctx, async () => {
      await new Promise((r) => setTimeout(r, 5));
      return getTraceContext();
    });
    expect(result.traceId).toBe(ctx.traceId);
    expect(result.spanId).toBe(ctx.spanId);
  });

  it('returns null context when not inside a trace', async () => {
    const { getTraceContext } = await import('../../src/telemetry/context.js');
    expect(getTraceContext()).toBeNull();
  });
});

describe('trace — spans', () => {
  it('records a span with redacted attributes', () => {
    const span = startSpan('db.query', {
      attributes: {
        'db.system': 'postgresql',
        'db.statement': 'SELECT 1',
        answerKey: 'B',           // ❌ never recorded
        token: 'eyJhbGciOiJIUzI1NiJ9', // ❌ never recorded
        student_name: 'Ali',      // ❌ PII never recorded
      },
    });
    endSpan(span, { status: 'ok' });
    const spans = getSpans();
    expect(spans).toHaveLength(1);
    expect(spans[0].name).toBe('db.query');
    expect(spans[0].attributes['db.system']).toBe('postgresql');
    expect(spans[0].attributes.answerKey).toBe('[REDACTED]');
    expect(spans[0].attributes.token).toBe('[REDACTED]');
    expect(spans[0].attributes.student_name).toBe('[REDACTED]');
  });

  it('withSpan captures errors and sets ERROR status', async () => {
    await expect(
      withSpan('job.process', async () => {
        throw new Error('boom');
      })
    ).rejects.toThrow('boom');
    const spans = getSpans();
    expect(spans).toHaveLength(1);
    expect(spans[0].status).toBe('error');
    expect(spans[0].statusMessage).toContain('boom');
  });

  it('withSpan records OK status on success', async () => {
    const value = await withSpan('job.process', async () => 42);
    expect(value).toBe(42);
    const spans = getSpans();
    expect(spans[0].status).toBe('ok');
  });
});

// ═══════════════════════════════════════════════════════════════════
// REDACTION
// ═══════════════════════════════════════════════════════════════════

describe('redaction — PII/answer/token guard (research §15, §16)', () => {
  it('detects sensitive keys', () => {
    expect(isSensitiveKey('answerKey')).toBe(true);
    expect(isSensitiveKey('q_correct')).toBe(true);
    expect(isSensitiveKey('password')).toBe(true);
    expect(isSensitiveKey('access_token')).toBe(true);
    expect(isSensitiveKey('raw_response')).toBe(true);
    expect(isSensitiveKey('health_evidence')).toBe(true);
    expect(isSensitiveKey('db.system')).toBe(false);
    expect(isSensitiveKey('http.status_code')).toBe(false);
  });

  it('deep-redacts nested objects', () => {
    const out = redactForTelemetry({
      ok: true,
      answer: { answerKey: 'C', optionIndex: 2 }, // answerKey → sensitive
      meta: { qid: 'q1', attempt: 3 },
    });
    expect(out.ok).toBe(true);
    expect(out.answer.answerKey).toBe('[REDACTED]');
    expect(out.answer.optionIndex).toBe(2);
    expect(out.meta.qid).toBe('q1');
  });

  it('redacts long tokens in free text', async () => {
    const { redactText } = await import('../../src/telemetry/index.js');
    const cleaned = redactText('error with eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0');
    expect(cleaned).toContain('[TOKEN]');
  });
});

// ═══════════════════════════════════════════════════════════════════
// METRICS
// ═══════════════════════════════════════════════════════════════════

describe('metrics — registry', () => {
  it('increments counters with labels', () => {
    incrementCounter('deborah_http_requests_total', {}, { value: 3, labels: { method: 'GET' } });
    incrementCounter('deborah_http_requests_total', {}, { value: 1, labels: { method: 'GET' } });
    const snap = snapshotMetrics();
    const c = snap.counters.find((x) => x.name === 'deborah_http_requests_total');
    expect(c.value).toBe(4);
    expect(c.labels.method).toBe('GET');
  });

  it('computes histogram percentiles', () => {
    for (let i = 1; i <= 100; i++) observeHistogram('deborah_ack_latency_ms', i, {});
    const snap = snapshotMetrics();
    const h = snap.histograms.find((x) => x.name === 'deborah_ack_latency_ms');
    expect(h.count).toBe(100);
    expect(h.p50).toBeGreaterThanOrEqual(50);
    expect(h.p95).toBeGreaterThanOrEqual(95);
  });

  it('sets gauges', () => {
    setGauge('deborah_socket_connected', 42, {});
    const snap = snapshotMetrics();
    expect(snap.gauges[0].value).toBe(42);
  });
});

// ═══════════════════════════════════════════════════════════════════
// SLO
// ═══════════════════════════════════════════════════════════════════

describe('SLO — availability & burn-rate (research §38.4)', () => {
  it('healthy availability SLO', () => {
    const r = computeAvailability({ good: 9999, total: 10000, sinceMs: 30 * 86400000 }, { target: 0.9995, windowMs: 30 * 86400000, burnWindowHours: 6 });
    expect(r.ok).toBe(true);
    expect(r.level).toBe('ok');
    expect(r.errorBudgetRemaining).toBeGreaterThan(0);
  });

  it('detects budget exhaustion', () => {
    const r = computeAvailability({ good: 9000, total: 10000, sinceMs: 30 * 86400000 }, { target: 0.9995, windowMs: 30 * 86400000, burnWindowHours: 6 });
    // error rate 10% >> budget 0.05% → critical burn
    expect(r.ok).toBe(false);
    expect(r.level).toBe('critical');
    expect(r.burnRate).toBeGreaterThan(14.4);
  });

  it('latency p95 SLO', () => {
    expect(computeLatencyP95({ p95: 100 }, { targetMs: 500 }).level).toBe('ok');
    expect(computeLatencyP95({ p95: 600 }, { targetMs: 500 }).level).toBe('warning');
    expect(computeLatencyP95({ p95: 900 }, { targetMs: 500 }).level).toBe('critical');
  });
});

describe('SLO — evaluateSlo from metrics snapshot', () => {
  it('answers healthy → all ok', () => {
    for (let i = 0; i < 1000; i++) observeHistogram('deborah_answer_save_duration', 120, {});
    const snap = snapshotMetrics();
    const results = evaluateSlo(snap, { sinceMs: 24 * 3600000 });
    const answerSlo = results.find((s) => s.id === 'answer_save_availability');
    expect(answerSlo).toBeTruthy();
    expect(answerSlo.ok).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════
// ALERTS
// ═══════════════════════════════════════════════════════════════════

describe('alerts — rules + runbook annotations (research §38.5)', () => {
  it('fires critical alert on fast SLO burn', () => {
    // 50% error rate → critical burn
    for (let i = 0; i < 500; i++) observeHistogram('deborah_answer_save_duration', 120, {});
    incrementCounter('deborah_answer_save_errors_total', {}, { value: 250 });
    const snap = snapshotMetrics();
    const alerts = evaluateAlerts(snap, { sinceMs: 30 * 86400000 });
    const critical = alerts.find((a) => a.id === 'slo_critical_answer_save_availability');
    expect(critical).toBeTruthy();
    expect(critical.severity).toBe('critical');
    expect(critical.runbook).toBeTruthy();
  });

  it('fires provider circuit alert on high error rate', () => {
    incrementCounter('deborah_provider_requests_total', {}, { value: 100, labels: { provider: 'gamma', status: '500' } });
    incrementCounter('deborah_provider_errors_total', {}, { value: 30, labels: { provider: 'gamma', status: '500' } });
    const alerts = evaluateAlerts(snapshotMetrics());
    expect(alerts.some((a) => a.id === 'provider_circuit_open')).toBe(true);
    expect(alerts.find((a) => a.id === 'provider_circuit_open').runbook).toBe(RUNBOOKS.provider_outage.path);
  });

  it('fires cost alert over budget', () => {
    incrementCounter('deborah_provider_cost_cents_total', {}, { value: 60000 }); // $600 > $500 budget
    const alerts = evaluateAlerts(snapshotMetrics(), { costBudgetCents: 50000 });
    expect(alerts.some((a) => a.id === 'ai_cost_over_budget')).toBe(true);
  });

  it('fires quota alert near limit', () => {
    setGauge('deborah_provider_quota_fraction', 0.96, { labels: { provider: 'gamma' } });
    const alerts = evaluateAlerts(snapshotMetrics());
    expect(alerts.some((a) => a.id === 'provider_quota_gamma')).toBe(true);
    expect(alerts.find((a) => a.id === 'provider_quota_gamma').severity).toBe('critical');
  });

  it('no alerts when healthy', () => {
    const alerts = evaluateAlerts(snapshotMetrics());
    expect(alerts).toHaveLength(0);
  });
});
