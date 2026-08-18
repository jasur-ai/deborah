/**
 * Deborah — Final System Acceptance (integration, Prompt 73)
 *
 * Service-level tests:
 *   - Submit → review → sign-off flow per domain
 *   - Review can block; signed is terminal
 *   - Deferred features + backlog recording
 *   - getReleaseReport gate over all domains
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  resetAcceptanceState,
  submitDomainEvidence,
  reviewDomain,
  signOffDomain,
  recordDeferredFeatures,
  recordBacklogItem,
  getReleaseReport,
} from '../../src/modules/acceptance/acceptance.service.js';
import { ACCEPTANCE_DOMAINS, SIGN_OFF_STATUS } from '../../src/modules/acceptance/acceptance.schema.js';

function fullEvidence(domainId) {
  const d = ACCEPTANCE_DOMAINS.find((x) => x.id === domainId);
  return Object.fromEntries(d.evidence.map((e) => [e, 'art_' + e.replace(/[^a-z0-9]/gi, '_')]));
}

describe('sign-off flow', () => {
  beforeEach(() => resetAcceptanceState());

  it('submit → review → sign-off', async () => {
    const sub = await submitDomainEvidence({ domainId: 'security', provided: fullEvidence('security'), owner: 'owner', criticalRiskOwner: 'risk' });
    expect(sub.ok).toBe(true);
    expect(sub.status).toBe(SIGN_OFF_STATUS.SUBMITTED);

    const rev = await reviewDomain({ domainId: 'security', reviewer: 'reviewer', outcome: 'pass' });
    expect(rev.ok).toBe(true);
    expect(rev.status).toBe(SIGN_OFF_STATUS.REVIEWED);

    const sign = await signOffDomain({ domainId: 'security', signer: 'release-mgr' });
    expect(sign.ok).toBe(true);
    expect(sign.status).toBe(SIGN_OFF_STATUS.SIGNED);
  });

  it('review can block; signed is terminal', async () => {
    await submitDomainEvidence({ domainId: 'security', provided: fullEvidence('security'), owner: 'owner', criticalRiskOwner: 'risk' });
    const block = await reviewDomain({ domainId: 'security', reviewer: 'reviewer', outcome: 'fail' });
    expect(block.ok).toBe(true);
    expect(block.status).toBe(SIGN_OFF_STATUS.BLOCKED);

    // blocked → cannot sign directly
    const sign = await signOffDomain({ domainId: 'security', signer: 'mgr' });
    expect(sign.ok).toBe(false);
  });

  it('cannot review without submitted evidence', async () => {
    const rev = await reviewDomain({ domainId: 'product', reviewer: 'r', outcome: 'pass' });
    expect(rev.ok).toBe(false);
  });

  it('rejects incomplete evidence submission', async () => {
    const res = await submitDomainEvidence({ domainId: 'accessibility', provided: {}, owner: 'owner' });
    expect(res.ok).toBe(false);
    expect(res.missing.length).toBeGreaterThan(0);
  });
});

describe('deferred & backlog', () => {
  beforeEach(() => resetAcceptanceState());

  it('records deferred high-risk features', () => {
    const res = recordDeferredFeatures({ features: ['seb-browser', 'biometric'] });
    expect(res.ok).toBe(true);
    expect(res.deferred).toContain('seb-browser');
  });

  it('records a valid backlog item', async () => {
    const res = await recordBacklogItem({ title: 'Annual pen-test', priority: 'high', owner: 'sec', reason: 'deferred' });
    expect(res.ok).toBe(true);
    expect(res.item.id).toMatch(/^bl_/);
  });
});

describe('release report gate', () => {
  beforeEach(() => resetAcceptanceState());

  it('empty state → release blocked with all domains listed', async () => {
    const report = await getReleaseReport();
    expect(report.release.ok).toBe(false);
    expect(report.gate.blocks.length).toBe(ACCEPTANCE_DOMAINS.length);
  });

  it('all domains signed → release gate green', async () => {
    for (const d of ACCEPTANCE_DOMAINS) {
      await submitDomainEvidence({ domainId: d.id, provided: fullEvidence(d.id), owner: 'owner', criticalRiskOwner: 'risk' });
      await reviewDomain({ domainId: d.id, reviewer: 'reviewer', outcome: 'pass' });
      await signOffDomain({ domainId: d.id, signer: 'release-mgr' });
    }
    const report = await getReleaseReport();
    expect(report.release.ok).toBe(true);
    expect(report.release.domainsSigned).toBe(8);
  });

  it('deferred high-risk feature cannot be silently enabled (item 15)', async () => {
    for (const d of ACCEPTANCE_DOMAINS) {
      await submitDomainEvidence({ domainId: d.id, provided: fullEvidence(d.id), owner: 'owner', criticalRiskOwner: 'risk' });
      await reviewDomain({ domainId: d.id, reviewer: 'reviewer', outcome: 'pass' });
      await signOffDomain({ domainId: d.id, signer: 'release-mgr' });
    }
    // Defer a high-risk feature and seed it as enabled → release must block.
    await recordDeferredFeatures({ features: ['biometric'] });
    const report = await getReleaseReport({ seed: { domains: { biometric: { status: 'signed-off' } } } });
    expect(report.deferredGuard.ok).toBe(false);
    expect(report.deferredGuard.illegallyEnabled).toContain('biometric');
    expect(report.release.ok).toBe(false);
  });
});
