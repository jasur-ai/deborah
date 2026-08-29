/**
 * Deborah — Migration 044: Uzbek Latin/Cyrillic & Terminology Layer
 *
 * Prompt 63 — uz-Latn, uz-Cyrl, ru va en content/version/search'ni
 * birinchi-class qilish (research.md §58 Uzbek-first Multilingual Layer).
 * Precondition: canonical content/item/presentation schemas ready.
 *
 * Tables:
 *   - terminology_versions: versioned terminology bank (institution/subject).
 *   - terminology_terms: canonical term + uz-Latn/uz-Cyrl/ru/en + forbidden
 *     variants + search_key (cross-script search normalization).
 *   - content_translations: content localization — original_text ALWAYS
 *     preserved, translation_status, equivalence_status (never auto-equal).
 *   - proper_names: identity canonical name alohida field (student/
 *     institution) — content transliterator bilan ko'r-ko'rona
 *     o'zgartirilmaydi (§58.2).
 *   - translation_reviews: human reviewer + terminology version trace.
 *
 * SECURITY / DATA GUARD (Prompt 63 §15, §58.2/58.4):
 *   - Transliteration translation yoki psychometric equivalence emas.
 *   - Original text doim saqlanadi (hech qachon yo'qolmaydi).
 *   - Identity name va content transliteration birlashtirilmaydi.
 *   - Har write path tenant-scoped + idempotent + audited.
 */

import { sql } from 'kysely';

/**
 * @param {import('kysely').Kysely<any>} db
 */
export async function up(db) {
  await db.schema
    .createTable('terminology_versions')
    .addColumn('id', 'serial', (col) => col.primaryKey())
    .addColumn('tenant_id', 'integer', (col) =>
      col.references('tenants.id').onDelete('cascade').notNull()
    )
    .addColumn('name', 'varchar(200)', (col) => col.notNull())
    // e.g. "DTM Matematika glossary"
    .addColumn('subject', 'varchar(120)')
    .addColumn('version', 'varchar(40)', (col) => col.notNull().defaultTo('v1'))
    .addColumn('status', 'varchar(20)', (col) => col.notNull().defaultTo('draft'))
    // draft | review | published | retired
    .addColumn('created_by', 'varchar(120)')
    .addColumn('created_at', 'timestamp', (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamp', (col) => col.notNull().defaultTo(sql`now()`))
    .addUniqueConstraint('terminology_version_tenant_name_version', ['tenant_id', 'name', 'version']);

  await db.schema
    .createTable('terminology_terms')
    .addColumn('id', 'serial', (col) => col.primaryKey())
    .addColumn('tenant_id', 'integer', (col) =>
      col.references('tenants.id').onDelete('cascade').notNull()
    )
    .addColumn('version_id', 'integer', (col) =>
      col.references('terminology_versions.id').onDelete('cascade').notNull()
    )
    .addColumn('canonical_term', 'varchar(200)', (col) => col.notNull())
    .addColumn('uz_latn', 'varchar(200)')
    .addColumn('uz_cyrl', 'varchar(200)')
    .addColumn('ru', 'varchar(200)')
    .addColumn('en', 'varchar(200)')
    .addColumn('definition', 'text')
    .addColumn('forbidden_variants', 'jsonb', (col) => col.defaultTo(sql`'[]'::jsonb`))
    // legacy/forbidden spellings (e.g. "momentum" tarjimalari)
    .addColumn('subject', 'varchar(120)')
    .addColumn('source', 'varchar(120)')
    .addColumn('reviewer', 'varchar(120)')
    .addColumn('search_key', 'varchar(200)')
    // cross-script search normalization key (Latn canonical base)
    .addColumn('created_at', 'timestamp', (col) => col.notNull().defaultTo(sql`now()`))
    .addIndex('terminology_terms_version_idx', ['version_id'])
    .addIndex('terminology_terms_search_idx', ['search_key']);

  await db.schema
    .createTable('content_translations')
    .addColumn('id', 'serial', (col) => col.primaryKey())
    .addColumn('tenant_id', 'integer', (col) =>
      col.references('tenants.id').onDelete('cascade').notNull()
    )
    .addColumn('content_type', 'varchar(60)', (col) => col.notNull())
    // item | presentation | rubric | feedback | assessment | policy
    .addColumn('content_id', 'integer', (col) => col.notNull())
    .addColumn('source_lang', 'varchar(10)', (col) => col.notNull())
    // BCP-47: uz-Latn | uz-Cyrl | ru | en
    .addColumn('target_lang', 'varchar(10)', (col) => col.notNull())
    .addColumn('original_text', 'text', (col) => col.notNull())
    // ALWAYS preserved — hech qachon yo'qolmaydi (§58.2)
    .addColumn('translated_text', 'text')
    .addColumn('translation_status', 'varchar(20)', (col) => col.notNull().defaultTo('draft'))
    // draft | reviewed | approved
    .addColumn('terminology_version', 'varchar(40)')
    .addColumn('equivalence_status', 'varchar(30)', (col) => col.notNull().defaultTo('unevaluated'))
    // unevaluated | construct_equivalent | needs_review | not_equivalent
    .addColumn('psychometric_linked', 'boolean', (col) => col.notNull().defaultTo(false))
    // transliteration ≠ psychometric equivalence (§58.4)
    .addColumn('created_by', 'varchar(120)')
    .addColumn('created_at', 'timestamp', (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamp', (col) => col.notNull().defaultTo(sql`now()`))
    .addIndex('content_translations_content_idx', ['content_type', 'content_id'])
    .addIndex('content_translations_lang_idx', ['source_lang', 'target_lang']);

  await db.schema
    .createTable('proper_names')
    .addColumn('id', 'serial', (col) => col.primaryKey())
    .addColumn('tenant_id', 'integer', (col) =>
      col.references('tenants.id').onDelete('cascade').notNull()
    )
    .addColumn('identity_type', 'varchar(40)', (col) => col.notNull())
    // student | staff | institution | subject | course
    .addColumn('identity_key', 'varchar(120)', (col) => col.notNull())
    .addColumn('canonical_name', 'varchar(200)', (col) => col.notNull())
    // institution/document canonical name — transliterator bilan o'zgarmaydi
    .addColumn('uz_latn', 'varchar(200)')
    .addColumn('uz_cyrl', 'varchar(200)')
    .addColumn('search_key', 'varchar(200)')
    .addColumn('created_by', 'varchar(120)')
    .addColumn('created_at', 'timestamp', (col) => col.notNull().defaultTo(sql`now()`))
    .addUniqueConstraint('proper_name_tenant_type_key', ['tenant_id', 'identity_type', 'identity_key'])
    .addIndex('proper_names_search_idx', ['search_key']);

  await db.schema
    .createTable('translation_reviews')
    .addColumn('id', 'serial', (col) => col.primaryKey())
    .addColumn('tenant_id', 'integer', (col) =>
      col.references('tenants.id').onDelete('cascade').notNull()
    )
    .addColumn('translation_id', 'integer', (col) =>
      col.references('content_translations.id').onDelete('cascade').notNull()
    )
    .addColumn('reviewer', 'varchar(120)', (col) => col.notNull())
    .addColumn('verdict', 'varchar(30)', (col) => col.notNull())
    // construct_equivalent | needs_review | not_equivalent
    .addColumn('notes', 'text')
    .addColumn('created_at', 'timestamp', (col) => col.notNull().defaultTo(sql`now()`))
    .addIndex('translation_reviews_translation_idx', ['translation_id']);
}

/**
 * @param {import('kysely').Kysely<any>} db
 */
export async function down(db) {
  await db.schema.dropTable('translation_reviews');
  await db.schema.dropTable('proper_names');
  await db.schema.dropTable('content_translations');
  await db.schema.dropTable('terminology_terms');
  await db.schema.dropTable('terminology_versions');
}
