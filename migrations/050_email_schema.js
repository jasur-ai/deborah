/**
 * Edikit — Migration 050: Email schema (AUTH B-02)
 *
 * Email bilan bog'liq barcha jadvallar (guide §06-§11):
 *   - verification_codes   (email_verify|mfa_reset|password_reset; code_hash)
 *   - email_log            (status: queued|sent|delivered|bounced|complained|failed;
 *                           to_email_hash — HMAC-SHA256 deterministik, plaintext YO'Q)
 *   - mfa_backup_codes     (code_hash HMAC-SHA256)
 *   - mfa_totp             (secret_encrypted AES-256-GCM; user_id UNIQUE)
 *   - user_devices         (risk — C-faza uchun tayyor)
 *   - invites              (B-12 roster uchun)
 *
 * Security (guide §14): code/secret HECH QACHON plaintext — faqat hash/encrypt.
 * Retention (guide §13): email_log 30 kun, verification_codes 24 soat,
 * backup codes user MFA o'chganda — purge job C-fazada (guide §27).
 *
 * Rollback (down): barcha jadvallar drop qilinadi.
 */

import { sql } from 'kysely';

const EMAIL_LOG_STATUS_CHECK = "status IN ('queued','sent','delivered','bounced','complained','failed')";

/**
 * @param {import('kysely').Kysely<any>} db
 */
export async function up(db) {
  // ── verification_codes (guide §06) ──
  await db.schema
    .createTable('verification_codes')
    .addColumn('id', 'serial', (col) => col.primaryKey())
    .addColumn('user_id', 'integer', (col) => col.references('users.id').onDelete('cascade').notNull())
    .addColumn('purpose', 'varchar(32)', (col) =>
      col.notNull().check(sql`purpose IN ('email_verify','mfa_reset','password_reset')`))
    .addColumn('channel', 'varchar(16)', (col) => col.notNull().defaultTo('email'))
    .addColumn('code_hash', 'varchar(64)', (col) => col.notNull()) // SHA-256
    .addColumn('expires_at', 'timestamptz', (col) => col.notNull()) // 15 daqiqa
    .addColumn('used_at', 'timestamptz')
    .addColumn('attempts', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .execute();
  await db.schema
    .createIndex('idx_verification_codes_user_purpose')
    .on('verification_codes').columns(['user_id', 'purpose']).execute();

  // ── email_log (guide §07, §26 — emailHash PII minimal) ──
  await db.schema
    .createTable('email_log')
    .addColumn('id', 'serial', (col) => col.primaryKey())
    .addColumn('user_id', 'integer', (col) => col.references('users.id').onDelete('set null'))
    .addColumn('to_email_hash', 'varchar(64)') // HMAC-SHA256 deterministik (DSAR)
    .addColumn('template', 'varchar(64)')
    .addColumn('status', 'varchar(16)', (col) => col.notNull().defaultTo('queued'))
    .addColumn('provider_msg_id', 'varchar(255)')
    .addColumn('error', 'varchar(300)')
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .execute();
  await db.schema
    .alterTable('email_log')
    .addCheckConstraint('email_log_status_check', sql.raw(EMAIL_LOG_STATUS_CHECK))
    .execute();
  await db.schema.createIndex('idx_email_log_status').on('email_log').column('status').execute();

  // ── mfa_backup_codes (guide §08) — code_hash HMAC-SHA256 ──
  await db.schema
    .createTable('mfa_backup_codes')
    .addColumn('id', 'serial', (col) => col.primaryKey())
    .addColumn('user_id', 'integer', (col) => col.references('users.id').onDelete('cascade').notNull())
    .addColumn('code_hash', 'varchar(64)', (col) => col.notNull()) // HMAC-SHA256
    .addColumn('used_at', 'timestamptz')
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .execute();
  await db.schema.createIndex('idx_mfa_backup_codes_user').on('mfa_backup_codes').column('user_id').execute();

  // ── mfa_totp (guide §09) — secret AES-256-GCM encrypt ──
  await db.schema
    .createTable('mfa_totp')
    .addColumn('id', 'serial', (col) => col.primaryKey())
    .addColumn('user_id', 'integer', (col) => col.references('users.id').onDelete('cascade').notNull())
    .addColumn('secret_encrypted', 'text', (col) => col.notNull()) // AES-256-GCM
    .addColumn('status', 'varchar(16)', (col) => col.notNull().defaultTo('pending'))
    .addColumn('last_used', 'timestamptz')
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .execute();
  await db.schema.createIndex('idx_mfa_totp_user_unique').on('mfa_totp').column('user_id').unique().execute();

  // ── user_devices (guide §10 — risk, C-faza uchun tayyor) ──
  await db.schema
    .createTable('user_devices')
    .addColumn('id', 'serial', (col) => col.primaryKey())
    .addColumn('user_id', 'integer', (col) => col.references('users.id').onDelete('cascade').notNull())
    .addColumn('fingerprint_hash', 'varchar(64)', (col) => col.notNull())
    .addColumn('first_seen', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn('last_seen', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn('trusted', 'boolean', (col) => col.notNull().defaultTo(false))
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .execute();
  await db.schema
    .createIndex('idx_user_devices_user_fp_unique')
    .on('user_devices').columns(['user_id', 'fingerprint_hash']).unique().execute();

  // ── invites (guide §11 — roster/B-12) ──
  await db.schema
    .createTable('invites')
    .addColumn('id', 'serial', (col) => col.primaryKey())
    .addColumn('token', 'varchar(96)', (col) => col.notNull().unique()) // 48-byte random hex
    .addColumn('course_id', 'integer')
    .addColumn('group_id', 'integer')
    .addColumn('email', 'varchar(255)')
    .addColumn('telegram_id', 'varchar(64)')
    .addColumn('used_by', 'integer', (col) => col.references('users.id').onDelete('set null'))
    .addColumn('expires_at', 'timestamptz')
    .addColumn('revoked_at', 'timestamptz')
    .addColumn('created_by', 'integer', (col) => col.references('users.id').onDelete('set null'))
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .execute();
  await db.schema.createIndex('idx_invites_token').on('invites').column('token').unique().execute();
}

/**
 * @param {import('kysely').Kysely<any>} db
 */
export async function down(db) {
  await db.schema.dropTable('invites');
  await db.schema.dropTable('user_devices');
  await db.schema.dropTable('mfa_totp');
  await db.schema.dropTable('mfa_backup_codes');
  await db.schema.dropTable('email_log');
  await db.schema.dropTable('verification_codes');
}
