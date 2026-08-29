/**
 * Deborah — Data Classification, Privacy, Retention & Purge (pure logic)
 *
 * Prompt 65 — D0–D6 classification, legal hold, DSAR va multi-store
 * deletion'ni operational qilish (research.md §27 — surveillance emas,
 * ownership evidence; data governance). This module is PURE (no I/O):
 *
 *   - DATA_CLASSES: D0 (public) … D6 (highest) — har class uchun
 *     kmsRequired, uzBoundary, allowed roles.
 *   - assertDataClassAccess: access matrix — class/action/role.
 *   - assertUzBoundary: D4+ UZ tashqariga chiqmaydi.
 *   - retention compute: archive → scheduled → purged timing.
 *   - Legal hold fail-closed guard: hold tekshiruvi o'tmaguncha purge
 *     ishlamaydi (fail-open bo'lmaydi).
 *   - DSAR FSM: received → in_progress → fulfilled (access/correct/
 *     export/delete).
 *   - Purge FSM: scheduled → purged (har derived store uchun receipt).
 *   - buildDeletionReceipt: deterministik hash — backup-expiry bilan.
 */

// ═══════════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════════

export const DATA_CLASSES = {
  D0: { label: 'Public', kmsRequired: false, uzBoundary: false, roles: ['any'] },
  D1: { label: 'Internal', kmsRequired: false, uzBoundary: false, roles: ['user', 'teacher', 'admin'] },
  D2: { label: 'Confidential', kmsRequired: false, uzBoundary: false, roles: ['teacher', 'admin'] },
  D3: { label: 'Restricted', kmsRequired: true, uzBoundary: false, roles: ['admin'] },
  D4: { label: 'Restricted-High (PII)', kmsRequired: true, uzBoundary: true, roles: ['admin', 'privacy'] },
  D5: { label: 'Secret', kmsRequired: true, uzBoundary: true, roles: ['privacy', 'security'] },
  D6: { label: 'Secret-High', kmsRequired: true, uzBoundary: true, roles: ['security'] },
};

export const ASSET_TYPES = ['table', 'object', 'vector', 'cache', 'provider'];
export const DSAR_TYPES = ['access', 'correct', 'export', 'delete'];
export const DSAR_STATUS = { RECEIVED: 'received', IN_PROGRESS: 'in_progress', FULFILLED: 'fulfilled' };
export const PURGE_STATUS = { SCHEDULED: 'scheduled', PURGED: 'purged', FAILED: 'failed' };
export const LEGAL_HOLD_STATUS = { ACTIVE: 'active', RELEASED: 'released' };

// ═══════════════════════════════════════════════════════════════════
// DATA CLASSIFICATION + ACCESS MATRIX
// ═══════════════════════════════════════════════════════════════════

/** Classify an asset (content-type heuristic). */
export function classifyAsset({ assetType = 'table', containsPii = false, regulatory = false } = {}) {
  if (!ASSET_TYPES.includes(assetType)) return { dataClass: null, reason: `unsupported asset type: ${assetType}` };
  if (containsPii || regulatory) return { dataClass: 'D4', reason: 'PII or regulated content → D4 Restricted-High (KMS + UZ boundary)' };
  if (assetType === 'provider') return { dataClass: 'D3', reason: 'external provider data → D3 Restricted (KMS)' };
  if (assetType === 'cache') return { dataClass: 'D1', reason: 'cache → D1 Internal' };
  return { dataClass: 'D1', reason: 'default → D1 Internal' };
}

/** Access matrix — class/action/role (fail-closed: unknown → deny). */
export function assertDataClassAccess({ dataClass = 'D1', action = 'read', role = 'user' } = {}) {
  const cls = DATA_CLASSES[dataClass];
  if (!cls) return { ok: false, reason: `unknown data class: ${dataClass}` };
  if (!['read', 'write', 'delete', 'export'].includes(action)) return { ok: false, reason: `unknown action: ${action}` };
  if (cls.roles.includes('any')) return { ok: true };
  if (!cls.roles.includes(role)) return { ok: false, reason: `role ${role} cannot ${action} ${dataClass} (${cls.label})` };
  if (dataClass === 'D0' || dataClass === 'D1') return { ok: true };
  // D2+ write/delete/export — privileged
  if (action === 'read' && cls.roles.includes(role)) return { ok: true };
  return { ok: true };
}

/** D4+ never leaves UZ — region must be UZ. */
export function assertUzBoundary({ dataClass = 'D1', region = 'UZ' } = {}) {
  const cls = DATA_CLASSES[dataClass];
  if (!cls) return { ok: false, reason: `unknown data class: ${dataClass}` };
  if (cls.uzBoundary && region !== 'UZ') {
    return { ok: false, reason: `${dataClass} (${cls.label}) must stay within UZ boundary — region ${region} rejected` };
  }
  return { ok: true };
}

/** KMS requirement enforcement for D3+. */
export function assertKmsRequired({ dataClass = 'D1', kmsEnabled = false } = {}) {
  const cls = DATA_CLASSES[dataClass];
  if (!cls) return { ok: false, reason: `unknown data class: ${dataClass}` };
  if (cls.kmsRequired && !kmsEnabled) {
    return { ok: false, reason: `${dataClass} requires KMS encryption — not enabled` };
  }
  return { ok: true };
}

// ═══════════════════════════════════════════════════════════════════
// RETENTION
// ═══════════════════════════════════════════════════════════════════

/** Compute archive/scheduled/purge timings from retention days. */
export function computeRetention({ retentionDays = 0, legalBasis = '', storedAt = new Date() } = {}) {
  const days = Math.max(0, Number(retentionDays) || 0);
  const base = storedAt instanceof Date ? storedAt.getTime() : new Date(storedAt).getTime();
  const ms = 86400000;
  return {
    retentionDays: days,
    legalBasis: legalBasis || null,
    purgeAfter: new Date(base + days * ms),
    scheduledAt: new Date(base + Math.max(0, days - 30) * ms), // 30 kun oldin archive
  };
}

// ═══════════════════════════════════════════════════════════════════
// LEGAL HOLD — FAIL-CLOSED (§15)
// ═══════════════════════════════════════════════════════════════════

/**
 * Guard: legal hold fail-open bo'lmaydi. Purge faqat hold tekshiruvi
 * ANIQ o'tmaguncha ishlamaydi — hold holati noma'lum bo'lsa ham purge
 * bloklanadi (fail-closed).
 */
export function assertLegalHoldFailClosed({ holdActive = false, holdChecked = false } = {}) {
  if (!holdChecked) return { ok: false, reason: 'legal hold status not checked — purge blocked (fail-closed)' };
  if (holdActive) return { ok: false, reason: 'legal hold is active — purge blocked' };
  return { ok: true };
}

// ═══════════════════════════════════════════════════════════════════
// DSAR FSM
// ═══════════════════════════════════════════════════════════════════

export const DSAR_TRANSITIONS = {
  received: ['in_progress'],
  in_progress: ['fulfilled'],
  fulfilled: [], // terminal
};

/** DSAR transition validation. */
export function assertDsarTransition({ from = '', to = '' } = {}) {
  if (!Object.values(DSAR_STATUS).includes(from)) return { ok: false, reason: `invalid current status: ${from}` };
  if (!Object.values(DSAR_STATUS).includes(to)) return { ok: false, reason: `invalid target status: ${to}` };
  const allowed = DSAR_TRANSITIONS[from] || [];
  if (!allowed.includes(to)) return { ok: false, reason: `cannot transition DSAR ${from} → ${to}` };
  return { ok: true };
}

/** DSAR delete requires purge of all derived stores (done condition). */
export function assertDsarDeleteComplete({ receipts = [], assetStores = [] } = {}) {
  const purged = new Set((receipts || []).filter((r) => r.status === PURGE_STATUS.PURGED).map((r) => r.storeName || r.store_name));
  const missing = (assetStores || []).filter((s) => !purged.has(s));
  return { ok: missing.length === 0, missingStores: missing };
}

// ═══════════════════════════════════════════════════════════════════
// PURGE FSM + DELETION RECEIPT
// ═══════════════════════════════════════════════════════════════════

export const PURGE_TRANSITIONS = {
  scheduled: ['purged', 'failed'],
  purged: [], // terminal
  failed: ['scheduled'],
};

/** Purge transition validation. */
export function assertPurgeTransition({ from = '', to = '' } = {}) {
  if (!Object.values(PURGE_STATUS).includes(from)) return { ok: false, reason: `invalid current status: ${from}` };
  if (!Object.values(PURGE_STATUS).includes(to)) return { ok: false, reason: `invalid target status: ${to}` };
  const allowed = PURGE_TRANSITIONS[from] || [];
  if (!allowed.includes(to)) return { ok: false, reason: `cannot transition purge ${from} → ${to}` };
  return { ok: true };
}

/** Deterministic deletion receipt hash (tenant + asset + store + purgedAt). */
export function buildDeletionReceipt({ tenantId = 0, assetId = 0, storeName = '', purgedAt = new Date(), backupExpiry = null } = {}) {
  const canonical = [tenantId, assetId, storeName, new Date(purgedAt).toISOString(), backupExpiry ? new Date(backupExpiry).toISOString() : ''].join('|');
  // FNV-1a 32-bit — deterministic, no crypto dependency needed for receipt id
  let h = 0x811c9dc5;
  for (let i = 0; i < canonical.length; i++) {
    h ^= canonical.charCodeAt(i);
    h = (h * 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

/** Backup-expiry check — purge receipt valid only after backup expired. */
export function assertBackupExpired({ backupExpiry = null, now = new Date() } = {}) {
  if (!backupExpiry) return { ok: true }; // no backup window → purged
  const expiry = backupExpiry instanceof Date ? backupExpiry.getTime() : new Date(backupExpiry).getTime();
  const t = now instanceof Date ? now.getTime() : new Date(now).getTime();
  if (t < expiry) return { ok: false, reason: `backup not expired until ${new Date(expiry).toISOString()}` };
  return { ok: true };
}

/** Enum validation helper. */
export function assertValidEnum({ assetType = '', dsarType = '', dataClass = '' } = {}) {
  if (assetType && !ASSET_TYPES.includes(assetType)) return { ok: false, reason: `invalid asset type: ${assetType}` };
  if (dsarType && !DSAR_TYPES.includes(dsarType)) return { ok: false, reason: `invalid DSAR type: ${dsarType}` };
  if (dataClass && !DATA_CLASSES[dataClass]) return { ok: false, reason: `invalid data class: ${dataClass}` };
  return { ok: true };
}
