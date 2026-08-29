/**
 * AUTH D-06 — Metrics (Prometheus format) + SLO + alerts unit tests
 * -------------------------------------------------------------------
 * Covers:
 *  1. prometheusText() — counter/histogram/gauge exposition format, PII yo'q
 *  2. Auth SLO evaluation — login success rate, login p95, email deliverability,
 *     availability (evaluateSlo mapping from auth_* counters)
 *  3. Auth alert thresholds — fail spike, lockout spike, email bounce, risk
 *     block, rate-limit abuse (evaluateAlerts)
 *  4. dueAlertAudits — cooldown dedupe (idempotent audit)
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { prometheusText, snapshotMetrics, clearMetrics, recordMetric, observeHistogram } from '../../src/telemetry/metrics.js';
import { evaluateSlo } from '../../src/telemetry/slo.js';
import { evaluateAlerts, dueAlertAudits, _resetAlertAuditState } from '../../src/telemetry/alerts.js';

const DAY_MS = 24 * 60 * 60 * 1000;

beforeEach(() => {
  clearMetrics();
  _resetAlertAuditState();
});

afterEach(() => {
  clearMetrics();
  _resetAlertAuditState();
});

// ── 1. Prometheus format ──
describe('prometheusText (D-06 §06/§15)', () => {
  it('counter + histogram + gauge text exposition', () => {
    recordMetric('auth_login_total', 3, { type: 'counter', labels: { method: 'password', outcome: 'success' } });
    observeHistogram('auth_login_duration_histogram', 150, { unit: 'ms' });
    observeHistogram('auth_login_duration_histogram', 450, { unit: 'ms' });
    recordMetric('auth_login_duration_histogram', 300, { type: 'histogram', unit: 'ms' });
    recordMetric('redis_conn', 2, { type: 'gauge', labels: { tenant: 't1' } });

    const text = prometheusText();
    expect(text).toContain('# TYPE auth_login_total counter');
    expect(text).toMatch(/auth_login_total\{method="password",outcome="success"\} 3/);
    expect(text).toContain('# TYPE auth_login_duration_histogram histogram');
    expect(text).toContain('auth_login_duration_histogram_count 3');
    expect(text).toMatch(/auth_login_duration_histogram_p95 \d+/);
    expect(text).toContain('# TYPE redis_conn gauge');
    expect(text).toMatch(/redis_conn\{tenant="t1"\} 2/);
  });

  it('PII-shaped label qiymatlari expositionda yoq', () => {
    // D-06 §12: metric'da PII yo'q — yozuv nuqtalarida faqat enum/count
    // label'lar ishlatiladi. Output'da email/JSHSHIR/uza token pattern bo'lmasin.
    recordMetric('auth_login_total', 1, { type: 'counter', labels: { method: 'password', outcome: 'failed' } });
    recordMetric('auth_login_total', 1, { type: 'counter', labels: { method: 'passkey', outcome: 'success' } });
    const text = prometheusText();
    // method enum'lar saqlanadi (kontrakt)
    expect(text).toContain('outcome="failed"');
    expect(text).toContain('method="passkey"');
    // PII pattern'lar YO'Q: email, 14-xonali JSHSHIR, 40+ token
    expect(text).not.toMatch(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i);
    expect(text).not.toMatch(/\b\d{14}\b/);
  });

  it('snapshot bosh bolsa — bosh string (xato emas)', () => {
    expect(prometheusText()).toBe('\n');
  });
});

// ── 2. Auth SLO evaluation ──
describe('auth SLO evaluation (D-06 §07)', () => {
  function snapshotWith(seed) {
    for (const c of seed.counters || []) recordMetric(c.name, c.value, { type: 'counter', labels: c.labels });
    for (const h of seed.histograms || []) observeHistogram(h.name, h.value, { unit: h.unit });
    return snapshotMetrics();
  }

  it('login success rate >90% (14 kun) — 95% ok', () => {
    const snap = snapshotWith({
      counters: [
        { name: 'auth_login_total', value: 95, labels: { outcome: 'success' } },
        { name: 'auth_login_total', value: 5, labels: { outcome: 'failed' } },
      ],
    });
    const res = evaluateSlo(snap, { sinceMs: 14 * DAY_MS });
    const slo = res.find((s) => s.id === 'auth_login_success_rate');
    expect(slo).toBeTruthy();
    expect(slo.ok).toBe(true);
    expect(slo.errorRate).toBeCloseTo(0.05, 3);
  });

  it('login success rate — 60% → warning (ok=false)', () => {
    const snap = snapshotWith({
      counters: [
        { name: 'auth_login_total', value: 60, labels: { outcome: 'success' } },
        { name: 'auth_login_total', value: 40, labels: { outcome: 'failed' } },
      ],
    });
    const slo = evaluateSlo(snap, { sinceMs: 14 * DAY_MS }).find((s) => s.id === 'auth_login_success_rate');
    expect(slo.ok).toBe(false);
  });

  it('login p95 < 2s — 1800ms ok, 2500ms fail', () => {
    const snapOk = snapshotWith({
      histograms: [
        { name: 'auth_login_duration_histogram', value: 1000, unit: 'ms' },
        { name: 'auth_login_duration_histogram', value: 1800, unit: 'ms' },
      ],
    });
    const ok = evaluateSlo(snapOk, { sinceMs: DAY_MS }).find((s) => s.id === 'auth_login_latency_p95');
    expect(ok.ok).toBe(true);

    const snapBad = snapshotWith({
      histograms: [
        { name: 'auth_login_duration_histogram', value: 1500, unit: 'ms' },
        { name: 'auth_login_duration_histogram', value: 2500, unit: 'ms' },
      ],
    });
    const bad = evaluateSlo(snapBad, { sinceMs: DAY_MS }).find((s) => s.id === 'auth_login_latency_p95');
    expect(bad.ok).toBe(false);
  });

  it('email deliverability >90% — 95% ok, 80% fail', () => {
    const snap = snapshotWith({
      counters: [
        { name: 'auth_email_delivery_total', value: 95, labels: { status: 'sent' } },
        { name: 'auth_email_delivery_total', value: 5, labels: { status: 'bounce' } },
      ],
    });
    const ok = evaluateSlo(snap, { sinceMs: 14 * DAY_MS }).find((s) => s.id === 'auth_email_deliverability');
    expect(ok.ok).toBe(true);

    const snapBad = snapshotWith({
      counters: [
        { name: 'auth_email_delivery_total', value: 80, labels: { status: 'sent' } },
        { name: 'auth_email_delivery_total', value: 20, labels: { status: 'bounce' } },
      ],
    });
    const bad = evaluateSlo(snapBad, { sinceMs: 14 * DAY_MS }).find((s) => s.id === 'auth_email_deliverability');
    expect(bad.ok).toBe(false);
  });

  it('availability 99.9% — login+register+verify yigindisi', () => {
    // 1500 urinishda 1 xato → 0.067% error < 0.1% budget → ok
    const snap = snapshotWith({
      counters: [
        { name: 'auth_login_total', value: 999, labels: { outcome: 'success' } },
        { name: 'auth_login_total', value: 1, labels: { outcome: 'failed' } },
        { name: 'auth_register_total', value: 500, labels: {} },
      ],
    });
    const slo = evaluateSlo(snap, { sinceMs: 30 * DAY_MS }).find((s) => s.id === 'auth_availability');
    expect(slo).toBeTruthy();
    expect(slo.ok).toBe(true);
  });

  it('availability 99.9% — budget oshsa fail', () => {
    // 1500 urinishda 3 xato → 0.2% error > 0.1% budget → fail
    const snap = snapshotWith({
      counters: [
        { name: 'auth_login_total', value: 997, labels: { outcome: 'success' } },
        { name: 'auth_login_total', value: 3, labels: { outcome: 'failed' } },
        { name: 'auth_register_total', value: 500, labels: {} },
      ],
    });
    const slo = evaluateSlo(snap, { sinceMs: 30 * DAY_MS }).find((s) => s.id === 'auth_availability');
    expect(slo.ok).toBe(false);
  });
});

// ── 3. Alert thresholds ──
describe('auth alerts (D-06 §08)', () => {
  it('fail spike ≥50% (≥20 login) → critical', () => {
    const alerts = evaluateAlerts({
      counters: [
        { name: 'auth_login_total', value: 10, labels: { outcome: 'success' } },
        { name: 'auth_login_total', value: 10, labels: { outcome: 'failed' } },
      ],
    }, { sinceMs: DAY_MS });
    const spike = alerts.find((a) => a.id === 'auth_fail_spike');
    expect(spike).toBeTruthy();
    expect(spike.severity).toBe('critical');
    expect(spike.runbook).toContain('auth-fail-spike');
  });

  it('lockout ≥20 → warning', () => {
    const alerts = evaluateAlerts({
      counters: [{ name: 'auth_lockout_total', value: 20, labels: { scope: 'user' } }],
    }, { sinceMs: DAY_MS });
    expect(alerts.find((a) => a.id === 'auth_lockout_spike')).toBeTruthy();
  });

  it('email bounce >5% (≥20 email) → warning/critical', () => {
    const alerts = evaluateAlerts({
      counters: [
        { name: 'auth_email_delivery_total', value: 90, labels: { status: 'sent' } },
        { name: 'auth_email_delivery_total', value: 10, labels: { status: 'bounce' } },
      ],
    }, { sinceMs: DAY_MS });
    expect(alerts.find((a) => a.id === 'auth_email_bounce')).toBeTruthy();
  });

  it('risk block ≥10 → warning', () => {
    const alerts = evaluateAlerts({
      counters: [{ name: 'auth_risk_block_total', value: 10, labels: { tier: 'high' } }],
    }, { sinceMs: DAY_MS });
    expect(alerts.find((a) => a.id === 'auth_risk_block_spike')).toBeTruthy();
  });

  it('rate-limit abuse ≥100 → warning', () => {
    const alerts = evaluateAlerts({
      counters: [{ name: 'auth_rate_limit_hit_total', value: 100, labels: { endpoint: 'login' } }],
    }, { sinceMs: DAY_MS });
    expect(alerts.find((a) => a.id === 'auth_rate_limit_abuse')).toBeTruthy();
  });

  it('chegara ostida — alert yoq', () => {
    const alerts = evaluateAlerts({
      counters: [
        { name: 'auth_login_total', value: 5, labels: { outcome: 'failed' } },
        { name: 'auth_lockout_total', value: 3, labels: {} },
        { name: 'auth_rate_limit_hit_total', value: 10, labels: {} },
      ],
    }, { sinceMs: DAY_MS });
    expect(alerts.some((a) => a.id.startsWith('auth_'))).toBe(false);
  });
});

// ── 4. Dedupe ──
describe('dueAlertAudits (D-06 §11 idempotent audit)', () => {
  it('bir xil alert cooldown ichida ikkinchi marta qaytmaydi', () => {
    const alerts = [
      { id: 'auth_fail_spike', severity: 'critical', title: 'x', sloId: null },
    ];
    const first = dueAlertAudits(alerts);
    const second = dueAlertAudits(alerts);
    expect(first).toHaveLength(1);
    expect(second).toHaveLength(0);
  });

  it('cooldown otgach yana qaytadi', () => {
    const alerts = [{ id: 'a1', severity: 'warning', title: 'x' }];
    dueAlertAudits(alerts, { now: 1000 });
    const due = dueAlertAudits(alerts, { now: 1000 + 16 * 60 * 1000 });
    expect(due).toHaveLength(1);
  });
});
