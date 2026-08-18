/**
 * Deborah — Migration 034: AI Question Generator 50/30/20 (Prompt 53)
 *
 * Prompt 53 — source-grounded, difficulty-controlled item draft pipeline
 * (research.md §8 AI test generatori, §8.6 lifecycle, §21 acceptance).
 * Precondition: Prompt 20 competency, Prompt 21 item bank, Prompt 50
 * source pack.
 *
 *   - ai_gen_blueprints: generation input/blueprint — course/grade,
 *     competency_id, source_pack_id, target item count, difficulty
 *     distribution (50/30/20 default, teacher slider override),
 *     item types, model provider, status (draft → running → completed).
 *   - ai_gen_jobs: per-slot candidate jobs — slot (easy|medium|hard),
 *     requested_count, overgenerate factor (3–5), status, error.
 *   - ai_gen_candidates: generated candidates — stem, options, correct_key,
 *     rationale, source_refs (chunk_id), difficulty, cognitive_level,
 *     distractor_rationales, validation summary, status
 *     ai_draft → reviewed → approved → published | rejected | retired.
 *   - ai_gen_validations: per-candidate validator results — answer_verifier,
 *     source_grounded, ambiguity, multi_correct, duplicate, language,
 *     accessibility, difficulty (each ok + note).
 *   - ai_gen_reviews: teacher review/edit/reject/publish trail —
 *     reviewer_id, decision, note, published_item_id (item-bank link).
 *
 * SECURITY / DATA GUARD (Prompt 53 §15-17):
 *   - AI_DRAFT teacher approval'siz APPROVED bo'lmaydi (lifecycle guard).
 *   - Source-grounded: verifyCitation — javob faqat approved source
 *     chunk'laridan isbotlanishi kerak.
 *   - Har bir write path tenant-scoped + idempotent (UNIQUE indexlar).
 *   - Publish faqat APPROVED candidate → item-bank createItem (source:
 *     ai_generated).
 */

import { sql } from 'kysely';

/**
 * @param {import('kysely').Kysely<any>} db
 */
export async function up(db) {
  // ── 1. ai_gen_blueprints — generation input/blueprint ──
  await db.schema
    .createTable('ai_gen_blueprints')
    .addColumn('id', 'serial', (col) => col.primaryKey())
    .addColumn('tenant_id', 'integer', (col) =>
      col.references('tenants.id').onDelete('cascade').notNull()
    )
    .addColumn('name', 'varchar(160)', (col) => col.notNull())
    .addColumn('competency_id', 'integer', (col) =>
      col.references('competencies.id').onDelete('set null')
    )
    .addColumn('source_pack_id', 'integer', (col) =>
      col.references('source_packs.id').onDelete('set null')
    )
    .addColumn('subject_area', 'varchar(64)')
    .addColumn('education_level', 'varchar(32)')
    .addColumn('language', 'varchar(16)', (col) => col.notNull().defaultTo('uz'))
    // 50/30/20: easy=floor(N*0.5), medium=floor(N*0.3), hard=N-easy-medium
    .addColumn('target_count', 'integer', (col) => col.notNull())
    .addColumn('easy_ratio', 'numeric(3,2)', (col) => col.notNull().defaultTo(0.5))
    .addColumn('medium_ratio', 'numeric(3,2)', (col) => col.notNull().defaultTo(0.3))
    .addColumn('hard_ratio', 'numeric(3,2)', (col) => col.notNull().defaultTo(0.2))
    .addColumn('item_types', 'jsonb', (col) => col.notNull().defaultTo('["single_choice"]'))
    .addColumn('model', 'varchar(64)', (col) => col.notNull().defaultTo('unknown'))
    .addColumn('model_version', 'varchar(32)')
    .addColumn('prompt_version', 'varchar(16)', (col) => col.notNull().defaultTo('v1'))
    .addColumn('status', 'varchar(12)', (col) => col.notNull().defaultTo('draft'))
    // draft → running → completed | failed
    .addColumn('created_by', 'integer')
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(db.fn.now()))
    .addColumn('completed_at', 'timestamptz')
    .execute();

  await db.schema
    .createIndex('idx_ai_gen_blueprint_tenant')
    .on('ai_gen_blueprints')
    .columns(['tenant_id', 'status', 'created_at'])
    .execute();

  // ── 2. ai_gen_jobs — per-slot candidate jobs ──
  await db.schema
    .createTable('ai_gen_jobs')
    .addColumn('id', 'serial', (col) => col.primaryKey())
    .addColumn('tenant_id', 'integer', (col) =>
      col.references('tenants.id').onDelete('cascade').notNull()
    )
    .addColumn('blueprint_id', 'integer', (col) =>
      col.references('ai_gen_blueprints.id').onDelete('cascade').notNull()
    )
    .addColumn('slot', 'varchar(10)', (col) => col.notNull())
    // easy | medium | hard
    .addColumn('requested_count', 'integer', (col) => col.notNull())
    .addColumn('overgenerate_factor', 'integer', (col) => col.notNull().defaultTo(3))
    // 3–5 candidate overgenerate (§8.3 step 4)
    .addColumn('status', 'varchar(12)', (col) => col.notNull().defaultTo('queued'))
    // queued → running → completed | failed
    .addColumn('error', 'varchar(500)')
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(db.fn.now()))
    .addColumn('completed_at', 'timestamptz')
    .execute();

  // Idempotency: bitta blueprint + bitta slot → bitta job
  await sql`
    CREATE UNIQUE INDEX uq_ai_gen_job_blueprint_slot
    ON ai_gen_jobs (tenant_id, blueprint_id, slot)
  `.execute(db);
  await db.schema
    .createIndex('idx_ai_gen_job_blueprint')
    .on('ai_gen_jobs')
    .columns(['tenant_id', 'blueprint_id', 'status'])
    .execute();

  // ── 3. ai_gen_candidates — generated items ──
  await db.schema
    .createTable('ai_gen_candidates')
    .addColumn('id', 'serial', (col) => col.primaryKey())
    .addColumn('tenant_id', 'integer', (col) =>
      col.references('tenants.id').onDelete('cascade').notNull()
    )
    .addColumn('job_id', 'integer', (col) =>
      col.references('ai_gen_jobs.id').onDelete('cascade').notNull()
    )
    .addColumn('blueprint_id', 'integer', (col) =>
      col.references('ai_gen_blueprints.id').onDelete('cascade').notNull()
    )
    .addColumn('stem', 'text', (col) => col.notNull())
    .addColumn('options', 'jsonb', (col) => col.notNull().defaultTo('[]'))
    // [{ key: "A", text: "...", isCorrect: false, misconception: "..." }]
    .addColumn('correct_key', 'varchar(4)', (col) => col.notNull())
    .addColumn('rationale', 'text')
    .addColumn('source_refs', 'jsonb', (col) => col.defaultTo('[]'))
    // [{ chunkId, sourceId, spanStart, spanEnd, quote }]
    .addColumn('difficulty', 'varchar(10)', (col) => col.notNull().defaultTo('medium'))
    .addColumn('cognitive_level', 'varchar(20)')
    // remember | understand | apply | analyze | evaluate | create
    .addColumn('question_type', 'varchar(30)', (col) => col.notNull().defaultTo('single_choice'))
    .addColumn('distractor_rationales', 'jsonb', (col) => col.defaultTo('[]'))
    .addColumn('validation_summary', 'jsonb', (col) => col.defaultTo('{}'))
    // { allOk, failed: [names] }
    .addColumn('status', 'varchar(16)', (col) => col.notNull().defaultTo('ai_draft'))
    // ai_draft → reviewed → approved → published | rejected | retired
    .addColumn('input_hash', 'varchar(64)')
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(db.fn.now()))
    .addColumn('updated_at', 'timestamptz', (col) => col.notNull().defaultTo(db.fn.now()))
    .execute();

  await db.schema
    .createIndex('idx_ai_gen_cand_job')
    .on('ai_gen_candidates')
    .columns(['tenant_id', 'job_id', 'status'])
    .execute();
  // Duplicate guard: bir xil stem bir marta
  await sql`
    CREATE UNIQUE INDEX uq_ai_gen_cand_hash
    ON ai_gen_candidates (tenant_id, job_id, input_hash)
  `.execute(db);

  // ── 4. ai_gen_validations — per-candidate validator results ──
  await db.schema
    .createTable('ai_gen_validations')
    .addColumn('id', 'serial', (col) => col.primaryKey())
    .addColumn('tenant_id', 'integer', (col) =>
      col.references('tenants.id').onDelete('cascade').notNull()
    )
    .addColumn('candidate_id', 'integer', (col) =>
      col.references('ai_gen_candidates.id').onDelete('cascade').notNull()
    )
    .addColumn('validator', 'varchar(24)', (col) => col.notNull())
    // answer_verifier | source_grounded | ambiguity | multi_correct |
    // duplicate | language | accessibility | difficulty
    .addColumn('ok', 'boolean', (col) => col.notNull())
    .addColumn('note', 'varchar(500)')
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(db.fn.now()))
    .execute();

  await sql`
    CREATE UNIQUE INDEX uq_ai_gen_valid_candidate
    ON ai_gen_validations (tenant_id, candidate_id, validator)
  `.execute(db);

  // ── 5. ai_gen_reviews — teacher review trail ──
  await db.schema
    .createTable('ai_gen_reviews')
    .addColumn('id', 'serial', (col) => col.primaryKey())
    .addColumn('tenant_id', 'integer', (col) =>
      col.references('tenants.id').onDelete('cascade').notNull()
    )
    .addColumn('candidate_id', 'integer', (col) =>
      col.references('ai_gen_candidates.id').onDelete('cascade').notNull()
    )
    .addColumn('decision', 'varchar(12)', (col) => col.notNull())
    // approve | reject | publish | retire | edit
    .addColumn('note', 'varchar(1000)')
    .addColumn('edited_stem', 'text')
    .addColumn('edited_options', 'jsonb')
    .addColumn('published_item_id', 'integer')
    .addColumn('reviewer_id', 'integer')
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(db.fn.now()))
    .execute();

  await db.schema
    .createIndex('idx_ai_gen_review_candidate')
    .on('ai_gen_reviews')
    .columns(['tenant_id', 'candidate_id', 'created_at'])
    .execute();

  // ── Grants (sql-template pattern) ──
  const newTables = [
    'ai_gen_blueprints',
    'ai_gen_jobs',
    'ai_gen_candidates',
    'ai_gen_validations',
    'ai_gen_reviews',
  ];
  for (const table of newTables) {
    await sql`GRANT SELECT, INSERT, UPDATE ON ${sql.table(table)} TO deborah_runtime`.execute(db);
    await sql`GRANT USAGE ON ${sql.table(table)}_id_seq TO deborah_runtime`.execute(db);
    await sql`GRANT DELETE ON ${sql.table(table)} TO deborah_migration`.execute(db);
  }
}

/**
 * @param {import('kysely').Kysely<any>} db
 */
export async function down(db) {
  const tables = [
    'ai_gen_reviews',
    'ai_gen_validations',
    'ai_gen_candidates',
    'ai_gen_jobs',
    'ai_gen_blueprints',
  ];
  for (const table of tables) {
    await db.schema.dropTable(table).ifExists().execute();
  }
}
