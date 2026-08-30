/**
 * Deborah — Migration 033: AI Evaluation, MLOps & Rollback (Prompt 52)
 *
 * Prompt 52 — golden set, deployment gate, drift va model rollbackni
 * production boshqaruviga aylantirish (research.md §7.7 metrics,
 * §20 Phase 3 "Written AI Grading" QWK/fairness dashboard, §30 identity
 * assurance). Precondition: Prompt 51 shadow runs + human gold marks.
 *
 *   - ai_models: model registry — provider, version (pin), status
 *     draft → active → disabled | retired, allowlisted flag, eval_threshold.
 *   - ai_model_pins: version pin/allowlist — bitta active model+version
 *     (deployment gate: faqat allowlisted version production'da).
 *   - ai_eval_datasets: golden/adversarial dataset versioning — kind
 *     golden | adversarial, status, holdout flag (GOLDEN SET TRAININGGA
 *     QO'SHILMAYDI — §15 data guard), item_count, eval_metric.
 *   - ai_eval_items: dataset items — input_hash (reproducible), gold_score
 *     (human gold mark), subgroup (language/course/faculty fairness §7.7).
 *   - ai_eval_runs: evaluation run — model_id + dataset_id, metrics
 *     qwk/mae/f1/ece/override_rate, passed (threshold), status, drift flag.
 *   - ai_subgroup_metrics: language/subgroup breakdown — subgroup, n,
 *     qwk, mae, exact_agreement (Uzbek/Russian/English gap §7.7).
 *   - ai_gate_decisions: OFFLINE→SHADOW→ASSIST gate service — stage,
 *     decision (approved|rejected|pending), threshold_vs_actual, decided_by.
 *   - ai_drift_events: drift detection — metric, baseline_vs_current,
 *     severity, window_start/end.
 *   - ai_rollback_events: rollback/disable kill switch — action
 *     (disable|rollback|retire), reason, triggered_by (threshold|manual),
 *     runbook_ref. OLD FINAL GRADE SILENT REGRADE QILINMAYDI (§15).
 *
 * SECURITY / DATA GUARD (Prompt 52 §15-17):
 *   - Golden set trainingga qo'shilmaydi (holdout flag — eval only).
 *   - Old final grade silent regrade qilinmaydi — rollback faqat model
 *     status'ni o'zgartiradi, hech qachon existing final'ni qayta yozmaydi.
 *   - Har bir write path tenant-scoped + idempotent (UNIQUE indexlar).
 *   - Model version pin/allowlist — stop condition nazorati.
 */

import { sql } from 'kysely';

/**
 * @param {import('kysely').Kysely<any>} db
 */
export async function up(db) {
  // ── 1. ai_models — model registry ──
  await db.schema
    .createTable('ai_models')
    .addColumn('id', 'serial', (col) => col.primaryKey())
    .addColumn('tenant_id', 'integer', (col) =>
      col.references('tenants.id').onDelete('cascade').notNull()
    )
    .addColumn('name', 'varchar(64)', (col) => col.notNull())
    .addColumn('provider', 'varchar(32)', (col) => col.notNull().defaultTo('unknown'))
    .addColumn('version', 'varchar(32)', (col) => col.notNull())
    // draft → active → disabled | retired
    .addColumn('status', 'varchar(12)', (col) => col.notNull().defaultTo('draft'))
    .addColumn('allowlisted', 'boolean', (col) => col.notNull().defaultTo(false))
    // deployment gate: threshold met bo'lsagina allowlist mumkin
    .addColumn('eval_metric', 'varchar(16)', (col) => col.notNull().defaultTo('qwk'))
    .addColumn('eval_threshold', sql`decimal(4,3)`, (col) => col.notNull().defaultTo(0.8))
    .addColumn('created_by', 'integer')
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamptz')
    .execute();

  // Model + version idempotency (bitta model bir versiya — registry)
  await sql`
    CREATE UNIQUE INDEX uq_ai_model_name_version
    ON ai_models (tenant_id, name, version)
  `.execute(db);
  await db.schema
    .createIndex('idx_ai_model_status')
    .on('ai_models')
    .columns(['tenant_id', 'status'])
    .execute();

  // ── 2. ai_model_pins — version pin/allowlist ──
  await db.schema
    .createTable('ai_model_pins')
    .addColumn('id', 'serial', (col) => col.primaryKey())
    .addColumn('tenant_id', 'integer', (col) =>
      col.references('tenants.id').onDelete('cascade').notNull()
    )
    .addColumn('model_id', 'integer', (col) =>
      col.references('ai_models.id').onDelete('cascade').notNull()
    )
    // pinned model_version — production'da aynan shu versiya ishlaydi
    .addColumn('model_version', 'varchar(32)', (col) => col.notNull())
    .addColumn('pinned_by', 'integer')
    .addColumn('pinned_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .execute();

  // Bitta active pin — har tenant uchun bitta model pin
  await sql`
    CREATE UNIQUE INDEX uq_ai_model_pin_one
    ON ai_model_pins (tenant_id, model_id)
  `.execute(db);

  // ── 3. ai_eval_datasets — golden/adversarial dataset versioning ──
  await db.schema
    .createTable('ai_eval_datasets')
    .addColumn('id', 'serial', (col) => col.primaryKey())
    .addColumn('tenant_id', 'integer', (col) =>
      col.references('tenants.id').onDelete('cascade').notNull()
    )
    .addColumn('name', 'varchar(160)', (col) => col.notNull())
    .addColumn('version', 'varchar(16)', (col) => col.notNull().defaultTo('v1'))
    // golden | adversarial
    .addColumn('kind', 'varchar(16)', (col) => col.notNull().defaultTo('golden'))
    // draft → active → retired
    .addColumn('status', 'varchar(12)', (col) => col.notNull().defaultTo('draft'))
    // HOLD: golden set trainingga qo'shilmaydi — faqat eval (Prompt 52 §15)
    .addColumn('holdout', 'boolean', (col) => col.notNull().defaultTo(true))
    .addColumn('item_count', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('created_by', 'integer')
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .execute();

  await sql`
    CREATE UNIQUE INDEX uq_ai_eval_dataset_name_version
    ON ai_eval_datasets (tenant_id, name, version)
  `.execute(db);

  // ── 4. ai_eval_items — golden/adversarial items ──
  await db.schema
    .createTable('ai_eval_items')
    .addColumn('id', 'serial', (col) => col.primaryKey())
    .addColumn('tenant_id', 'integer', (col) =>
      col.references('tenants.id').onDelete('cascade').notNull()
    )
    .addColumn('dataset_id', 'integer', (col) =>
      col.references('ai_eval_datasets.id').onDelete('cascade').notNull()
    )
    .addColumn('input_hash', 'varchar(64)', (col) => col.notNull())
    // human gold mark — Prompt 51 shadow run'dan yoki teacher adjudication
    .addColumn('gold_score', sql`decimal(8,2)`, (col) => col.notNull())
    .addColumn('ai_score', sql`decimal(8,2)`)
    // subgroup: language (uz|ru|en) / course_code / faculty (fairness §7.7)
    .addColumn('subgroup', 'varchar(32)')
    .addColumn('gold_response', 'text')
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .execute();

  // Idempotency: bir item bir marta (dataset + input_hash)
  await sql`
    CREATE UNIQUE INDEX uq_ai_eval_item_hash
    ON ai_eval_items (tenant_id, dataset_id, input_hash)
  `.execute(db);
  await db.schema
    .createIndex('idx_ai_eval_item_dataset')
    .on('ai_eval_items')
    .columns(['tenant_id', 'dataset_id'])
    .execute();

  // ── 5. ai_eval_runs — evaluation run (metrics snapshot) ──
  await db.schema
    .createTable('ai_eval_runs')
    .addColumn('id', 'serial', (col) => col.primaryKey())
    .addColumn('tenant_id', 'integer', (col) =>
      col.references('tenants.id').onDelete('cascade').notNull()
    )
    .addColumn('model_id', 'integer', (col) =>
      col.references('ai_models.id').onDelete('cascade').notNull()
    )
    .addColumn('dataset_id', 'integer', (col) =>
      col.references('ai_eval_datasets.id').onDelete('cascade').notNull()
    )
    // queued → running → completed | failed
    .addColumn('status', 'varchar(12)', (col) => col.notNull().defaultTo('queued'))
    .addColumn('qwk', sql`decimal(4,4)`)
    .addColumn('mae', sql`decimal(8,4)`)
    .addColumn('f1', sql`decimal(4,4)`)
    .addColumn('ece', sql`decimal(4,4)`)
    .addColumn('override_rate', sql`decimal(4,4)`)
    .addColumn('exact_agreement', sql`decimal(4,4)`)
    .addColumn('items_evaluated', 'integer', (col) => col.notNull().defaultTo(0))
    // deployment gate: threshold met bo'lsa passed=true
    .addColumn('passed', 'boolean')
    .addColumn('threshold', sql`decimal(4,3)`)
    .addColumn('drift_detected', 'boolean', (col) => col.notNull().defaultTo(false))
    .addColumn('notes', 'varchar(1000)')
    .addColumn('created_by', 'integer')
    .addColumn('completed_at', 'timestamptz')
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .execute();

  await db.schema
    .createIndex('idx_ai_eval_run_model')
    .on('ai_eval_runs')
    .columns(['tenant_id', 'model_id', 'dataset_id', 'created_at'])
    .execute();

  // ── 6. ai_subgroup_metrics — language/subgroup fairness breakdown ──
  await db.schema
    .createTable('ai_subgroup_metrics')
    .addColumn('id', 'serial', (col) => col.primaryKey())
    .addColumn('tenant_id', 'integer', (col) =>
      col.references('tenants.id').onDelete('cascade').notNull()
    )
    .addColumn('run_id', 'integer', (col) =>
      col.references('ai_eval_runs.id').onDelete('cascade').notNull()
    )
    .addColumn('subgroup', 'varchar(32)', (col) => col.notNull())
    .addColumn('n', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('qwk', sql`decimal(4,4)`)
    .addColumn('mae', sql`decimal(8,4)`)
    .addColumn('exact_agreement', sql`decimal(4,4)`)
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .execute();

  await sql`
    CREATE UNIQUE INDEX uq_ai_subgroup_run
    ON ai_subgroup_metrics (tenant_id, run_id, subgroup)
  `.execute(db);

  // ── 7. ai_gate_decisions — OFFLINE→SHADOW→ASSIST gate service ──
  await db.schema
    .createTable('ai_gate_decisions')
    .addColumn('id', 'serial', (col) => col.primaryKey())
    .addColumn('tenant_id', 'integer', (col) =>
      col.references('tenants.id').onDelete('cascade').notNull()
    )
    .addColumn('model_id', 'integer', (col) =>
      col.references('ai_models.id').onDelete('cascade').notNull()
    )
    .addColumn('run_id', 'integer', (col) =>
      col.references('ai_eval_runs.id').onDelete('cascade')
    )
    // offline → shadow → assist
    .addColumn('stage', 'varchar(12)', (col) => col.notNull())
    // approved | rejected | pending
    .addColumn('decision', 'varchar(12)', (col) => col.notNull().defaultTo('pending'))
    .addColumn('threshold', sql`decimal(4,3)`)
    .addColumn('actual', sql`decimal(4,4)`)
    .addColumn('reason', 'varchar(1000)')
    .addColumn('decided_by', 'integer')
    .addColumn('decided_at', 'timestamptz')
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .execute();

  await sql`
    CREATE UNIQUE INDEX uq_ai_gate_model_stage
    ON ai_gate_decisions (tenant_id, model_id, stage)
  `.execute(db);

  // ── 8. ai_drift_events — drift detection ──
  await db.schema
    .createTable('ai_drift_events')
    .addColumn('id', 'serial', (col) => col.primaryKey())
    .addColumn('tenant_id', 'integer', (col) =>
      col.references('tenants.id').onDelete('cascade').notNull()
    )
    .addColumn('model_id', 'integer', (col) =>
      col.references('ai_models.id').onDelete('cascade').notNull()
    )
    .addColumn('run_id', 'integer', (col) =>
      col.references('ai_eval_runs.id').onDelete('cascade')
    )
    .addColumn('metric', 'varchar(16)', (col) => col.notNull())
    .addColumn('baseline', sql`decimal(8,4)`)
    .addColumn('current', sql`decimal(8,4)`)
    .addColumn('severity', 'varchar(10)', (col) => col.notNull().defaultTo('low'))
    // low | medium | high
    .addColumn('window_start', 'timestamptz')
    .addColumn('window_end', 'timestamptz')
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .execute();

  await db.schema
    .createIndex('idx_ai_drift_model')
    .on('ai_drift_events')
    .columns(['tenant_id', 'model_id', 'created_at'])
    .execute();

  // ── 9. ai_rollback_events — rollback/disable kill switch ──
  await db.schema
    .createTable('ai_rollback_events')
    .addColumn('id', 'serial', (col) => col.primaryKey())
    .addColumn('tenant_id', 'integer', (col) =>
      col.references('tenants.id').onDelete('cascade').notNull()
    )
    .addColumn('model_id', 'integer', (col) =>
      col.references('ai_models.id').onDelete('cascade').notNull()
    )
    // disable | rollback | retire
    .addColumn('action', 'varchar(12)', (col) => col.notNull())
    .addColumn('reason', 'varchar(1000)')
    // threshold | manual
    .addColumn('triggered_by', 'varchar(12)', (col) => col.notNull().defaultTo('manual'))
    .addColumn('from_status', 'varchar(12)')
    .addColumn('to_status', 'varchar(12)')
    .addColumn('runbook_ref', 'varchar(160)')
    .addColumn('actor_id', 'integer')
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .execute();

  await db.schema
    .createIndex('idx_ai_rollback_model')
    .on('ai_rollback_events')
    .columns(['tenant_id', 'model_id', 'created_at'])
    .execute();

  // ── Grants (sql-template pattern) ──
  const newTables = [
    'ai_models',
    'ai_model_pins',
    'ai_eval_datasets',
    'ai_eval_items',
    'ai_eval_runs',
    'ai_subgroup_metrics',
    'ai_gate_decisions',
    'ai_drift_events',
    'ai_rollback_events',
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
    'ai_rollback_events',
    'ai_drift_events',
    'ai_gate_decisions',
    'ai_subgroup_metrics',
    'ai_eval_runs',
    'ai_eval_items',
    'ai_eval_datasets',
    'ai_model_pins',
    'ai_models',
  ];
  for (const table of tables) {
    await db.schema.dropTable(table).ifExists().execute();
  }
}
