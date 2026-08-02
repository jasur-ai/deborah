/**
 * Edikit — Data Governance Barrel Export
 *
 * Prompt 65 — D0–D6 classification, legal hold, DSAR va multi-store
 * deletion (purge worker + receipts). Legal hold fail-open bo'lmaydi (§15).
 *
 * Usage:
 *   import * as dataGov from '../modules/data-governance/index.js';
 */

export {
  registerDataAsset,
  listDataAssets,
  placeLegalHold,
  releaseLegalHold,
  hasActiveLegalHold,
  listLegalHolds,
  createDsarRequest,
  transitionDsar,
  listDsarRequests,
  runPurgeWorker,
  listDeletionReceipts,
  getDataGovernanceSummary,
} from './data-governance.service.js';
