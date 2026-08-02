/**
 * Edikit — Migration 001: Tenant, RBAC & Academic Scope
 *
 * Creates the multi-tenant foundation:
 *   - tenants (institutions)
 *   - users (with tenant foreign key)
 *   - roles (platform-level: admin, teacher, student)
 *   - permissions (scope-aware action grants)
 *   - user_roles (assignment with scope)
 *   - courses (academic scope example)
 *   - audit_log (privileged action trail)
 *
 * RLS policies are created in a separate migration (002_rls_policies.js)
 * to allow for easier policy management.
 *
 * Rollback: All tables are dropable via the down() function.
 */

import { sql } from 'kysely';

/**
 * @param {import('kysely').Kysely<any>} db
 */
export async function up(db) {
  // ── 1. Tenants (institutions) ──
  await db.schema
    .createTable('tenants')
    .addColumn('id', 'serial', (col) => col.primaryKey())
    .addColumn('name', 'varchar(255)', (col) => col.notNull().unique())
    .addColumn('slug', 'varchar(100)', (col) => col.notNull().unique())
    .addColumn('domain', 'varchar(255)')
    .addColumn('settings', 'jsonb', (col) => col.defaultTo('{}'))
    .addColumn('is_active', 'boolean', (col) => col.notNull().defaultTo(true))
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(db.fn.now()))
    .addColumn('updated_at', 'timestamptz', (col) => col.notNull().defaultTo(db.fn.now()))
    .execute();

  // ── 2. Users (tenant-scoped) ──
  await db.schema
    .createTable('users')
    .addColumn('id', 'serial', (col) => col.primaryKey())
    .addColumn('tenant_id', 'integer', (col) =>
      col.references('tenants.id').onDelete('cascade').notNull()
    )
    .addColumn('username', 'varchar(100)', (col) => col.notNull())
    .addColumn('email', 'varchar(255)')
    .addColumn('password_hash', 'varchar(255)')
    .addColumn('external_id', 'varchar(255)') // Google sub, HEMIS ID, etc.
    .addColumn('auth_provider', 'varchar(50)') // 'local', 'google', 'hemis'
    .addColumn('display_name', 'varchar(255)')
    .addColumn('avatar_url', 'varchar(500)')
    .addColumn('is_active', 'boolean', (col) => col.notNull().defaultTo(true))
    .addColumn('metadata', 'jsonb', (col) => col.defaultTo('{}'))
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(db.fn.now()))
    .addColumn('updated_at', 'timestamptz', (col) => col.notNull().defaultTo(db.fn.now()))
    .execute();

  // Unique: username is unique within a tenant
  await db.schema
    .createIndex('idx_users_tenant_username')
    .on('users')
    .columns(['tenant_id', 'username'])
    .unique()
    .execute();

  // Unique: email is unique within a tenant (if provided)
  await db.schema
    .createIndex('idx_users_tenant_email')
    .on('users')
    .columns(['tenant_id', 'email'])
    .unique()
    .where('email is not null')
    .execute();

  // ── 3. Roles (platform-defined) ──
  await db.schema
    .createTable('roles')
    .addColumn('id', 'serial', (col) => col.primaryKey())
    .addColumn('name', 'varchar(50)', (col) => col.notNull().unique())
    .addColumn('description', 'varchar(255)')
    .addColumn('is_system', 'boolean', (col) => col.notNull().defaultTo(false))
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(db.fn.now()))
    .execute();

  // Seed platform roles
  await db.insertInto('roles').values([
    { name: 'super_admin', description: 'Platform super administrator', is_system: true },
    { name: 'admin', description: 'Tenant administrator', is_system: true },
    { name: 'teacher', description: 'Teacher / content creator', is_system: true },
    { name: 'student', description: 'Student / test taker', is_system: true },
    { name: 'viewer', description: 'Read-only viewer', is_system: true },
  ]).execute();

  // ── 4. Permissions (action grants) ──
  await db.schema
    .createTable('permissions')
    .addColumn('id', 'serial', (col) => col.primaryKey())
    .addColumn('action', 'varchar(100)', (col) => col.notNull().unique())
    .addColumn('description', 'varchar(255)')
    .addColumn('resource_type', 'varchar(50)') // 'test', 'course', 'user', 'system'
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(db.fn.now()))
    .execute();

  // Seed standard permissions
  await db.insertInto('permissions').values([
    { action: 'test:create', description: 'Create new tests', resource_type: 'test' },
    { action: 'test:read', description: 'View test details', resource_type: 'test' },
    { action: 'test:update', description: 'Edit existing tests', resource_type: 'test' },
    { action: 'test:delete', description: 'Delete tests', resource_type: 'test' },
    { action: 'test:publish', description: 'Publish tests', resource_type: 'test' },
    { action: 'test:grade', description: 'Grade test submissions', resource_type: 'test' },
    { action: 'course:create', description: 'Create courses', resource_type: 'course' },
    { action: 'course:read', description: 'View course details', resource_type: 'course' },
    { action: 'course:update', description: 'Edit courses', resource_type: 'course' },
    { action: 'course:delete', description: 'Delete courses', resource_type: 'course' },
    { action: 'user:create', description: 'Create users', resource_type: 'user' },
    { action: 'user:read', description: 'View user details', resource_type: 'user' },
    { action: 'user:update', description: 'Edit users', resource_type: 'user' },
    { action: 'user:delete', description: 'Delete users', resource_type: 'user' },
    { action: 'system:settings', description: 'Change system settings', resource_type: 'system' },
    { action: 'system:audit', description: 'View audit logs', resource_type: 'system' },
    { action: 'vip:grant', description: 'Grant VIP status', resource_type: 'system' },
  ]).execute();

  // ── 5. Role-Permission mapping ──
  await db.schema
    .createTable('role_permissions')
    .addColumn('role_id', 'integer', (col) =>
      col.references('roles.id').onDelete('cascade').notNull()
    )
    .addColumn('permission_id', 'integer', (col) =>
      col.references('permissions.id').onDelete('cascade').notNull()
    )
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(db.fn.now()))
    .addPrimaryKeyConstraint('pk_role_permissions', ['role_id', 'permission_id'])
    .execute();

  // Seed admin role permissions (all permissions)
  // Use raw SQL for cross-join since Kysely doesn't have a built-in crossJoin
  const adminRole = await db.selectFrom('roles')
    .where('name', '=', 'admin')
    .select('id')
    .executeTakeFirst();

  if (adminRole) {
    const allPerms = await db.selectFrom('permissions').select('id').execute();
    const adminPerms = allPerms.map(p => ({
      role_id: adminRole.id,
      permission_id: p.id,
    }));
    if (adminPerms.length > 0) {
      await db.insertInto('role_permissions').values(adminPerms).execute();
    }
  }

  // Seed teacher role permissions
  const teacherActions = ['test:create', 'test:read', 'test:update', 'test:publish', 'course:read', 'user:read'];
  const teacherRole = await db.selectFrom('roles').where('name', '=', 'teacher').select('id').executeTakeFirst();
  if (teacherRole) {
    const teacherPerms = await db.selectFrom('permissions')
      .where('action', 'in', teacherActions)
      .select('id')
      .execute();
    await db.insertInto('role_permissions').values(
      teacherPerms.map(p => ({ role_id: teacherRole.id, permission_id: p.id }))
    ).execute();
  }

  // Seed student role permissions
  const studentActions = ['test:read', 'course:read'];
  const studentRole = await db.selectFrom('roles').where('name', '=', 'student').select('id').executeTakeFirst();
  if (studentRole) {
    const studentPerms = await db.selectFrom('permissions')
      .where('action', 'in', studentActions)
      .select('id')
      .execute();
    await db.insertInto('role_permissions').values(
      studentPerms.map(p => ({ role_id: studentRole.id, permission_id: p.id }))
    ).execute();
  }

  // ── 6. User-Role assignment (with scope) ──
  await db.schema
    .createTable('user_roles')
    .addColumn('id', 'serial', (col) => col.primaryKey())
    .addColumn('user_id', 'integer', (col) =>
      col.references('users.id').onDelete('cascade').notNull()
    )
    .addColumn('role_id', 'integer', (col) =>
      col.references('roles.id').onDelete('cascade').notNull()
    )
    .addColumn('granted_by', 'integer', (col) =>
      col.references('users.id').onDelete('set null')
    )
    .addColumn('scope_type', 'varchar(50)') // 'tenant', 'course', 'assessment'
    .addColumn('scope_id', 'integer') // FK to the scoped entity
    .addColumn('granted_at', 'timestamptz', (col) => col.notNull().defaultTo(db.fn.now()))
    .addColumn('expires_at', 'timestamptz')
    .addColumn('revoked_at', 'timestamptz')
    .execute();

  // ── 7. Courses (academic scope example) ──
  await db.schema
    .createTable('courses')
    .addColumn('id', 'serial', (col) => col.primaryKey())
    .addColumn('tenant_id', 'integer', (col) =>
      col.references('tenants.id').onDelete('cascade').notNull()
    )
    .addColumn('code', 'varchar(50)')
    .addColumn('name', 'varchar(255)', (col) => col.notNull())
    .addColumn('description', 'text')
    .addColumn('is_active', 'boolean', (col) => col.notNull().defaultTo(true))
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(db.fn.now()))
    .addColumn('updated_at', 'timestamptz', (col) => col.notNull().defaultTo(db.fn.now()))
    .execute();

  // ── 8. Audit Log ──
  await db.schema
    .createTable('audit_log')
    .addColumn('id', 'serial', (col) => col.primaryKey())
    .addColumn('tenant_id', 'integer', (col) =>
      col.references('tenants.id').onDelete('set null')
    )
    .addColumn('user_id', 'integer', (col) =>
      col.references('users.id').onDelete('set null')
    )
    .addColumn('action', 'varchar(100)', (col) => col.notNull())
    .addColumn('resource_type', 'varchar(50)')
    .addColumn('resource_id', 'integer')
    .addColumn('details', 'jsonb', (col) => col.defaultTo('{}'))
    .addColumn('ip_address', 'varchar(45)')
    .addColumn('user_agent', 'varchar(500)')
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(db.fn.now()))
    .execute();

  // Index for audit queries
  await db.schema
    .createIndex('idx_audit_tenant_created')
    .on('audit_log')
    .columns(['tenant_id', 'created_at'])
    .execute();

  // ── 9. PostgreSQL DB Role Setup ──
  // Create application-level PostgreSQL roles for runtime/migration/scoping separation
  // These use DO blocks so they're idempotent (won't fail if roles already exist)
  await sql`DO $$ BEGIN
    CREATE ROLE edikit_runtime WITH LOGIN PASSWORD NULL INHERIT NOCREATEDB NOCREATEROLE;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END $$;`.execute(db);

  await sql`DO $$ BEGIN
    CREATE ROLE edikit_migration WITH LOGIN PASSWORD NULL INHERIT NOCREATEDB CREATEROLE;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END $$;`.execute(db);

  await sql`DO $$ BEGIN
    CREATE ROLE edikit_scoring WITH LOGIN PASSWORD NULL INHERIT NOCREATEDB NOCREATEROLE;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END $$;`.execute(db);

  // Grant table permissions to roles
  // Runtime: SELECT, INSERT, UPDATE on all tenant tables
  for (const table of ['tenants', 'users', 'roles', 'permissions', 'role_permissions', 'user_roles', 'courses', 'audit_log']) {
    await sql`GRANT SELECT, INSERT, UPDATE ON ${sql.table(table)} TO edikit_runtime`.execute(db);
    await sql`GRANT USAGE ON ${sql.table(table)}_id_seq TO edikit_runtime`.execute(db);
  }

  // Migration: ALL permissions (including DDL)
  await sql`GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO edikit_migration`.execute(db);
  await sql`GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO edikit_migration`.execute(db);

  // Scoring: SELECT only (read-only)
  for (const table of ['user_roles', 'audit_log']) {
    await sql`GRANT SELECT ON ${sql.table(table)} TO edikit_scoring`.execute(db);
  }

  // Grant schema usage (required for roles to access tables)
  await sql`GRANT USAGE ON SCHEMA public TO edikit_runtime`.execute(db);
  await sql`GRANT USAGE ON SCHEMA public TO edikit_migration`.execute(db);
  await sql`GRANT USAGE ON SCHEMA public TO edikit_scoring`.execute(db);

  console.log('DB roles created: edikit_runtime, edikit_migration, edikit_scoring');
}

/**
 * @param {import('kysely').Kysely<any>} db
 */
export async function down(db) {
  // Drop in reverse dependency order
  await db.schema.dropTable('audit_log').ifExists().execute();
  await db.schema.dropTable('courses').ifExists().execute();
  await db.schema.dropTable('user_roles').ifExists().execute();
  await db.schema.dropTable('role_permissions').ifExists().execute();
  await db.schema.dropTable('permissions').ifExists().execute();
  await db.schema.dropTable('roles').ifExists().execute();
  await db.schema.dropTable('users').ifExists().execute();
  await db.schema.dropTable('tenants').ifExists().execute();
}
