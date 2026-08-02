/**
 * Edikit — Tenant Context Helper
 *
 * Resolves the current tenant from request/session and provides
 * helper functions for tenant-scoped database queries.
 *
 * Every database query MUST include a tenant_id filter.
 * This module enforces that by providing a context-aware query builder wrapper.
 */

import { getDb } from '../../infrastructure/postgres.js';

// ── Tenant context (stored per-request via AsyncLocalStorage) ──
// In Node.js, we use AsyncLocalStorage for per-request context.
// This avoids passing tenantId through every function call.
import { AsyncLocalStorage } from 'async_hooks';

const tenantStorage = new AsyncLocalStorage();

/**
 * Get the current tenant context from AsyncLocalStorage.
 * Returns null if no tenant context is active (e.g., outside a request).
 */
export function getCurrentTenant() {
  return tenantStorage.getStore() || null;
}

/**
 * Run a function within a specific tenant context.
 * All database queries within this scope will have access to the tenant ID.
 *
 * @param {number|string} tenantId
 * @param {Function} fn - Async function to run
 * @returns {Promise<any>} Return value of fn
 */
export async function runWithTenant(tenantId, fn) {
  const context = { tenantId };
  return tenantStorage.run(context, fn);
}

/**
 * Express middleware that resolves tenant from the request.
 * Checks in order: subdomain → header → session → default
 *
 * Usage:
 *   import { tenantMiddleware } from './tenant-context.js';
 *   app.use(tenantMiddleware);
 */
export async function tenantMiddleware(req, res, next) {
  try {
    let tenantId = null;

    // 1. Check X-Tenant-Id header (API clients)
    const headerTenant = req.headers['x-tenant-id'];
    if (headerTenant) {
      tenantId = parseInt(headerTenant, 10);
    }

    // 2. Check session (logged-in users)
    if (!tenantId && req.session?.user?.tenant_id) {
      tenantId = req.session.user.tenant_id;
    }

    // 3. Check admin session
    if (!tenantId && req.session?.admin?.tenant_id) {
      tenantId = req.session.admin.tenant_id;
    }

    // 4. Default tenant (single-tenant mode / dev)
    if (!tenantId) {
      tenantId = 1; // Default tenant ID
    }

    // Store tenant context for this request
    const context = { tenantId, path: req.path, method: req.method };
    tenantStorage.run(context, () => {
      res.locals.tenantId = tenantId;
      next();
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Helper: Build a tenant-scoped WHERE clause for a query.
 * All tenant-scoped queries should include this filter.
 *
 * Usage:
 *   const rows = await db
 *     .selectFrom('courses')
 *     .where('tenant_id', '=', getTenantId(tenantId))
 *     .selectAll()
 *     .execute();
 *
 * @param {number} [tenantId] - Explicit tenant ID (defaults from context)
 * @returns {number} Tenant ID
 * @throws {Error} If no tenant context available
 */
export function getTenantId(tenantId) {
  if (tenantId) return tenantId;
  const context = getCurrentTenant();
  if (context?.tenantId) return context.tenantId;
  throw new Error('No tenant context available. Call runWithTenant() or pass tenantId explicitly.');
}

/**
 * Create a tenant-scoped query builder for a specific table.
 * This is the recommended way to query tenant-scoped tables.
 *
 * @param {import('kysely').Kysely<any>} db
 * @param {number} tenantId
 * @param {string} tableName - Table name (must have tenant_id column)
 * @returns {import('kysely').QueryBuilder} Query builder with tenant filter
 */
export function queryByTenant(db, tenantId, tableName) {
  const tid = tenantId || getCurrentTenant()?.tenantId;
  if (!tid) {
    throw new Error('Tenant context required. Call runWithTenant() or pass tenantId explicitly.');
  }
  return db
    .selectFrom(tableName)
    .where('tenant_id', '=', tid);
}

/**
 * Validate that a resource belongs to the current tenant.
 * Throws if tenant doesn't match.
 *
 * @param {import('kysely').Kysely<any>} db
 * @param {number} tenantId
 * @param {string} tableName
 * @param {number} resourceId
 * @returns {Promise<boolean>}
 */
export async function validateTenantScope(db, tenantId, tableName, resourceId) {
  const tid = tenantId || getCurrentTenant()?.tenantId;
  if (!tid) return false;

  try {
    const result = await db
      .selectFrom(tableName)
      .where('id', '=', resourceId)
      .select('tenant_id')
      .executeTakeFirst();

    return result?.tenant_id === tid;
  } catch (_) {
    return false;
  }
}
