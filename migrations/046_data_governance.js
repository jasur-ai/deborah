/**
 * Deborah — Migration 046: Data Classification, Privacy, Retention & Purge
 *
 * Prompt 65 — D0–D6 data classification, legal hold, DSAR va multi-store
 * deletion'ni operational qilish (research.md §27 data governance —
 * surveillance emas, ownership evidence; §26.1 evidence-based).
 * Precondition: barcha domain table/object/providerlar mavjud.
 *
 * Tables:
 *   - data_assets: data asset inventory — har entity/object ga class
 *     (D0-D6) + retention bog'lanadi; region, store, kms, uz_boundary.
 *   - legal_holds: legal hold (court order/regulatory) — fail-open
 *     bo'lmaydi: hold faol bo'lsa purge bloklanadi.
 *   - dsar_requests: DSAR (access/correct/export/delete) flow — status
 *     FSM received→in_progress→fulfilled; deletion receipt bilan.
 *   - deletion_receipts: purge natijasi — har derived store (DB/object/
 *     vector/cache/provider) uchun receipt + backup-expiry.
 *
 * SECURITY / DATA GUARD (Prompt 65 §15-17):
 *   - D4 UZ tashqariga chiqmaydi (uz_boundary); legal hold fail-open
 *     bo'lmaydi (hold tekshiruvi o'tmaguncha purge ishlamaydi).
 *   - Har write path tenant-scoped + fail-closed + idempotent + audited.
 *   - Privileged actionlar (legal hold, DSAR fulfill, purge) audit event
 *     va trace bilan.
 */

import { sql } from 'kysely';

/**
 * @param {import('kysely').Kysely<any>} db
 */
export async function up(db) {
  await db.schema
    .createTable('data_assets')
    .addColumn('id', 'serial', (col) => col.primaryKey())
    .addColumn('tenant_id', 'integer', (col) =>
      col.references('tenants.id').onDelete('cascade').notNull()
    )
    .addColumn('asset_name', 'varchar(200)', (col) => col.notNull())
    .addColumn('asset_type', 'varchar(20)', (col) => col.notNull())
    // table | object | vector | cache | provider
    .addColumn('store_name', 'varchar(60)', (col) => col.notNull())
    .addColumn('data_class', 'varchar(3)', (col) => col.notNull().defaultTo('D1'))
    // D0..D6
    .addColumn('region', 'varchar(20)', (col) => col.notNull().defaultTo('UZ'))
    .addColumn('kms_required', 'boolean', (col) => col.notNull().defaultTo(false))
    .addColumn('uz_boundary', 'boolean', (col) => col.notNull().defaultTo(false))
    .addColumn('retention_days', 'integer')
    .addColumn('legal_basis', 'varchar(120)')
    .addColumn('purge_after', 'timestamptz')
    .addColumn('created_by', 'varchar(120)')
    .addColumn('created_at', 'timestamptz', (col) => col.defaultTo(sql`now()`).notNull())
    .addColumn('updated_at', 'timestamptz', (col) => col.defaultTo(sql`now()`).notNull())
    .addUniqueConstraint('data_assets_tenant_name_store_uniq', ['tenant_id', 'asset_name', 'store_name']).execute()

  await db.schema
    .createTable('legal_holds')
    .addColumn('id', 'serial', (col) => col.primaryKey())
    .addColumn('tenant_id', 'integer', (col) =>
      col.references('tenants.id').onDelete('cascade').notNull()
    )
    .addColumn('subject_key', 'varchar(200)', (col) => col.notNull())
    .addColumn('reason', 'text', (col) => col.notNull())
    .addColumn('source', 'varchar(40)', (col) => col.notNull().defaultTo('court'))
    // court | regulatory | internal
    .addColumn('status', 'varchar(20)', (col) => col.notNull().defaultTo('active'))
    // active | released
    .addColumn('started_by', 'varchar(120)')
    .addColumn('started_at', 'timestamptz', (col) => col.defaultTo(sql`now()`).notNull())
    .addColumn('released_by', 'varchar(120)')
    .addColumn('released_at', 'timestamptz').execute()

  // Partial unique index — faqat bitta ACTIVE hold bo'lishi mumkin; released
  // row'lar cheksiz bo'lishi mumkin (re-hold after release + re-release
  // (tenant, subject, 'released') dublikatini keltirmaydi).
  await db.schema
    .createIndex('legal_holds_tenant_subject_active_uniq')
    .on('legal_holds')
    .columns(['tenant_id', 'subject_key'])
    .unique()
    .where(sql`status = 'active'`)
    .execute();

  await db.schema
    .createTable('dsar_requests')
    .addColumn('id', 'serial', (col) => col.primaryKey())
    .addColumn('tenant_id', 'integer', (col) =>
      col.references('tenants.id').onDelete('cascade').notNull()
    )
    .addColumn('subject_key', 'varchar(200)', (col) => col.notNull())
    .addColumn('request_type', 'varchar(20)', (col) => col.notNull())
    // access | correct | export | delete
    .addColumn('status', 'varchar(20)', (col) => col.notNull().defaultTo('received'))
    // received → in_progress → fulfilled
    .addColumn('requested_by', 'varchar(120)')
    .addColumn('requested_at', 'timestamptz', (col) => col.defaultTo(sql`now()`).notNull())
    .addColumn('fulfilled_by', 'varchar(120)')
    .addColumn('fulfilled_at', 'timestamptz')
    .addColumn('notes', 'text').execute()

  await db.schema
    .createTable('deletion_receipts')
    .addColumn('id', 'serial', (col) => col.primaryKey())
    .addColumn('tenant_id', 'integer', (col) =>
      col.references('tenants.id').onDelete('cascade').notNull()
    )
    .addColumn('asset_id', 'integer', (col) =>
      col.references('data_assets.id').onDelete('cascade').notNull()
    )
    .addColumn('store_name', 'varchar(60)', (col) => col.notNull())
    .addColumn('status', 'varchar(20)', (col) => col.notNull().defaultTo('scheduled'))
    // scheduled → purged | failed
    .addColumn('purged_at', 'timestamptz')
    .addColumn('purged_by', 'varchar(120)')
    .addColumn('backup_expiry', 'timestamptz')
    .addColumn('receipt_hash', 'varchar(64)')
    .addColumn('notes', 'text')
    .addUniqueConstraint('deletion_receipts_asset_store_uniq', ['tenant_id', 'asset_id', 'store_name']).execute()
}

/**
 * @param {import('kysely').Kysely<any>} db
 */
export async function down(db) {
  await db.schema.dropTable('deletion_receipts');
  await db.schema.dropTable('dsar_requests');
  await db.schema.dropTable('legal_holds');
  await db.schema.dropTable('data_assets');
}
