/**
 * Edikit — Migration 010: Assessment Brief, Policy Pack & Simulator
 *
 * Adds versioned assessment briefs and typed institutional policies:
 *   - assessment_briefs: versioned summative assessment brief (AI-use A0–A4,
 *     late/resit/security/retention, materials, submission format)
 *   - assessment_brief_versions: immutable brief snapshots (material-change diff)
 *   - policy_packs: typed institutional policy packs (DRAFT→APPROVED lifecycle)
 *   - policy_pack_versions: immutable policy snapshots (locked fields enforced)
 *   - recipe_library: seeded policy recipe templates
 *   - simulator_runs: roster/accommodation simulation results
 *
 * Key design:
 *   - Policies are DATA (JSON schema-validated), never arbitrary JavaScript
 *   - Locked fields are explicit denylist enforcement (institution-owned keys)
 *   - Active attempts pin the exact brief/policy version at publish time
 *   - Summarative publish is BLOCKED until brief + policy approved
 *
 * Rollback: All tables droppable via down().
 */

import { sql } from 'kysely';

/**
 * @param {import('kysely').Kysely<any>} db
 */
export async function up(db) {
  // ── 1. Assessment Briefs (versioned summative briefs) ──
  await db.schema
    .createTable('assessment_briefs')
    .addColumn('id', 'serial', (col) => col.primaryKey())
    .addColumn('tenant_id', 'integer', (col) =>
      col.references('tenants.id').onDelete('cascade').notNull()
    )
    .addColumn('assessment_id', 'integer', (col) =>
      col.references('assessments.id').onDelete('cascade')
    )
    .addColumn('title', 'varchar(500)', (col) => col.notNull())
    .addColumn('status', 'varchar(20)', (col) => col.notNull().defaultTo('draft'))
    // draft | approved | archived
    .addColumn('version', 'integer', (col) => col.notNull().defaultTo(1))
    .addColumn('ai_use_level', 'varchar(4)', (col) => col.notNull().defaultTo('A0'))
    // A0 (AI taqiqlangan) | A1 (spell/grammar) | A2 (brainstorm/research) |
    // A3 (draft/collab) | A4 (AI-native + audit)
    .addColumn('content', 'jsonb', (col) => col.defaultTo('{}'))
    // { learning_outcomes[], duration_minutes, materials[], submission_format,
    //   late_policy{...}, resit_policy{...}, security_policy{...}, retention_days }
    .addColumn('locked_fields', 'jsonb', (col) => col.defaultTo('[]'))
    // Institution-locked field paths that cannot be edited by teachers
    .addColumn('approved_at', 'timestamptz')
    .addColumn('approved_by', 'integer', (col) =>
      col.references('users.id').onDelete('set null')
    )
    .addColumn('created_by', 'integer', (col) =>
      col.references('users.id').onDelete('set null')
    )
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(db.fn.now()))
    .addColumn('updated_at', 'timestamptz', (col) => col.notNull().defaultTo(db.fn.now()))
    .execute();

  await db.schema
    .createIndex('idx_briefs_tenant_status')
    .on('assessment_briefs')
    .columns(['tenant_id', 'status'])
    .execute();

  // ── 2. Assessment Brief Versions (immutable snapshots) ──
  await db.schema
    .createTable('assessment_brief_versions')
    .addColumn('id', 'serial', (col) => col.primaryKey())
    .addColumn('brief_id', 'integer', (col) =>
      col.references('assessment_briefs.id').onDelete('cascade').notNull()
    )
    .addColumn('tenant_id', 'integer', (col) =>
      col.references('tenants.id').onDelete('cascade').notNull()
    )
    .addColumn('version', 'integer', (col) => col.notNull())
    .addColumn('content_snapshot', 'jsonb', (col) => col.defaultTo('{}'))
    .addColumn('ai_use_level_snapshot', 'varchar(4)')
    .addColumn('locked_fields_snapshot', 'jsonb', (col) => col.defaultTo('[]'))
    .addColumn('change_summary', 'text')
    .addColumn('is_material_change', 'boolean', (col) => col.notNull().defaultTo(false))
    .addColumn('changed_by', 'integer', (col) =>
      col.references('users.id').onDelete('set null')
    )
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(db.fn.now()))
    .execute();

  await db.schema
    .createIndex('idx_brief_versions_brief')
    .on('assessment_brief_versions')
    .columns(['brief_id', 'version'])
    .execute();

  // ── 3. Policy Packs (typed institutional policy) ──
  await db.schema
    .createTable('policy_packs')
    .addColumn('id', 'serial', (col) => col.primaryKey())
    .addColumn('tenant_id', 'integer', (col) =>
      col.references('tenants.id').onDelete('cascade').notNull()
    )
    .addColumn('name', 'varchar(255)', (col) => col.notNull())
    .addColumn('description', 'text')
    .addColumn('status', 'varchar(20)', (col) => col.notNull().defaultTo('draft'))
    // draft | approved | archived
    .addColumn('version', 'integer', (col) => col.notNull().defaultTo(1))
    .addColumn('policy', 'jsonb', (col) => col.defaultTo('{}'))
    // Typed schema: { late{...}, resit{...}, security{...}, retention_days,
    //                 ai_use{...}, marking{...} }
    .addColumn('locked_fields', 'jsonb', (col) => col.defaultTo('[]'))
    // Institution-locked keys — attempts to change these are rejected (denylist)
    .addColumn('approved_at', 'timestamptz')
    .addColumn('approved_by', 'integer', (col) =>
      col.references('users.id').onDelete('set null')
    )
    .addColumn('created_by', 'integer', (col) =>
      col.references('users.id').onDelete('set null')
    )
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(db.fn.now()))
    .addColumn('updated_at', 'timestamptz', (col) => col.notNull().defaultTo(db.fn.now()))
    .execute();

  await db.schema
    .createIndex('idx_policy_packs_tenant')
    .on('policy_packs')
    .columns(['tenant_id', 'status'])
    .execute();

  // ── 4. Policy Pack Versions (immutable snapshots) ──
  await db.schema
    .createTable('policy_pack_versions')
    .addColumn('id', 'serial', (col) => col.primaryKey())
    .addColumn('pack_id', 'integer', (col) =>
      col.references('policy_packs.id').onDelete('cascade').notNull()
    )
    .addColumn('tenant_id', 'integer', (col) =>
      col.references('tenants.id').onDelete('cascade').notNull()
    )
    .addColumn('version', 'integer', (col) => col.notNull())
    .addColumn('policy_snapshot', 'jsonb', (col) => col.defaultTo('{}'))
    .addColumn('locked_fields_snapshot', 'jsonb', (col) => col.defaultTo('[]'))
    .addColumn('change_summary', 'text')
    .addColumn('changed_by', 'integer', (col) =>
      col.references('users.id').onDelete('set null')
    )
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(db.fn.now()))
    .execute();

  await db.schema
    .createIndex('idx_policy_versions_pack')
    .on('policy_pack_versions')
    .columns(['pack_id', 'version'])
    .execute();

  // ── 5. Recipe Library (seeded policy templates) ──
  await db.schema
    .createTable('recipe_library')
    .addColumn('id', 'serial', (col) => col.primaryKey())
    .addColumn('tenant_id', 'integer', (col) =>
      col.references('tenants.id').onDelete('cascade').notNull()
    )
    .addColumn('name', 'varchar(255)', (col) => col.notNull())
    .addColumn('description', 'text')
    .addColumn('category', 'varchar(50)', (col) => col.notNull().defaultTo('general'))
    // standard | high_stakes | accessible | formative | custom
    .addColumn('policy_template', 'jsonb', (col) => col.defaultTo('{}'))
    .addColumn('is_system', 'boolean', (col) => col.notNull().defaultTo(false))
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(db.fn.now()))
    .execute();

  await db.schema
    .createIndex('idx_recipe_library_tenant')
    .on('recipe_library')
    .columns(['tenant_id', 'category'])
    .execute();

  // ── 6. Simulator Runs (roster/accommodation simulation) ──
  await db.schema
    .createTable('simulator_runs')
    .addColumn('id', 'serial', (col) => col.primaryKey())
    .addColumn('tenant_id', 'integer', (col) =>
      col.references('tenants.id').onDelete('cascade').notNull()
    )
    .addColumn('assessment_id', 'integer', (col) =>
      col.references('assessments.id').onDelete('cascade')
    )
    .addColumn('brief_version_id', 'integer', (col) =>
      col.references('assessment_brief_versions.id').onDelete('set null')
    )
    .addColumn('policy_version_id', 'integer', (col) =>
      col.references('policy_pack_versions.id').onDelete('set null')
    )
    .addColumn('input_roster', 'jsonb', (col) => col.defaultTo('[]'))
    // [{ student_external_id, name, group, accommodations[] }]
    .addColumn('result', 'jsonb', (col) => col.defaultTo('{}'))
    // { per_student[], summary{...}, blockers[], warnings[] }
    .addColumn('status', 'varchar(20)', (col) => col.notNull().defaultTo('completed'))
    .addColumn('created_by', 'integer', (col) =>
      col.references('users.id').onDelete('set null')
    )
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(db.fn.now()))
    .execute();

  await db.schema
    .createIndex('idx_simulator_runs_tenant')
    .on('simulator_runs')
    .columns(['tenant_id', 'created_at'])
    .execute();

  // ── Grant permissions ──
  const newTables = [
    'assessment_briefs',
    'assessment_brief_versions',
    'policy_packs',
    'policy_pack_versions',
    'recipe_library',
    'simulator_runs',
  ];
  for (const table of newTables) {
    await sql`GRANT SELECT, INSERT, UPDATE ON ${sql.table(table)} TO edikit_runtime`.execute(db);
    await sql`GRANT USAGE ON ${sql.table(table)}_id_seq TO edikit_runtime`.execute(db);
    await sql`GRANT DELETE ON ${sql.table(table)} TO edikit_migration`.execute(db);
  }

  console.log('Brief/Policy structure created: 6 tables');
}

/**
 * @param {import('kysely').Kysely<any>} db
 */
export async function down(db) {
  await db.schema.dropTable('simulator_runs').ifExists().execute();
  await db.schema.dropTable('recipe_library').ifExists().execute();
  await db.schema.dropTable('policy_pack_versions').ifExists().execute();
  await db.schema.dropTable('policy_packs').ifExists().execute();
  await db.schema.dropTable('assessment_brief_versions').ifExists().execute();
  await db.schema.dropTable('assessment_briefs').ifExists().execute();
}
