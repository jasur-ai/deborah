/**
 * Edikit — Migration 017: Submit Sealing va Signed Receipt
 *
 * Prompt 33 — pending response'larni sync qilib attemptni IMMUTABLE submit
 * qilish (research.md §29.5 end-of-exam failsafe, §5 lifecycle):
 *   - attempt_seals: bitta attempt uchun EXACTLY ONE seal. UNIQUE attempt_id
 *     → ikkinchi submit mumkin emas (double-submit / duplicate scoring job
 *     strukturaviy imkonsiz — §15). Saqlanadi: submission_hash (final response
 *     snapshot ustidan), response_count, snapshot jsonb (immutable), sealed_at.
 *   - scoring_outbox: scoring/auto-grading job queue. UNIQUE attempt_id →
 *     bitta attempt uchun faqat bitta job enqueue bo'ladi (duplicate job
 *     himoyasi). status: pending | enqueued | processed | failed.
 *
 * Security / data guard (Prompt 33 §15):
 *   - Seal yaratilgandan keyin later mutation REJECT qilinadi — attempt
 *     status submitted + response service window check (ends_at o'tgan) ikki
 *     qatlamli himoya; qo'shimcha ravishda submit.service da post-submit
 *     mutation tekshiruvi.
 *   - Receipt HMAC bilan imzolanadi (server secret) — student verifiable
 *     receipt oladi, lekin uni o'zgartira olmaydi (imzo buziladi).
 *   - Snapshot/hash server tomonda yaratiladi — client hech qachon o'z hash'ini
 *     yoki summary'sini yuborolmaydi (server recompute qiladi).
 *
 * Rollback: ikkala jadval down() orqali o'chiriladi.
 */

import { sql } from 'kysely';

/**
 * @param {import('kysely').Kysely<any>} db
 */
export async function up(db) {
  // ── 1. attempt_seals — immutable submission record ──
  await db.schema
    .createTable('attempt_seals')
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
    .addColumn('submission_hash', 'varchar(64)', (col) => col.notNull())
    // sha256 over the canonical final response snapshot
    .addColumn('response_count', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('completeness', 'jsonb', (col) => col.defaultTo('{}'))
    // { answered, unanswered, total, percent, items[] } — server-computed
    .addColumn('snapshot', 'jsonb', (col) => col.defaultTo('{}'))
    // IMMUTABLE final response snapshot (all items + latest accepted seq +
    // payload values — self-contained for audit/reopen)
    .addColumn('receipt', 'jsonb', (col) => col.defaultTo(null))
    // { signature, body } — HMAC-SHA256 signed receipt, written ATOMICALLY
    // inside the seal INSERT (no post-commit race)
    .addColumn('sealed_at', 'timestamptz', (col) => col.notNull().defaultTo(db.fn.now()))
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(db.fn.now()))
    .execute();

  // EXACTLY ONE seal per attempt — a second submit is a no-op (idempotent).
  await sql`
    CREATE UNIQUE INDEX uq_attempt_seal
    ON attempt_seals (tenant_id, attempt_id)
  `.execute(db);

  await db.schema
    .createIndex('idx_attempt_seal_user')
    .on('attempt_seals')
    .columns(['tenant_id', 'user_id'])
    .execute();

  // ── 2. scoring_outbox — scoring/auto-grade job queue (at-least-once) ──
  await db.schema
    .createTable('scoring_outbox')
    .addColumn('id', 'serial', (col) => col.primaryKey())
    .addColumn('tenant_id', 'integer', (col) =>
      col.references('tenants.id').onDelete('cascade').notNull()
    )
    .addColumn('attempt_id', 'integer', (col) =>
      col.references('attempts.id').onDelete('cascade').notNull()
    )
    .addColumn('seal_id', 'integer', (col) =>
      col.references('attempt_seals.id').onDelete('cascade').notNull()
    )
    .addColumn('status', 'varchar(20)', (col) => col.notNull().defaultTo('pending'))
    // pending | enqueued | processed | failed
    .addColumn('payload', 'jsonb', (col) => col.defaultTo('{}'))
    // { submission_hash, response_count, sealed_at }
    .addColumn('attempted_at', 'timestamptz', (col) => col.defaultTo(null))
    .addColumn('processed_at', 'timestamptz', (col) => col.defaultTo(null))
    .addColumn('error', 'varchar(500)')
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(db.fn.now()))
    .execute();

  // UNIQUE attempt_id → duplicate scoring job is IMPOSSIBLE (Prompt 33 §15:
  // double submit never creates a duplicate score/job).
  await sql`
    CREATE UNIQUE INDEX uq_scoring_outbox_attempt
    ON scoring_outbox (tenant_id, attempt_id)
  `.execute(db);

  await db.schema
    .createIndex('idx_scoring_outbox_status')
    .on('scoring_outbox')
    .columns(['status', 'created_at'])
    .execute();

  // ── Grants ──
  await sql`GRANT SELECT, INSERT, UPDATE ON attempt_seals TO edikit_runtime`.execute(db);
  await sql`GRANT USAGE ON attempt_seals_id_seq TO edikit_runtime`.execute(db);
  await sql`GRANT SELECT, INSERT, UPDATE ON scoring_outbox TO edikit_runtime`.execute(db);
  await sql`GRANT USAGE ON scoring_outbox_id_seq TO edikit_runtime`.execute(db);
  await sql`GRANT DELETE ON attempt_seals TO edikit_migration`.execute(db);
  await sql`GRANT DELETE ON scoring_outbox TO edikit_migration`.execute(db);
  await sql`GRANT SELECT ON attempt_seals TO edikit_scoring`.execute(db);
  await sql`GRANT SELECT, UPDATE ON scoring_outbox TO edikit_scoring`.execute(db);

  console.log('Submit sealing structure created: attempt_seals, scoring_outbox');
}

/**
 * @param {import('kysely').Kysely<any>} db
 */
export async function down(db) {
  await db.schema.dropTable('scoring_outbox').ifExists().execute();
  await db.schema.dropTable('attempt_seals').ifExists().execute();
}
