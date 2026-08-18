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
  purgeExpiredStagingSessions,
  setSessionApproval,
  buildRowStatusReport,
  reconcileSession,
} from './staging.js';

export {
  createInvitesForSession,
  acceptInvite,
  revokeInvite,
  listInvites,
  getPendingInviteSummary,
  INVITE_STATUS,
  // AUTH B-11: email yetkazish + expiry job + link validatsiya + rate limit
  sendInviteEmails,
  expireOverdueInvites,
  getInviteByHash,
  checkInviteSendLimit,
  // AUTH B-13: Google accept — invite claim (user yaratilishidan oldin)
  claimInviteForGoogle,
} from './invites.js';

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
