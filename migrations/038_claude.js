/**
 * Deborah — Migration 038: Claude Native Adapter
 *
 * Prompt 57 — Claude'ni Deborah ichidagi streaming source-synthesis va
 * canonical JSON provider sifatida ulash (research.md §9.2 canonical
 * document, §9.4 provider capability matrix — Claude: server API key,
 * provider UI embed emas, output Deborah render qiladi; §22.9 API key
 * browserga chiqmaydi; §15 security). Precondition: Prompt 50 source
 * packs + Prompt 56 canonical deck.
 *
 *   - claude_provider_configs: provider registry (model, enabled,
 *     status, quota, max_tokens, temperature, terms_ok) — API key
 *     HECH QACHON DB'da saqlanmaydi (env/KMS'da).
 *   - claude_synthesis_jobs: source-synthesis job — title, audience,
 *     language, theme, slide_count, tone, source_pack_ids jsonb,
 *     request_hash (idempotency UNIQUE), status queued|running|
 *     completed|failed, model, prompt_ref, attribution jsonb, usage
 *     jsonb (input/output tokens + cost), error, created_by.
 *   - claude_job_events: streaming SSE/job progress event log —
 *     event_type, payload jsonb (delta fragments), seq.
 *   - claude_usage: per tenant/day token + cost accounting.
 *   - claude_circuit_breakers: retry/circuit state per tenant+model —
 *     failure_count, open_until, last_error.
 *   - claude_attributions: citation/search-result mapping — job slide
 *     → source_pack link (research.md §9.2 citations + §22.11: AI
 *     references real DB'dan tekshiriladi).
 *
 * SECURITY / DATA GUARD (Prompt 57 §15):
 *   - API key browserga va DB'ga chiqmaydi (faqat server env/KMS).
 *   - Student PII default yuborilmaydi (assertNoStudentPii guard).
 *   - Har bir write path tenant-scoped + idempotent.
 */

import { sql } from 'kysely';

/**
 * @param {import('kysely').Kysely<any>} db
 */
export async function up(db) {
  // ── 1. claude_provider_configs — provider registry (no API key stored) ──
  await db.schema
    .createTable('claude_provider_configs')
    .addColumn('id', 'serial', (col) => col.primaryKey())
    .addColumn('tenant_id', 'integer', (col) =>
      col.references('tenants.id').onDelete('cascade').notNull()
    )
    .addColumn('provider', 'varchar(40)', (col) => col.notNull().defaultTo('claude'))
    .addColumn('model', 'varchar(80)', (col) => col.notNull())
    .addColumn('enabled', 'boolean', (col) => col.notNull().defaultTo(false))
    .addColumn('status', 'varchar(20)', (col) => col.notNull().defaultTo('disabled'))
    .addColumn('quota_limit_daily', 'integer', (col) => col.notNull().defaultTo(100))
    .addColumn('max_tokens', 'integer', (col) => col.notNull().defaultTo(4096))
    .addColumn('temperature', sql`numeric(3,2)`, (col) => col.notNull().defaultTo(0.3))
    .addColumn('terms_ok', 'boolean', (col) => col.notNull().defaultTo(false))
    .addColumn('created_at', 'timestamp', (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamp', (col) => col.notNull().defaultTo(sql`now()`))
    .addUniqueConstraint('claude_provider_tenant_model', ['tenant_id', 'provider', 'model']).execute()

  // ── 2. claude_synthesis_jobs — streaming source-synthesis job ──
  await db.schema
    .createTable('claude_synthesis_jobs')
    .addColumn('id', 'serial', (col) => col.primaryKey())
    .addColumn('tenant_id', 'integer', (col) =>
      col.references('tenants.id').onDelete('cascade').notNull()
    )
    .addColumn('request_hash', 'varchar(64)', (col) => col.notNull())
    .addColumn('title', 'varchar(200)', (col) => col.notNull())
    .addColumn('audience', 'varchar(120)')
    .addColumn('language', 'varchar(10)', (col) => col.notNull().defaultTo('uz'))
    .addColumn('theme', 'varchar(40)', (col) => col.notNull().defaultTo('default'))
    .addColumn('slide_count', 'integer', (col) => col.notNull().defaultTo(10))
    .addColumn('tone', 'varchar(40)', (col) => col.notNull().defaultTo('formal'))
    .addColumn('source_pack_ids', 'jsonb', (col) => col.defaultTo(sql`'[]'::jsonb`))
    .addColumn('model', 'varchar(80)')
    .addColumn('prompt_ref', 'varchar(120)')
    .addColumn('status', 'varchar(20)', (col) => col.notNull().defaultTo('queued'))
    // queued | running | completed | failed
    .addColumn('canonical_document', 'jsonb')
    // Validated canonical deck (§9.2) — raw provider response HECH QACHON
    .addColumn('attribution', 'jsonb', (col) => col.defaultTo(sql`'[]'::jsonb`))
    .addColumn('usage', 'jsonb', (col) => col.defaultTo(sql`'{}'::jsonb`))
    .addColumn('error', 'text')
    .addColumn('created_by', 'varchar(120)')
    .addColumn('created_at', 'timestamp', (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamp', (col) => col.notNull().defaultTo(sql`now()`))
    .addUniqueConstraint('claude_jobs_tenant_hash', ['tenant_id', 'request_hash']).execute()

  // ── 3. claude_job_events — streaming SSE/job progress ──
  await db.schema
    .createTable('claude_job_events')
    .addColumn('id', 'serial', (col) => col.primaryKey())
    .addColumn('job_id', 'integer', (col) =>
      col.references('claude_synthesis_jobs.id').onDelete('cascade').notNull()
    )
    .addColumn('seq', 'integer', (col) => col.notNull().defaultTo(1))
    .addColumn('event_type', 'varchar(40)', (col) => col.notNull())
    // message_start | content_block_start | content_block_delta |
    // content_block_stop | message_delta | message_stop | ping | error | job_*
    .addColumn('payload', 'jsonb', (col) => col.defaultTo(sql`'{}'::jsonb`))
    .addColumn('created_at', 'timestamp', (col) => col.notNull().defaultTo(sql`now()`))
    .addUniqueConstraint('claude_job_events_job_seq', ['job_id', 'seq']).execute()

  // ── 4. claude_usage — per tenant/day token + cost ──
  await db.schema
    .createTable('claude_usage')
    .addColumn('id', 'serial', (col) => col.primaryKey())
    .addColumn('tenant_id', 'integer', (col) =>
      col.references('tenants.id').onDelete('cascade').notNull()
    )
    .addColumn('provider', 'varchar(40)', (col) => col.notNull().defaultTo('claude'))
    .addColumn('model', 'varchar(80)', (col) => col.notNull())
    .addColumn('day', 'date', (col) => col.notNull())
    .addColumn('input_tokens', 'bigint', (col) => col.notNull().defaultTo(0))
    .addColumn('output_tokens', 'bigint', (col) => col.notNull().defaultTo(0))
    .addColumn('cache_creation_tokens', 'bigint', (col) => col.notNull().defaultTo(0))
    .addColumn('cache_read_tokens', 'bigint', (col) => col.notNull().defaultTo(0))
    .addColumn('cost_estimate', sql`numeric(12,6)`, (col) => col.notNull().defaultTo(0))
    .addColumn('request_count', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('updated_at', 'timestamp', (col) => col.notNull().defaultTo(sql`now()`))
    .addUniqueConstraint('claude_usage_tenant_day_model', ['tenant_id', 'provider', 'model', 'day']).execute()

  // ── 5. claude_circuit_breakers — retry/circuit state ──
  await db.schema
    .createTable('claude_circuit_breakers')
    .addColumn('id', 'serial', (col) => col.primaryKey())
    .addColumn('tenant_id', 'integer', (col) =>
      col.references('tenants.id').onDelete('cascade').notNull()
    )
    .addColumn('provider', 'varchar(40)', (col) => col.notNull().defaultTo('claude'))
    .addColumn('model', 'varchar(80)', (col) => col.notNull())
    .addColumn('failure_count', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('open_until', 'timestamp')
    .addColumn('last_error', 'text')
    .addColumn('updated_at', 'timestamp', (col) => col.notNull().defaultTo(sql`now()`))
    .addUniqueConstraint('claude_circuit_tenant_model', ['tenant_id', 'provider', 'model']).execute()

  // ── 6. claude_attributions — citation/search-result mapping ──
  await db.schema
    .createTable('claude_attributions')
    .addColumn('id', 'serial', (col) => col.primaryKey())
    .addColumn('tenant_id', 'integer', (col) =>
      col.references('tenants.id').onDelete('cascade').notNull()
    )
    .addColumn('job_id', 'integer', (col) =>
      col.references('claude_synthesis_jobs.id').onDelete('cascade').notNull()
    )
    .addColumn('slide_id', 'varchar(80)')
    .addColumn('citation_key', 'varchar(120)', (col) => col.notNull())
    .addColumn('source_pack_id', 'integer', (col) =>
      col.references('source_packs.id').onDelete('set null')
    )
    .addColumn('title', 'varchar(300)')
    .addColumn('url', 'text')
    .addColumn('created_at', 'timestamp', (col) => col.notNull().defaultTo(sql`now()`)).execute()
}

/**
 * @param {import('kysely').Kysely<any>} db
 */
export async function down(db) {
  await db.schema.dropTable('claude_attributions');
  await db.schema.dropTable('claude_circuit_breakers');
  await db.schema.dropTable('claude_usage');
  await db.schema.dropTable('claude_job_events');
  await db.schema.dropTable('claude_synthesis_jobs');
  await db.schema.dropTable('claude_provider_configs');
}
