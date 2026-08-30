/**
 * Deborah — Migration 039: Unified Provider Job Contract (Gamma + Manus)
 *
 * Prompt 58 — Gamma generation va Manus task/artifact oqimlarini unified
 * provider job contractga ulash (research.md §9.2 canonical document,
 * §9.4 provider capability matrix — Gamma: create-oriented API, edit
 * Gamma'da, preview iframe; Manus: task/file/webhook, 5–15 min job;
 * §9.5-9.6 flows; §22.8 Google token boshqa provider'ga uzatilmaydi;
 * §22.9 provider API key browserga chiqmaydi). Precondition: Prompt 56
 * provider-independent presentation service tayyor.
 *
 * Unified contract (ikkala provider bitta job model):
 *   - provider_configs: provider registry (gamma|manus) — API key HECH
 *     QACHON DB'da saqlanmaydi (env'da, alohida credential).
 *   - provider_jobs: create/poll/cancel/webhook bitta jadvalda —
 *     request_hash (idempotency UNIQUE), status queued|running|
 *     completed|failed|cancelled|webhook_pending, preview/export URL,
 *     artifact_key (object storage), attribution, usage.
 *   - provider_job_events: unified job progress/event log (seq).
 *   - provider_circuit_breakers: retry/circuit per tenant+provider.
 *   - provider_dead_letters: qayta ishlamaydigan provider failure'lar.
 *   - provider_artifacts: expiring provider artifact → Deborah object
 *     storage copy registry (stop condition: expiring artifact copy).
 *
 * SECURITY / DATA GUARD (Prompt 58 §15-17):
 *   - Credentiallar alohida (env) — provider_configs'da faqat enabled/
 *     status/quota/terms_ok; API key yo'q.
 *   - Gamma embedded edit capability YO'Q — soxta edit bermaymiz,
 *     capability/limitation UI'da aniq ko'rsatamiz.
 *   - Har bir write path tenant-scoped + idempotent (request_hash).
 */

import { sql } from 'kysely';

/**
 * @param {import('kysely').Kysely<any>} db
 */
export async function up(db) {
  // ── 1. provider_configs — unified provider registry (no API key stored) ──
  await db.schema
    .createTable('provider_configs')
    .addColumn('id', 'serial', (col) => col.primaryKey())
    .addColumn('tenant_id', 'integer', (col) =>
      col.references('tenants.id').onDelete('cascade').notNull()
    )
    .addColumn('provider', 'varchar(40)', (col) => col.notNull())
    // gamma | manus
    .addColumn('model', 'varchar(80)', (col) => col.notNull())
    // Gamma: gamma-v1 | Manus: manus-v2
    .addColumn('enabled', 'boolean', (col) => col.notNull().defaultTo(false))
    .addColumn('status', 'varchar(20)', (col) => col.notNull().defaultTo('disabled'))
    .addColumn('quota_limit_daily', 'integer', (col) => col.notNull().defaultTo(50))
    .addColumn('terms_ok', 'boolean', (col) => col.notNull().defaultTo(false))
    .addColumn('capabilities', 'jsonb', (col) => col.defaultTo(sql`'{}'::jsonb`))
    // { create: true, poll: true, cancel: true, webhook: false, previewIframe: true, embeddedEdit: false }
    .addColumn('created_at', 'timestamp', (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamp', (col) => col.notNull().defaultTo(sql`now()`))
    .addUniqueConstraint('provider_configs_tenant_provider_model', ['tenant_id', 'provider', 'model']).execute()

  // ── 2. provider_jobs — unified async provider job ──
  await db.schema
    .createTable('provider_jobs')
    .addColumn('id', 'serial', (col) => col.primaryKey())
    .addColumn('tenant_id', 'integer', (col) =>
      col.references('tenants.id').onDelete('cascade').notNull()
    )
    .addColumn('request_hash', 'varchar(64)', (col) => col.notNull())
    .addColumn('provider', 'varchar(40)', (col) => col.notNull())
    // gamma | manus
    .addColumn('kind', 'varchar(40)', (col) => col.notNull().defaultTo('presentation'))
    .addColumn('title', 'varchar(200)', (col) => col.notNull())
    .addColumn('brief', 'jsonb', (col) => col.defaultTo(sql`'{}'::jsonb`))
    // { audience, language, theme, tone, numCards, sourcePackIds, projectId, fileIds }
    .addColumn('provider_job_id', 'varchar(120)')
    // Gamma: generation id | Manus: task id
    .addColumn('provider_project_id', 'varchar(120)')
    // Manus: project id
    .addColumn('status', 'varchar(20)', (col) => col.notNull().defaultTo('queued'))
    // queued | running | webhook_pending | completed | failed | cancelled
    .addColumn('preview_url', 'text')
    // Gamma: gammaUrl / Manus: artifact viewer URL
    .addColumn('export_url', 'text')
    // Expiring provider export (PDF/PPTX) — copy qilinishi kerak
    .addColumn('artifact_key', 'varchar(300)')
    // Deborah object storage key (copied, non-expiring)
    .addColumn('artifact_meta', 'jsonb', (col) => col.defaultTo(sql`'{}'::jsonb`))
    // { format, size, sha256, storageType, copiedAt, sourceUrl }
    .addColumn('attribution', 'jsonb', (col) => col.defaultTo(sql`'[]'::jsonb`))
    .addColumn('usage', 'jsonb', (col) => col.defaultTo(sql`'{}'::jsonb`))
    .addColumn('error', 'text')
    .addColumn('created_by', 'varchar(120)')
    .addColumn('created_at', 'timestamp', (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamp', (col) => col.notNull().defaultTo(sql`now()`))
    .addUniqueConstraint('provider_jobs_tenant_hash', ['tenant_id', 'request_hash']).execute()

  // ── 3. provider_job_events — unified job progress/event log ──
  await db.schema
    .createTable('provider_job_events')
    .addColumn('id', 'serial', (col) => col.primaryKey())
    .addColumn('job_id', 'integer', (col) =>
      col.references('provider_jobs.id').onDelete('cascade').notNull()
    )
    .addColumn('seq', 'integer', (col) => col.notNull().defaultTo(1))
    .addColumn('event_type', 'varchar(40)', (col) => col.notNull())
    // job_created | job_polling | job_completed | job_failed | job_cancelled |
    // webhook_received | webhook_verified | artifact_copied | follow_up_sent | error
    .addColumn('payload', 'jsonb', (col) => col.defaultTo(sql`'{}'::jsonb`))
    .addColumn('created_at', 'timestamp', (col) => col.notNull().defaultTo(sql`now()`))
    .addUniqueConstraint('provider_job_events_job_seq', ['job_id', 'seq']).execute()

  // ── 4. provider_circuit_breakers — retry/circuit per tenant+provider ──
  await db.schema
    .createTable('provider_circuit_breakers')
    .addColumn('id', 'serial', (col) => col.primaryKey())
    .addColumn('tenant_id', 'integer', (col) =>
      col.references('tenants.id').onDelete('cascade').notNull()
    )
    .addColumn('provider', 'varchar(40)', (col) => col.notNull())
    .addColumn('model', 'varchar(80)', (col) => col.notNull())
    .addColumn('failure_count', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('open_until', 'timestamp')
    .addColumn('last_error', 'text')
    .addColumn('updated_at', 'timestamp', (col) => col.notNull().defaultTo(sql`now()`))
    .addUniqueConstraint('provider_circuit_tenant_provider_model', ['tenant_id', 'provider', 'model']).execute()

  // ── 5. provider_dead_letters — qayta ishlamaydigan failure'lar ──
  await db.schema
    .createTable('provider_dead_letters')
    .addColumn('id', 'serial', (col) => col.primaryKey())
    .addColumn('tenant_id', 'integer', (col) =>
      col.references('tenants.id').onDelete('cascade').notNull()
    )
    .addColumn('provider', 'varchar(40)', (col) => col.notNull())
    .addColumn('job_id', 'integer', (col) =>
      col.references('provider_jobs.id').onDelete('cascade').notNull()
    )
    .addColumn('attempt', 'integer', (col) => col.notNull().defaultTo(1))
    .addColumn('error', 'text')
    .addColumn('payload', 'jsonb', (col) => col.defaultTo(sql`'{}'::jsonb`))
    .addColumn('created_at', 'timestamp', (col) => col.notNull().defaultTo(sql`now()`)).execute()

  // ── 6. provider_artifacts — expiring artifact → object storage copy ──
  await db.schema
    .createTable('provider_artifacts')
    .addColumn('id', 'serial', (col) => col.primaryKey())
    .addColumn('tenant_id', 'integer', (col) =>
      col.references('tenants.id').onDelete('cascade').notNull()
    )
    .addColumn('provider', 'varchar(40)', (col) => col.notNull())
    .addColumn('job_id', 'integer', (col) =>
      col.references('provider_jobs.id').onDelete('cascade').notNull()
    )
    .addColumn('kind', 'varchar(20)', (col) => col.notNull())
    // preview | export | raw
    .addColumn('format', 'varchar(20)')
    // pptx | pdf | html | json
    .addColumn('storage_key', 'varchar(300)', (col) => col.notNull())
    .addColumn('size', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('sha256', 'varchar(64)')
    .addColumn('expiring', 'boolean', (col) => col.notNull().defaultTo(false))
    .addColumn('source_url', 'text')
    .addColumn('copied_at', 'timestamp')
    .addColumn('created_at', 'timestamp', (col) => col.notNull().defaultTo(sql`now()`))
    .addUniqueConstraint('provider_artifacts_job_kind', ['provider', 'job_id', 'kind']).execute()
}

/**
 * @param {import('kysely').Kysely<any>} db
 */
export async function down(db) {
  await db.schema.dropTable('provider_artifacts');
  await db.schema.dropTable('provider_dead_letters');
  await db.schema.dropTable('provider_circuit_breakers');
  await db.schema.dropTable('provider_job_events');
  await db.schema.dropTable('provider_jobs');
  await db.schema.dropTable('provider_configs');
}
