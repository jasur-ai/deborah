/**
 * Edikit — Assessment Brief & Policy Schema (pure logic)
 *
 * Pure, DB-free validation for Prompt 25:
 *   - AI-use levels A0–A4 (research.md §27.2)
 *   - Required brief schema validation
 *   - Typed policy JSON schema (late/resit/security/retention/ai_use/marking)
 *   - Institution locked-field denylist enforcement
 *   - Material-change diff + notification determination
 *   - Section-level deep merge (mergeSectional — shared by brief & policy services)
 *   - Publish blockers, human-readable report, policy recipe templates
 *
 * Purity: no I/O, no globals — fully unit-testable without PostgreSQL.
 * SECURITY: policies are DATA (schema-validated JSON) — never arbitrary JavaScript.
 */

// ── AI-use policy levels (research.md §27.2) ──
export const AI_USE_LEVELS = ['A0', 'A1', 'A2', 'A3', 'A4'];

export const AI_USE_LEVEL_INFO = {
  A0: { label: 'AI taqiqlangan', evidence: 'supervised/process proof' },
  A1: { label: 'spell/grammar/translation', evidence: 'tool disclosure' },
  A2: { label: 'brainstorm/research', evidence: 'prompt/source log + critique' },
  A3: { label: 'draft/collaboration', evidence: 'full AI-use appendix + revisions' },
  A4: { label: 'AI-native task', evidence: 'student AI outputni audit/defend qiladi' },
};

export const BRIEF_STATUS = {
  DRAFT: 'draft',
  APPROVED: 'approved',
  ARCHIVED: 'archived',
};

export const BRIEF_STATUS_TRANSITIONS = {
  draft: ['approved', 'archived'],
  approved: ['archived'],
  archived: [],
};

export const POLICY_STATUS = {
  DRAFT: 'draft',
  APPROVED: 'approved',
  ARCHIVED: 'archived',
};

export const POLICY_STATUS_TRANSITIONS = {
  draft: ['approved', 'archived'],
  approved: ['archived'],
  archived: [],
};

export const RECIPE_CATEGORIES = ['standard', 'high_stakes', 'accessible', 'formative', 'custom'];

// Default institution-locked policy fields (denylist)
export const DEFAULT_LOCKED_POLICY_FIELDS = [
  'retention_days',
  'security.max_strikes',
  'security.allow_camera',
];

export const DEFAULT_LOCKED_BRIEF_FIELDS = [
  'duration_minutes.max',
];

// ═══════════════════════════════════════════════════════════════════
// TYPED POLICY SCHEMA
// ═══════════════════════════════════════════════════════════════════

/**
 * Validate a typed institutional policy object.
 * Rejects unknown top-level sections and enforces value types.
 *
 * @param {Object} policy
 * @returns {{ ok: boolean, errors: string[], warnings: string[] }}
 */
export function validatePolicySchema(policy = {}) {
  const errors = [];
  const warnings = [];

  const allowedSections = new Set([
    'late', 'resit', 'security', 'retention_days', 'ai_use', 'marking', 'metadata',
  ]);

  for (const key of Object.keys(policy)) {
    if (!allowedSections.has(key)) {
      errors.push(`Unknown policy section: "${key}"`);
    }
  }

  // ── late ──
  const late = policy.late;
  if (late !== undefined) {
    if (typeof late !== 'object' || late === null) {
      errors.push('policy.late must be an object');
    } else {
      if (typeof late.allowed !== 'boolean') errors.push('policy.late.allowed must be boolean');
      if (late.max_days !== undefined && !Number.isFinite(late.max_days)) {
        errors.push('policy.late.max_days must be a number');
      }
      if (late.penalty_per_day !== undefined && !Number.isFinite(late.penalty_per_day)) {
        errors.push('policy.late.penalty_per_day must be a number');
      }
    }
  }

  // ── resit ──
  const resit = policy.resit;
  if (resit !== undefined) {
    if (typeof resit !== 'object' || resit === null) {
      errors.push('policy.resit must be an object');
    } else {
      if (typeof resit.allowed !== 'boolean') errors.push('policy.resit.allowed must be boolean');
      if (resit.max_attempts !== undefined && !Number.isInteger(resit.max_attempts)) {
        errors.push('policy.resit.max_attempts must be an integer');
      }
      if (resit.wait_days !== undefined && !Number.isFinite(resit.wait_days)) {
        errors.push('policy.resit.wait_days must be a number');
      }
    }
  }

  // ── security ──
  const security = policy.security;
  if (security !== undefined) {
    if (typeof security !== 'object' || security === null) {
      errors.push('policy.security must be an object');
    } else {
      const profiles = ['S0', 'S1', 'S2', 'S3', 'S4'];
      if (security.profile !== undefined && !profiles.includes(security.profile)) {
        errors.push(`policy.security.profile must be one of ${profiles.join(', ')}`);
      }
      if (security.max_strikes !== undefined && !Number.isInteger(security.max_strikes)) {
        errors.push('policy.security.max_strikes must be an integer');
      }
      if (security.allow_camera !== undefined && typeof security.allow_camera !== 'boolean') {
        errors.push('policy.security.allow_camera must be boolean');
      }
      if (security.require_seb !== undefined && typeof security.require_seb !== 'boolean') {
        errors.push('policy.security.require_seb must be boolean');
      }
    }
  }

  // ── retention_days ──
  if (policy.retention_days !== undefined) {
    if (!Number.isInteger(policy.retention_days) || policy.retention_days < 0) {
      errors.push('policy.retention_days must be a non-negative integer');
    }
  }

  // ── ai_use ──
  const aiUse = policy.ai_use;
  if (aiUse !== undefined) {
    if (typeof aiUse !== 'object' || aiUse === null) {
      errors.push('policy.ai_use must be an object');
    } else {
      if (aiUse.level !== undefined && !AI_USE_LEVELS.includes(aiUse.level)) {
        errors.push(`policy.ai_use.level must be one of ${AI_USE_LEVELS.join(', ')}`);
      }
      if (aiUse.tools_allowed !== undefined) {
        if (!Array.isArray(aiUse.tools_allowed)) {
          errors.push('policy.ai_use.tools_allowed must be an array');
        } else {
          for (const tool of aiUse.tools_allowed) {
            if (typeof tool !== 'string') errors.push('policy.ai_use.tools_allowed entries must be strings');
          }
        }
      }
    }
  }

  // ── marking ──
  const marking = policy.marking;
  if (marking !== undefined) {
    if (typeof marking !== 'object' || marking === null) {
      errors.push('policy.marking must be an object');
    } else {
      if (marking.mode !== undefined && !['auto', 'human', 'hybrid'].includes(marking.mode)) {
        errors.push('policy.marking.mode must be auto | human | hybrid');
      }
    }
  }

  // ── metadata (free-form, informational only) ──
  if (policy.metadata !== undefined && (typeof policy.metadata !== 'object' || policy.metadata === null)) {
    errors.push('policy.metadata must be an object');
  }

  return { ok: errors.length === 0, errors, warnings };
}

// ═══════════════════════════════════════════════════════════════════
// BRIEF SCHEMA
// ═══════════════════════════════════════════════════════════════════

/**
 * Validate required assessment brief content fields.
 *
 * @param {Object} content
 * @returns {{ ok: boolean, errors: string[], warnings: string[] }}
 */
export function validateBriefSchema(content = {}) {
  const errors = [];
  const warnings = [];

  if (!content.learning_outcomes || !Array.isArray(content.learning_outcomes) ||
      content.learning_outcomes.length === 0) {
    errors.push('brief.learning_outcomes must be a non-empty array');
  }

  if (!Number.isFinite(content.duration_minutes) || content.duration_minutes <= 0) {
    errors.push('brief.duration_minutes must be a positive number');
  }

  if (content.materials !== undefined && !Array.isArray(content.materials)) {
    errors.push('brief.materials must be an array');
  }

  if (content.submission_format !== undefined && typeof content.submission_format !== 'string') {
    errors.push('brief.submission_format must be a string');
  }

  // AI-use level (top-level field on the brief row; mirrored here for content validation)
  if (content.ai_use_level !== undefined && !AI_USE_LEVELS.includes(content.ai_use_level)) {
    errors.push(`brief.ai_use_level must be one of ${AI_USE_LEVELS.join(', ')}`);
  }

  // Late/resit policy embedded in brief (teacher-level default; institution policy overrides)
  if (content.late_policy !== undefined && typeof content.late_policy !== 'object') {
    errors.push('brief.late_policy must be an object');
  }
  if (content.resit_policy !== undefined && typeof content.resit_policy !== 'object') {
    errors.push('brief.resit_policy must be an object');
  }

  return { ok: errors.length === 0, errors, warnings };
}

// ═══════════════════════════════════════════════════════════════════
// SECTION-LEVEL DEEP MERGE (shared by brief & policy services)
// ═══════════════════════════════════════════════════════════════════

/**
 * Merge incoming content into current at section level: partial nested
 * sections (e.g. security: { max_strikes: 99 }) keep their untouched sibling
 * fields instead of being replaced wholesale.
 */
export function mergeSectional(current = {}, incoming = {}) {
  const result = { ...current };
  for (const [key, value] of Object.entries(incoming)) {
    if (
      value && typeof value === 'object' && !Array.isArray(value) &&
      result[key] && typeof result[key] === 'object' && !Array.isArray(result[key])
    ) {
      result[key] = { ...result[key], ...value };
    } else {
      result[key] = value;
    }
  }
  return result;
}

// ═══════════════════════════════════════════════════════════════════
// LOCKED FIELD ENFORCEMENT (institution-owned denylist)
// ═══════════════════════════════════════════════════════════════════

/** Resolve a dotted path against an object (safe, no eval). */
export function getByPath(obj, path) {
  return path.split('.').reduce((acc, part) => (acc == null ? undefined : acc[part]), obj);
}

/** Set a dotted path value (used to re-apply locked values). */
export function setByPath(obj, path, value) {
  const parts = path.split('.');
  let node = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    if (typeof node[parts[i]] !== 'object' || node[parts[i]] === null) {
      node[parts[i]] = {};
    }
    node = node[parts[i]];
  }
  node[parts[parts.length - 1]] = value;
  return obj;
}

/**
 * Check whether an update attempts to change institution-locked fields.
 * Returns the list of locked paths that differ between current and proposed.
 *
 * @param {Object} current - Current stored value
 * @param {Object} proposed - Proposed new value
 * @param {Array<string>} lockedFields - Dotted paths that are locked
 * @returns {{ ok: boolean, lockedChanges: Array<{path: string, from: any, to: any}> }}
 */
export function checkLockedFieldChanges(current = {}, proposed = {}, lockedFields = []) {
  const lockedChanges = [];
  for (const path of lockedFields) {
    const from = getByPath(current, path);
    const to = getByPath(proposed, path);
    // Only flag when the locked value is actually being CHANGED
    if (JSON.stringify(from) !== JSON.stringify(to)) {
      lockedChanges.push({ path, from, to });
    }
  }
  return { ok: lockedChanges.length === 0, lockedChanges };
}

// ═══════════════════════════════════════════════════════════════════
// MATERIAL-CHANGE DIFF
// ═══════════════════════════════════════════════════════════════════

/**
 * Field paths whose change is considered "material" (requires student
 * notification / version pin change). Mirrors research.md assessment
 * lifecycle: brief changes must not silently alter an active attempt.
 */
export const MATERIAL_FIELDS = [
  'duration_minutes',
  'submission_format',
  'materials',
  'security_policy.profile',
  'security_policy.max_strikes',
  'late_policy.allowed',
  'resit_policy.allowed',
  'weighting',
];

/**
 * Diff two brief content objects and classify material vs non-material changes.
 *
 * @param {Object} oldContent
 * @param {Object} newContent
 * @returns {{ materialChanges: Array, minorChanges: Array, isMaterial: boolean }}
 */
export function diffBriefContent(oldContent = {}, newContent = {}) {
  const materialChanges = [];
  const minorChanges = [];

  const allKeys = new Set([...Object.keys(oldContent), ...Object.keys(newContent)]);
  for (const key of allKeys) {
    if (JSON.stringify(oldContent[key]) !== JSON.stringify(newContent[key])) {
      const entry = { field: key, from: oldContent[key], to: newContent[key] };
      if (MATERIAL_FIELDS.includes(key)) {
        materialChanges.push(entry);
      } else {
        minorChanges.push(entry);
      }
    }
  }

  return {
    materialChanges,
    minorChanges,
    isMaterial: materialChanges.length > 0,
  };
}

// ═══════════════════════════════════════════════════════════════════
// POLICY RECIPES (seed library)
// ═══════════════════════════════════════════════════════════════════

/**
 * Built-in policy recipes (seeded into recipe_library on migration).
 * Data-only templates — no executable code.
 */
export const SEED_RECIPES = [
  {
    name: 'Standard midterm',
    description: 'Oddiy oraliq nazorat: late 0, 1 resit, S1 monitoring',
    category: 'standard',
    policy_template: {
      late: { allowed: false, max_days: 0, penalty_per_day: 0 },
      resit: { allowed: true, max_attempts: 1, wait_days: 7 },
      security: { profile: 'S1', max_strikes: 3, allow_camera: false, require_seb: false },
      retention_days: 180,
      ai_use: { level: 'A0', tools_allowed: [] },
      marking: { mode: 'auto' },
    },
  },
  {
    name: 'High-stakes final',
    description: 'Yakuniy imtihon: late 0, resit policy institution, S3 lockdown',
    category: 'high_stakes',
    policy_template: {
      late: { allowed: false, max_days: 0, penalty_per_day: 0 },
      resit: { allowed: true, max_attempts: 1, wait_days: 14 },
      security: { profile: 'S3', max_strikes: 2, allow_camera: false, require_seb: true },
      retention_days: 365,
      ai_use: { level: 'A0', tools_allowed: [] },
      marking: { mode: 'hybrid' },
    },
  },
  {
    name: 'Accessible assessment',
    description: 'Accommodation-friendly: extra time allowed, camera off',
    category: 'accessible',
    policy_template: {
      late: { allowed: true, max_days: 3, penalty_per_day: 5 },
      resit: { allowed: true, max_attempts: 2, wait_days: 5 },
      security: { profile: 'S1', max_strikes: 5, allow_camera: true, require_seb: false },
      retention_days: 180,
      ai_use: { level: 'A1', tools_allowed: ['spell_checker'] },
      marking: { mode: 'hybrid' },
    },
  },
  {
    name: 'Formative practice',
    description: 'Past-stakes practice: late/security lax, AI assist A2',
    category: 'formative',
    policy_template: {
      late: { allowed: true, max_days: 7, penalty_per_day: 0 },
      resit: { allowed: true, max_attempts: 99, wait_days: 0 },
      security: { profile: 'S0', max_strikes: 99, allow_camera: false, require_seb: false },
      retention_days: 90,
      ai_use: { level: 'A2', tools_allowed: ['chat', 'research'] },
      marking: { mode: 'auto' },
    },
  },
];

// ═══════════════════════════════════════════════════════════════════
// PUBLISH BLOCKER & SIMULATOR HELPERS
// ═══════════════════════════════════════════════════════════════════

/**
 * Check whether a summative assessment can be published.
 * Per Prompt 25 done-condition: brief va policy approved bo'lmasdan
 * summative publish bo'lmasa.
 *
 * @param {Object} params
 * @param {Object|null} brief - Brief row with status
 * @param {Object|null} policy - Policy pack row with status
 * @param {Object} [opts]
 * @param {boolean} [opts.isSummative] - Only summative requires approval gates
 * @returns {{ ok: boolean, blockers: string[] }}
 */
export function checkPublishBlockers({ brief = null, policy = null, isSummative = true } = {}) {
  const blockers = [];
  if (!isSummative) return { ok: true, blockers };

  if (!brief) {
    blockers.push('Assessment brief is missing — create and approve a brief first');
  } else if (brief.status !== 'approved') {
    blockers.push(`Assessment brief is ${brief.status} — must be approved before publish`);
  }

  if (!policy) {
    blockers.push('Institutional policy pack is missing — create and approve a policy pack first');
  } else if (policy.status !== 'approved') {
    blockers.push(`Policy pack is ${policy.status} — must be approved before publish`);
  }

  return { ok: blockers.length === 0, blockers };
}

/**
 * Generate a human-readable publish-readiness report.
 *
 * @returns {string} Markdown-ish text report
 */
export function generatePublishReport({ brief = null, policy = null, isSummative = true } = {}) {
  const { ok, blockers } = checkPublishBlockers({ brief, policy, isSummative });
  const lines = [];
  lines.push('# Publish readiness report');
  lines.push(`Mode: ${isSummative ? 'summative (gated)' : 'non-summative (open)'}`);
  lines.push('');
  lines.push(`- Brief status: ${brief ? brief.status : 'MISSING'} ${brief ? `(v${brief.version || 1})` : ''}`);
  lines.push(`- Policy status: ${policy ? policy.status : 'MISSING'} ${policy ? `(v${policy.version || 1})` : ''}`);
  lines.push('');
  if (ok) {
    lines.push('RESULT: ✅ READY TO PUBLISH');
  } else {
    lines.push('RESULT: ❌ BLOCKED');
    lines.push('');
    lines.push('Blockers:');
    blockers.forEach((b, i) => lines.push(`  ${i + 1}. ${b}`));
  }
  return lines.join('\n');
}
