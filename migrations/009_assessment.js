/**
 * Deborah — Migration 009: Assessment Builder & Blueprint
 *
 * Adds the assessment draft builder core:
 *   - assessment_templates: reusable assessment templates (e.g. "Summative Final")
 *   - assessments: draft/published assessment records with blueprint + randomization
 *   - assessment_versions: immutable snapshots (draft mutable, published immutable)
 *   - assessment_sections: ordered sections with outcome/topic weights
 *   - assessment_items: item pool links with per-item points/time
 *
 * Key design:
 *   - Blueprint: outcome/topic weight blueprint + item distribution stored as JSONB
 *   - Immutability: published assessments are read-only; versions snapshot content
 *   - Tenant scope: every table is tenant_id-scoped (RLS-ready)
 *   - Security: private scoring keys never stored here (items stay in item_bank)
 *
 * Rollback: All tables droppable via down().
 */

import { sql } from 'kysely';

/**
 * @param {import('kysely').Kysely<any>} db
 */
export async function up(db) {
  // ── 1. Assessment Templates (reusable blueprints) ──
  await db.schema
    .createTable('assessment_templates')
    .addColumn('id', 'serial', (col) => col.primaryKey())
    .addColumn('tenant_id', 'integer', (col) =>
      col.references('tenants.id').onDelete('cascade').notNull()
    )
    .addColumn('name', 'varchar(255)', (col) => col.notNull())
    .addColumn('description', 'text')
    .addColumn('assessment_type', 'varchar(30)', (col) => col.notNull().defaultTo('formative'))
    // diagnostic | formative | quiz | midterm | summative | practice | written | project
    .addColumn('default_total_points', 'numeric(8,2)', (col) => col.defaultTo(0))
    .addColumn('default_time_seconds', 'integer', (col) => col.defaultTo(0))
    .addColumn('default_blueprint', 'jsonb', (col) => col.defaultTo('{}'))
    .addColumn('default_randomization', 'jsonb', (col) => col.defaultTo('{}'))
    .addColumn('is_public', 'boolean', (col) => col.notNull().defaultTo(false))
    .addColumn('created_by', 'integer', (col) =>
      col.references('users.id').onDelete('set null')
    )
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(db.fn.now()))
    .addColumn('updated_at', 'timestamptz', (col) => col.notNull().defaultTo(db.fn.now()))
    .execute();

  await db.schema
    .createIndex('idx_assessment_templates_tenant')
    .on('assessment_templates')
    .columns(['tenant_id', 'assessment_type'])
    .execute();

  // ── 2. Assessments (draft builder root) ──
  await db.schema
    .createTable('assessments')
    .addColumn('id', 'serial', (col) => col.primaryKey())
    .addColumn('tenant_id', 'integer', (col) =>
      col.references('tenants.id').onDelete('cascade').notNull()
    )
    .addColumn('template_id', 'integer', (col) =>
      col.references('assessment_templates.id').onDelete('set null')
    )
    .addColumn('course_id', 'integer', (col) =>
      col.references('courses.id').onDelete('set null')
    )
    .addColumn('title', 'varchar(500)', (col) => col.notNull())
    .addColumn('description', 'text')
    .addColumn('assessment_type', 'varchar(30)', (col) => col.notNull().defaultTo('formative'))
    .addColumn('status', 'varchar(20)', (col) => col.notNull().defaultTo('draft'))
    // draft | published | archived
    .addColumn('blueprint', 'jsonb', (col) => col.defaultTo('{}'))
    // { weights: [{ outcome_code, topic, weight }], distribution: {...}, total_items }
    .addColumn('randomization_config', 'jsonb', (col) => col.defaultTo('{}'))
    // { per_student: true, shuffle_options: true, shuffle_sections: false, seed: null }
    .addColumn('total_points', 'numeric(8,2)', (col) => col.defaultTo(0))
    .addColumn('total_time_seconds', 'integer', (col) => col.defaultTo(0))
    .addColumn('item_count', 'integer', (col) => col.defaultTo(0))
    .addColumn('published_version_id', 'integer') // FK assessment_versions.id
    .addColumn('created_by', 'integer', (col) =>
      col.references('users.id').onDelete('set null')
    )
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(db.fn.now()))
    .addColumn('updated_at', 'timestamptz', (col) => col.notNull().defaultTo(db.fn.now()))
    .execute();

  await db.schema
    .createIndex('idx_assessments_tenant_status')
    .on('assessments')
    .columns(['tenant_id', 'status'])
    .execute();

  // ── 3. Assessment Versions (immutable snapshots) ──
  await db.schema
    .createTable('assessment_versions')
    .addColumn('id', 'serial', (col) => col.primaryKey())
    .addColumn('assessment_id', 'integer', (col) =>
      col.references('assessments.id').onDelete('cascade').notNull()
    )
    .addColumn('tenant_id', 'integer', (col) =>
      col.references('tenants.id').onDelete('cascade').notNull()
    )
    .addColumn('version', 'integer', (col) => col.notNull())
    .addColumn('status_snapshot', 'varchar(20)', (col) => col.notNull())
    .addColumn('blueprint_snapshot', 'jsonb', (col) => col.defaultTo('{}'))
    .addColumn('randomization_snapshot', 'jsonb', (col) => col.defaultTo('{}'))
    .addColumn('sections_snapshot', 'jsonb', (col) => col.defaultTo('[]'))
    .addColumn('items_snapshot', 'jsonb', (col) => col.defaultTo('[]'))
    // Items snapshot contains ONLY public item data + points/time (never private keys)
    .addColumn('total_points', 'numeric(8,2)', (col) => col.defaultTo(0))
    .addColumn('total_time_seconds', 'integer', (col) => col.defaultTo(0))
    .addColumn('change_summary', 'text')
    .addColumn('created_by', 'integer', (col) =>
      col.references('users.id').onDelete('set null')
    )
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(db.fn.now()))
    .execute();

  await db.schema
    .createIndex('idx_assessment_versions_assessment')
    .on('assessment_versions')
    .columns(['assessment_id', 'version'])
    .execute();

  // ── 4. Assessment Sections (ordered, weighted) ──
  await db.schema
    .createTable('assessment_sections')
    .addColumn('id', 'serial', (col) => col.primaryKey())
    .addColumn('assessment_id', 'integer', (col) =>
      col.references('assessments.id').onDelete('cascade').notNull()
    )
    .addColumn('tenant_id', 'integer', (col) =>
      col.references('tenants.id').onDelete('cascade').notNull()
    )
    .addColumn('title', 'varchar(255)', (col) => col.notNull())
    .addColumn('description', 'text')
    .addColumn('sort_order', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('item_type_filter', 'varchar(30)') // e.g. single_choice | essay | null
    .addColumn('difficulty_filter', 'varchar(10)') // easy | medium | hard | null
    .addColumn('outcome_weights', 'jsonb', (col) => col.defaultTo('[]'))
    // [{ outcome_code, weight }] — per-section outcome/topic weight
    .addColumn('max_points', 'numeric(8,2)') // Section cap
    .addColumn('max_time_seconds', 'integer') // Section cap
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(db.fn.now()))
    .addColumn('updated_at', 'timestamptz', (col) => col.notNull().defaultTo(db.fn.now()))
    .execute();

  await db.schema
    .createIndex('idx_assessment_sections_assessment')
    .on('assessment_sections')
    .columns(['assessment_id', 'sort_order'])
    .execute();

  // ── 5. Assessment Items (item pool links) ──
  await db.schema
    .createTable('assessment_items')
    .addColumn('id', 'serial', (col) => col.primaryKey())
    .addColumn('assessment_id', 'integer', (col) =>
      col.references('assessments.id').onDelete('cascade').notNull()
    )
    .addColumn('section_id', 'integer', (col) =>
      col.references('assessment_sections.id').onDelete('set null')
    )
    .addColumn('tenant_id', 'integer', (col) =>
      col.references('tenants.id').onDelete('cascade').notNull()
    )
    .addColumn('item_id', 'integer', (col) =>
      col.references('items.id').onDelete('cascade').notNull()
    )
    .addColumn('points', 'numeric(8,2)', (col) => col.notNull().defaultTo(1))
    .addColumn('time_seconds', 'integer')
    .addColumn('sort_order', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('is_pinned', 'boolean', (col) => col.notNull().defaultTo(false))
    // pinned items always appear; non-pinned are candidates for randomization
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(db.fn.now()))
    .execute();

  await db.schema
    .createIndex('idx_assessment_items_assessment')
    .on('assessment_items')
    .columns(['assessment_id', 'section_id', 'sort_order'])
    .execute();

  await db.schema
    .createIndex('idx_assessment_items_item')
    .on('assessment_items')
    .columns(['item_id'])
    .execute();

  // ── Grant permissions ──
  const newTables = [
    'assessment_templates',
    'assessments',
    'assessment_versions',
    'assessment_sections',
    'assessment_items',
  ];
  for (const table of newTables) {
    await sql`GRANT SELECT, INSERT, UPDATE ON ${sql.table(table)} TO deborah_runtime`.execute(db);
    await sql`GRANT USAGE ON ${sql.table(table)}_id_seq TO deborah_runtime`.execute(db);
    await sql`GRANT DELETE ON ${sql.table(table)} TO deborah_migration`.execute(db);
  }

  console.log('Assessment structure created: 5 tables');
}

/**
 * @param {import('kysely').Kysely<any>} db
 */
export async function down(db) {
  await db.schema.dropTable('assessment_items').ifExists().execute();
  await db.schema.dropTable('assessment_sections').ifExists().execute();
  await db.schema.dropTable('assessment_versions').ifExists().execute();
  await db.schema.dropTable('assessments').ifExists().execute();
  await db.schema.dropTable('assessment_templates').ifExists().execute();
}
