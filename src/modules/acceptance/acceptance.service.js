/**
 * Deborah — Final System Acceptance & Handover Service (Prompt 73)
 *
 * Service half of the acceptance module:
 *   - Sign-off registry: per-domain evidence, reviewer, sign-off state.
 *   - Release report: evaluateReleaseGate over all domains + deferred
 *     high-risk guard + marketing claim guard.
 *   - Next-version backlog: deferred items with priority + owner.
 *   - Every privileged acceptance action is audited + emits telemetry
 *     (item 17).
 *
 * Graceful degradation: fully functional without PostgreSQL (in-memory).
 */

import { audit, AUDIT_ACTIONS } from '../auth/audit.js';
import { recordMetric } from '../../telemetry/index.js';
import {
  ACCEPTANCE_DOMAINS,
  assertSignOffTransition,
  evaluateDomainEvidence,
  evaluateReleaseGate,
  assertDeferredHighRiskDisabled,
  assertClaimHasEvidence,
  validateBacklogItem,
  SIGN_OFF_STATUS,
} from './acceptance.schema.js';

// ── In-memory sign-off registry ──
const state = {
  domains: new Map(),   // domainId → { evidence, owner, criticalRiskOwner, status, reviewer }
  deferred: [],         // deferred high-risk features (must be disabled)
  backlog: [],          // next-version backlog items
  release: null,        // last release evaluation
};

/** Reset the acceptance state (seed for tests / CI). */
export function resetAcceptanceState() {
  state.domains.clear();
  state.deferred = [];
  state.backlog = [];
  state.release = null;
}

/**
 * Submit acceptance evidence for a domain — moves to evidence-submitted.
 * @param {Object} params - { domainId, provided, owner, criticalRiskOwner }
 */
export async function submitDomainEvidence({ domainId = '', provided = {}, owner = '', criticalRiskOwner = '' } = {}) {
  const eval_ = evaluateDomainEvidence({ domainId, provided, owner, criticalRiskOwner });
  if (!eval_.ok) return eval_;

  state.domains.set(domainId, {
    ...eval_,
    provided,
    criticalRiskOwner,
    status: SIGN_OFF_STATUS.SUBMITTED,
    recordedAt: Date.now(),
  });

  await audit({
    action: AUDIT_ACTIONS.ACCEPTANCE_EVIDENCE,
    userId: owner || null,
    resourceType: 'acceptance',
    resourceId: `domain:${domainId}`,
    details: { evidenceCount: eval_.evidenceCount, criticalRisk: Boolean(criticalRiskOwner) },
  }).catch(() => null);
  recordMetric('deborah_acceptance_evidence_total', 1, { labels: { domain: domainId } });

  return { ok: true, domain: domainId, status: SIGN_OFF_STATUS.SUBMITTED, evidenceCount: eval_.evidenceCount };
}

/**
 * Review a domain's evidence — moves to reviewed. Reviewer is the human
 * authority (item 17 audit).
 * @param {Object} params - { domainId, reviewer, outcome } (outcome: 'pass' | 'fail')
 */
export async function reviewDomain({ domainId = '', reviewer = '', outcome = 'pass' } = {}) {
  const current = state.domains.get(domainId);
  if (!current) return { ok: false, reason: `no evidence submitted for domain: ${domainId}` };
  if (!reviewer) return { ok: false, reason: 'reviewer is required' };
  if (!['pass', 'fail'].includes(outcome)) return { ok: false, reason: `invalid review outcome: ${outcome}` };

  const to = outcome === 'pass' ? SIGN_OFF_STATUS.REVIEWED : SIGN_OFF_STATUS.BLOCKED;
  const transition = assertSignOffTransition({ from: current.status, to });
  if (!transition.ok) return { ok: false, reason: transition.reason };

  state.domains.set(domainId, { ...current, status: to, reviewer, reviewedAt: Date.now() });

  await audit({
    action: AUDIT_ACTIONS.ACCEPTANCE_REVIEW,
    userId: reviewer || null,
    resourceType: 'acceptance',
    resourceId: `domain:${domainId}`,
    details: { from: current.status, to, outcome },
  }).catch(() => null);
  recordMetric('deborah_acceptance_review_total', 1, { labels: { domain: domainId, outcome } });

  return { ok: true, domain: domainId, status: to };
}

/**
 * Sign off a reviewed domain — terminal state (item 25).
 * @param {Object} params - { domainId, signer }
 */
export async function signOffDomain({ domainId = '', signer = '' } = {}) {
  const current = state.domains.get(domainId);
  if (!current) return { ok: false, reason: `no evidence submitted for domain: ${domainId}` };
  if (!signer) return { ok: false, reason: 'signer is required' };

  const transition = assertSignOffTransition({ from: current.status, to: SIGN_OFF_STATUS.SIGNED });
  if (!transition.ok) return { ok: false, reason: transition.reason };

  state.domains.set(domainId, { ...current, status: SIGN_OFF_STATUS.SIGNED, signer, signedAt: Date.now() });

  await audit({
    action: AUDIT_ACTIONS.ACCEPTANCE_SIGN_OFF,
    userId: signer || null,
    resourceType: 'acceptance',
    resourceId: `domain:${domainId}`,
    details: {},
  }).catch(() => null);
  recordMetric('deborah_acceptance_sign_off_total', 1, { labels: { domain: domainId } });

  return { ok: true, domain: domainId, status: SIGN_OFF_STATUS.SIGNED };
}

/**
 * Record deferred high-risk features — they must stay disabled at release
 * (item 15).
 * @param {Object} params - { features }
 */
export function recordDeferredFeatures({ features = [] } = {}) {
  state.deferred = features;
  return { ok: true, deferred: features };
}

/**
 * Record a next-version backlog item (item 14) — after release sign-off.
 * @param {Object} params - { title, priority, owner, reason }
 */
export async function recordBacklogItem({ title = '', priority = '', owner = '', reason = '' } = {}) {
  const valid = validateBacklogItem({ title, priority, owner, reason });
  if (!valid.ok) return valid;

  const item = { ...valid, id: `bl_${state.backlog.length + 1}`, createdAt: Date.now() };
  state.backlog.push(item);

  await audit({
    action: AUDIT_ACTIONS.ACCEPTANCE_BACKLOG,
    userId: owner || null,
    resourceType: 'acceptance',
    resourceId: item.id,
    details: { priority, title },
  }).catch(() => null);
  recordMetric('deborah_acceptance_backlog_total', 1, { labels: { priority } });

  return { ok: true, item };
}

// ═══════════════════════════════════════════════════════════════════
// RELEASE REPORT
// ═══════════════════════════════════════════════════════════════════

/**
 * Full release acceptance report — sign-off status per domain + release
 * gate + deferred guard + marketing claim guard.
 * @param {Object} [params]
 * @param {Object} [params.seed] - { domains?, deferred?, backlog? } to seed before evaluation
 * @param {Object} [params.claims] - { claims, evidenceMap } marketing claim guard
 */
export async function getReleaseReport({ seed = {}, claims = null } = {}) {
  if (seed.domains) for (const [k, v] of Object.entries(seed.domains)) state.domains.set(k, { ...v, recordedAt: Date.now() });
  if (seed.deferred) state.deferred = seed.deferred;
  if (seed.backlog) state.backlog = seed.backlog;

  const domains = [...state.domains.entries()].map(([id, v]) => ({ domainId: id, ...v }));
  const signed = {};
  for (const [id, d] of state.domains.entries()) {
    if (d.status === SIGN_OFF_STATUS.SIGNED) signed[id] = true;
  }
  const gate = evaluateReleaseGate({ signed });

  const deferredGuard = assertDeferredHighRiskDisabled({
    deferred: state.deferred,
    enabled: domains.filter((d) => d.status === SIGN_OFF_STATUS.SIGNED).map((d) => d.domainId),
  });
  const claimGuard = claims ? assertClaimHasEvidence({ claims: claims.claims || [], evidenceMap: claims.evidenceMap || {} }) : null;

  const gatePass = gate.ok && deferredGuard.ok && (!claimGuard || claimGuard.ok);

  recordMetric('deborah_acceptance_release_gate', gatePass ? 1 : 0, {});

  return {
    domains,
    deferred: state.deferred,
    backlog: state.backlog,
    gate,
    deferredGuard,
    claimGuard,
    release: {
      ok: gatePass,
      blocks: [...gate.blocks, ...(deferredGuard.ok ? [] : deferredGuard.illegallyEnabled), ...(claimGuard && !claimGuard.ok ? claimGuard.unsupportedClaims : [])],
      domainsSigned: gate.domainsSigned,
      domainsTotal: gate.domainsTotal,
    },
    acceptanceTarget: 'research.md §21/§34/§39/§63',
  };
}

export { ACCEPTANCE_DOMAINS };
