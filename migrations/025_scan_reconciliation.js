import { sql } from 'kysely';

/**
 * Deborah — Migration 025: Scan, Reconciliation, OMR & OCR (Prompt 43)
 *
 * Prompt 43 — scanned paper pages'ni silent loss'siz student/questionga
 * reconcile qilish (research.md §52.5 scan quality gate, §16 security):
 *
 *   - scan_batches: upload batch — batch_key idempotency, status lifecycle
 *     (uploading → processing → quality_review → reconciling →
 *     grading_ready → complete), expected_pages vs reconciled_pages
 *     counters; completion BLOCKER: expected == reconciled bo'lmasa
 *     grading_ready'ga o'tib bo'lmaydi (silent drop yo'q).
 *   - scan_pages: per-scanned-page row — storage_key ORIGINAL immutable
 *     (hech qachon overwrite bo'lmaydi), content_hash, quality gate
 *     natijasi (blur/skew/shadow/cut/orientation/duplex), QR decode
 *     natijasi (decoded → routed | forged | unreadable | missing),
 *     page_status lifecycle (scanned → routed | duplicate | orphan |
 *     quality_failed).
 *   - scan_derivatives: enhancement/transcript derivative — kind
 *     (dewarped | enhanced | ocr_transcript), storage_key, content_hash,
 *     source_hash (hash lineage — original'dan derivative'gacha zanjir).
 *   - scan_reconciliation_queue: manual reconciliation tickets — kind
 *     (missing_page | duplicate_page | orphan_page | unreadable_qr |
 *     quality_failed | low_confidence_omr | low_confidence_ocr), status
 *     (open → resolved | escalated); faqat inson hal qiladi.
 *   - scan_omr_marks: OMR mark — confidence (high | ambiguous | low);
 *     ambiguous/low → reconciliation queue'ga tushadi.
 *   - scan_ocr_transcripts: handwriting/math OCR derivative — transcript
 *     draft → approved; low confidence → queue'ga.
 *
 * SECURITY / DATA GUARD (Prompt 43 §15, research.md §52.5):
 *   - Original scan image immutable; barcha enhancement/transcript
 *     derivative'lar alohida saqlanadi + hash lineage.
 *   - Har bir write path tenant-scoped + idempotency (batch_key UNIQUE).
 *   - QR forged/unreadable → hech qachon silent drop bo'lmaydi, queue.
 */

/**
 * @param {import('kysely').Kysely<any>} db
 */
export async function up(db) {
  const { sql } = await import('kysely');

  // ── scan_batches ──
  await db.schema
    .createTable('scan_batches')
    .addColumn('id', 'serial', (col) => col.primaryKey())
    .addColumn('tenant_id', 'integer', (col) =>
      col.notNull().references('tenants.id').onDelete('cascade')
    )
    .addColumn('paper_batch_id', 'integer', (col) =>
      col.references('paper_batches.id').onDelete('set null')
    )
    .addColumn('batch_key', 'varchar(120)', (col) => col.notNull())
    // idempotency — same batch re-upload no-op
    .addColumn('status', 'varchar(30)', (col) => col.notNull().defaultTo('uploading'))
    // uploading → processing → quality_review → reconciling → grading_ready → complete
    .addColumn('expected_pages', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('scanned_pages', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('reconciled_pages', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('missing_pages', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('duplicate_pages', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('orphan_pages', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('quality_failed', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('notes', 'varchar(500)')
    .addColumn('created_by', 'integer', (col) =>
      col.references('users.id').onDelete('set null')
    )
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .execute();

  await db.schema
    .createIndex('idx_scan_batches_key')
    .on('scan_batches')
    .columns(['tenant_id', 'batch_key'])
    .unique()
    .execute();

  // ── scan_pages ──
  await db.schema
    .createTable('scan_pages')
    .addColumn('id', 'serial', (col) => col.primaryKey())
    .addColumn('tenant_id', 'integer', (col) =>
      col.notNull().references('tenants.id').onDelete('cascade')
    )
    .addColumn('scan_batch_id', 'integer', (col) =>
      col.notNull().references('scan_batches.id').onDelete('cascade')
    )
    .addColumn('page_seq', 'integer', (col) => col.notNull().defaultTo(0))
    // physical scan order — out-of-order detection uchun
    .addColumn('storage_key', 'varchar(255)', (col) => col.notNull())
    // ORIGINAL immutable object key — hech qachon overwrite qilinmaydi
    .addColumn('content_hash', 'varchar(64)', (col) => col.notNull())
    .addColumn('width', 'integer')
    .addColumn('height', 'integer')
    .addColumn('dpi', 'integer', (col) => col.defaultTo(0))
    .addColumn('orientation', 'varchar(20)', (col) => col.defaultTo('portrait'))
    // portrait | landscape | upside_down
    .addColumn('quality_flags', 'jsonb', (col) => col.defaultTo('[]'))
    // ["blur","skew","shadow","cut","duplex_missing"]
    .addColumn('quality_score', 'integer', (col) => col.defaultTo(100))
    // 0–100 — 300 DPI target §52.5
    .addColumn('qr_token', 'varchar(400)')
    .addColumn('qr_status', 'varchar(20)', (col) => col.defaultTo('missing'))
    // decoded | forged | unreadable | missing
    .addColumn('routed_packet_id', 'varchar(64)')
    .addColumn('routed_page_index', 'integer')
    .addColumn('page_status', 'varchar(20)', (col) => col.notNull().defaultTo('scanned'))
    // scanned → routed | duplicate | orphan | quality_failed | escalated
    .addColumn('scan_error', 'varchar(255)')
    .addColumn('scanned_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .execute();

  await db.schema
    .createIndex('idx_scan_pages_batch')
    .on('scan_pages')
    .columns(['tenant_id', 'scan_batch_id', 'page_seq'])
    .execute();

  // ── scan_derivatives ──
  await db.schema
    .createTable('scan_derivatives')
    .addColumn('id', 'serial', (col) => col.primaryKey())
    .addColumn('tenant_id', 'integer', (col) =>
      col.notNull().references('tenants.id').onDelete('cascade')
    )
    .addColumn('scan_page_id', 'integer', (col) =>
      col.notNull().references('scan_pages.id').onDelete('cascade')
    )
    .addColumn('kind', 'varchar(30)', (col) => col.notNull())
    // dewarped | enhanced | ocr_transcript | omr_mask
    .addColumn('storage_key', 'varchar(255)', (col) => col.notNull())
    .addColumn('content_hash', 'varchar(64)', (col) => col.notNull())
    .addColumn('source_hash', 'varchar(64)', (col) => col.notNull())
    // hash lineage — original content_hash'ga zanjir
    .addColumn('meta', 'jsonb', (col) => col.defaultTo('{}'))
    .addColumn('created_by', 'integer', (col) =>
      col.references('users.id').onDelete('set null')
    )
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .execute();

  // ── scan_reconciliation_queue ──
  await db.schema
    .createTable('scan_reconciliation_queue')
    .addColumn('id', 'serial', (col) => col.primaryKey())
    .addColumn('tenant_id', 'integer', (col) =>
      col.notNull().references('tenants.id').onDelete('cascade')
    )
    .addColumn('scan_batch_id', 'integer', (col) =>
      col.notNull().references('scan_batches.id').onDelete('cascade')
    )
    .addColumn('kind', 'varchar(30)', (col) => col.notNull())
    // missing_page | duplicate_page | orphan_page | unreadable_qr |
    // quality_failed | low_confidence_omr | low_confidence_ocr
    .addColumn('status', 'varchar(20)', (col) => col.notNull().defaultTo('open'))
    // open → resolved | escalated
    .addColumn('page_id', 'integer', (col) =>
      col.references('scan_pages.id').onDelete('set null')
    )
    .addColumn('packet_id', 'varchar(64)')
    .addColumn('page_index', 'integer')
    .addColumn('reason', 'varchar(500)')
    .addColumn('resolution', 'varchar(500)')
    .addColumn('resolved_by', 'integer', (col) =>
      col.references('users.id').onDelete('set null')
    )
    .addColumn('resolved_at', 'timestamptz')
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .execute();

  await db.schema
    .createIndex('idx_scan_queue_batch')
    .on('scan_reconciliation_queue')
    .columns(['tenant_id', 'scan_batch_id', 'status'])
    .execute();

  // ── scan_omr_marks ──
  await db.schema
    .createTable('scan_omr_marks')
    .addColumn('id', 'serial', (col) => col.primaryKey())
    .addColumn('tenant_id', 'integer', (col) =>
      col.notNull().references('tenants.id').onDelete('cascade')
    )
    .addColumn('scan_batch_id', 'integer', (col) =>
      col.notNull().references('scan_batches.id').onDelete('cascade')
    )
    .addColumn('scan_page_id', 'integer', (col) =>
      col.references('scan_pages.id').onDelete('set null')
    )
    .addColumn('packet_id', 'varchar(64)')
    .addColumn('page_index', 'integer')
    .addColumn('question_key', 'varchar(64)', (col) => col.notNull())
    .addColumn('option_index', 'integer', (col) => col.notNull())
    .addColumn('confidence', sql`numeric(5,4)`, (col) => col.notNull().defaultTo(0))
    .addColumn('status', 'varchar(20)', (col) => col.notNull().defaultTo('high'))
    // high | ambiguous | low
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .execute();

  // ── scan_ocr_transcripts ──
  await db.schema
    .createTable('scan_ocr_transcripts')
    .addColumn('id', 'serial', (col) => col.primaryKey())
    .addColumn('tenant_id', 'integer', (col) =>
      col.notNull().references('tenants.id').onDelete('cascade')
    )
    .addColumn('scan_batch_id', 'integer', (col) =>
      col.notNull().references('scan_batches.id').onDelete('cascade')
    )
    .addColumn('scan_page_id', 'integer', (col) =>
      col.references('scan_pages.id').onDelete('set null')
    )
    .addColumn('packet_id', 'varchar(64)')
    .addColumn('page_index', 'integer')
    .addColumn('kind', 'varchar(20)', (col) => col.notNull().defaultTo('handwriting'))
    // handwriting | math
    .addColumn('transcript_text', 'text')
    .addColumn('confidence', sql`numeric(5,4)`, (col) => col.notNull().defaultTo(0))
    .addColumn('status', 'varchar(20)', (col) => col.notNull().defaultTo('draft'))
    // draft | approved | rejected
    .addColumn('source_hash', 'varchar(64)')
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .execute();

  // ── Grants ──
  const newTables = [
    'scan_batches',
    'scan_pages',
    'scan_derivatives',
    'scan_reconciliation_queue',
    'scan_omr_marks',
    'scan_ocr_transcripts',
  ];
  for (const table of newTables) {
    await sql`GRANT SELECT, INSERT, UPDATE ON ${sql.table(table)} TO deborah_runtime`.execute(db);
    try { await sql`GRANT USAGE ON ${sql.id(table + '_id_seq')} TO deborah_runtime`.execute(db); } catch (_) { /* serial emas — seq yo'q */ }
    await sql`GRANT DELETE ON ${sql.table(table)} TO deborah_migration`.execute(db);
  }
}

/**
 * @param {import('kysely').Kysely<any>} db
 */
export async function down(db) {
  const tables = [
    'scan_ocr_transcripts',
    'scan_omr_marks',
    'scan_reconciliation_queue',
    'scan_derivatives',
    'scan_pages',
    'scan_batches',
  ];
  for (const table of tables) {
    await db.schema.dropTable(table).ifExists().execute();
  }
}
