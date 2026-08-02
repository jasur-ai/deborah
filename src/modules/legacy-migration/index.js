/**
 * Edikit — Legacy Migration Module Barrel Export
 *
 * Provides tools for analyzing and mapping legacy JSON/Firebase data
 * to the PostgreSQL canonical schema for a dry-run migration report.
 *
 * Usage:
 *   import * as migration from '../modules/legacy-migration/index.js';
 *   // Or:
 *   import { mapLegacyUser } from '../modules/legacy-migration/index.js';
 */

export {
  mapLegacyUser,
  mapLegacyTest,
  mapLegacyQuestions,
  mapLegacyMockFan,
  mapLegacyPreGroup,
  mapLegacyGameResult,
  mapLegacyEnrollment,
  analyzeLegacyData,
  generateDryRunReport,
  computeDataHash,
} from './mapper.js';
