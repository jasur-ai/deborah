/**
 * AUTH B-01 — Users final schema (canonical registry + DTO)
 * ----------------------------------------------------------------------------
 * Users jadvali uchun YAGONA canonical schema:
 *   - Enum'lar: USER_ROLES, EMAIL_STATUS (guide §08)
 *   - Field registry: USER_SCHEMA — har bir field type/default (guide §06)
 *   - normalizeUserRecord: legacy firebase user'lar uchun idempotent backfill
 *   - Zod DTO: public (id, username, name, role) / private (+ email, hemis_id)
 *     — password_hash/google_sub/telegram_id/ip-hash HECH QACHON DTO'da (guide §12)
 *
 * Runtime Firebase nomlari (camelCase + snake_case aralash) saqlanadi —
 * SQL migration'da (migrations/049) guide'dagi snake_case nomlar ishlatiladi.
 */

import { z } from 'zod';

// ── Enum'lar (guide §08) ─────────────────────────────────────────────────────
/** user_role — PostgreSQL CHECK constraint bilan bir xil ro'yxat. */
export const USER_ROLES = [
  'student',
  'teacher_pending',
  'teacher',
  'teacher_rejected',
  'admin',
  'co_teacher',
  // Runtime qo'shimchalar (A-fazadan): rol tekshiruvlari bularga tayanadi.
  'proctor',
  'marker',
] ;

/** email_status — verified|pending|bounced|suppressed. */
export const EMAIL_STATUS = ['verified', 'pending', 'bounced', 'suppressed'];

/** mfa_totp_status — MFA holati (A-26/A-30 bilan mos). */
export const MFA_TOTP_STATUS = ['disabled', 'pending', 'enabled'];

// ── Canonical field registry (guide §06) ────────────────────────────────────
// unique: true → username/email/google_sub/hemis_id/telegram_id/invite_code
export const USER_SCHEMA = {
  username: { type: 'string', required: true, unique: true },
  name: { type: 'string|null' },
  email: { type: 'string|null', unique: true },
  email_verified: { type: 'boolean', default: false },
  email_status: { type: 'enum:EMAIL_STATUS|null' },
  role: { type: 'enum:USER_ROLES', default: 'student' },
  isVip: { type: 'boolean', default: false },
  password: { type: 'string|argon2' },
  password_updated_at: { type: 'number', default: 0 },
  role_version: { type: 'number', default: 1 },
  google_sub: { type: 'string|null', unique: true },
  hemis_id: { type: 'string|null', unique: true },
  telegram_id: { type: 'string|null', unique: true },
  // E-01a: canonical OneID — barcha provider'lar shu yagona identifikatorga bog'lanadi
  oneid_sub: { type: 'string|null', unique: true },
  twofa_enabled: { type: 'boolean', default: false },
  mfa_totp_status: { type: 'enum:MFA_TOTP_STATUS', default: 'disabled' },
  invite_code: { type: 'string|null', unique: true },
  failed_attempts: { type: 'number', default: 0 },
  locked_until: { type: 'number|null', default: null },
  last_login_at: { type: 'number|null' },
  last_login_ip_hash: { type: 'string|null' },
  last_login_device_hash: { type: 'string|null' },
  reject_reason: { type: 'string|null' },
  reject_cooldown_until: { type: 'number|null' },
  created_at: { type: 'number', default: () => Date.now() },
  updated_at: { type: 'number', default: () => Date.now() },
  safeKey: { type: 'string' },
};

/**
 * DTO'da HECH QACHON chiqmasligi kerak bo'lgan kalitlar (guide §12, §28):
 * parol, OAuth/Telegram identifikatorlar, IP hash, MFA secret/holat, lockout.
 * Public ham, private ham bularni o'z ichiga olmaydi.
 */
export const SECRET_KEYS = [
  'password',
  'password_hash',
  'vipPlainPassword',
  'google_sub',
  'telegram_id',
  'oneid_sub',
  'last_login_ip_hash',
  'last_login_device_hash',
  'mfa_totp_status',
  'twofa_secret',
  'failed_attempts',
  'locked_until',
  'security_events',
  'devices',
  'breach_flagged',
  'reset_token',
];

/**
 * Legacy firebase user'ni canonical schema'ga keltiradi (idempotent backfill).
 *
 * - `role` YO'Q bo'lsa tegilMAYDI: platforma admin'i (__admin__/ADMIN_USER)
 *   rol'siz yashaydi — default 'student' uni buzardi. Login o'zi hal qiladi.
 * - email_status email_verified'dan derivatsiya qilinadi.
 * - Ikki marta chaqirish ikkinchi marta hech narsa o'zgartirmaydi (idempotent).
 */
export function normalizeUserRecord(record) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) return record;

  const out = { ...record };
  const now = Date.now();

  if (out.email === undefined) out.email = null;
  if (out.email_verified === undefined) out.email_verified = false;
  if (out.email_status === undefined) {
    out.email_status = out.email
      ? (out.email_verified === true ? 'verified' : 'pending')
      : null;
  }
  // Eski local-db isVip auto-migration xulqini AYNAN saqlash (B-01 review fix):
  // ilgari isVip bilan birga vipGrantedAt/By/RevokedAt/vipPlainPassword ham
  // null default qilinardi — VIP UI/`vip.js` undefined o'rniga null kutadi.
  if (out.isVip === undefined) out.isVip = false;
  if (out.vipGrantedAt === undefined) out.vipGrantedAt = null;
  if (out.vipGrantedBy === undefined) out.vipGrantedBy = null;
  if (out.vipRevokedAt === undefined) out.vipRevokedAt = null;
  if (out.vipPlainPassword === undefined) out.vipPlainPassword = null;
  if (out.password_updated_at === undefined) out.password_updated_at = 0;
  if (out.role_version === undefined) out.role_version = 1;
  if (out.twofa_enabled === undefined) out.twofa_enabled = false;
  if (out.mfa_totp_status === undefined) out.mfa_totp_status = 'disabled';
  if (out.failed_attempts === undefined) out.failed_attempts = 0;
  if (out.locked_until === undefined) out.locked_until = null;
  if (out.last_login_at === undefined) out.last_login_at = null;
  if (out.last_login_ip_hash === undefined) out.last_login_ip_hash = null;
  if (out.last_login_device_hash === undefined) out.last_login_device_hash = null;
  if (out.reject_reason === undefined) out.reject_reason = null;
  if (out.reject_cooldown_until === undefined) out.reject_cooldown_until = null;
  if (out.google_sub === undefined) out.google_sub = null;
  if (out.hemis_id === undefined) out.hemis_id = null;
  if (out.telegram_id === undefined) out.telegram_id = null;
  if (out.oneid_sub === undefined) out.oneid_sub = null;
  if (out.invite_code === undefined) out.invite_code = null;
  if (out.created_at === undefined) out.created_at = now;
  if (out.updated_at === undefined) out.updated_at = out.created_at || now;

  return out;
}

// ── Zod DTO (guide §11) ──────────────────────────────────────────────────────
/** Public DTO — clientga ochiq (id, username, name, role). PII yo'q. */
export const userPublicSchema = z.object({
  id: z.string(),
  username: z.string(),
  name: z.string().nullable(),
  role: z.string(),
  emailVerified: z.boolean(),
  isVip: z.boolean(),
});

/** Private DTO — egalik qilgan foydalanuvchi uchun (+email, hemis_id). */
export const userPrivateSchema = userPublicSchema.extend({
  email: z.string().nullable(),
  // B-01 review fix: enum DTO'da majburiy (guide §08) — tipoda xato qiymat o'tmaydi.
  emailStatus: z.enum(EMAIL_STATUS).nullable(),
  hemisId: z.string().nullable(),
  phone: z.string().nullable(),
});

function stripSecrets(record) {
  const out = { ...record };
  for (const k of SECRET_KEYS) delete out[k];
  return out;
}

/** Public ko'rinish — id/username/name/role (+ non-PII UX flaglari). */
export function toPublicUser(record, opts = {}) {
  const rec = stripSecrets(record || {});
  const out = {
    id: String(rec.safeKey || opts.key || rec.username || ''),
    username: rec.username || '',
    name: rec.name ?? rec.username ?? null,
    role: rec.role || 'student',
    emailVerified: rec.email_verified === true,
    isVip: rec.isVip === true,
  };
  // B-01 review fix: `.parse()` throw qilmasin — nostandart legacy record
  // /api/me ni 500 qilib yubormasligi uchun safeParse + fallback (defensiv).
  const parsed = userPublicSchema.safeParse(out);
  if (parsed.success) return parsed.data;
  return {
    id: String(out.id),
    username: String(out.username),
    name: out.name === null ? null : String(out.name),
    role: String(out.role),
    emailVerified: out.emailVerified === true,
    isVip: out.isVip === true,
  };
}

/** Private ko'rinish — egasi uchun; baribir secret/identifikatorlar yo'q. */
export function toPrivateUser(record, opts = {}) {
  const rec = stripSecrets(record || {});
  const out = {
    ...toPublicUser(rec, opts),
    email: rec.email ?? null,
    emailStatus: rec.email_status ?? (rec.email ? (rec.email_verified === true ? 'verified' : 'pending') : null),
    hemisId: rec.hemis_id ?? null,
    phone: rec.phone ?? null,
  };
  const parsed = userPrivateSchema.safeParse(out);
  if (parsed.success) return parsed.data;
  // Enum'ga mos bo'lmagan eski qiymat bo'lsa ham 500 bo'lmasin.
  return { ...out, emailStatus: null };
}
