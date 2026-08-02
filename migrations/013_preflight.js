/**
 * Edikit — Migration 013: Student Assignment List, Brief & Preflight
 *
 * Student-facing readiness flow (Prompt 28):
 *   - preflight_checks: one row per (assignment, student, day) holding the
 *     FULL preflight result contract — roster authorization, availability
 *     window, sanitized brief/policy render, accommodation confirmation,
 *     practice status, browser/device/network checks, camera/SEB hook and
 *     the computed start eligibility + blocker list.
 *
 * Key design:
 *   - Roster authorization is snapshot-based: membership is checked against
 *     the PUBLISHED assignment_roster_members snapshot (Prompt 27), never
 *     silently re-synced with the live roster (Prompt 28 §24 stop condition).
 *   - The brief/policy render stored here is SANITIZED (whitelist) — answer
 *     keys or any other student data never reach the student surface
 *     (Prompt 28 §15 data guard).
 *   - Idempotency: UNIQUE (tenant_id, assignment_id, user_id, external_key)
 *     — re-running the same day's preflight returns the existing row.
 *   - Eligible = all requirements met; blockers list shown to student before
 *     start (Prompt 28 §25 done condition).
 *
 * Rollback: table droppable via down().
 */

import { sql } from 'kysely';

/**
 * @param {import('kysely').Kysely<any>} db
 */
export async function up(db) {
  await db.schema
    .createTable('preflight_checks')
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
    // Publish idempotency: assignment + user + day
    .addColumn('status', 'varchar(20)', (col) => col.notNull().defaultTo('pending'))
    // pending | passed | blocked
    .addColumn('eligible', 'boolean', (col) => col.notNull().defaultTo(false))
    .addColumn('result', 'jsonb', (col) => col.defaultTo('{}'))
    // { eligible, blockers[], warnings[], eligible_at } — full contract
    .addColumn('availability', 'jsonb', (col) => col.defaultTo('{}'))
    // { status: not_started|open|closed|unscheduled, window:{start,end}, now }
    .addColumn('roster', 'jsonb', (col) => col.defaultTo('{}'))
    // { in_snapshot, snapshot_count }
    .addColumn('brief', 'jsonb', (col) => col.defaultTo('{}'))
    // { available, version, sanitized_content } — whitelist render
    .addColumn('policy', 'jsonb', (col) => col.defaultTo('{}'))
    // { available, version, security, late, resit, ai_use } — whitelist render
    .addColumn('accommodation', 'jsonb', (col) => col.defaultTo('{}'))
    // { required, confirmed, effective_config, snapshot_count }
    .addColumn('practice', 'jsonb', (col) => col.defaultTo('{}'))
    // { required, completed, progress, description }
    .addColumn('device', 'jsonb', (col) => col.defaultTo('{}'))
    // { ok, checks:[{name,ok,detail}] } — browser/screen/network
    .addColumn('security', 'jsonb', (col) => col.defaultTo('{}'))
    // { camera_required, seb_required, camera_ok, seb_ok, checks }
    .addColumn('blockers', 'jsonb', (col) => col.defaultTo('[]'))
    // [{ code, message }]
    .addColumn('client_info', 'jsonb', (col) => col.defaultTo('{}'))
    // Raw browser/device/network hints submitted by the student app
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(db.fn.now()))
    .execute();

  // Idempotency — same assignment + user + day → single row
  await sql`
    CREATE UNIQUE INDEX uq_preflight_assignment_user_key
    ON preflight_checks (tenant_id, assignment_id, user_id, external_key)
  `.execute(db);

  await db.schema
    .createIndex('idx_preflight_user_assignments')
    .on('preflight_checks')
    .columns(['user_id', 'assignment_id'])
    .execute();

  await db.schema
    .createIndex('idx_preflight_assignments')
    .on('preflight_checks')
    .columns(['assignment_id', 'status'])
    .execute();

  // ── Grants ──
  await sql`GRANT SELECT, INSERT, UPDATE ON preflight_checks TO edikit_runtime`.execute(db);
  await sql`GRANT USAGE ON preflight_checks_id_seq TO edikit_runtime`.execute(db);
  await sql`GRANT DELETE ON preflight_checks TO edikit_migration`.execute(db);
  await sql`GRANT SELECT ON preflight_checks TO edikit_scoring`.execute(db);

  console.log('Student preflight structure created: preflight_checks');
}

/**
 * @param {import('kysely').Kysely<any>} db
 */
export async function down(db) {
  await db.schema.dropTable('preflight_checks').ifExists().execute();
}
