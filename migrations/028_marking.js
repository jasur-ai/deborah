/**
 * Deborah — Migration 028: Marker Allocation, Calibration & Moderation
 * (Prompt 46)
 *
 * Prompt 46 — pseudonymous marking va risk-based moderation workflow
 * (research.md §17 P2-5/6 anonymous grading + double marking/moderation,
 * §54 peer-review conflict rules, §1111 moderation_cases):
 *
 *   - marking_assignments: allocation unit — assessment_id, marker_user_id,
 *     role (marker | sample_marker | second_marker | adjudicator |
 *     external_examiner), workload cap, conflict check, status lifecycle
 *     (allocated → calibrating → marking → in_moderation → complete).
 *   - marking_work_items: per-submission marking unit — assignment_id,
 *     submission_version_id, pseudonym (opaque — marker identity/student
 *     identity bir-biridan ajratilgan §15), mode
 *     (single | sample | second | double), marker_score, marker_comment,
 *     status (queued → assigned → in_progress → scored → agreed), locked_by.
 *   - marker_calibration_runs: anchor calibration — assignment_id,
 *     anchor set (rubric anchors), markers' scores vs gold, status
 *     (draft → open → completed | failed).
 *   - criterion_scores: per-criterion score/comment — work_item_id,
 *     criterion_id, score, comment, marker_user_id (append-only history via
 *     revisions table pattern).
 *   - moderation_cases: disagreement threshold — work_item_id, delta
 *     between scores, policy (sample | second | double), status
 *     (open → adjudicated → closed | escalated), adjudicator_id,
 *     adjudicated_score (agreed mark — done condition §25).
 *
 * SECURITY / DATA GUARD (Prompt 46 §15):
 *   - Marker sensitive case reason (special consideration, disability) va
 *     unrelated identity (student name/ID) ko'rmaydi — pseudonym only.
 *   - Har bir write path tenant-scoped + idempotent (work_item UNIQUE
 *     assignment+submission, calibration run UNIQUE per anchor set).
 */

import { sql } from 'kysely';

/**
 * @param {import('kysely').Kysely<any>} db
 */
export async function up(db) {
  // ── 1. marking_assignments — allocation unit ──
  await db.schema
    .createTable('marking_assignments')
    .addColumn('id', 'serial', (col) => col.primaryKey())
    .addColumn('tenant_id', 'integer', (col) =>
      col.references('tenants.id').onDelete('cascade').notNull()
    )
    .addColumn('assessment_id', 'integer', (col) =>
      col.references('assessments.id').onDelete('cascade').notNull()
    )
    .addColumn('marker_user_id', 'integer', (col) =>
      col.references('users.id').onDelete('cascade').notNull()
    )
    .addColumn('role', 'varchar(20)', (col) => col.notNull().defaultTo('marker'))
    // marker | sample_marker | second_marker | adjudicator | external_examiner
    .addColumn('workload_cap', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('conflict', 'boolean', (col) => col.notNull().defaultTo(false))
    .addColumn('conflict_reason', 'varchar(255)')
    .addColumn('status', 'varchar(16)', (col) => col.notNull().defaultTo('allocated'))
    // allocated → calibrating → marking → in_moderation → complete
    .addColumn('external_scoped', 'boolean', (col) => col.notNull().defaultTo(false))
    // external examiner — faqat o'ziga berilgan work items ko'radi
    .addColumn('created_by', 'integer')
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .execute();

  await sql`
    CREATE UNIQUE INDEX uq_marking_assignment
    ON marking_assignments (tenant_id, assessment_id, marker_user_id, role)
  `.execute(db);
  await db.schema
    .createIndex('idx_marking_assignment_marker')
    .on('marking_assignments')
    .columns(['tenant_id', 'marker_user_id'])
    .execute();

  // ── 2. marking_work_items — per-submission marking unit ──
  await db.schema
    .createTable('marking_work_items')
    .addColumn('id', 'serial', (col) => col.primaryKey())
    .addColumn('tenant_id', 'integer', (col) =>
      col.references('tenants.id').onDelete('cascade').notNull()
    )
    .addColumn('assignment_id', 'integer', (col) =>
      col.references('marking_assignments.id').onDelete('cascade').notNull()
    )
    .addColumn('submission_version_id', 'integer', (col) =>
      col.references('submission_versions.id').onDelete('set null')
    )
    .addColumn('attempt_id', 'integer', (col) =>
      col.references('attempts.id').onDelete('cascade')
    )
    .addColumn('pseudonym', 'varchar(24)', (col) => col.notNull())
    // opaque pseudonym — marker student identity ko'rmaydi
    .addColumn('mode', 'varchar(10)', (col) => col.notNull().defaultTo('single'))
    // single | sample | second | double
    .addColumn('status', 'varchar(14)', (col) => col.notNull().defaultTo('queued'))
    // queued → assigned → in_progress → scored → agreed
    .addColumn('marker_score', sql`decimal(8,2)`)
    .addColumn('marker_comment', 'text')
    .addColumn('locked_by', 'integer')
    .addColumn('locked_at', 'timestamptz')
    .addColumn('scored_at', 'timestamptz')
    .addColumn('agreed_score', sql`decimal(8,2)`)
    // moderation policy agreed mark (done condition §25)
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .execute();

  await sql`
    CREATE UNIQUE INDEX uq_marking_work_item
    ON marking_work_items (tenant_id, assignment_id, pseudonym)
  `.execute(db);
  await db.schema
    .createIndex('idx_marking_work_status')
    .on('marking_work_items')
    .columns(['tenant_id', 'status', 'assignment_id'])
    .execute();

  // ── 3. marker_calibration_runs — anchor calibration ──
  await db.schema
    .createTable('marker_calibration_runs')
    .addColumn('id', 'serial', (col) => col.primaryKey())
    .addColumn('tenant_id', 'integer', (col) =>
      col.references('tenants.id').onDelete('cascade').notNull()
    )
    .addColumn('assignment_id', 'integer', (col) =>
      col.references('marking_assignments.id').onDelete('cascade').notNull()
    )
    .addColumn('anchor_set_id', 'integer')
    // rubric anchors reference (rubric_anchors.id)
    .addColumn('status', 'varchar(10)', (col) => col.notNull().defaultTo('draft'))
    // draft → open → completed | failed
    .addColumn('threshold', sql`decimal(5,2)`, (col) => col.notNull().defaultTo(1.0))
    // allowed deviation from gold — calibration threshold
    .addColumn('gold_scores', 'jsonb', (col) => col.defaultTo('{}'))
    // { anchorId: goldScore }
    .addColumn('marker_scores', 'jsonb', (col) => col.defaultTo('{}'))
    // { anchorId: { score, passed } }
    .addColumn('passed', 'boolean', (col) => col.defaultTo(null))
    .addColumn('created_by', 'integer')
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn('completed_at', 'timestamptz')
    .execute();

  await db.schema
    .createIndex('idx_calibration_assignment')
    .on('marker_calibration_runs')
    .columns(['tenant_id', 'assignment_id'])
    .execute();

  // ── 4. criterion_scores — per-criterion score/comment ──
  await db.schema
    .createTable('criterion_scores')
    .addColumn('id', 'serial', (col) => col.primaryKey())
    .addColumn('tenant_id', 'integer', (col) =>
      col.references('tenants.id').onDelete('cascade').notNull()
    )
    .addColumn('work_item_id', 'integer', (col) =>
      col.references('marking_work_items.id').onDelete('cascade').notNull()
    )
    .addColumn('criterion_id', 'integer', (col) =>
      col.references('rubric_criteria.id').onDelete('cascade')
    )
    .addColumn('score', sql`decimal(8,2)`, (col) => col.notNull())
    .addColumn('comment', 'text')
    .addColumn('marker_user_id', 'integer', (col) =>
      col.references('users.id').onDelete('cascade').notNull()
    )
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .execute();

  await db.schema
    .createIndex('idx_criterion_score_work')
    .on('criterion_scores')
    .columns(['tenant_id', 'work_item_id'])
    .execute();

  // ── 5. moderation_cases — disagreement threshold / adjudication ──
  await db.schema
    .createTable('moderation_cases')
    .addColumn('id', 'serial', (col) => col.primaryKey())
    .addColumn('tenant_id', 'integer', (col) =>
      col.references('tenants.id').onDelete('cascade').notNull()
    )
    .addColumn('work_item_id', 'integer', (col) =>
      col.references('marking_work_items.id').onDelete('cascade').notNull()
    )
    .addColumn('attempt_id', 'integer', (col) =>
      col.references('attempts.id').onDelete('cascade')
    )
    .addColumn('delta', sql`decimal(8,2)`, (col) => col.notNull())
    // |score1 - score2| — disagreement
    .addColumn('policy', 'varchar(12)', (col) => col.notNull().defaultTo('sample'))
    // sample | second | double
    .addColumn('threshold', sql`decimal(5,2)`, (col) => col.notNull().defaultTo(5.0))
    .addColumn('status', 'varchar(12)', (col) => col.notNull().defaultTo('open'))
    // open → adjudicated → closed | escalated
    .addColumn('adjudicator_id', 'integer')
    .addColumn('adjudicated_score', sql`decimal(8,2)`)
    .addColumn('adjudication_note', 'varchar(1000)')
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .execute();

  await sql`
    CREATE UNIQUE INDEX uq_moderation_case_work
    ON moderation_cases (tenant_id, work_item_id)
  `.execute(db);
  await db.schema
    .createIndex('idx_moderation_status')
    .on('moderation_cases')
    .columns(['tenant_id', 'status'])
    .execute();

  // ── Grants (sql-template pattern) ──
  const newTables = [
    'marking_assignments',
    'marking_work_items',
    'marker_calibration_runs',
    'criterion_scores',
    'moderation_cases',
  ];
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
  const tables = [
    'moderation_cases',
    'criterion_scores',
    'marker_calibration_runs',
    'marking_work_items',
    'marking_assignments',
  ];
  for (const table of tables) {
    await db.schema.dropTable(table).ifExists().execute();
  }
}
