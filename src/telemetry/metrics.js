/**
 * Edikit — Metrics Registry (Prompt 69 §10)
 *
 * Platform + domain metrics (research.md §38.1 golden signals, §38.2 domain
 * metrics). OTel Metrics API yuzasiga mos yengil registry:
 *   - Counter: monotonik o'suvchi (so'rovlar, xatolar, rejections)
 *   - Histogram: taqsimot (latency, queue age) — p50/p95/p99 hisoblanadi
 *   - Gauge: hozirgi qiymat (socket connections, queue depth)
 *
 * Metric nomlari otel.convention bo'yicha: <scope>_<name>_<unit?>.
 * Label qiymatlari redaction.js orqali xavfsizlangan.
 */

import { redactLabel } from './redaction.js';

// ── Registry ──
const counters = new Map();    // name -> { value, unit, help, labels: Map(serializedLabel -> value) }
const histograms = new Map();  // name -> { values: number[], unit, help }
const gauges = new Map();      // name -> { value, unit, help, labels: Map(serializedLabel -> value) }

function serializeLabels(labels = {}) {
  const clean = {};
  for (const [k, v] of Object.entries(labels || {})) {
    clean[k] = redactLabel(String(v));
  }
  return JSON.stringify(clean);
}

/**
 * Register/increment a counter metric.
 * @param {string} name
 * @param {{ unit?: string, help?: string }} opts
 * @param {{ value?: number, labels?: object }} data
 */
export function incrementCounter(name, opts = {}, data = {}) {
  const key = `${name}|${opts.unit || ''}`;
  if (!counters.has(key)) {
    counters.set(key, { name, unit: opts.unit || '', help: opts.help || '', values: new Map() });
  }
  const counter = counters.get(key);
  const labelKey = serializeLabels(data.labels);
  counter.values.set(labelKey, (counter.values.get(labelKey) || 0) + (data.value ?? 1));
}

/**
 * Observe a histogram value (latency etc.). Stores raw values; percentiles
 * computed on snapshot.
 * @param {string} name
 * @param {number} value
 * @param {{ unit?: string, help?: string }} opts
 */
export function observeHistogram(name, value, opts = {}) {
  const key = `${name}|${opts.unit || ''}`;
  if (!histograms.has(key)) {
    histograms.set(key, { name, unit: opts.unit || '', help: opts.help || '', values: [] });
  }
  histograms.get(key).values.push(Number(value) || 0);
}

/**
 * Set a gauge value.
 * @param {string} name
 * @param {number} value
 * @param {{ unit?: string, help?: string, labels?: object }} opts
 */
export function setGauge(name, value, opts = {}) {
  const key = `${name}|${opts.unit || ''}`;
  if (!gauges.has(key)) {
    gauges.set(key, { name, unit: opts.unit || '', help: opts.help || '', values: new Map() });
  }
  const gauge = gauges.get(key);
  const labelKey = serializeLabels(opts.labels);
  gauge.values.set(labelKey, Number(value) || 0);
}

/** Percentile helper. */
function percentile(sorted, p) {
  if (!sorted.length) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
}

/**
 * Snapshot all metrics (serializable, redacted labels).
 * @returns {{ counters: object[], histograms: object[], gauges: object[] }}
 */
export function snapshotMetrics() {
  const out = { counters: [], histograms: [], gauges: [] };
  for (const { name, unit, help, values } of counters.values()) {
    for (const [labelKey, value] of values) {
      out.counters.push({ name, unit, help, labels: labelKey === '{}' ? {} : JSON.parse(labelKey), value });
    }
  }
  for (const { name, unit, help, values } of histograms.values()) {
    const sorted = [...values].sort((a, b) => a - b);
    out.histograms.push({
      name, unit, help,
      count: values.length,
      sum: values.reduce((a, b) => a + b, 0),
      p50: percentile(sorted, 50),
      p95: percentile(sorted, 95),
      p99: percentile(sorted, 99),
    });
  }
  for (const { name, unit, help, values } of gauges.values()) {
    for (const [labelKey, value] of values) {
      out.gauges.push({ name, unit, help, labels: labelKey === '{}' ? {} : JSON.parse(labelKey), value });
    }
  }
  return out;
}

/** Clear all metrics (test). */
export function clearMetrics() {
  counters.clear();
  histograms.clear();
  gauges.clear();
}

/**
 * Convenience: record a domain metric from research §38.2.
 * @param {string} name - metric nomi
 * @param {number} value
 * @param {{ type?: 'counter'|'histogram'|'gauge', unit?: string, help?: string, labels?: object }} opts
 */
export function recordMetric(name, value = 1, opts = {}) {
  const type = opts.type || 'counter';
  if (type === 'histogram') return observeHistogram(name, value, opts);
  if (type === 'gauge') return setGauge(name, value, opts);
  return incrementCounter(name, opts, { value, labels: opts.labels });
}

export default { incrementCounter, observeHistogram, setGauge, snapshotMetrics, clearMetrics, recordMetric };
