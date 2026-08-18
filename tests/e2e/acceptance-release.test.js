/**
 * Deborah — Final System Acceptance (e2e, Prompt 73)
 *
 * End-to-end release scenarios:
 *   - Full acceptance cycle: submit → review → sign-off all 8 domains →
 *     release gate green.
 *   - Release blocked when any domain missing or deferred high-risk enabled.
 *   - Marketing claim guard: unsupported claims block the release report.
 *   - Next-version backlog is created after sign-off.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  resetAcceptanceState,
  submitDomainEvidence,
  reviewDomain,
  signOffDomain,
  recordBacklogItem,
  getReleaseReport,
} from '../../src/modules/acceptance/acceptance.service.js';
import { ACCEPTANCE_DOMAINS } from '../../src/modules/acceptance/acceptance.schema.js';

function fullEvidence(domainId) {
  const d = ACCEPTANCE_DOMAINS.find((x) => x.id === domainId);
  return Object.fromEntries(d.evidence.map((e) => [e, 'art_' + e.replace(/[^a-z0-9]/gi, '_')]));
}

async function signAllDomains() {
  for (const d of ACCEPTANCE_DOMAINS) {
    await submitDomainEvidence({ domainId: d.id, provided: fullEvidence(d.id), owner: 'owner', criticalRiskOwner: 'risk' });
    await reviewDomain({ domainId: d.id, reviewer: 'reviewer', outcome: 'pass' });
    await signOffDomain({ domainId: d.id, signer: 'release-mgr' });
  }
}

const SUPPORTED_CLAIMS = {
  'answer key client payload = 0': true,
  'cross-tenant access tests = 0 breach': true,
  'RPO ≤ 1 min / RTO ≤ 30 min': true,
  'WCAG 2.2 AA ACR': true,
};

describe('e2e — full release acceptance (done condition item 25)', () => {
  beforeEach(() => resetAcceptanceState());

  it('all 8 domains signed → release gate green with supported claims', async () => {
    await signAllDomains();
    await recordBacklogItem({ title: 'Annual pen-test', priority: 'high', owner: 'sec', reason: 'deferred' });
    const report = await getReleaseReport({ claims: { claims: Object.keys(SUPPORTED_CLAIMS), evidenceMap: SUPPORTED_CLAIMS } });
    expect(report.release.ok).toBe(true);
    expect(report.release.domainsSigned).toBe(8);
    expect(report.backlog.length).toBe(1);
  });

  it('missing domain sign-off blocks release', async () => {
    // Sign 7 of 8 — leave 'product' unsigned.
    for (const d of ACCEPTANCE_DOMAINS.filter((x) => x.id !== 'product')) {
      await submitDomainEvidence({ domainId: d.id, provided: fullEvidence(d.id), owner: 'owner', criticalRiskOwner: 'risk' });
      await reviewDomain({ domainId: d.id, reviewer: 'reviewer', outcome: 'pass' });
      await signOffDomain({ domainId: d.id, signer: 'release-mgr' });
    }
    const report = await getReleaseReport();
    expect(report.release.ok).toBe(false);
    expect(report.gate.blocks).toContain('product');
  });

  it('unsupported marketing claim blocks the release report (item 15)', async () => {
    await signAllDomains();
    const report = await getReleaseReport({
      claims: { claims: ['ISO 27001 certified', '100% accessible'], evidenceMap: SUPPORTED_CLAIMS },
    });
    expect(report.claimGuard.ok).toBe(false);
    expect(report.claimGuard.unsupportedClaims).toContain('ISO 27001 certified');
    expect(report.release.ok).toBe(false);
  });

  it('deferred high-risk feature enabled at release → release blocked', async () => {
    await signAllDomains();
    const report = await getReleaseReport({ seed: { deferred: ['biometric'], domains: { biometric: { status: 'signed-off' } } } });
    expect(report.deferredGuard.ok).toBe(false);
    expect(report.release.ok).toBe(false);
    expect(report.release.blocks).toContain('biometric');
  });
});
