/**
 * Deborah — Migration 048: API, Socket, Job, Webhook & Outbox Contract Audit
 *
 * Prompt 67 — barcha module boundarylarini versionlangan Zod/OpenAPI/event
 * contractlar bilan birlashtirish (research.md §18 service boundaries va
 * API draft, §19 provider adapter contract).
 * Precondition: asosiy domain modullar implement qilingan.
 *
 * Tables:
 *   - api_route_registry: /api/v1 route inventory — method, path, version,
 *     auth_level (public|user|admin), module, idempotent, etag_support,
 *     cursor_pagination, documented (undocumented privileged endpoint
 *     qolmasligi shart — §24 stop condition).
 *   - api_contracts: versionlangan Zod/OpenAPI contract registry —
 *     contract_name, kind (request|response|event|job), version, spec jsonb
 *     (OpenAPI 3.1 schema), schema_hash, status draft|published|deprecated.
 *   - socket_event_contracts: Socket event allowlist — event_name, version,
 *     auth (public|host|player|admin), rate_limit_group, spec, schema_hash.
 *     Allowlistdan tashqari event qabul qilinmaydi (fail-closed).
 *   - webhook_events: webhook delivery ledger — provider, event_id UNIQUE
 *     (replay dedup), event_type, version, signature_ok, received_at,
 *     processed_at, seq (out-of-order detection), status.
 *   - outbox_messages: transactional outbox + consumer idempotency —
 *     outbox_type, payload, version, status FSM pending→processing→
 *     delivered|failed→dead_letter, consumer_key UNIQUE (idempotency),
 *     attempts, next_retry_at, trace_id.
 *
 * SECURITY / DATA GUARD (Prompt 67 §15-17):
 *   - Private scoring / sensitive case generic API schema'ga qo'shilmaydi
 *     (schema: assertNoSensitiveInGenericSchema).
 *   - Har write path tenant-scoped + fail-closed + idempotent + audited.
 *   - Undocumented privileged endpoint yoki unversioned event qolmasligi
 *     shart (stop condition §24).
 */

import { sql } from 'kysely';

/**
 * @param {import('kysely').Kysely<any>} db
 */
export async function up(db) {
  // ── 1. api_route_registry ──
  await db.schema
    .createTable('api_route_registry')
    .addColumn('id', 'serial', (col) => col.primaryKey())
    .addColumn('tenant_id', 'integer', (col) =>
      col.references('tenants.id').onDelete('cascade').notNull()
    )
    .addColumn('method', 'varchar(10)', (col) => col.notNull())
    // GET | POST | PUT | PATCH | DELETE
    .addColumn('path', 'varchar(300)', (col) => col.notNull())
    .addColumn('version', 'varchar(10)', (col) => col.notNull().defaultTo('v1'))
    .addColumn('auth_level', 'varchar(20)', (col) => col.notNull().defaultTo('public'))
    // public | user | admin
    .addColumn('module', 'varchar(60)', (col) => col.notNull())
    .addColumn('idempotent', 'boolean', (col) => col.notNull().defaultTo(false))
    .addColumn('etag_support', 'boolean', (col) => col.notNull().defaultTo(false))
    .addColumn('cursor_pagination', 'boolean', (col) => col.notNull().defaultTo(false))
    .addColumn('documented', 'boolean', (col) => col.notNull().defaultTo(false))
    .addColumn('contract_name', 'varchar(120)')
    .addColumn('created_by', 'varchar(120)')
    .addColumn('created_at', 'timestamptz', (col) => col.defaultTo(sql`now()`).notNull())
    .addColumn('updated_at', 'timestamptz', (col) => col.defaultTo(sql`now()`).notNull())
    .addUniqueConstraint('api_route_registry_tenant_method_path_uniq', ['tenant_id', 'method', 'path', 'version']).execute()

  // ── 2. api_contracts ──
  await db.schema
    .createTable('api_contracts')
    .addColumn('id', 'serial', (col) => col.primaryKey())
    .addColumn('tenant_id', 'integer', (col) =>
      col.references('tenants.id').onDelete('cascade').notNull()
    )
    .addColumn('contract_name', 'varchar(120)', (col) => col.notNull())
    .addColumn('kind', 'varchar(20)', (col) => col.notNull())
    // request | response | event | job
    .addColumn('version', 'varchar(10)', (col) => col.notNull().defaultTo('v1'))
    .addColumn('spec', 'jsonb', (col) => col.notNull())
    // OpenAPI 3.1 schema object (zod → toJSONSchema)
    .addColumn('schema_hash', 'varchar(64)', (col) => col.notNull())
    .addColumn('status', 'varchar(20)', (col) => col.notNull().defaultTo('draft'))
    // draft | published | deprecated
    .addColumn('published_by', 'varchar(120)')
    .addColumn('published_at', 'timestamptz')
    .addColumn('created_by', 'varchar(120)')
    .addColumn('created_at', 'timestamptz', (col) => col.defaultTo(sql`now()`).notNull())
    .addColumn('updated_at', 'timestamptz', (col) => col.defaultTo(sql`now()`).notNull())
    .addUniqueConstraint('api_contracts_tenant_name_ver_uniq', ['tenant_id', 'contract_name', 'version']).execute()

  // ── 3. socket_event_contracts (allowlist) ──
  await db.schema
    .createTable('socket_event_contracts')
    .addColumn('id', 'serial', (col) => col.primaryKey())
    .addColumn('tenant_id', 'integer', (col) =>
      col.references('tenants.id').onDelete('cascade').notNull()
    )
    .addColumn('event_name', 'varchar(80)', (col) => col.notNull())
    .addColumn('version', 'varchar(10)', (col) => col.notNull().defaultTo('v1'))
    .addColumn('auth', 'varchar(20)', (col) => col.notNull().defaultTo('public'))
    // public | host | player | admin
    .addColumn('rate_limit_group', 'varchar(40)', (col) => col.notNull().defaultTo('default'))
    .addColumn('spec', 'jsonb', (col) => col.notNull())
    .addColumn('schema_hash', 'varchar(64)', (col) => col.notNull())
    .addColumn('documented', 'boolean', (col) => col.notNull().defaultTo(false))
    .addColumn('created_by', 'varchar(120)')
    .addColumn('created_at', 'timestamptz', (col) => col.defaultTo(sql`now()`).notNull())
    .addColumn('updated_at', 'timestamptz', (col) => col.defaultTo(sql`now()`).notNull())
    .addUniqueConstraint('socket_event_contracts_tenant_event_ver_uniq', ['tenant_id', 'event_name', 'version']).execute()

  // ── 4. webhook_events (replay/out-of-order ledger) ──
  await db.schema
    .createTable('webhook_events')
    .addColumn('id', 'serial', (col) => col.primaryKey())
    .addColumn('tenant_id', 'integer', (col) =>
      col.references('tenants.id').onDelete('cascade').notNull()
    )
    .addColumn('provider', 'varchar(40)', (col) => col.notNull())
    .addColumn('event_id', 'varchar(120)', (col) => col.notNull())
    .addColumn('event_type', 'varchar(80)', (col) => col.notNull())
    .addColumn('version', 'varchar(10)', (col) => col.notNull().defaultTo('v1'))
    .addColumn('signature_ok', 'boolean', (col) => col.notNull().defaultTo(false))
    .addColumn('received_at', 'timestamptz', (col) => col.defaultTo(sql`now()`).notNull())
    .addColumn('processed_at', 'timestamptz')
    .addColumn('seq', 'bigint')
    .addColumn('status', 'varchar(20)', (col) => col.notNull().defaultTo('received'))
    // received | processed | rejected | out_of_order
    .addColumn('error', 'text')
    .addUniqueConstraint('webhook_events_tenant_event_id_uniq', ['tenant_id', 'provider', 'event_id']).execute()

  // ── 5. outbox_messages (transactional outbox + consumer idempotency) ──
  await db.schema
    .createTable('outbox_messages')
    .addColumn('id', 'serial', (col) => col.primaryKey())
    .addColumn('tenant_id', 'integer', (col) =>
      col.references('tenants.id').onDelete('cascade').notNull()
    )
    .addColumn('outbox_type', 'varchar(60)', (col) => col.notNull())
    .addColumn('payload', 'jsonb', (col) => col.notNull())
    .addColumn('version', 'varchar(10)', (col) => col.notNull().defaultTo('v1'))
    .addColumn('status', 'varchar(20)', (col) => col.notNull().defaultTo('pending'))
    // pending → processing → delivered | failed → dead_letter
    .addColumn('consumer_key', 'varchar(64)', (col) => col.notNull())
    .addColumn('attempts', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('max_attempts', 'integer', (col) => col.notNull().defaultTo(5))
    .addColumn('next_retry_at', 'timestamptz')
    .addColumn('trace_id', 'varchar(64)')
    .addColumn('last_error', 'text')
    .addColumn('processed_at', 'timestamptz')
    .addColumn('created_by', 'varchar(120)')
    .addColumn('created_at', 'timestamptz', (col) => col.defaultTo(sql`now()`).notNull())
    .addColumn('updated_at', 'timestamptz', (col) => col.defaultTo(sql`now()`).notNull())
    .addUniqueConstraint('outbox_messages_tenant_consumer_uniq', ['tenant_id', 'consumer_key']).execute()
}

/**
 * @param {import('kysely').Kysely<any>} db
 */
export async function down(db) {
  await db.schema.dropTable('outbox_messages');
  await db.schema.dropTable('webhook_events');
  await db.schema.dropTable('socket_event_contracts');
  await db.schema.dropTable('api_contracts');
  await db.schema.dropTable('api_route_registry');
}
