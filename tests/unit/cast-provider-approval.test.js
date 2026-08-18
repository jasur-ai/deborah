/**
 * Edikit — Cast C4-07 Provider Registry SLA + Approval Gate Tests
 * ----------------------------------------------------------------
 * coverage: SLA fields (region/subprocessors/training/retention/deletion,
 *           item 15), provider approval gate (item 16).
 */

import { describe, it, expect } from 'vitest';
import {
  CLUSTERING_PROVIDERS,
  CLUSTERING_PROVIDER_POLICIES,
  getClusteringProvider,
  providerApprovalStatus,
  assertProviderApproved,
  assertApprovedBuild,
} from '../../services/cast/provider-registry.js';

describe('C4-07: provider SLA fields (item 15)', () => {
  it('har provider SLA bor: region/dataFields/subprocessors/training/retention/deletion', () => {
    for (const p of Object.values(CLUSTERING_PROVIDER_POLICIES)) {
      expect(p.sla).toBeTruthy();
      expect(typeof p.sla.region).toBe('string');
      expect(Array.isArray(p.sla.dataFields)).toBe(true);
      expect(Array.isArray(p.sla.subprocessors)).toBe(true);
      expect(typeof p.sla.training).toBe('boolean');
      expect(typeof p.sla.deletionSlaHours).toBe('number');
    }
  });

  it('LOCAL — built-in, region local, subprocessors empty', () => {
    const p = getClusteringProvider(CLUSTERING_PROVIDERS.LOCAL);
    expect(p.sla.region).toBe('local');
    expect(p.sla.subprocessors).toEqual([]);
    expect(p.approved).toBe(true);
  });

  it('EXTERNAL — default NOT approved, region UNKNOWN', () => {
    const p = getClusteringProvider(CLUSTERING_PROVIDERS.EXTERNAL);
    expect(p.sla.region).toBe('UNKNOWN');
    expect(p.approved).toBe(false);
  });
});

describe('C4-07: provider approval gate (item 16)', () => {
  it('LOCAL always approved (BUILTIN_LOCAL)', () => {
    const st = providerApprovalStatus(CLUSTERING_PROVIDERS.LOCAL);
    expect(st.approved).toBe(true);
    expect(st.reason).toBe('BUILTIN_LOCAL');
  });

  it("EXTERNAL — env approval'siz NOT_APPROVED + throw", () => {
    const prev = process.env.CAST_CLUSTERING_PROVIDER_APPROVED;
    delete process.env.CAST_CLUSTERING_PROVIDER_APPROVED;
    try {
      const st = providerApprovalStatus(CLUSTERING_PROVIDERS.EXTERNAL);
      expect(st.approved).toBe(false);
      expect(st.reason).toBe('NOT_APPROVED');
      expect(() => assertProviderApproved(CLUSTERING_PROVIDERS.EXTERNAL)).toThrow(/approved emas/);
    } finally {
      if (prev !== undefined) process.env.CAST_CLUSTERING_PROVIDER_APPROVED = prev;
    }
  });

  it('EXTERNAL — env approval bilan approved', () => {
    const prev = process.env.CAST_CLUSTERING_PROVIDER_APPROVED;
    process.env.CAST_CLUSTERING_PROVIDER_APPROVED = '1';
    try {
      const st = providerApprovalStatus(CLUSTERING_PROVIDERS.EXTERNAL);
      expect(st.approved).toBe(true);
      expect(st.reason).toBe('ENV_APPROVED');
    } finally {
      if (prev !== undefined) process.env.CAST_CLUSTERING_PROVIDER_APPROVED = prev;
    }
  });

  it('assertApprovedBuild — unapproved external build bloklanadi', () => {
    const prevProvider = process.env.CAST_CLUSTERING_PROVIDER;
    const prevUrl = process.env.CAST_CLUSTERING_API_URL;
    const prevKey = process.env.CAST_CLUSTERING_API_KEY;
    const prevApproved = process.env.CAST_CLUSTERING_PROVIDER_APPROVED;
    // Active provider'ni external qilish uchun 3 env kerak
    process.env.CAST_CLUSTERING_PROVIDER = 'external';
    process.env.CAST_CLUSTERING_API_URL = 'https://example.test/cluster';
    process.env.CAST_CLUSTERING_API_KEY = 'k';
    delete process.env.CAST_CLUSTERING_PROVIDER_APPROVED;
    try {
      const r = assertApprovedBuild(true);
      expect(r.ok).toBe(false);
      expect(r.blocked).toBe(true);
    } finally {
      if (prevProvider !== undefined) process.env.CAST_CLUSTERING_PROVIDER = prevProvider;
      else delete process.env.CAST_CLUSTERING_PROVIDER;
      if (prevUrl !== undefined) process.env.CAST_CLUSTERING_API_URL = prevUrl;
      else delete process.env.CAST_CLUSTERING_API_URL;
      if (prevKey !== undefined) process.env.CAST_CLUSTERING_API_KEY = prevKey;
      else delete process.env.CAST_CLUSTERING_API_KEY;
      if (prevApproved !== undefined) process.env.CAST_CLUSTERING_PROVIDER_APPROVED = prevApproved;
      else delete process.env.CAST_CLUSTERING_PROVIDER_APPROVED;
    }
  });
});
