/**
 * Deborah — Migration 018: Uch-strike Client Collector & Server Classifier
 *
 * Prompt 34 — visibility/fullscreen incidentlarini dedupe qilib THIRD strike'da
 * server termination (research.md §31 — Proctor evidence engine: raw event →
 * policy classification → academic decision; uch layer ajratiladi).
 *
 *   - proctor_events: append-only raw event log per attempt. UNIQUE
 *     (tenant, attempt, device, client_seq) → client retry idempotent.
 *     Har event: client_seq (monotonic per attempt+device), event_type
 *     (visibility_hidden | fullscreen_exit | blur | network_offline |
 *     camera_failure), started_at (client), duration_ms, device_id.
 *   - Evidence integrity (§31.5): append-only; har event SHA-256 hash chain —
 *     `hash_i = H(hash_{i-1} || canonical_event_i)` — object evidence
 *     tamper-proof per attempt.
 *   - Classification (server-side): confirmed focus-loss strike faqat
 *     threshold (2000ms) + dedupe (overlap / 5000ms window) dan keyin;
 *     blur O'ZI strike EMAS, network/camera failure strike EMAS (§15 —
 *     technical/accommodation exclusions).
 *   - Strike state: warning 1 → warning 2 → terminate 3 (server-side
 *     transition, third strike'da attempt terminated).
 *   - Reopen: yangi epoch (teacher reopen) — eski epoch'li event'lar reject.
 *
 * Rollback: table down() orqali o'chiriladi.
 */

import { sql } from 'kysely';

/**
 * @param {import('kysely').Kysely<any>} db
 */
export async function up(db) {
  await db.schema
    .createTable('proctor_events')
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
    .addColumn('client_seq', 'integer', (col) => col.notNull())
    // Monotonic per (attempt, device) — client retry idempotency
    .addColumn('event_type', 'varchar(40)', (col) => col.notNull())
    // visibility_hidden | fullscreen_exit | blur | network_offline | camera_failure
    .addColumn('started_at', 'timestamptz', (col) => col.notNull())
    // Client-claimed start (raw evidence only — never the verdict)
    .addColumn('duration_ms', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('device_id', 'varchar(160)', (col) => col.notNull())
    .addColumn('epoch', 'integer', (col) => col.notNull().defaultTo(1))
    // Attempt epoch — old-epoch events (pre-reopen) are rejected
    .addColumn('prev_hash', 'varchar(64)', (col) => col.defaultTo(null))
    // Hash chain: hash_i = H(hash_{i-1} || canonical_event_i) — §31.5
    .addColumn('event_hash', 'varchar(64)', (col) => col.notNull())
    .addColumn('classification', 'jsonb', (col) => col.defaultTo('{}'))
    // { confirmed, strike, reason, deduped_with, threshold_ms }
    .addColumn('strike_level', 'varchar(20)', (col) => col.defaultTo(null))
    // null | warning_1 | warning_2 | terminated — server-computed
    .addColumn('server_received_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(db.fn.now())
    )
    // Server receive timestamp is authoritative for the timeline (§31.5)
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(db.fn.now()))
    .execute();

  // Idempotent client retry: one row per (attempt, device, client_seq).
  await sql`
    CREATE UNIQUE INDEX uq_proctor_attempt_device_seq
    ON proctor_events (tenant_id, attempt_id, device_id, client_seq)
  `.execute(db);

  // Strike escalation queries: confirmed strikes for an attempt.
  await sql`
    CREATE INDEX idx_proctor_attempt_confirmed
    ON proctor_events (tenant_id, attempt_id)
    WHERE classification->>'confirmed' = 'true'
  `.execute(db);

  await db.schema
    .createIndex('idx_proctor_attempt_epoch')
    .on('proctor_events')
    .columns(['attempt_id', 'epoch'])
    .execute();

  // ── Grants ──
  await sql`GRANT SELECT, INSERT ON proctor_events TO deborah_runtime`.execute(db);
  await sql`GRANT USAGE ON proctor_events_id_seq TO deborah_runtime`.execute(db);
  await sql`GRANT DELETE ON proctor_events TO deborah_migration`.execute(db);
  await sql`GRANT SELECT ON proctor_events TO deborah_scoring`.execute(db);

  // ── Attempt epoch column (teacher reopen — Prompt 34 §14) ──
  // Prompt 32 residual: attempts jadvalida epoch ustuni yo'q edi; reopen uchun
  // zarur. Old-epoch proctor events va offline journal entries reject qilinadi.
  await sql`ALTER TABLE attempts ADD COLUMN IF NOT EXISTS epoch integer NOT NULL DEFAULT 1`.execute(db);

  console.log('Proctor event structure created: proctor_events (hash chain + classification) + attempts.epoch');
}

/**
 * @param {import('kysely').Kysely<any>} db
 */
export async function down(db) {
  await db.schema.dropTable('proctor_events').ifExists().execute();
}
