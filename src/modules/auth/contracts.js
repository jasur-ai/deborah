/**
 * Edikit — Auth API Contract (AUTH D-30)
 * ---------------------------------------------------------------------------
 * Barcha auth request/response'lar uchun SHARED Zod schemas — client (D-29)
 * va server (validation.js) yagona manba sifatida import qiladi (§06, §12).
 *
 * Qoidalar:
 *  - Private field'lar (password, token, otp, secret) response'da YO'Q (§11) —
 *    yagona istisno: MFA enroll (secret bir marta ko'rsatiladi, `enrollOnly`).
 *  - Error codes enum (§08): A-04 kodlari + i18n key'lar.
 *  - Rate limit header'lar contract'da (§09, C-01 — middleware/rate-limit.js).
 *  - Response envelope: { ok, data?, error? } bir xil (§27).
 *  - OpenAPI 3.1 JSON Schema'ga aylantirish: `schema.toJSONSchema()`
 *    (zod 4 native — yangi dependency yo'q); `scripts/openapi-generate.js`.
 */

import { z } from 'zod';

/* -------------------------------------------------------------------------- */
/* 1. Umumiy tiplar                                                           */
/* -------------------------------------------------------------------------- */

export const langEnum = z.enum(['uz', 'uz-cyrl', 'ru', 'en']);

export const envelope = (dataSchema) =>
  z.object({
    ok: z.boolean(),
    data: dataSchema.optional().nullable(),
    error: z.string().optional(),
  });

export const errorEnvelope = z.object({
  ok: z.literal(false),
  error: z.string(),
  retryAfter: z.number().int().optional(),
  releaseAt: z.number().int().optional(),
  details: z.record(z.string(), z.string()).optional(),
});

export const okEnvelope = envelope(z.unknown());

/* -------------------------------------------------------------------------- */
/* 2. Error codes (A-04 + D-faza) — contract enum (§08)                       */
/* -------------------------------------------------------------------------- */

export const ERROR_CODES = [
  // A-04 asosiy
  'AUTH_FAILED', 'RATE_LIMITED', 'LOCKED', 'INVALID_TOKEN', 'SESSION_EXPIRED',
  'CSRF_INVALID', 'ACCOUNT_BLOCKED', 'EMAIL_NOT_VERIFIED', 'MFA_REQUIRED',
  'MFA_INVALID', 'PASSWORD_WEAK', 'PASSWORD_BREACHED', 'PASSWORD_REUSE',
  'USERNAME_TAKEN', 'EMAIL_TAKEN', 'INVITE_INVALID', 'INVITE_EXPIRED',
  'CONSENT_REQUIRED', 'REAUTH_REQUIRED', 'NOT_FOUND', 'FORBIDDEN',
  // D-23 DSAR
  'DSAR_CONFIRM_REQUIRED', 'DSAR_IN_GRACE', 'DSAR_RESTRICTED',
  // D-24/25 consent
  'CONSENT_REVOKED', 'PURPOSE_REQUIRED',
  // D-26 incident
  'INCIDENT_ACTIVE', 'MFA_EMERGENCY_OFF',
];

export const errorCodeEnum = z.enum(ERROR_CODES);

/* -------------------------------------------------------------------------- */
/* 3. Request schemas                                                          */
/* -------------------------------------------------------------------------- */

export const loginSchema = z.object({
  // AUTH B-04 (runtime truth — validation.js): username min 1 (legacy), max 100,
  // `@`/`+` ham qabul (B-09 email login). contracts app bilan izchil.
  identifier: z.string().trim().min(1).max(100),
  password: z.string().min(1).max(200),
  lang: langEnum.optional(),
  remember: z.boolean().optional(),
  fingerprint: z.string().max(512).optional(),
});

export const registerSchema = z.object({
  email: z.string().email().max(320),
  // AUTH B-04 (runtime truth — validation.js): 2–50, `^[a-zA-Z0-9_.-]+$`.
  username: z.string().trim().min(2).max(50).regex(/^[a-zA-Z0-9_.-]+$/, 'usernameChars'),
  password: z.string().min(8).max(200),
  name: z.string().min(2).max(100).optional(),
  lang: langEnum.optional(),
  consent: z.union([z.literal('on'), z.literal('true'), z.literal('1'), z.boolean()]).optional(),
  inviteToken: z.string().max(64).optional(),
});

export const verifySchema = z.object({
  token: z.string().min(6).max(64),
  email: z.string().email().max(320).optional(),
});

export const resetSchema = z.object({
  identifier: z.string().min(3).max(320),
  lang: langEnum.optional(),
});

export const resetConfirmSchema = z.object({
  token: z.string().min(6).max(64),
  password: z.string().min(8).max(200),
});

export const mfaTotpSchema = z.object({
  code: z.string().regex(/^\d{6}$/),
});

export const mfaEnrollSchema = z.object({
  lang: langEnum.optional(),
});

export const mfaVerifySchema = z.object({
  code: z.string().regex(/^\d{6}$/),
  backupCode: z.string().min(10).max(32).optional(),
});

export const passkeySchema = z.object({
  challengeId: z.string().max(64).optional(),
  credential: z.record(z.unknown()).optional(),
});

export const sessionRevokeSchema = z.object({
  sessionId: z.string().max(128),
});

export const reauthSchema = z.object({
  password: z.string().min(1).max(200),
});

export const teacherApproveSchema = z.object({
  inviteToken: z.string().max(64),
  approve: z.boolean(),
});

export const dsarSchema = z.object({
  action: z.enum(['export', 'correct', 'delete', 'restrict']),
  confirm: z.boolean().optional(),
  patch: z.record(z.unknown()).optional(),
});

export const consentRevokeSchema = z.object({
  purpose: z.enum(['privacy_policy_v1', 'telegram', 'email_marketing', 'mfa', 'camera']),
});

/* -------------------------------------------------------------------------- */
/* 4. Response schemas (private field YO'Q — §11)                              */
/* -------------------------------------------------------------------------- */

export const loginResponse = z.object({
  ok: z.literal(true),
  redirect: z.string().optional(),
  mfaRequired: z.boolean().optional(),
  backupCodesRemaining: z.number().int().optional(),
});

export const registerResponse = z.object({
  ok: z.literal(true),
  redirect: z.string().optional(),
  emailSent: z.boolean().optional(),
});

export const resetResponse = z.object({
  ok: z.literal(true),
  emailSent: z.boolean().optional(),
});

export const mfaStatusResponse = z.object({
  ok: z.literal(true),
  enabled: z.boolean(),
  method: z.enum(['totp', 'passkey']).optional(),
  backupCodesRemaining: z.number().int().optional(),
});

/** MFA enroll — yagona istisno: secret bir marta qaytadi (authenticator'ga qo'yish uchun). */
export const mfaEnrollResponse = z.object({
  ok: z.literal(true),
  secret: z.string().length(32),
  otpauth: z.string().max(300),
  qr: z.string().max(10000),
});

export const sessionListResponse = z.object({
  ok: z.literal(true),
  count: z.number().int(),
  sessions: z
    .array(
      z.object({
        id: z.string(),
        createdAt: z.number().int(),
        lastActiveAt: z.number().int().optional(),
        ipHash: z.string().optional(),
        device: z.string().optional(),
        current: z.boolean().optional(),
      })
    )
    .optional(),
});

export const consentStatusResponse = z.object({
  ok: z.literal(true),
  consents: z.record(
    z.string(),
    z.object({
      granted_at: z.number().int(),
      version: z.string(),
      revoked_at: z.number().int().nullable().optional(),
      lang: langEnum.optional(),
    })
  ),
});

export const dsarExportResponse = z.object({
  ok: z.literal(true),
  data: z.record(z.unknown()),
});

export const dsarDeleteResponse = z.object({
  ok: z.literal(true),
  graceUntil: z.number().int(),
  message: z.string(),
});

/* -------------------------------------------------------------------------- */
/* 5. Rate limit header'lar (C-01 / §09)                                      */
/* -------------------------------------------------------------------------- */

export const rateLimitHeaders = {
  'X-RateLimit-Limit': z.coerce.number().int(),
  'X-RateLimit-Remaining': z.coerce.number().int(),
  'X-RateLimit-Reset': z.coerce.number().int(),
};

/* -------------------------------------------------------------------------- */
/* 6. OpenAPI security scheme (session cookie + CSRF — §25)                   */
/* -------------------------------------------------------------------------- */

export const SECURITY_SCHEMES = {
  sessionCookie: { type: 'http', scheme: 'bearer' },
  csrfToken: { type: 'apiKey', in: 'header', name: 'x-csrf-token' },
};

/* -------------------------------------------------------------------------- */
/* 7. Endpoint kontrakt registri (OpenAPI generator uchun)                    */
/* -------------------------------------------------------------------------- */

export const ENDPOINTS = {
  'POST /api/v1/auth/login': { request: loginSchema, response: loginResponse, auth: false },
  'POST /api/v1/auth/register': { request: registerSchema, response: registerResponse, auth: false },
  'POST /api/v1/auth/verify': { request: verifySchema, response: okEnvelope, auth: false },
  'POST /api/v1/auth/reset': { request: resetSchema, response: resetResponse, auth: false },
  'POST /api/v1/auth/reset/confirm': { request: resetConfirmSchema, response: okEnvelope, auth: false },
  'POST /api/v1/auth/reauth': { request: reauthSchema, response: okEnvelope, auth: true },
  'GET /api/v1/mfa/status': { request: null, response: mfaStatusResponse, auth: true },
  'POST /api/v1/mfa/enroll': { request: mfaEnrollSchema, response: mfaEnrollResponse, auth: true },
  'POST /api/v1/mfa/verify': { request: mfaVerifySchema, response: okEnvelope, auth: true },
  'POST /api/v1/passkey/register': { request: passkeySchema, response: okEnvelope, auth: true },
  'GET /api/v1/session/list': { request: null, response: sessionListResponse, auth: true },
  'POST /api/v1/session/revoke': { request: sessionRevokeSchema, response: okEnvelope, auth: true },
  'POST /api/v1/roster/invites/approve': { request: teacherApproveSchema, response: okEnvelope, auth: true },
  'GET /api/v1/consent/status': { request: null, response: consentStatusResponse, auth: true },
  'POST /api/v1/consent/revoke': { request: consentRevokeSchema, response: okEnvelope, auth: true },
  'POST /api/v1/privacy/dsar/export': { request: dsarSchema, response: dsarExportResponse, auth: true },
  'POST /api/v1/privacy/dsar/delete': { request: dsarSchema, response: dsarDeleteResponse, auth: true },
};
