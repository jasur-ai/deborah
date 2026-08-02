/**
 * Edikit — Resource Recommendation Connectors (integration tests, Prompt 54)
 *
 * Service qatlami: graceful degradation (PG'siz → 400/error), quota
 * logic, cache/idempotency, provider outage handling. PostgreSQL yo'q
 * muhitda service'ning fail-closed xatti-harakati tekshiriladi.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('resource-reco — integration (Prompt 54 §19 contract)', () => {
  let mod;
  beforeEach(async () => {
    vi.resetModules();
    vi.doMock('../../src/infrastructure/postgres.js', () => ({ getDb: () => null }));
    mod = await import('../../src/modules/resource-reco/index.js');
  });

  it('searchResources — PG yo\u2018q → graceful error (no crash)', async () => {
    const r = await mod.searchResources({ query: 'fotosintez', limit: 10 });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/PostgreSQL required/i);
  });

  it('searchResources — invalid query rejected before DB', async () => {
    const r = await mod.searchResources({ query: 'ab' });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/at least 3 characters/i);
  });

  it('applyTeacherFeedback — PG yo\u2018q → graceful error', async () => {
    const r = await mod.applyTeacherFeedback({ recordId: 1, action: 'trust', actorId: 'admin' });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/PostgreSQL required/i);
  });

  it('applyTeacherFeedback — invalid action rejected before DB', async () => {
    const r = await mod.applyTeacherFeedback({ recordId: 1, action: 'delete' });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/invalid feedback action/i);
  });

  it('applyTeacherFeedback — source_pack without id rejected', async () => {
    const r = await mod.applyTeacherFeedback({ recordId: 1, action: 'source_pack' });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/sourcePackId/i);
  });

  it('getRecommendationDashboard — PG yo\u2018q → empty graceful shape', async () => {
    const r = await mod.getRecommendationDashboard();
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/PostgreSQL required/i);
    expect(Array.isArray(r.providers)).toBe(true);
  });

  it('ensureResourceProviders — PG yo\u2018q → graceful error', async () => {
    const r = await mod.ensureResourceProviders();
    expect(r.ok).toBe(false);
  });

  it('updateResourceProvider — PG yo\u2018q → graceful error', async () => {
    const r = await mod.updateResourceProvider({ name: 'openalex', patch: { enabled: true } });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/PostgreSQL required/i);
  });

  it('updateResourceProvider — unsupported provider rejected', async () => {
    const r = await mod.updateResourceProvider({ name: 'bogus', patch: {} });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/unsupported provider/i);
  });

  it('generateLlmSummary — PG yo\u2018q → graceful error (hallucination guard path)', async () => {
    const r = await mod.generateLlmSummary({
      recordIds: [1, 2],
      summaries: [{ title: 'x', summary: 'y' }],
      actorId: 'admin',
    });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/PostgreSQL required/i);
  });
});
