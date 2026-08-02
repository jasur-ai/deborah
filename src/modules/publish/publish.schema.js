/**
 * Edikit — Immutable Publish Transaction & Assignment Snapshot (pure logic)
 *
 * Pure, DB-free logic for Prompt 27:
 *   - Canonical content hashing (reproducible version_hash)
 *   - Public item snapshot builder (strips private scoring keys)
 *   - Private scoring snapshot builder
 *   - Secret scan: guarantee private keys can never leak into public snapshots
 *   - planPublish(): deterministic plan of what one publish transaction creates
 *   - Idempotency key derivation (publish race protection)
 *
 * SECURITY / DATA GUARD (Prompt 27 §15):
 *   - Partial publish impossible: planPublish returns one atomic payload; the
 *     service inserts it inside a single transaction
 *   - Private key → public snapshot leak impossible: public item snapshots are
 *     built from an allowlist of PUBLIC fields only; secret scan double-checks
 *
 * Purity: no I/O, no globals — fully unit-testable without PostgreSQL.
 */

import crypto from 'crypto';

// ── Assignment status lifecycle ──
export const ASSIGNMENT_STATUS = {
  DRAFT: 'draft',
  SCHEDULED: 'scheduled',
  PUBLISHED: 'published',
  CANCELLED: 'cancelled',
};

export const ASSIGNMENT_STATUS_TRANSITIONS = {
  draft: ['scheduled', 'cancelled'],
  scheduled: ['published', 'cancelled'],
  published: ['cancelled'],
  cancelled: [],
};

export const NOTIFICATION_TYPES = ['published', 'scheduled', 'date_changed', 'cancelled'];
export const NOTIFICATION_SCOPES = ['roster', 'markers', 'moderators', 'all'];

// ── Fields allowed in PUBLIC item snapshots ──
// Anything not in this allowlist is dropped when building the public surface.
export const PUBLIC_ITEM_FIELDS = [
  'item_id', 'section_id', 'section_title', 'question_type', 'difficulty',
  'points', 'time_seconds', 'sort_order', 'public_data', 'item_hash',
];

// ── Keys that must NEVER appear in public snapshots ──
export const PRIVATE_KEY_FIELDS = [
  'private_data', 'correctKey', 'correct_key', 'answerKey', 'answer_key',
  'scoringRubric', 'scoring_rubric', 'rubric', 'explanation',
  'distractorRationale', 'distractor_rationale', 'correct',
];

// ═══════════════════════════════════════════════════════════════════
// CANONICAL HASHING
// ═══════════════════════════════════════════════════════════════════

/**
 * Stable JSON stringify — sorts object keys recursively so the same content
 * always produces the same string (reproducible hashes).
 *
 * @param {any} value
 * @returns {string}
 */
export function canonicalStringify(value) {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((v) => canonicalStringify(v)).join(',')}]`;
  }
  const keys = Object.keys(value).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalStringify(value[k])}`).join(',')}}`;
}

/**
 * SHA-256 hex digest of canonical JSON.
 *
 * @param {any} value
 * @returns {string}
 */
export function canonicalHash(value) {
  return crypto.createHash('sha256').update(canonicalStringify(value)).digest('hex');
}

/**
 * SINGLE source of truth for the assignment content hash shape.
 * Used by BOTH planPublish (at publish time) and verifyAssignmentIntegrity
 * (at verification time) so the immutability check always agrees.
 *
 * Points are normalized via Number() because PostgreSQL numeric(8,2) columns
 * return strings ('2.00'); normalizing identically here keeps plan and verify
 * hashes in lockstep regardless of how the value is read back.
 *
 * @param {Object} params
 * @param {Object} params.assessment
 * @param {Array<Object>} params.publicItems
 * @param {Array<Object>} params.privateScores
 * @param {Object|null} params.brief
 * @param {Object|null} params.policy
 * @param {Array<Object>} params.roster
 * @returns {string} SHA-256 hex
 */
export function assignmentContentForHash({ assessment, publicItems = [], privateScores = [], brief = null, policy = null, roster = [] } = {}) {
  // CRITICAL: only content RECOVERABLE from the assignment snapshot may be
  // hashed. blueprint / randomization / totals live on the pinned
  // assessment_versions row (blueprint_snapshot etc.), NOT on the assignment —
  // if they were hashed here, verifyAssignmentIntegrity could never recompute
  // them from the stored snapshot and the immutability check would ALWAYS
  // fail. Their immutability is enforced separately by the exact version pin
  // (assessment_version_id) + the draft → published assessment flip.
  // CRITICAL #2: every array is SORTED before hashing. Plan-time input order
  // (caller-provided) must agree with verify-time DB order (getAssignment* uses
  // ORDER BY sort_order / item_id / user_id) — canonical hashing is
  // order-sensitive for arrays, so an unsorted array would break the lockstep
  // the moment the two orders differ. Sorting makes both sides deterministic.
  const content = {
    assessment_id: assessment?.id ?? null,
    title: assessment?.title ?? '',
    public_items: (publicItems || [])
      .map((p) => ({
        item_id: p.item_id ?? null,
        item_hash: p.item_hash ?? null,
        points: Number(p.points) || 0,
        sort_order: Number(p.sort_order) || 0,
      }))
      .sort((a, b) => (a.sort_order - b.sort_order) || ((a.item_id ?? 0) - (b.item_id ?? 0))),
    private_hashes: (privateScores || [])
      .map((p) => ({
        item_id: p.item_id ?? null,
        item_hash: p.item_hash ?? null,
      }))
      .sort((a, b) => (a.item_id ?? 0) - (b.item_id ?? 0)),
    brief: brief ? { id: brief.id, version: brief.version } : null,
    policy: policy ? { id: policy.id, version: policy.version } : null,
    roster: (roster || [])
      .map((r) => ({
        user_id: r.user_id,
        group_id: r.group_id ?? null,
      }))
      .sort((a, b) => (a.user_id ?? 0) - (b.user_id ?? 0)),
  };
  return canonicalHash(content);
}

// ═══════════════════════════════════════════════════════════════════
// SECRET SCAN
// ═══════════════════════════════════════════════════════════════════

/**
 * Recursively scan a value for forbidden private keys (case-insensitive
 * substring match on the key name). Used to guarantee public snapshots and
 * public item rows contain no scoring secrets.
 *
 * @param {any} value
 * @param {string} [path]
 * @returns {Array<{ path: string, key: string }>}
 */
export function scanForSecrets(value, path = '$') {
  const hits = [];
  if (value === null || typeof value !== 'object') return hits;

  if (Array.isArray(value)) {
    value.forEach((item, i) => {
      hits.push(...scanForSecrets(item, `${path}[${i}]`));
    });
    return hits;
  }

  for (const [key, val] of Object.entries(value)) {
    const lower = key.toLowerCase();
    const isSecretKey = PRIVATE_KEY_FIELDS.some((f) => lower === f.toLowerCase() || lower.includes(f.toLowerCase().replace(/_/g, '')));
    if (isSecretKey) {
      hits.push({ path: `${path}.${key}`, key });
    }
    hits.push(...scanForSecrets(val, `${path}.${key}`));
  }
  return hits;
}

/**
 * Verify a public snapshot contains no private keys.
 *
 * @param {Array<Object>} publicItems
 * @returns {{ ok: boolean, leaks: Array<{ path: string, key: string }> }}
 */
export function verifyPublicSnapshotClean(publicItems = []) {
  const leaks = [];
  for (const item of publicItems) {
    leaks.push(...scanForSecrets(item, `items[${item.item_id}]`));
  }
  return { ok: leaks.length === 0, leaks };
}

// ═══════════════════════════════════════════════════════════════════
// SNAPSHOT BUILDERS
// ═══════════════════════════════════════════════════════════════════

/**
 * Build a PUBLIC item snapshot from a raw item row. Allowlist-based —
 * private fields are structurally impossible to include. public_data is
 * preserved as-is; the secret-scan gate in planPublish() fails the whole
 * plan if nested private keys are detected inside it (defense in depth —
 * we do NOT silently blank, so a real leak is surfaced, not hidden).
 *
 * @param {Object} item - Raw item row (may contain public_data + private_data)
 * @returns {Object} Public snapshot
 */
export function buildPublicItemSnapshot(item = {}) {
  const snap = {};
  for (const field of PUBLIC_ITEM_FIELDS) {
    if (item[field] !== undefined) snap[field] = item[field];
  }
  snap.public_data = (item.public_data && typeof item.public_data === 'object')
    ? item.public_data
    : {};
  snap.item_hash = canonicalHash(snap.public_data);
  return snap;
}

/**
 * Build a PRIVATE scoring snapshot from a raw item row.
 *
 * @param {Object} item - Raw item row
 * @returns {Object} Private snapshot
 */
export function buildPrivateScoreSnapshot(item = {}) {
  return {
    item_id: item.item_id ?? item.id ?? null,
    private_data: item.private_data || {},
    item_hash: canonicalHash(item.private_data || {}),
  };
}

/**
 * Build roster member snapshot rows.
 *
 * @param {Array<Object>} members - [{ user_id, group_id?, external_id? }]
 * @returns {Array<Object>} Normalized, de-duplicated roster rows
 */
export function buildRosterSnapshot(members = []) {
  const seen = new Set();
  const rows = [];
  for (const m of members || []) {
    if (!m || m.user_id == null) continue;
    const key = String(m.user_id);
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push({
      user_id: m.user_id,
      group_id: m.group_id || null,
      external_id: m.external_id || null,
    });
  }
  return rows;
}

// ═══════════════════════════════════════════════════════════════════
// PLAN
// ═══════════════════════════════════════════════════════════════════

/**
 * Deterministically plan a publish: one atomic payload the service writes in
 * a single transaction. Same inputs → same version_hash (reproducible
 * SCHEDULED version — Prompt 27 done condition).
 *
 * @param {Object} params
 * @param {Object} params.assessment - { id, title, blueprint, randomization_config, total_points, total_time_seconds, item_count }
 * @param {Array<Object>} params.sections - section rows { id, title, ... }
 * @param {Array<Object>} params.items - raw item rows (may include private_data)
 * @param {Object|null} params.brief - approved brief { id, version }
 * @param {Object|null} params.policy - approved policy pack { id, version }
 * @param {Array<Object>} params.rosterMembers - [{ user_id, group_id?, external_id? }]
 * @param {string} [params.externalKey] - idempotency key
 * @returns {{ ok: boolean, errors: string[], plan: Object|null }}
 */
export function planPublish({ assessment = null, sections = [], items = [], brief = null, policy = null, rosterMembers = [], externalKey = null } = {}) {
  const errors = [];
  const warnings = [];

  if (!assessment) errors.push('assessment is required');
  if (!Array.isArray(items) || items.length === 0) {
    errors.push('items are required — cannot publish an assessment with no items');
  }
  if (brief && brief.status !== 'approved') {
    errors.push(`brief must be approved to publish (status: ${brief?.status})`);
  }
  if (policy && policy.status !== 'approved') {
    errors.push(`policy pack must be approved to publish (status: ${policy?.status})`);
  }
  if (!Array.isArray(rosterMembers) || rosterMembers.length === 0) {
    warnings.push('roster is empty — assignment will be published without members');
  }

  if (errors.length > 0) {
    return { ok: false, errors, warnings, plan: null };
  }

  // Build snapshots
  const publicItems = items.map((it) => buildPublicItemSnapshot(it));
  const privateScores = items.map((it) => buildPrivateScoreSnapshot(it));
  const roster = buildRosterSnapshot(rosterMembers);

  // Secret scan gate: if ANY private key leaks into the public surface,
  // the plan fails — partial/leaky publish is impossible.
  const secretCheck = verifyPublicSnapshotClean(publicItems);
  if (!secretCheck.ok) {
    return {
      ok: false,
      errors: [`Secret scan failed: ${secretCheck.leaks.map((l) => l.path).join(', ')}`],
      warnings,
      plan: null,
    };
  }

  // Reproducible content hash over canonical state — computed via the SAME
  // helper used by verifyAssignmentIntegrity so the immutability check
  // always agrees (single source of truth for hash shape + normalization).
  const versionHash = assignmentContentForHash({
    assessment,
    publicItems,
    privateScores,
    brief,
    policy,
    roster,
  });

  return {
    ok: true,
    errors,
    warnings,
    plan: {
      assessment_id: assessment.id,
      title: assessment.title,
      status: ASSIGNMENT_STATUS.SCHEDULED,
      version_hash: versionHash,
      brief_id: brief?.id || null,
      brief_version_id: brief?.version || null,
      policy_pack_id: policy?.id || null,
      policy_version_id: policy?.version || null,
      external_key: externalKey || null,
      public_items: publicItems,
      private_scores: privateScores,
      roster_members: roster,
      summary: {
        itemCount: publicItems.length,
        rosterCount: roster.length,
        versionHash,
      },
    },
  };
}

// ═══════════════════════════════════════════════════════════════════
// IDEMPOTENCY
// ═══════════════════════════════════════════════════════════════════

/**
 * Derive a deterministic idempotency key for a publish attempt.
 * Same assessment + pins + roster hash → same key → race-safe dedupe.
 *
 * @param {Object} params
 * @param {number} params.assessmentId
 * @param {number|null} params.briefVersionId
 * @param {number|null} params.policyVersionId
 * @param {string} params.rosterHash
 * @returns {string}
 */
export function derivePublishKey({ assessmentId, briefVersionId = null, policyVersionId = null, rosterHash = '' } = {}) {
  return canonicalHash({ assessmentId, briefVersionId, policyVersionId, rosterHash }).slice(0, 40);
}

/**
 * Compute a roster hash for idempotency (order-independent).
 *
 * @param {Array<Object>} members
 * @returns {string}
 */
export function rosterHash(members = []) {
  const ids = buildRosterSnapshot(members).map((r) => r.user_id).sort((a, b) => a - b);
  return canonicalHash(ids);
}
