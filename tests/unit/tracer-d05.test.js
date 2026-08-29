/**
 * AUTH D-05 — Request ID + trace (unit)
 *
 * 1. Sampler determinism (OTEL_SAMPLE_RATE — bir xil trace doim bir xil qaror)
 * 2. OTLP/HTTP payload format + redaction (trace'da parol/token/PII yo'q)
 * 3. userIdHash — PII minimal (raw userKey emas, 16-hex, deterministik)
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { shouldSample, buildOtlpPayload, createOtlpHttpExporter } from '../../src/telemetry/exporter.js';
import { userIdHash } from '../../src/telemetry/spans.js';
import { startSpan, endSpan, clearSpans, setSpanExporter } from '../../src/telemetry/tracer.js';

const TRACE_A = '4bf92f3577b34da6a3ce929d0e0e4736';
const TRACE_B = '00000000000000000000000000000000';

describe('AUTH D-05 — sampler', () => {
  it('rate=1 → hammasi sample', () => {
    expect(shouldSample(TRACE_A, 1)).toBe(true);
    expect(shouldSample(TRACE_B, 1)).toBe(true);
  });

  it('rate=0 → hech narsa sample emas', () => {
    expect(shouldSample(TRACE_A, 0)).toBe(false);
    expect(shouldSample('', 1)).toBe(true);
  });

  it('deterministik — bir xil traceId har doim bir xil qaror', () => {
    for (const rate of [0.1, 0.5, 0.01]) {
      const a1 = shouldSample(TRACE_A, rate);
      const a2 = shouldSample(TRACE_A, rate);
      const b1 = shouldSample(TRACE_B, rate);
      const b2 = shouldSample(TRACE_B, rate);
      expect(a1).toBe(a2);
      expect(b1).toBe(b2);
      // TRACE_A (0x4b=75/255≈0.29) 0.5 da sample, 0.1 da emas
      expect(a1).toBe(rate >= 0.3);
      // 0x00 → 0/255 = 0 < rate → rate>0 bo'lsa sample (deterministik chegarada)
      expect(b1).toBe(rate > 0);
    }
  });
});

describe('AUTH D-05 — OTLP/HTTP payload', () => {
  it('OTLP JSON format: traceId/spanId/status/kind to\'g\'ri', () => {
    const span = {
      traceId: TRACE_A, spanId: '00f067aa0ba902b7', parentSpanId: '1111111111111111',
      name: 'auth.login', kind: 'server', startTime: 1000, endTime: 2000,
      status: 'ok', statusMessage: '', attributes: { 'http.status_code': 200 }, events: [],
    };
    const payload = buildOtlpPayload([span]);
    const otlpSpan = payload.resourceSpans[0].scopeSpans[0].spans[0];
    expect(otlpSpan.traceId).toBe(TRACE_A);
    expect(otlpSpan.spanId).toBe('00f067aa0ba902b7');
    expect(otlpSpan.parentSpanId).toBe('1111111111111111');
    expect(otlpSpan.name).toBe('auth.login');
    expect(otlpSpan.kind).toBe(2); // server
    expect(otlpSpan.startTimeUnixNano).toBe('1000000000');
    expect(otlpSpan.status.code).toBe(1); // ok
    expect(payload.resourceSpans[0].resource.attributes[0].key).toBe('service.name');
  });

  it('trace payloadda parol/token/OTP/PII YO\'Q (redact)', () => {
    const longToken = 'a'.repeat(48);
    const span = {
      traceId: TRACE_A, spanId: '2222222222222222', parentSpanId: null,
      name: 'auth.login', kind: 'server', startTime: 1, endTime: 2,
      status: 'error', statusMessage: 'parol xato: ' + longToken,
      attributes: {
        'body.password': 'super-secret-parol', 'body.token': 'tok-abc',
        'body.otp': '123456', 'auth.outcome': 'error', 'user_id': 'abc123',
      },
      events: [{ name: 'exception', time: 1, attributes: { 'exception.message': 'token ' + longToken } }],
    };
    const out = JSON.stringify(buildOtlpPayload([span]));
    expect(out).not.toContain('super-secret-parol');
    expect(out).not.toContain('tok-abc');
    expect(out).not.toContain('123456');
    expect(out).not.toContain(longToken);
    expect(out).toContain('[REDACTED]');
    expect(out).toContain('[TOKEN]');
    expect(out).toContain('auth.outcome');
  });

  it('exporter push: samplenmagan span tashlab yuboriladi', async () => {
    const sent = [];
    const ex = createOtlpHttpExporter({ sampleRate: 0, fetchFn: async (url, opts) => { sent.push(opts.body); } });
    ex.push({ traceId: TRACE_A, name: 'auth.login' });
    await ex.flush();
    expect(sent.length).toBe(0);
  });

  it('exporter fail-open: collector xatosi appni buzmaydi', async () => {
    const ex = createOtlpHttpExporter({
      sampleRate: 1,
      fetchFn: async () => { throw new Error('collector down'); },
    });
    ex.push({ traceId: TRACE_A, name: 'auth.login' });
    await expect(ex.flush()).resolves.toBeUndefined();
  });
});

describe('AUTH D-05 — userIdHash (PII minimal)', () => {
  it('16-hex, deterministik, raw key emas', () => {
    const h = userIdHash('alisher');
    expect(h).toMatch(/^[0-9a-f]{16}$/);
    expect(userIdHash('alisher')).toBe(h);
    expect(userIdHash('alisher2')).not.toBe(h);
    expect(userIdHash(null)).toBeNull();
    expect(userIdHash(undefined)).toBeNull();
  });
});
