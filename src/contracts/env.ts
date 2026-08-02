/**
 * Edikit — Env Config Contract
 *
 * Canonical TypeScript type for environment configuration.
 * Mirrors the Zod schema in src/config/env.js.
 *
 * When adding new env vars, update both the Zod schema (env.js)
 * and this interface to keep them in sync.
 *
 * Usage:
 *   import type { EnvConfig } from './env.js';
 *   const config: EnvConfig = { ... };
 */

export interface EnvConfig {
  NODE_ENV: 'development' | 'production' | 'test';
  PORT: number;
  HOST: string;
  SESSION_SECRET: string;
  SESSION_MAX_AGE: number;
  ADMIN_USER: string;
  ADMIN_PASS: string;
  DATABASE_URL?: string;
  REDIS_URL?: string;
  STORAGE_TYPE: 'local' | 's3';
  S3_ENDPOINT?: string;
  S3_REGION?: string;
  S3_BUCKET?: string;
  S3_ACCESS_KEY?: string;
  S3_SECRET_KEY?: string;
  LOG_LEVEL: 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace' | 'silent';
  LOG_PRETTY: boolean;
}
