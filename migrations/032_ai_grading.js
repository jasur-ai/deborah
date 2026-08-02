/**
 * Edikit — Migration 032: Written AI Grading Shadow Mode (Prompt 51)
 *
 * Prompt 51 — rubric/evidence structured AI draft'ni student/final
 * grade'dan YASHIRIN shadow rejimda ishlatish (research.md §7.4 rubric
 * model, §7.5 confidence routing, §7.7 metrics, §20 Phase 3 "Written AI
 * Grading"):
 *
 *   - ai_grading_jobs: batch registry — rubric_version_id, model +
 *     exact model_version (stop condition nazorat), prompt_template_version,
 *     status queued → running → completed | failed.
 *   - ai_grading_runs: per-submission shadow run — job_id, work_item_id
 *     (pseudonym'dan o'tadi — student identity marker ko'rmaydi),
 *     pii_redacted flag, input_hash (reproducibility), total_score,
 *     confidence, routing_decision (auto_draft|grading_queue|human_review),
 *     provider_response jsonb (output), status.
 *   - ai_criterion_results: per-criterion AI result — criterion_id, score
 *     (rubric level mappingdan — erkin raqam EMAS), level, confidence,
 *     missing_concepts, contradictions_found, feedback.
 *   - ai_evidence_spans: normalized evidence spans — concept, span_start/
 *     span_end (response ichidagi aniq joy), span_text — citation/
 *     evidence integrity (har bir AI score evidence span bilan).
 *   - ai_human_overrides: teacher compare/override/reason — overridden_score,
 *     reason, teacher_id. SHADOW HECh QACHON final grade'ni o'zgartirmaydi
 *     (shadow run teacher finalini qayd qilmaydi — faqat solishtiradi).
 *
 * SECURITY / DATA GUARD (Prompt 51 §15-17):
 *   - LLM total score final authority EMAS — final faqat teacher.
 *   - PII redaction — provider'ga student identity kirmaydi (pseudonym +
 *     pii_redacted flag).
 *   - Model web/tool access qilmaydi — provider_response faqat structured
 *     JSON, input faqat redacted response + rubric (no URLs/tools).
 *   - Har bir write path tenant-scoped + idempotent (UNIQUE indexlar).
 */

import { sql } from 'kysely';

/**
 * @param {import('kysely').Kysely<any>} db
 */
export async function up(db) {
  // ── 1. ai_grading_jobs — batch registry ──
  await db.schema
    .createTable('ai_grading_jobs')
    .addColumn('id', 'serial', (col) => col.primaryKey())
    .addColumn('tenant_id', 'integer', (col) =>
      col.references('tenants.id').onDelete('cascade').notNull()
    )
    .addColumn('rubric_version_id', 'integer', (col) =>
      col.references('rubric_versions.id').onDelete('cascade')
    )
    .addColumn('name', 'varchar(160)', (col) => col.notNull())
    .addColumn('model', 'varchar(64)', (col) => col.notNull())
    // exact model version — stop condition nazorati (o'zgarishi shart emas,
    // lekin har job'da pin qilinadi)
    .addColumn('model_version', 'varchar(32)', (col) => col.notNull())
    .addColumn('prompt_template_version', 'varchar(16)', (col) => col.notNull().defaultTo('v1'))
    .addColumn('status', 'varchar(12)', (col) => col.notNull().defaultTo('queued'))
    // queued → running → completed | failed
    .addColumn('run_count', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('total_score', 'numeric(10,2)')
    .addColumn('created_by', 'integer')
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(db.fn.now()))
    .addColumn('updated_at', 'timestamptz', (col) => col.notNull().defaultTo(db.fn.now()))
    .execute();

  await db.schema
    .createIndex('idx_ai_job_tenant_status')
    .on('ai_grading_jobs')
    .columns(['tenant_id', 'status'])
    .execute();

  // ── 2. ai_grading_runs — per-submission shadow run ──
  await db.schema
    .createTable('ai_grading_runs')
    .addColumn('id', 'serial', (col) => col.primaryKey())
    .addColumn('tenant_id', 'integer', (col) =>
      col.references('tenants.id').onDelete('cascade').notNull()
    )
    .addColumn('job_id', 'integer', (col) =>
      col.references('ai_grading_jobs.id').onDelete('cascade').notNull()
    )
    .addColumn('work_item_id', 'integer', (col) =>
      col.references('marking_work_items.id').onDelete('cascade')
    )
    .addColumn('pseudonym', 'varchar(24)', (col) => col.notNull())
    // marker student identity ko'rmaydi — faqat pseudonym
    .addColumn('pii_redacted', 'boolean', (col) => col.notNull().defaultTo(false))
    .addColumn('input_hash', 'varchar(64)', (col) => col.notNull())
    // reproducible — bir xil input → bir xil hash
    .addColumn('status', 'varchar(12)', (col) => col.notNull().defaultTo('queued'))
    // queued → running → completed | failed
    .addColumn('total_score', 'decimal(8,2)')
    .addColumn('confidence', 'decimal(4,2)')
    // routing_decision: auto_draft | grading_queue | human_review (§7.5)
    .addColumn('routing_decision', 'varchar(16)')
    .addColumn('provider_response', 'jsonb')
    .addColumn('error', 'varchar(500)')
    .addColumn('started_at', 'timestamptz')
    .addColumn('completed_at', 'timestamptz')
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(db.fn.now()))
    .execute();

  // Idempotency: bitta job + bitta work item → bitta shadow run
  await sql`
    CREATE UNIQUE INDEX uq_ai_run_job_workitem
    ON ai_grading_runs (tenant_id, job_id, work_item_id)
  `.execute(db);
  await db.schema
    .createIndex('idx_ai_run_job')
    .on('ai_grading_runs')
    .columns(['tenant_id', 'job_id', 'status'])
    .execute();

  // ── 3. ai_criterion_results — per-criterion AI result ──
  await db.schema
    .createTable('ai_criterion_results')
    .addColumn('id', 'serial', (col) => col.primaryKey())
    .addColumn('tenant_id', 'integer', (col) =>
      col.references('tenants.id').onDelete('cascade').notNull()
    )
    .addColumn('run_id', 'integer', (col) =>
      col.references('ai_grading_runs.id').onDelete('cascade').notNull()
    )
    .addColumn('criterion_id', 'integer', (col) =>
      col.references('rubric_criteria.id').onDelete('cascade')
    )
    .addColumn('criterion_name', 'varchar(255)')
    .addColumn('score', 'decimal(8,2)', (col) => col.notNull())
    // rubric level mappingdan — model erkin raqam chiqara olmaydi
    .addColumn('level', 'integer')
    .addColumn('confidence', 'decimal(4,2)')
    .addColumn('missing_concepts', 'jsonb', (col) => col.defaultTo('[]'))
    .addColumn('contradictions_found', 'jsonb', (col) => col.defaultTo('[]'))
    .addColumn('feedback', 'varchar(2000)')
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(db.fn.now()))
    .execute();

  await db.schema
    .createIndex('idx_ai_criterion_run')
    .on('ai_criterion_results')
    .columns(['tenant_id', 'run_id'])
    .execute();

  // ── 4. ai_evidence_spans — normalized evidence spans ──
  await db.schema
    .createTable('ai_evidence_spans')
    .addColumn('id', 'serial', (col) => col.primaryKey())
    .addColumn('tenant_id', 'integer', (col) =>
      col.references('tenants.id').onDelete('cascade').notNull()
    )
    .addColumn('run_id', 'integer', (col) =>
      col.references('ai_grading_runs.id').onDelete('cascade').notNull()
    )
    .addColumn('criterion_result_id', 'integer', (col) =>
      col.references('ai_criterion_results.id').onDelete('cascade')
    )
    .addColumn('concept', 'varchar(160)', (col) => col.notNull())
    .addColumn('span_start', 'integer', (col) => col.notNull())
    .addColumn('span_end', 'integer', (col) => col.notNull())
    .addColumn('span_text', 'varchar(600)')
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(db.fn.now()))
    .execute();

  await db.schema
    .createIndex('idx_ai_span_run')
    .on('ai_evidence_spans')
    .columns(['tenant_id', 'run_id'])
    .execute();

  // ── 5. ai_human_overrides — teacher compare/override/reason ──
  await db.schema
    .createTable('ai_human_overrides')
    .addColumn('id', 'serial', (col) => col.primaryKey())
    .addColumn('tenant_id', 'integer', (col) =>
      col.references('tenants.id').onDelete('cascade').notNull()
    )
    .addColumn('run_id', 'integer', (col) =>
      col.references('ai_grading_runs.id').onDelete('cascade').notNull()
    )
    .addColumn('work_item_id', 'integer', (col) =>
      col.references('marking_work_items.id').onDelete('cascade')
    )
    .addColumn('ai_total_score', 'decimal(8,2)', (col) => col.notNull())
    .addColumn('overridden_score', 'decimal(8,2)', (col) => col.notNull())
    .addColumn('reason', 'varchar(1000)')
    .addColumn('teacher_id', 'integer', (col) => col.notNull())
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(db.fn.now()))
    .execute();

  await db.schema
    .createIndex('idx_ai_override_run')
    .on('ai_human_overrides')
    .columns(['tenant_id', 'run_id'])
    .execute();

  // ── Grants (sql-template pattern) ──
  const newTables = [
    'ai_grading_jobs',
    'ai_grading_runs',
    'ai_criterion_results',
    'ai_evidence_spans',
    'ai_human_overrides',
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
    'ai_human_overrides',
    'ai_evidence_spans',
    'ai_criterion_results',
    'ai_grading_runs',
    'ai_grading_jobs',
  ];
  for (const table of tables) {
    await db.schema.dropTable(table).ifExists().execute();
  }
}
