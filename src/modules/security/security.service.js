/**
 * Deborah — Security Profile & Safe Exam Browser Boundary Service
 *
 * Prompt 36 — server-side half of the S0–S4 security profile enforcement:
 *   - Institution policy read/upsert (tenant-scoped, admin-only writes, audited)
 *   - Effective profile resolution for an assessment (institution band clamp)
 *   - SEB config/key boundary verification against the registered key hash
 *   - Student-facing sanitized profile badge + unsupported-control report
 *
 * SECURITY / DATA GUARD (Prompt 36 §15):
 *   - Every read is tenant-scoped; writes require an authenticated actor and
 *     are audited (SECURITY_POLICY_UPDATE).
 *   - The student badge NEVER exposes the registered SEB key hash or policy
 *     internals — buildProfileBadge is a whitelist builder.
 *   - SEB without a registered institution key FAILS CLOSED (S3/S4).
 *
 * Graceful degradation: without PostgreSQL, read paths return defaults/null
 * and write paths throw a clear 'PostgreSQL required' error.
 */

import { getDb } from '../../infrastructure/postgres.js';
import { getCurrentTenant } from '../auth/tenant-context.js';
import { audit, AUDIT_ACTIONS } from '../auth/audit.js';
import { getAssignment } from '../publish/publish.service.js';
import {
  DEFAULT_INSTITUTION_SECURITY_POLICY,
  isValidSecurityProfile,
  validateInstitutionBounds,
  resolveEffectiveProfile,
  mapProfileToPreflightRequirements,
  verifySebConfigBoundary,
  buildSecurityControlReport,
  buildProfileBadge,
} from './security.schema.js';

function getTenantId() {
  return getCurrentTenant()?.tenantId || 1;
}

/** Load the raw institution_security_policy row (or null). */
async function loadPolicyRow(db, tenantId) {
  return db.selectFrom('institution_security_policy')
    .where('tenant_id', '=', tenantId)
    .selectAll()
    .executeTakeFirst()
    .catch(() => null);
}

/**
 * Get the effective institution security policy (defaults when no row).
 *
 * @returns {Promise<Object>} policy contract
 */
export async function getInstitutionSecurityPolicy() {
  const db = await getDb();
  const tenantId = getTenantId();
  if (!db) {
    return { ...DEFAULT_INSTITUTION_SECURITY_POLICY, tenant_id: tenantId };
  }
  try {
    const row = await loadPolicyRow(db, tenantId);
    if (!row) return { ...DEFAULT_INSTITUTION_SECURITY_POLICY, tenant_id: tenantId };
    return {
      tenant_id: tenantId,
      minProfile: row.min_profile ?? DEFAULT_INSTITUTION_SECURITY_POLICY.minProfile,
      maxProfile: row.max_profile ?? DEFAULT_INSTITUTION_SECURITY_POLICY.maxProfile,
      sebConfigKeyHash: row.seb_config_key_hash ?? null,
      requireManagedDevice: row.require_managed_device ?? false,
      allowLanMode: row.allow_lan_mode ?? true,
      updatedAt: row.updated_at ?? null,
      updatedBy: row.updated_by ?? null,
    };
  } catch (_) {
    return { ...DEFAULT_INSTITUTION_SECURITY_POLICY, tenant_id: tenantId };
  }
}

/**
 * Upsert the institution security policy (admin-only, audited).
 *
 * @param {Object} params
 * @param {string} [params.minProfile]
 * @param {string} [params.maxProfile]
 * @param {string|null} [params.sebConfigKeyHash]
 * @param {boolean} [params.requireManagedDevice]
 * @param {boolean} [params.allowLanMode]
 * @param {string|number} [params.actorId] - admin user id
 * @returns {Promise<Object>} { ok, errors?, policy? }
 */
export async function upsertInstitutionSecurityPolicy({
  minProfile = DEFAULT_INSTITUTION_SECURITY_POLICY.minProfile,
  maxProfile = DEFAULT_INSTITUTION_SECURITY_POLICY.maxProfile,
  sebConfigKeyHash = null,
  requireManagedDevice = false,
  allowLanMode = true,
  actorId = null,
} = {}) {
  const db = await getDb();
  if (!db) throw new Error('PostgreSQL required');

  // ── Validation (fail closed on invalid band) ──
  if (!isValidSecurityProfile(minProfile)) {
    return { ok: false, errors: [`min_profile must be one of S0–S4 (got: ${minProfile})`] };
  }
  if (!isValidSecurityProfile(maxProfile)) {
    return { ok: false, errors: [`max_profile must be one of S0–S4 (got: ${maxProfile})`] };
  }
  const bounds = validateInstitutionBounds({ minProfile, maxProfile });
  if (!bounds.ok) return { ok: false, errors: bounds.errors };

  const keyHash = sebConfigKeyHash && typeof sebConfigKeyHash === 'string'
    ? sebConfigKeyHash.toLowerCase()
    : null;

  const tenantId = getTenantId();
  try {
    const existing = await loadPolicyRow(db, tenantId);
    if (existing) {
      await db.updateTable('institution_security_policy')
        .set({
          min_profile: minProfile,
          max_profile: maxProfile,
          seb_config_key_hash: keyHash,
          require_managed_device: requireManagedDevice === true,
          allow_lan_mode: allowLanMode !== false,
          updated_by: actorId || null,
          updated_at: new Date(),
        })
        .where('id', '=', existing.id)
        .where('tenant_id', '=', tenantId)
        .execute();
    } else {
      await db.insertInto('institution_security_policy')
        .values({
          tenant_id: tenantId,
          min_profile: minProfile,
          max_profile: maxProfile,
          seb_config_key_hash: keyHash,
          require_managed_device: requireManagedDevice === true,
          allow_lan_mode: allowLanMode !== false,
          updated_by: actorId || null,
        })
        .execute();
    }
  } catch (err) {
    return { ok: false, errors: [err.message] };
  }

  // ── Audit (§17) — key hash is NEVER logged in full (only presence) ──
  await audit({
    action: AUDIT_ACTIONS.SECURITY_POLICY_UPDATE,
    userId: actorId || null,
    resourceType: 'tenant',
    resourceId: tenantId,
    details: {
      min_profile: minProfile,
      max_profile: maxProfile,
      seb_key_registered: keyHash ? true : false,
      require_managed_device: requireManagedDevice === true,
      allow_lan_mode: allowLanMode !== false,
    },
  }).catch(() => null);

  return {
    ok: true,
    policy: {
      tenant_id: tenantId,
      minProfile,
      maxProfile,
      sebKeyRegistered: keyHash ? true : false,
      requireManagedDevice: requireManagedDevice === true,
      allowLanMode: allowLanMode !== false,
    },
  };
}

/**
 * Resolve the effective security profile for an assignment.
 *
 * Reads the assignment's pinned policy pack (policy.security.profile),
 * clamps it into the institution band, and returns the full requirement
 * contract the student preflight must satisfy.
 *
 * @param {number} assignmentId
 * @returns {Promise<Object>} resolution contract
 */
export async function resolveProfileForAssignment(assignmentId) {
  const db = await getDb();
  const tenantId = getTenantId();
  const institution = await getInstitutionSecurityPolicy();

  if (!db) {
    // Graceful degradation: report defaults without raising.
    const fallback = resolveEffectiveProfile({ requested: 'S0', minProfile: institution.minProfile, maxProfile: institution.maxProfile });
    return {
      ok: false,
      reason: 'PostgreSQL required',
      assignment_id: assignmentId,
      effective: fallback,
      requirements: fallback.ok ? mapProfileToPreflightRequirements(fallback.profile) : null,
    };
  }

  const assignment = await getAssignment(assignmentId);
  if (!assignment) return { ok: false, reason: 'Assignment not found', assignment_id: assignmentId };

  // Load the PINNED policy version snapshot (immutability — the live policy
  // row may have been edited after publish; enforcement must match the exact
  // published contract, same strategy as preflight's resolvePolicyVersion).
  let requested = 'S0';
  try {
    if (assignment.policy_pack_id) {
      let policySnap = null;
      if (assignment.policy_version_id) {
        const byId = await db.selectFrom('policy_pack_versions')
          .where('id', '=', assignment.policy_version_id)
          .where('policy_pack_id', '=', assignment.policy_pack_id)
          .where('tenant_id', '=', tenantId)
          .select(['policy_snapshot'])
          .executeTakeFirst()
          .catch(() => null);
        if (byId) policySnap = byId.policy_snapshot;
      }
      if (!policySnap) {
        const byNumber = await db.selectFrom('policy_pack_versions')
          .where('policy_pack_id', '=', assignment.policy_pack_id)
          .where('tenant_id', '=', tenantId)
          .orderBy('version', 'desc')
          .limit(1)
          .select(['policy_snapshot'])
          .executeTakeFirst()
          .catch(() => null);
        if (byNumber) policySnap = byNumber.policy_snapshot;
      }
      const policy = policySnap || {};
      if (typeof policy.security?.profile === 'string' && isValidSecurityProfile(policy.security.profile)) {
        requested = policy.security.profile;
      }
    }
  } catch (_) { /* defaults to S0 */ }

  const effective = resolveEffectiveProfile({
    requested,
    minProfile: institution.minProfile,
    maxProfile: institution.maxProfile,
  });

  if (!effective.ok) {
    return {
      ok: false,
      reason: effective.reason,
      assignment_id: assignmentId,
      requested,
      institution: { minProfile: institution.minProfile, maxProfile: institution.maxProfile },
      effective: null,
    };
  }

  return {
    ok: true,
    assignment_id: assignmentId,
    title: assignment.title || null,
    requested,
    effective_profile: effective.profile,
    clamped_up: effective.clampedUp || false,
    institution: {
      minProfile: institution.minProfile,
      maxProfile: institution.maxProfile,
      sebKeyRegistered: institution.sebConfigKeyHash ? true : false,
      requireManagedDevice: institution.requireManagedDevice,
      allowLanMode: institution.allowLanMode,
    },
    requirements: mapProfileToPreflightRequirements(effective.profile),
  };
}

/**
 * Verify the SEB config/key boundary for a claimed SEB attempt (server-side).
 * Returns ok only when the presented config key hash matches the registered
 * institution key AND the OS is a supported SEB platform.
 *
 * @param {Object} params
 * @param {boolean|null} [params.sebPresent] - deviceAttestation.sebPresent
 * @param {string|null} [params.configKeyHash] - client-presented SEB config key hash
 * @param {string} [params.userAgent]
 * @param {string|null} [params.profile] - effective profile (defaults S0)
 * @returns {Promise<Object>} boundary verdict
 */
export async function verifySebBoundary({ sebPresent = null, configKeyHash = null, userAgent = '', profile = 'S0' } = {}) {
  const institution = await getInstitutionSecurityPolicy();
  const requirements = mapProfileToPreflightRequirements(profile);
  const sebRequired = requirements?.seb_required === true;

  const verdict = verifySebConfigBoundary({
    sebRequired,
    sebPresent,
    configKeyHash,
    expectedKeyHash: institution.sebConfigKeyHash,
    userAgent,
  });

  // ── Audit verification failures/verifications (§17) ──
  if (!verdict.skipped) {
    await audit({
      action: AUDIT_ACTIONS.SECURITY_SEB_VERIFY,
      userId: null,
      resourceType: 'tenant',
      resourceId: getTenantId(),
      details: {
        ok: verdict.ok,
        code: verdict.code,
        profile,
        os: verdict.os,
      },
    }).catch(() => null);
  }

  return { ...verdict, profile, seb_key_registered: institution.sebConfigKeyHash ? true : false };
}

/**
 * Build the student-facing security profile badge + unsupported control report
 * for an assignment (preflight UI, §13/§14).
 *
 * @param {number} assignmentId
 * @param {Object} [deviceAttestation]
 * @param {Object} [clientInfo]
 * @returns {Promise<Object>} { badge, report, resolution }
 */
export async function getStudentSecurityProfile(assignmentId, deviceAttestation = {}, clientInfo = {}) {
  const resolution = await resolveProfileForAssignment(assignmentId);
  const institution = await getInstitutionSecurityPolicy();

  if (!resolution.ok) {
    return {
      ok: false,
      reason: resolution.reason,
      badge: null,
      report: null,
    };
  }

  const report = buildSecurityControlReport({
    profile: resolution.effective_profile,
    deviceAttestation,
    clientInfo,
    expectedSebKeyHash: institution.sebConfigKeyHash,
    requireManagedDeviceOverride: institution.requireManagedDevice,
    allowLanModeOverride: institution.allowLanMode,
  });

  const badge = buildProfileBadge({
    profile: resolution.effective_profile,
    clampedUp: resolution.clamped_up,
    assignmentTitle: resolution.title || null,
  });

  return {
    ok: true,
    resolution: {
      requested: resolution.requested,
      effective_profile: resolution.effective_profile,
      clamped_up: resolution.clamped_up,
    },
    badge,
    report,
  };
}
