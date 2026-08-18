/**
 * Deborah — Migration 037: Canonical Presentation & Native Editor MVP
 *
 * Prompt 56 — provider-independent slide document, outline flow va
 * accessible native editor (research.md §9.2 canonical document, §35
 * native editor, §15 security). Precondition: Prompt 50 source packs +
 * object storage.
 *
 *   - presentations: canonical deck root — title, audience, language,
 *     learning_outcomes jsonb, theme, aspect_ratio (16:9), provider
 *     jsonb {name, jobId} (raw provider response HECH QACHON bu yerga
 *     yozilmaydi — faqat canonical model).
 *   - presentation_versions: version history — document jsonb (canonical
 *     slides + blocks), status draft | published (publish = immutable
 *     snapshot §35.4), diff/rollback yangi version yaratadi.
 *   - presentation_slides: structured slide rows — layout, title,
 *     speaker_notes, citations jsonb (source_pack refs), quiz_concepts.
 *   - presentation_blocks: structured blocks — text | heading | bullets |
 *     image | chart | table, content jsonb (items/asset_id/alt/rows/cols).
 *   - presentation_comments: co-teacher comments — slide_id/block_id
 *     nullable, resolved flag.
 *   - presentation_assets: image/chart assets — storage_ref, alt_text.
 *   - presentation_exports: PPTX/PDF worker export skeleton — status
 *     queued | running | completed | failed, file_ref.
 *   - presentation_qa: AI design QA results (§35.5) — overflow | contrast |
 *     alt_text | word_count | title_length per slide.
 *
 * SECURITY / DATA GUARD (Prompt 56 §15-17):
 *   - Provider raw response canonical modeldan tashqariga sizib
 *     chiqmaydi (assertProviderRawIsolated).
 *   - Har bir write path tenant-scoped + idempotent (UNIQUE indexlar).
 *   - Published version immutable — rollback yangi version, history
 *     o'chirilmaydi.
 */

import { sql } from 'kysely';

/**
 * @param {import('kysely').Kysely<any>} db
 */
export async function up(db) {
  // ── 1. presentations — canonical deck root ──
  await db.schema
    .createTable('presentations')
    .addColumn('id', 'serial', (col) => col.primaryKey())
    .addColumn('tenant_id', 'integer', (col) =>
      col.references('tenants.id').onDelete('cascade').notNull()
    )
    .addColumn('title', 'varchar(200)', (col) => col.notNull())
    .addColumn('audience', 'varchar(120)')
    .addColumn('language', 'varchar(10)', (col) => col.notNull().defaultTo('uz'))
    .addColumn('learning_outcomes', 'jsonb', (col) => col.defaultTo(sql`'[]'::jsonb`))
    .addColumn('theme', 'varchar(40)', (col) => col.notNull().defaultTo('default'))
    .addColumn('aspect_ratio', 'varchar(10)', (col) => col.notNull().defaultTo('16:9'))
    .addColumn('status', 'varchar(20)', (col) => col.notNull().defaultTo('draft'))
    // draft | published | archived
    .addColumn('provider', 'jsonb', (col) => col.defaultTo(sql`'{}'::jsonb`))
    // { name, jobId } — canonical only; raw response hech qachon emas
    .addColumn('created_by', 'varchar(120)')
    .addColumn('created_at', 'timestamp', (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamp', (col) => col.notNull().defaultTo(sql`now()`))
    .addUniqueConstraint('presentations_tenant_title', ['tenant_id', 'title']);

  // ── 2. presentation_versions — version history (immutable publish) ──
  await db.schema
    .createTable('presentation_versions')
    .addColumn('id', 'serial', (col) => col.primaryKey())
    .addColumn('presentation_id', 'integer', (col) =>
      col.references('presentations.id').onDelete('cascade').notNull()
    )
    .addColumn('version_no', 'integer', (col) => col.notNull())
    .addColumn('document', 'jsonb', (col) => col.notNull().defaultTo(sql`'{}'::jsonb`))
    // Canonical doc: { title, slides: [{ id, layout, title, blocks, speakerNotes, citations, quizConcepts }] }
    .addColumn('status', 'varchar(20)', (col) => col.notNull().defaultTo('draft'))
    // draft | published
    .addColumn('comment', 'text')
    .addColumn('created_by', 'varchar(120)')
    .addColumn('created_at', 'timestamp', (col) => col.notNull().defaultTo(sql`now()`))
    .addUniqueConstraint('presentation_versions_pres_no', ['presentation_id', 'version_no']);

  // ── 3. presentation_slides — structured slide rows ──
  await db.schema
    .createTable('presentation_slides')
    .addColumn('id', 'serial', (col) => col.primaryKey())
    .addColumn('presentation_id', 'integer', (col) =>
      col.references('presentations.id').onDelete('cascade').notNull()
    )
    .addColumn('version_id', 'integer', (col) =>
      col.references('presentation_versions.id').onDelete('cascade').notNull()
    )
    .addColumn('slide_index', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('layout', 'varchar(40)', (col) => col.notNull().defaultTo('title-body'))
    .addColumn('title', 'varchar(200)')
    .addColumn('speaker_notes', 'text')
    .addColumn('citations', 'jsonb', (col) => col.defaultTo(sql`'[]'::jsonb`))
    .addColumn('quiz_concepts', 'jsonb', (col) => col.defaultTo(sql`'[]'::jsonb`))
    .addColumn('created_at', 'timestamp', (col) => col.notNull().defaultTo(sql`now()`))
    .addUniqueConstraint('presentation_slides_pres_idx', ['presentation_id', 'version_id', 'slide_index']);

  // ── 4. presentation_blocks — structured blocks ──
  await db.schema
    .createTable('presentation_blocks')
    .addColumn('id', 'serial', (col) => col.primaryKey())
    .addColumn('slide_id', 'integer', (col) =>
      col.references('presentation_slides.id').onDelete('cascade').notNull()
    )
    .addColumn('block_index', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('block_type', 'varchar(20)', (col) => col.notNull().defaultTo('text'))
    // text | heading | bullets | image | chart | table
    .addColumn('content', 'jsonb', (col) => col.notNull().defaultTo(sql`'{}'::jsonb`))
    .addColumn('created_at', 'timestamp', (col) => col.notNull().defaultTo(sql`now()`))
    .addUniqueConstraint('presentation_blocks_slide_idx', ['slide_id', 'block_index']);

  // ── 5. presentation_comments — co-teacher comments ──
  await db.schema
    .createTable('presentation_comments')
    .addColumn('id', 'serial', (col) => col.primaryKey())
    .addColumn('presentation_id', 'integer', (col) =>
      col.references('presentations.id').onDelete('cascade').notNull()
    )
    .addColumn('version_id', 'integer', (col) =>
      col.references('presentation_versions.id').onDelete('cascade')
    )
    .addColumn('slide_id', 'integer', (col) =>
      col.references('presentation_slides.id').onDelete('set null')
    )
    .addColumn('block_id', 'integer', (col) =>
      col.references('presentation_blocks.id').onDelete('set null')
    )
    .addColumn('author', 'varchar(120)', (col) => col.notNull())
    .addColumn('body', 'text', (col) => col.notNull())
    .addColumn('resolved', 'boolean', (col) => col.notNull().defaultTo(false))
    .addColumn('created_at', 'timestamp', (col) => col.notNull().defaultTo(sql`now()`));

  // ── 6. presentation_assets — image/chart assets ──
  await db.schema
    .createTable('presentation_assets')
    .addColumn('id', 'serial', (col) => col.primaryKey())
    .addColumn('tenant_id', 'integer', (col) =>
      col.references('tenants.id').onDelete('cascade').notNull()
    )
    .addColumn('presentation_id', 'integer', (col) =>
      col.references('presentations.id').onDelete('cascade').notNull()
    )
    .addColumn('asset_key', 'varchar(160)', (col) => col.notNull())
    .addColumn('mime_type', 'varchar(80)')
    .addColumn('alt_text', 'text')
    .addColumn('storage_ref', 'varchar(255)')
    .addColumn('created_at', 'timestamp', (col) => col.notNull().defaultTo(sql`now()`))
    .addUniqueConstraint('presentation_assets_pres_key', ['tenant_id', 'presentation_id', 'asset_key']);

  // ── 7. presentation_exports — PPTX/PDF worker skeleton ──
  await db.schema
    .createTable('presentation_exports')
    .addColumn('id', 'serial', (col) => col.primaryKey())
    .addColumn('presentation_id', 'integer', (col) =>
      col.references('presentations.id').onDelete('cascade').notNull()
    )
    .addColumn('version_id', 'integer', (col) =>
      col.references('presentation_versions.id').onDelete('cascade').notNull()
    )
    .addColumn('format', 'varchar(10)', (col) => col.notNull())
    // pptx | pdf
    .addColumn('status', 'varchar(20)', (col) => col.notNull().defaultTo('queued'))
    // queued | running | completed | failed
    .addColumn('file_ref', 'varchar(255)')
    .addColumn('error', 'text')
    .addColumn('created_by', 'varchar(120)')
    .addColumn('created_at', 'timestamp', (col) => col.notNull().defaultTo(sql`now()`))
    .addUniqueConstraint('presentation_exports_pres_format', ['presentation_id', 'version_id', 'format']);

  // ── 8. presentation_qa — AI design QA (§35.5) ──
  await db.schema
    .createTable('presentation_qa')
    .addColumn('id', 'serial', (col) => col.primaryKey())
    .addColumn('slide_id', 'integer', (col) =>
      col.references('presentation_slides.id').onDelete('cascade').notNull()
    )
    .addColumn('check_type', 'varchar(30)', (col) => col.notNull())
    // overflow | contrast | alt_text | word_count | title_length
    .addColumn('ok', 'boolean', (col) => col.notNull().defaultTo(true))
    .addColumn('detail', 'text')
    .addColumn('created_at', 'timestamp', (col) => col.notNull().defaultTo(sql`now()`))
    .addUniqueConstraint('presentation_qa_slide_check', ['slide_id', 'check_type']);
}

/**
 * @param {import('kysely').Kysely<any>} db
 */
export async function down(db) {
  await db.schema.dropTable('presentation_qa');
  await db.schema.dropTable('presentation_exports');
  await db.schema.dropTable('presentation_assets');
  await db.schema.dropTable('presentation_comments');
  await db.schema.dropTable('presentation_blocks');
  await db.schema.dropTable('presentation_slides');
  await db.schema.dropTable('presentation_versions');
  await db.schema.dropTable('presentations');
}
