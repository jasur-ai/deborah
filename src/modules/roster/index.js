/**
 * Edikit — Roster Module Barrel Export
 *
 * Exports all roster upload/parse/staging services.
 * All modules gracefully degrade when tools are unavailable.
 */

export {
  validateRosterFile,
  validateExtension,
  validateMimeType,
  validateMagicBytes,
  validateFileSize,
  validateZipRatio,
  validateNoMacros,
  validateRowLimits,
  validateCellContent,
  ROSTER_CONFIG,
} from './validator.js';

export {
  parseRosterFile,
  parseXlsx,
  parseCsv,
  normalizeValue,
  normalizeEmail,
  normalizeName,
  normalizeUsername,
} from './parser.js';

export {
  createStagingSession,
  getStagingSession,
  listStagingSessions,
  updateStagingSession,
  addRowError,
  addParsedRows,
  getParsedRows,
  generateParseReport,
  commitStagingSession,
  deleteStagingSession,
  rollbackStagingSession,
  exportRowErrors,
  setSessionApproval,
} from './staging.js';

export {
  detectColumnMapping,
  saveColumnMapping,
  loadColumnMapping,
  validateMappingCompleteness,
  validateRequiredFields,
  detectFileDuplicates,
  validateReferentialIntegrity,
  generateDiff,
  generatePreview,
  computeRosterHash,
  DEFAULT_COLUMN_MAP,
} from './mapper.js';
