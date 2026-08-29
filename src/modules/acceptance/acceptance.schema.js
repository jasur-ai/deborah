/**
 * Deborah — Final System Acceptance & Handover (pure logic — Prompt 73)
 *
 * Prompt 73 formally accepts the whole Deborah release against the
 * research.md acceptance matrix (§21 Acceptance metrics, §39 Security test
 * matrix, §63 measurable product gates, §75 procurement evidence). This is a
 * CHECKPOINT prompt (10, 19, 29, 38, 49, 60, 73).
 *
 *   - Sign-off domains (items 07–13): security, reliability/DR/SLO,
 *     assessment/grade governance, privacy/legal, accessibility/ACR,
 *     AI governance, operations/training/support, product acceptance.
 *   - Sign-off FSM: evidence-submitted → reviewed → signed-off (terminal).
 *     A domain without evidence or without a critical-risk owner is BLOCKED.
 *   - Release sign-off: every domain must be signed off before RELEASED.
 *     Deferred high-risk features must not be enabled (item 15).
 *   - Marketing claim guard: claim must map to test evidence (item 15).
 *   - Next-version backlog: release sign-off qilinib bo'lgach yaratiladi.
 *   - Write-path guard: tenant scope + authorization + validation +
 *     idempotency (item 16).
 *
 * Purity: no I/O, no globals, no DB — fully unit-testable.
 */

// ═══════════════════════════════════════════════════════════════════
// 1. SIGN-OFF DOMAINS (items 07–13)
// ═══════════════════════════════════════════════════════════════════

export const ACCEPTANCE_DOMAINS = [
  {
    id: 'security',
    label: 'Security acceptance',
    evidence: ['ASVS v5.0', 'threat model', 'pen-test exec summary', 'SAST/DAST/SCA', 'SBOM'],
  },
  {
    id: 'reliability-dr',
    label: 'Reliability / DR / SLO',
    evidence: ['load SLO evidence', 'chaos drills', 'backup restore RPO/RTO', 'drain/freeze', 'SLO burn rates'],
  },
  {
    id: 'assessment',
    label: 'Assessment / grade governance',
    evidence: ['psychometric stats', 'grade rule versioning', 'marking calibration', 'board ratification', 'grade ledger'],
  },
  {
    id: 'privacy-legal',
    label: 'Privacy / legal / data residency',
    evidence: ['DPA', 'data residency UZ', 'retention/deletion', 'DSAR process', 'legal holds'],
  },
  {
    id: 'accessibility',
    label: 'Accessibility / ACR / accommodation',
    evidence: ['WCAG 2.2 AA ACR', 'artifact accessibility', 'accommodation snapshots', 'keyboard/screen-reader tests'],
  },
  {
    id: 'ai-governance',
    label: 'AI eval / human oversight / rollback',
    evidence: ['model registry', 'golden set', 'drift monitoring', 'human oversight', 'rollback drills'],
  },
  {
    id: 'operations',
    label: 'Operations / training / support / exit',
    evidence: ['role training', 'support model', 'incident runbooks', 'vendor exit pack', 'status page'],
  },
  {
    id: 'product',
    label: 'Product acceptance',
    evidence: ['acceptance metrics', 'exam ops gates', 'interop conformance', 'accessibility gates'],
  },
];

export const SIGN_OFF_STATUS = { SUBMITTED: 'evidence-submitted', REVIEWED: 'reviewed', SIGNED: 'signed-off', BLOCKED: 'blocked' };

export const SIGN_OFF_TRANSITIONS = {
  'evidence-submitted': ['reviewed', 'blocked'],
  reviewed: ['signed-off', 'blocked'],
  'signed-off': [],
  blocked: ['reviewed'], // remediation'da evidence qayta review'ga
};

/** Sign-off FSM transition validation. */
export function assertSignOffTransition({ from = '', to = '' } = {}) {
  if (!Object.values(SIGN_OFF_STATUS).includes(from)) return { ok: false, reason: `invalid sign-off status: ${from}` };
  if (!Object.values(SIGN_OFF_STATUS).includes(to)) return { ok: false, reason: `invalid sign-off status: ${to}` };
  const allowed = SIGN_OFF_TRANSITIONS[from] || [];
  if (!allowed.includes(to)) return { ok: false, reason: `cannot transition sign-off ${from} → ${to}` };
  return { ok: true };
}

/**
 * Evaluate a single domain's acceptance evidence — every required evidence
 * item must be provided; a critical-risk owner is required for blocked/risk
 * domains (item 24 stop condition).
 */
export function evaluateDomainEvidence({ domainId = '', provided = {}, owner = '', criticalRiskOwner = '' } = {}) {
  const domain = ACCEPTANCE_DOMAINS.find((d) => d.id === domainId);
  if (!domain) return { ok: false, reason: `unknown acceptance domain: ${domainId}` };
  const missing = domain.evidence.filter((e) => !provided[e]).map((e) => e);
  const hasCriticalRisk = Object.keys(provided).some((k) => /critical|pen-test|dsar|rpo|rto|rollback/i.test(k) && provided[k]);
  if (missing.length) return { ok: false, reason: `domain ${domainId} evidence missing: ${missing.join(', ')}`, missing };
  if (!owner) return { ok: false, reason: `domain ${domainId} requires an evidence owner` };
  if (hasCriticalRisk && !criticalRiskOwner) return { ok: false, reason: `domain ${domainId} has critical-risk evidence but no risk owner (stop condition)` };
  return { ok: true, domain: domainId, evidenceCount: domain.evidence.length, owner };
}

// ═══════════════════════════════════════════════════════════════════
// 2. RELEASE SIGN-OFF (items 14, 25)
// ═══════════════════════════════════════════════════════════════════

/**
 * Release gate — ALL domains must be signed off. Any unsigned/blocked
 * domain blocks the release and lists the missing sign-offs.
 */
export function evaluateReleaseGate({ signed = {} } = {}) {
  const missing = ACCEPTANCE_DOMAINS.filter((d) => signed[d.id] !== true).map((d) => d.id);
  const ok = missing.length === 0;
  return {
    ok,
    domainsSigned: Object.keys(signed).filter((k) => signed[k] === true).length,
    domainsTotal: ACCEPTANCE_DOMAINS.length,
    blocks: missing,
    reason: ok ? 'release sign-off complete — READY' : `release blocked: ${missing.join(', ')} not signed off`,
  };
}

/**
 * Deferred-feature guard (item 15): a deferred high-risk feature must be
 * explicitly disabled at release time — never left enabled silently.
 */
export function assertDeferredHighRiskDisabled({ deferred = [], enabled = [] } = {}) {
  const illegallyEnabled = deferred.filter((f) => enabled.includes(f));
  return {
    ok: illegallyEnabled.length === 0,
    illegallyEnabled,
    reason: illegallyEnabled.length
      ? `deferred high-risk features must not be enabled: ${illegallyEnabled.join(', ')}`
      : 'no deferred high-risk features enabled',
  };
}

/** Marketing claim guard (item 15) — claim must map to test evidence. */
export function assertClaimHasEvidence({ claims = [], evidenceMap = {} } = {}) {
  const unsupported = claims.filter((c) => !evidenceMap[c]);
  return { ok: unsupported.length === 0, unsupportedClaims: unsupported };
}

// ═══════════════════════════════════════════════════════════════════
// 3. NEXT-VERSION BACKLOG (item 14)
// ═══════════════════════════════════════════════════════════════════

export const BACKLOG_PRIORITY = ['critical', 'high', 'medium', 'low'];

/** Next-version backlog item — created after release sign-off (item 14). */
export function validateBacklogItem({ title = '', priority = '', owner = '', reason = '' } = {}) {
  if (!title) return { ok: false, reason: 'backlog item title is required' };
  if (!BACKLOG_PRIORITY.includes(priority)) return { ok: false, reason: `invalid backlog priority: ${priority}` };
  if (!owner) return { ok: false, reason: 'backlog item requires an owner' };
  if (!reason) return { ok: false, reason: 'backlog item requires a reason (what was deferred)' };
  return { ok: true, title, priority, owner };
}

// ═══════════════════════════════════════════════════════════════════
// 4. WRITE-PATH GUARD (item 16)
// ═══════════════════════════════════════════════════════════════════

/** Write-path guard — tenant scope + authorization + validation + idempotency. */
export function assertWritePathGuard({ tenantScoped = false, authorized = false, validated = false, idempotent = false } = {}) {
  const checks = [
    { name: 'tenantScope', ok: tenantScoped === true },
    { name: 'authorization', ok: authorized === true },
    { name: 'validation', ok: validated === true },
    { name: 'idempotency', ok: idempotent === true },
  ];
  const failed = checks.filter((c) => !c.ok).map((c) => c.name);
  return { ok: failed.length === 0, checks, blocks: failed };
}
