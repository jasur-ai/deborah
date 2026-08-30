/**
 * Deborah — Migration 043: Program Quality & Accreditation Workspace
 *
 * Prompt 62 — curriculum map, aggregate evidence, finding va improvement
 * action workflow (research.md §56 Program Quality, Curriculum Mapping va
 * Accreditation Workspace). Precondition: Prompt 20 competency + Prompt 61
 * evidence model ready.
 *
 * Workflow: institution outcomes → program outcomes → course outcomes →
 * I/R/M/A level → assessment points → aggregate evidence → benchmark/target
 * → finding → improvement action → next-cycle verification.
 *
 * Tables:
 *   - curriculum_maps: versioned map (framework + term + status lifecycle).
 *   - curriculum_map_entries: course↔outcome mapping with I/R/M/A level.
 *   - evidence_aggregations: direct/indirect evidence per outcome-cell with
 *     min cell suppression support.
 *   - program_findings: outcome target vs observed gap.
 *   - improvement_actions: action with owner/deadline — close requires
 *     follow-up evidence (close blocker).
 *   - follow_up_evidence: next-cycle verification evidence + decision.
 *   - accreditation_exports: export bundle with reproducible manifest/hash.
 *
 * SECURITY / DATA GUARD (Prompt 62 §15, §56.5):
 *   - Individual teacher punishment leaderboard defaultda mavjud emas.
 *   - Sensitive raw PII aggregate UIga chiqmaydi — faqat anonymized sample.
 *   - Har write path tenant-scoped + audited; action owner/evidence'siz
 *     close bo'lmaydi.
 */

import { sql } from 'kysely';

/**
 * @param {import('kysely').Kysely<any>} db
 */
export async function up(db) {
  await db.schema
    .createTable('curriculum_maps')
    .addColumn('id', 'serial', (col) => col.primaryKey())
    .addColumn('tenant_id', 'integer', (col) =>
      col.references('tenants.id').onDelete('cascade').notNull()
    )
    .addColumn('name', 'varchar(200)', (col) => col.notNull())
    // e.g. "BSc Matematika 2026"
    .addColumn('framework_id', 'integer')
    // Prompt 20 competency framework (optional link)
    .addColumn('term', 'varchar(40)')
    // e.g. "2026-spring"
    .addColumn('version', 'varchar(40)', (col) => col.notNull().defaultTo('v1'))
    .addColumn('status', 'varchar(20)', (col) => col.notNull().defaultTo('draft'))
    // draft | review | published | archived
    .addColumn('created_by', 'varchar(120)')
    .addColumn('created_at', 'timestamp', (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamp', (col) => col.notNull().defaultTo(sql`now()`))
    .addUniqueConstraint('curriculum_map_tenant_name_version', ['tenant_id', 'name', 'version']).execute()

  await db.schema
    .createTable('curriculum_map_entries')
    .addColumn('id', 'serial', (col) => col.primaryKey())
    .addColumn('tenant_id', 'integer', (col) =>
      col.references('tenants.id').onDelete('cascade').notNull()
    )
    .addColumn('map_id', 'integer', (col) =>
      col.references('curriculum_maps.id').onDelete('cascade').notNull()
    )
    .addColumn('course_id', 'integer', (col) => col.notNull())
    .addColumn('course_code', 'varchar(60)')
    .addColumn('course_name', 'varchar(200)')
    .addColumn('outcome_id', 'integer', (col) => col.notNull())
    .addColumn('outcome_code', 'varchar(60)')
    // e.g. "PLO-4"
    .addColumn('outcome_name', 'varchar(300)')
    .addColumn('irma_level', 'varchar(20)', (col) => col.notNull())
    // introduced | reinforced | mastered | assessed
    .addColumn('assessment_points', 'integer', (col) => col.notNull().defaultTo(0))
    // how many assessment points touch this outcome in this course
    .addColumn('created_at', 'timestamp', (col) => col.notNull().defaultTo(sql`now()`))
    .addUniqueConstraint('curriculum_map_entry_course_outcome', ['map_id', 'course_id', 'outcome_id'])
    
    

  await db.schema
    .createTable('evidence_aggregations')
    .addColumn('id', 'serial', (col) => col.primaryKey())
    .addColumn('tenant_id', 'integer', (col) =>
      col.references('tenants.id').onDelete('cascade').notNull()
    )
    .addColumn('map_id', 'integer', (col) =>
      col.references('curriculum_maps.id').onDelete('cascade').notNull()
    )
    .addColumn('outcome_id', 'integer', (col) => col.notNull())
    .addColumn('outcome_code', 'varchar(60)')
    .addColumn('term', 'varchar(40)')
    .addColumn('evidence_type', 'varchar(20)', (col) => col.notNull())
    // direct | indirect
    .addColumn('method', 'varchar(120)')
    // e.g. "anchor rubric, stratified sample"
    .addColumn('sample_size', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('min_cell_size', 'integer', (col) => col.notNull().defaultTo(5))
    // below this → cell suppressed (null in aggregate)
    .addColumn('observed_pct', sql`numeric(6,3)`)
    // null when suppressed
    .addColumn('benchmark_target_pct', sql`numeric(6,3)`)
    .addColumn('is_suppressed', 'boolean', (col) => col.notNull().defaultTo(false))
    .addColumn('aggregate_meta', 'jsonb', (col) => col.defaultTo(sql`'{}'::jsonb`))
    // { raters, coursesIncluded, languageMix, anonymized: true } — no raw PII
    .addColumn('created_by', 'varchar(120)')
    .addColumn('created_at', 'timestamp', (col) => col.notNull().defaultTo(sql`now()`))
    

  await db.schema
    .createTable('program_findings')
    .addColumn('id', 'serial', (col) => col.primaryKey())
    .addColumn('tenant_id', 'integer', (col) =>
      col.references('tenants.id').onDelete('cascade').notNull()
    )
    .addColumn('map_id', 'integer', (col) =>
      col.references('curriculum_maps.id').onDelete('cascade').notNull()
    )
    .addColumn('outcome_id', 'integer', (col) => col.notNull())
    .addColumn('outcome_code', 'varchar(60)')
    .addColumn('title', 'varchar(300)', (col) => col.notNull())
    .addColumn('target_pct', sql`numeric(6,3)`, (col) => col.notNull())
    .addColumn('observed_pct', sql`numeric(6,3)`)
    .addColumn('review_notes', 'text')
    .addColumn('status', 'varchar(20)', (col) => col.notNull().defaultTo('open'))
    // open | in_progress | resolved
    .addColumn('created_by', 'varchar(120)')
    .addColumn('created_at', 'timestamp', (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamp', (col) => col.notNull().defaultTo(sql`now()`))
    

  await db.schema
    .createTable('improvement_actions')
    .addColumn('id', 'serial', (col) => col.primaryKey())
    .addColumn('tenant_id', 'integer', (col) =>
      col.references('tenants.id').onDelete('cascade').notNull()
    )
    .addColumn('finding_id', 'integer', (col) =>
      col.references('program_findings.id').onDelete('cascade').notNull()
    )
    .addColumn('title', 'varchar(300)', (col) => col.notNull())
    .addColumn('owner', 'varchar(120)', (col) => col.notNull())
    .addColumn('deadline', 'timestamp', (col) => col.notNull())
    .addColumn('status', 'varchar(20)', (col) => col.notNull().defaultTo('open'))
    // open | in_progress | verification | closed
    .addColumn('reminder_sent_at', 'timestamp')
    .addColumn('created_by', 'varchar(120)')
    .addColumn('created_at', 'timestamp', (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamp', (col) => col.notNull().defaultTo(sql`now()`))
    

  await db.schema
    .createTable('follow_up_evidence')
    .addColumn('id', 'serial', (col) => col.primaryKey())
    .addColumn('tenant_id', 'integer', (col) =>
      col.references('tenants.id').onDelete('cascade').notNull()
    )
    .addColumn('action_id', 'integer', (col) =>
      col.references('improvement_actions.id').onDelete('cascade').notNull()
    )
    .addColumn('cycle', 'varchar(40)', (col) => col.notNull())
    // e.g. "next-term-week-4"
    .addColumn('evidence_ref', 'varchar(300)', (col) => col.notNull())
    .addColumn('decision', 'varchar(20)')
    // effective | insufficient | confounded
    .addColumn('notes', 'text')
    .addColumn('collected_by', 'varchar(120)')
    .addColumn('created_at', 'timestamp', (col) => col.notNull().defaultTo(sql`now()`))
    

  await db.schema
    .createTable('accreditation_exports')
    .addColumn('id', 'serial', (col) => col.primaryKey())
    .addColumn('tenant_id', 'integer', (col) =>
      col.references('tenants.id').onDelete('cascade').notNull()
    )
    .addColumn('map_id', 'integer', (col) =>
      col.references('curriculum_maps.id').onDelete('cascade').notNull()
    )
    .addColumn('standard', 'varchar(120)', (col) => col.notNull())
    // e.g. "UZWQAA-2026", "ABET-EAC", "OFSTED"
    .addColumn('standard_version', 'varchar(40)')
    .addColumn('manifest', 'jsonb', (col) => col.defaultTo(sql`'{}'::jsonb`))
    .addColumn('manifest_hash', 'varchar(64)', (col) => col.notNull())
    .addColumn('exported_by', 'varchar(120)')
    .addColumn('created_at', 'timestamp', (col) => col.notNull().defaultTo(sql`now()`))
    
}

/**
 * @param {import('kysely').Kysely<any>} db
 */
export async function down(db) {
  await db.schema.dropTable('accreditation_exports');
  await db.schema.createIndex('accreditation_exports_map_idx').on('accreditation_exports').columns(['map_id']).execute();
  await db.schema.createIndex('follow_up_evidence_action_idx').on('follow_up_evidence').columns(['action_id']).execute();
  await db.schema.createIndex('improvement_actions_finding_idx').on('improvement_actions').columns(['finding_id']).execute();
  await db.schema.createIndex('program_findings_map_idx').on('program_findings').columns(['map_id']).execute();
  await db.schema.createIndex('evidence_aggregations_map_outcome_idx').on('evidence_aggregations').columns(['map_id', 'outcome_id']).execute();
  await db.schema.createIndex('curriculum_map_entries_outcome_idx').on('curriculum_map_entries').columns(['outcome_id']).execute();
  await db.schema.createIndex('curriculum_map_entries_map_idx').on('curriculum_map_entries').columns(['map_id']).execute();
  await db.schema.dropTable('follow_up_evidence');
  await db.schema.dropTable('improvement_actions');
  await db.schema.dropTable('program_findings');
  await db.schema.dropTable('evidence_aggregations');
  await db.schema.dropTable('curriculum_map_entries');
  await db.schema.dropTable('curriculum_maps');
}
