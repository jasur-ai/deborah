/**
 * Deborah — Migration 005: Competency & Curriculum Graph
 *
 * Adds versioned competency/outcome framework support:
 *   - competency_frameworks: top-level frameworks (e.g., "National Curriculum",
 *     "Cambridge IGCSE", "CASE Standards")
 *   - competency_versions: DRAFT→REVIEW→PUBLISHED lifecycle
 *   - competencies: hierarchical outcomes with relations
 *   - competency_relations: parent/child, prerequisite, cross-reference
 *   - course_competencies: course→competency mapping with AI_SUGGESTED status
 *
 * All tables are tenant-scoped.
 *
 * CASE (Competency and Academic Standards Exchange) compatible fields:
 *   - external_id for CASE UID mapping
 *   - human_coding_scheme for standard identifiers (e.g., "CCSS.MATH.8.G.9")
 *   - rubric_criterion_id for direct assessment linkage (future)
 *
 * Rollback: All tables are droppable via down().
 */

import { sql } from 'kysely';

/**
 * @param {import('kysely').Kysely<any>} db
 */
export async function up(db) {
  // ── 1. Competency Frameworks ──
  await db.schema
    .createTable('competency_frameworks')
    .addColumn('id', 'serial', (col) => col.primaryKey())
    .addColumn('tenant_id', 'integer', (col) =>
      col.references('tenants.id').onDelete('cascade').notNull()
    )
    .addColumn('name', 'varchar(255)', (col) => col.notNull())
    .addColumn('description', 'text')
    .addColumn('source', 'varchar(50)') // manual | case_import | api_sync | ai_generated
    .addColumn('external_id', 'varchar(255)') // CASE UID or external system ID
    .addColumn('subject_area', 'varchar(100)') // Math, Science, Language, etc.
    .addColumn('education_level', 'varchar(50)') // primary | secondary | higher_education | vocational
    .addColumn('language', 'varchar(10)', (col) => col.notNull().defaultTo('uz'))
    .addColumn('metadata', 'jsonb', (col) => col.defaultTo('{}'))
    .addColumn('current_version_id', 'integer') // FK to competency_versions (set after publish)
    .addColumn('is_active', 'boolean', (col) => col.notNull().defaultTo(true))
    .addColumn('created_by', 'integer', (col) =>
      col.references('users.id').onDelete('set null')
    )
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .execute();

  await db.schema
    .createIndex('idx_comp_frameworks_tenant')
    .on('competency_frameworks')
    .columns(['tenant_id', 'is_active'])
    .execute();

  // ── 2. Competency Versions (DRAFT→REVIEW→PUBLISHED lifecycle) ──
  await db.schema
    .createTable('competency_versions')
    .addColumn('id', 'serial', (col) => col.primaryKey())
    .addColumn('framework_id', 'integer', (col) =>
      col.references('competency_frameworks.id').onDelete('cascade').notNull()
    )
    .addColumn('tenant_id', 'integer', (col) =>
      col.references('tenants.id').onDelete('cascade').notNull()
    )
    .addColumn('version', 'varchar(20)', (col) => col.notNull()) // "1.0", "2.0", "2026-v1"
    .addColumn('status', 'varchar(20)', (col) => col.notNull().defaultTo('draft'))
    // draft | review | published | deprecated
    .addColumn('changelog', 'text')
    .addColumn('published_at', 'timestamptz')
    .addColumn('published_by', 'integer', (col) =>
      col.references('users.id').onDelete('set null')
    )
    .addColumn('deprecated_at', 'timestamptz')
    .addColumn('created_by', 'integer', (col) =>
      col.references('users.id').onDelete('set null')
    )
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .execute();

  await db.schema
    .createIndex('idx_comp_versions_framework')
    .on('competency_versions')
    .columns(['framework_id', 'status'])
    .execute();

  // Add FK after competency_versions table exists
  await sql`
    ALTER TABLE competency_frameworks
    ADD CONSTRAINT fk_framework_current_version
    FOREIGN KEY (current_version_id) REFERENCES competency_versions(id)
    ON DELETE SET NULL
  `.execute(db);

  // ── 3. Competencies (hierarchical outcomes) ──
  await db.schema
    .createTable('competencies')
    .addColumn('id', 'serial', (col) => col.primaryKey())
    .addColumn('framework_id', 'integer', (col) =>
      col.references('competency_frameworks.id').onDelete('cascade').notNull()
    )
    .addColumn('version_id', 'integer', (col) =>
      col.references('competency_versions.id').onDelete('cascade').notNull()
    )
    .addColumn('tenant_id', 'integer', (col) =>
      col.references('tenants.id').onDelete('cascade').notNull()
    )
    .addColumn('parent_id', 'integer') // Self-referencing for hierarchy
    .addColumn('code', 'varchar(100)') // Short code (e.g., "MATH.8.G.9")
    .addColumn('human_coding_scheme', 'varchar(255)') // CASE-compatible identifier
    .addColumn('name', 'varchar(500)', (col) => col.notNull())
    .addColumn('description', 'text')
    .addColumn('type', 'varchar(30)', (col) => col.notNull().defaultTo('competency'))
    // domain | competency | sub_competency | learning_outcome | skill | knowledge | attitude
    .addColumn('cognitive_level', 'varchar(20)') // remember | understand | apply | analyze | evaluate | create
    .addColumn('difficulty', 'varchar(10)') // easy | medium | hard
    .addColumn('keywords', sql`text[]`) // Searchable keywords/tags
    .addColumn('translations', 'jsonb', (col) => col.defaultTo('{}'))
    // { uz: { name, description }, ru: { ... }, en: { ... } }
    .addColumn('alias', sql`text[]`) // Alternative names/synonyms
    .addColumn('terminology', 'jsonb', (col) => col.defaultTo('{}'))
    // { preferred: "term", also_known_as: ["alt1", "alt2"] }
    .addColumn('sort_order', 'integer', (col) => col.defaultTo(0))
    .addColumn('external_id', 'varchar(255)') // CASE UID
    .addColumn('rubric_criterion_id', 'integer') // Future: direct assessment linkage
    .addColumn('metadata', 'jsonb', (col) => col.defaultTo('{}'))
    .addColumn('is_active', 'boolean', (col) => col.notNull().defaultTo(true))
    .addColumn('created_by', 'integer', (col) =>
      col.references('users.id').onDelete('set null')
    )
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .execute();

  // Self-referencing FK for parent_id
  await sql`
    ALTER TABLE competencies
    ADD CONSTRAINT fk_competency_parent
    FOREIGN KEY (parent_id) REFERENCES competencies(id)
    ON DELETE SET NULL
  `.execute(db);

  await db.schema
    .createIndex('idx_competencies_framework')
    .on('competencies')
    .columns(['framework_id', 'version_id', 'type'])
    .execute();

  await db.schema
    .createIndex('idx_competencies_parent')
    .on('competencies')
    .columns(['parent_id'])
    .execute();

  await db.schema
    .createIndex('idx_competencies_code')
    .on('competencies')
    .columns(['framework_id', 'code'])
    .execute();

  // ── 4. Competency Relations ──
  await db.schema
    .createTable('competency_relations')
    .addColumn('id', 'serial', (col) => col.primaryKey())
    .addColumn('tenant_id', 'integer', (col) =>
      col.references('tenants.id').onDelete('cascade').notNull()
    )
    .addColumn('source_competency_id', 'integer', (col) =>
      col.references('competencies.id').onDelete('cascade').notNull()
    )
    .addColumn('target_competency_id', 'integer', (col) =>
      col.references('competencies.id').onDelete('cascade').notNull()
    )
    .addColumn('relation_type', 'varchar(30)', (col) => col.notNull())
    // prerequisite | corequisite | cross_reference | replaces | similar_to | extends
    // assesses | requires | teaches | reinforces
    .addColumn('strength', sql`numeric(3,2)`) // 0.00–1.00 correlation weight
    .addColumn('metadata', 'jsonb', (col) => col.defaultTo('{}'))
    .addColumn('created_by', 'integer', (col) =>
      col.references('users.id').onDelete('set null')
    )
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .execute();

  // Prevent duplicate relations
  await sql`
    CREATE UNIQUE INDEX idx_comp_relations_unique
    ON competency_relations (source_competency_id, target_competency_id, relation_type)
  `.execute(db);

  await db.schema
    .createIndex('idx_comp_relations_source')
    .on('competency_relations')
    .columns(['source_competency_id'])
    .execute();

  await db.schema
    .createIndex('idx_comp_relations_target')
    .on('competency_relations')
    .columns(['target_competency_id'])
    .execute();

  // ── 5. Course→Competency Mapping ──
  await db.schema
    .createTable('course_competencies')
    .addColumn('id', 'serial', (col) => col.primaryKey())
    .addColumn('tenant_id', 'integer', (col) =>
      col.references('tenants.id').onDelete('cascade').notNull()
    )
    .addColumn('course_offering_id', 'integer', (col) =>
      col.references('course_offerings.id').onDelete('cascade').notNull()
    )
    .addColumn('competency_id', 'integer', (col) =>
      col.references('competencies.id').onDelete('cascade').notNull()
    )
    .addColumn('mapping_status', 'varchar(20)', (col) => col.notNull().defaultTo('manual'))
    // manual | ai_suggested | reviewed | approved
    .addColumn('coverage_weight', sql`numeric(5,2)`, (col) => col.defaultTo(0))
    // How much of this competency is covered by the course (0.00–100.00)
    .addColumn('assessment_count', 'integer', (col) => col.defaultTo(0))
    .addColumn('mapped_by', 'integer', (col) =>
      col.references('users.id').onDelete('set null')
    )
    .addColumn('ai_suggested_at', 'timestamptz') // When AI suggested this mapping
    .addColumn('ai_confidence', sql`numeric(4,3)`) // 0.000–1.000
    .addColumn('reviewed_at', 'timestamptz')
    .addColumn('reviewed_by', 'integer', (col) =>
      col.references('users.id').onDelete('set null')
    )
    .addColumn('notes', 'text')
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .execute();

  // A competency can only be mapped once per course offering
  await sql`
    CREATE UNIQUE INDEX idx_course_competencies_unique
    ON course_competencies (course_offering_id, competency_id)
  `.execute(db);

  await db.schema
    .createIndex('idx_course_competencies_offering')
    .on('course_competencies')
    .columns(['course_offering_id', 'mapping_status'])
    .execute();

  await db.schema
    .createIndex('idx_course_competencies_comp')
    .on('course_competencies')
    .columns(['competency_id'])
    .execute();

  // ── Grant permissions ──
  const newTables = [
    'competency_frameworks',
    'competency_versions',
    'competencies',
    'competency_relations',
    'course_competencies',
  ];

  for (const table of newTables) {
    await sql`GRANT SELECT, INSERT, UPDATE ON ${sql.table(table)} TO deborah_runtime`.execute(db);
    try { await sql`GRANT USAGE ON ${sql.id(table + '_id_seq')} TO deborah_runtime`.execute(db); } catch (_) { /* serial emas — seq yo'q */ }
    await sql`GRANT DELETE ON ${sql.table(table)} TO deborah_migration`.execute(db);
    await sql`GRANT SELECT ON ${sql.table(table)} TO deborah_scoring`.execute(db);
  }

  console.log('Competency structure created: 5 tables');
}

/**
 * @param {import('kysely').Kysely<any>} db
 */
export async function down(db) {
  await db.schema.dropTable('course_competencies').ifExists().execute();
  await db.schema.dropTable('competency_relations').ifExists().execute();
  await db.schema.dropTable('competencies').ifExists().execute();
  await db.schema.dropTable('competency_versions').ifExists().execute();
  await db.schema.dropTable('competency_frameworks').ifExists().execute();
}
