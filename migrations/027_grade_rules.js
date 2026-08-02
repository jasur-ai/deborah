/**
 * Edikit — Migration 027: Academic Grade Rules & Deterministic Calculation
 * (Prompt 45)
 *
 * Prompt 45 — weighted, hurdle, late, exempt, resit va rounding qoidalarini
 * VERSIONLANGAN DSL'da hisoblash (research.md §18 GradingService, §72
 * special consideration/resit):
 *
 *   - academic_grade_rules: institution/assessment grade rule — versioned
 *     (current_version), status lifecycle (draft → approved → archived),
 *     rule DSL jsonb (components: weight/hurdle/late/resit/rounding),
 *     immutable once approved (edits create a NEW version).
 *   - academic_grade_rule_versions: IMMUTABLE per-version snapshot of the
 *     rule DSL + rule_hash (deterministic sha256) — eski rule-version
 *     bilan qayta hisoblash ALWAYS reproducible (old-version
 *     reproducibility testi §20).
 *   - grade_calculation_runs: deterministic calculation execution —
 *     rule_version_id FK, input_snapshot jsonb (component scores with
 *     semantics: missing|zero|exempt|pending), output_snapshot jsonb
 *     (raw/moderated/adjusted/final LAYERS + breakdown), final_grade
 *     decimal (float emas §15), run_hash — idempotent replay.
 *
 * SECURITY / DATA GUARD (Prompt 45 §15, research.md §16.1):
 *   - Arbitrary code eval YO'Q — DSL faqat allowlist'dagi operatorlar va
 *     funksiyalardan iborat (mul/add/sub/div/avg/weighted/hurdle/late/
 *     resit_cap/round/grade_boundary).
 *   - Final grade FLOAT bilan hisoblanmaydi — Decimal (scaled integer
 *     arithmetic) ishlatiladi.
 *   - Har bir write path tenant-scoped + idempotent (rule_hash UNIQUE,
 *     run_hash UNIQUE).
 */

import { sql } from 'kysely';

/**
 * @param {import('kysely').Kysely<any>} db
 */
export async function up(db) {
  // ── 1. academic_grade_rules — versioned grade rule ──
  await db.schema
    .createTable('academic_grade_rules')
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
    .addColumn('name', 'varchar(255)', (col) => col.notNull())
    .addColumn('status', 'varchar(12)', (col) => col.notNull().defaultTo('draft'))
    // draft → approved → archived
    .addColumn('current_version', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('description', 'varchar(1000)')
    .addColumn('created_by', 'integer')
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(db.fn.now()))
    .addColumn('updated_at', 'timestamptz', (col) => col.notNull().defaultTo(db.fn.now()))
    .execute();

  await db.schema
    .createIndex('idx_grade_rules_tenant')
    .on('academic_grade_rules')
    .columns(['tenant_id', 'status'])
    .execute();

  // ── 2. academic_grade_rule_versions — IMMUTABLE DSL snapshots ──
  await db.schema
    .createTable('academic_grade_rule_versions')
    .addColumn('id', 'serial', (col) => col.primaryKey())
    .addColumn('tenant_id', 'integer', (col) =>
      col.references('tenants.id').onDelete('cascade').notNull()
    )
    .addColumn('rule_id', 'integer', (col) =>
      col.references('academic_grade_rules.id').onDelete('cascade').notNull()
    )
    .addColumn('version_no', 'integer', (col) => col.notNull())
    .addColumn('rule_dsl', 'jsonb', (col) => col.notNull())
    // { components[], weights{}, hurdles[], late_policy{}, resit_policy{},
    //   rounding{ method, scale }, boundaries[] }
    .addColumn('rule_hash', 'varchar(64)', (col) => col.notNull())
    // deterministic sha256 of canonical DSL — UNIQUE per tenant
    .addColumn('status', 'varchar(12)', (col) => col.notNull().defaultTo('draft'))
    // draft → approved (immutable once approved — edits make a new version)
    .addColumn('approved_at', 'timestamptz')
    .addColumn('approved_by', 'integer')
    .addColumn('created_by', 'integer')
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(db.fn.now()))
    .execute();

  await sql`
    CREATE UNIQUE INDEX uq_grade_rule_version
    ON academic_grade_rule_versions (tenant_id, rule_id, version_no)
  `.execute(db);
  await sql`
    CREATE UNIQUE INDEX uq_grade_rule_hash
    ON academic_grade_rule_versions (tenant_id, rule_hash)
  `.execute(db);

  // ── 3. grade_calculation_runs — deterministic execution snapshots ──
  await db.schema
    .createTable('grade_calculation_runs')
    .addColumn('id', 'serial', (col) => col.primaryKey())
    .addColumn('tenant_id', 'integer', (col) =>
      col.references('tenants.id').onDelete('cascade').notNull()
    )
    .addColumn('rule_version_id', 'integer', (col) =>
      col.references('academic_grade_rule_versions.id').onDelete('cascade').notNull()
    )
    .addColumn('attempt_id', 'integer', (col) =>
      col.references('attempts.id').onDelete('cascade')
    )
    .addColumn('user_id', 'integer', (col) =>
      col.references('users.id').onDelete('cascade').notNull()
    )
    .addColumn('input_snapshot', 'jsonb', (col) => col.notNull())
    // { components: [{ key, label, raw_score, max_score, status:
    //   missing|zero|exempt|pending|scored }] }
    .addColumn('output_snapshot', 'jsonb', (col) => col.notNull())
    // { layers: { raw, moderated, adjusted, final }, breakdown[], final_grade }
    .addColumn('final_grade', 'decimal(8,2)', (col) => col.defaultTo(null))
    // scaled integer-backed decimal — NEVER float
    .addColumn('grade_label', 'varchar(4)')
    // e.g. "A", "B+", "F" — from boundaries
    .addColumn('run_hash', 'varchar(64)', (col) => col.notNull())
    // deterministic sha256 over (rule_hash, input_snapshot) — idempotent replay
    .addColumn('created_by', 'integer')
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(db.fn.now()))
    .execute();

  await sql`
    CREATE UNIQUE INDEX uq_grade_run_hash
    ON grade_calculation_runs (tenant_id, run_hash)
  `.execute(db);
  await db.schema
    .createIndex('idx_grade_runs_user')
    .on('grade_calculation_runs')
    .columns(['tenant_id', 'user_id'])
    .execute();
  await db.schema
    .createIndex('idx_grade_runs_attempt')
    .on('grade_calculation_runs')
    .columns(['tenant_id', 'attempt_id'])
    .execute();

  // ── Grants (sql-template pattern) ──
  const newTables = [
    'academic_grade_rules',
    'academic_grade_rule_versions',
    'grade_calculation_runs',
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
    'grade_calculation_runs',
    'academic_grade_rule_versions',
    'academic_grade_rules',
  ];
  for (const table of tables) {
    await db.schema.dropTable(table).ifExists().execute();
  }
}
