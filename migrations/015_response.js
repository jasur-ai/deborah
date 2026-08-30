/**
 * Deborah — Migration 015: Response API, ACK Sequence & Autosave
 *
 * Reliable autosave contract for MCQ, structured and essay responses
 * (Prompt 31):
 *   - attempt_responses: one row per saved response. Response MODES:
 *       * first     — first response for the item is final (partial UNIQUE)
 *       * item_lock — after the first save the item is locked (partial UNIQUE)
 *       * editable  — monotonic client_seq revisions allowed (UNIQUE per item
 *                     seq; out-of-order/duplicates rejected deterministically)
 *   - attempt_response_revisions: essay autosave history (snapshot/patch).
 *
 * Key design:
 *   - client_seq + idempotency_key: the client sends a monotonic sequence and
 *     a derived key; the server ACKs the HIGHEST accepted sequence. A retried
 *     request with the same key returns the STORED ACK (idempotent).
 *   - epoch: server-received timestamp is authoritative; client time/epoch is
 *     only cross-checked for staleness (Prompt 31 §15 — a save is NEVER shown
 *     as synced without a server ACK).
 *   - Security: raw essay text never reaches audit/log events — audit stores
 *     item_id + seq + mode only (Prompt 31 §15).
 *   - tenant-scoped everywhere; FK cascade on attempt/user.
 *
 * Rollback: both tables droppable via down().
 */

import { sql } from 'kysely';

/**
 * @param {import('kysely').Kysely<any>} db
 */
export async function up(db) {
  // ── 1. attempt_responses ──
  await db.schema
    .createTable('attempt_responses')
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
    .addColumn('item_id', 'integer', (col) => col.notNull())
    // References assignment_public_items.item_id (content package)
    .addColumn('mode', 'varchar(20)', (col) => col.notNull())
    // first | editable | item_lock
    .addColumn('client_seq', 'integer', (col) => col.notNull().defaultTo(1))
    // Monotonic per item.execute() server ACKs the highest accepted
    .addColumn('revision', 'integer', (col) => col.notNull().defaultTo(1))
    // For editable mode: 1..N revisions
    .addColumn('idempotency_key', 'varchar(160)')
    // Derived client key — retried saves return the stored ACK
    .addColumn('status', 'varchar(20)', (col) => col.notNull().defaultTo('accepted'))
    // pending | accepted | rejected
    .addColumn('rejection_reason', 'varchar(120)')
    // stale_seq | duplicate | item_locked | late | invalid_item | epoch_mismatch
    .addColumn('payload', 'jsonb', (col) => col.defaultTo('{}'))
    // { value } — typed response payload
    .addColumn('server_received_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`)
    )
    // Server-authoritative receive time (epoch)
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .execute();

  // Idempotency: one row per (attempt, item, client_seq) — duplicate/out-of-order
  // saves are rejected atomically by this unique index.
  await sql`
    CREATE UNIQUE INDEX uq_response_attempt_item_seq
    ON attempt_responses (tenant_id, attempt_id, item_id, client_seq)
  `.execute(db);

  // Idempotency key backstop: a retried save (same key) returns the stored ACK.
  await sql`
    CREATE UNIQUE INDEX uq_response_idempotency_key
    ON attempt_responses (tenant_id, idempotency_key)
    WHERE idempotency_key IS NOT NULL
  `.execute(db);

  // FIRST mode: first accepted response is final — partial UNIQUE.
  await sql`
    CREATE UNIQUE INDEX uq_response_first_accepted
    ON attempt_responses (tenant_id, attempt_id, item_id)
    WHERE mode = 'first' AND status = 'accepted'
  `.execute(db);

  // ITEM_LOCK mode: after the first accepted save the item is locked —
  // a second accepted row is impossible (partial UNIQUE).
  await sql`
    CREATE UNIQUE INDEX uq_response_item_lock_accepted
    ON attempt_responses (tenant_id, attempt_id, item_id)
    WHERE mode = 'item_lock' AND status = 'accepted'
  `.execute(db);

  await db.schema
    .createIndex('idx_response_attempt_item')
    .on('attempt_responses')
    .columns(['attempt_id', 'item_id'])
    .execute();

  await db.schema
    .createIndex('idx_response_attempt_status')
    .on('attempt_responses')
    .columns(['attempt_id', 'status'])
    .execute();

  // ── 2. attempt_response_revisions (essay autosave history) ──
  await db.schema
    .createTable('attempt_response_revisions')
    .addColumn('id', 'serial', (col) => col.primaryKey())
    .addColumn('tenant_id', 'integer', (col) =>
      col.references('tenants.id').onDelete('cascade').notNull()
    )
    .addColumn('response_id', 'integer', (col) =>
      col.references('attempt_responses.id').onDelete('cascade').notNull()
    )
    .addColumn('attempt_id', 'integer', (col) =>
      col.references('attempts.id').onDelete('cascade').notNull()
    )
    .addColumn('item_id', 'integer', (col) => col.notNull())
    .addColumn('revision', 'integer', (col) => col.notNull())
    .addColumn('patch_type', 'varchar(10)', (col) => col.notNull().defaultTo('snapshot'))
    // snapshot | patch
    .addColumn('snapshot', 'jsonb', (col) => col.defaultTo('{}'))
    // Full essay snapshot (every N chars / seconds)
    .addColumn('patch', 'jsonb', (col) => col.defaultTo('{}'))
    // { ops } minimal patch between snapshots
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .execute();

  await sql`
    CREATE UNIQUE INDEX uq_response_revision
    ON attempt_response_revisions (tenant_id, response_id, revision)
  `.execute(db);

  await db.schema
    .createIndex('idx_response_revisions_item')
    .on('attempt_response_revisions')
    .columns(['attempt_id', 'item_id', 'revision'])
    .execute();

  // ── Grants ──
  await sql`GRANT SELECT, INSERT, UPDATE ON attempt_responses TO deborah_runtime`.execute(db);
  await sql`GRANT USAGE ON attempt_responses_id_seq TO deborah_runtime`.execute(db);
  await sql`GRANT SELECT, INSERT ON attempt_response_revisions TO deborah_runtime`.execute(db);
  await sql`GRANT USAGE ON attempt_response_revisions_id_seq TO deborah_runtime`.execute(db);
  await sql`GRANT DELETE ON attempt_responses TO deborah_migration`.execute(db);
  await sql`GRANT DELETE ON attempt_response_revisions TO deborah_migration`.execute(db);
  await sql`GRANT SELECT ON attempt_responses TO deborah_scoring`.execute(db);
  await sql`GRANT SELECT ON attempt_response_revisions TO deborah_scoring`.execute(db);

  console.log('Response/ACK/autosave structure created: attempt_responses, attempt_response_revisions');
}

/**
 * @param {import('kysely').Kysely<any>} db
 */
export async function down(db) {
  await db.schema.dropTable('attempt_response_revisions').ifExists().execute();
  await db.schema.dropTable('attempt_responses').ifExists().execute();
}
