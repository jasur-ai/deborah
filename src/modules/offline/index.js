/**
 * Deborah — IndexedDB Offline Journal, Reconnect & Recovery (Prompt 32)
 *
 * Phase D #3: low-bandwidth/crash resilience — encrypted local journal,
 * lossless reconnect sync, emergency recovery packages.
 *
 * Usage:
 *   import * as offline from '../modules/offline/index.js';
 *   import { reconnectSync, exportRecoveryPackage } from '../modules/offline/index.js';
 */

export * from './offline.schema.js';
export * from './offline.service.js';
