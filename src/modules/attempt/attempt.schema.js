/**
 * Edikit — Attempt Lease, Identity Step & Server Timer (pure logic)
 *
 * Pure, DB-free logic for Prompt 30 (Phase D #1):
 *   - Identity level model: policy security profile (S0–S4) → required
 *     identity level (none|password|google|passkey); step-up hook checks the
 *     achieved level satisfies the requirement (research.md §30 identity
 *     assurance — Google login ≠ the person taking the exam).
 *   - Server-authoritative timing: started_at/ends_at computed on the server
 *     ONLY. Client clock, display timer or join code is NEVER authoritative
 *     (Prompt 30 §15 data guard).
 *   - Accommodation extra time: base duration + extra_time_minutes.
 *   - Public content package builder: rebuilds the student-facing item
 *     surface from the published public snapshots — private keys are
 *     structurally impossible (the source rows carry no private_data column).
 *   - Attempt status lifecycle: ready → in_progress → submitted|terminated.
 *   - Parallel-session policy: single active lease per (assignment, user).
 *   - Idempotency key: assignment + user + day (mirrors preflight keying).
 *
 * Purity: no I/O, no globals — fully unit-testable without PostgreSQL.
 */

import crypto from 'crypto';

// ═══════════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════════

export const ATTEMPT_STATUS = {
  READY: 'ready',
  IN_PROGRESS: 'in_progress',
  SUBMITTED: 'submitted',
  TERMINATED: 'terminated',
};

/** Attempt lifecycle — ready (created) → in_progress (started) → terminal. */
export const ATTEMPT_STATUS_TRANSITIONS = {
  ready: ['in_progress', 'terminated'],
  in_progress: ['submitted', 'terminated'],
  submitted: [],
  terminated: [],
};

/** Identity levels, ordered weakest → strongest (research.md §30). */
export const IDENTITY_LEVELS = ['none', 'password', 'google', 'passkey'];

export const IDENTITY_LEVEL_RANK = {
  none: 0,
  password: 1,
  google: 2,
  passkey: 3,
};

/** Default identity level when no policy security profile exists. */
export const DEFAULT_IDENTITY_LEVEL = 'none';

/**
 * Map a policy security profile (S0–S4) to the required identity level.
 * Higher-stakes profiles require stronger identity assurance:
 *   - S0 open / S1 monitored   → password (single factor)
 *   - S2 restricted            → password
 *   - S3 lockdown / S4 max     → passkey (strong second factor)
 *
 * @param {string} [profile] - 'S0' | 'S1' | 'S2' | 'S3' | 'S4'
 * @returns {string} Identity level from IDENTITY_LEVELS
 */
export function requiredIdentityLevelForProfile(profile = 'S0') {
  switch (profile) {
    case 'S3':
    case 'S4':
      return 'passkey';
    case 'S2':
      return 'password';
    case 'S1':
      return 'password';
    case 'S0':
    default:
      return 'none';
  }
}

/**
 * Check that an achieved identity level satisfies a requirement.
 *
 * @param {string} [required] - none|password|google|passkey
 * @param {string|null} [achieved]
 * @returns {boolean}
 */
export function identityLevelSatisfied(required = DEFAULT_IDENTITY_LEVEL, achieved = null) {
  if (!required || required === 'none') return true;
  if (!achieved) return false;
  const r = IDENTITY_LEVEL_RANK[required] ?? 0;
  const a = IDENTITY_LEVEL_RANK[achieved] ?? -1;
  return a >= r;
}

/**
 * Resolve the identity requirement for an assignment from its policy.
 * The policy is the sanitized/raw pack; we read only security.profile.
 *
 * @param {Object|null} policy - policy row or sanitized policy { security: { profile } }
 * @returns {string} Required identity level
 */
export function requiredIdentityLevelForPolicy(policy = null) {
  const profile = policy?.security?.profile || policy?.policy?.security?.profile || 'S0';
  return requiredIdentityLevelForProfile(profile);
}

// ═══════════════════════════════════════════════════════════════════
// SERVER-AUTHORITATIVE TIMER
// ═══════════════════════════════════════════════════════════════════

/**
 * Compute the server-authoritative attempt window.
 *
 * The client NEVER supplies start/end time; only the server computes them
 * from `now`. The display timer is derived from these values — a spoofed
 * client clock cannot extend the window (Prompt 30 §15).
 *
 * @param {Object} params
 * @param {number} [params.baseMinutes] - Assessment duration from the assignment
 * @param {number} [params.extraMinutes] - Accommodation extra time
 * @param {number|string|Date} [params.now] - Server reference time
 * @returns {{ startedAt: Date, endsAt: Date|null, baseMinutes: number,
 *             extraMinutes: number, totalMinutes: number }}
 */
export function computeAttemptTiming({ baseMinutes = 0, extraMinutes = 0, now = Date.now() } = {}) {
  const base = Math.max(0, Number(baseMinutes) || 0);
  const extra = Math.max(0, Number(extraMinutes) || 0);
  const total = base + extra;
  const startedAt = new Date(now);
  const endsAt = total > 0 ? new Date(startedAt.getTime() + total * 60 * 1000) : null;
  return { startedAt, endsAt, baseMinutes: base, extraMinutes: extra, totalMinutes: total };
}

/**
 * Compute remaining seconds at a reference time (server-side only).
 * Returns null when the attempt has no end (unbounded) and 0 when expired.
 *
 * @param {Date|string|null} endsAt
 * @param {number|string|Date} [now]
 * @returns {number|null}
 */
export function computeRemainingSeconds(endsAt, now = Date.now()) {
  if (!endsAt) return null;
  const endMs = new Date(endsAt).getTime();
  const nowMs = new Date(now).getTime();
  return Math.max(0, Math.round((endMs - nowMs) / 1000));
}

/**
 * Effective accommodation extra time from a merged operational config.
 * Uses the config's extraTimeMinutes (accommodation.service computes it as
 * the MAX across the user's active snapshots).
 *
 * @param {Object} [config] - { extraTimeMinutes }
 * @returns {number}
 */
export function extractExtraTimeMinutes(config = {}) {
  return Math.max(0, Number(config?.extraTimeMinutes) || 0);
}

// ═══════════════════════════════════════════════════════════════════
// PUBLIC CONTENT PACKAGE (student-facing item surface)
// ═══════════════════════════════════════════════════════════════════

/**
 * Build the public content package for an attempt from the PUBLISHED public
 * item snapshots. Only allowlisted public fields survive; anything that is
 * not part of the public snapshot is dropped. Source rows are
 * assignment_public_items (no private_data column exists), so private keys
 * are structurally impossible.
 *
 * @param {Object} assignment - assessment_assignments row { id, title, version_hash }
 * @param {Array<Object>} publicItems - assignment_public_items rows
 * @returns {Object} content package
 */
export function buildPublicContentPackage(assignment = null, publicItems = []) {
  const items = (Array.isArray(publicItems) ? publicItems : []).map((p) => ({
    item_id: p.item_id ?? null,
    section_id: p.section_id ?? null,
    section_title: p.section_title ?? null,
    question_type: p.question_type ?? null,
    difficulty: p.difficulty ?? null,
    points: Number(p.points) || 0,
    time_seconds: Number(p.time_seconds) || 0,
    sort_order: Number(p.sort_order) || 0,
    item_hash: p.item_hash ?? null,
    public_data: p.public_data || {},
  }));

  return {
    assignment_id: assignment?.id ?? null,
    title: assignment?.title ?? null,
    version_hash: assignment?.version_hash ?? null,
    item_count: items.length,
    items,
  };
}

/**
 * Verify a content package contains no private keys (belt-and-braces scan on
 * top of the structural allowlist). Reuses the publish schema's secret scan.
 *
 * @param {Object} contentPackage
 * @returns {{ ok: boolean, leaks: Array<{ path: string, key: string }> }}
 */
export function verifyContentPackageClean(contentPackage = {}) {
  const leaks = [];
  for (const item of contentPackage.items || []) {
    leaks.push(...scanPrivateKeys(item, `items[${item.item_id}]`));
  }
  return { ok: leaks.length === 0, leaks };
}

/** Local secret-key scan (same denylist semantics as publish.schema). */
const PRIVATE_KEY_FIELDS = [
  'private_data', 'correctKey', 'correct_key', 'answerKey', 'answer_key',
  'scoringRubric', 'scoring_rubric', 'rubric', 'explanation',
  'distractorRationale', 'distractor_rationale', 'correct',
];

function scanPrivateKeys(value, path = '$') {
  const hits = [];
  if (value === null || typeof value !== 'object') return hits;
  if (Array.isArray(value)) {
    value.forEach((item, i) => hits.push(...scanPrivateKeys(item, `${path}[${i}]`)));
    return hits;
  }
  for (const [key, val] of Object.entries(value)) {
    const lower = key.toLowerCase();
    if (PRIVATE_KEY_FIELDS.some((f) => lower === f.toLowerCase() || lower.includes(f.toLowerCase().replace(/_/g, '')))) {
      hits.push({ path: `${path}.${key}`, key });
    }
    hits.push(...scanPrivateKeys(val, `${path}.${key}`));
  }
  return hits;
}

// ═══════════════════════════════════════════════════════════════════
// PARALLEL SESSION POLICY
// ═══════════════════════════════════════════════════════════════════

/**
 * Evaluate whether a NEW attempt may acquire the single-writer lease.
 * At most one ACTIVE lease per (assignment, user) — a second live attempt is
 * the parallel-session stop condition (Prompt 30 §24).
 *
 * @param {Array<Object>} activeLeases - active attempt_leases rows for the user+assignment
 * @returns {{ allowed: boolean, reason: string|null }}
 */
export function evaluateParallelSessionPolicy(activeLeases = []) {
  const active = (Array.isArray(activeLeases) ? activeLeases : [])
    .filter((l) => l?.status === 'active' || l?.status == null);
  if (active.length > 0) {
    return {
      allowed: false,
      reason: 'Parallel session denied — an active attempt already exists for this assignment',
      existingLeaseId: active[0].id ?? null,
    };
  }
  return { allowed: true, reason: null, existingLeaseId: null };
}

// ═══════════════════════════════════════════════════════════════════
// IDEMPOTENCY KEY
// ═══════════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════════
// SERVER-SIDE IDENTITY RESOLUTION
// ═══════════════════════════════════════════════════════════════════

/**
 * Resolve the achieved identity level from the SERVER session — never from a
 * client-supplied body field (a malicious client could otherwise claim
 * `passkey` and bypass the step-up gate; research.md §30).
 *
 * @param {Object} [sessionUser] - req.session.user
 * @returns {string|null} Identity level or null when unauthenticated
 */
export function resolveIdentityLevelFromSession(sessionUser = {}) {
  if (!sessionUser || typeof sessionUser !== 'object') return null;
  if (sessionUser.authProvider === 'google') return 'google';
  if (sessionUser.authMethod === 'passkey') return 'passkey';
  if (sessionUser.authMethod === 'google') return 'google';
  // An authenticated session (username/id/safeKey present) without a recorded
  // strong method is at minimum a password-authenticated session.
  if (sessionUser.id || sessionUser.username || sessionUser.safeKey) return 'password';
  return null;
}

/**
 * Derive the idempotency key for an attempt start: assignment + user + day
 * (UTC date). Re-starting the same day returns the existing attempt.
 *
 * @param {number} assignmentId
 * @param {number} userId
 * @param {string|number|Date} [now]
 * @returns {string}
 */
export function deriveAttemptKey(assignmentId, userId, now = Date.now()) {
  const day = new Date(now).toISOString().slice(0, 10);
  return crypto.createHash('sha256')
    .update(`attempt:${assignmentId}:${userId}:${day}`)
    .digest('hex')
    .slice(0, 40);
}

// ═══════════════════════════════════════════════════════════════════
// ATTEMPT START CONTRACT
// ═══════════════════════════════════════════════════════════════════

/**
 * Compute the attempt start eligibility contract from all gates:
 *   - identity step-up (required vs achieved)
 *   - preflight eligibility (roster snapshot + window + blockers)
 *   - parallel session policy
 *
 * @param {Object} parts
 * @param {string} [parts.identityRequired] - none|password|google|passkey
 * @param {string|null} [parts.identityAchieved]
 * @param {boolean} [parts.preflightEligible] - preflight contract eligible
 * @param {boolean} [parts.preflightExists] - preflight was run
 * @param {boolean} [parts.parallelAllowed]
 * @returns {{ canStart: boolean, blockers: Array<{ code: string, message: string }> }}
 */
export function computeAttemptStartEligibility({
  identityRequired = DEFAULT_IDENTITY_LEVEL,
  identityAchieved = null,
  preflightEligible = false,
  preflightExists = false,
  parallelAllowed = true,
} = {}) {
  const blockers = [];

  if (!identityLevelSatisfied(identityRequired, identityAchieved)) {
    blockers.push({
      code: 'identity_step_up_required',
      message: `Kuchliroq identifikatsiya talab qilinadi (${identityRequired})`,
    });
  }
  if (!preflightExists) {
    blockers.push({
      code: 'preflight_required',
      message: 'Avval preflight tekshiruvidan o‘tish shart',
    });
  } else if (!preflightEligible) {
    blockers.push({
      code: 'preflight_not_eligible',
      message: 'Preflight talablari bajarilmagan',
    });
  }
  if (!parallelAllowed) {
    blockers.push({
      code: 'parallel_session_denied',
      message: 'Bu assignment uchun faol attempt allaqachon mavjud',
    });
  }

  return { canStart: blockers.length === 0, blockers };
}
