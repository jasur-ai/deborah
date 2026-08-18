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
  // AUTH A-02: cookie name (+ P2 `__Host-` prefix faqat production+HTTPS'da)
  SESSION_COOKIE_NAME: z.string().min(1).default('connect.sid'),
  SESSION_HOST_PREFIX: z
    .string()
    .optional()
    .transform((v) => v === 'true' || v === '1'),
  // AUTH A-02: idle timeout — 30 daqiqa harakatsizlik → sessiya bekor (tenant sozlashi mumkin)
  SESSION_IDLE_TIMEOUT_MS: z.coerce.number().int().min(60000).max(86400000).default(1800000),
  // AUTH A-02: lastActive touch throttling — har request'da Redis yozuv emas
  SESSION_TOUCH_INTERVAL_MS: z.coerce.number().int().min(1000).max(3600000).default(300000),
  // AUTH A-02: parallel session limit — 5; 6-chisi kelganda eng eski revoke
  SESSION_MAX_PARALLEL: z.coerce.number().int().min(1).max(50).default(5),
  // AUTH A-25: absolute session timeout — 12 soat (login'dan boshlab qat'iy)
  SESSION_ABSOLUTE_TIMEOUT_MS: z.coerce.number().int().min(3600000).max(604800000).default(43200000),
  // AUTH A-25: mid-session ID rotation — har 30 daqiqada sessiya ID yangilanadi
  SESSION_ROTATE_INTERVAL_MS: z.coerce.number().int().min(60000).max(86400000).default(1800000),
  // AUTH A-25: sensitive amallar (parol/email change, teacher approve) re-auth TTL — 10 daqiqa
  REAUTH_TTL_MS: z.coerce.number().int().min(60000).max(3600000).default(600000),
  // AUTH A-25: teacher approval Entra PIM — 72 soat oyna, 7 kun eskalatsiya, 30 kun cooldown
  TEACHER_APPROVAL_WINDOW_MS: z.coerce.number().int().min(3600000).max(604800000).default(259200000),
  TEACHER_ESCALATION_MS: z.coerce.number().int().min(86400000).max(2592000000).default(604800000),
  TEACHER_REJECT_COOLDOWN_MS: z.coerce.number().int().min(86400000).max(2592000000).default(2592000000),

  // AUTH A-03: login lockout (per-IP yumshoq, per-user qattiq — kampus NAT)
  AUTH_LOCKOUT_IP_FAILURES: z.coerce.number().int().min(1).max(100).default(5),
  AUTH_LOCKOUT_IP_MS: z.coerce.number().int().min(60000).max(3600000).default(300000), // 5 min
  AUTH_LOCKOUT_USER_FAILURES: z.coerce.number().int().min(1).max(100).default(10),
  AUTH_LOCKOUT_USER_MS: z.coerce.number().int().min(60000).max(86400000).default(900000), // 15 min
  // Jitter — login xatosida tasodifiy kechikish (brute force sekinlashtirish)
  AUTH_JITTER_MAX_MS: z.coerce.number().int().min(0).max(5000).default(600),
  // AUTH A-13: ochiq ma'lumotlar landing stats toggle (false/0 → o'chirilgan)
  OPEN_DATA_ENABLED: z
    .string()
    .default('true')
    .transform((v) => v === 'true' || v === '1'),

  // AUTH A-03: register bot-limiti — 5/15 daqiqa per IP (0 = o'chirilgan, tenant sozlashi mumkin)
  AUTH_REGISTER_MAX: z.coerce.number().int().min(0).max(1000).default(5),
  // AUTH A-03: reset so'rov limitu — 3/soat per account (0 = o'chirilgan)
  AUTH_RESET_MAX: z.coerce.number().int().min(0).max(1000).default(3),

  // AUTH A-26: MFA/TOTP — secret encrypt kaliti (yo'q bo'lsa SESSION_SECRET sha256)
  MFA_ENCRYPTION_KEY: z.string().optional(),

  // AUTH A-30: admin/teacher privilege hardening
  // Admin MFA mandatory flag — dev/test'da ADMIN_MFA_MANDATORY=true bilan
  // yoqiladi; production'da DOIM majburiy (bypass yo'q).
  ADMIN_MFA_MANDATORY: z
    .string()
    .optional()
    .transform((v) => v === 'true' || v === '1'),
  // Admin IP allowlist — vergul bilan exact IP yoki CIDR (ixtiyoriy, OTM)
  ADMIN_IP_ALLOWLIST: z.string().optional(),
  // Admin session: qisqa Max-Age (8 soat) + absolute timeout (guide §07)
  ADMIN_SESSION_TTL_MS: z.coerce.number().int().min(3600000).max(86400000).default(28800000),
  // Admin login lockout: 3 xato → 15 daqiqa (guide §08)
  ADMIN_LOGIN_MAX_FAILURES: z.coerce.number().int().min(1).max(50).default(3),
  ADMIN_LOGIN_LOCK_MS: z.coerce.number().int().min(60000).max(86400000).default(900000),
  // Admin re-auth sensitive amallar: fresh MFA TTL (30 daqiqa, guide §09)
  ADMIN_MFA_STEPUP_TTL_MS: z.coerce.number().int().min(60000).max(3600000).default(1800000),

  // AUTH A-28: risk-based auth — tier threshold'lar (tenant sozlashi, guide §29)
  RISK_TRUSTED_MAX: z.coerce.number().min(0).max(1).default(0.3),
  RISK_SUSPICIOUS_MIN: z.coerce.number().min(0).max(1).default(0.7),
  // Impossible-travel tezlik chegarasi (km/soat) — C-05 spec: > 800 → flag.
  // Reaktiv samolyot ~900 km/h, Toshkent→London ~5000 km: 6 soatda 833 km/h
  // → impossible (C-05 §06). Max 3000 (rekord tezlik ~2200).
  RISK_TRAVEL_SPEED_KMH: z.coerce.number().min(100).max(3000).default(800),

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

  // ── HEMIS identity (AUTH A-15) ──
  // REST-first: talaba o'z HEMIS login/paroli bilan akkauntini bog'laydi
  // (A-14 da live tasdiqlangan: POST /rest/v1/auth/login → JWT → account/me).
  HEMIS_BASE_URL: z.string().url().default('https://student.hemis.uz'),
  HEMIS_REST_ENABLED: z
    .string()
    .default('true')
    .transform((v) => v === 'true' || v === '1'),
  // OAuth2 — faqat OTM HEMIS panelida client yaratganda yoqiladi (hemis-oauth namuna)
  HEMIS_OAUTH_CLIENT_ID: z.string().optional(),
  HEMIS_OAUTH_CLIENT_SECRET: z.string().optional(),
  HEMIS_OAUTH_REDIRECT_URI: z.string().url().optional(),
  // AUTH A-15 §15: link/start rate limit — 10/15 daqiqa per IP
  HEMIS_LINK_MAX: z.coerce.number().int().min(1).max(100).default(10),
  HEMIS_LINK_WINDOW_MS: z.coerce.number().int().min(60000).max(86400000).default(900000),

  // ── Telegram OTP (AUTH A-16, P3) — bot token bo'lmasa disabled ──
  TELEGRAM_BOT_TOKEN: z.string().optional(),
  // AUTH B-08: Cloudflare Turnstile — bot himoya (secret backend'da, frontend'da hech qachon)
  TURNSTILE_SECRET_KEY: z.string().optional(),
  TURNSTILE_SITE_KEY: z.string().optional(),
  TELEGRAM_BOT_USERNAME: z.string().optional(),
  TELEGRAM_ENABLED: z
    .string()
    .default('true')
    .transform((v) => v === 'true' || v === '1'),
  // AUTH A-16 §13: start 5/15 daqiqa, verify 5/15 daqiqa per IP + per phone
  TELEGRAM_START_MAX: z.coerce.number().int().min(1).max(50).default(5),
  TELEGRAM_VERIFY_MAX: z.coerce.number().int().min(1).max(50).default(5),
  TELEGRAM_WINDOW_MS: z.coerce.number().int().min(60000).max(3600000).default(900000),

  // ── Web Push (AUTH B-23) — VAPID juftligi; secret prod'da KMS/env'da ──
  VAPID_PUBLIC_KEY: z.string().optional(),
  VAPID_PRIVATE_KEY: z.string().optional(),
  VAPID_SUBJECT: z.string().url().optional().default('mailto:no-reply@edikit.uz'),
  PUSH_ENABLED: z
    .string()
    .default('true')
    .transform((v) => v === 'true' || v === '1'),
  // B-23 §10: chastota cap + quiet hours (22:00-08:00 default)
  PUSH_DAILY_CAP: z.coerce.number().int().min(1).max(10).default(2),
  PUSH_QUIET_START: z.coerce.number().int().min(0).max(23).default(22),
  PUSH_QUIET_END: z.coerce.number().int().min(0).max(23).default(8),

  // AUTH E-03 — FCM device-token push (mobile). Server key secret — prod'da KMS/env.
  FCM_ENABLED: z
    .string()
    .default('true')
    .transform((v) => v === 'true' || v === '1'),
  FCM_SERVER_KEY: z.string().optional(),
  // B-23 §07: kontekstual opt-in — nechta login sessiyadan keyin so'raladi
  PUSH_OPTIN_AFTER_SESSIONS: z.coerce.number().int().min(1).max(20).default(2),

  // ── Base URL / domain allowlist (D-01: origin-check + OIDC redirect) ──
  // Ba'zi muhitlarda (CI/vitest child) BASE_URL avtomatik '/' bo'lib qoladi —
  // bo'sh/placeholder qiymatni undefined'ga aylantiramiz (prod'da fail-fast
  // superRefine buni ushlaydi — operator haqiqiy URL yozishi shart).
  BASE_URL: z
    .string()
    .optional()
    .transform((v) => (v && v !== '/' && v !== '' ? v : undefined)),

  // ── Cookies (D-01: security hardening — production'da Secure+SameSite) ──
  COOKIE_SECURE: z
    .string()
    .optional()
    .transform((v) => v === 'true' || v === '1'),
  COOKIE_SAMESITE: z.enum(['strict', 'lax', 'none']).default('lax'),

  // ── Email (D-01: provider schema — mock|smtp|postmark) ──
  EMAIL_PROVIDER: z.enum(['mock', 'smtp', 'postmark']).default('mock'),
  EMAIL_FROM: z.string().default('Edikit <no-reply@edikit.uz>'),
  EMAIL_SENDING_DOMAIN: z.string().optional(),
  EMAIL_API_KEY: z.string().optional(), // postmark server token (D-01 alias)
  POSTMARK_SERVER_TOKEN: z.string().optional(),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().min(1).max(65535).default(587),
  SMTP_SECURE: z
    .string()
    .optional()
    .transform((v) => v === 'true' || v === '1'),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),

  // ── HIBP (AUTH A-22) — pwned passwords k-anonymity endpoint ──
  HIBP_API_URL: z.string().url().default('https://api.pwnedpasswords.com/range/'),

  // ── MFA (D-01) — TOTP issuer (QR label) + KMS encrypt kaliti ──
  MFA_ISSUER: z.string().min(1).default('Edikit'),
  KMS_KEY_ARN: z.string().optional(), // prod'da MFA_ENCRYPTION_KEY o'rniga KMS
  // AUTH E-06: KMS bilan shifrlangan 32-bayt master key (base64) + region
  KMS_ENCRYPTED_MASTER_KEY: z.string().optional(),
  KMS_REGION: z.string().optional(), // AWS'da UZ yo'q — xususiy cloud / me-central-1

  // ── Observability (D-05) — OTLP trace export + sampling + tenant ──
  // UZ data law: self-hosted OTLP collector; xarajat uchun prod'da sampler (10%).
  OTEL_EXPORTER_OTLP_ENDPOINT: z.string().url().optional(),
  // Prod'da xarajat uchun default 10% — dev/test'da 100% (to'liq ko'rinish).
  OTEL_SAMPLE_RATE: z.coerce.number().min(0).max(1).default(process.env.NODE_ENV === 'production' ? 0.1 : 1),
  OTEL_RETENTION_DAYS: z.coerce.number().int().min(1).max(90).default(30),
  TENANT_ID: z.string().min(1).max(64).default('default'),

  // ── PostgreSQL ──
  DATABASE_URL: z.string().optional(),

  // ── Redis ──
  REDIS_URL: z.string().optional(),

  // ── Realtime / Multi-node (C5-06) ──
  REALTIME_MODE: z.enum(['single', 'redis_streams']).default('single'),
  SOCKET_RECOVERY_MAX_MS: z.coerce.number().int().min(0).max(120000).default(120000),
  CAST_NODE_ID: z.string().default(() => `node-${process.pid}`),
  CAST_MAX_TIER: z.enum(['S', 'M', 'L', 'XL', 'XXL']).default('XL'),
  // Sticky session / WS-only policies (documentation + boot log)
  LB_STICKY_SESSIONS: z.string().optional().transform((v) => v === 'true' || v === '1'),
  WEBSOCKET_ONLY: z.string().optional().transform((v) => v === 'true' || v === '1'),

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

  // ── AUTH C-14: data retention (UZ data law) — ms yoki kun birligida ──
  // Default: auth_audit 30 kun, email_log 30 kun, verification_codes 24 soat,
  // reset_tokens 24 soat, user_devices/risk_events 12 oy, revoked invites 90 kun.
  AUDIT_RETENTION_DAYS: z.coerce.number().int().min(1).max(3650).default(30),
  EMAIL_LOG_RETENTION_MS: z.coerce.number().int().min(3600000).default(30 * 24 * 3600000),
  VERIFY_CODE_RETENTION_MS: z.coerce.number().int().min(3600000).default(24 * 3600000),
  RESET_TOKEN_RETENTION_MS: z.coerce.number().int().min(3600000).default(24 * 3600000),
  DEVICE_RETENTION_MS: z.coerce.number().int().min(30 * 24 * 3600000).default(12 * 30 * 24 * 3600000),
  INVITE_REVOKED_RETENTION_MS: z.coerce.number().int().min(30 * 24 * 3600000).default(90 * 24 * 3600000),
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

    // AUTH B-08 (review fix): Turnstile secret bo'lmasa register bot-guard
    // fail-open ishlaydi (faqat honeypot+rate limit qoladi) — operator
    // unutib qo'ysa, bot himoyasi jimgina o'chib qoladi. Production majburiy.
    if (!data.TURNSTILE_SECRET_KEY) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          'TURNSTILE_SECRET_KEY is required in production (bot protection; without it register bot-guard silently fail-opens).',
        path: ['TURNSTILE_SECRET_KEY'],
      });
    }

    // D-01: cookie hardening — production'da COOKIE_SECURE tavsiya/kerak
    if (data.COOKIE_SECURE !== true) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          'COOKIE_SECURE must be true in production (session cookie over HTTPS only).',
        path: ['COOKIE_SECURE'],
      });
    }

    // D-01: email provider — postmark/smtp tanlanganda credential talab
    if (data.EMAIL_PROVIDER === 'postmark' && !data.POSTMARK_SERVER_TOKEN && !data.EMAIL_API_KEY) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          'POSTMARK_SERVER_TOKEN (yoki EMAIL_API_KEY) is required when EMAIL_PROVIDER=postmark.',
        path: ['EMAIL_PROVIDER'],
      });
    }
    if (data.EMAIL_PROVIDER === 'smtp' && !data.SMTP_HOST) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          'SMTP_HOST is required when EMAIL_PROVIDER=smtp.',
        path: ['EMAIL_PROVIDER'],
      });
    }

    // D-01: SESSION_SECRET — production'da 32+ bayt (D-01 §06: 32B+)
    if (data.SESSION_SECRET.length < 32) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          'SESSION_SECRET must be at least 32 characters in production (32B+).',
        path: ['SESSION_SECRET'],
      });
    }

    // D-01: BASE_URL production'da zarur (domain allowlist + OIDC redirect)
    if (!data.BASE_URL) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          'BASE_URL is required in production (domain allowlist, OIDC redirect, origin check).',
        path: ['BASE_URL'],
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
    SESSION_COOKIE_NAME: env('SESSION_COOKIE_NAME'),
    SESSION_HOST_PREFIX: env('SESSION_HOST_PREFIX'),
    SESSION_IDLE_TIMEOUT_MS: env('SESSION_IDLE_TIMEOUT_MS'),
    SESSION_TOUCH_INTERVAL_MS: env('SESSION_TOUCH_INTERVAL_MS'),
    SESSION_MAX_PARALLEL: env('SESSION_MAX_PARALLEL'),
    SESSION_ABSOLUTE_TIMEOUT_MS: env('SESSION_ABSOLUTE_TIMEOUT_MS'),
    SESSION_ROTATE_INTERVAL_MS: env('SESSION_ROTATE_INTERVAL_MS'),
    REAUTH_TTL_MS: env('REAUTH_TTL_MS'),
    TEACHER_APPROVAL_WINDOW_MS: env('TEACHER_APPROVAL_WINDOW_MS'),
    TEACHER_ESCALATION_MS: env('TEACHER_ESCALATION_MS'),
    TEACHER_REJECT_COOLDOWN_MS: env('TEACHER_REJECT_COOLDOWN_MS'),
    AUTH_LOCKOUT_IP_FAILURES: env('AUTH_LOCKOUT_IP_FAILURES'),
    AUTH_LOCKOUT_IP_MS: env('AUTH_LOCKOUT_IP_MS'),
    AUTH_LOCKOUT_USER_FAILURES: env('AUTH_LOCKOUT_USER_FAILURES'),
    AUTH_LOCKOUT_USER_MS: env('AUTH_LOCKOUT_USER_MS'),
    AUTH_JITTER_MAX_MS: env('AUTH_JITTER_MAX_MS'),
    AUTH_REGISTER_MAX: env('AUTH_REGISTER_MAX'),
    RISK_TRUSTED_MAX: env('RISK_TRUSTED_MAX'),
    RISK_SUSPICIOUS_MIN: env('RISK_SUSPICIOUS_MIN'),
    RISK_TRAVEL_SPEED_KMH: env('RISK_TRAVEL_SPEED_KMH'),
    AUTH_RESET_MAX: env('AUTH_RESET_MAX'),
    MFA_ENCRYPTION_KEY: env('MFA_ENCRYPTION_KEY'),
    ADMIN_MFA_MANDATORY: env('ADMIN_MFA_MANDATORY'),
    ADMIN_IP_ALLOWLIST: env('ADMIN_IP_ALLOWLIST'),
    ADMIN_SESSION_TTL_MS: env('ADMIN_SESSION_TTL_MS'),
    ADMIN_LOGIN_MAX_FAILURES: env('ADMIN_LOGIN_MAX_FAILURES'),
    ADMIN_LOGIN_LOCK_MS: env('ADMIN_LOGIN_LOCK_MS'),
    ADMIN_MFA_STEPUP_TTL_MS: env('ADMIN_MFA_STEPUP_TTL_MS'),
    ADMIN_USER: env('ADMIN_USER') || 'admin',
    ADMIN_PASS: env('ADMIN_PASS') || 'admin',
    FIREBASE_SERVICE_ACCOUNT_PATH: env('FIREBASE_SERVICE_ACCOUNT_PATH'),
    FIREBASE_DATABASE_URL: env('FIREBASE_DATABASE_URL'),
    SITE_URL: env('SITE_URL'),
    BASE_URL: env('BASE_URL'),
    COOKIE_SECURE: env('COOKIE_SECURE'),
    COOKIE_SAMESITE: env('COOKIE_SAMESITE'),
    EMAIL_PROVIDER: env('EMAIL_PROVIDER'),
    EMAIL_FROM: env('EMAIL_FROM'),
    EMAIL_SENDING_DOMAIN: env('EMAIL_SENDING_DOMAIN'),
    EMAIL_API_KEY: env('EMAIL_API_KEY'),
    POSTMARK_SERVER_TOKEN: env('POSTMARK_SERVER_TOKEN'),
    SMTP_HOST: env('SMTP_HOST'),
    SMTP_PORT: env('SMTP_PORT'),
    SMTP_SECURE: env('SMTP_SECURE'),
    SMTP_USER: env('SMTP_USER'),
    SMTP_PASS: env('SMTP_PASS'),
    HIBP_API_URL: env('HIBP_API_URL'),
    MFA_ISSUER: env('MFA_ISSUER'),
    KMS_KEY_ARN: env('KMS_KEY_ARN'),
    OTEL_EXPORTER_OTLP_ENDPOINT: env('OTEL_EXPORTER_OTLP_ENDPOINT'),
    OTEL_SAMPLE_RATE: env('OTEL_SAMPLE_RATE'),
    OTEL_RETENTION_DAYS: env('OTEL_RETENTION_DAYS'),
    TENANT_ID: env('TENANT_ID'),
    // ── Google OIDC ── (AUTH A-04: env.js raw'da o'qilmagan edi — OIDC hech
    // qachon yoqilmasdi; tuzatildi: isOidcEnabled() endi ishlaydi)
    GOOGLE_CLIENT_ID: env('GOOGLE_CLIENT_ID'),
    GOOGLE_CLIENT_SECRET: env('GOOGLE_CLIENT_SECRET'),
    GOOGLE_REDIRECT_URI: env('GOOGLE_REDIRECT_URI'),
    GOOGLE_HD: env('GOOGLE_HD'),
    HEMIS_BASE_URL: env('HEMIS_BASE_URL'),
    HEMIS_REST_ENABLED: env('HEMIS_REST_ENABLED'),
    HEMIS_OAUTH_CLIENT_ID: env('HEMIS_OAUTH_CLIENT_ID'),
    HEMIS_OAUTH_CLIENT_SECRET: env('HEMIS_OAUTH_CLIENT_SECRET'),
    HEMIS_OAUTH_REDIRECT_URI: env('HEMIS_OAUTH_REDIRECT_URI'),
    HEMIS_LINK_MAX: env('HEMIS_LINK_MAX'),
    HEMIS_LINK_WINDOW_MS: env('HEMIS_LINK_WINDOW_MS'),
    TELEGRAM_BOT_TOKEN: env('TELEGRAM_BOT_TOKEN'),
    TURNSTILE_SECRET_KEY: env('TURNSTILE_SECRET_KEY'),
    TURNSTILE_SITE_KEY: env('TURNSTILE_SITE_KEY'),
    TELEGRAM_BOT_USERNAME: env('TELEGRAM_BOT_USERNAME'),
    TELEGRAM_ENABLED: env('TELEGRAM_ENABLED'),
    TELEGRAM_START_MAX: env('TELEGRAM_START_MAX'),
    TELEGRAM_VERIFY_MAX: env('TELEGRAM_VERIFY_MAX'),
    TELEGRAM_WINDOW_MS: env('TELEGRAM_WINDOW_MS'),
    DATABASE_URL: env('DATABASE_URL'),
    REDIS_URL: env('REDIS_URL'),
    REALTIME_MODE: env('REALTIME_MODE'),
    SOCKET_RECOVERY_MAX_MS: env('SOCKET_RECOVERY_MAX_MS'),
    CAST_NODE_ID: env('CAST_NODE_ID'),
    CAST_MAX_TIER: env('CAST_MAX_TIER'),
    LB_STICKY_SESSIONS: env('LB_STICKY_SESSIONS'),
    WEBSOCKET_ONLY: env('WEBSOCKET_ONLY'),
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
