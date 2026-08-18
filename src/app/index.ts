/**
 * Deborah — Application Module
 *
 * This is the TypeScript module boundary for new code.
 * Legacy JS code (routes/, middleware/, utils/, socket/, firebase/)
 * remains in .js format — this module provides typed wrappers.
 *
 * New feature code should:
 *   1. Live in src/modules/<feature>/
 *   2. Export typed contracts from src/contracts/
 *   3. Import legacy services through adapters
 *
 * Directory structure:
 *   src/
 *     app/           → Application entry & composition (this dir)
 *     config/        → Environment, logger, features (JS, being migrated)
 *     contracts/     → Shared types, Zod schemas, Result type
 *     infrastructure → Postgres, Redis, Storage clients
 *     modules/       → Feature modules (auth, quiz, arena, admin)
 */

export const APP_NAME = 'Deborah';
export const APP_VERSION = '2.0.0';

export interface AppInfo {
  name: string;
  version: string;
  nodeVersion: string;
  env: string;
}
