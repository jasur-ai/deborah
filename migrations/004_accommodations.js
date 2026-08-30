/**
 * Deborah — Migration 004: Accommodations
 *
 * Adds accommodation support for students:
 *   - accommodations (extra time, reader, font/contrast, breaks, etc.)
 *   - accommodation_versions (history of changes)
 *   - accommodation_snapshots (assessment assignment freeze)
 *
 * Sensitive rationale (medical notes) are NOT stored here — they are
 * stored in an encrypted/restricted-access table via the accommodation service.
 *
 * This migration assumes migrations 001, 002, and 003 have run.
 * All new tables are tenant-scoped.
 *
 * Rollback: All tables are droppable via down().
 */

import { sql } from 'kysely';

/**
 * @param {import('kysely').Kysely<any>} db
 */
export async function up(db) {
  // ── 1. Accommodations ──
  await db.schema
    .createTable('accommodations')
    .addColumn('id', 'serial', (col) => col.primaryKey())
    .addColumn('tenant_id', 'integer', (col) =>
      col.references('tenants.id').onDelete('cascade').notNull()
    )
    .addColumn('user_id', 'integer', (col) =>
      col.references('users.id').onDelete('cascade').notNull()
    )
    .addColumn('type', 'varchar(50)', (col) => col.notNull())
    // type values: extra_time | reader | font_contrast | break_timer |
    //              camera_off | strike_policy_override | separate_room |
    //              oral_interpreter | word_processor | scribe | other
    .addColumn('status', 'varchar(20)', (col) => col.notNull().defaultTo('active'))
    // active | expired | revoked
    .addColumn('operational_config', 'jsonb', (col) => col.notNull().defaultTo('{}'))
    // Example: { extraMinutes: 30, readerType: 'human', fontName: 'OpenDyslexic',
    //           fontSize: 18, contrastRatio: 'high', breakDuration: 10,
    //           breakFrequency: 30, maxStrikes: 5 }
    .addColumn('sensitive_hash', 'varchar(64)') // SHA-256 hash of rationale (for audit proof)
    .addColumn('sensitive_data_encrypted', 'jsonb') // { ciphertext: string, iv: string, tag: string } — restricted access
    .addColumn('effective_from', 'timestamptz', (col) => col.notNull())
    .addColumn('effective_until', 'timestamptz')
    .addColumn('granted_by', 'integer', (col) =>
      col.references('users.id').onDelete('set null')
    )
    .addColumn('granted_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn('revoked_by', 'integer', (col) =>
      col.references('users.id').onDelete('set null')
    )
    .addColumn('revoked_at', 'timestamptz')
    .addColumn('revoke_reason', 'text')
    .addColumn('version', 'integer', (col) => col.notNull().defaultTo(1))
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .execute();

  await db.schema
    .createIndex('idx_accommodations_user')
    .on('accommodations')
    .columns(['tenant_id', 'user_id', 'status'])
    .execute();

  await db.schema
    .createIndex('idx_accommodations_effective')
    .on('accommodations')
    .columns(['effective_from', 'effective_until'])
    .execute();

  // ── 2. Accommodation Versions (audit trail) ──
  await db.schema
    .createTable('accommodation_versions')
    .addColumn('id', 'serial', (col) => col.primaryKey())
    .addColumn('accommodation_id', 'integer', (col) =>
      col.references('accommodations.id').onDelete('cascade').notNull()
    )
    .addColumn('tenant_id', 'integer', (col) =>
      col.references('tenants.id').onDelete('cascade').notNull()
    )
    .addColumn('version', 'integer', (col) => col.notNull())
    .addColumn('previous_status', 'varchar(20)')
    .addColumn('new_status', 'varchar(20)')
    .addColumn('operational_config', 'jsonb')
    .addColumn('changed_by', 'integer', (col) =>
      col.references('users.id').onDelete('set null')
    )
    .addColumn('change_reason', 'text')
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .execute();

  await db.schema
    .createIndex('idx_accommodation_versions_parent')
    .on('accommodation_versions')
    .columns(['accommodation_id', 'version'])
    .execute();

  // ── 3. Accommodation Snapshots (assessment assignment freeze) ──
  // When an assessment is published/assigned, we snapshot the student's
  // active accommodations to lock in what was available during the attempt.
  await db.schema
    .createTable('accommodation_snapshots')
    .addColumn('id', 'serial', (col) => col.primaryKey())
    .addColumn('tenant_id', 'integer', (col) =>
      col.references('tenants.id').onDelete('cascade').notNull()
    )
    .addColumn('assessment_assignment_id', 'integer') // FK placeholder for assessment_assignments
    .addColumn('user_id', 'integer', (col) =>
      col.references('users.id').onDelete('cascade').notNull()
    )
    .addColumn('accommodation_type', 'varchar(50)', (col) => col.notNull())
    .addColumn('snapshot_config', 'jsonb', (col) => col.notNull())
    // Frozen copy of operational_config at time of assignment
    .addColumn('source_accommodation_id', 'integer')
    // Null if manually assigned during publish
    .addColumn('snapshot_version', 'integer', (col) => col.notNull())
    .addColumn('is_active', 'boolean', (col) => col.notNull().defaultTo(true))
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .execute();

  await db.schema
    .createIndex('idx_accommodation_snapshots_assignment')
    .on('accommodation_snapshots')
    .columns(['assessment_assignment_id', 'user_id'])
    .execute();

  // ── Grant permissions ──
  const newTables = ['accommodations', 'accommodation_versions', 'accommodation_snapshots'];

  for (const table of newTables) {
    await sql`GRANT SELECT, INSERT, UPDATE ON ${sql.table(table)} TO deborah_runtime`.execute(db);
    try { await sql`GRANT USAGE ON ${sql.id(table + '_id_seq')} TO deborah_runtime`.execute(db); } catch (_) { /* serial emas — seq yo'q */ }
  }

  console.log('Accommodation structure created: 3 tables');
}

/**
 * @param {import('kysely').Kysely<any>} db
 */
export async function down(db) {
  await db.schema.dropTable('accommodation_snapshots').ifExists().execute();
  await db.schema.dropTable('accommodation_versions').ifExists().execute();
  await db.schema.dropTable('accommodations').ifExists().execute();
}
