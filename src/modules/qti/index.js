/**
 * Edikit — QTI Module Barrel Export
 *
 * Exports all QTI import/export staging services.
 * All modules gracefully degrade when PostgreSQL is unavailable.
 *
 * Usage:
 *   import * as qti from '../modules/qti/index.js';
 *   // Or:
 *   import { parseQtiPackage, exportItemToQti } from '../modules/qti/index.js';
 */

export {
  // Security
  validateQtiPackage,
  validateQtiExtension,
  validateQtiMimeType,
  validateQtiMagicBytes,
  validateQtiFileSize,
  validateQtiZipRatio,
  validateNoPathTraversal,
  validateXmlForXxe,
  validateManifestIntegrity,
  computeQtiFileHash,
  QTI_CONFIG,
  QtiValidationResult,
} from './qti-security.js';

export {
  // Parser
  parseQtiPackage,
  safeParseXml,
  detectInteractionType,
  mapInteractionToCanonical,
  generateUnsupportedReport,
  extractPrompt,
  extractCorrectAnswers,
  stripXmlTags,
  QTI_INTERACTIONS,
  QTI_RESPONSE_PROCESSING,
} from './qti-parser.js';

export {
  // Staging
  createQtiPackage,
  updateQtiPackage,
  getQtiPackage,
  listQtiPackages,
  deleteQtiPackage,
  createStagingItems,
  getStagingItems,
  getStagingItem,
  updateStagingItemReview,
  batchUpdateStagingReviews,
  commitQtiStaging,
  generateStagingReport,
  findExistingPackageByHash,
  STAGING_STATUS,
  PACKAGE_STATUS,
} from './qti-staging.js';

export {
  // Export
  exportItemToQti,
  exportAssessmentToQti,
  generateManifest,
  QTI_NAMESPACE,
  QTI_VERSION,
} from './qti-export.js';
