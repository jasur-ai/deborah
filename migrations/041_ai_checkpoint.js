/**
 * Deborah — Migration 041: AI/Content Checkpoint runs
 *
 * Prompt 60 — AI/content checkpoint (measured pilot). Source, AI grading,
 * questions, resources va presentation oqimlarini yakuniy tekshirish
 * (research.md §7.7 model eval, §9.8-9.10 provider/presentation,
 * §20 Phase 3 guardrails, §22.15 measured pilot, §28 accessibility).
 * Precondition: Prompt 50-59 merge-ready.
 *
 *   - ai_checkpoint_runs: har bir measured pilot natijasi — tenant-scoped,
 *     idempotent (request_hash). Summary + per-pilot results + residual
 *     risks jsonb. Provider sandbox credentiallarisiz ham pure-pilot
 *     rejimida ishlaydi (provider drill client mock).
 *
 * SECURITY / DATA GUARD (Prompt 60 §15-17):
 *   - Summative AI authority yoki unverified source publish qilinmaydi
 *     (guard'lar checkpoint natijasida ko'rinadi).
 *   - Har write path tenant-scoped + idempotent.
 *   - Checkpoint run — privileged action → audit + metric/trace.
 */

import { sql } from 'kysely';

/**
 * @param {import('kysely').Kysely<any>} db
 */
export async function up(db) {
  await db.schema
    .createTable('ai_checkpoint_runs')
    .addColumn('id', 'serial', (col) => col.primaryKey())
    .addColumn('tenant_id', 'integer', (col) =>
      col.references('tenants.id').onDelete('cascade').notNull()
    )
    .addColumn('request_hash', 'varchar(64)', (col) => col.notNull())
    // { scope, tenant, pilotVersion } idempotency
    .addColumn('scope', 'varchar(50)', (col) => col.notNull().defaultTo('full'))
    // full | source | grading | questions | resources | presentations | provider
    .addColumn('status', 'varchar(20)', (col) => col.notNull().defaultTo('done'))
    // { total, passed, failed, warnings, guards }
    .addColumn('summary', 'jsonb', (col) => col.defaultTo(sql`'{}'::jsonb`))
    // [{ id, name, ok, checks, detail }]
    .addColumn('pilots', 'jsonb', (col) => col.defaultTo(sql`'[]'::jsonb`))
    // [{ level, area, risk, mitigation }]
    .addColumn('residual_risks', 'jsonb', (col) => col.defaultTo(sql`'[]'::jsonb`))
    .addColumn('phase_g_ready', 'boolean', (col) => col.notNull().defaultTo(false))
    .addColumn('created_by', 'varchar(120)')
    .addColumn('created_at', 'timestamp', (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamp', (col) => col.notNull().defaultTo(sql`now()`))
    .addUniqueConstraint('ai_checkpoint_tenant_hash', ['tenant_id', 'request_hash']);
}

/**
 * @param {import('kysely').Kysely<any>} db
 */
export async function down(db) {
  await db.schema.dropTable('ai_checkpoint_runs');
}
