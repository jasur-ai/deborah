import { sql } from 'kysely';

/**
 * Deborah — Migration 024: Paper Packet, QR & Chain of Custody (Prompt 42)
 *
 * Prompt 42 — approved examdan per-student/form paper packet va custody
 * ledger yaratish (research.md §52 Hybrid Paper Exam Factory, §16 security):
 *
 *   - paper_batches: print-center batch — batch_key idempotency, status
 *     lifecycle (planned → generated → downloaded → received →
 *     reconciled → archived|destroyed), signed batch manifest hash.
 *   - paper_packets: per-student/per-form packet — opaque_packet_id (public,
 *     answer key yo'q), variant, page_count, checksum, accommodation render
 *     flags (large_print / one_sided / extra_spacing), detachable cover +
 *     human-readable backup code. UNIQUE (tenant_id, opaque_packet_id) →
 *     idempotent regeneration.
 *   - paper_pages: per-page signed QR payload — { packet, page, epoch,
 *     nonce, sig } (research.md §52.3 — answer key / raw student PII YO'Q);
 *     page_index, content_hash (item hash), UNIQUE (tenant, packet_id,
 *     page_index) + UNIQUE (tenant, qr_token).
 *   - paper_custody_ledger: append-only custody events — event_type
 *     (generated | batch_downloaded | operator_received | sealed_received |
 *     scanned_received | reconciled | archived | destroyed | unused_destroyed),
 *     actor, count, discrepancy, signature; chain: prev_event_id link.
 *
 * SECURITY / DATA GUARD (Prompt 42 §15, research.md §16.1/§52.3):
 *   - QR payload faqat opaque_packet_id + page + epoch + nonce + sig — answer
 *     key, rubric, raw student PII hech qachon.
 *   - Detachable identity cover: name/ID faqat cover matnida, packet body'da
 *     emas; server manifest student → opaque_packet_id mappingni alohida
 *     saqlaydi.
 *   - PDF metadata/layer secret scan: build time secret-scan (verifyPaperClean).
 *   - Har bir write path tenant-scoped + idempotency (batch_key /
 *     opaque_packet_id / qr_token UNIQUE).
 *
 * Rollback: down() orqali o'chiriladi.
 */

/**
 * @param {import('kysely').Kysely<any>} db
 */
export async function up(db) {
  const { sql } = await import('kysely');

  // ── 1. Paper batches (print-center batch) ──
  await db.schema
    .createTable('paper_batches')
    .addColumn('id', 'serial', (col) => col.primaryKey())
    .addColumn('tenant_id', 'integer', (col) =>
      col.references('tenants.id').onDelete('cascade').notNull()
    )
    .addColumn('assignment_id', 'integer', (col) =>
      col.references('assessment_assignments.id').onDelete('set null')
    )
    .addColumn('run_id', 'integer', (col) =>
      col.references('exam_schedule_runs.id').onDelete('set null')
    )
    .addColumn('batch_key', 'varchar(120)', (col) => col.notNull())
    // idempotency — takroriy generatsiyani bloklaydi
    .addColumn('status', 'varchar(20)', (col) => col.notNull().defaultTo('planned'))
    // planned → generated → downloaded → received → reconciled → archived|destroyed
    .addColumn('packet_count', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('manifest_hash', 'varchar(64)')
    // signed batch manifest (SHA-256) — reproducible
    .addColumn('created_by', 'integer', (col) =>
      col.references('users.id').onDelete('set null')
    )
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .execute();

  await db.schema
    .createIndex('uq_paper_batches_key', { unique: true })
    .on('paper_batches')
    .columns(['tenant_id', 'batch_key'])
    .execute();

  // ── 2. Paper packets (per-student / per-form) ──
  await db.schema
    .createTable('paper_packets')
    .addColumn('id', 'serial', (col) => col.primaryKey())
    .addColumn('tenant_id', 'integer', (col) =>
      col.references('tenants.id').onDelete('cascade').notNull()
    )
    .addColumn('batch_id', 'integer', (col) =>
      col.references('paper_batches.id').onDelete('cascade').notNull()
    )
    .addColumn('assignment_id', 'integer', (col) =>
      col.references('assessment_assignments.id').onDelete('set null')
    )
    .addColumn('opaque_packet_id', 'varchar(64)', (col) => col.notNull())
    // PUBLIC id — answer key / student PII saqlamaydi
    .addColumn('student_user_id', 'integer', (col) =>
      col.references('users.id').onDelete('set null')
    )
    .addColumn('variant', 'varchar(10)')
    // A | B | C | null (form variant)
    .addColumn('page_count', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('checksum', 'varchar(64)')
    .addColumn('accommodation_flags', 'jsonb', (col) => col.defaultTo('[]'))
    // ['large_print', 'one_sided', 'extra_spacing'] — no raw sensitive reason
    .addColumn('backup_code', 'varchar(20)')
    // printed human-readable backup code (§52.3)
    .addColumn('cover_identity', 'jsonb', (col) => col.defaultTo('{}'))
    // detachable cover: { name, student_id } — only on cover, not body
    .addColumn('created_by', 'integer', (col) =>
      col.references('users.id').onDelete('set null')
    )
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .execute();

  await db.schema
    .createIndex('uq_paper_packets_opaque', { unique: true })
    .on('paper_packets')
    .columns(['tenant_id', 'opaque_packet_id'])
    .execute();

  await db.schema
    .createIndex('idx_paper_packets_batch')
    .on('paper_packets')
    .columns(['tenant_id', 'batch_id'])
    .execute();

  // ── 3. Paper pages (per-page signed QR) ──
  await db.schema
    .createTable('paper_pages')
    .addColumn('id', 'serial', (col) => col.primaryKey())
    .addColumn('tenant_id', 'integer', (col) =>
      col.references('tenants.id').onDelete('cascade').notNull()
    )
    .addColumn('packet_id', 'integer', (col) =>
      col.references('paper_packets.id').onDelete('cascade').notNull()
    )
    .addColumn('page_index', 'integer', (col) => col.notNull())
    .addColumn('qr_token', 'varchar(200)', (col) => col.notNull())
    // signed QR payload (JSON with sig) — NO answer key / raw PII
    .addColumn('qr_hash', 'varchar(64)')
    .addColumn('content_hash', 'varchar(64)')
    // page content (public items) hash — reproducibility
    .addColumn('render_flags', 'jsonb', (col) => col.defaultTo('[]'))
    .addColumn('scanned_at', 'timestamptz')
    // first-scan marker — QR copy qilinsa duplicate/replay detection (§52.3)
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .execute();

  await db.schema
    .createIndex('uq_paper_pages_qr', { unique: true })
    .on('paper_pages')
    .columns(['tenant_id', 'qr_token'])
    .execute();

  await db.schema
    .createIndex('uq_paper_pages_page', { unique: true })
    .on('paper_pages')
    .columns(['tenant_id', 'packet_id', 'page_index'])
    .execute();

  // ── 4. Paper custody ledger (append-only chain) ──
  await db.schema
    .createTable('paper_custody_ledger')
    .addColumn('id', 'serial', (col) => col.primaryKey())
    .addColumn('tenant_id', 'integer', (col) =>
      col.references('tenants.id').onDelete('cascade').notNull()
    )
    .addColumn('batch_id', 'integer', (col) =>
      col.references('paper_batches.id').onDelete('set null')
    )
    .addColumn('event_type', 'varchar(30)', (col) => col.notNull())
    // generated | batch_downloaded | operator_received | sealed_received |
    // scanned_received | reconciled | archived | destroyed | unused_destroyed
    .addColumn('actor_user_id', 'integer', (col) =>
      col.references('users.id').onDelete('set null')
    )
    .addColumn('count', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('discrepancy', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('signature', 'varchar(64)')
    // event signature (HMAC) — append-only audit chain
    .addColumn('prev_event_id', 'integer')
    // chain link — tamper-evident custody
    .addColumn('note', 'varchar(255)')
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .execute();

  await db.schema
    .createIndex('idx_paper_custody_batch')
    .on('paper_custody_ledger')
    .columns(['tenant_id', 'batch_id', 'created_at'])
    .execute();

  // ── Grant permissions ──
  const newTables = ['paper_batches', 'paper_packets', 'paper_pages', 'paper_custody_ledger'];
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
  const tables = ['paper_custody_ledger', 'paper_pages', 'paper_packets', 'paper_batches'];
  for (const table of tables) {
    await db.schema.dropTable(table).ifExists().execute();
  }
}
