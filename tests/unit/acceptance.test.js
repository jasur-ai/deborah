/**
 * Edikit — Final System Acceptance (unit, Prompt 73)
 *
 * Pure logic tests for src/modules/acceptance/schema:
 *   - Acceptance domains + evidence evaluation
 *   - Sign-off FSM transitions
 *   - Release gate (all domains signed)
 *   - Deferred high-risk guard + marketing claim guard (item 15)
 *   - Next-version backlog validation
 *   - Write-path guard (item 16)
 */

import { describe, it, expect } from 'vitest';
import {
  ACCEPTANCE_DOMAINS,
  SIGN_OFF_STATUS,
  assertSignOffTransition,
  evaluateDomainEvidence,
  evaluateReleaseGate,
  assertDeferredHighRiskDisabled,
  assertClaimHasEvidence,
  validateBacklogItem,
  BACKLOG_PRIORITY,
  assertWritePathGuard,
} from '../../src/modules/acceptance/acceptance.schema.js';

// ═══════════════════════════════════════════════════════════════════
// 1. DOMAINS & EVIDENCE (items 07–13)
// ═══════════════════════════════════════════════════════════════════

describe('acceptance domains', () => {
  it('defines the 8 sign-off domains', () => {
    const ids = ACCEPTANCE_DOMAINS.map((d) => d.id);
    expect(ids).toContain('security');
    expect(ids).toContain('reliability-dr');
    expect(ids).toContain('assessment');
    expect(ids).toContain('privacy-legal');
    expect(ids).toContain('accessibility');
    expect(ids).toContain('ai-governance');
    expect(ids).toContain('operations');
    expect(ids).toContain('product');
  });

  it('every domain has evidence items', () => {
    for (const d of ACCEPTANCE_DOMAINS) {
      expect(d.evidence.length).toBeGreaterThanOrEqual(1);
    }
  });
});

describe('domain evidence evaluation', () => {
  it('passes when all evidence provided with owner', () => {
    // Use the product domain (no pen-test/DSAR/RPO critical-risk evidence).
    const domain = ACCEPTANCE_DOMAINS.find((d) => d.id === 'product');
    const provided = Object.fromEntries(domain.evidence.map((e) => [e, 'art_1']));
    const res = evaluateDomainEvidence({ domainId: domain.id, provided, owner: 'owner' });
    expect(res.ok).toBe(true);
  });

  it('passes security domain with all evidence + critical-risk owner', () => {
    const domain = ACCEPTANCE_DOMAINS.find((d) => d.id === 'security');
    const provided = Object.fromEntries(domain.evidence.map((e) => [e, 'art_1']));
    const res = evaluateDomainEvidence({ domainId: domain.id, provided, owner: 'owner', criticalRiskOwner: 'risk-owner' });
    expect(res.ok).toBe(true);
  });

  it('rejects missing evidence', () => {
    const domain = ACCEPTANCE_DOMAINS[0];
    const res = evaluateDomainEvidence({ domainId: domain.id, provided: {}, owner: 'owner' });
    expect(res.ok).toBe(false);
    expect(res.missing.length).toBeGreaterThan(0);
  });

  it('rejects unknown domain', () => {
    expect(evaluateDomainEvidence({ domainId: 'nope', provided: {}, owner: 'o' }).ok).toBe(false);
  });

  it('requires a critical-risk owner when risk evidence present', () => {
    const domain = ACCEPTANCE_DOMAINS.find((d) => d.id === 'reliability-dr');
    const provided = Object.fromEntries(domain.evidence.map((e) => [e, 'art_1']));
    // reliability evidence includes 'backup restore RPO/RTO' → /rpo|rto/ matches
    const res = evaluateDomainEvidence({
      domainId: 'reliability-dr',
      provided,
      owner: 'owner',
      criticalRiskOwner: '',
    });
    expect(res.ok).toBe(false);
    expect(res.reason).toMatch(/risk owner/);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 2. SIGN-OFF FSM
// ═══════════════════════════════════════════════════════════════════

describe('sign-off FSM', () => {
  it('moves evidence-submitted → reviewed → signed-off', () => {
    expect(assertSignOffTransition({ from: SIGN_OFF_STATUS.SUBMITTED, to: SIGN_OFF_STATUS.REVIEWED }).ok).toBe(true);
    expect(assertSignOffTransition({ from: SIGN_OFF_STATUS.REVIEWED, to: SIGN_OFF_STATUS.SIGNED }).ok).toBe(true);
  });

  it('review can mark blocked; blocked can be re-reviewed', () => {
    expect(assertSignOffTransition({ from: SIGN_OFF_STATUS.SUBMITTED, to: SIGN_OFF_STATUS.BLOCKED }).ok).toBe(true);
    expect(assertSignOffTransition({ from: SIGN_OFF_STATUS.BLOCKED, to: SIGN_OFF_STATUS.REVIEWED }).ok).toBe(true);
  });

  it('signed-off is terminal', () => {
    expect(assertSignOffTransition({ from: SIGN_OFF_STATUS.SIGNED, to: SIGN_OFF_STATUS.REVIEWED }).ok).toBe(false);
    expect(assertSignOffTransition({ from: SIGN_OFF_STATUS.SIGNED, to: SIGN_OFF_STATUS.BLOCKED }).ok).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 3. RELEASE GATE (items 14, 25)
// ═══════════════════════════════════════════════════════════════════

describe('release gate', () => {
  it('passes when all 8 domains signed', () => {
    const signed = Object.fromEntries(ACCEPTANCE_DOMAINS.map((d) => [d.id, true]));
    const res = evaluateReleaseGate({ signed });
    expect(res.ok).toBe(true);
    expect(res.domainsSigned).toBe(8);
  });

  it('blocks and lists unsigned domains', () => {
    const res = evaluateReleaseGate({ signed: { security: true } });
    expect(res.ok).toBe(false);
    expect(res.blocks).toContain('product');
    expect(res.domainsSigned).toBe(1);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 4. GUARDS (item 15)
// ═══════════════════════════════════════════════════════════════════

describe('deferred high-risk guard', () => {
  it('deferred features must be disabled at release', () => {
    const res = assertDeferredHighRiskDisabled({ deferred: ['seb-browser'], enabled: ['seb-browser'] });
    expect(res.ok).toBe(false);
    expect(res.illegallyEnabled).toContain('seb-browser');
  });

  it('passes when deferred features are not enabled', () => {
    expect(assertDeferredHighRiskDisabled({ deferred: ['seb-browser'], enabled: [] }).ok).toBe(true);
  });
});

describe('marketing claim guard', () => {
  it('claim must map to test evidence', () => {
    const res = assertClaimHasEvidence({ claims: ['ISO 27001 certified'], evidenceMap: { 'ASVS v5.0': true } });
    expect(res.ok).toBe(false);
    expect(res.unsupportedClaims).toContain('ISO 27001 certified');
  });

  it('passes when all claims map to evidence', () => {
    expect(assertClaimHasEvidence({ claims: ['ASVS v5.0'], evidenceMap: { 'ASVS v5.0': true } }).ok).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 5. BACKLOG (item 14)
// ═══════════════════════════════════════════════════════════════════

describe('next-version backlog', () => {
  it('validates backlog items', () => {
    expect(BACKLOG_PRIORITY).toContain('high');
    expect(validateBacklogItem({ title: 'Annual pen-test', priority: 'high', owner: 'sec', reason: 'deferred' }).ok).toBe(true);
    expect(validateBacklogItem({ title: '', priority: 'high', owner: 'sec', reason: 'd' }).ok).toBe(false);
    expect(validateBacklogItem({ title: 'x', priority: 'urgent', owner: 'sec', reason: 'd' }).ok).toBe(false);
    expect(validateBacklogItem({ title: 'x', priority: 'high', owner: '', reason: 'd' }).ok).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 6. WRITE-PATH GUARD (item 16)
// ═══════════════════════════════════════════════════════════════════

describe('write-path guard', () => {
  it('requires tenant scope + authorization + validation + idempotency', () => {
    expect(assertWritePathGuard({ tenantScoped: true, authorized: true, validated: true, idempotent: true }).ok).toBe(true);
    const res = assertWritePathGuard({ tenantScoped: true, authorized: true, validated: true, idempotent: false });
    expect(res.ok).toBe(false);
    expect(res.blocks).toContain('idempotency');
  });
});
