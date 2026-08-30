/**
 * Deborah — Migration 042: Student Evidence Portfolio & Verifiable Credentials
 *
 * Prompt 61 — student evidence portfolio + Open Badges/CLR/VC-compatible
 * credential lifecycle (research.md §25 AI governance — human sign-off on
 * summative/certification; §27 academic integrity — evidence portfolio, not
 * AI detector verdicts). Precondition: Prompt 20 competency + ratified
 * grade/evidence ready.
 *
 * Tables:
 *   - portfolios: default-PRIVATE student evidence portfolio.
 *   - portfolio_items: evidence entries (proposal, outline, drafts,
 *     reflection, credential link) with visibility (private/shared/public).
 *   - share_grants: selective share — token, viewer email, expiry, revoke.
 *   - credential_definitions: versioned credential criteria (issuer authority).
 *   - credentials: issued credential lifecycle (issued/active/revoked/expired).
 *   - credential_events: audit trail (issue/revoke/renew/appeal/status).
 *
 * SECURITY / DATA GUARD (Prompt 61 §15):
 *   - LLM hech qachon credential bermaydi (faqat ratified grade/evidence).
 *   - Raw sensitive submission public credentialga chiqmaydi — public
 *     payload faqat select share maydonlarini o'z ichiga oladi.
 *   - Har write path tenant-scoped + idempotent; privileged action → audit.
 */

import { sql } from 'kysely';

/**
 * @param {import('kysely').Kysely<any>} db
 */
export async function up(db) {
  await db.schema
    .createTable('portfolios')
    .addColumn('id', 'serial', (col) => col.primaryKey())
    .addColumn('tenant_id', 'integer', (col) =>
      col.references('tenants.id').onDelete('cascade').notNull()
    )
    .addColumn('user_id', 'integer', (col) => col.notNull())
    .addColumn('is_public', 'boolean', (col) => col.notNull().defaultTo(false))
    // default-private: faqat owner + explicit share ko'radi
    .addColumn('display_name', 'varchar(120)')
    .addColumn('created_at', 'timestamp', (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamp', (col) => col.notNull().defaultTo(sql`now()`))
    .addUniqueConstraint('portfolio_tenant_user', ['tenant_id', 'user_id']).execute()

  await db.schema
    .createTable('portfolio_items')
    .addColumn('id', 'serial', (col) => col.primaryKey())
    .addColumn('tenant_id', 'integer', (col) =>
      col.references('tenants.id').onDelete('cascade').notNull()
    )
    .addColumn('portfolio_id', 'integer', (col) =>
      col.references('portfolios.id').onDelete('cascade').notNull()
    )
    .addColumn('kind', 'varchar(40)', (col) => col.notNull())
    // proposal | outline | source_shortlist | draft | teacher_feedback |
    // reflection | oral_defense | credential
    .addColumn('title', 'varchar(200)', (col) => col.notNull())
    .addColumn('visibility', 'varchar(20)', (col) => col.notNull().defaultTo('private'))
    // private | shared | public — default private
    .addColumn('content_meta', 'jsonb', (col) => col.defaultTo(sql`'{}'::jsonb`))
    // { ref, mime, size, aiUseLevel, promptLog } — raw content emas, metadata
    .addColumn('evidence_ref', 'varchar(120)')
    .addColumn('created_at', 'timestamp', (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamp', (col) => col.notNull().defaultTo(sql`now()`))
    

  await db.schema
    .createTable('share_grants')
    .addColumn('id', 'serial', (col) => col.primaryKey())
    .addColumn('tenant_id', 'integer', (col) =>
      col.references('tenants.id').onDelete('cascade').notNull()
    )
    .addColumn('item_id', 'integer', (col) =>
      col.references('portfolio_items.id').onDelete('cascade').notNull()
    )
    .addColumn('grant_token', 'varchar(64)', (col) => col.notNull())
    .addColumn('viewer_email', 'varchar(200)')
    // null = anyone with token (link share)
    .addColumn('expires_at', 'timestamp')
    .addColumn('revoked_at', 'timestamp')
    .addColumn('created_by', 'varchar(120)')
    .addColumn('created_at', 'timestamp', (col) => col.notNull().defaultTo(sql`now()`))
    

  await db.schema
    .createTable('credential_definitions')
    .addColumn('id', 'serial', (col) => col.primaryKey())
    .addColumn('tenant_id', 'integer', (col) =>
      col.references('tenants.id').onDelete('cascade').notNull()
    )
    .addColumn('name', 'varchar(200)', (col) => col.notNull())
    .addColumn('version', 'varchar(40)', (col) => col.notNull().defaultTo('v1'))
    .addColumn('status', 'varchar(20)', (col) => col.notNull().defaultTo('draft'))
    // draft | published | retired
    .addColumn('criteria', 'jsonb', (col) => col.defaultTo(sql`'{}'::jsonb`))
    // { competencyIds, requiredEvidence, minGradeScaled, expiresInDays, issuer }
    .addColumn('issuer_authority', 'varchar(120)')
    .addColumn('created_by', 'varchar(120)')
    .addColumn('created_at', 'timestamp', (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamp', (col) => col.notNull().defaultTo(sql`now()`)).execute()

  await db.schema
    .createTable('credentials')
    .addColumn('id', 'serial', (col) => col.primaryKey())
    .addColumn('tenant_id', 'integer', (col) =>
      col.references('tenants.id').onDelete('cascade').notNull()
    )
    .addColumn('definition_id', 'integer', (col) =>
      col.references('credential_definitions.id').onDelete('cascade').notNull()
    )
    .addColumn('user_id', 'integer', (col) => col.notNull())
    .addColumn('name', 'varchar(200)', (col) => col.notNull())
    // credential nomi (definition snapshot — verifier UI uchun)
    .addColumn('recipient', 'varchar(200)', (col) => col.notNull())
    // recipient identifikatori (email) — verifier UI uchun
    .addColumn('status', 'varchar(20)', (col) => col.notNull().defaultTo('issued'))
    // issued | active | revoked | expired
    .addColumn('evidence_hash', 'varchar(64)', (col) => col.notNull())
    .addColumn('vc_digest', 'varchar(64)', (col) => col.notNull())
    .addColumn('issued_at', 'timestamp', (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn('expires_at', 'timestamp')
    .addColumn('revoked_at', 'timestamp')
    .addColumn('revoked_reason', 'varchar(300)')
    .addColumn('renewed_from', 'integer')
    .addColumn('issued_by', 'varchar(120)')
    .addColumn('created_at', 'timestamp', (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamp', (col) => col.notNull().defaultTo(sql`now()`))
    
    

  await db.schema
    .createTable('credential_events')
    .addColumn('id', 'serial', (col) => col.primaryKey())
    .addColumn('tenant_id', 'integer', (col) =>
      col.references('tenants.id').onDelete('cascade').notNull()
    )
    .addColumn('credential_id', 'integer', (col) =>
      col.references('credentials.id').onDelete('cascade').notNull()
    )
    .addColumn('event_type', 'varchar(40)', (col) => col.notNull())
    // issue | revoke | renew | appeal | status
    .addColumn('actor', 'varchar(120)')
    .addColumn('detail', 'jsonb', (col) => col.defaultTo(sql`'{}'::jsonb`))
    .addColumn('created_at', 'timestamp', (col) => col.notNull().defaultTo(sql`now()`))
    
}

/**
 * @param {import('kysely').Kysely<any>} db
 */
export async function down(db) {
  await db.schema.dropTable('credential_events');
  await db.schema.createIndex('credential_events_cred_idx').on('credential_events').columns(['credential_id']).execute();
  await db.schema.createIndex('credentials_digest_idx').on('credentials').columns(['vc_digest']).execute();
  await db.schema.createIndex('credentials_tenant_user_idx').on('credentials').columns(['tenant_id', 'user_id']).execute();
  await db.schema.createIndex('share_grants_token_idx').on('share_grants').columns(['grant_token']).execute();
  await db.schema.createIndex('portfolio_items_portfolio_idx').on('portfolio_items').columns(['portfolio_id']).execute();
  await db.schema.dropTable('credentials');
  await db.schema.dropTable('credential_definitions');
  await db.schema.dropTable('share_grants');
  await db.schema.dropTable('portfolio_items');
  await db.schema.dropTable('portfolios');
}
