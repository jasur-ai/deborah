/**
 * Deborah — Migration 016: IndexedDB Offline Journal, Reconnect & Recovery
 *
 * Prompt 32 — low-bandwidth/crash resilience (research.md §29):
 *   - The browser keeps an encrypted local journal (IndexedDB) and appends
 *     every edit {seq, itemId, patch, clientTime}. Online, it sends batches
 *     with idempotency keys; the server ACKs the highest contiguous seq and
 *     the client resends anything above it on reconnect (lossless sync).
 *
 * Server-side persistence (this migration):
 *   - offline_journal_acks: one row per (attempt, device) holding the highest
 *     ACKed contiguous sequence + last sync. UNIQUE (tenant, attempt, device)
 *     → a retried sync upserts the SAME row (idempotent, no duplicates).
 *   - recovery_packages: emergency offline submission packages (research.md
 *     §29.5). Exported by the student (or created server-side on their behalf)
 *     and IMPORTED by a PRIVILEGED actor (admin/proctor) with a full audit
 *     trail (who/when/checksum/status). Idempotency: UNIQUE package_id.
 *
 * Security / data guard (Prompt 32 §15):
 *   - Offline/recovery packages NEVER contain the answer key — only student
 *     response payloads + server metadata. The server re-scores after sync
 *     (key stays server-side).
 *   - A disconnect is NEVER a penalty ("disconnect strike bo'lmasin") — the
 *     journal survives and syncs losslessly on reconnect.
 *
 * Rollback: both tables droppable via down().
 */

import { sql } from 'kysely';

/**
 * @param {import('kysely').Kysely<any>} db
 */
export async function up(db) {
  // ── 1. offline_journal_acks — per-device ACK watermark ──
  await db.schema
    .createTable('offline_journal_acks')
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
    .addColumn('device_id', 'varchar(160)', (col) => col.notNull())
    // Client-generated device fingerprint (crypto-random, not PII)
    .addColumn('acked_seq', 'integer', (col) => col.notNull().defaultTo(0))
    // Highest CONTIGUOUS seq ACKed by the server for this device
    .addColumn('last_acked_at', 'timestamptz', (col) => col.defaultTo(null))
    .addColumn('last_sync_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .execute();

  // Idempotent sync: one ACK watermark per (attempt, device).
  await sql`
    CREATE UNIQUE INDEX uq_offline_ack_device
    ON offline_journal_acks (tenant_id, attempt_id, device_id)
  `.execute(db);

  await db.schema
    .createIndex('idx_offline_ack_attempt_user')
    .on('offline_journal_acks')
    .columns(['attempt_id', 'user_id'])
    .execute();

  // ── 2. recovery_packages — emergency offline submission (privileged import) ──
  await db.schema
    .createTable('recovery_packages')
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
    .addColumn('package_id', 'varchar(160)', (col) => col.notNull())
    // Deterministic idempotency key (sha256 of attempt+device+exportedAt)
    .addColumn('checksum', 'varchar(128)', (col) => col.notNull())
    // sha256 over the canonical JSON — integrity verification on import
    .addColumn('status', 'varchar(20)', (col) => col.notNull().defaultTo('exported'))
    // exported | imported | rejected
    .addColumn('payload', 'jsonb', (col) => col.defaultTo('{}'))
    // { journal, device_id, exported_at, version, response_count, checksum }
    .addColumn('imported_by', 'varchar(160)')
    // Privileged actor (admin username / proctor id) — audit trail
    .addColumn('imported_at', 'timestamptz', (col) => col.defaultTo(null))
    .addColumn('reject_reason', 'varchar(200)')
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .execute();

  // Idempotent import: a retried import of the same package is a no-op.
  await sql`
    CREATE UNIQUE INDEX uq_recovery_package_id
    ON recovery_packages (tenant_id, package_id)
  `.execute(db);

  await db.schema
    .createIndex('idx_recovery_attempt_user')
    .on('recovery_packages')
    .columns(['attempt_id', 'user_id'])
    .execute();

  // ── Grants ──
  await sql`GRANT SELECT, INSERT, UPDATE ON offline_journal_acks TO deborah_runtime`.execute(db);
  await sql`GRANT USAGE ON offline_journal_acks_id_seq TO deborah_runtime`.execute(db);
  await sql`GRANT SELECT, INSERT, UPDATE ON recovery_packages TO deborah_runtime`.execute(db);
  await sql`GRANT USAGE ON recovery_packages_id_seq TO deborah_runtime`.execute(db);
  await sql`GRANT DELETE ON offline_journal_acks TO deborah_migration`.execute(db);
  await sql`GRANT DELETE ON recovery_packages TO deborah_migration`.execute(db);

  console.log('Offline journal/recovery structure created: offline_journal_acks, recovery_packages');
}

/**
 * @param {import('kysely').Kysely<any>} db
 */
export async function down(db) {
  await db.schema.dropTable('recovery_packages').ifExists().execute();
  await db.schema.dropTable('offline_journal_acks').ifExists().execute();
}
