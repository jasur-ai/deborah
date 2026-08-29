/**
 * Deborah — Migration 007: Rubric Builder & Anchor Model
 *
 * Adds analytic rubric support for written work grading:
 *   - rubrics: top-level rubric templates (versioned)
 *   - rubric_versions: DRAFT→PUBLISHED→DEPRECATED lifecycle
 *   - rubric_criteria: individual scoring criteria with levels
 *   - rubric_anchors: anchor responses for calibration
 *
 * This enables the grading pipeline described in research.md §7:
 *   rubric concept extraction → evidence span matching → LLM scoring →
 *   confidence routing → teacher review
 *
 * Rollback: All tables droppable via down().
 */

import { sql } from 'kysely';

export async function up(db) {
  // ── 1. Rubrics (top-level template) ──
  await db.schema
    .createTable('rubrics')
    .addColumn('id', 'serial', (col) => col.primaryKey())
    .addColumn('tenant_id', 'integer', (col) =>
      col.references('tenants.id').onDelete('cascade').notNull()
    )
    .addColumn('name', 'varchar(255)', (col) => col.notNull())
    .addColumn('description', 'text')
    .addColumn('subject_area', 'varchar(100)')
    .addColumn('type', 'varchar(20)', (col) => col.notNull().defaultTo('analytic'))
    // analytic | holistic | single_point | checklist
    .addColumn('max_points', 'numeric(6,2)', (col) => col.notNull().defaultTo(0))
    .addColumn('current_version_id', 'integer')
    .addColumn('owner_id', 'integer', (col) =>
      col.references('users.id').onDelete('set null')
    )
    .addColumn('is_template', 'boolean', (col) => col.notNull().defaultTo(false))
    .addColumn('usage_count', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('metadata', 'jsonb', (col) => col.defaultTo('{}'))
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(db.fn.now()))
    .addColumn('updated_at', 'timestamptz', (col) => col.notNull().defaultTo(db.fn.now()))
    .execute();

  await db.schema
    .createIndex('idx_rubrics_tenant')
    .on('rubrics')
    .columns(['tenant_id'])
    .execute();

  // ── 2. Rubric Versions (DRAFT→PUBLISHED→DEPRECATED lifecycle) ──
  await db.schema
    .createTable('rubric_versions')
    .addColumn('id', 'serial', (col) => col.primaryKey())
    .addColumn('rubric_id', 'integer', (col) =>
      col.references('rubrics.id').onDelete('cascade').notNull()
    )
    .addColumn('tenant_id', 'integer', (col) =>
      col.references('tenants.id').onDelete('cascade').notNull()
    )
    .addColumn('version', 'integer', (col) => col.notNull())
    .addColumn('status', 'varchar(20)', (col) => col.notNull().defaultTo('draft'))
    // draft | published | deprecated
    .addColumn('change_summary', 'text')
    .addColumn('published_at', 'timestamptz')
    .addColumn('published_by', 'integer', (col) =>
      col.references('users.id').onDelete('set null')
    )
    .addColumn('deprecated_at', 'timestamptz')
    .addColumn('created_by', 'integer', (col) =>
      col.references('users.id').onDelete('set null')
    )
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(db.fn.now()))
    .execute();

  await db.schema
    .createIndex('idx_rubric_versions_rubric')
    .on('rubric_versions')
    .columns(['rubric_id', 'version'])
    .execute();

  // FK for current_version_id on rubrics
  await sql`
    ALTER TABLE rubrics
    ADD CONSTRAINT fk_rubric_current_version
    FOREIGN KEY (current_version_id) REFERENCES rubric_versions(id)
    ON DELETE SET NULL
  `.execute(db);

  // ── 3. Rubric Criteria (scoring dimensions) ──
  await db.schema
    .createTable('rubric_criteria')
    .addColumn('id', 'serial', (col) => col.primaryKey())
    .addColumn('rubric_version_id', 'integer', (col) =>
      col.references('rubric_versions.id').onDelete('cascade').notNull()
    )
    .addColumn('tenant_id', 'integer', (col) =>
      col.references('tenants.id').onDelete('cascade').notNull()
    )
    .addColumn('name', 'varchar(255)', (col) => col.notNull())
    .addColumn('description', 'text')
    .addColumn('max_points', 'numeric(6,2)', (col) => col.notNull().defaultTo(0))
    .addColumn('weight', 'numeric(3,2)', (col) => col.notNull().defaultTo(1.00))
    .addColumn('sort_order', 'integer', (col) => col.defaultTo(0))
    .addColumn('required_concepts', 'jsonb', (col) => col.defaultTo('[]'))
    // [{ concept: "photosynthesis", weight: 1, synonyms: ["photosintesis", "fotosintez"] }]
    .addColumn('contradictions', 'jsonb', (col) => col.defaultTo('[]'))
    // ["kislorod reaktant sifatida ishlatiladi", "CO2 mahsulot"]
    .addColumn('evidence_type', 'varchar(30)', (col) => col.defaultTo('concept'))
    // concept | keyword | span | semantic | formula | code
    .addColumn('student_visible_desc', 'text') // Visible to students
    .addColumn('private_notes', 'text') // Only for markers
    .addColumn('levels', 'jsonb', (col) => col.notNull().defaultTo('[]'))
    // [{ points: 4, descriptor: "to'liq, sababli va aniq" },
    //  { points: 3, descriptor: "asosiy mexanizm to'g'ri, bir detail yetishmaydi" },
    //  { points: 2, descriptor: "qisman tushuncha" },
    //  { points: 1, descriptor: "alohida terminlar, bog'liqlik yo'q" },
    //  { points: 0, descriptor: "noto'g'ri yoki aloqasiz" }]
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(db.fn.now()))
    .addColumn('updated_at', 'timestamptz', (col) => col.notNull().defaultTo(db.fn.now()))
    .execute();

  await db.schema
    .createIndex('idx_rubric_criteria_version')
    .on('rubric_criteria')
    .columns(['rubric_version_id', 'sort_order'])
    .execute();

  // ── 4. Rubric Anchors (calibration exemplars) ──
  await db.schema
    .createTable('rubric_anchors')
    .addColumn('id', 'serial', (col) => col.primaryKey())
    .addColumn('rubric_version_id', 'integer', (col) =>
      col.references('rubric_versions.id').onDelete('cascade').notNull()
    )
    .addColumn('criterion_id', 'integer', (col) =>
      col.references('rubric_criteria.id').onDelete('cascade')
    )
    .addColumn('tenant_id', 'integer', (col) =>
      col.references('tenants.id').onDelete('cascade').notNull()
    )
    .addColumn('title', 'varchar(255)')
    .addColumn('response_text', 'text', (col) => col.notNull())
    .addColumn('expected_score', 'numeric(6,2)', (col) => col.notNull())
    .addColumn('expected_level', 'integer') // Which level this anchors
    .addColumn('rationale', 'text') // Why this response gets this score
    .addColumn('evidence_spans', 'jsonb', (col) => col.defaultTo('[]'))
    // [{ start: 10, end: 45, concept: "photosynthesis" }]
    .addColumn('type', 'varchar(20)', (col) => col.notNull().defaultTo('exemplar'))
    // exemplar | borderline | common_mistake | training
    .addColumn('is_public', 'boolean', (col) => col.notNull().defaultTo(false))
    .addColumn('metadata', 'jsonb', (col) => col.defaultTo('{}'))
    .addColumn('created_by', 'integer', (col) =>
      col.references('users.id').onDelete('set null')
    )
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(db.fn.now()))
    .execute();

  await db.schema
    .createIndex('idx_rubric_anchors_version')
    .on('rubric_anchors')
    .columns(['rubric_version_id', 'criterion_id'])
    .execute();

  // ── 5. Item↔Rubric pin (which rubric version an item uses) ──
  await db.schema
    .createTable('item_rubric_pins')
    .addColumn('id', 'serial', (col) => col.primaryKey())
    .addColumn('item_id', 'integer', (col) =>
      col.references('items.id').onDelete('cascade').notNull()
    )
    .addColumn('rubric_version_id', 'integer', (col) =>
      col.references('rubric_versions.id').onDelete('cascade').notNull()
    )
    .addColumn('tenant_id', 'integer', (col) =>
      col.references('tenants.id').onDelete('cascade').notNull()
    )
    .addColumn('pinned_at', 'timestamptz', (col) => col.notNull().defaultTo(db.fn.now()))
    .addColumn('pinned_by', 'integer', (col) =>
      col.references('users.id').onDelete('set null')
    )
    .addColumn('is_active', 'boolean', (col) => col.notNull().defaultTo(true))
    .execute();

  await sql`
    CREATE UNIQUE INDEX idx_item_rubric_pins_unique
    ON item_rubric_pins (item_id, rubric_version_id)
  `.execute(db);

  await db.schema
    .createIndex('idx_item_rubric_pins_item')
    .on('item_rubric_pins')
    .columns(['item_id'])
    .execute();

  // ── Grant permissions ──
  const newTables = ['rubrics', 'rubric_versions', 'rubric_criteria', 'rubric_anchors', 'item_rubric_pins'];
  for (const table of newTables) {
    await sql`GRANT SELECT, INSERT, UPDATE ON ${sql.table(table)} TO deborah_runtime`.execute(db);
    await sql`GRANT USAGE ON ${sql.table(table)}_id_seq TO deborah_runtime`.execute(db);
    await sql`GRANT DELETE ON ${sql.table(table)} TO deborah_migration`.execute(db);
    await sql`GRANT SELECT ON ${sql.table(table)} TO deborah_scoring`.execute(db);
  }

  console.log('Rubric structure created: 5 tables');
}

export async function down(db) {
  await db.schema.dropTable('item_rubric_pins').ifExists().execute();
  await db.schema.dropTable('rubric_anchors').ifExists().execute();
  await db.schema.dropTable('rubric_criteria').ifExists().execute();
  await db.schema.dropTable('rubric_versions').ifExists().execute();
  await db.schema.dropTable('rubrics').ifExists().execute();
}
