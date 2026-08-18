/**
 * Edikit — Migration 049: Users final schema (AUTH B-01)
 *
 * 001_tenant_rbac.js'da yaratilgan `users` jadvalini AUTH B-01 canonical
 * schema'ga keltiradi (backward-compatible, faqat ADD COLUMN):
 *
 *   - Auth fieldlari: email_verified, email_status, role, is_vip,
 *     password_updated_at, role_version, google_sub, hemis_id, telegram_id,
 *     twofa_enabled, mfa_totp_status, invite_code, failed_attempts,
 *     locked_until, last_login_at, last_login_ip_hash, last_login_device_hash,
 *     reject_reason, reject_cooldown_until, name
 *   - Unique index: username, email, google_sub, hemis_id, telegram_id,
 *     invite_code (guide §07)
 *   - CHECK constraint: user_role, email_status enum'lar (guide §08)
 *   - updated_at trigger (guide §09)
 *
 * Rollback (down): qo'shilgan barcha ustunlar/index/trigger olib tashlanadi —
 * 001 holatiga qaytadi (guide §10).
 */

import { sql } from 'kysely';

const USER_ROLE_CHECK = "role IN ('student','teacher_pending','teacher','teacher_rejected','admin','co_teacher','proctor','marker')";
const EMAIL_STATUS_CHECK = "email_status IN ('verified','pending','bounced','suppressed')";

/**
 * @param {import('kysely').Kysely<any>} db
 */
export async function up(db) {
  // ── 1. Auth fieldlari (backward-compatible ADD COLUMN) ──
  await db.schema
    .alterTable('users')
    .addColumn('name', 'varchar(255)')
    .addColumn('email_verified', 'boolean', (col) => col.notNull().defaultTo(false))
    .addColumn('email_status', 'varchar(16)', (col) => col.notNull().defaultTo('pending'))
    .addColumn('role', 'varchar(30)', (col) => col.notNull().defaultTo('student'))
    .addColumn('is_vip', 'boolean', (col) => col.notNull().defaultTo(false))
    .addColumn('password_updated_at', 'bigint', (col) => col.notNull().defaultTo(0))
    .addColumn('role_version', 'bigint', (col) => col.notNull().defaultTo(1))
    .addColumn('google_sub', 'varchar(255)')
    .addColumn('hemis_id', 'varchar(64)')
    .addColumn('telegram_id', 'varchar(64)')
    .addColumn('twofa_enabled', 'boolean', (col) => col.notNull().defaultTo(false))
    .addColumn('mfa_totp_status', 'varchar(16)', (col) => col.notNull().defaultTo('disabled'))
    .addColumn('invite_code', 'varchar(48)')
    .addColumn('failed_attempts', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('locked_until', 'timestamptz')
    .addColumn('last_login_at', 'timestamptz')
    .addColumn('last_login_ip_hash', 'varchar(64)')
    .addColumn('last_login_device_hash', 'varchar(64)')
    .addColumn('reject_reason', 'varchar(255)')
    .addColumn('reject_cooldown_until', 'timestamptz')
    .execute();

  // ── 2. Enum CHECK constraint'lar (guide §08) ──
  await db.schema
    .alterTable('users')
    .addCheckConstraint('users_role_check', sql.raw(USER_ROLE_CHECK))
    .execute();
  await db.schema
    .alterTable('users')
    .addCheckConstraint('users_email_status_check', sql.raw(EMAIL_STATUS_CHECK))
    .execute();

  // ── 3. Unique index'lar (guide §07) — username global unique (001 faqat
  // tenant ichida unique edi; guide §07 platforma darajasida talab qiladi).
  await db.schema.createIndex('idx_users_username_unique').on('users').column('username').unique().execute();
  await db.schema.createIndex('idx_users_email_unique').on('users').column('email').unique().execute();
  await db.schema.createIndex('idx_users_google_sub_unique').on('users').column('google_sub').unique().execute();
  await db.schema.createIndex('idx_users_hemis_id_unique').on('users').column('hemis_id').unique().execute();
  await db.schema.createIndex('idx_users_telegram_id_unique').on('users').column('telegram_id').unique().execute();
  await db.schema.createIndex('idx_users_invite_code_unique').on('users').column('invite_code').unique().execute();
  await db.schema.createIndex('idx_users_role').on('users').column('role').execute();

  // ── 4. updated_at trigger (guide §09) ──
  await sql`
    CREATE OR REPLACE FUNCTION set_updated_at()
    RETURNS TRIGGER AS $$
    BEGIN
      NEW.updated_at = now();
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql
  `.execute(db);
  await sql`
    CREATE TRIGGER trg_users_updated_at
    BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION set_updated_at()
  `.execute(db);
}

/**
 * @param {import('kysely').Kysely<any>} db
 */
export async function down(db) {
  await sql`DROP TRIGGER IF EXISTS trg_users_updated_at ON users`.execute(db);
  await sql`DROP FUNCTION IF EXISTS set_updated_at()`.execute(db);

  await db.schema.dropIndex('idx_users_role').ifExists().execute();
  await db.schema.dropIndex('idx_users_username_unique').ifExists().execute();
  await db.schema.dropIndex('idx_users_invite_code_unique').ifExists().execute();
  await db.schema.dropIndex('idx_users_telegram_id_unique').ifExists().execute();
  await db.schema.dropIndex('idx_users_hemis_id_unique').ifExists().execute();
  await db.schema.dropIndex('idx_users_google_sub_unique').ifExists().execute();
  await db.schema.dropIndex('idx_users_email_unique').ifExists().execute();

  await db.schema.alterTable('users').dropConstraint('users_email_status_check').execute();
  await db.schema.alterTable('users').dropConstraint('users_role_check').execute();

  await db.schema
    .alterTable('users')
    .dropColumn('reject_cooldown_until')
    .dropColumn('reject_reason')
    .dropColumn('last_login_device_hash')
    .dropColumn('last_login_ip_hash')
    .dropColumn('last_login_at')
    .dropColumn('locked_until')
    .dropColumn('failed_attempts')
    .dropColumn('invite_code')
    .dropColumn('mfa_totp_status')
    .dropColumn('twofa_enabled')
    .dropColumn('telegram_id')
    .dropColumn('hemis_id')
    .dropColumn('google_sub')
    .dropColumn('role_version')
    .dropColumn('password_updated_at')
    .dropColumn('is_vip')
    .dropColumn('role')
    .dropColumn('email_status')
    .dropColumn('email_verified')
    .dropColumn('name')
    .execute();
}
