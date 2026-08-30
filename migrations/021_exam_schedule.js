/**
 * Deborah — Migration 021: Exam Scheduling Solver
 *
 * Prompt 39 — period, room, student va proctor constraintlari bilan
 * explainable exam schedule (research.md §15 relational schema, §26 exam
 * scheduling as part of program calendar):
 *
 *   - exam_rooms: room inventory — capacity, building, equipment features,
 *     isolated flag (separate_room accommodation uchun yolg'iz xona).
 *   - exam_periods: exam time windows — term bog'langan start/end slotlar.
 *   - exam_schedule_runs: solver run/version root — status lifecycle
 *     draft → approved → published → archived; seed + weights snapshot +
 *     metrics + hard violations + unscheduled, hammasi run'da saqlanadi
 *     (versioning: har bir publish qaytarilmas versiya).
 *   - exam_schedule_assignments: exam (program_event) → period + room +
 *     proctor + student_ids assignment; soft_penalty JSONB har bir
 *     assignment'ning explainable penalty detail'lari (black-box score
 *     emas — har bir item { type, weight, delta, reason }).
 *   - scheduler_weight_config: per-tenant soft weight + default seed
 *     konfiguratsiyasi (admin UI orqali tahrirlanadi).
 *
 * SECURITY / DATA GUARD (Prompt 39 §15):
 *   - Hard violationli run PUBLISH bo'lmaydi — publish gate service
 *     qatlamida, hard_violations JSONB qayd etiladi.
 *   - Black-box score yo'q — har bir soft penalty item izohli
 *     ({ type, weight, delta, reason }), metrics hisobotida chiqadi.
 *   - Har bir write path tenant-scoped + external_key idempotency.
 *
 * Rollback: down() orqali o'chiriladi.
 */

import { sql } from 'kysely';

/**
 * @param {import('kysely').Kysely<any>} db
 */
export async function up(db) {
  // ── 1. Exam Rooms (room inventory) ──
  await db.schema
    .createTable('exam_rooms')
    .addColumn('id', 'serial', (col) => col.primaryKey())
    .addColumn('tenant_id', 'integer', (col) =>
      col.references('tenants.id').onDelete('cascade').notNull()
    )
    .addColumn('name', 'varchar(200)', (col) => col.notNull())
    .addColumn('building', 'varchar(120)')
    .addColumn('capacity', 'integer', (col) => col.notNull())
    // max students in one session (must be > 0)
    .addColumn('features', 'jsonb', (col) => col.defaultTo('[]'))
    // equipment features: ['computers', 'power', 'wheelchair_access', ...]
    .addColumn('isolated', 'boolean', (col) => col.notNull().defaultTo(false))
    // true → separate_room accommodation uchun faqat yolg'iz student
    .addColumn('status', 'varchar(20)', (col) => col.notNull().defaultTo('active'))
    // active | inactive
    .addColumn('external_key', 'varchar(120)')
    .addColumn('created_by', 'integer', (col) =>
      col.references('users.id').onDelete('set null')
    )
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .execute();

  await db.schema
    .createIndex('idx_exam_rooms_tenant')
    .on('exam_rooms')
    .columns(['tenant_id', 'status'])
    .execute();

  await db.schema
    .createIndex('uq_exam_rooms_external_key', { unique: true })
    .on('exam_rooms')
    .columns(['tenant_id', 'external_key'])
    .execute();

  // ── 2. Exam Periods (time windows) ──
  await db.schema
    .createTable('exam_periods')
    .addColumn('id', 'serial', (col) => col.primaryKey())
    .addColumn('tenant_id', 'integer', (col) =>
      col.references('tenants.id').onDelete('cascade').notNull()
    )
    .addColumn('term_id', 'integer', (col) =>
      col.references('academic_terms.id').onDelete('set null')
    )
    .addColumn('name', 'varchar(200)', (col) => col.notNull())
    .addColumn('start_at', 'timestamptz', (col) => col.notNull())
    .addColumn('end_at', 'timestamptz', (col) => col.notNull())
    .addColumn('status', 'varchar(20)', (col) => col.notNull().defaultTo('active'))
    // active | inactive
    .addColumn('external_key', 'varchar(120)')
    .addColumn('created_by', 'integer', (col) =>
      col.references('users.id').onDelete('set null')
    )
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .execute();

  await db.schema
    .createIndex('idx_exam_periods_term')
    .on('exam_periods')
    .columns(['tenant_id', 'term_id', 'start_at'])
    .execute();

  await db.schema
    .createIndex('uq_exam_periods_external_key', { unique: true })
    .on('exam_periods')
    .columns(['tenant_id', 'external_key'])
    .execute();

  // ── 3. Exam Schedule Runs (solver versions) ──
  await db.schema
    .createTable('exam_schedule_runs')
    .addColumn('id', 'serial', (col) => col.primaryKey())
    .addColumn('tenant_id', 'integer', (col) =>
      col.references('tenants.id').onDelete('cascade').notNull()
    )
    .addColumn('term_id', 'integer', (col) =>
      col.references('academic_terms.id').onDelete('set null')
    )
    .addColumn('title', 'varchar(500)', (col) => col.notNull())
    .addColumn('status', 'varchar(20)', (col) => col.notNull().defaultTo('draft'))
    // draft | approved | published | archived
    .addColumn('seed', 'integer', (col) => col.notNull().defaultTo(1))
    // deterministic solver seed — same input + seed → same schedule
    .addColumn('weights', 'jsonb', (col) => col.notNull().defaultTo('{}'))
    // soft penalty weights snapshot { back_to_back: 50, ... }
    .addColumn('metrics', 'jsonb', (col) => col.defaultTo('{}'))
    // { examCount, studentCount, softTotal, softByType, utilization, ... }
    .addColumn('hard_violations', 'jsonb', (col) => col.defaultTo('[]'))
    // hard constraint violations ([]) — publish gate: faqat bo'sh bo'lsa
    .addColumn('unscheduled', 'jsonb', (col) => col.defaultTo('[]'))
    // [{ examId, reason }] — solver joylashtira olmaganlar
    .addColumn('external_key', 'varchar(120)')
    // Idempotency: duplicate run returns existing draft
    .addColumn('approved_at', 'timestamptz')
    .addColumn('approved_by', 'integer', (col) =>
      col.references('users.id').onDelete('set null')
    )
    .addColumn('published_at', 'timestamptz')
    .addColumn('published_by', 'integer', (col) =>
      col.references('users.id').onDelete('set null')
    )
    .addColumn('created_by', 'integer', (col) =>
      col.references('users.id').onDelete('set null')
    )
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .execute();

  await db.schema
    .createIndex('idx_schedule_runs_tenant_status')
    .on('exam_schedule_runs')
    .columns(['tenant_id', 'status', 'created_at'])
    .execute();

  await db.schema
    .createIndex('uq_schedule_runs_external_key', { unique: true })
    .on('exam_schedule_runs')
    .columns(['tenant_id', 'external_key'])
    .execute();

  // ── 4. Exam Schedule Assignments (period + room + proctor per exam) ──
  await db.schema
    .createTable('exam_schedule_assignments')
    .addColumn('id', 'serial', (col) => col.primaryKey())
    .addColumn('run_id', 'integer', (col) =>
      col.references('exam_schedule_runs.id').onDelete('cascade').notNull()
    )
    .addColumn('tenant_id', 'integer', (col) =>
      col.references('tenants.id').onDelete('cascade').notNull()
    )
    .addColumn('event_id', 'integer', (col) =>
      col.references('program_events.id').onDelete('cascade').notNull()
    )
    .addColumn('period_id', 'integer', (col) =>
      col.references('exam_periods.id').onDelete('set null')
    )
    .addColumn('room_id', 'integer', (col) =>
      col.references('exam_rooms.id').onDelete('set null')
    )
    .addColumn('proctor_user_id', 'integer', (col) =>
      col.references('users.id').onDelete('set null')
    )
    .addColumn('student_ids', 'jsonb', (col) => col.defaultTo('[]'))
    // student list assigned to this session slot
    .addColumn('soft_penalty', 'jsonb', (col) => col.defaultTo('[]'))
    // explainable: [{ type, weight, delta, reason }]
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .execute();

  await db.schema
    .createIndex('idx_schedule_assignments_run')
    .on('exam_schedule_assignments')
    .columns(['run_id', 'event_id'])
    .execute();

  await db.schema
    .createIndex('idx_schedule_assignments_period_room')
    .on('exam_schedule_assignments')
    .columns(['run_id', 'period_id', 'room_id'])
    .execute();

  // ── 5. Scheduler Weight Config (per-tenant admin-tuned weights) ──
  await db.schema
    .createTable('scheduler_weight_config')
    .addColumn('id', 'serial', (col) => col.primaryKey())
    .addColumn('tenant_id', 'integer', (col) =>
      col.references('tenants.id').onDelete('cascade').notNull()
    )
    .addColumn('weights', 'jsonb', (col) => col.notNull().defaultTo('{}'))
    .addColumn('seed', 'integer', (col) => col.notNull().defaultTo(1))
    .addColumn('updated_by', 'integer', (col) =>
      col.references('users.id').onDelete('set null')
    )
    .addColumn('updated_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .execute();

  await db.schema
    .createIndex('uq_scheduler_weight_tenant', { unique: true })
    .on('scheduler_weight_config')
    .columns(['tenant_id'])
    .execute();

  // ── Grant permissions ──
  const newTables = [
    'exam_rooms',
    'exam_periods',
    'exam_schedule_runs',
    'exam_schedule_assignments',
    'scheduler_weight_config',
  ];
  for (const table of newTables) {
    await sql`GRANT SELECT, INSERT, UPDATE ON ${sql.table(table)} TO deborah_runtime`.execute(db);
    try { await sql`GRANT USAGE ON ${sql.id(table + '_id_seq')} TO deborah_runtime`.execute(db); } catch (_) { /* serial emas — seq yo'q */ }
    await sql`GRANT DELETE ON ${sql.table(table)} TO deborah_migration`.execute(db);
  }

  console.log('Exam schedule structure created: 5 tables');
}

/**
 * @param {import('kysely').Kysely<any>} db
 */
export async function down(db) {
  await db.schema.dropTable('scheduler_weight_config').ifExists().execute();
  await db.schema.dropTable('exam_schedule_assignments').ifExists().execute();
  await db.schema.dropTable('exam_schedule_runs').ifExists().execute();
  await db.schema.dropTable('exam_periods').ifExists().execute();
  await db.schema.dropTable('exam_rooms').ifExists().execute();
}
