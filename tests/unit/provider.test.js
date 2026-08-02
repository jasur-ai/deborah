/**
 * Edikit — Unified Provider Async Adapter (unit tests, Prompt 58)
 *
 * Pure schema + client tekshiruvi (no DB/network):
 *   - validateProviderRequest + requestHash (idempotency)
 *   - PresentationProvider interface (Prompt 56 precondition)
 *   - buildGammaCreatePayload / parseGammaStatusResponse (polling FSM)
 *   - computePollDelay / shouldRetryError / evaluateCircuitState
 *   - buildManusCreateTaskPayload
 *   - processWebhookOutOfOrder (seq dedupe/replay/buffer)
 *   - verifyWebhookSignature (HMAC timing-safe)
 *   - mapGammaArtifacts / mapManusArtifacts (expiring → copy)
 *   - assertNoStudentPii (§15)
 *   - buildAttributionMetadata + validateJobStatusTransition
 *   - Client mocked contract (gammaCreate / gammaPoll / manusCreateTask)
 */

import { describe, it, expect, vi } from 'vitest';
import { createHmac } from 'crypto';
import {
  validateProviderRequest,
  requestHash,
  PresentationProvider,
  buildGammaCreatePayload,
  parseGammaStatusResponse,
  computePollDelay,
  shouldRetryError,
  evaluateCircuitState,
  buildManusCreateTaskPayload,
  processWebhookOutOfOrder,
  constantTimeEqual,
  mapGammaArtifacts,
  mapManusArtifacts,
  assertNoStudentPii,
  buildAttributionMetadata,
  validateJobStatusTransition,
  JOB_STATUS,
  PROVIDERS,
  PROVIDER_CAPABILITIES,
  gammaCreate,
  gammaPoll,
  manusCreateTask,
} from '../../src/modules/provider/index.js';

// ═══════════════════════════════════════════════════════════════════
// REQUEST VALIDATION + IDEMPOTENCY (§58-16)
// ═══════════════════════════════════════════════════════════════════

describe('provider — request validation & idempotency (Prompt 58 §05/16)', () => {
  const valid = { provider: 'gamma', title: 'Fotosintez', language: 'uz', numCards: 10 };

  it('accepts a valid request', () => {
    expect(validateProviderRequest(valid).ok).toBe(true);
  });

  it('rejects missing/invalid provider', () => {
    expect(validateProviderRequest({ ...valid, provider: null }).ok).toBe(false);
    expect(validateProviderRequest({ ...valid, provider: 'canva' }).ok).toBe(false);
  });

  it('rejects missing title and unsupported language', () => {
    expect(validateProviderRequest({ ...valid, title: '' }).ok).toBe(false);
    expect(validateProviderRequest({ ...valid, language: 'xx' }).ok).toBe(false);
  });

  it('rejects numCards out of range (3..30)', () => {
    expect(validateProviderRequest({ ...valid, numCards: 2 }).ok).toBe(false);
    expect(validateProviderRequest({ ...valid, numCards: 99 }).ok).toBe(false);
    expect(validateProviderRequest({ ...valid, numCards: 'abc' }).ok).toBe(false);
  });

  it('requestHash is deterministic and order-insensitive for sourcePackIds', () => {
    const a = requestHash({ provider: 'gamma', title: 'X', sourcePackIds: [1, 2] });
    const b = requestHash({ provider: 'gamma', title: 'X', sourcePackIds: [2, 1] });
    expect(a).toBe(b);
    const c = requestHash({ provider: 'gamma', title: 'Y', sourcePackIds: [1, 2] });
    expect(a).not.toBe(c);
  });
});

// ═══════════════════════════════════════════════════════════════════
// PresentationProvider INTERFACE (Prompt 56 precondition)
// ═══════════════════════════════════════════════════════════════════

describe('provider — PresentationProvider interface (Prompt 58 §07)', () => {
  const complete = {
    name: 'gamma',
    capabilities: PROVIDER_CAPABILITIES[PROVIDERS.GAMMA],
    create: () => {}, poll: () => {}, cancel: () => {}, webhook: () => {}, mapArtifacts: () => {},
  };

  it('accepts a complete adapter', () => {
    expect(PresentationProvider.validate(complete).ok).toBe(true);
  });

  it('rejects an adapter missing contract methods', () => {
    expect(PresentationProvider.validate({ name: 'gamma' }).ok).toBe(false);
    const r = PresentationProvider.validate({ name: 'gamma', capabilities: {}, create: () => {} });
    expect(r.error).toMatch(/poll|cancel|webhook|mapArtifacts/);
  });

  it('capability matrix is honest — Gamma has NO embedded edit', () => {
    expect(PROVIDER_CAPABILITIES.gamma.embeddedEdit).toBe(false);
    expect(PROVIDER_CAPABILITIES.gamma.create).toBe(true);
    expect(PROVIDER_CAPABILITIES.manus.webhook).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════
// GAMMA — PAYLOAD + POLLING FSM (§58-08)
// ═══════════════════════════════════════════════════════════════════

describe('provider — Gamma payload & polling FSM (Prompt 58 §08)', () => {
  it('builds Gamma v1 generations payload', () => {
    const p = buildGammaCreatePayload({ title: 'Fotosintez', audience: '8-sinf', language: 'uz', theme: 'academic', tone: 'formal', numCards: 10, sourcePackIds: [1] });
    expect(p.format).toBe('presentation');
    expect(p.numCards).toBe(10);
    expect(p.theme).toBe('academic');
    expect(p.prompt).toContain('Fotosintez');
    expect(p.prompt).toContain('10 slayd');
    expect(p.images).toEqual([]);
  });

  it('parses Gamma completed status with preview/export URLs', () => {
    const r = parseGammaStatusResponse({ status: 'completed', gammaUrl: 'https://gamma.app/p/abc', exportUrl: 'https://gamma.app/export/abc.pdf' });
    expect(r.status).toBe(JOB_STATUS.COMPLETED);
    expect(r.previewUrl).toContain('gamma.app/p/');
    expect(r.exportUrl).toContain('.pdf');
  });

  it('maps Gamma failed/cancelled/pending statuses', () => {
    expect(parseGammaStatusResponse({ status: 'failed' }).status).toBe(JOB_STATUS.FAILED);
    expect(parseGammaStatusResponse({ status: 'cancelled' }).status).toBe(JOB_STATUS.CANCELLED);
    expect(parseGammaStatusResponse({ status: 'generating' }).status).toBe(JOB_STATUS.RUNNING);
    expect(parseGammaStatusResponse({ status: 'pending' }).status).toBe(JOB_STATUS.RUNNING);
  });

  it('computePollDelay backoffs from 5s, capped at 60s', () => {
    expect(computePollDelay(0)).toBe(5000);
    expect(computePollDelay(1)).toBe(7000);
    expect(computePollDelay(100)).toBeLessThanOrEqual(60000);
  });

  it('shouldRetryError on 429/500/529, not on 400', () => {
    expect(shouldRetryError(429)).toBe(true);
    expect(shouldRetryError(500)).toBe(true);
    expect(shouldRetryError(529)).toBe(true);
    expect(shouldRetryError(400)).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════
// MANUS — PAYLOAD + WEBHOOK VERIFY + OUT-OF-ORDER (§58-10/11)
// ═══════════════════════════════════════════════════════════════════

describe('provider — Manus payload & signed webhook (Prompt 58 §10/11)', () => {
  it('builds Manus v2 task.create payload', () => {
    const p = buildManusCreateTaskPayload({ title: 'Fotosintez', projectId: 'proj_1', fileIds: ['f1', 'f2'], brief: 'Research qiling', language: 'uz' });
    expect(p.projectId).toBe('proj_1');
    expect(p.fileIds).toEqual(['f1', 'f2']);
    expect(p.prompt).toContain('Research');
  });

  it('verifies HMAC-SHA256 webhook signature (timing-safe)', () => {
    const secret = 'webhook-secret';
    const body = '{"taskId":"t1","seq":3,"event":"task.completed"}';
    const expected = createHmac('sha256', secret).update(body, 'utf8').digest('hex');
    const provided = 'sha256=' + expected;
    // Signature parse: strip prefix and compare
    const sigHex = provided.slice(7);
    expect(constantTimeEqual(sigHex, expected)).toBe(true);
    expect(constantTimeEqual(sigHex, 'deadbeef')).toBe(false);
  });

  it('out-of-order seq handling — dedupe, accept, buffer', () => {
    // Replay (duplicate)
    expect(processWebhookOutOfOrder({ seq: 3, lastSeen: 3 }).duplicate).toBe(true);
    expect(processWebhookOutOfOrder({ seq: 2, lastSeen: 5 }).duplicate).toBe(true);
    // In-order accept
    const acc = processWebhookOutOfOrder({ seq: 4, lastSeen: 3 });
    expect(acc.accept).toBe(true);
    expect(acc.seq).toBe(4);
    // Out-of-order → buffer with gap
    const buf = processWebhookOutOfOrder({ seq: 7, lastSeen: 3 });
    expect(buf.buffered).toBe(true);
    expect(buf.gap).toBe(3);
  });

  it('rejects invalid seq', () => {
    expect(processWebhookOutOfOrder({ seq: 0, lastSeen: 0 }).ok).toBe(false);
    expect(processWebhookOutOfOrder({ seq: 'x', lastSeen: 0 }).ok).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════
// ARTIFACT MAPPING (§58-09/12 — expiring → object storage copy)
// ═══════════════════════════════════════════════════════════════════

describe('provider — artifact mapping (Prompt 58 §09/12)', () => {
  it('maps Gamma preview + export artifacts as expiring', () => {
    const arts = mapGammaArtifacts({ previewUrl: 'https://gamma.app/p/abc', exportUrl: 'https://gamma.app/x/deck.pdf' });
    expect(arts.length).toBe(2);
    expect(arts.some((a) => a.kind === 'preview' && a.expiring)).toBe(true);
    expect(arts.some((a) => a.kind === 'export' && a.format === 'pdf' && a.expiring)).toBe(true);
  });

  it('maps Manus viewer + artifact files', () => {
    const arts = mapManusArtifacts({ viewerUrl: 'https://manus.ai/view/123', artifacts: [{ url: 'https://manus.ai/dl/123.pptx', kind: 'export' }] });
    expect(arts.length).toBe(2);
    expect(arts.some((a) => a.format === 'pptx')).toBe(true);
  });

  it('returns [] for no urls', () => {
    expect(mapGammaArtifacts({})).toEqual([]);
    expect(mapManusArtifacts({})).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════
// CIRCUIT / PII / ATTRIBUTION / FSM (§58-13/15)
// ═══════════════════════════════════════════════════════════════════

describe('provider — circuit, PII, attribution, FSM (Prompt 58 §13/15)', () => {
  it('circuit breaker open → half_open → closed', () => {
    expect(evaluateCircuitState({ failureCount: 0 })).toBe('closed');
    expect(evaluateCircuitState({ failureCount: 7 })).toBe('open');
    expect(evaluateCircuitState({ failureCount: 7, openUntil: new Date(Date.now() - 1000) })).toBe('half_open');
    expect(evaluateCircuitState({ failureCount: 7, openUntil: new Date(Date.now() + 5000) })).toBe('open');
  });

  it('PII guard redacts email/phone by default', () => {
    const r = assertNoStudentPii('Student aziza@mail.uz +998901234567 matni');
    expect(r.ok).toBe(false);
    expect(r.redacted).not.toContain('aziza@mail.uz');
    expect(r.redacted).not.toContain('998901234567');
  });

  it('buildAttributionMetadata labels provider honestly', () => {
    const a = buildAttributionMetadata({ provider: 'gamma', model: 'gamma-v1', jobId: 'g1' });
    expect(a.provider).toBe('gamma');
    expect(a.label).toMatch(/Gamma/i);
    expect(a.aiAssisted).toBe(true);
  });

  it('validates job transitions', () => {
    expect(validateJobStatusTransition(JOB_STATUS.QUEUED, JOB_STATUS.RUNNING).ok).toBe(true);
    expect(validateJobStatusTransition(JOB_STATUS.RUNNING, JOB_STATUS.WEBHOOK_PENDING).ok).toBe(true);
    expect(validateJobStatusTransition(JOB_STATUS.WEBHOOK_PENDING, JOB_STATUS.COMPLETED).ok).toBe(true);
    expect(validateJobStatusTransition(JOB_STATUS.COMPLETED, JOB_STATUS.RUNNING).ok).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════
// PROVIDER CLIENT — MOCKED CONTRACT TEST (§58-18 Gamma polling)
// ═══════════════════════════════════════════════════════════════════

describe('provider — client mocked contract (Prompt 58 §18)', () => {
  it('gammaCreate — missing api key → not configured', async () => {
    const r = await gammaCreate({ payload: {}, apiKey: null });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/not configured/i);
  });

  it('gammaCreate — 429 then success → retries (contract)', async () => {
    let calls = 0;
    const fakeFetch = vi.fn(async () => {
      calls++;
      if (calls === 1) return { status: 429, ok: false };
      return { status: 200, ok: true, json: async () => ({ id: 'gen_123' }), text: async () => '' };
    });
    const r = await gammaCreate({ payload: { title: 'X' }, apiKey: 'sk-test', fetchImpl: fakeFetch });
    expect(r.ok).toBe(true);
    expect(r.providerJobId).toBe('gen_123');
    expect(calls).toBe(2);
  });

  it('gammaPoll — parses completed response', async () => {
    const fakeFetch = vi.fn(async () => ({
      status: 200,
      ok: true,
      json: async () => ({ id: 'gen_123', status: 'completed', gammaUrl: 'https://gamma.app/p/1' }),
      text: async () => '',
    }));
    const r = await gammaPoll({ providerJobId: 'gen_123', apiKey: 'sk-test', fetchImpl: fakeFetch });
    expect(r.ok).toBe(true);
    expect(r.raw.status).toBe('completed');
  });

  it('manusCreateTask — missing api key → not configured', async () => {
    const r = await manusCreateTask({ payload: {}, apiKey: null });
    expect(r.ok).toBe(false);
  });
});
