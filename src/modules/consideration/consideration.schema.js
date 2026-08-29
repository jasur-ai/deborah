/**
 * Deborah — Special Consideration, Deferral, Resit, Appeal & Scoring
 * Incident Schema (Prompt 48)
 *
 * Pure schema (no I/O) — research.md §72 (case lifecycle, sensitive
 * evidence separation, attempt lineage, equivalent assessment, appeal
 * package) va §71.7 (wrong answer key, no-detriment rescore):
 *
 *   - CASE_TYPES / CASE_STATUS: §72.3 lifecycle
 *     DRAFT → SUBMITTED → EVIDENCE_CHECK → ELIGIBILITY_REVIEW →
 *     DECISION_PENDING → APPROVED|PARTIAL|REJECTED → REMEDY_SCHEDULED →
 *     REMEDY_COMPLETED → CLOSED|APPEALED
 *   - canViewSensitiveEvidence: marker/proctor sensitive evidence
 *     KO'RMAYDI (§72.2) — ACL based on role + case access.
 *   - validateCapPolicy: resit/deferral cap rule policy pin
 *     (none | capped | best_of | max_attempts) — eligibility va cap
 *     EXACT policy versiondan (§72.7).
 *   - computeSlaDeadline: SLA + owner + overdue escalation.
 *   - validateAppealGrounds: AI case hukmi chiqarmaydi (§15, §72.7) —
 *     appeal requires human-drafted grounds, no AI-conclusive facts.
 *   - computeRescoreImpact: before/after delta, no-detriment (max of
 *     before/after — student hech qachon zarar ko'rmaydi §71.7).
 *   - buildCaseReference: idempotent human-readable case ref.
 */

import { createHash } from 'crypto';

// ═══════════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════════

export const CASE_TYPES = [
  'extension',
  'special_consideration',
  'deferral',
  'resit',
  'recheck',
  'regrade',
  'appeal',
  'technical_incident',
];

export const CASE_STATUS = {
  DRAFT: 'draft',
  SUBMITTED: 'submitted',
  EVIDENCE_CHECK: 'evidence_check',
  ELIGIBILITY_REVIEW: 'eligibility_review',
  DECISION_PENDING: 'decision_pending',
  APPROVED: 'approved',
  PARTIAL: 'partial',
  REJECTED: 'rejected',
  REMEDY_SCHEDULED: 'remedy_scheduled',
  REMEDY_COMPLETED: 'remedy_completed',
  CLOSED: 'closed',
  APPEALED: 'appealed',
};

// Allowed state transitions per §72.3.
export const CASE_TRANSITIONS = {
  [CASE_STATUS.DRAFT]: [CASE_STATUS.SUBMITTED],
  [CASE_STATUS.SUBMITTED]: [CASE_STATUS.EVIDENCE_CHECK, CASE_STATUS.ELIGIBILITY_REVIEW],
  [CASE_STATUS.EVIDENCE_CHECK]: [CASE_STATUS.ELIGIBILITY_REVIEW, CASE_STATUS.SUBMITTED],
  [CASE_STATUS.ELIGIBILITY_REVIEW]: [CASE_STATUS.DECISION_PENDING],
  [CASE_STATUS.DECISION_PENDING]: [
    CASE_STATUS.APPROVED, CASE_STATUS.PARTIAL, CASE_STATUS.REJECTED,
  ],
  [CASE_STATUS.APPROVED]: [CASE_STATUS.REMEDY_SCHEDULED, CASE_STATUS.APPEALED],
  [CASE_STATUS.PARTIAL]: [CASE_STATUS.REMEDY_SCHEDULED, CASE_STATUS.APPEALED],
  [CASE_STATUS.REJECTED]: [CASE_STATUS.APPEALED, CASE_STATUS.CLOSED],
  [CASE_STATUS.REMEDY_SCHEDULED]: [CASE_STATUS.REMEDY_COMPLETED, CASE_STATUS.CLOSED],
  [CASE_STATUS.REMEDY_COMPLETED]: [CASE_STATUS.CLOSED, CASE_STATUS.APPEALED],
  [CASE_STATUS.CLOSED]: [],
  [CASE_STATUS.APPEALED]: [],
};

export const REMEDY_TYPES = [
  'extension',
  'deferral',
  'resit',
  'recheck',
  'regrade',
  'equivalent_assessment',
  'technical_resume',
];

export const INCIDENT_STATUS = {
  OPEN: 'open',
  FROZEN: 'frozen',
  RESOLVED: 'resolved',
};

export const INCIDENT_KINDS = ['wrong_key', 'scoring_defect', 'policy_change', 'other'];
export const INCIDENT_REMEDIES = ['accept_multiple', 'remove_item', 'rescore', 'no_action'];

export const CAP_RULES = ['none', 'capped', 'best_of', 'max_attempts'];

export const CONSIDERATION_DEFAULTS = {
  slaDays: 10, // working-day deadline for case decision
  maxEvidencePerCase: 10,
  evidenceRetentionDays: 30, // §72.2 short retention (or appeal end)
  // Roles that may view sensitive evidence (mirrors accommodation ACL).
  sensitiveAccessRoles: ['platform_admin', 'institution_admin', 'teacher'],
  // Marker/proctor roles are NEVER allowed to see sensitive evidence.
  blockedSensitiveRoles: ['marker', 'proctor', 'external_examiner'],
};

// ═══════════════════════════════════════════════════════════════════
// CASE STATE MACHINE
// ═══════════════════════════════════════════════════════════════════

/**
 * Validate a case state transition (§72.3 lifecycle).
 *
 * @param {Object} params
 * @param {string} params.from
 * @param {string} params.to
 * @returns {{ ok: boolean, reason: string|null }}
 */
export function checkCaseTransition({ from = '', to = '' } = {}) {
  if (!from || !to) return { ok: false, reason: 'from and to statuses are required' };
  if (!Object.values(CASE_STATUS).includes(to)) {
    return { ok: false, reason: `unknown target status: ${to}` };
  }
  const allowed = CASE_TRANSITIONS[from] || [];
  if (!allowed.includes(to)) {
    return { ok: false, reason: `invalid transition ${from} → ${to}` };
  }
  return { ok: true, reason: null };
}

// ═══════════════════════════════════════════════════════════════════
// SENSITIVE EVIDENCE ACL (§72.2)
// ═══════════════════════════════════════════════════════════════════

/**
 * Can this role view sensitive case evidence?
 * Marker/proctor/external_examiner NEVER can (§72.2 — marker faqat
 * "approved adjustment" ni ko'radi, sabab/evidence'ni emas).
 *
 * @param {Object} params
 * @param {string} params.role
 * @param {string} [params.requiredRole]
 * @returns {boolean}
 */
export function canViewSensitiveEvidence({ role = '', requiredRole = null } = {}) {
  const normalized = String(role || '').toLowerCase();
  if (CONSIDERATION_DEFAULTS.blockedSensitiveRoles.includes(normalized)) return false;
  if (requiredRole) {
    const req = String(requiredRole).toLowerCase();
    return normalized === req || CONSIDERATION_DEFAULTS.sensitiveAccessRoles.includes(normalized);
  }
  return CONSIDERATION_DEFAULTS.sensitiveAccessRoles.includes(normalized);
}

// ═══════════════════════════════════════════════════════════════════
// CAP / POLICY PIN (§72.4, §72.7)
// ═══════════════════════════════════════════════════════════════════

/**
 * Validate a cap rule against the policy allowlist. Eligibility va cap
 * EXACT policy versiondan — the cap_rule is pinned with a policy version.
 *
 * @param {Object} params
 * @param {string} [params.capRule]
 * @param {string} [params.capPolicyVersion]
 * @param {number} [params.attemptCount]
 * @param {number} [params.maxAttempts]
 * @returns {{ ok: boolean, reason: string|null }}
 */
export function validateCapPolicy({
  capRule = null,
  capPolicyVersion = '',
  attemptCount = 1,
  maxAttempts = 3,
} = {}) {
  if (capRule !== null && !CAP_RULES.includes(capRule)) {
    return { ok: false, reason: `unknown cap rule: ${capRule}` };
  }
  if (capRule && !capPolicyVersion) {
    return { ok: false, reason: 'cap_policy_version is required when cap_rule is set' };
  }
  if (capRule === 'max_attempts' && Number(attemptCount) > Number(maxAttempts)) {
    return { ok: false, reason: `max attempts exceeded (${attemptCount}/${maxAttempts})` };
  }
  return { ok: true, reason: null };
}

// ═══════════════════════════════════════════════════════════════════
// SLA & OVERDUE
// ═══════════════════════════════════════════════════════════════════

/**
 * Compute an SLA deadline: submitted_at + slaDays working days (skips
 * Sat/Sun — working-day approximation per §72.3 SLA).
 *
 * @param {Object} params
 * @param {number} [params.submittedAt] - epoch ms
 * @param {number} [params.slaDays]
 * @returns {number} epoch ms
 */
export function computeSlaDeadline({ submittedAt = Date.now(), slaDays = CONSIDERATION_DEFAULTS.slaDays } = {}) {
  let d = new Date(submittedAt);
  let added = 0;
  while (added < Number(slaDays)) {
    d.setUTCDate(d.getUTCDate() + 1);
    const day = d.getUTCDay();
    if (day !== 0 && day !== 6) added += 1;
  }
  return d.getTime();
}

/**
 * Is a case overdue (past SLA deadline, not in a final state)?
 *
 * @param {Object} params
 * @param {number} [params.slaDeadline]
 * @param {string} [params.status]
 * @param {number} [params.now]
 * @returns {boolean}
 */
export function isCaseOverdue({ slaDeadline = null, status = '', now = Date.now() } = {}) {
  const finalStates = [
    CASE_STATUS.CLOSED, CASE_STATUS.APPEALED, CASE_STATUS.REMEDY_COMPLETED,
  ];
  if (finalStates.includes(status)) return false;
  if (!slaDeadline) return false;
  return Number(now) > Number(slaDeadline);
}

// ═══════════════════════════════════════════════════════════════════
// APPEAL GROUNDS (§15, §72.7 — AI hukmi chiqarmaydi)
// ═══════════════════════════════════════════════════════════════════

const AI_CONCLUSIVE_MARKERS = [
  'ai_score', 'ai_said', 'ai decided', 'proctor_camera', 'camera flag',
  'proctor flag', 'automated verdict', 'model decided',
];

/**
 * Validate appeal grounds. Rejects AI-conclusive references (AI case
 * hukmi chiqarmaydi; signal va human decision ajratiladi §72.6) and
 * requires a meaningful human-drafted statement.
 *
 * @param {Object} params
 * @param {string} [params.grounds]
 * @returns {{ ok: boolean, reason: string|null }}
 */
export function validateAppealGrounds({ grounds = '' } = {}) {
  const text = String(grounds || '').trim();
  if (text.length < 10) {
    return { ok: false, reason: 'appeal grounds must be at least 10 characters' };
  }
  // Normalize underscores so markers like 'ai_score' also match prose like
  // 'AI score' (the text is free-form; both forms must be caught).
  const lowered = text.toLowerCase();
  const normalized = lowered.replace(/_/g, ' ');
  const hit = AI_CONCLUSIVE_MARKERS.find(
    (m) => lowered.includes(m) || normalized.includes(m.replace(/_/g, ' '))
  );
  if (hit) {
    return { ok: false, reason: `appeal grounds must not cite AI/proctor signals as conclusive facts (found: ${hit})` };
  }
  return { ok: true, reason: null };
}

// ═══════════════════════════════════════════════════════════════════
// RESCORE / NO-DETRIMENT (§71.7)
// ═══════════════════════════════════════════════════════════════════

/**
 * Compute the no-detriment impact of a rescore. Student never loses —
 * the effective score is the MAX of before/after when no_detriment is on.
 *
 * @param {Object} params
 * @param {number} [params.before]
 * @param {number} [params.after]
 * @param {boolean} [params.noDetriment]
 * @returns {{ delta: number, effective: number, improved: boolean }}
 */
export function computeRescoreImpact({ before = 0, after = 0, noDetriment = true } = {}) {
  const b = Number(before);
  const a = Number(after);
  const delta = Number((a - b).toFixed(2));
  const effective = noDetriment ? Math.max(b, a) : a;
  return {
    delta,
    effective: Number(effective.toFixed(2)),
    improved: delta > 0,
  };
}

// ═══════════════════════════════════════════════════════════════════
// CASE REFERENCE (idempotent, human-readable)
// ═══════════════════════════════════════════════════════════════════

/**
 * Build a unique, human-readable case reference: SC-{tenant}-{hash8}.
 * The seed includes a timestamp so each case gets a fresh reference; the
 * UNIQUE (tenant_id, case_reference) index guards against collisions.
 *
 * @param {Object} params
 * @param {number} [params.tenantId]
 * @param {number} [params.attemptId]
 * @param {number} [params.userId]
 * @returns {string}
 */
export function buildCaseReference({ tenantId = 1, attemptId = null, userId = 0 } = {}) {
  const seed = `${tenantId}:${attemptId ?? userId}:${Date.now()}`;
  const hash = createHash('sha1').update(seed).digest('hex').slice(0, 8).toUpperCase();
  return `SC-${tenantId}-${hash}`;
}

// ═══════════════════════════════════════════════════════════════════
// EQUIVALENT ASSESSMENT (§72.5)
// ═══════════════════════════════════════════════════════════════════

/**
 * Validate that a deferred/resit replacement assignment is equivalent:
 * same outcomes, comparable blueprint, no leaked items, equivalent time
 * burden. All must be confirmed (no partial equivalence).
 *
 * @param {Object} params
 * @param {Object} [params.original]
 * @param {Object} [params.replacement]
 * @returns {{ ok: boolean, reason: string|null, missing: string[] }}
 */
export function validateEquivalentAssessment({ original = {}, replacement = {} } = {}) {
  const checks = [
    ['same_outcomes', () => original.outcomeKeys?.length > 0 && JSON.stringify(original.outcomeKeys) === JSON.stringify(replacement.outcomeKeys)],
    ['comparable_blueprint', () => !!replacement.blueprintId || replacement.comparableBlueprint === true],
    ['no_leaked_items', () => replacement.leakChecked === true],
    ['equivalent_time_burden', () => Number(replacement.timeMinutes || 0) >= Number(original.timeMinutes || 0) * 0.9],
  ];
  const missing = [];
  for (const [key, fn] of checks) {
    try { if (!fn()) missing.push(key); } catch { missing.push(key); }
  }
  if (missing.length > 0) {
    return { ok: false, reason: `equivalent assessment incomplete: ${missing.join(', ')}`, missing };
  }
  return { ok: true, reason: null, missing: [] };
}
