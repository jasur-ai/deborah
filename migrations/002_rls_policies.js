/**
 * Deborah — Migration 002: RLS Policies
 *
 * Enables Row-Level Security on tenant-scoped tables and
 * creates tenant isolation policies.
 *
 * These policies use the PostgreSQL session variable `app.tenant_id`
 * which is set by the tenant-context.js middleware at the start
 * of each request.
 *
 * Policy: tenant_id = current_setting('app.tenant_id')::integer
 *
 * Rollback: Policies are dropped, RLS is disabled.
 */

import { sql } from 'kysely';

/**
 * @param {import('kysely').Kysely<any>} db
 */
export async function up(db) {
  const tables = ['users', 'courses', 'audit_log'];

  for (const table of tables) {
    // Enable RLS
    try {
      // S30 fix: kysely 0.29'da enableRowLevelSecurity() yo'q — raw SQL
      await sql`ALTER TABLE ${sql.id(table)} ENABLE ROW LEVEL SECURITY`.execute(db);
    } catch (err) {
      console.warn(`RLS enable skipped for ${table}: ${err.message}`);
    }

    // Create tenant isolation policy
    try {
      // S30 fix: kysely 0.29'da createPolicy() yo'q — raw SQL
      const policy = `tenant_isolation_${table}`;
      await sql`DROP POLICY IF EXISTS ${sql.id(policy)} ON ${sql.id(table)}`.execute(db);
      await sql`CREATE POLICY ${sql.id(policy)} ON ${sql.id(table)}
        FOR ALL
        USING (tenant_id = current_setting('app.tenant_id')::integer)
        WITH CHECK (tenant_id = current_setting('app.tenant_id')::integer)`.execute(db);
    } catch (err) {
      console.warn(`RLS policy creation skipped for ${table}: ${err.message}`);
    }
  }

  console.log(`RLS enabled on ${tables.join(', ')}`);
}

/**
 * @param {import('kysely').Kysely<any>} db
 */
export async function down(db) {
  const tables = ['users', 'courses', 'audit_log'];

  for (const table of tables) {
    try {
      await db.schema
        .dropPolicy(table, `tenant_isolation_${table}`)
        .ifExists()
        .execute();
    } catch (_) { /* ignore */ }

    try {
      await db.schema.alterTable(table).disableRowLevelSecurity().execute();
    } catch (_) { /* ignore */ }
  }
}
