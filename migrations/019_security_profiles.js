/**
 * Deborah — Migration 019: Security Profile & Safe Exam Browser Boundary
 *
 * Prompt 36 (Phase D): connects S0–S4 security profiles to typed policy and
 * client/server enforcement. The institution (tenant) declares the ALLOWED
 * profile band [min, max] — an assessment's requested profile is clamped into
 * that band server-side; a profile above the institution maximum is rejected.
 *
 * The `institution_security_policy` row also registers:
 *   - seb_config_key_hash — the expected SHA-256 of the institution's Safe
 *     Exam Browser config signing key. SEB boundary verification compares the
 *     client-presented config key hash against this value. If the institution
 *     has NOT registered a key, S3/S4 (SEB-required) attempts FAIL CLOSED —
 *     a browser claiming SEB without a verifiable key is never trusted
 *     (research.md §29.3: browser to answer key berish — high-stakes emas;
 *     Prompt 36 §15: oddiy browserni lockdown deb ko'rsatma).
 *   - require_managed_device — managed-device/LAN capability flag (§12).
 *     S3/S4 profiles force this true unless the institution opts out via the
 *     explicit flag (stop condition §24: managed environment aniqlanmasa
 *     S3 ni productionga ochma).
 *   - allow_lan_mode — whether LAN-mode (offline edge server) attempts are
 *     permitted for this tenant (§29.6).
 *
 * One row per tenant (UNIQUE tenant_id). No rows = defaults (S0..S4, no SEB
 * key, managed device off, LAN allowed) — the schema module supplies those
 * defaults, so a fresh tenant is never locked out.
 *
 * Rollback: drops the table.
 */

import { sql } from 'kysely';

/**
 * @param {import('kysely').Kysely<any>} db
 */
export async function up(db) {
  await db.schema
    .createTable('institution_security_policy')
    .addColumn('id', 'serial', (col) => col.primaryKey())
    .addColumn('tenant_id', 'integer', (col) =>
      col.references('tenants.id').onDelete('cascade').notNull()
    )
    // Allowed profile band — S0..S4 (validated in the pure schema)
    .addColumn('min_profile', 'varchar(4)', (col) => col.notNull().defaultTo('S0'))
    .addColumn('max_profile', 'varchar(4)', (col) => col.notNull().defaultTo('S4'))
    // Registered Safe Exam Browser config signing key (SHA-256 hex).
    // NULL = SEB claims are unverifiable → S3/S4 fail closed.
    .addColumn('seb_config_key_hash', 'varchar(64)')
    // Managed-device / LAN capability flags (§12)
    .addColumn('require_managed_device', 'boolean', (col) => col.notNull().defaultTo(false))
    .addColumn('allow_lan_mode', 'boolean', (col) => col.notNull().defaultTo(true))
    .addColumn('updated_by', 'integer', (col) =>
      col.references('users.id').onDelete('set null')
    )
    .addColumn('updated_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .execute();

  // One institution policy per tenant
  await db.schema
    .createIndex('uq_institution_security_tenant')
    .on('institution_security_policy')
    .columns(['tenant_id'])
    .unique()
    .execute();

  // ── Grants ──
  await sql`GRANT SELECT, INSERT, UPDATE ON institution_security_policy TO deborah_runtime`.execute(db);
  await sql`GRANT USAGE ON institution_security_policy_id_seq TO deborah_runtime`.execute(db);
  await sql`GRANT SELECT, DELETE ON institution_security_policy TO deborah_migration`.execute(db);

  console.log('Security profile structure created: institution_security_policy (S0–S4 bounds + SEB key + managed/LAN flags)');
}

/**
 * @param {import('kysely').Kysely<any>} db
 */
export async function down(db) {
  await db.schema.dropTable('institution_security_policy').ifExists().execute();
}
