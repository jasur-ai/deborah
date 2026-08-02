/**
 * Edikit — Migration 014: Attempt Lease, Identity Step & Server Timer
 *
 * Secure attempt start (Prompt 30 — Phase D #1):
 *   - attempts: one row per authorized student attempt, pinned to the EXACT
 *     published assignment version (version_hash), with server-authoritative
 *     started_at/ends_at. The client clock, a display timer or a join code
 *     is NEVER authoritative (Prompt 30 §15).
 *   - attempt_devices: capability attestation captured at start (browser,
 *     screen, network, camera, SEB) for the proctoring evidence chain.
 *   - attempt_leases: atomic single-writer lease. A PARTIAL UNIQUE index on
 *     (tenant, assignment, user) WHERE status='active' guarantees at most one
 *     live attempt per assignment+user — the parallel-session stop condition
 *     (§24). A concurrent second start fails on the index (23505) and is
 *     reported as parallel_session_denied.
 *
 * Key design:
 *   - Idempotency: UNIQUE (tenant_id, external_key) — same assignment+user+day
 *     re-start returns the existing attempt (duplicate: true).
 *   - Authorization: the service gates on the PUBLISHED roster snapshot
 *     (Prompt 28) + a PASSED preflight before any lease is acquired.
 *   - Server timer: ends_at = started_at + base_duration + accommodation
 *     extra_time, computed on the server at start time.
 *   - Content package: public item snapshots only (allowlist already applied
 *     at publish; the package is rebuilt from assignment_public_items).
 *
 * Rollback: all three tables droppable via down().
 */

import { sql } from 'kysely';

/**
 * @param {import('kysely').Kysely<any>} db
 */
export async function up(db) {
  // ── 1. attempts ──
  await db.schema
    .createTable('attempts')
    .addColumn('id', 'serial', (col) => col.primaryKey())
    .addColumn('tenant_id', 'integer', (col) =>
      col.references('tenants.id').onDelete('cascade').notNull()
    )
    .addColumn('assignment_id', 'integer', (col) =>
      col.references('assessment_assignments.id').onDelete('cascade').notNull()
    )
    .addColumn('user_id', 'integer', (col) =>
      col.references('users.id').onDelete('cascade').notNull()
    )
    .addColumn('external_key', 'varchar(160)')
    // Idempotency: assignment + user + day (see deriveAttemptKey)
    .addColumn('status', 'varchar(20)', (col) => col.notNull().defaultTo('ready'))
    // ready | in_progress | submitted | terminated
    .addColumn('version_hash', 'varchar(64)')
    // Exact published assignment version the attempt is pinned to
    .addColumn('base_duration_minutes', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('extra_time_minutes', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('total_minutes', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('identity_level_required', 'varchar(20)')
    // none | password | google | passkey (from policy security profile)
    .addColumn('identity_level_achieved', 'varchar(20)')
    .addColumn('started_at', 'timestamptz')
    // Server-authoritative start — NOT the client clock
    .addColumn('ends_at', 'timestamptz')
    // Server-authoritative end = started_at + base + extra
    .addColumn('submitted_at', 'timestamptz')
    .addColumn('content_package', 'jsonb', (col) => col.defaultTo('{}'))
    // Public item snapshots only (no private keys, ever)
    .addColumn('client_info', 'jsonb', (col) => col.defaultTo('{}'))
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(db.fn.now()))
    .addColumn('updated_at', 'timestamptz', (col) => col.notNull().defaultTo(db.fn.now()))
    .execute();

  // Idempotency: one attempt per assignment + user + day
  await sql`
    CREATE UNIQUE INDEX uq_attempt_external_key
    ON attempts (tenant_id, external_key)
  `.execute(db);

  await db.schema
    .createIndex('idx_attempts_assignment_user')
    .on('attempts')
    .columns(['assignment_id', 'user_id'])
    .execute();

  await db.schema
    .createIndex('idx_attempts_user_status')
    .on('attempts')
    .columns(['user_id', 'status'])
    .execute();

  // ── 2. attempt_devices (capability attestation at start) ──
  await db.schema
    .createTable('attempt_devices')
    .addColumn('id', 'serial', (col) => col.primaryKey())
    .addColumn('tenant_id', 'integer', (col) =>
      col.references('tenants.id').onDelete('cascade').notNull()
    )
    .addColumn('attempt_id', 'integer', (col) =>
      col.references('attempts.id').onDelete('cascade').notNull()
    )
    .addColumn('user_agent', 'text')
    .addColumn('screen_width', 'integer')
    .addColumn('screen_height', 'integer')
    .addColumn('online', 'boolean')
    .addColumn('connection_type', 'varchar(30)')
    .addColumn('camera_available', 'boolean')
    .addColumn('seb_present', 'boolean')
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(db.fn.now()))
    .execute();

  await db.schema
    .createIndex('idx_attempt_devices_attempt')
    .on('attempt_devices')
    .columns(['attempt_id'])
    .execute();

  // ── 3. attempt_leases (atomic single-writer lease) ──
  await db.schema
    .createTable('attempt_leases')
    .addColumn('id', 'serial', (col) => col.primaryKey())
    .addColumn('tenant_id', 'integer', (col) =>
      col.references('tenants.id').onDelete('cascade').notNull()
    )
    .addColumn('assignment_id', 'integer', (col) =>
      col.references('assessment_assignments.id').onDelete('cascade').notNull()
    )
    .addColumn('user_id', 'integer', (col) =>
      col.references('users.id').onDelete('cascade').notNull()
    )
    .addColumn('attempt_id', 'integer', (col) =>
      col.references('attempts.id').onDelete('cascade')
    )
    .addColumn('status', 'varchar(20)', (col) => col.notNull().defaultTo('active'))
    // active | released | expired
    .addColumn('acquired_at', 'timestamptz', (col) => col.notNull().defaultTo(db.fn.now()))
    .addColumn('expires_at', 'timestamptz')
    .addColumn('released_at', 'timestamptz')
    .execute();

  // Single-writer: at most ONE active lease per (assignment, user) — the
  // parallel-session stop condition (§24). A concurrent start violates this
  // partial unique index (23505) and is rejected atomically.
  await sql`
    CREATE UNIQUE INDEX uq_attempt_active_lease
    ON attempt_leases (tenant_id, assignment_id, user_id)
    WHERE status = 'active'
  `.execute(db);

  await db.schema
    .createIndex('idx_attempt_leases_user')
    .on('attempt_leases')
    .columns(['user_id'])
    .execute();

  // ── Grants ──
  await sql`GRANT SELECT, INSERT, UPDATE ON attempts TO edikit_runtime`.execute(db);
  await sql`GRANT USAGE ON attempts_id_seq TO edikit_runtime`.execute(db);
  await sql`GRANT SELECT, INSERT, UPDATE ON attempt_devices TO edikit_runtime`.execute(db);
  await sql`GRANT USAGE ON attempt_devices_id_seq TO edikit_runtime`.execute(db);
  await sql`GRANT SELECT, INSERT, UPDATE ON attempt_leases TO edikit_runtime`.execute(db);
  await sql`GRANT USAGE ON attempt_leases_id_seq TO edikit_runtime`.execute(db);
  await sql`GRANT DELETE ON attempts TO edikit_migration`.execute(db);
  await sql`GRANT DELETE ON attempt_leases TO edikit_migration`.execute(db);
  await sql`GRANT SELECT ON attempts TO edikit_scoring`.execute(db);

  console.log('Secure attempt structure created: attempts, attempt_devices, attempt_leases');
}

/**
 * @param {import('kysely').Kysely<any>} db
 */
export async function down(db) {
  await db.schema.dropTable('attempt_leases').ifExists().execute();
  await db.schema.dropTable('attempt_devices').ifExists().execute();
  await db.schema.dropTable('attempts').ifExists().execute();
}
