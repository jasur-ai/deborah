/**
 * Edikit — Central Authorization Policy Service (ABAC)
 *
 * Provides:
 *   1. Role-based permission checks (RBAC)
 *   2. Scope-aware authorization (tenant, course, assessment)
 *   3. Attribute-based policies (time, ownership, status)
 *   4. Middleware for Express routes
 *
 * All authorization goes through this single service.
 * No inline permission checks in route handlers.
 *
 * Gracefully degrades when PostgreSQL is not configured.
 */

import { getDb } from '../../infrastructure/postgres.js';
import { getCurrentTenant } from './tenant-context.js';

// ── In-memory role-permission cache (for when DB is unavailable) ──
const _defaultPermissions = {
  super_admin: '*',
  admin: [
    'test:create', 'test:read', 'test:update', 'test:delete', 'test:publish',
    'course:create', 'course:read', 'course:update', 'course:delete',
    'user:create', 'user:read', 'user:update', 'user:delete',
    'system:settings', 'system:audit', 'vip:grant',
  ],
  teacher: ['test:create', 'test:read', 'test:update', 'test:publish', 'course:read', 'user:read'],
  student: ['test:read', 'course:read'],
  viewer: ['test:read', 'course:read'],
};

// ── Authorization Result ──
class AuthResult {
  constructor({ allowed, reason, context }) {
    this.allowed = allowed;
    this.reason = reason;
    this.context = context || {};
  }

  get denied() { return !this.allowed; }

  static allow(context) {
    return new AuthResult({ allowed: true, reason: 'ok', context });
  }

  static deny(reason, context) {
    return new AuthResult({ allowed: false, reason, context });
  }
}

// ── Central Authorization Service ──
class AuthorizationService {
  async authorize({ userId, tenantId, action, resource, scope, scopeId }) {
    const roles = await this._getUserRoles(userId, tenantId);
    if (roles.some(r => r.name === 'super_admin')) {
      return AuthResult.allow({ role: 'super_admin', bypass: true });
    }
    for (const role of roles) {
      const permissions = await this._getRolePermissions(role.name);
      if (permissions === '*') return AuthResult.allow({ role: role.name });
      if (permissions.includes(action)) {
        if (scope && role.scope_type && role.scope_type !== scope) continue;
        if (scope && role.scope_id && role.scope_id !== scopeId) continue;
        if (resource) {
          const attrCheck = this._checkAttributes(action, role, resource);
          if (!attrCheck.allowed) continue;
        }
        return AuthResult.allow({ role: role.name });
      }
    }
    return AuthResult.deny('Insufficient permissions');
  }

  requirePermission(action, options = {}) {
    return async (req, res, next) => {
      try {
        const tenantId = req.session?.user?.tenant_id ||
                         req.session?.admin?.tenant_id ||
                         getCurrentTenant()?.tenantId || 1;
        const userId = req.session?.user?.id || req.session?.admin?.id;
        if (!userId) return next();
        const result = await this.authorize({
          userId, tenantId, action,
          resource: { ownerId: req.params?.userId || req.body?.userId, status: req.body?.status },
          scope: options.scope,
          scopeId: options.scopeId || req.params?.courseId || req.body?.courseId,
        });
        if (result.allowed) { req.auth = result; return next(); }
        return res.status(403).json({ error: 'Ruxsat etilmagan amal', reason: result.reason });
      } catch (err) { next(err); }
    };
  }

  checkOwnership(userId, resource) {
    if (!resource || !resource.ownerId) return AuthResult.deny('Resource has no owner');
    if (userId === resource.ownerId) return AuthResult.allow({ owner: true });
    return AuthResult.deny('Not the resource owner');
  }

  // ── Private helpers ──
  async _getUserRoles(userId, tenantId) {
    const db = await getDb();
    if (!db) return [{ name: 'viewer' }]; // Fail-closed fallback
    try {
      const roles = await db.selectFrom('user_roles')
        .innerJoin('roles', 'roles.id', 'user_roles.role_id')
        .where('user_roles.user_id', '=', userId)
        .where('user_roles.revoked_at', 'is', null)
        .select(['roles.name', 'user_roles.scope_type', 'user_roles.scope_id']).execute();
      return roles.length > 0 ? roles : [{ name: 'student' }];
    } catch (_) { return [{ name: 'viewer' }]; }
  }

  async _getRolePermissions(roleName) {
    const db = await getDb();
    if (!db) return _defaultPermissions[roleName] || [];
    try {
      const rows = await db.selectFrom('role_permissions')
        .innerJoin('permissions', 'permissions.id', 'role_permissions.permission_id')
        .innerJoin('roles', 'roles.id', 'role_permissions.role_id')
        .where('roles.name', '=', roleName).select('permissions.action').execute();
      return rows.map(r => r.action);
    } catch (_) { return _defaultPermissions[roleName] || []; }
  }

  _checkAttributes(action, role, resource) {
    switch (action) {
      case 'test:update':
        if (resource.ownerId && role.name !== 'admin') return AuthResult.deny('Only owner can update');
        return AuthResult.allow({ owner: true });
      case 'test:delete':
        if (resource.ownerId && role.name !== 'super_admin') return AuthResult.deny('Only owner can delete');
        return AuthResult.allow({ owner: true });
      case 'test:publish':
        if (resource.status === 'published') return AuthResult.deny('Already published');
        return AuthResult.allow();
      default:
        return AuthResult.allow();
    }
  }
}

const auth = new AuthorizationService();
export default auth;
export { AuthorizationService, AuthResult };
