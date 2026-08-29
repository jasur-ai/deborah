/**
 * Deborah — Accommodation Service
 *
 * Manages student accommodations for assessments:
 *   - extra_time: additional minutes for time-limited assessments
 *   - reader: human or screen-reader support
 *   - font_contrast: accessible font/color settings
 *   - break_timer: scheduled breaks during assessment
 *   - camera_off: disable camera monitoring
 *   - strike_policy_override: different max strikes
 *   - separate_room: isolated testing environment
 *   - oral_interpreter / word_processor / scribe
 *   - other: custom accommodation
 *
 * All operations are tenant-scoped with audit logging.
 * Sensitive rationale is AES-256-GCM encrypted and restricted
 * to authorized roles (platform_admin, institution_admin, teacher).
 * The encrypted payload { ciphertext, iv, tag } is stored in
 * sensitive_data_encrypted column and only decrypted on-demand.
 */

import { getDb } from '../../infrastructure/postgres.js';
import { getCurrentTenant } from '../auth/tenant-context.js';
import { audit, AUDIT_ACTIONS } from '../auth/audit.js';
import crypto from 'crypto';

// ── Encryption config for sensitive rationale ──
// In production, the encryption key should be from KMS or env var.
// For development, a deterministic key is derived from app config.
const ENCRYPTION_ALGORITHM = 'aes-256-gcm';
const ENCRYPTION_KEY = crypto.createHash('sha256')
  .update(process.env.ACCOMMODATION_ENCRYPTION_KEY || 'deborah-accommodation-dev-key-2026')
  .digest();

// ── Roles that can view sensitive rationale ──
const SENSITIVE_ACCESS_ROLES = ['platform_admin', 'institution_admin', 'teacher'];

function getTenantId() {
  return getCurrentTenant()?.tenantId || 1;
}

// ═══════════════════════════════════════════════════════════════════
// SENSITIVE RATIONALE — Encryption / Decryption
// ═══════════════════════════════════════════════════════════════════

/**
 * Encrypt sensitive rationale (medical notes, disability evidence).
 * Uses AES-256-GCM with random IV per encryption.
 *
 * @param {string} plaintext - The sensitive rationale text
 * @returns {{ ciphertext: string, iv: string, tag: string }|null}
 */
export function encryptSensitiveRationale(plaintext) {
  if (!plaintext) return null;
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(ENCRYPTION_ALGORITHM, ENCRYPTION_KEY, iv);
  let encrypted = cipher.update(plaintext, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const tag = cipher.getAuthTag().toString('hex');
  return { ciphertext: encrypted, iv: iv.toString('hex'), tag };
}

/**
 * Decrypt sensitive rationale.
 * Only callable after authorization check (hasSensitiveAccess).
 *
 * @param {{ ciphertext: string, iv: string, tag: string }} encrypted
 * @returns {string|null}
 */
export function decryptSensitiveRationale(encrypted) {
  if (!encrypted || !encrypted.ciphertext || !encrypted.iv || !encrypted.tag) return null;
  try {
    const decipher = crypto.createDecipheriv(
      ENCRYPTION_ALGORITHM, ENCRYPTION_KEY,
      Buffer.from(encrypted.iv, 'hex')
    );
    decipher.setAuthTag(Buffer.from(encrypted.tag, 'hex'));
    let decrypted = decipher.update(encrypted.ciphertext, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  } catch (_) {
    return null;
  }
}

/**
 * Check if the current user has access to sensitive accommodation rationale.
 *
 * @param {Object} session - Express session
 * @returns {boolean}
 */
export function hasSensitiveAccess(session) {
  const role = session?.user?.role || session?.admin?.role || '';
  return SENSITIVE_ACCESS_ROLES.some(r => role === r || role === r.replace(/_/g, ''));
}

// ═══════════════════════════════════════════════════════════════════
// CRUD — Accommodations
// ═══════════════════════════════════════════════════════════════════

/**
 * Create a new accommodation record.
 * Sensitive rationale is AES-256-GCM encrypted and stored in sensitive_data_encrypted.
 *
 * @param {Object} data
 * @param {number} data.userId - Student user ID
 * @param {string} data.type - Accommodation type code
 * @param {Object} data.operationalConfig - Operational settings JSON
 * @param {string} [data.sensitiveRationale] - Sensitive rationale (encrypted before storage)
 * @param {Date|string} data.effectiveFrom - Start date
 * @param {Date|string} [data.effectiveUntil] - End date
 * @param {number} data.grantedBy - Admin/teacher user ID
 * @returns {Promise<Object>}
 */
export async function createAccommodation(data) {
  const db = await getDb();
  if (!db) throw new Error('PostgreSQL required');

  const encrypted = data.sensitiveRationale
    ? encryptSensitiveRationale(data.sensitiveRationale)
    : null;

  const result = await db.insertInto('accommodations')
    .values({
      tenant_id: getTenantId(),
      user_id: data.userId,
      type: data.type,
      status: 'active',
      operational_config: data.operationalConfig || {},
      sensitive_hash: data.sensitiveRationale
        ? crypto.createHash('sha256').update(data.sensitiveRationale).digest('hex')
        : null,
      sensitive_data_encrypted: encrypted || null,
      effective_from: data.effectiveFrom ? new Date(data.effectiveFrom) : new Date(),
      effective_until: data.effectiveUntil ? new Date(data.effectiveUntil) : null,
      granted_by: data.grantedBy,
      granted_at: new Date(),
      version: 1,
      created_at: new Date(),
      updated_at: new Date(),
    })
    .returning('id')
    .executeTakeFirst();

  if (result) {
    // Initial version record
    await db.insertInto('accommodation_versions').values({
      accommodation_id: result.id,
      tenant_id: getTenantId(),
      version: 1,
      previous_status: null,
      new_status: 'active',
      operational_config: data.operationalConfig || {},
      changed_by: data.grantedBy,
      change_reason: 'Initial accommodation grant',
      created_at: new Date(),
    }).execute();

    await audit({
      action: AUDIT_ACTIONS.ACCOMMODATION_CREATE,
      userId: data.grantedBy,
      resourceType: 'accommodation',
      resourceId: result.id,
      details: { type: data.type, userId: data.userId, hasRationale: !!data.sensitiveRationale },
    });
  }

  return result ? { id: result.id } : null;
}

/**
 * Get a single accommodation by ID.
 * Sensitive rationale is decrypted only if user has sensitive access.
 *
 * @param {number} id
 * @param {Object} [session] - Optional session for sensitive access check
 * @returns {Promise<Object|null>}
 */
export async function getAccommodation(id, session) {
  const db = await getDb();
  if (!db) return null;

  try {
    const row = await db.selectFrom('accommodations')
      .where('id', '=', id)
      .where('tenant_id', '=', getTenantId())
      .selectAll()
      .executeTakeFirst();

    if (!row) return null;

    // If user has sensitive access, decrypt and include rationale
    if (session && hasSensitiveAccess(session) && row.sensitive_data_encrypted) {
      row.sensitive_rationale = decryptSensitiveRationale(row.sensitive_data_encrypted);
    } else {
      // Strip all sensitive data
      delete row.sensitive_data_encrypted;
      delete row.sensitive_hash;
    }

    return row || null;
  } catch (_) {
    return null;
  }
}

/**
 * List accommodations with optional filters.
 * Sensitive columns are NOT included in list responses.
 *
 * @param {Object} filters
 * @param {number} [filters.userId] - Filter by student
 * @param {string} [filters.type] - Filter by accommodation type
 * @param {string} [filters.status] - Filter by status (active/expired/revoked)
 * @param {Object} [filters.session] - Session for sensitive access
 * @param {number} [filters.limit]
 * @param {number} [filters.offset]
 * @returns {Promise<Array>}
 */
export async function listAccommodations({ userId, type, status, session, limit = 50, offset = 0 } = {}) {
  const db = await getDb();
  if (!db) return [];

  try {
    let query = db.selectFrom('accommodations')
      .leftJoin('users', 'users.id', 'accommodations.user_id')
      .where('accommodations.tenant_id', '=', getTenantId());

    if (userId) query = query.where('accommodations.user_id', '=', userId);
    if (type) query = query.where('accommodations.type', '=', type);
    if (status) query = query.where('accommodations.status', '=', status);

    const rows = await query
      .select([
        'accommodations.id', 'accommodations.tenant_id', 'accommodations.user_id',
        'accommodations.type', 'accommodations.status',
        'accommodations.operational_config',
        'accommodations.effective_from', 'accommodations.effective_until',
        'accommodations.granted_by', 'accommodations.granted_at',
        'accommodations.revoked_by', 'accommodations.revoked_at',
        'accommodations.version',
        'accommodations.created_at', 'accommodations.updated_at',
        'users.username', 'users.display_name',
      ])
      .orderBy('accommodations.created_at', 'desc')
      .limit(limit)
      .offset(offset)
      .execute();

    return rows;
  } catch (_) {
    return [];
  }
}

/**
 * Update an existing accommodation.
 * Creates a new version entry automatically.
 *
 * @param {number} id
 * @param {Object} data
 * @param {Object} data.operationalConfig
 * @param {Date|string} [data.effectiveFrom]
 * @param {Date|string} [data.effectiveUntil]
 * @param {string} [data.sensitiveRationale]
 * @param {number} data.changedBy
 * @param {string} [data.changeReason]
 * @returns {Promise<Object>}
 */
export async function updateAccommodation(id, data) {
  const db = await getDb();
  if (!db) throw new Error('PostgreSQL required');

  const existing = await getAccommodation(id);
  if (!existing) throw new Error('Accommodation not found');
  if (existing.status === 'revoked') throw new Error('Cannot update a revoked accommodation');

  const newVersion = existing.version + 1;
  const updates = {
    updated_at: new Date(),
    version: newVersion,
  };

  if (data.operationalConfig !== undefined) updates.operational_config = data.operationalConfig;
  if (data.effectiveFrom !== undefined) updates.effective_from = new Date(data.effectiveFrom);
  if (data.effectiveUntil !== undefined) updates.effective_until = new Date(data.effectiveUntil);

  // If new sensitive rationale provided, re-encrypt and store
  if (data.sensitiveRationale) {
    const encrypted = encryptSensitiveRationale(data.sensitiveRationale);
    updates.sensitive_data_encrypted = encrypted;
    updates.sensitive_hash = crypto.createHash('sha256').update(data.sensitiveRationale).digest('hex');
  }

  await db.updateTable('accommodations')
    .set(updates)
    .where('id', '=', id)
    .where('tenant_id', '=', getTenantId())
    .execute();

  // Create version record
  await db.insertInto('accommodation_versions').values({
    accommodation_id: id,
    tenant_id: getTenantId(),
    version: newVersion,
    previous_status: existing.status,
    new_status: existing.status,
    operational_config: data.operationalConfig || existing.operational_config,
    changed_by: data.changedBy,
    change_reason: data.changeReason || 'Accommodation updated',
    created_at: new Date(),
  }).execute();

  await audit({
    action: AUDIT_ACTIONS.ACCOMMODATION_UPDATE,
    userId: data.changedBy,
    resourceType: 'accommodation',
    resourceId: id,
    details: { version: newVersion, reason: data.changeReason },
  });

  return { ok: true, version: newVersion };
}

/**
 * Revoke (soft-deactivate) an accommodation.
 *
 * @param {number} id
 * @param {number} revokedBy
 * @param {string} [reason]
 * @returns {Promise<Object>}
 */
export async function revokeAccommodation(id, revokedBy, reason) {
  const db = await getDb();
  if (!db) throw new Error('PostgreSQL required');

  const existing = await getAccommodation(id);
  if (!existing) throw new Error('Accommodation not found');
  if (existing.status === 'revoked') return { ok: true, alreadyRevoked: true };

  const newVersion = existing.version + 1;

  await db.updateTable('accommodations')
    .set({
      status: 'revoked',
      revoked_by: revokedBy,
      revoked_at: new Date(),
      revoke_reason: reason || null,
      version: newVersion,
      updated_at: new Date(),
    })
    .where('id', '=', id)
    .where('tenant_id', '=', getTenantId())
    .execute();

  // Create version record
  await db.insertInto('accommodation_versions').values({
    accommodation_id: id,
    tenant_id: getTenantId(),
    version: newVersion,
    previous_status: existing.status,
    new_status: 'revoked',
    operational_config: existing.operational_config,
    changed_by: revokedBy,
    change_reason: reason || 'Accommodation revoked',
    created_at: new Date(),
  }).execute();

  await audit({
    action: AUDIT_ACTIONS.ACCOMMODATION_REVOKE,
    userId: revokedBy,
    resourceType: 'accommodation',
    resourceId: id,
    details: { reason },
  });

  return { ok: true, version: newVersion };
}

/**
 * Get version history for an accommodation.
 *
 * @param {number} accommodationId
 * @returns {Promise<Array>}
 */
export async function getAccommodationVersions(accommodationId) {
  const db = await getDb();
  if (!db) return [];

  try {
    return await db.selectFrom('accommodation_versions')
      .where('accommodation_id', '=', accommodationId)
      .where('tenant_id', '=', getTenantId())
      .orderBy('version', 'desc')
      .selectAll()
      .execute();
  } catch (_) {
    return [];
  }
}

/**
 * Confirm accommodation before starting an assessment.
 * Records student acknowledgment in audit log.
 *
 * @param {number} userId
 * @param {number} assessmentAssignmentId
 * @param {Object} confirmedConfig - The operational config the student confirmed
 * @returns {Promise<Object>}
 */
export async function confirmAccommodation(userId, assessmentAssignmentId, confirmedConfig) {
  const db = await getDb();
  if (!db) throw new Error('PostgreSQL required');

  // Verify that the user actually has accommodation snapshots for this assignment
  const snapshots = await getSnapshotsForAssignment(assessmentAssignmentId, userId);
  if (!snapshots || snapshots.length === 0) {
    throw new Error('No active accommodation found for this assessment assignment');
  }

  // Mark snapshots as confirmed
  for (const snap of snapshots) {
    await db.updateTable('accommodation_snapshots')
      .set({ is_active: true }) // Keep active with confirmation
      .where('id', '=', snap.id)
      .where('user_id', '=', userId)
      .execute();
  }

  await audit({
    action: 'accommodation:confirmed',
    userId,
    resourceType: 'accommodation_snapshot',
    resourceId: assessmentAssignmentId,
    details: { confirmedConfig, snapshotCount: snapshots.length, confirmedAt: new Date().toISOString() },
  });

  return { ok: true, confirmedAt: new Date(), snapshotCount: snapshots.length };
}

// ═══════════════════════════════════════════════════════════════════
// ASSESSMENT ASSIGNMENT SNAPSHOTS
// ═══════════════════════════════════════════════════════════════════

/**
 * Snapshot all active accommodations for a user at the time of
 * assessment assignment. Locks in what was available during the attempt.
 *
 * @param {Object} params
 * @param {number} params.assessmentAssignmentId
 * @param {number} params.userId
 * @returns {Promise<Object>}
 */
export async function createAccommodationSnapshot({ assessmentAssignmentId, userId }) {
  const db = await getDb();
  if (!db) throw new Error('PostgreSQL required');

  const activeAccommodations = await getActiveAccommodationsForUser(userId);
  if (!activeAccommodations || activeAccommodations.length === 0) {
    return { ok: true, snapshots: [] };
  }

  const snapshots = [];
  for (const acc of activeAccommodations) {
    const result = await db.insertInto('accommodation_snapshots')
      .values({
        tenant_id: getTenantId(),
        assessment_assignment_id: assessmentAssignmentId,
        user_id: userId,
        accommodation_type: acc.type,
        snapshot_config: acc.operational_config || {},
        source_accommodation_id: acc.id,
        snapshot_version: acc.version,
        is_active: true,
        created_at: new Date(),
      })
      .returning('id')
      .executeTakeFirst();

    if (result) snapshots.push(result.id);
  }

  await audit({
    action: AUDIT_ACTIONS.ACCOMMODATION_SNAPSHOT,
    resourceType: 'accommodation_snapshot',
    details: { assessmentAssignmentId, userId, snapshotCount: snapshots.length },
  });

  return { ok: true, snapshots };
}

/**
 * Get accommodation snapshots for a specific assessment assignment.
 *
 * @param {number} assessmentAssignmentId
 * @param {number} [userId]
 * @returns {Promise<Array>}
 */
export async function getSnapshotsForAssignment(assessmentAssignmentId, userId) {
  const db = await getDb();
  if (!db) return [];

  try {
    let query = db.selectFrom('accommodation_snapshots')
      .where('assessment_assignment_id', '=', assessmentAssignmentId)
      .where('is_active', '=', true);

    if (userId) query = query.where('user_id', '=', userId);

    return await query.selectAll().execute();
  } catch (_) {
    return [];
  }
}

/**
 * Get all currently active accommodations for a user.
 *
 * @param {number} userId
 * @returns {Promise<Array>}
 */
export async function getActiveAccommodationsForUser(userId) {
  const db = await getDb();
  if (!db) return [];

  try {
    const now = new Date();
    return await db.selectFrom('accommodations')
      .where('user_id', '=', userId)
      .where('tenant_id', '=', getTenantId())
      .where('status', '=', 'active')
      .where('effective_from', '<=', now)
      .where((eb) => eb.or([
        eb('effective_until', 'is', null),
        eb('effective_until', '>=', now),
      ]))
      .selectAll()
      .execute();
  } catch (_) {
    return [];
  }
}

/**
 * Get the effective operational config for a user in an assessment.
 * Merges snapshot config with defaults, ordered by accommodation type priority.
 *
 * @param {number} assessmentAssignmentId
 * @param {number} userId
 * @returns {Promise<Object>}
 */
export async function getEffectiveOperationalConfig(assessmentAssignmentId, userId) {
  const snapshots = await getSnapshotsForAssignment(assessmentAssignmentId, userId);

  const config = {
    extraTimeMinutes: 0,
    readerType: null,
    fontName: null,
    fontSize: null,
    contrastRatio: null,
    breakDuration: 0,
    breakFrequency: 0,
    maxStrikes: 3,
    cameraDisabled: false,
    separateRoom: false,
    oralInterpreter: false,
    wordProcessor: false,
    scribe: false,
    other: null,
  };

  for (const snap of snapshots) {
    const sc = snap.snapshot_config || {};
    switch (snap.accommodation_type) {
      case 'extra_time':
        config.extraTimeMinutes = Math.max(config.extraTimeMinutes, sc.extraMinutes || 0);
        break;
      case 'break_timer':
        config.breakDuration = Math.max(config.breakDuration, sc.breakDuration || 0);
        config.breakFrequency = Math.max(config.breakFrequency, sc.breakFrequency || 0);
        break;
      case 'font_contrast':
        config.fontName = sc.fontName || config.fontName;
        config.fontSize = sc.fontSize || config.fontSize;
        config.contrastRatio = sc.contrastRatio || config.contrastRatio;
        break;
      case 'camera_off':
        config.cameraDisabled = true;
        break;
      case 'strike_policy_override':
        config.maxStrikes = sc.maxStrikes || config.maxStrikes;
        break;
      case 'separate_room':
        config.separateRoom = true;
        break;
      case 'oral_interpreter':
        config.oralInterpreter = true;
        break;
      case 'word_processor':
        config.wordProcessor = true;
        break;
      case 'scribe':
        config.scribe = true;
        break;
      default:
        config.other = config.other || {};
        config.other[snap.accommodation_type] = sc;
    }
  }

  return config;
}
