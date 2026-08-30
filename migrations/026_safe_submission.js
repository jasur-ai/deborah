/**
 * Deborah — Migration 026: Safe File, Code & Oral Submission (Prompt 44)
 *
 * Prompt 44 — project/file/code/audio/video assessmentlar uchun SECURE
 * RESUMABLE submission (research.md §16.3 file antivirus/sandbox, §51
 * oral assessment, §17 P2-21 oral recorder):
 *
 *   - upload_sessions: resumable upload session — session_key UNIQUE
 *     idempotency, kind (file | code | audio | video), status lifecycle
 *     (open → uploading → complete → quarantined → accepted | rejected),
 *     expected_size, chunk_size, received_chunks/total_chunks, declared
 *     MIME vs magic-detected MIME, sha256 (server-computed), quarantine
 *     status (pending → clean | infected | unscannable).
 *   - upload_chunks: per-chunk receipt — chunk_index UNIQUE per session
 *     (resume contract), offset/size/sha256 per chunk, status
 *     (received → verified | rejected); client shunchaki offset
 *     jo'natadi, server maydonni tekshiradi (server-authoritative §15).
 *   - submission_versions: AUTHORIZED resubmission/version flow —
 *     attempt_id + version_no UNIQUE, status (draft → submitted |
 *     superseded), superseded_by (old version), signed receipt per
 *     version.
 *   - submission_receipts: signed receipt — receipt_token UNIQUE
 *     (idempotency), receipt_body + HMAC signature (immutable, non-forgeable).
 *   - scan_results: IMMUTABLE scan log — scanner (magic | archive |
 *     macro | pdf | codesandbox), verdict (clean | infected | suspicious |
 *     unscannable), details jsonb; antivirus/sandbox FAIL-OPEN bo'lmaydi
 *     (verdict yo'q bo'lsa → unscannable → quarantine, hech qachon
 *     accepted emas) §16.3, §24 stop condition.
 *   - media_transcripts: oral/audio/video transcript derivative —
 *     transcript_text, confidence, status (draft → approved | rejected),
 *     manual_listen (low-confidence → teacher manual listen queue §17 P2-21).
 *
 * SECURITY / DATA GUARD (Prompt 44 §15, research.md §16.3):
 *   - Uploaded code hook ishlamasin — code faqat static check +
 *     resource-limit contract orqali qabul qilinadi (sandbox config).
 *   - Quarantine LATE PENALTYga aylanmasin — infected/scanner-fail
 *     submission studentga nozir emas, shunchaki 'needs_review' bo'ladi;
 *     penalty faqat reviewed/confirmed cheats bo'lsa qo'llanadi.
 *   - Har bir write path tenant-scoped + idempotent.
 */

import { sql } from 'kysely';

/**
 * @param {import('kysely').Kysely<any>} db
 */
export async function up(db) {
  // ── 1. upload_sessions — resumable upload session ──
  await db.schema
    .createTable('upload_sessions')
    .addColumn('id', 'serial', (col) => col.primaryKey())
    .addColumn('tenant_id', 'integer', (col) =>
      col.references('tenants.id').onDelete('cascade').notNull()
    )
    .addColumn('attempt_id', 'integer', (col) =>
      col.references('attempts.id').onDelete('cascade').notNull()
    )
    .addColumn('user_id', 'integer', (col) =>
      col.references('users.id').onDelete('cascade').notNull()
    )
    .addColumn('session_key', 'varchar(64)', (col) => col.notNull())
    // client-supplied idempotency key (UUID) — retry = same session
    .addColumn('kind', 'varchar(12)', (col) => col.notNull())
    // file | code | audio | video
    .addColumn('status', 'varchar(16)', (col) => col.notNull().defaultTo('open'))
    // open → uploading → complete → quarantined → accepted | rejected
    .addColumn('original_name', 'varchar(255)')
    .addColumn('declared_mime', 'varchar(127)')
    .addColumn('magic_mime', 'varchar(127)')
    // detected from file magic bytes (server-side, never trusts client)
    .addColumn('expected_size', 'bigint', (col) => col.notNull().defaultTo(0))
    .addColumn('received_size', 'bigint', (col) => col.notNull().defaultTo(0))
    .addColumn('chunk_size', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('total_chunks', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('received_chunks', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('sha256', 'varchar(64)')
    // server-computed final content hash
    .addColumn('storage_key', 'varchar(512)')
    .addColumn('quarantine_status', 'varchar(16)', (col) => col.notNull().defaultTo('pending'))
    // pending → clean | infected | unscannable
    .addColumn('quarantine_reason', 'varchar(500)')
    .addColumn('created_by', 'integer')
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .execute();

  await sql`
    CREATE UNIQUE INDEX uq_upload_session_key
    ON upload_sessions (tenant_id, session_key)
  `.execute(db);
  await db.schema
    .createIndex('idx_upload_session_attempt')
    .on('upload_sessions')
    .columns(['tenant_id', 'attempt_id'])
    .execute();

  // ── 2. upload_chunks — resumable chunk receipts (server-authoritative) ──
  await db.schema
    .createTable('upload_chunks')
    .addColumn('id', 'serial', (col) => col.primaryKey())
    .addColumn('tenant_id', 'integer', (col) =>
      col.references('tenants.id').onDelete('cascade').notNull()
    )
    .addColumn('session_id', 'integer', (col) =>
      col.references('upload_sessions.id').onDelete('cascade').notNull()
    )
    .addColumn('chunk_index', 'integer', (col) => col.notNull())
    .addColumn('offset', 'bigint', (col) => col.notNull())
    .addColumn('size', 'integer', (col) => col.notNull())
    .addColumn('sha256', 'varchar(64)', (col) => col.notNull())
    // per-chunk hash for the resume chain
    .addColumn('status', 'varchar(12)', (col) => col.notNull().defaultTo('received'))
    // received → verified | rejected
    .addColumn('storage_key', 'varchar(512)')
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .execute();

  await sql`
    CREATE UNIQUE INDEX uq_upload_chunk_session_index
    ON upload_chunks (tenant_id, session_id, chunk_index)
  `.execute(db);
  await db.schema
    .createIndex('idx_upload_chunk_session')
    .on('upload_chunks')
    .columns(['tenant_id', 'session_id'])
    .execute();

  // ── 3. submission_versions — authorized resubmission / version flow ──
  await db.schema
    .createTable('submission_versions')
    .addColumn('id', 'serial', (col) => col.primaryKey())
    .addColumn('tenant_id', 'integer', (col) =>
      col.references('tenants.id').onDelete('cascade').notNull()
    )
    .addColumn('attempt_id', 'integer', (col) =>
      col.references('attempts.id').onDelete('cascade').notNull()
    )
    .addColumn('user_id', 'integer', (col) =>
      col.references('users.id').onDelete('cascade').notNull()
    )
    .addColumn('version_no', 'integer', (col) => col.notNull())
    // 1 = first submission.execute() resubmission (authorized) → 2, 3, ...
    .addColumn('upload_session_id', 'integer', (col) =>
      col.references('upload_sessions.id').onDelete('set null')
    )
    .addColumn('status', 'varchar(14)', (col) => col.notNull().defaultTo('submitted'))
    // draft → submitted → superseded
    .addColumn('superseded_by', 'integer')
    // id of the newer version (immutable history kept)
    .addColumn('superseded_at', 'timestamptz')
    .addColumn('submitted_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn('created_by', 'integer')
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .execute();

  await sql`
    CREATE UNIQUE INDEX uq_submission_version
    ON submission_versions (tenant_id, attempt_id, version_no)
  `.execute(db);
  await db.schema
    .createIndex('idx_submission_version_attempt')
    .on('submission_versions')
    .columns(['tenant_id', 'attempt_id'])
    .execute();

  // ── 4. submission_receipts — signed, immutable receipts ──
  await db.schema
    .createTable('submission_receipts')
    .addColumn('id', 'serial', (col) => col.primaryKey())
    .addColumn('tenant_id', 'integer', (col) =>
      col.references('tenants.id').onDelete('cascade').notNull()
    )
    .addColumn('version_id', 'integer', (col) =>
      col.references('submission_versions.id').onDelete('cascade').notNull()
    )
    .addColumn('attempt_id', 'integer', (col) =>
      col.references('attempts.id').onDelete('cascade').notNull()
    )
    .addColumn('receipt_token', 'varchar(64)', (col) => col.notNull())
    // idempotency + shareable verification token
    .addColumn('receipt_body', 'jsonb', (col) => col.notNull())
    .addColumn('signature', 'varchar(64)', (col) => col.notNull())
    .addColumn('issued_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .execute();

  await sql`
    CREATE UNIQUE INDEX uq_submission_receipt_version
    ON submission_receipts (tenant_id, version_id)
  `.execute(db);
  await sql`
    CREATE UNIQUE INDEX uq_submission_receipt_token
    ON submission_receipts (tenant_id, receipt_token)
  `.execute(db);

  // ── 5. scan_results — IMMUTABLE scan log (no fail-open) ──
  await db.schema
    .createTable('scan_results')
    .addColumn('id', 'serial', (col) => col.primaryKey())
    .addColumn('tenant_id', 'integer', (col) =>
      col.references('tenants.id').onDelete('cascade').notNull()
    )
    .addColumn('session_id', 'integer', (col) =>
      col.references('upload_sessions.id').onDelete('cascade').notNull()
    )
    .addColumn('scanner', 'varchar(16)', (col) => col.notNull())
    // magic | archive | macro | pdf | codesandbox
    .addColumn('verdict', 'varchar(14)', (col) => col.notNull())
    // clean | infected | suspicious | unscannable
    .addColumn('details', 'jsonb', (col) => col.defaultTo('{}'))
    .addColumn('scanned_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .execute();

  await db.schema
    .createIndex('idx_scan_result_session')
    .on('scan_results')
    .columns(['tenant_id', 'session_id'])
    .execute();

  // ── 6. media_transcripts — oral/audio/video transcript + manual listen ──
  await db.schema
    .createTable('media_transcripts')
    .addColumn('id', 'serial', (col) => col.primaryKey())
    .addColumn('tenant_id', 'integer', (col) =>
      col.references('tenants.id').onDelete('cascade').notNull()
    )
    .addColumn('session_id', 'integer', (col) =>
      col.references('upload_sessions.id').onDelete('cascade').notNull()
    )
    .addColumn('attempt_id', 'integer', (col) =>
      col.references('attempts.id').onDelete('cascade').notNull()
    )
    .addColumn('kind', 'varchar(12)', (col) => col.notNull())
    // oral | audio | video
    .addColumn('transcript_text', 'text', (col) => col.notNull())
    .addColumn('confidence', 'real', (col) => col.notNull().defaultTo(0))
    .addColumn('status', 'varchar(12)', (col) => col.notNull().defaultTo('draft'))
    // draft → approved | rejected
    .addColumn('manual_listen', 'boolean', (col) => col.notNull().defaultTo(false))
    // low-confidence → teacher manual listen queue
    .addColumn('source_hash', 'varchar(64)')
    .addColumn('created_by', 'integer')
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .execute();

  await db.schema
    .createIndex('idx_media_transcript_session')
    .on('media_transcripts')
    .columns(['tenant_id', 'session_id'])
    .execute();
  await db.schema
    .createIndex('idx_media_transcript_listen')
    .on('media_transcripts')
    .columns(['tenant_id', 'manual_listen', 'status'])
    .execute();

  // ── Grants (sql-template pattern) ──
  const newTables = [
    'upload_sessions',
    'upload_chunks',
    'submission_versions',
    'submission_receipts',
    'scan_results',
    'media_transcripts',
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
    'media_transcripts',
    'scan_results',
    'submission_receipts',
    'submission_versions',
    'upload_chunks',
    'upload_sessions',
  ];
  for (const table of tables) {
    await db.schema.dropTable(table).ifExists().execute();
  }
}
