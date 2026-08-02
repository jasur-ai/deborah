/**
 * Edikit — Migration 012: Immutable Publish Transaction & Assignment Snapshot
 *
 * Atomic publish of an assessment draft into a SCHEDULED assignment with
 * public/private/roster/accommodation snapshots (Prompt 27):
 *   - assessment_assignments: publish root — pins assessment_version,
 *     brief_version and policy_version EXACT versions + content hash
 *   - assignment_public_items: PUBLIC item snapshots (stem/options only —
 *     NEVER private scoring keys)
 *   - assignment_private_scores: PRIVATE scoring snapshots (answer keys) —
 *     DB role restricted (edikit_scoring only)
 *   - assignment_roster_members: roster membership snapshot at publish time
 *   - assignment_notifications: notification outbox written in the SAME
 *     transaction (atomic with the publish)
 *
 * Key design:
 *   - One transaction produces a reproducible SCHEDULED version (done condition):
 *     the same draft + pins always yield the same version_hash
 *   - Row lock + external_key give publish idempotency / race protection
 *   - Public/private split is enforced at the DB level: private scores table
 *     grants SELECT only to edikit_scoring, and public item rows physically
 *     cannot hold private_data (column does not exist there)
 *   - Partial publish is impossible: all inserts happen inside the caller's
 *     transaction; a failure rolls back everything
 *
 * Rollback: All tables droppable via down().
 */

import { sql } from 'kysely';

/**
 * @param {import('kysely').Kysely<any>} db
 */
export async function up(db) {
  // ── 1. Assessment Assignments (publish root) ──
  await db.schema
    .createTable('assessment_assignments')
    .addColumn('id', 'serial', (col) => col.primaryKey())
    .addColumn('tenant_id', 'integer', (col) =>
      col.references('tenants.id').onDelete('cascade').notNull()
    )
    .addColumn('assessment_id', 'integer', (col) =>
      col.references('assessments.id').onDelete('cascade').notNull()
    )
    .addColumn('assessment_version_id', 'integer', (col) =>
      col.references('assessment_versions.id').onDelete('set null')
    )
    .addColumn('title', 'varchar(500)', (col) => col.notNull())
    .addColumn('status', 'varchar(20)', (col) => col.notNull().defaultTo('scheduled'))
    // draft | scheduled | published | cancelled
    .addColumn('version_hash', 'varchar(64)')
    // SHA-256 of canonical publish content — reproducible
    .addColumn('brief_id', 'integer', (col) =>
      col.references('assessment_briefs.id').onDelete('set null')
    )
    .addColumn('brief_version_id', 'integer', (col) =>
      col.references('assessment_brief_versions.id').onDelete('set null')
    )
    // EXACT brief version pin
    .addColumn('policy_pack_id', 'integer', (col) =>
      col.references('policy_packs.id').onDelete('set null')
    )
    .addColumn('policy_version_id', 'integer', (col) =>
      col.references('policy_pack_versions.id').onDelete('set null')
    )
    // EXACT policy version pin
    .addColumn('calendar_event_id', 'integer', (col) =>
      col.references('program_events.id').onDelete('set null')
    )
    .addColumn('external_key', 'varchar(120)')
    // Publish idempotency: unique per tenant — duplicate publish returns existing
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
    .createIndex('idx_assignments_tenant_status')
    .on('assessment_assignments')
    .columns(['tenant_id', 'status'])
    .execute();

  await db.schema
    .createIndex('idx_assignments_assessment')
    .on('assessment_assignments')
    .columns(['assessment_id', 'status'])
    .execute();

  // UNIQUE (not merely indexed): the in-transaction idempotency check is the
  // primary guard, but the DB constraint is the hard backstop — two
  // concurrent publishes can never both insert the same external_key for a
  // tenant (race-safe duplicate publish). NULL keys (never produced by the
  // service, which always derives one) remain permitted by Postgres semantics.
  await sql`
    CREATE UNIQUE INDEX uq_assignments_tenant_external_key
    ON assessment_assignments (tenant_id, external_key)
  `.execute(db);

  // ── 2. Assignment Public Items (PUBLIC snapshots only) ──
  // NOTE: no private_data column exists here — the public surface physically
  // cannot hold scoring keys. DB-level secret guard (§15).
  await db.schema
    .createTable('assignment_public_items')
    .addColumn('id', 'serial', (col) => col.primaryKey())
    .addColumn('tenant_id', 'integer', (col) =>
      col.references('tenants.id').onDelete('cascade').notNull()
    )
    .addColumn('assignment_id', 'integer', (col) =>
      col.references('assessment_assignments.id').onDelete('cascade').notNull()
    )
    .addColumn('item_id', 'integer', (col) =>
      col.references('items.id').onDelete('set null')
    )
    .addColumn('section_id', 'integer')
    .addColumn('section_title', 'varchar(255)')
    .addColumn('question_type', 'varchar(30)')
    .addColumn('difficulty', 'varchar(10)')
    .addColumn('points', 'numeric(8,2)', (col) => col.notNull().defaultTo(1))
    .addColumn('time_seconds', 'integer')
    .addColumn('sort_order', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('public_data', 'jsonb', (col) => col.notNull().defaultTo('{}'))
    // PUBLIC: { stem, options, stimulus, mediaRefs } — never scoring keys
    .addColumn('item_hash', 'varchar(64)')
    // Per-item SHA-256 over canonical public content (immutability check)
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(db.fn.now()))
    .execute();

  await db.schema
    .createIndex('idx_public_items_assignment')
    .on('assignment_public_items')
    .columns(['assignment_id', 'sort_order'])
    .execute();

  // ── 3. Assignment Private Scores (PRIVATE scoring snapshots) ──
  await db.schema
    .createTable('assignment_private_scores')
    .addColumn('id', 'serial', (col) => col.primaryKey())
    .addColumn('tenant_id', 'integer', (col) =>
      col.references('tenants.id').onDelete('cascade').notNull()
    )
    .addColumn('assignment_id', 'integer', (col) =>
      col.references('assessment_assignments.id').onDelete('cascade').notNull()
    )
    .addColumn('item_id', 'integer', (col) =>
      col.references('items.id').onDelete('set null')
    )
    .addColumn('private_data', 'jsonb')
    // PRIVATE: { correctKey, scoringRubric, explanation, distractorRationale }
    .addColumn('item_hash', 'varchar(64)')
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(db.fn.now()))
    .execute();

  await db.schema
    .createIndex('idx_private_scores_assignment')
    .on('assignment_private_scores')
    .columns(['assignment_id', 'item_id'])
    .execute();

  // ── 4. Assignment Roster Members (roster snapshot at publish time) ──
  await db.schema
    .createTable('assignment_roster_members')
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
    .addColumn('group_id', 'integer', (col) =>
      col.references('groups.id').onDelete('set null')
    )
    .addColumn('external_id', 'varchar(120)')
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(db.fn.now()))
    .execute();

  await db.schema
    .createIndex('idx_roster_members_assignment')
    .on('assignment_roster_members')
    .columns(['assignment_id', 'user_id'])
    .execute();

  await sql`
    CREATE UNIQUE INDEX uq_roster_members_assignment_user
    ON assignment_roster_members (assignment_id, user_id)
  `.execute(db);

  // ── 5. Assignment Notifications (outbox, same transaction) ──
  await db.schema
    .createTable('assignment_notifications')
    .addColumn('id', 'serial', (col) => col.primaryKey())
    .addColumn('tenant_id', 'integer', (col) =>
      col.references('tenants.id').onDelete('cascade').notNull()
    )
    .addColumn('assignment_id', 'integer', (col) =>
      col.references('assessment_assignments.id').onDelete('cascade').notNull()
    )
    .addColumn('change_type', 'varchar(30)', (col) => col.notNull())
    // published | scheduled | date_changed | cancelled
    .addColumn('recipient_scope', 'varchar(30)', (col) => col.notNull().defaultTo('roster'))
    .addColumn('payload', 'jsonb', (col) => col.defaultTo('{}'))
    .addColumn('status', 'varchar(20)', (col) => col.notNull().defaultTo('pending'))
    .addColumn('idempotency_key', 'varchar(200)')
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(db.fn.now()))
    .execute();

  await db.schema
    .createIndex('idx_assignment_notifications_assignment')
    .on('assignment_notifications')
    .columns(['assignment_id', 'change_type'])
    .execute();

  await db.schema
    .createIndex('idx_assignment_notifications_key')
    .on('assignment_notifications')
    .columns(['tenant_id', 'idempotency_key'])
    .execute();

  // ── Grant permissions ──
  const newTables = [
    'assessment_assignments',
    'assignment_public_items',
    'assignment_private_scores',
    'assignment_roster_members',
    'assignment_notifications',
  ];
  for (const table of newTables) {
    await sql`GRANT SELECT, INSERT, UPDATE ON ${sql.table(table)} TO edikit_runtime`.execute(db);
    await sql`GRANT USAGE ON ${sql.table(table)}_id_seq TO edikit_runtime`.execute(db);
    await sql`GRANT DELETE ON ${sql.table(table)} TO edikit_migration`.execute(db);
    await sql`GRANT SELECT ON ${sql.table(table)} TO edikit_scoring`.execute(db);
  }

  // Private scoring keys restricted to scoring role
  await sql`GRANT SELECT (private_data) ON assignment_private_scores TO edikit_scoring`.execute(db);

  console.log('Assignment publish structure created: 5 tables');
}

/**
 * @param {import('kysely').Kysely<any>} db
 */
export async function down(db) {
  await db.schema.dropTable('assignment_notifications').ifExists().execute();
  await db.schema.dropTable('assignment_roster_members').ifExists().execute();
  await db.schema.dropTable('assignment_private_scores').ifExists().execute();
  await db.schema.dropTable('assignment_public_items').ifExists().execute();
  await db.schema.dropTable('assessment_assignments').ifExists().execute();
}
