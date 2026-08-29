/**
 * Deborah — Unified Provider Async Adapter (e2e/security tests, Prompt 58)
 *
 * E2E flow: create → poll → artifact copy (stop condition: expiring
 * artifact copy qilinadi) va provider failure → dead-letter.
 * Security (§15-17):
 *   - API key hech qachon output/attribution'da ko'rinmaydi.
 *   - Gamma embedded edit capability yo'q — soxta edit ko'rsatilmaydi.
 *   - Student PII default redact qilinadi.
 *   - Har bir write path tenant-scoped + idempotent.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  validateProviderRequest,
  requestHash,
  buildGammaCreatePayload,
  parseGammaStatusResponse,
  mapGammaArtifacts,
  assertNoStudentPii,
  buildAttributionMetadata,
  gammaCreate,
  gammaPoll,
  downloadArtifact,
  PROVIDER_CAPABILITIES,
  JOB_STATUS,
} from '../../src/modules/provider/index.js';

describe('provider — e2e create→poll→artifact copy (Prompt 58 §20)', () => {
  const sourcePackIds = [1, 2];

  it('E2E: validate → payload → create → poll completed → artifact mapping (expiring copy)', async () => {
    // 1. Validate request
    const v = validateProviderRequest({ provider: 'gamma', title: 'Fotosintez', language: 'uz', numCards: 10, sourcePackIds });
    expect(v.ok).toBe(true);

    // 2. Build Gamma payload
    const payload = buildGammaCreatePayload({ title: 'Fotosintez', language: 'uz', theme: 'academic', numCards: 10, sourcePackIds });
    expect(payload.format).toBe('presentation');

    // 3. Create generation (mocked client — no real API key)
    const fakeCreate = vi.fn(async () => ({ status: 200, ok: true, json: async () => ({ id: 'gen_42' }), text: async () => '' }));
    const created = await gammaCreate({ payload, apiKey: 'sk-test', fetchImpl: fakeCreate });
    expect(created.ok).toBe(true);
    expect(created.providerJobId).toBe('gen_42');

    // 4. Poll → completed with expiring export URL
    const fakePoll = vi.fn(async () => ({
      status: 200,
      ok: true,
      json: async () => ({ id: 'gen_42', status: 'completed', gammaUrl: 'https://gamma.app/p/42', exportUrl: 'https://gamma.app/x/42.pdf', exportFormats: ['pdf', 'pptx'], credits: 9 }),
      text: async () => '',
    }));
    const polled = await gammaPoll({ providerJobId: 'gen_42', apiKey: 'sk-test', fetchImpl: fakePoll });
    expect(polled.ok).toBe(true);

    // 5. Parse status → completed
    const parsed = parseGammaStatusResponse(polled.raw);
    expect(parsed.status).toBe(JOB_STATUS.COMPLETED);

    // 6. Artifact mapping — expiring flag (must be copied to object storage)
    const artifacts = mapGammaArtifacts({ previewUrl: parsed.previewUrl, exportUrl: parsed.exportUrl, exportFormats: polled.raw.exportFormats });
    expect(artifacts.length).toBeGreaterThanOrEqual(2);
    expect(artifacts.every((a) => a.expiring === true)).toBe(true); // stop condition

    // 7. Download expiring artifact (mocked)
    const dl = await downloadArtifact({ url: parsed.exportUrl, fetchImpl: vi.fn(async () => ({ ok: true, arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer, headers: { get: () => 'application/pdf' } })) });
    expect(dl.ok).toBe(true);
    expect(dl.size).toBe(3);

    // 8. Attribution — no API key anywhere
    const meta = buildAttributionMetadata({ provider: 'gamma', model: 'gamma-v1', jobId: 'gen_42' });
    const serialized = JSON.stringify({ meta, artifacts, parsed });
    expect(serialized).not.toMatch(/sk-|api[_-]?key|X-API-KEY|GAMMA_API_KEY/i);
  });

  it('E2E: provider failure → no silent retry loop, error surfaced with status', async () => {
    // Gamma create returns failure → client surfaces error + status (no fake ok)
    const failingCreate = vi.fn(async () => ({ status: 401, ok: false, json: async () => ({ error: 'invalid key' }), text: async () => 'invalid key' }));
    const r = await gammaCreate({ payload: { title: 'X' }, apiKey: 'bad-key', fetchImpl: failingCreate });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Gamma create failed \(401\)/i);
    expect(r.status).toBe(401);

    // 429+ statuses are retryable (shouldRetryError) — 401 is NOT (no infinite loop)
    // Integration test 'webhook — task.failed → dead letter recorded' verifies the
    // service-level dead-letter persistence.
  });

  it('SECURITY: idempotency hash stable across identical requests (no duplicate jobs)', () => {
    const a = requestHash({ provider: 'manus', title: 'Tarix', sourcePackIds: [1, 2], projectId: 'p1' });
    const b = requestHash({ provider: 'manus', title: 'Tarix', sourcePackIds: [2, 1], projectId: 'p1' });
    expect(a).toBe(b);
  });

  it('SECURITY: PII never leaves the boundary (no email/phone in brief/payload)', () => {
    const dirty = 'Student aziz.a@mail.uz +99890 123 45 67 talaba';
    const pii = assertNoStudentPii(dirty);
    expect(pii.ok).toBe(false);
    expect(pii.redacted).not.toMatch(/aziz\.a@|99890/);
  });

  it('SECURITY: capability matrix honest — no fake embedded edit', () => {
    expect(PROVIDER_CAPABILITIES.gamma.embeddedEdit).toBe(false);
    expect(PROVIDER_CAPABILITIES.manus.embeddedEdit).toBe(false);
    // No fake "edit" capability claimed anywhere in the contract
    const caps = JSON.stringify(PROVIDER_CAPABILITIES);
    expect(caps).toContain('"embeddedEdit":false');
  });
});
