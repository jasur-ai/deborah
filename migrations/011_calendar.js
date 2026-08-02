/**
 * Edikit — Migration 011: Program Calendar & Workload
 *
 * Program-level scheduling to manage student deadline, effort, marker and
 * feedback collisions (Prompt 26):
 *   - program_events: calendar entries (summative/formative/deadline/feedback)
 *     with student effort minutes + marker/moderation minutes workload fields
 *   - program_event_cohorts: event → cohort (group) links used for
 *     same-cohort deadline queries and hard clash detection
 *   - event_notifications: outbox for ICS/timezone/date-change notification flow
 *
 * Key design:
 *   - Dates are NEVER auto-published — publish is an explicit coordinator
 *     action gated by hard-clash-zero validation (calendar.service publishEvent)
 *   - timezone stored per event (IANA name, default Asia/Tashkent)
 *   - external_key unique column provides write idempotency
 *   - AI guard: workload fields are objective effort/capacity minutes only —
 *     no stress/emotion inference is stored or derived anywhere
 *
 * Rollback: All tables droppable via down().
 */

import { sql } from 'kysely';

/**
 * @param {import('kysely').Kysely<any>} db
 */
export async function up(db) {
  // ── 1. Program Events (calendar entries) ──
  await db.schema
    .createTable('program_events')
    .addColumn('id', 'serial', (col) => col.primaryKey())
    .addColumn('tenant_id', 'integer', (col) =>
      col.references('tenants.id').onDelete('cascade').notNull()
    )
    .addColumn('term_id', 'integer', (col) =>
      col.references('academic_terms.id').onDelete('set null')
    )
    .addColumn('offering_id', 'integer', (col) =>
      col.references('course_offerings.id').onDelete('set null')
    )
    .addColumn('assessment_id', 'integer', (col) =>
      col.references('assessments.id').onDelete('set null')
    )
    .addColumn('brief_id', 'integer', (col) =>
      col.references('assessment_briefs.id').onDelete('set null')
    )
    .addColumn('policy_pack_id', 'integer', (col) =>
      col.references('policy_packs.id').onDelete('set null')
    )
    .addColumn('title', 'varchar(500)', (col) => col.notNull())
    .addColumn('event_type', 'varchar(30)', (col) => col.notNull())
    // summative | formative | deadline | feedback_window | other
    .addColumn('status', 'varchar(20)', (col) => col.notNull().defaultTo('draft'))
    // draft | scheduled | published | archived
    .addColumn('start_at', 'timestamptz', (col) => col.notNull())
    .addColumn('end_at', 'timestamptz', (col) => col.notNull())
    .addColumn('timezone', 'varchar(64)', (col) => col.notNull().defaultTo('Asia/Tashkent'))
    // IANA timezone name (e.g. Asia/Tashkent)
    .addColumn('student_effort_minutes', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('marker_minutes', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('moderation_minutes', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('marker_user_id', 'integer', (col) =>
      col.references('users.id').onDelete('set null')
    )
    .addColumn('moderator_user_id', 'integer', (col) =>
      col.references('users.id').onDelete('set null')
    )
    .addColumn('room_id', 'varchar(100)')
    .addColumn('requires_feedback_from_event_id', 'integer', (col) =>
      col.references('program_events.id').onDelete('set null')
    )
    // feedback-before-next-task dependency (source event whose feedback must land first)
    .addColumn('external_key', 'varchar(120)')
    // Idempotency: client-generated unique key — duplicate create returns existing row
    .addColumn('published_at', 'timestamptz')
    .addColumn('published_by', 'integer', (col) =>
      col.references('users.id').onDelete('set null')
    )
    .addColumn('created_by', 'integer', (col) =>
      col.references('users.id').onDelete('set null')
    )
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(db.fn.now()))
    .addColumn('updated_at', 'timestamptz', (col) => col.notNull().defaultTo(db.fn.now()))
    .execute();

  await db.schema
    .createIndex('idx_program_events_tenant_status')
    .on('program_events')
    .columns(['tenant_id', 'status'])
    .execute();

  await db.schema
    .createIndex('idx_program_events_term')
    .on('program_events')
    .columns(['term_id', 'start_at'])
    .execute();

  await db.schema
    .createIndex('idx_program_events_external_key')
    .on('program_events')
    .columns(['tenant_id', 'external_key'])
    .execute();

  // ── 2. Event → Cohort links (same-cohort queries & hard clash detection) ──
  await db.schema
    .createTable('program_event_cohorts')
    .addColumn('id', 'serial', (col) => col.primaryKey())
    .addColumn('event_id', 'integer', (col) =>
      col.references('program_events.id').onDelete('cascade').notNull()
    )
    .addColumn('tenant_id', 'integer', (col) =>
      col.references('tenants.id').onDelete('cascade').notNull()
    )
    .addColumn('group_id', 'integer', (col) =>
      col.references('groups.id').onDelete('cascade').notNull()
    )
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(db.fn.now()))
    .execute();

  await db.schema
    .createIndex('idx_event_cohorts_event')
    .on('program_event_cohorts')
    .columns(['event_id'])
    .execute();

  await db.schema
    .createIndex('idx_event_cohorts_group')
    .on('program_event_cohorts')
    .columns(['group_id', 'event_id'])
    .execute();

  await db.schema
    .createIndex('uq_event_cohorts_pair', { unique: true })
    .on('program_event_cohorts')
    .columns(['event_id', 'group_id'])
    .execute();

  // ── 3. Event Notifications (ICS/timezone/date-change outbox) ──
  await db.schema
    .createTable('event_notifications')
    .addColumn('id', 'serial', (col) => col.primaryKey())
    .addColumn('tenant_id', 'integer', (col) =>
      col.references('tenants.id').onDelete('cascade').notNull()
    )
    .addColumn('event_id', 'integer', (col) =>
      col.references('program_events.id').onDelete('cascade').notNull()
    )
    .addColumn('change_type', 'varchar(30)', (col) => col.notNull())
    // created | updated | date_changed | cancelled | published
    .addColumn('recipient_scope', 'varchar(30)', (col) => col.notNull().defaultTo('cohort'))
    // cohort | markers | moderators | all
    .addColumn('payload', 'jsonb', (col) => col.defaultTo('{}'))
    // { old_start, new_start, old_end, new_end, title, timezone }
    .addColumn('status', 'varchar(20)', (col) => col.notNull().defaultTo('pending'))
    // pending | sent | failed
    .addColumn('idempotency_key', 'varchar(200)')
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(db.fn.now()))
    .execute();

  await db.schema
    .createIndex('idx_event_notifications_event')
    .on('event_notifications')
    .columns(['event_id', 'change_type'])
    .execute();

  await db.schema
    .createIndex('idx_event_notifications_key')
    .on('event_notifications')
    .columns(['tenant_id', 'idempotency_key'])
    .execute();

  // ── Grant permissions ──
  const newTables = ['program_events', 'program_event_cohorts', 'event_notifications'];
  for (const table of newTables) {
    await sql`GRANT SELECT, INSERT, UPDATE ON ${sql.table(table)} TO edikit_runtime`.execute(db);
    await sql`GRANT USAGE ON ${sql.table(table)}_id_seq TO edikit_runtime`.execute(db);
    await sql`GRANT DELETE ON ${sql.table(table)} TO edikit_migration`.execute(db);
  }

  console.log('Calendar/Workload structure created: 3 tables');
}

/**
 * @param {import('kysely').Kysely<any>} db
 */
export async function down(db) {
  await db.schema.dropTable('event_notifications').ifExists().execute();
  await db.schema.dropTable('program_event_cohorts').ifExists().execute();
  await db.schema.dropTable('program_events').ifExists().execute();
}
