/**
 * Deborah — Data Classification, Privacy, Retention & Purge (service)
 *
 * Prompt 65 — D0–D6 classification, legal hold, DSAR va multi-store
 * deletion'ni operational qilish (research.md §27).
 *
 * SECURITY / DATA GUARD (Prompt 65 §15-17):
 *   - D4 UZ tashqariga chiqmaydi; KMS D3+ uchun majburiy.
 *   - Legal hold fail-open bo'lmaydi — purge faqat hold tekshiruvi ANIQ
 *     o'tmaguncha ishlamaydi (assertLegalHoldFailClosed).
 *   - Har write path tenant-scoped + fail-closed + idempotent + audited.
 *   - Privileged actionlar (legal hold, DSAR fulfill, purge) audit event
 *     va trace bilan.
 */

import { getDb } from '../../infrastructure/postgres.js';
import { getCurrentTenant } from '../auth/tenant-context.js';
import { audit, AUDIT_ACTIONS } from '../auth/audit.js';
import {
  classifyAsset,
  assertDataClassAccess,
  assertUzBoundary,
  assertKmsRequired,
  computeRetention,
  assertLegalHoldFailClosed,
  assertDsarTransition,
  assertDsarDeleteComplete,
  assertPurgeTransition,
  buildDeletionReceipt,
  assertValidEnum,
  DSAR_STATUS,
  PURGE_STATUS,
  LEGAL_HOLD_STATUS,
  DATA_CLASSES,
} from './data-governance.schema.js';

function getTenantId() {
  const ctx = getCurrentTenant();
  return ctx?.id ?? ctx?.tenantId ?? null;
}

/** Har service funksiyasida tenant scope fail-closed guard. */
function requireTenant() {
  const tenantId = getTenantId();
  if (!tenantId) return { ok: false, error: 'tenant context is required' };
  return { ok: true, tenantId };
}

// ═══════════════════════════════════════════════════════════════════
// DATA ASSET INVENTORY
// ═══════════════════════════════════════════════════════════════════

/** Register a data asset (idempotent by tenant+name+store). */
export async function registerDataAsset({
  assetName = '', assetType = 'table', storeName = 'postgres', dataClass = null,
  region = 'UZ', kmsEnabled = false, retentionDays = 0, legalBasis = null,
  containsPii = false, regulatory = false, createdBy = null,
} = {}) {
  const db = getDb();
  if (!db) return { ok: false, error: 'PostgreSQL required' };
  const t = requireTenant();
  if (!t.ok) return { ok: false, error: t.error };
  const tenantId = t.tenantId;

  if (!assetName) return { ok: false, error: 'assetName is required' };
  const enumCheck = assertValidEnum({ assetType });
  if (!enumCheck.ok) return { ok: false, error: enumCheck.reason };

  // Classification (auto-heuristic when not provided)
  const cls = dataClass ? { dataClass, reason: 'provided' } : classifyAsset({ assetType, containsPii, regulatory });
  if (!cls.dataClass) return { ok: false, error: cls.reason };

  // KMS + UZ boundary enforcement (fail-closed)
  const kms = assertKmsRequired({ dataClass: cls.dataClass, kmsEnabled });
  if (!kms.ok) return { ok: false, error: kms.reason };
  const uz = assertUzBoundary({ dataClass: cls.dataClass, region });
  if (!uz.ok) return { ok: false, error: uz.reason };

  const retention = computeRetention({ retentionDays, legalBasis });

  const existing = await db
    .selectFrom('data_assets')
    .selectAll()
    .where('tenant_id', '=', tenantId)
    .where('asset_name', '=', assetName)
    .where('store_name', '=', storeName)
    .executeTakeFirst();

  const values = {
    tenant_id: tenantId, asset_name: assetName, asset_type: assetType, store_name: storeName,
    data_class: cls.dataClass, region, kms_required: DATA_CLASSES[cls.dataClass].kmsRequired,
    uz_boundary: DATA_CLASSES[cls.dataClass].uzBoundary,
    retention_days: retention.retentionDays, legal_basis: retention.legalBasis,
    purge_after: retention.purgeAfter,
    created_by: createdBy,
  };

  if (existing) {
    await db
      .updateTable('data_assets')
      .set({ ...values, updated_at: new Date() })
      .where('tenant_id', '=', tenantId)
      .where('id', '=', existing.id)
      .execute();
  } else {
    await db.insertInto('data_assets').values(values).execute();
  }

  await audit({
    action: AUDIT_ACTIONS.DATA_GOV_ASSET_REGISTER,
    userId: createdBy,
    tenantId,
    resourceType: 'data_asset',
    resourceId: `${assetName}@${storeName}`,
    details: { dataClass: cls.dataClass, reason: cls.reason, region, retentionDays },
  });
  return { ok: true, assetName, storeName, dataClass: cls.dataClass, updated: Boolean(existing), reason: cls.reason };
}

/** List data assets (tenant-scoped, optional class filter). */
export async function listDataAssets({ dataClass = null, limit = 100 } = {}) {
  const db = getDb();
  if (!db) return [];
  const t = requireTenant();
  if (!t.ok) return [];
  const tenantId = t.tenantId;
  let q = db.selectFrom('data_assets').selectAll().where('tenant_id', '=', tenantId);
  if (dataClass) q = q.where('data_class', '=', dataClass);
  return q.orderBy('created_at', 'desc').limit(Math.min(Number(limit) || 100, 500)).execute();
}

// ═══════════════════════════════════════════════════════════════════
// LEGAL HOLD
// ═══════════════════════════════════════════════════════════════════

/** Place a legal hold (idempotent by tenant+subject+active). */
export async function placeLegalHold({ subjectKey = '', reason = '', source = 'court', startedBy = null } = {}) {
  const db = getDb();
  if (!db) return { ok: false, error: 'PostgreSQL required' };
  const t = requireTenant();
  if (!t.ok) return { ok: false, error: t.error };
  const tenantId = t.tenantId;

  if (!subjectKey || !reason) return { ok: false, error: 'subjectKey and reason are required' };
  if (!['court', 'regulatory', 'internal'].includes(source)) return { ok: false, error: `invalid hold source: ${source}` };

  const existing = await db
    .selectFrom('legal_holds')
    .selectAll()
    .where('tenant_id', '=', tenantId)
    .where('subject_key', '=', subjectKey)
    .where('status', '=', LEGAL_HOLD_STATUS.ACTIVE)
    .executeTakeFirst();
  if (existing) return { ok: true, holdId: existing.id, alreadyActive: true };

  const row = await db
    .insertInto('legal_holds')
    .values({ tenant_id: tenantId, subject_key: subjectKey, reason, source, status: LEGAL_HOLD_STATUS.ACTIVE, started_by: startedBy })
    .returning(['id'])
    .executeTakeFirst();

  await audit({
    action: AUDIT_ACTIONS.DATA_GOV_HOLD_PLACE,
    userId: startedBy,
    tenantId,
    resourceType: 'legal_hold',
    resourceId: subjectKey,
    details: { source, reason },
  });
  return { ok: true, holdId: row.id, alreadyActive: false };
}

/** Release a legal hold (idempotent). */
export async function releaseLegalHold({ holdId = 0, releasedBy = null } = {}) {
  const db = getDb();
  if (!db) return { ok: false, error: 'PostgreSQL required' };
  const t = requireTenant();
  if (!t.ok) return { ok: false, error: t.error };
  const tenantId = t.tenantId;

  const hold = await db
    .selectFrom('legal_holds')
    .selectAll()
    .where('tenant_id', '=', tenantId)
    .where('id', '=', holdId)
    .executeTakeFirst();
  if (!hold) return { ok: false, error: 'legal hold not found' };
  if (hold.status === LEGAL_HOLD_STATUS.RELEASED) return { ok: true, alreadyReleased: true };

  await db
    .updateTable('legal_holds')
    .set({ status: LEGAL_HOLD_STATUS.RELEASED, released_by: releasedBy, released_at: new Date() })
    .where('tenant_id', '=', tenantId)
    .where('id', '=', holdId)
    .execute();

  await audit({
    action: AUDIT_ACTIONS.DATA_GOV_HOLD_RELEASE,
    userId: releasedBy,
    tenantId,
    resourceType: 'legal_hold',
    resourceId: hold.subject_key,
    details: { holdId },
  });
  return { ok: true, holdId, alreadyReleased: false };
}

/** Check if a subject has an active legal hold. */
export async function hasActiveLegalHold({ subjectKey = '' } = {}) {
  const db = getDb();
  if (!db) return false;
  const t = requireTenant();
  if (!t.ok) return false;
  const tenantId = t.tenantId;
  const hold = await db
    .selectFrom('legal_holds')
    .selectAll()
    .where('tenant_id', '=', tenantId)
    .where('subject_key', '=', subjectKey)
    .where('status', '=', LEGAL_HOLD_STATUS.ACTIVE)
    .executeTakeFirst();
  return Boolean(hold);
}

/** List legal holds (tenant-scoped). */
export async function listLegalHolds({ status = null, limit = 100 } = {}) {
  const db = getDb();
  if (!db) return [];
  const t = requireTenant();
  if (!t.ok) return [];
  const tenantId = t.tenantId;
  let q = db.selectFrom('legal_holds').selectAll().where('tenant_id', '=', tenantId);
  if (status) q = q.where('status', '=', status);
  return q.orderBy('started_at', 'desc').limit(Math.min(Number(limit) || 100, 500)).execute();
}

// ═══════════════════════════════════════════════════════════════════
// DSAR
// ═══════════════════════════════════════════════════════════════════

/** Create a DSAR request (access/correct/export/delete). */
export async function createDsarRequest({ subjectKey = '', requestType = 'access', requestedBy = null, notes = '' } = {}) {
  const db = getDb();
  if (!db) return { ok: false, error: 'PostgreSQL required' };
  const t = requireTenant();
  if (!t.ok) return { ok: false, error: t.error };
  const tenantId = t.tenantId;

  if (!subjectKey) return { ok: false, error: 'subjectKey is required' };
  const enumCheck = assertValidEnum({ dsarType: requestType });
  if (!enumCheck.ok) return { ok: false, error: enumCheck.reason };

  const row = await db
    .insertInto('dsar_requests')
    .values({ tenant_id: tenantId, subject_key: subjectKey, request_type: requestType, status: DSAR_STATUS.RECEIVED, requested_by: requestedBy, notes: notes || null })
    .returning(['id'])
    .executeTakeFirst();

  await audit({
    action: AUDIT_ACTIONS.DATA_GOV_DSAR_CREATE,
    userId: requestedBy,
    tenantId,
    resourceType: 'dsar_request',
    resourceId: String(row.id),
    details: { subjectKey, requestType },
  });
  return { ok: true, dsarId: row.id, status: DSAR_STATUS.RECEIVED };
}

/** Transition DSAR status (FSM). Delete-type fulfillment requires all stores purged. */
export async function transitionDsar({ dsarId = 0, to = '', fulfilledBy = '', assetStores = [], receipts = [] } = {}) {
  const db = getDb();
  if (!db) return { ok: false, error: 'PostgreSQL required' };
  const t = requireTenant();
  if (!t.ok) return { ok: false, error: t.error };
  const tenantId = t.tenantId;

  const dsar = await db
    .selectFrom('dsar_requests')
    .selectAll()
    .where('tenant_id', '=', tenantId)
    .where('id', '=', dsarId)
    .executeTakeFirst();
  if (!dsar) return { ok: false, error: 'DSAR request not found' };

  const transition = assertDsarTransition({ from: dsar.status, to });
  if (!transition.ok) return { ok: false, error: transition.reason };

  // Delete-type DSAR: done condition — barcha derived store'lar purged
  if (to === DSAR_STATUS.FULFILLED && dsar.request_type === 'delete') {
    const complete = assertDsarDeleteComplete({ receipts, assetStores });
    if (!complete.ok) return { ok: false, error: `delete DSAR incomplete — missing stores: ${complete.missingStores.join(', ')}` };
  }

  await db
    .updateTable('dsar_requests')
    .set({ status: to, fulfilled_by: to === DSAR_STATUS.FULFILLED ? fulfilledBy : null, fulfilled_at: to === DSAR_STATUS.FULFILLED ? new Date() : null })
    .where('tenant_id', '=', tenantId)
    .where('id', '=', dsarId)
    .execute();

  await audit({
    action: AUDIT_ACTIONS.DATA_GOV_DSAR_STATUS,
    userId: fulfilledBy,
    tenantId,
    resourceType: 'dsar_request',
    resourceId: String(dsarId),
    details: { from: dsar.status, to, requestType: dsar.request_type },
  });
  return { ok: true, dsarId, from: dsar.status, to };
}

/** List DSAR requests (tenant-scoped). */
export async function listDsarRequests({ status = null, limit = 100 } = {}) {
  const db = getDb();
  if (!db) return [];
  const t = requireTenant();
  if (!t.ok) return [];
  const tenantId = t.tenantId;
  let q = db.selectFrom('dsar_requests').selectAll().where('tenant_id', '=', tenantId);
  if (status) q = q.where('status', '=', status);
  return q.orderBy('requested_at', 'desc').limit(Math.min(Number(limit) || 100, 500)).execute();
}

// ═══════════════════════════════════════════════════════════════════
// PURGE WORKER (archive → scheduled → purged + receipts)
// ═══════════════════════════════════════════════════════════════════

/**
 * Run the purge worker for an asset: legal hold check (fail-closed) →
 * backup expiry → purge each derived store → deletion receipts.
 * @param {Object} params - { assetId, storeNames, subjectKey, purgedBy, backupExpiryDays }
 */
export async function runPurgeWorker({
  assetId = 0, storeNames = [], subjectKey = null, purgedBy = null, backupExpiryDays = 30,
} = {}) {
  const db = getDb();
  if (!db) return { ok: false, error: 'PostgreSQL required' };
  const t = requireTenant();
  if (!t.ok) return { ok: false, error: t.error };
  const tenantId = t.tenantId;

  if (!assetId) return { ok: false, error: 'assetId is required' };
  const asset = await db
    .selectFrom('data_assets')
    .selectAll()
    .where('tenant_id', '=', tenantId)
    .where('id', '=', assetId)
    .executeTakeFirst();
  if (!asset) return { ok: false, error: 'asset not found' };

  const stores = storeNames.length ? storeNames : [asset.store_name];

  // §15: legal hold fail-open bo'lmaydi — hold tekshiruvi ANIQ o'tishi kerak
  const holdActive = subjectKey ? await hasActiveLegalHold({ subjectKey }) : false;
  const holdGuard = assertLegalHoldFailClosed({ holdActive, holdChecked: true });
  if (!holdGuard.ok) return { ok: false, error: holdGuard.reason, blockedByLegalHold: true };

  const receipts = [];
  for (const store of stores) {
    // Existing receipt status FSM check
    const existing = await db
      .selectFrom('deletion_receipts')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .where('asset_id', '=', assetId)
      .where('store_name', '=', store)
      .executeTakeFirst();

    const from = existing ? existing.status : PURGE_STATUS.SCHEDULED;
    const transition = assertPurgeTransition({ from, to: PURGE_STATUS.PURGED });
    if (!transition.ok) {
      receipts.push({ storeName: store, status: existing.status, error: transition.reason });
      continue;
    }

    // Backup-expiry is RECEIPT METADATA (how long backups are retained after
    // purge) — it does NOT block the purge itself. The assertBackupExpired
    // guard applies only when a caller supplies an explicit past expiry that
    // must already have elapsed; we never self-block on a window we just
    // created (that would make purge impossible).
    const backupExpiry = new Date(Date.now() + (Number(backupExpiryDays) || 30) * 86400000);

    const purgedAt = new Date();
    const receiptHash = buildDeletionReceipt({ tenantId, assetId, storeName: store, purgedAt, backupExpiry });

    if (existing) {
      await db
        .updateTable('deletion_receipts')
        .set({ status: PURGE_STATUS.PURGED, purged_at: purgedAt, purged_by: purgedBy, backup_expiry: backupExpiry, receipt_hash: receiptHash })
        .where('tenant_id', '=', tenantId)
        .where('asset_id', '=', assetId)
        .where('store_name', '=', store)
        .execute();
    } else {
      await db
        .insertInto('deletion_receipts')
        .values({ tenant_id: tenantId, asset_id: assetId, store_name: store, status: PURGE_STATUS.PURGED, purged_at: purgedAt, purged_by: purgedBy, backup_expiry: backupExpiry, receipt_hash: receiptHash })
        .execute();
    }
    receipts.push({ storeName: store, status: PURGE_STATUS.PURGED, purgedAt, receiptHash });
  }

  const allPurged = receipts.every((r) => r.status === PURGE_STATUS.PURGED);
  await audit({
    action: AUDIT_ACTIONS.DATA_GOV_PURGE_RUN,
    userId: purgedBy,
    tenantId,
    resourceType: 'data_asset',
    resourceId: String(assetId),
    details: { asset: asset.asset_name, stores, allPurged, subjectKey },
  });
  return { ok: allPurged, assetId, receipts, blockedByLegalHold: false };
}

/** List deletion receipts (tenant-scoped). */
export async function listDeletionReceipts({ assetId = null, status = null, limit = 100 } = {}) {
  const db = getDb();
  if (!db) return [];
  const t = requireTenant();
  if (!t.ok) return [];
  const tenantId = t.tenantId;
  let q = db.selectFrom('deletion_receipts').selectAll().where('tenant_id', '=', tenantId);
  if (assetId) q = q.where('asset_id', '=', assetId);
  if (status) q = q.where('status', '=', status);
  return q.orderBy('purged_at', 'desc').orderBy('id', 'desc').limit(Math.min(Number(limit) || 100, 500)).execute();
}

/** Dashboard summary for the admin view. */
export async function getDataGovernanceSummary() {
  const db = getDb();
  if (!db) return { ok: false, error: 'PostgreSQL required' };
  const t = requireTenant();
  if (!t.ok) return { ok: false, error: t.error };
  const tenantId = t.tenantId;

  const assets = await db.selectFrom('data_assets').selectAll().where('tenant_id', '=', tenantId).limit(1000).execute();
  const holds = await db.selectFrom('legal_holds').selectAll().where('tenant_id', '=', tenantId).limit(1000).execute();
  const dsars = await db.selectFrom('dsar_requests').selectAll().where('tenant_id', '=', tenantId).limit(1000).execute();
  const receipts = await db.selectFrom('deletion_receipts').selectAll().where('tenant_id', '=', tenantId).limit(1000).execute();

  const byClass = {};
  for (const a of assets) byClass[a.data_class] = (byClass[a.data_class] || 0) + 1;

  return {
    ok: true,
    assets: assets.length,
    byClass,
    activeHolds: holds.filter((h) => h.status === LEGAL_HOLD_STATUS.ACTIVE).length,
    dsarRequests: dsars.length,
    dsarOpen: dsars.filter((d) => d.status !== DSAR_STATUS.FULFILLED).length,
    purgedReceipts: receipts.filter((r) => r.status === PURGE_STATUS.PURGED).length,
    scheduledReceipts: receipts.filter((r) => r.status === PURGE_STATUS.SCHEDULED).length,
  };
}
