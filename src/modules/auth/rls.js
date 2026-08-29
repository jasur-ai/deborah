/**
 * Deborah — Row-Level Security (RLS) Policy Definitions
 *
 * Defines PostgreSQL RLS policies for tenant-scoped tables.
 * These policies ensure that even if a query bypasses application-level
 * tenant checks, the database itself enforces tenant isolation.
 *
 * RLS is enabled per-table and policies are defined using
 * the current session's 'app.tenant_id' runtime variable.
 *
 * Usage:
 *   await enableRls(db);
 *   await createTenantPolicy(db, 'users');
 *   await createTenantPolicy(db, 'courses');
 *
 * Runtime session variable is set via:
 *   SET app.tenant_id = '5';
 *
 * The tenant-context.js middleware sets this automatically.
 */

import { getDb } from '../../infrastructure/postgres.js';

/**
 * Enable RLS on all tenant-scoped tables.
 * Uses Kysely's raw SQL execution.
 */
export async function enableRls(dbInstance) {
  const db = dbInstance || await getDb();
  if (!db) return { ok: false, reason: 'PostgreSQL not configured' };

  const tables = ['users', 'courses', 'audit_log', 'user_roles'];

  for (const table of tables) {
    try {
      await db.schema.alterTable(table).enableRowLevelSecurity().execute();
    } catch (err) {
      // Table might not exist yet (migration not run)
      console.warn(`RLS enable skipped for ${table}: ${err.message}`);
    }
  }

  return { ok: true, tables };
}

/**
 * Create a tenant-scoped RLS policy for a table.
 * Policy: tenant_id = current_setting('app.tenant_id')::integer
 *
 * @param {import('kysely').Kysely<any>} db
 * @param {string} tableName - Table with tenant_id column
 * @param {string} [policyName] - Optional policy name
 */
export async function createTenantPolicy(db, tableName, policyName) {
  const name = policyName || `tenant_isolation_${tableName}`;

  // Drop existing policy first (idempotent)
  try {
    await db.schema.dropPolicy(tableName, name).ifExists().execute();
  } catch (_) { /* ignore */ }

  // Create the policy
  try {
    await db.schema
      .createPolicy(tableName, name)
      .forAll() // Applies to SELECT, INSERT, UPDATE, DELETE
      .using(sql`tenant_id = current_setting('app.tenant_id')::integer`)
      .execute();

    return { ok: true, table: tableName, policy: name };
  } catch (err) {
    return { ok: false, table: tableName, error: err.message };
  }
}

/**
 * Set the tenant context for the current database session.
 * Must be called at the start of each request/transaction.
 *
 * @param {import('kysely').Kysely<any>} db
 * @param {number} tenantId
 */
export async function setSessionTenant(db, tenantId) {
  try {
    await sql`SELECT set_config('app.tenant_id', ${String(tenantId)}, true)`.execute(db);
    return true;
  } catch (_) {
    return false;
  }
}

/**
 * Create all standard tenant isolation policies.
 * Called during migration or application startup.
 */
export async function createAllPolicies(dbInstance) {
  const db = dbInstance || await getDb();
  if (!db) return { ok: false, reason: 'PostgreSQL not configured' };

  // Enable RLS first
  await enableRls(db);

  // Create policies for each tenant-scoped table
  const results = [];
  const tables = ['users', 'courses', 'audit_log'];

  for (const table of tables) {
    const result = await createTenantPolicy(db, table);
    results.push(result);
  }

  return { ok: true, results };
}

// ── Import for sql tag ──
import { sql } from 'kysely';
