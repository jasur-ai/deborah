/**
 * Edikit — Migration 047: External Integration Boundary (HEMIS & OneID)
 *
 * Prompt 66 — rasmiy contract mavjud bo'lganda roster/grade va identity
 * integration'ni xavfsiz ulash (research.md §12 identity assurance, §19
 * provider adapter contract, §27 data governance, §30 Google login ≠ shaxs).
 * Precondition: Prompt 16 roster (staging), Prompt 47 ratified grade
 * (sis_outbox/board_decisions), Prompt 12/13 identity (account-linking)
 * tayyor.
 *
 * Tables:
 *   - external_connections: provider (hemis|oneid) connection registry —
 *     mode sandbox|live, base_url, client_id, scopes, rate_limit. Tokenlar
 *     bu yerda emas, token_vault'da (envelope encryption).
 *   - external_sync_jobs: pull/push job ledger — direction (pull|push),
 *     entity (roster|grade|identity), status FSM
 *     pending→running→success|failed→dead_letter, idempotency_key (UNIQUE
 *     tenant+hash), attempts/max_attempts, next_retry_at (backoff),
 *     payload_hash, external_ref, last_error.
 *   - external_field_maps: source-of-truth field mapping — provider,
 *     entity, source_field → target_field, direction (inbound|outbound),
 *     required, transform.
 *   - token_vault: OAuth/API token storage — provider, token_type
 *     (access|refresh|id), ciphertext + iv + keyRef (envelope encryption:
 *     per-token DEK, DEK master key bilan o'raladi), scope, expires_at,
 *     revoked_at, last_used_at. Plaintext HECH QACHON saqlanmaydi.
 *   - external_identities: OneID account link registry — user_id,
 *     provider_subject (PINFL/sub), assurance_level (I0–I4 §30.1), status
 *     pending|linked|revoked. Account takeover guard: subject verified
 *     identity bilan mos bo'lishi shart.
 *
 * SECURITY / DATA GUARD (Prompt 66 §15-17):
 *   - Scraping, undocumented endpoint va token reuse taqiqlanadi
 *     (schema: assertDocumentedEndpoint, assertNoTokenReuse).
 *   - Ratified-only grade push (§15 — ratifikatsiyasiz push yo'q).
 *   - Har write path tenant-scoped + fail-closed + idempotent + audited.
 *   - Privileged actionlar (connection, push, reconcile, token vault,
 *     OneID link) audit event va trace bilan.
 */

import { sql } from 'kysely';

/**
 * @param {import('kysely').Kysely<any>} db
 */
export async function up(db) {
  // ── 1. external_connections ──
  await db.schema
    .createTable('external_connections')
    .addColumn('id', 'serial', (col) => col.primaryKey())
    .addColumn('tenant_id', 'integer', (col) =>
      col.references('tenants.id').onDelete('cascade').notNull()
    )
    .addColumn('provider', 'varchar(20)', (col) => col.notNull())
    // hemis | oneid
    .addColumn('mode', 'varchar(10)', (col) => col.notNull().defaultTo('sandbox'))
    // sandbox | live
    .addColumn('base_url', 'varchar(300)')
    .addColumn('client_id', 'varchar(200)')
    .addColumn('scopes', 'varchar(500)')
    .addColumn('status', 'varchar(20)', (col) => col.notNull().defaultTo('configured'))
    // configured | disabled | error
    .addColumn('rate_limit_rps', 'integer', (col) => col.notNull().defaultTo(5))
    .addColumn('contract_version', 'varchar(40)', (col) => col.notNull().defaultTo('0'))
    .addColumn('last_sync_at', 'timestamptz')
    .addColumn('created_by', 'varchar(120)')
    .addColumn('created_at', 'timestamptz', (col) => col.defaultTo(sql`now()`).notNull())
    .addColumn('updated_at', 'timestamptz', (col) => col.defaultTo(sql`now()`).notNull())
    .addUniqueConstraint('external_connections_tenant_provider_uniq', ['tenant_id', 'provider']);

  // ── 2. external_sync_jobs ──
  await db.schema
    .createTable('external_sync_jobs')
    .addColumn('id', 'serial', (col) => col.primaryKey())
    .addColumn('tenant_id', 'integer', (col) =>
      col.references('tenants.id').onDelete('cascade').notNull()
    )
    .addColumn('connection_id', 'integer', (col) =>
      col.references('external_connections.id').onDelete('cascade').notNull()
    )
    .addColumn('direction', 'varchar(10)', (col) => col.notNull())
    // pull | push
    .addColumn('entity', 'varchar(20)', (col) => col.notNull())
    // roster | grade | identity
    .addColumn('status', 'varchar(20)', (col) => col.notNull().defaultTo('pending'))
    // pending → running → success | failed → dead_letter
    .addColumn('idempotency_key', 'varchar(64)', (col) => col.notNull())
    .addColumn('attempts', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('max_attempts', 'integer', (col) => col.notNull().defaultTo(5))
    .addColumn('next_retry_at', 'timestamptz')
    .addColumn('payload_hash', 'varchar(64)')
    .addColumn('external_ref', 'varchar(200)')
    .addColumn('last_error', 'text')
    .addColumn('created_by', 'varchar(120)')
    .addColumn('created_at', 'timestamptz', (col) => col.defaultTo(sql`now()`).notNull())
    .addColumn('updated_at', 'timestamptz', (col) => col.defaultTo(sql`now()`).notNull())
    .addColumn('completed_at', 'timestamptz')
    .addUniqueConstraint('external_sync_jobs_tenant_idem_uniq', ['tenant_id', 'idempotency_key']);

  // ── 3. external_field_maps ──
  await db.schema
    .createTable('external_field_maps')
    .addColumn('id', 'serial', (col) => col.primaryKey())
    .addColumn('tenant_id', 'integer', (col) =>
      col.references('tenants.id').onDelete('cascade').notNull()
    )
    .addColumn('provider', 'varchar(20)', (col) => col.notNull())
    .addColumn('entity', 'varchar(20)', (col) => col.notNull())
    .addColumn('source_field', 'varchar(100)', (col) => col.notNull())
    .addColumn('target_field', 'varchar(100)', (col) => col.notNull())
    .addColumn('direction', 'varchar(10)', (col) => col.notNull().defaultTo('inbound'))
    // inbound | outbound | both
    .addColumn('required', 'boolean', (col) => col.notNull().defaultTo(false))
    .addColumn('transform', 'varchar(40)')
    .addColumn('created_by', 'varchar(120)')
    .addColumn('created_at', 'timestamptz', (col) => col.defaultTo(sql`now()`).notNull())
    .addUniqueConstraint('external_field_maps_tenant_key_uniq', [
      'tenant_id', 'provider', 'entity', 'source_field', 'target_field',
    ]);

  // ── 4. token_vault ──
  await db.schema
    .createTable('token_vault')
    .addColumn('id', 'serial', (col) => col.primaryKey())
    .addColumn('tenant_id', 'integer', (col) =>
      col.references('tenants.id').onDelete('cascade').notNull()
    )
    .addColumn('connection_id', 'integer', (col) =>
      col.references('external_connections.id').onDelete('cascade').notNull()
    )
    .addColumn('provider', 'varchar(20)', (col) => col.notNull())
    .addColumn('token_type', 'varchar(20)', (col) => col.notNull())
    // access | refresh | id
    .addColumn('ciphertext', 'text', (col) => col.notNull())
    .addColumn('iv', 'varchar(32)', (col) => col.notNull())
    .addColumn('key_ref', 'text', (col) => col.notNull())
    .addColumn('scope', 'varchar(200)')
    .addColumn('expires_at', 'timestamptz')
    .addColumn('last_used_at', 'timestamptz')
    .addColumn('revoked_at', 'timestamptz')
    .addColumn('revoked_by', 'varchar(120)')
    .addColumn('created_by', 'varchar(120)')
    .addColumn('created_at', 'timestamptz', (col) => col.defaultTo(sql`now()`).notNull());

  // ── 5. external_identities (OneID account links) ──
  await db.schema
    .createTable('external_identities')
    .addColumn('id', 'serial', (col) => col.primaryKey())
    .addColumn('tenant_id', 'integer', (col) =>
      col.references('tenants.id').onDelete('cascade').notNull()
    )
    .addColumn('user_id', 'integer', (col) =>
      col.references('users.id').onDelete('cascade').notNull()
    )
    .addColumn('provider', 'varchar(20)', (col) => col.notNull())
    .addColumn('provider_subject', 'varchar(200)', (col) => col.notNull())
    // OneID PINFL / sub
    .addColumn('assurance_level', 'varchar(5)', (col) => col.notNull().defaultTo('I0'))
    // I0..I4 (research §30.1)
    .addColumn('status', 'varchar(20)', (col) => col.notNull().defaultTo('pending'))
    // pending | linked | revoked
    .addColumn('linked_by', 'varchar(120)')
    .addColumn('linked_at', 'timestamptz')
    .addColumn('revoked_at', 'timestamptz')
    .addColumn('revoked_by', 'varchar(120)')
    .addColumn('created_at', 'timestamptz', (col) => col.defaultTo(sql`now()`).notNull());

  // Partial unique index — har user+provider uchun faqat bitta ACTIVE
  // (pending|linked) link bo'lishi mumkin; revoked row audit trail sifatida
  // qoladi va re-link (revoke'dan keyin qayta bog'lash) mumkin bo'ladi.
  await db.schema
    .createIndex('external_identities_tenant_user_provider_active_uniq')
    .on('external_identities')
    .columns(['tenant_id', 'user_id', 'provider'])
    .unique()
    .where(sql`status <> 'revoked'`)
    .execute();
}

/**
 * @param {import('kysely').Kysely<any>} db
 */
export async function down(db) {
  await db.schema.dropTable('external_identities');
  await db.schema.dropTable('token_vault');
  await db.schema.dropTable('external_field_maps');
  await db.schema.dropTable('external_sync_jobs');
  await db.schema.dropTable('external_connections');
}
