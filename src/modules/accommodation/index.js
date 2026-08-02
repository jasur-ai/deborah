/**
 * Edikit — Accommodation Module Barrel Export
 *
 * Provides accommodation management for students including:
 * - CRUD for accommodation records
 * - Version history tracking
 * - Assessment assignment snapshots
 * - Sensitive rationale encryption/access control
 * - Operational config for timer, break, camera, strike policy
 *
 * Usage:
 *   import * as accommodation from '../modules/accommodation/index.js';
 *   // Or:
 *   import { createAccommodation } from '../modules/accommodation/index.js';
 */

export {
  createAccommodation,
  getAccommodation,
  listAccommodations,
  updateAccommodation,
  revokeAccommodation,
  getAccommodationVersions,
  createAccommodationSnapshot,
  getSnapshotsForAssignment,
  getActiveAccommodationsForUser,
  getEffectiveOperationalConfig,
  encryptSensitiveRationale,
  decryptSensitiveRationale,
  hasSensitiveAccess,
  confirmAccommodation,
} from './accommodation.service.js';
