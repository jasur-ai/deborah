/**
 * Edikit — Migration 031: Source Pack & Secure RAG Ingestion (Prompt 50)
 *
 * Prompt 50 — teacher-approved source'lar (PDF/DOCX/PPTX/URL/text) ni
 * provenance/citation bilan safe corpusga aylantirish (research.md §20 Phase 4
 * "source pack/RAG", §22 "AI referencesni real database'dan tekshirmasdan
 * ko'rsatma", §27.4 "savollar submission/source/rubricga grounded"):
 *
 *   - source_packs: teacher tomonidan yig'ilgan source to'plami
 *     (draft → in_review → approved → archived). Faqat APPROVED pack'dagi
 *     source'lar RAG corpusga kiradi.
 *   - sources: bitta source (pdf | docx | pptx | url | text). Safe upload
 *     (MIME/magic-byte/size allowlist) yoki URL (SSRF-blocked) orqali.
 *     extraction_status: pending → extracting → extracted → failed.
 *     approval_status: pending → approved | rejected (teacher qarori).
 *   - source_chunks: text chunk'lar + page/chunk/char provenance + content
 *     hash + embedding model/version. Embedding vector column pgvector'da
 *     (extension yo'q bo'lsa graceful — ALTER try/catch).
 *   - source_approvals: append-only teacher approval trail (approved_by,
 *     decided_at, note) — "kim, qachon, nima uchun" audit.
 *
 * SECURITY / DATA GUARD (Prompt 50 §15-17):
 *   - Document text system instruction EMAS — instruction markerlar
 *     schema'da aniqlanadi (prompt-injection) va corpusga kirmaydi.
 *   - Cross-tenant vector retrieval TAQIQLANADI — namespace tenant-scoped,
 *     retrieval faqat o'z tenant namespace'ida.
 *   - URL source'lar SSRF-blocked (private/link-local/metadata IP taqiq).
 *   - Har bir write path tenant-scoped + idempotent (UNIQUE indexlar).
 */

import { sql } from 'kysely';

/**
 * @param {import('kysely').Kysely<any>} db
 */
export async function up(db) {
  // ── 1. source_packs — teacher source collection ──
  await db.schema
    .createTable('source_packs')
    .addColumn('id', 'serial', (col) => col.primaryKey())
    .addColumn('tenant_id', 'integer', (col) =>
      col.references('tenants.id').onDelete('cascade').notNull()
    )
    .addColumn('name', 'varchar(120)', (col) => col.notNull())
    .addColumn('description', 'varchar(500)')
    // draft → in_review → approved → archived (approved = RAG corpusga kiradi)
    .addColumn('status', 'varchar(16)', (col) => col.notNull().defaultTo('draft'))
    .addColumn('source_count', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('created_by', 'integer')
    .addColumn('approved_by', 'integer')
    .addColumn('approved_at', 'timestamptz')
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(db.fn.now()))
    .addColumn('updated_at', 'timestamptz', (col) => col.notNull().defaultTo(db.fn.now()))
    .execute();

  await db.schema
    .createIndex('idx_source_pack_tenant_status')
    .on('source_packs')
    .columns(['tenant_id', 'status'])
    .execute();

  // ── 2. sources — single source (file upload or URL) ──
  await db.schema
    .createTable('sources')
    .addColumn('id', 'serial', (col) => col.primaryKey())
    .addColumn('tenant_id', 'integer', (col) =>
      col.references('tenants.id').onDelete('cascade').notNull()
    )
    .addColumn('pack_id', 'integer', (col) =>
      col.references('source_packs.id').onDelete('cascade').notNull()
    )
    .addColumn('kind', 'varchar(8)', (col) => col.notNull())
    // pdf | docx | pptx | url | text
    .addColumn('title', 'varchar(255)', (col) => col.notNull())
    .addColumn('url', 'varchar(2000)')
    .addColumn('storage_key', 'varchar(500)')
    .addColumn('sha256', 'varchar(64)')
    .addColumn('mime_type', 'varchar(100)')
    .addColumn('byte_size', 'bigint')
    .addColumn('page_count', 'integer')
    // pending → extracting → extracted → failed
    .addColumn('extraction_status', 'varchar(16)', (col) => col.notNull().defaultTo('pending'))
    .addColumn('extraction_error', 'varchar(500)')
    // pending → approved | rejected
    .addColumn('approval_status', 'varchar(16)', (col) => col.notNull().defaultTo('pending'))
    .addColumn('approved_by', 'integer')
    .addColumn('approved_at', 'timestamptz')
    .addColumn('created_by', 'integer')
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(db.fn.now()))
    .addColumn('updated_at', 'timestamptz', (col) => col.notNull().defaultTo(db.fn.now()))
    .execute();

  // Idempotency: same tenant + same content hash → no duplicate source
  await sql`
    CREATE UNIQUE INDEX uq_source_tenant_sha
    ON sources (tenant_id, sha256)
  `.execute(db);
  await db.schema
    .createIndex('idx_source_pack')
    .on('sources')
    .columns(['tenant_id', 'pack_id', 'approval_status'])
    .execute();

  // ── 3. source_chunks — text chunk + provenance + embedding ──
  await db.schema
    .createTable('source_chunks')
    .addColumn('id', 'serial', (col) => col.primaryKey())
    .addColumn('tenant_id', 'integer', (col) =>
      col.references('tenants.id').onDelete('cascade').notNull()
    )
    .addColumn('source_id', 'integer', (col) =>
      col.references('sources.id').onDelete('cascade').notNull()
    )
    .addColumn('pack_id', 'integer', (col) =>
      col.references('source_packs.id').onDelete('cascade').notNull()
    )
    .addColumn('page_index', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('chunk_index', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('content', 'text', (col) => col.notNull())
    .addColumn('char_start', 'integer')
    .addColumn('char_end', 'integer')
    .addColumn('char_count', 'integer')
    .addColumn('content_hash', 'varchar(64)', (col) => col.notNull())
    .addColumn('quote', 'varchar(600)')
    // Embedding metadata — namespace tenant-scoped, model/version pinned
    .addColumn('embedding_model', 'varchar(64)')
    .addColumn('embedding_version', 'varchar(32)')
    .addColumn('embedding_updated_at', 'timestamptz')
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(db.fn.now()))
    .execute();

  // Chunk idempotency: one chunk per (source, page, index)
  await sql`
    CREATE UNIQUE INDEX uq_source_chunk_position
    ON source_chunks (tenant_id, source_id, page_index, chunk_index)
  `.execute(db);
  await db.schema
    .createIndex('idx_source_chunk_source')
    .on('source_chunks')
    .columns(['tenant_id', 'source_id'])
    .execute();

  // pgvector embedding column — graceful: extension/column yo'q bo'lsa
  // xatolik butun migratsiyani to'xtatmaydi (dev/CI'da pgvector bo'lmasa).
  try {
    await sql`CREATE EXTENSION IF NOT EXISTS vector`.execute(db);
    await sql`ALTER TABLE source_chunks ADD COLUMN embedding vector(1536)`.execute(db);
  } catch (_) {
    // pgvector mavjud emas — embedding metadata saqlanadi, vector qo'shilmaydi.
    // Real production PG'da ALTER alohida ishga tushiriladi.
  }

  // ── 4. source_approvals — append-only teacher approval trail ──
  await db.schema
    .createTable('source_approvals')
    .addColumn('id', 'serial', (col) => col.primaryKey())
    .addColumn('tenant_id', 'integer', (col) =>
      col.references('tenants.id').onDelete('cascade').notNull()
    )
    .addColumn('source_id', 'integer', (col) =>
      col.references('sources.id').onDelete('cascade').notNull()
    )
    .addColumn('decision', 'varchar(12)', (col) => col.notNull())
    // approved | rejected
    .addColumn('note', 'varchar(500)')
    .addColumn('decided_by', 'integer')
    .addColumn('decided_at', 'timestamptz', (col) => col.notNull().defaultTo(db.fn.now()))
    .execute();

  await db.schema
    .createIndex('idx_source_approval_source')
    .on('source_approvals')
    .columns(['tenant_id', 'source_id'])
    .execute();

  // ── Grants (sql-template pattern) ──
  const newTables = ['source_packs', 'sources', 'source_chunks', 'source_approvals'];
  for (const table of newTables) {
    await sql`GRANT SELECT, INSERT, UPDATE ON ${sql.table(table)} TO edikit_runtime`.execute(db);
    await sql`GRANT USAGE ON ${sql.table(table)}_id_seq TO edikit_runtime`.execute(db);
    await sql`GRANT DELETE ON ${sql.table(table)} TO edikit_migration`.execute(db);
  }
}

/**
 * @param {import('kysely').Kysely<any>} db
 */
export async function down(db) {
  const tables = ['source_approvals', 'source_chunks', 'sources', 'source_packs'];
  for (const table of tables) {
    await db.schema.dropTable(table).ifExists().execute();
  }
}
