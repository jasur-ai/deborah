/**
 * Edikit — Migration 029: Board Ratification, Result Release & Grade Ledger
 * (Prompt 47)
 *
 * Prompt 47 — provisional markni authorized board orqali immutable final
 * resultga aylantirish (research.md §49 "Raw, moderated, provisional va
 * ratified final grade alohida saqlanadi; final result faqat authorized
 * board/workflow va immutable change ledger orqali chiqadi", §67.1
 * lifecycle steps 14–16: Provisional result → Board/authorized
 * ratification → Final release and feedback):
 *
 *   - board_roles: institution/assessment board member roles (chair,
 *     secretary, member, external) — who is allowed to ratify.
 *   - board_meetings: a ratification session for an assessment/cohort —
 *     status lifecycle (scheduled → open → ratified | rejected), quorum
 *     policy snapshot (required quorum, required approval ratio).
 *   - board_attendees: who attended, with conflict declaration (a member
 *     with a conflict cannot vote) — quorum is computed from NON-conflicted
 *     attendees.
 *   - board_decisions: the ACTUAL ratification — links a provisional
 *     grade_calculation_run to an immutable ratified final result with a
 *     gradebook snapshot hash. Once ratified, the run's final grade is
 *     FROZEN (no direct UPDATE — release/amendment only via ledger).
 *   - grade_amendments: APPEND-ONLY immutable change ledger — any change
 *     to a ratified grade (regrade, error correction, appeal outcome) is a
 *     NEW amendment row; old rows are never updated (change history).
 *   - sis_outbox: SIS/HEMIS integration outbox — release batches enqueue
 *     here; reconciliation marks them sent/acknowledged (idempotent by
 *     external_key). Ratification'siz release yo'q (§15).
 *
 * SECURITY / DATA GUARD (Prompt 47 §15-17, research.md §16.1):
 *   - Ratified final grade hech qachon direct UPDATE bilan overwrite
 *     qilinmaydi — faqat ledger amendment orqali o'zgaradi.
 *   - release faqat ratified decision bilan ishlaydi.
 *   - Har bir write path tenant-scoped + idempotent (UNIQUE indexlar).
 *   - Privileged actionlar (ratify/release/amend) audit qilinadi.
 */

import { sql } from 'kysely';

/**
 * @param {import('kysely').Kysely<any>} db
 */
export async function up(db) {
  // ── 1. board_roles — who can sit on a ratification board ──
  await db.schema
    .createTable('board_roles')
    .addColumn('id', 'serial', (col) => col.primaryKey())
    .addColumn('tenant_id', 'integer', (col) =>
      col.references('tenants.id').onDelete('cascade').notNull()
    )
    .addColumn('user_id', 'integer', (col) =>
      col.references('users.id').onDelete('cascade').notNull()
    )
    .addColumn('role', 'varchar(16)', (col) => col.notNull())
    // chair | secretary | member | external
    .addColumn('status', 'varchar(12)', (col) => col.notNull().defaultTo('active'))
    // active | inactive
    .addColumn('created_by', 'integer')
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(db.fn.now()))
    .execute();

  await sql`
    CREATE UNIQUE INDEX uq_board_role_user
    ON board_roles (tenant_id, user_id, role)
  `.execute(db);
  await db.schema
    .createIndex('idx_board_roles_tenant')
    .on('board_roles')
    .columns(['tenant_id', 'status'])
    .execute();

  // ── 2. board_meetings — a ratification session ──
  await db.schema
    .createTable('board_meetings')
    .addColumn('id', 'serial', (col) => col.primaryKey())
    .addColumn('tenant_id', 'integer', (col) =>
      col.references('tenants.id').onDelete('cascade').notNull()
    )
    .addColumn('assessment_id', 'integer', (col) =>
      col.references('assessments.id').onDelete('cascade')
    )
    .addColumn('course_offering_id', 'integer', (col) =>
      col.references('course_offerings.id').onDelete('cascade')
    )
    .addColumn('title', 'varchar(255)', (col) => col.notNull())
    .addColumn('status', 'varchar(12)', (col) => col.notNull().defaultTo('scheduled'))
    // scheduled → open → ratified | rejected
    .addColumn('required_quorum', 'integer', (col) => col.notNull().defaultTo(3))
    .addColumn('required_approval_ratio', 'decimal(4,3)', (col) => col.notNull().defaultTo(0.6))
    .addColumn('policy_snapshot', 'jsonb', (col) => col.defaultTo('{}'))
    // { holdingGrade, releasePolicy, maxAmendmentsPerRun }
    .addColumn('held_at', 'timestamptz')
    .addColumn('closed_at', 'timestamptz')
    .addColumn('created_by', 'integer')
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(db.fn.now()))
    .execute();

  await db.schema
    .createIndex('idx_board_meetings_status')
    .on('board_meetings')
    .columns(['tenant_id', 'status'])
    .execute();

  // ── 3. board_attendees — who attended + conflict declaration ──
  await db.schema
    .createTable('board_attendees')
    .addColumn('id', 'serial', (col) => col.primaryKey())
    .addColumn('tenant_id', 'integer', (col) =>
      col.references('tenants.id').onDelete('cascade').notNull()
    )
    .addColumn('meeting_id', 'integer', (col) =>
      col.references('board_meetings.id').onDelete('cascade').notNull()
    )
    .addColumn('user_id', 'integer', (col) =>
      col.references('users.id').onDelete('cascade').notNull()
    )
    .addColumn('role', 'varchar(16)', (col) => col.notNull())
    .addColumn('attended', 'boolean', (col) => col.notNull().defaultTo(false))
    .addColumn('conflict_declared', 'boolean', (col) => col.notNull().defaultTo(false))
    .addColumn('conflict_reason', 'varchar(500)')
    .addColumn('vote', 'varchar(8)')
    // approve | reject | abstain
    .addColumn('voted_at', 'timestamptz')
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(db.fn.now()))
    .execute();

  await sql`
    CREATE UNIQUE INDEX uq_board_attendee
    ON board_attendees (tenant_id, meeting_id, user_id)
  `.execute(db);

  // ── 4. board_decisions — the ratification itself (immutable) ──
  await db.schema
    .createTable('board_decisions')
    .addColumn('id', 'serial', (col) => col.primaryKey())
    .addColumn('tenant_id', 'integer', (col) =>
      col.references('tenants.id').onDelete('cascade').notNull()
    )
    .addColumn('meeting_id', 'integer', (col) =>
      col.references('board_meetings.id').onDelete('cascade').notNull()
    )
    .addColumn('run_id', 'integer', (col) =>
      col.references('grade_calculation_runs.id').onDelete('cascade').notNull()
    )
    .addColumn('user_id', 'integer', (col) =>
      col.references('users.id').onDelete('cascade').notNull()
    )
    .addColumn('provisional_final', 'decimal(8,2)', (col) => col.notNull())
    .addColumn('grade_label', 'varchar(4)')
    .addColumn('ratified_final', 'decimal(8,2)')
    // set on approval — the FROZEN final grade
    .addColumn('snapshot_hash', 'varchar(64)', (col) => col.notNull())
    // deterministic sha256 of gradebook snapshot (immutable evidence)
    .addColumn('decision', 'varchar(10)', (col) => col.notNull())
    // ratified | rejected
    .addColumn('decided_by', 'integer')
    .addColumn('decided_at', 'timestamptz', (col) => col.notNull().defaultTo(db.fn.now()))
    .execute();

  await sql`
    CREATE UNIQUE INDEX uq_board_decision_run
    ON board_decisions (tenant_id, run_id)
  `.execute(db);
  await db.schema
    .createIndex('idx_board_decisions_meeting')
    .on('board_decisions')
    .columns(['tenant_id', 'meeting_id'])
    .execute();

  // ── 5. grade_amendments — APPEND-ONLY immutable change ledger ──
  await db.schema
    .createTable('grade_amendments')
    .addColumn('id', 'serial', (col) => col.primaryKey())
    .addColumn('tenant_id', 'integer', (col) =>
      col.references('tenants.id').onDelete('cascade').notNull()
    )
    .addColumn('run_id', 'integer', (col) =>
      col.references('grade_calculation_runs.id').onDelete('cascade').notNull()
    )
    .addColumn('amendment_no', 'integer', (col) => col.notNull())
    .addColumn('old_final', 'decimal(8,2)', (col) => col.notNull())
    .addColumn('new_final', 'decimal(8,2)', (col) => col.notNull())
    .addColumn('reason', 'varchar(1000)', (col) => col.notNull())
    .addColumn('changed_by', 'integer')
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(db.fn.now()))
    .execute();

  await sql`
    CREATE UNIQUE INDEX uq_grade_amendment
    ON grade_amendments (tenant_id, run_id, amendment_no)
  `.execute(db);

  // ── 6. sis_outbox — SIS/HEMIS release outbox (idempotent reconcile) ──
  await db.schema
    .createTable('sis_outbox')
    .addColumn('id', 'serial', (col) => col.primaryKey())
    .addColumn('tenant_id', 'integer', (col) =>
      col.references('tenants.id').onDelete('cascade').notNull()
    )
    .addColumn('decision_id', 'integer', (col) =>
      col.references('board_decisions.id').onDelete('cascade').notNull()
    )
    .addColumn('run_id', 'integer', (col) =>
      col.references('grade_calculation_runs.id').onDelete('cascade').notNull()
    )
    .addColumn('user_id', 'integer', (col) =>
      col.references('users.id').onDelete('cascade').notNull()
    )
    .addColumn('external_key', 'varchar(160)', (col) => col.notNull())
    // idempotency key — tenant + run + version
    .addColumn('payload', 'jsonb', (col) => col.notNull())
    .addColumn('status', 'varchar(12)', (col) => col.notNull().defaultTo('pending'))
    // pending → sent → reconciled | failed
    .addColumn('attempts', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('last_error', 'varchar(1000)')
    .addColumn('sent_at', 'timestamptz')
    .addColumn('reconciled_at', 'timestamptz')
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(db.fn.now()))
    .execute();

  await sql`
    CREATE UNIQUE INDEX uq_sis_outbox_key
    ON sis_outbox (tenant_id, external_key)
  `.execute(db);
  await db.schema
    .createIndex('idx_sis_outbox_status')
    .on('sis_outbox')
    .columns(['tenant_id', 'status'])
    .execute();

  // ── Grants (sql-template pattern) ──
  const newTables = [
    'board_roles',
    'board_meetings',
    'board_attendees',
    'board_decisions',
    'grade_amendments',
    'sis_outbox',
  ];
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
  const tables = [
    'sis_outbox',
    'grade_amendments',
    'board_decisions',
    'board_attendees',
    'board_meetings',
    'board_roles',
  ];
  for (const table of tables) {
    await db.schema.dropTable(table).ifExists().execute();
  }
}
