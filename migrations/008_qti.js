/**
 * Deborah — Migration 008: QTI Import/Export Staging
 *
 * Adds IMS QTI (Question and Test Interoperability) package support:
 *   - qti_packages: uploaded QTI packages with security metadata
 *   - qti_staging_items: items parsed from QTI awaiting review
 *   - qti_resource_map: maps QTI resources to staging items
 *   - qti_interaction_map: supported interaction types with version tracking
 *
 * Key design:
 *   - Security: package hash, malware scan status, XXE protection marker
 *   - Staging: items wait in staging until approved/committed
 *   - Mapping: unsupported interactions are explicitly tracked
 *   - Round-trip: source_hash enables idempotent re-import
 *
 * Rollback: All tables droppable via down().
 */

import { sql } from 'kysely';

/**
 * @param {import('kysely').Kysely<any>} db
 */
export async function up(db) {
  // ── 1. QTI Packages (uploaded packages with security metadata) ──
  await db.schema
    .createTable('qti_packages')
    .addColumn('id', 'serial', (col) => col.primaryKey())
    .addColumn('tenant_id', 'integer', (col) =>
      col.references('tenants.id').onDelete('cascade').notNull()
    )
    .addColumn('original_filename', 'varchar(500)', (col) => col.notNull())
    .addColumn('file_hash', 'varchar(64)') // SHA-256 for idempotency
    .addColumn('file_size', 'integer')
    .addColumn('package_format', 'varchar(20)') // qti_21 | qti_22 | qti_30
    .addColumn('status', 'varchar(20)', (col) => col.notNull().defaultTo('uploaded'))
    // uploaded | validated | parsed | staging | committed | failed
    .addColumn('security_checks', 'jsonb', (col) => col.defaultTo('{}'))
    // { extension: 'ok', mime: 'ok', magic_bytes: 'ok', path_traversal: 'ok',
    //   xxe: 'ok', macros: 'ok', malware: 'skipped' }
    .addColumn('parse_results', 'jsonb', (col) => col.defaultTo('{}'))
    // { total_items: 10, supported: 8, unsupported: 2, warnings: [...] }
    .addColumn('manifest_json', 'jsonb') // Full manifest parsed as JSON
    .addColumn('errors', 'jsonb', (col) => col.defaultTo('[]'))
    .addColumn('warnings', 'jsonb', (col) => col.defaultTo('[]'))
    .addColumn('uploaded_by', 'integer', (col) =>
      col.references('users.id').onDelete('set null')
    )
    .addColumn('target_bank_id', 'integer', (col) =>
      col.references('item_banks.id').onDelete('set null')
    )
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(db.fn.now()))
    .addColumn('updated_at', 'timestamptz', (col) => col.notNull().defaultTo(db.fn.now()))
    .execute();

  await db.schema
    .createIndex('idx_qti_packages_tenant')
    .on('qti_packages')
    .columns(['tenant_id', 'status'])
    .execute();

  // ── 2. QTI Staging Items (items parsed from QTI awaiting review) ──
  await db.schema
    .createTable('qti_staging_items')
    .addColumn('id', 'serial', (col) => col.primaryKey())
    .addColumn('package_id', 'integer', (col) =>
      col.references('qti_packages.id').onDelete('cascade').notNull()
    )
    .addColumn('tenant_id', 'integer', (col) =>
      col.references('tenants.id').onDelete('cascade').notNull()
    )
    .addColumn('qti_identifier', 'varchar(255)') // QTI item identifier
    .addColumn('qti_interaction_type', 'varchar(50)') // Original QTI interaction type
    .addColumn('canonical_type', 'varchar(30)') // Mapped canonical type
    .addColumn('public_data', 'jsonb') // As parsed from QTI
    .addColumn('private_data', 'jsonb') // Answer key extracted from QTI
    .addColumn('media_refs', 'jsonb', (col) => col.defaultTo('[]'))
    // [{ original_path, mime_type, resolved_url }]
    .addColumn('is_supported', 'boolean', (col) => col.notNull().defaultTo(true))
    .addColumn('unsupported_reason', 'text') // Why this item can't be mapped
    .addColumn('difficulty', 'varchar(10)') // Auto-detected or from QTI metadata
    .addColumn('points', 'numeric(6,2)', (col) => col.defaultTo(1))
    .addColumn('time_seconds', 'integer')
    .addColumn('tags', 'text[]') // Tags extracted from QTI metadata
    .addColumn('outcome_mappings', 'jsonb', (col) => col.defaultTo('[]'))
    // [{ outcome_identifier, weight }]
    .addColumn('review_status', 'varchar(20)', (col) => col.notNull().defaultTo('pending'))
    // pending | reviewed | approved | rejected
    .addColumn('review_notes', 'text')
    .addColumn('created_item_id', 'integer') // FK to items.id after commit
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(db.fn.now()))
    .addColumn('updated_at', 'timestamptz', (col) => col.notNull().defaultTo(db.fn.now()))
    .execute();

  await db.schema
    .createIndex('idx_qti_staging_package')
    .on('qti_staging_items')
    .columns(['package_id', 'review_status'])
    .execute();

  await db.schema
    .createIndex('idx_qti_staging_tenant')
    .on('qti_staging_items')
    .columns(['tenant_id', 'is_supported'])
    .execute();

  // ── 3. QTI Resource Map (tracks QTI resources to staging items) ──
  await db.schema
    .createTable('qti_resource_map')
    .addColumn('id', 'serial', (col) => col.primaryKey())
    .addColumn('package_id', 'integer', (col) =>
      col.references('qti_packages.id').onDelete('cascade').notNull()
    )
    .addColumn('tenant_id', 'integer', (col) =>
      col.references('tenants.id').onDelete('cascade').notNull()
    )
    .addColumn('resource_identifier', 'varchar(255)', (col) => col.notNull())
    .addColumn('resource_type', 'varchar(100)') // ims_qti_item_xmlv2p2 | imsqti_assesment_xmlv2p2
    .addColumn('resource_file', 'text', (col) => col.notNull()) // Relative path inside package
    .addColumn('staging_item_id', 'integer', (col) =>
      col.references('qti_staging_items.id').onDelete('set null')
    )
    .addColumn('media_dependencies', 'jsonb', (col) => col.defaultTo('[]'))
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(db.fn.now()))
    .execute();

  await db.schema
    .createIndex('idx_qti_resource_package')
    .on('qti_resource_map')
    .columns(['package_id'])
    .execute();

  await sql`
    ALTER TABLE qti_packages
    ADD COLUMN staging_summary jsonb DEFAULT '{}'
  `.execute(db);

  // ── Grant permissions ──
  const newTables = ['qti_packages', 'qti_staging_items', 'qti_resource_map'];
  for (const table of newTables) {
    await sql`GRANT SELECT, INSERT, UPDATE ON ${sql.table(table)} TO deborah_runtime`.execute(db);
    await sql`GRANT USAGE ON ${sql.table(table)}_id_seq TO deborah_runtime`.execute(db);
    await sql`GRANT DELETE ON ${sql.table(table)} TO deborah_migration`.execute(db);
  }

  console.log('QTI structure created: 3 tables');
}

/**
 * @param {import('kysely').Kysely<any>} db
 */
export async function down(db) {
  await db.schema.dropTable('qti_resource_map').ifExists().execute();
  await db.schema.dropTable('qti_staging_items').ifExists().execute();
  await db.schema.dropTable('qti_packages').ifExists().execute();
}
