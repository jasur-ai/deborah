/**
 * Edikit — Tenant, RBAC & ABAC Tests (Prompt 11)
 *
 * Tests:
 *   1. Tenant context helper (runWithTenant, getCurrentTenant)
 *   2. Authorization service (AuthResult, authorize, requirePermission)
 *   3. Audit trail (audit, queryAuditLog, auditMiddleware)
 *   4. RLS policy definitions
 *   5. Migration schema (export/import verification)
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';

// ═══════════════════════════════════════════════════════════════
// 1. Tenant Context
// ═══════════════════════════════════════════════════════════════
describe('Tenant Context Helper', () => {
  it('should export runWithTenant function', async () => {
    const mod = await import('../../src/modules/auth/tenant-context.js');
    expect(typeof mod.runWithTenant).toBe('function');
  });

  it('should export getCurrentTenant function', async () => {
    const mod = await import('../../src/modules/auth/tenant-context.js');
    expect(typeof mod.getCurrentTenant).toBe('function');
  });

  it('should return null for getCurrentTenant outside context', async () => {
    const mod = await import('../../src/modules/auth/tenant-context.js');
    const tenant = mod.getCurrentTenant();
    expect(tenant).toBeNull();
  });

  it('should set and retrieve tenant context via runWithTenant', async () => {
    const mod = await import('../../src/modules/auth/tenant-context.js');
    await mod.runWithTenant(42, () => {
      const context = mod.getCurrentTenant();
      expect(context).not.toBeNull();
      expect(context.tenantId).toBe(42);
    });
  });

  it('should return tenant context only within the async scope', async () => {
    const mod = await import('../../src/modules/auth/tenant-context.js');
    await mod.runWithTenant(99, async () => {
      expect(mod.getCurrentTenant().tenantId).toBe(99);
    });
    // After the scope, context should be null
    expect(mod.getCurrentTenant()).toBeNull();
  });

  it('should export queryByTenant function', async () => {
    const mod = await import('../../src/modules/auth/tenant-context.js');
    expect(typeof mod.queryByTenant).toBe('function');
  });

  it('should export validateTenantScope function', async () => {
    const mod = await import('../../src/modules/auth/tenant-context.js');
    expect(typeof mod.validateTenantScope).toBe('function');
  });

  it('should export tenantMiddleware function', async () => {
    const mod = await import('../../src/modules/auth/tenant-context.js');
    expect(typeof mod.tenantMiddleware).toBe('function');
  });
});

// ═══════════════════════════════════════════════════════════════
// 2. Authorization Service (ABAC)
// ═══════════════════════════════════════════════════════════════
describe('Authorization Service', () => {
  it('should export default AuthService', async () => {
    const auth = (await import('../../src/modules/auth/authorization.js')).default;
    expect(auth).toBeDefined();
    expect(typeof auth.authorize).toBe('function');
  });

  it('should export AuthResult class', async () => {
    const mod = await import('../../src/modules/auth/authorization.js');
    expect(typeof mod.AuthResult).toBe('function');
  });

  it('AuthResult.allow() should create allowed result', async () => {
    const { AuthResult } = await import('../../src/modules/auth/authorization.js');
    const result = AuthResult.allow({ role: 'admin' });
    expect(result.allowed).toBe(true);
    expect(result.denied).toBe(false);
    expect(result.reason).toBe('ok');
    expect(result.context.role).toBe('admin');
  });

  it('AuthResult.deny() should create denied result', async () => {
    const { AuthResult } = await import('../../src/modules/auth/authorization.js');
    const result = AuthResult.deny('No permission');
    expect(result.allowed).toBe(false);
    expect(result.denied).toBe(true);
    expect(result.reason).toBe('No permission');
  });

  it('should export requirePermission middleware factory', async () => {
    const auth = (await import('../../src/modules/auth/authorization.js')).default;
    expect(typeof auth.requirePermission).toBe('function');

    const middleware = auth.requirePermission('test:create');
    expect(typeof middleware).toBe('function');
    expect(middleware.length).toBe(3); // Express middleware signature
  });

  it('should export checkOwnership function', async () => {
    const auth = (await import('../../src/modules/auth/authorization.js')).default;
    expect(typeof auth.checkOwnership).toBe('function');
  });

  it('checkOwnership should detect owner match', async () => {
    const { AuthResult } = await import('../../src/modules/auth/authorization.js');
    const auth = (await import('../../src/modules/auth/authorization.js')).default;
    const result = auth.checkOwnership(5, { ownerId: 5 });
    expect(result.allowed).toBe(true);
    expect(result.context.owner).toBe(true);
  });

  it('checkOwnership should reject non-owner', async () => {
    const auth = (await import('../../src/modules/auth/authorization.js')).default;
    const result = auth.checkOwnership(5, { ownerId: 99 });
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('Not the resource owner');
  });

  it('checkOwnership should reject missing owner', async () => {
    const auth = (await import('../../src/modules/auth/authorization.js')).default;
    const result = auth.checkOwnership(5, {});
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('Resource has no owner');
  });
});

// ═══════════════════════════════════════════════════════════════
// 3. Audit Trail
// ═══════════════════════════════════════════════════════════════
describe('Audit Trail', () => {
  it('should export audit function', async () => {
    const mod = await import('../../src/modules/auth/audit.js');
    expect(typeof mod.audit).toBe('function');
  });

  it('should export queryAuditLog function', async () => {
    const mod = await import('../../src/modules/auth/audit.js');
    expect(typeof mod.queryAuditLog).toBe('function');
  });

  it('should export auditMiddleware function', async () => {
    const mod = await import('../../src/modules/auth/audit.js');
    expect(typeof mod.auditMiddleware).toBe('function');
  });

  it('audit should not throw when DB is unavailable (falls back to console)', async () => {
    const mod = await import('../../src/modules/auth/audit.js');
    await expect(mod.audit({
      action: 'test:audit',
      details: { test: true },
    })).resolves.toBe(true);
  });

  it('queryAuditLog should return empty array when DB unavailable', async () => {
    const mod = await import('../../src/modules/auth/audit.js');
    const result = await mod.queryAuditLog({ tenantId: 1 });
    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBe(0);
  });

  it('should export AUDIT_ACTIONS constants', async () => {
    const mod = await import('../../src/modules/auth/audit.js');
    expect(mod.AUDIT_ACTIONS).toBeDefined();
    expect(mod.AUDIT_ACTIONS.USER_LOGIN).toBe('user:login');
    expect(mod.AUDIT_ACTIONS.ADMIN_LOGIN).toBe('admin:login');
    expect(mod.AUDIT_ACTIONS.VIP_GRANT).toBe('vip:grant');
    expect(mod.AUDIT_ACTIONS.TEST_CREATE).toBe('test:create');
  });

  it('auditMiddleware should return Express middleware function', async () => {
    const mod = await import('../../src/modules/auth/audit.js');
    const middleware = mod.auditMiddleware('test:create');
    expect(typeof middleware).toBe('function');
    expect(middleware.length).toBe(3);
  });
});

// ═══════════════════════════════════════════════════════════════
// 4. RLS Policy Definitions
// ═══════════════════════════════════════════════════════════════
describe('RLS Policy Definitions', () => {
  it('should export enableRls function', async () => {
    const mod = await import('../../src/modules/auth/rls.js');
    expect(typeof mod.enableRls).toBe('function');
  }, 30000);

  it('should export createTenantPolicy function', async () => {
    const mod = await import('../../src/modules/auth/rls.js');
    expect(typeof mod.createTenantPolicy).toBe('function');
  });

  it('should export createAllPolicies function', async () => {
    const mod = await import('../../src/modules/auth/rls.js');
    expect(typeof mod.createAllPolicies).toBe('function');
  });

  it('should export setSessionTenant function', async () => {
    const mod = await import('../../src/modules/auth/rls.js');
    expect(typeof mod.setSessionTenant).toBe('function');
  });

  it('enableRls should gracefully handle missing PostgreSQL', async () => {
    const mod = await import('../../src/modules/auth/rls.js');
    const result = await mod.enableRls();
    // Should not throw, return result indicating DB not configured
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('not configured');
  });
});

// ═══════════════════════════════════════════════════════════════
// 5. Barrel Export
// ═══════════════════════════════════════════════════════════════
describe('Auth Module Barrel Export', () => {
  it('should export all names from index.js', async () => {
    const mod = await import('../../src/modules/auth/index.js');

    // Authorization
    expect(mod.authorization).toBeDefined();
    expect(mod.AuthResult).toBeDefined();
    expect(mod.AuthorizationService).toBeDefined();

    // Tenant context
    expect(typeof mod.getCurrentTenant).toBe('function');
    expect(typeof mod.runWithTenant).toBe('function');
    expect(typeof mod.tenantMiddleware).toBe('function');

    // RLS
    expect(typeof mod.enableRls).toBe('function');
    expect(typeof mod.createTenantPolicy).toBe('function');
    expect(typeof mod.createAllPolicies).toBe('function');
    expect(typeof mod.setSessionTenant).toBe('function');

    // Audit
    expect(typeof mod.audit).toBe('function');
    expect(typeof mod.queryAuditLog).toBe('function');
    expect(typeof mod.auditMiddleware).toBe('function');
    expect(mod.AUDIT_ACTIONS).toBeDefined();
  });
});

// ═══════════════════════════════════════════════════════════════
// 6. Migration Files
// ═══════════════════════════════════════════════════════════════
describe('Migration Files', () => {
  it('001_tenant_rbac.js should export up and down functions', async () => {
    const mod = await import('../../migrations/001_tenant_rbac.js');
    expect(typeof mod.up).toBe('function');
    expect(typeof mod.down).toBe('function');
  });

  it('002_rls_policies.js should export up and down functions', async () => {
    const mod = await import('../../migrations/002_rls_policies.js');
    expect(typeof mod.up).toBe('function');
    expect(typeof mod.down).toBe('function');
  });
});
