/**
 * Edikit — Telemetry integration/contract tests (Prompt 69 §19)
 *
 *   - HTTP trace middleware: traceparent header qaytariladi, trace context
 *     HTTP so'rov orqali uzatiladi (research §38.3).
 *   - Span redaction: answer key / token / PII hech qachon span atributlariga
 *     tushmaydi — jumladan request body'da yuborilgan secretlar (research §15).
 *   - /admin/api/observability endpoint faqat admin uchun (requireAdmin).
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createApp } from '../../server.js';
import CONFIG from '../../src/config/env.js';
import { snapshotDb, restoreDb } from '../helpers/setup.js';
import { getSpans, clearSpans } from '../../src/telemetry/index.js';

let app;
let httpServer;
let agent;

beforeAll(async () => {
  snapshotDb();
  clearSpans();
  const result = await createApp();
  app = result.app;
  httpServer = result.httpServer;
  await new Promise((resolve) => httpServer.listen(0, resolve));

  const supertest = (await import('supertest')).default;
  agent = supertest.agent(app);

  // Admin login (CSRF + session)
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

// ═══════════════════════════════════════════════════════════════════
// TRACE PROPAGATION (HTTP)
// ═══════════════════════════════════════════════════════════════════

describe('HTTP trace — propagation', () => {
  it('returns traceparent header on every response', async () => {
    const res = await agent.get('/');
    expect(res.headers.traceparent).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/);
  });

  it('honors incoming traceparent (distributed tracing)', async () => {
    const incoming = '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01';
    const res = await agent.get('/').set('traceparent', incoming);
    // Same traceId propagates through the request
    expect(res.headers.traceparent).toContain('4bf92f3577b34da6a3ce929d0e0e4736');
  });

  it('records http.request spans for real requests', async () => {
    clearSpans();
    await agent.get('/');
    const spans = getSpans();
    const httpSpan = spans.find((s) => s.name === 'http.request');
    expect(httpSpan).toBeTruthy();
    expect(httpSpan.attributes['http.method']).toBe('GET');
    expect(httpSpan.attributes['http.status_code']).toBe(200);
  });
});

// ═══════════════════════════════════════════════════════════════════
// SPAN REDACTION — answer key / token / PII
// ═══════════════════════════════════════════════════════════════════

describe('telemetry redaction — security guard (research §15)', () => {
  it('never leaks secrets sent in request bodies to spans', async () => {
    clearSpans();
    const page = await agent.get('/admin/dashboard');
    const m = page.text.match(/window\.__CSRF_TOKEN\s*=\s*'([^']+)'/);
    const csrf = m ? m[1] : '';

    // Attempt a login with a fake token — spans must not contain it
    await agent.post('/admin/login').type('form').send({
      username: CONFIG.ADMIN_USER,
      password: CONFIG.ADMIN_PASS + '_SECRET',
      _csrf: csrf,
    }).catch(() => {});

    const spans = getSpans();
    const allText = JSON.stringify(spans);
    expect(allText).not.toContain(CONFIG.ADMIN_PASS + '_SECRET');
    expect(allText).not.toContain('SECRET');
  });

  it('span attributes never include answer keys or essay text', async () => {
    clearSpans();
    // Simulate: any span would redact answerKey/essay regardless of source
    const { startSpan, endSpan } = await import('../../src/telemetry/index.js');
    const span = startSpan('test.answer', {
      attributes: {
        answerKey: 'B',
        essay: 'Bu talabaning javob matni...',
        q_correct: 2,
        'db.statement': 'SELECT * FROM questions',
      },
    });
    endSpan(span, { status: 'ok' });
    const spans = getSpans();
    const attrs = spans[spans.length - 1].attributes;
    expect(attrs.answerKey).toBe('[REDACTED]');
    expect(attrs.essay).toBe('[REDACTED]');
    expect(attrs.q_correct).toBe('[REDACTED]');
    expect(attrs['db.statement']).toBe('SELECT * FROM questions'); // legit
  });
});

// ═══════════════════════════════════════════════════════════════════
// OBSERVABILITY API — admin only
// ═══════════════════════════════════════════════════════════════════

describe('observability API', () => {
  it('requires admin auth (redirect for anonymous)', async () => {
    const anon = (await import('supertest')).default(app);
    const res = await anon.get('/admin/api/observability');
    expect([302, 401]).toContain(res.status);
  });

  it('returns metrics + SLO + alerts JSON for admin', async () => {
    const res = await agent.get('/admin/api/observability');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.metrics).toBeTruthy();
    expect(Array.isArray(res.body.slos)).toBe(true);
    expect(Array.isArray(res.body.alerts)).toBe(true);
  });

  it('renders the SLO dashboard HTML for admin', async () => {
    const res = await agent.get('/admin/observability');
    expect(res.status).toBe(200);
    expect(res.text).toContain('Observability');
    expect(res.text).toContain('SLO holati');
    expect(res.text).toContain('Runbook');
  });
});
