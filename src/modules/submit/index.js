/**
 * Edikit — Submit Sealing va Signed Receipt (Prompt 33)
 *
 * Phase D #4: immutable submit — pending flush, completeness summary,
 * submission hash/snapshot, scoring outbox enqueue, signed receipt.
 *
 * Usage:
 *   import * as submit from '../modules/submit/index.js';
 *   import { submitAttempt } from '../modules/submit/index.js';
 */

export * from './submit.schema.js';
export * from './submit.service.js';
