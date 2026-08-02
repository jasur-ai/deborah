/**
 * Edikit — Telemetry e2e/security tests (Prompt 69 §20)
 *
 * Synthetic incident senariylari:
 *   - Provider error rate spayki → circuit alert fire bo'ladi + runbook link
 *   - Quota limit → critical alert
 *   - Cost budget oshishi → alert
 *   - SLO burn (answer save errors) → critical burn alert
 *   - Redaction: token/answer key hech qanday span/log'ga tushmaydi
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { createApp } from '../../server.js';
import CONFIG from '../../src/config/env.js';
import { snapshotDb, restoreDb } from '../helpers/setup.js';
import {
  clearSpans,
  clearMetrics,
  incrementCounter,
  setGauge,
  observeHistogram,
  telemetrySnapshot,
  getSpans,
} from '../../src/telemetry/index.js';

let app;
let httpServer;
let agent;

beforeAll(async () => {
  snapshotDb();
  const result = await createApp();
  app = result.app;
  httpServer = result.httpServer;
  await new Promise((resolve) => httpServer.listen(0, resolve));

  const supertest = (await import('supertest')).default;
  agent = supertest.agent(app);
  const page = await agent.get('/admin/login');
  const m = page.text.match(/name="_csrf"\s+value="([^"]+)"/);
  await agent.post('/admin/login').type('form').send({
    username: CONFIG.ADMIN_USER,
    password: CONFIG.ADMIN_PASS,
    _csrf: m ? m[1] : '',
  });
});

afterAll(async () => {
  await new Promise((resolve) => httpServer.close(resolve));
  restoreDb();
});

beforeEach(() => {
  clearSpans();
  clearMetrics();
});

// ═══════════════════════════════════════════════════════════════════
// SYNTHETIC INCIDENT: PROVIDER OUTAGE
// ═══════════════════════════════════════════════════════════════════

describe('synthetic incident — provider circuit (research §38.5)', () => {
  it('provider error spike opens the circuit with runbook link', () => {
    // 30/100 xatolar (30%) → circuit OPEN
    for (let i = 0; i < 100; i++) {
      incrementCounter('edikit_provider_requests_total', {}, { value: 1, labels: { provider: 'gamma', status: i < 30 ? '500' : '200' } });
    }
    incrementCounter('edikit_provider_errors_total', {}, { value: 30, labels: { provider: 'gamma', status: '500' } });

    const snap = telemetrySnapshot();
    const fired = snap.alerts.find((a) => a.id === 'provider_circuit_open');
    expect(fired).toBeTruthy();
    expect(fired.severity).toBe('critical');
    expect(fired.runbook).toContain('runbooks/provider-outage');
  });
});

// ═══════════════════════════════════════════════════════════════════
// SYNTHETIC INCIDENT: QUOTA + COST
// ═══════════════════════════════════════════════════════════════════

describe('synthetic incident — quota & cost alerts', () => {
  it('quota near limit fires critical alert', () => {
    setGauge('edikit_provider_quota_fraction', 0.98, { labels: { provider: 'manus' } });
    const snap = telemetrySnapshot();
    const fired = snap.alerts.find((a) => a.id === 'provider_quota_manus');
    expect(fired).toBeTruthy();
    expect(fired.severity).toBe('critical');
  });

  it('cost over budget fires alert', () => {
    incrementCounter('edikit_provider_cost_cents_total', {}, { value: 75000 }); // $750
    const snap = telemetrySnapshot({ costBudgetCents: 50000 });
    expect(snap.alerts.some((a) => a.id === 'ai_cost_over_budget')).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════
// SYNTHETIC INCIDENT: SLO BURN
// ═══════════════════════════════════════════════════════════════════

describe('synthetic incident — SLO burn (research §38.4)', () => {
  it('answer save error surge triggers critical burn alert', () => {
    // 1000 ta javob saqlash, 400 tasi xato (40%)
    for (let i = 0; i < 1000; i++) observeHistogram('edikit_answer_save_duration', 120, {});
    incrementCounter('edikit_answer_save_errors_total', {}, { value: 400 });

    const snap = telemetrySnapshot({ sinceMs: 30 * 86400000 });
    const slo = snap.slos.find((s) => s.id === 'answer_save_availability');
    expect(slo.ok).toBe(false);
    expect(slo.level).toBe('critical');
    expect(snap.alerts.some((a) => a.id === 'slo_critical_answer_save_availability')).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════
// REDACTION — REAL HTTP FLOW
// ═══════════════════════════════════════════════════════════════════

describe('redaction — real HTTP flow', () => {
  it('http spans never contain answer keys or tokens', async () => {
    clearSpans();
    await agent.get('/health');
    const spans = getSpans();
    const blob = JSON.stringify(spans);
    expect(blob).not.toMatch(/q_correct|answerKey|eyJhbGciOiJ/);
  });

  it('observability JSON never contains secrets', async () => {
    const res = await agent.get('/admin/api/observability');
    expect(res.status).toBe(200);
    const blob = JSON.stringify(res.body);
    expect(blob).not.toContain(CONFIG.ADMIN_PASS);
    expect(blob).not.toContain('password');
  });
});
