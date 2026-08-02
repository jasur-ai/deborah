/**
 * Edikit — Environment Configuration Schema
 *
 * Uses Zod to validate and parse environment variables at startup.
 * Fails fast with clear error messages for missing/invalid config.
 *
 * Required vs Optional:
 *   - PRODUCTION: SESSION_SECRET, ADMIN_USER, ADMIN_PASS are REQUIRED
 *   - DEVELOPMENT/TEST: defaults are allowed
 */

import { z } from 'zod';
import 'dotenv/config';

// ── Raw env helper (always returns string | undefined) ──
const env = (key) => process.env[key];

// ── Base schema (applied in all environments) ──
const baseSchema = z.object({
  // Node
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),

  // Server
  PORT: z.coerce.number().int().positive().max(65535).default(3000),
  HOST: z.string().default('0.0.0.0'),

  // Session
  SESSION_SECRET: z.string().min(16, 'SESSION_SECRET must be at least 16 characters'),
  SESSION_MAX_AGE: z.coerce.number().int().positive().default(86400000), // 24h

  // Admin credentials
  ADMIN_USER: z.string().min(1, 'ADMIN_USER is required'),
  ADMIN_PASS: z.string().min(1, 'ADMIN_PASS is required'),

  // Firebase (optional — local-db.js is fallback)
  FIREBASE_SERVICE_ACCOUNT_PATH: z.string().optional(),
  FIREBASE_DATABASE_URL: z.string().url().optional(),

  // Site URL (for OG images and OIDC redirect)
  SITE_URL: z.string().url().optional(),

  // ── Google OIDC (optional — disabled when not configured) ──
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  GOOGLE_REDIRECT_URI: z.string().url().optional(),
  GOOGLE_HD: z.string().optional(), // Restrict to Google Workspace domain

  // ── PostgreSQL ──
  DATABASE_URL: z.string().optional(),

  // ── Redis ──
  REDIS_URL: z.string().optional(),

  // ── Object Storage (S3-compatible, e.g. MinIO) ──
  STORAGE_TYPE: z.enum(['local', 's3']).default('local'),
  S3_ENDPOINT: z.string().optional(),
  S3_REGION: z.string().optional(),
  S3_BUCKET: z.string().optional(),
  S3_ACCESS_KEY: z.string().optional(),
  S3_SECRET_KEY: z.string().optional(),

  // Logging
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  LOG_PRETTY: z
    .string()
    .optional()
    .transform((v) => v === 'true' || v === '1'),
});

// ── Production-only overrides ──
const productionSchema = baseSchema.superRefine((data, ctx) => {
  if (data.NODE_ENV === 'production') {
    // In production, admin credentials must NOT be defaults
    if (data.ADMIN_USER === 'admin' || data.ADMIN_PASS === 'admin') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          'DEFAULT ADMIN CREDENTIALS in production! Set ADMIN_USER and ADMIN_PASS in .env to non-default values.',
        path: ['ADMIN_USER'],
      });
    }

    // In production, SESSION_SECRET must not be default
    if (data.SESSION_SECRET === 'edikit-dev-secret') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          'DEFAULT SESSION_SECRET in production! Set a unique, cryptographically random value.',
        path: ['SESSION_SECRET'],
      });
    }

    // In production, SITE_URL is recommended
    if (!data.SITE_URL) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          'SITE_URL is recommended in production (for OG image generation).',
        path: ['SITE_URL'],
      });
    }
  }
});

// ── Build and validate ──
function buildConfig() {
  const raw = {
    NODE_ENV: env('NODE_ENV'),
    PORT: env('PORT'),
    HOST: env('HOST'),
    SESSION_SECRET: env('SESSION_SECRET') || 'edikit-dev-secret',
    SESSION_MAX_AGE: env('SESSION_MAX_AGE') || '86400000',
    ADMIN_USER: env('ADMIN_USER') || 'admin',
    ADMIN_PASS: env('ADMIN_PASS') || 'admin',
    FIREBASE_SERVICE_ACCOUNT_PATH: env('FIREBASE_SERVICE_ACCOUNT_PATH'),
    FIREBASE_DATABASE_URL: env('FIREBASE_DATABASE_URL'),
    SITE_URL: env('SITE_URL'),
    DATABASE_URL: env('DATABASE_URL'),
    REDIS_URL: env('REDIS_URL'),
    STORAGE_TYPE: env('STORAGE_TYPE'),
    S3_ENDPOINT: env('S3_ENDPOINT'),
    S3_REGION: env('S3_REGION'),
    S3_BUCKET: env('S3_BUCKET'),
    S3_ACCESS_KEY: env('S3_ACCESS_KEY'),
    S3_SECRET_KEY: env('S3_SECRET_KEY'),
    LOG_LEVEL: env('LOG_LEVEL'),
    LOG_PRETTY: env('LOG_PRETTY'),
  };

  const result = productionSchema.safeParse(raw);

  if (!result.success) {
    const isProd = raw.NODE_ENV === 'production';
    const issues = result.error.issues.map(
      (issue) => `  ${isProd ? '❌' : '⚠️'} ${issue.path.join('.')}: ${issue.message}`
    );

    const header = isProd
      ? ['\n╔══════════════════════════════════════════════╗',
         '║   ❌ EDIKIT CONFIGURATION ERROR             ║',
         '╚══════════════════════════════════════════════╝']
      : ['\n── Edikit Config Warnings ──'];

    const footer = isProd
      ? ['Fix these issues in your .env file or environment variables.', '']
      : ['Some values use defaults. Set them in .env for production.', ''];

    console[isProd ? 'error' : 'warn'](
      [...header, ...issues, '', ...footer].join('\n')
    );

    if (isProd) {
      process.exit(1);
    }
  }

  // Return typed data with defaults applied from the safeParse result
  return result.data || productionSchema.parse(raw);
}

// ── Singleton config ──
const CONFIG = buildConfig();

export default CONFIG;

export { buildConfig, baseSchema, productionSchema };
