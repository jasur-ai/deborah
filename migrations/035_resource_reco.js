/**
 * Edikit — Migration 035: Resource Recommendation Connectors (Prompt 54)
 *
 * Prompt 54 — maqola, paper, video, news va institutional materialni
 * verified metadata bilan tavsiya qilish (research.md §11 manba tavsiyasi,
 * §19 provider adapter contract, §34 RAG). Precondition: Prompt 50
 * source model + provider job infrastructure.
 *
 *   - resource_providers: connector registry (openalex | semantic_scholar |
 *     crossref | core | youtube | rss) — base_url, enabled, quota (daily
 *     limit, used, window), terms_ok (ToS compliance), status
 *     (active | degraded | disabled), config jsonb (api key env ref).
 *   - resource_records: canonical deduped records — provider + external_id
 *     UNIQUE; title, authors jsonb, url, doi (unique where present),
 *     type (paper | article | video | news | institutional), language,
 *     license, is_open_access, publication_date, citations, description,
 *     metadata jsonb (normalized provider raw), title_norm (dedupe hash).
 *   - resource_searches: idempotent searches — tenant_id, query_hash
 *     UNIQUE, query_text, topic, context, limit, providers jsonb, status.
 *   - resource_search_results: search_id + record_id UNIQUE — rank, score,
 *     per-component breakdown jsonb (relevance/authority/recency/citations/
 *     pedagogy/language/license/preference), why_recommended.
 *   - resource_feedback: teacher trust | hide | save | source_pack —
 *     UNIQUE(tenant, record, actor, action) idempotent, source_pack_id
 *     link, note.
 *   - resource_connector_logs: quota/cache/outage audit — provider, kind
 *     (search | resolve | cache), status, retries, latency_ms, error.
 *
 * SECURITY / DATA GUARD (Prompt 54 §15-17):
 *   - LLM hech qachon bibliographic record YARATMAYDI — faqat provider
 *     API'lardan real recordlar olinadi, LLM faqat shu recordlarni
 *     rank/summarize qiladi (assertLlmOnlyRanksRecords).
 *   - YouTube transcript scraping taqiqlangan (checkProviderTerms).
 *   - Har bir write path tenant-scoped + idempotent (UNIQUE indexlar).
 */

import { sql } from 'kysely';

/**
 * @param {import('kysely').Kysely<any>} db
 */
export async function up(db) {
  // ── 1. resource_providers — connector registry ──
  await db.schema
    .createTable('resource_providers')
    .addColumn('id', 'serial', (col) => col.primaryKey())
    .addColumn('tenant_id', 'integer', (col) =>
      col.references('tenants.id').onDelete('cascade').notNull()
    )
    .addColumn('name', 'varchar(40)', (col) => col.notNull())
    .addColumn('base_url', 'varchar(255)')
    .addColumn('enabled', 'boolean', (col) => col.notNull().defaultTo(false))
    .addColumn('status', 'varchar(20)', (col) =>
      col.notNull().defaultTo('disabled')
    )
    .addColumn('quota_limit_daily', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('quota_used', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('quota_window_start', 'timestamp', (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn('terms_ok', 'boolean', (col) => col.notNull().defaultTo(false))
    .addColumn('config', 'jsonb', (col) => col.defaultTo(sql`'{}'::jsonb`))
    .addColumn('last_error', 'text')
    .addColumn('created_at', 'timestamp', (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamp', (col) => col.notNull().defaultTo(sql`now()`))
    .addUniqueConstraint('resource_providers_tenant_name', ['tenant_id', 'name']);

  // ── 2. resource_records — canonical deduped records ──
  await db.schema
    .createTable('resource_records')
    .addColumn('id', 'serial', (col) => col.primaryKey())
    .addColumn('tenant_id', 'integer', (col) =>
      col.references('tenants.id').onDelete('cascade').notNull()
    )
    .addColumn('provider', 'varchar(40)', (col) => col.notNull())
    .addColumn('external_id', 'varchar(255)', (col) => col.notNull())
    .addColumn('title', 'text', (col) => col.notNull())
    .addColumn('title_norm', 'varchar(64)', (col) => col.notNull())
    .addColumn('authors', 'jsonb', (col) => col.defaultTo(sql`'[]'::jsonb`))
    .addColumn('url', 'text')
    .addColumn('doi', 'varchar(255)')
    .addColumn('type', 'varchar(20)', (col) => col.notNull().defaultTo('paper'))
    .addColumn('language', 'varchar(10)', (col) => col.notNull().defaultTo('en'))
    .addColumn('license', 'varchar(100)', (col) => col.notNull().defaultTo('unknown'))
    .addColumn('is_open_access', 'boolean', (col) => col.notNull().defaultTo(false))
    .addColumn('publication_date', 'timestamp')
    .addColumn('citations', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('description', 'text')
    .addColumn('metadata', 'jsonb', (col) => col.defaultTo(sql`'{}'::jsonb`))
    .addColumn('created_at', 'timestamp', (col) => col.notNull().defaultTo(sql`now()`))
    .addUniqueConstraint('resource_records_tenant_provider_ext', [
      'tenant_id',
      'provider',
      'external_id',
    ]);

  // DOI idempotency — bitta tenant'da bitta DOI bir marta
  await db.schema
    .createIndex('resource_records_doi_unique')
    .on('resource_records')
    .columns(['tenant_id', 'doi'])
    .unique()
    .where(sql`doi is not null`);

  // ── 3. resource_searches — idempotent searches ──
  await db.schema
    .createTable('resource_searches')
    .addColumn('id', 'serial', (col) => col.primaryKey())
    .addColumn('tenant_id', 'integer', (col) =>
      col.references('tenants.id').onDelete('cascade').notNull()
    )
    .addColumn('query_hash', 'varchar(64)', (col) => col.notNull())
    .addColumn('query_text', 'text', (col) => col.notNull())
    .addColumn('topic', 'varchar(120)')
    .addColumn('context', 'text')
    .addColumn('limit_count', 'integer', (col) => col.notNull().defaultTo(10))
    .addColumn('providers', 'jsonb', (col) => col.defaultTo(sql`'[]'::jsonb`))
    .addColumn('status', 'varchar(20)', (col) => col.notNull().defaultTo('completed'))
    .addColumn('created_by', 'varchar(120)')
    .addColumn('created_at', 'timestamp', (col) => col.notNull().defaultTo(sql`now()`))
    .addUniqueConstraint('resource_searches_tenant_hash', ['tenant_id', 'query_hash']);

  // ── 4. resource_search_results — ranking output ──
  await db.schema
    .createTable('resource_search_results')
    .addColumn('id', 'serial', (col) => col.primaryKey())
    .addColumn('search_id', 'integer', (col) =>
      col.references('resource_searches.id').onDelete('cascade').notNull()
    )
    .addColumn('record_id', 'integer', (col) =>
      col.references('resource_records.id').onDelete('cascade').notNull()
    )
    .addColumn('rank', 'integer', (col) => col.notNull())
    .addColumn('score', 'numeric(8,4)', (col) => col.notNull())
    .addColumn('components', 'jsonb', (col) => col.defaultTo(sql`'{}'::jsonb`))
    .addColumn('why_recommended', 'text')
    .addColumn('created_at', 'timestamp', (col) => col.notNull().defaultTo(sql`now()`))
    .addUniqueConstraint('resource_search_results_search_record', [
      'search_id',
      'record_id',
    ]);

  // ── 5. resource_feedback — teacher trust/hide/save/source-pack ──
  await db.schema
    .createTable('resource_feedback')
    .addColumn('id', 'serial', (col) => col.primaryKey())
    .addColumn('tenant_id', 'integer', (col) =>
      col.references('tenants.id').onDelete('cascade').notNull()
    )
    .addColumn('record_id', 'integer', (col) =>
      col.references('resource_records.id').onDelete('cascade').notNull()
    )
    .addColumn('actor_id', 'varchar(120)', (col) => col.notNull())
    .addColumn('action', 'varchar(20)', (col) => col.notNull()) // trust|hide|save|source_pack
    .addColumn('note', 'text')
    .addColumn('source_pack_id', 'integer', (col) =>
      col.references('source_packs.id').onDelete('set null')
    )
    .addColumn('created_at', 'timestamp', (col) => col.notNull().defaultTo(sql`now()`))
    .addUniqueConstraint('resource_feedback_tenant_record_actor_action', [
      'tenant_id',
      'record_id',
      'actor_id',
      'action',
    ]);

  // ── 6. resource_connector_logs — quota/cache/outage audit ──
  await db.schema
    .createTable('resource_connector_logs')
    .addColumn('id', 'serial', (col) => col.primaryKey())
    .addColumn('tenant_id', 'integer', (col) =>
      col.references('tenants.id').onDelete('cascade').notNull()
    )
    .addColumn('provider', 'varchar(40)', (col) => col.notNull())
    .addColumn('kind', 'varchar(20)', (col) => col.notNull()) // search|resolve|cache
    .addColumn('status', 'varchar(20)', (col) => col.notNull()) // ok|quota|backoff|outage|error
    .addColumn('retries', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('latency_ms', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('error', 'text')
    .addColumn('created_at', 'timestamp', (col) => col.notNull().defaultTo(sql`now()`));

  // Search results: ranking bo'yicha tez qidiruv
  await db.schema
    .createIndex('resource_search_results_rank_idx')
    .on('resource_search_results')
    .columns(['search_id', 'rank']);
}

/**
 * @param {import('kysely').Kysely<any>} db
 */
export async function down(db) {
  await db.schema.dropTable('resource_search_results');
  await db.schema.dropTable('resource_searches');
  await db.schema.dropTable('resource_feedback');
  await db.schema.dropTable('resource_connector_logs');
  await db.schema.dropTable('resource_records');
  await db.schema.dropTable('resource_providers');
}
