/**
 * Deborah — QTI Staging Service (Preview/Approval/Commit Pipeline)
 *
 * Manages the lifecycle of imported QTI items through staging:
 *   - Staging session creation from parsed QTI items
 *   - Preview of staged items before commit
 *   - Approval workflow (pending → reviewed → approved → rejected)
 *   - Commit: creates actual items in the item bank
 *   - Reject: discards staged items
 *
 * All functions gracefully degrade when PostgreSQL is unavailable.
 */

import { getDb } from '../../infrastructure/postgres.js';
import { getCurrentTenant } from '../auth/tenant-context.js';
import { audit, AUDIT_ACTIONS } from '../auth/audit.js';

// ── Staging status lifecycle ──
export const STAGING_STATUS = {
  PENDING: 'pending',
  REVIEWED: 'reviewed',
  APPROVED: 'approved',
  REJECTED: 'rejected',
};

export const PACKAGE_STATUS = {
  UPLOADED: 'uploaded',
  VALIDATED: 'validated',
  PARSED: 'parsed',
  STAGING: 'staging',
  COMMITTED: 'committed',
  FAILED: 'failed',
};

function getTenantId() {
  return getCurrentTenant()?.tenantId || 1;
}

// ═══════════════════════════════════════════════════════════════════
// PACKAGE CRUD
// ═══════════════════════════════════════════════════════════════════

/**
 * Create a QTI package record after upload and security validation.
 */
export async function createQtiPackage(data) {
  const db = await getDb();
  if (!db) throw new Error('PostgreSQL required');

  const result = await db.insertInto('qti_packages').values({
    tenant_id: getTenantId(),
    original_filename: data.original_filename,
    file_hash: data.file_hash || null,
    file_size: data.file_size || null,
    package_format: data.package_format || 'qti_21',
    status: data.status || 'uploaded',
    security_checks: data.security_checks || {},
    parse_results: data.parse_results || {},
    manifest_json: data.manifest_json || null,
    errors: data.errors || [],
    warnings: data.warnings || [],
    uploaded_by: data.uploaded_by || null,
    target_bank_id: data.target_bank_id || null,
  }).returning('id').executeTakeFirst();

  if (result) {
    await audit({
      action: 'qti:package:create',
      userId: data.uploaded_by,
      resourceType: 'qti_package',
      resourceId: result.id,
      details: { filename: data.original_filename, size: data.file_size },
    });
  }

  return result ? { id: result.id } : null;
}

/**
 * Update a QTI package (e.g., set status after parsing).
 */
export async function updateQtiPackage(id, data) {
  const db = await getDb();
  if (!db) throw new Error('PostgreSQL required');

  const updates = { updated_at: new Date() };
  for (const f of ['status', 'security_checks', 'parse_results', 'manifest_json',
    'errors', 'warnings', 'target_bank_id', 'staging_summary',
  ]) {
    if (data[f] !== undefined) updates[f] = data[f];
  }

  await db.updateTable('qti_packages')
    .set(updates)
    .where('id', '=', id)
    .where('tenant_id', '=', getTenantId())
    .execute();

  return { ok: true };
}

/**
 * Get a QTI package by ID.
 */
export async function getQtiPackage(id) {
  const db = await getDb();
  if (!db) return null;
  try {
    return await db.selectFrom('qti_packages')
      .where('id', '=', id)
      .where('tenant_id', '=', getTenantId())
      .selectAll()
      .executeTakeFirst();
  } catch (_) { return null; }
}

/**
 * List QTI packages with filters.
 */
export async function listQtiPackages({ status, limit = 50, offset = 0 } = {}) {
  const db = await getDb();
  if (!db) return [];
  try {
    let query = db.selectFrom('qti_packages')
      .where('tenant_id', '=', getTenantId());
    if (status) query = query.where('status', '=', status);

    return await query
      .orderBy('created_at', 'desc')
      .limit(limit).offset(offset)
      .selectAll()
      .execute();
  } catch (_) { return []; }
}

/**
 * Delete a QTI package and its staging items.
 */
export async function deleteQtiPackage(id, userId) {
  const db = await getDb();
  if (!db) throw new Error('PostgreSQL required');

  await db.deleteFrom('qti_packages')
    .where('id', '=', id)
    .where('tenant_id', '=', getTenantId())
    .execute();

  await audit({
    action: 'qti:package:delete',
    userId,
    resourceType: 'qti_package',
    resourceId: id,
  });

  return { ok: true };
}

// ═══════════════════════════════════════════════════════════════════
// STAGING ITEMS CRUD
// ═══════════════════════════════════════════════════════════════════

/**
 * Create staging items from parsed QTI items.
 */
export async function createStagingItems(packageId, items) {
  const db = await getDb();
  if (!db) throw new Error('PostgreSQL required');

  const created = [];
  for (const item of items) {
    const mapping = item.mapping || {};
    const result = await db.insertInto('qti_staging_items').values({
      package_id: packageId,
      tenant_id: getTenantId(),
      qti_identifier: item.identifier || null,
      qti_interaction_type: item.interactionType || null,
      canonical_type: mapping.canonicalType || null,
      public_data: mapping.publicData || null,
      private_data: mapping.privateData || null,
      media_refs: item.mediaRefs || [],
      is_supported: mapping.supported !== false,
      unsupported_reason: mapping.unsupportedReason || null,
      difficulty: item.difficulty || null,
      points: mapping.publicData?.maxChoices || item.points || 1,
      tags: item.tags || [],
      outcome_mappings: item.outcomes || [],
      review_status: 'pending',
    }).returning('id').executeTakeFirst();

    if (result) {
      created.push({ id: result.id, identifier: item.identifier, supported: mapping.supported });
    }
  }

  return created;
}

/**
 * Get all staging items for a package.
 */
export async function getStagingItems(packageId) {
  const db = await getDb();
  if (!db) return [];
  try {
    return await db.selectFrom('qti_staging_items')
      .where('package_id', '=', packageId)
      .where('tenant_id', '=', getTenantId())
      .orderBy('is_supported', 'desc')
      .orderBy('created_at', 'asc')
      .selectAll()
      .execute();
  } catch (_) { return []; }
}

/**
 * Get a single staging item by ID.
 */
export async function getStagingItem(id) {
  const db = await getDb();
  if (!db) return null;
  try {
    return await db.selectFrom('qti_staging_items')
      .where('id', '=', id)
      .where('tenant_id', '=', getTenantId())
      .selectAll()
      .executeTakeFirst();
  } catch (_) { return null; }
}

/**
 * Update a staging item's review status.
 */
export async function updateStagingItemReview(id, { reviewStatus, reviewNotes, userId }) {
  const db = await getDb();
  if (!db) throw new Error('PostgreSQL required');

  if (!Object.values(STAGING_STATUS).includes(reviewStatus)) {
    throw new Error(`Invalid review status: ${reviewStatus}. Must be one of: ${Object.values(STAGING_STATUS).join(', ')}`);
  }

  await db.updateTable('qti_staging_items')
    .set({ review_status: reviewStatus, review_notes: reviewNotes || null, updated_at: new Date() })
    .where('id', '=', id)
    .where('tenant_id', '=', getTenantId())
    .execute();

  await audit({
    action: `qti:staging:${reviewStatus}`,
    userId,
    resourceType: 'qti_staging_item',
    resourceId: id,
  });

  return { ok: true };
}

/**
 * Batch update staging item reviews.
 */
export async function batchUpdateStagingReviews(items, userId) {
  const db = await getDb();
  if (!db) throw new Error('PostgreSQL required');

  const results = [];
  for (const item of items) {
    try {
      await updateStagingItemReview(item.id, {
        reviewStatus: item.reviewStatus,
        reviewNotes: item.reviewNotes,
        userId,
      });
      results.push({ id: item.id, ok: true });
    } catch (err) {
      results.push({ id: item.id, ok: false, error: err.message });
    }
  }

  return results;
}

// ═══════════════════════════════════════════════════════════════════
// COMMIT: Create actual items in the item bank
// ═══════════════════════════════════════════════════════════════════

/**
 * Commit approved staging items to the item bank.
 * Creates actual items and updates staging records with created_item_id.
 */
export async function commitQtiStaging(packageId, targetBankId, userId) {
  const db = await getDb();
  if (!db) throw new Error('PostgreSQL required');

  // Get all approved staging items for this package
  const stagingItems = await db.selectFrom('qti_staging_items')
    .where('package_id', '=', packageId)
    .where('tenant_id', '=', getTenantId())
    .where('review_status', '=', 'approved')
    .where('is_supported', '=', true)
    .selectAll()
    .execute();

  if (stagingItems.length === 0) {
    return { ok: false, error: 'No approved and supported items to commit', committed: 0 };
  }

  const committed = [];

  for (const si of stagingItems) {
    try {
      // Create the actual item
      const result = await db.insertInto('items').values({
        bank_id: targetBankId,
        tenant_id: getTenantId(),
        status: 'draft',
        question_type: si.canonical_type || 'single_choice',
        difficulty: si.difficulty || 'medium',
        points: si.points || 1,
        public_data: si.public_data || {},
        private_data: si.private_data || null,
        version: 1,
        source: 'qti_import',
        source_item_id: null,
        tags: si.tags || [],
        metadata: { qti_package_id: packageId, qti_identifier: si.qti_identifier },
        created_by: userId || null,
      }).returning('id').executeTakeFirst();

      if (result) {
        // Create initial version record
        await db.insertInto('item_versions').values({
          item_id: result.id,
          tenant_id: getTenantId(),
          version: 1,
          previous_status: null,
          new_status: 'draft',
          public_data_snapshot: si.public_data || {},
          private_data_snapshot: si.private_data || null,
          change_summary: `Imported from QTI package #${packageId}`,
          changed_by: userId || null,
        }).execute();

        // Update staging item with created item ID
        await db.updateTable('qti_staging_items')
          .set({ created_item_id: result.id, updated_at: new Date() })
          .where('id', '=', si.id)
          .execute();

        // Add tags if provided
        if (Array.isArray(si.tags) && si.tags.length > 0) {
          for (const tag of si.tags) {
            await db.insertInto('item_tags').values({
              tenant_id: getTenantId(),
              item_id: result.id,
              tag: typeof tag === 'string' ? tag : String(tag),
            }).execute();
          }
        }

        committed.push({
          stagingId: si.id,
          itemId: result.id,
          identifier: si.qti_identifier,
          type: si.canonical_type,
        });
      }
    } catch (err) {
      committed.push({
        stagingId: si.id,
        identifier: si.qti_identifier,
        error: err.message,
      });
    }
  }

  // Update package status
  await updateQtiPackage(packageId, {
    status: 'committed',
    staging_summary: { committedCount: committed.filter(c => c.itemId).length, total: stagingItems.length },
  });

  await audit({
    action: 'qti:commit',
    userId,
    resourceType: 'qti_package',
    resourceId: packageId,
    details: { committedCount: committed.filter(c => c.itemId).length, total: stagingItems.length },
  });

  return { ok: true, committed: committed.filter(c => c.itemId).length, failed: committed.filter(c => c.error).length, details: committed };
}

// ═══════════════════════════════════════════════════════════════════
// STAGING REPORT
// ═══════════════════════════════════════════════════════════════════

/**
 * Generate a comprehensive staging report for a package.
 */
export async function generateStagingReport(packageId) {
  const db = await getDb();
  if (!db) return null;

  try {
    const pkg = await getQtiPackage(packageId);
    if (!pkg) return null;

    const stagingItems = await getStagingItems(packageId);

    const counts = {
      total: stagingItems.length,
      pending: stagingItems.filter(i => i.review_status === 'pending').length,
      reviewed: stagingItems.filter(i => i.review_status === 'reviewed').length,
      approved: stagingItems.filter(i => i.review_status === 'approved').length,
      rejected: stagingItems.filter(i => i.review_status === 'rejected').length,
      supported: stagingItems.filter(i => i.is_supported).length,
      unsupported: stagingItems.filter(i => !i.is_supported).length,
    };

    const interactionTypes = {};
    for (const item of stagingItems) {
      const type = item.qti_interaction_type || 'unknown';
      interactionTypes[type] = (interactionTypes[type] || 0) + 1;
    }

    return {
      packageId,
      filename: pkg.original_filename,
      status: pkg.status,
      securityStatus: pkg.status === 'failed' ? 'failed' : 'passed',
      counts,
      interactionTypes,
      parseResults: pkg.parse_results,
      warnings: pkg.warnings,
      errors: pkg.errors,
    };
  } catch (_) { return null; }
}

// ═══════════════════════════════════════════════════════════════════
// IDEMPOTENCY CHECK
// ═══════════════════════════════════════════════════════════════════

/**
 * Check if a package with the same file hash has already been imported.
 * Returns the existing package if found.
 */
export async function findExistingPackageByHash(fileHash) {
  const db = await getDb();
  if (!db) return null;

  try {
    return await db.selectFrom('qti_packages')
      .where('file_hash', '=', fileHash)
      .where('tenant_id', '=', getTenantId())
      .where('status', 'in', ['committed', 'staging', 'parsed'])
      .selectAll()
      .executeTakeFirst();
  } catch (_) { return null; }
}
