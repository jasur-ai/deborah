/**
 * Deborah — Migration 003: Academic Structure
 *
 * Extends the existing courses table with a full academic hierarchy:
 *   - academic_terms (semester/trimester/year periods)
 *   - faculties (organizational units)
 *   - programs (degree programs)
 *   - course_offerings (term-specific course instances)
 *   - groups / subgroups (student groups within offerings)
 *   - group_memberships (student-group assignments)
 *   - enrollments (student-course enrollment with status/source/version)
 *   - teacher_assignments (primary/co-teacher grader roles)
 *
 * This migration assumes migration 001 (tenants, users, courses) has run.
 * All new tables are tenant-scoped and backward-compatible.
 *
 * Rollback: All tables are droppable via down().
 */

import { sql } from 'kysely';

/**
 * @param {import('kysely').Kysely<any>} db
 */
export async function up(db) {
  // ── 1. Academic Terms (semesters, trimesters, academic years) ──
  await db.schema
    .createTable('academic_terms')
    .addColumn('id', 'serial', (col) => col.primaryKey())
    .addColumn('tenant_id', 'integer', (col) =>
      col.references('tenants.id').onDelete('cascade').notNull()
    )
    .addColumn('name', 'varchar(255)', (col) => col.notNull())
    .addColumn('code', 'varchar(50)') // e.g., "2025-SPRING", "2025-FALL"
    .addColumn('type', 'varchar(20)', (col) => col.notNull().defaultTo('semester')) // semester | trimester | quarter | year
    .addColumn('start_date', 'date')
    .addColumn('end_date', 'date')
    .addColumn('enrollment_start', 'date')
    .addColumn('enrollment_end', 'date')
    .addColumn('external_id', 'varchar(255)') // HEMIS/SIS term ID
    .addColumn('is_active', 'boolean', (col) => col.notNull().defaultTo(true))
    .addColumn('metadata', 'jsonb', (col) => col.defaultTo('{}'))
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(db.fn.now()))
    .addColumn('updated_at', 'timestamptz', (col) => col.notNull().defaultTo(db.fn.now()))
    .execute();

  await db.schema
    .createIndex('idx_terms_tenant_code')
    .on('academic_terms')
    .columns(['tenant_id', 'code'])
    .unique()
    .where('code is not null')
    .execute();

  // ── 2. Faculties (organizational units within tenant) ──
  await db.schema
    .createTable('faculties')
    .addColumn('id', 'serial', (col) => col.primaryKey())
    .addColumn('tenant_id', 'integer', (col) =>
      col.references('tenants.id').onDelete('cascade').notNull()
    )
    .addColumn('name', 'varchar(255)', (col) => col.notNull())
    .addColumn('code', 'varchar(50)')
    .addColumn('description', 'text')
    .addColumn('external_id', 'varchar(255)') // HEMIS/SIS faculty ID
    .addColumn('is_active', 'boolean', (col) => col.notNull().defaultTo(true))
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(db.fn.now()))
    .addColumn('updated_at', 'timestamptz', (col) => col.notNull().defaultTo(db.fn.now()))
    .execute();

  // ── 3. Programs (degree programs under faculties) ──
  await db.schema
    .createTable('programs')
    .addColumn('id', 'serial', (col) => col.primaryKey())
    .addColumn('tenant_id', 'integer', (col) =>
      col.references('tenants.id').onDelete('cascade').notNull()
    )
    .addColumn('faculty_id', 'integer', (col) =>
      col.references('faculties.id').onDelete('set null')
    )
    .addColumn('name', 'varchar(255)', (col) => col.notNull())
    .addColumn('code', 'varchar(50)')
    .addColumn('degree_type', 'varchar(50)') // bachelor | master | phd | certificate
    .addColumn('duration_years', 'integer')
    .addColumn('external_id', 'varchar(255)') // HEMIS/SIS program ID
    .addColumn('is_active', 'boolean', (col) => col.notNull().defaultTo(true))
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(db.fn.now()))
    .addColumn('updated_at', 'timestamptz', (col) => col.notNull().defaultTo(db.fn.now()))
    .execute();

  // ── 4. Course Offerings (term-specific instances of a course) ──
  // Links the catalog 'courses' table to a specific term, faculty, program
  await db.schema
    .createTable('course_offerings')
    .addColumn('id', 'serial', (col) => col.primaryKey())
    .addColumn('tenant_id', 'integer', (col) =>
      col.references('tenants.id').onDelete('cascade').notNull()
    )
    .addColumn('course_id', 'integer', (col) =>
      col.references('courses.id').onDelete('cascade').notNull()
    )
    .addColumn('term_id', 'integer', (col) =>
      col.references('academic_terms.id').onDelete('set null')
    )
    .addColumn('faculty_id', 'integer', (col) =>
      col.references('faculties.id').onDelete('set null')
    )
    .addColumn('program_id', 'integer', (col) =>
      col.references('programs.id').onDelete('set null')
    )
    .addColumn('name', 'varchar(255)') // Override name for this offering
    .addColumn('section', 'varchar(50)') // Section number/letter
    .addColumn('room', 'varchar(100)')
    .addColumn('schedule', 'varchar(255)') // e.g., "Mon/Wed 10:00-11:30"
    .addColumn('max_students', 'integer')
    .addColumn('status', 'varchar(20)', (col) => col.notNull().defaultTo('draft')) // draft | active | archived | cancelled
    .addColumn('external_id', 'varchar(255)') // HEMIS/SIS offering ID
    .addColumn('metadata', 'jsonb', (col) => col.defaultTo('{}'))
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(db.fn.now()))
    .addColumn('updated_at', 'timestamptz', (col) => col.notNull().defaultTo(db.fn.now()))
    .addColumn('archived_at', 'timestamptz')
    .execute();

  // ── 5. Groups (student groups within course offerings) ──
  await db.schema
    .createTable('groups')
    .addColumn('id', 'serial', (col) => col.primaryKey())
    .addColumn('tenant_id', 'integer', (col) =>
      col.references('tenants.id').onDelete('cascade').notNull()
    )
    .addColumn('course_offering_id', 'integer', (col) =>
      col.references('course_offerings.id').onDelete('cascade').notNull()
    )
    .addColumn('parent_group_id', 'integer', (col) =>
      col.references('groups.id').onDelete('set null')
    )
    .addColumn('name', 'varchar(255)', (col) => col.notNull())
    .addColumn('type', 'varchar(20)', (col) => col.notNull().defaultTo('study')) // study | lab | project | tutorial
    .addColumn('external_id', 'varchar(255)') // HEMIS/SIS group ID
    .addColumn('is_active', 'boolean', (col) => col.notNull().defaultTo(true))
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(db.fn.now()))
    .addColumn('updated_at', 'timestamptz', (col) => col.notNull().defaultTo(db.fn.now()))
    .execute();

  // ── 6. Group Memberships (student ↔ group assignment) ──
  await db.schema
    .createTable('group_memberships')
    .addColumn('id', 'serial', (col) => col.primaryKey())
    .addColumn('group_id', 'integer', (col) =>
      col.references('groups.id').onDelete('cascade').notNull()
    )
    .addColumn('user_id', 'integer', (col) =>
      col.references('users.id').onDelete('cascade').notNull()
    )
    .addColumn('role', 'varchar(20)', (col) => col.notNull().defaultTo('member')) // member | leader
    .addColumn('status', 'varchar(20)', (col) => col.notNull().defaultTo('active')) // active | inactive | removed
    .addColumn('enrolled_at', 'timestamptz', (col) => col.notNull().defaultTo(db.fn.now()))
    .addColumn('removed_at', 'timestamptz')
    .addUniqueConstraint('uq_group_member', ['group_id', 'user_id'])
    .execute();

  // ── 7. Enrollments (student ↔ course offering with lifecycle) ──
  await db.schema
    .createTable('enrollments')
    .addColumn('id', 'serial', (col) => col.primaryKey())
    .addColumn('tenant_id', 'integer', (col) =>
      col.references('tenants.id').onDelete('cascade').notNull()
    )
    .addColumn('user_id', 'integer', (col) =>
      col.references('users.id').onDelete('cascade').notNull()
    )
    .addColumn('course_offering_id', 'integer', (col) =>
      col.references('course_offerings.id').onDelete('cascade').notNull()
    )
    .addColumn('status', 'varchar(20)', (col) => col.notNull().defaultTo('active')) // active | completed | dropped | withdrawn
    .addColumn('source', 'varchar(20)', (col) => col.notNull().defaultTo('manual')) // manual | roster | api | sis_sync
    .addColumn('version', 'integer', (col) => col.notNull().defaultTo(1))
    .addColumn('external_id', 'varchar(255)') // HEMIS/SIS enrollment ID
    .addColumn('enrolled_at', 'timestamptz', (col) => col.notNull().defaultTo(db.fn.now()))
    .addColumn('dropped_at', 'timestamptz')
    .addColumn('completed_at', 'timestamptz')
    .addColumn('metadata', 'jsonb', (col) => col.defaultTo('{}'))
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(db.fn.now()))
    .addColumn('updated_at', 'timestamptz', (col) => col.notNull().defaultTo(db.fn.now()))
    .addUniqueConstraint('uq_enrollment_offering_user', ['course_offering_id', 'user_id'])
    .execute();

  // ── 8. Teacher Assignments (primary/co-teacher/grader roles) ──
  await db.schema
    .createTable('teacher_assignments')
    .addColumn('id', 'serial', (col) => col.primaryKey())
    .addColumn('course_offering_id', 'integer', (col) =>
      col.references('course_offerings.id').onDelete('cascade').notNull()
    )
    .addColumn('user_id', 'integer', (col) =>
      col.references('users.id').onDelete('cascade').notNull()
    )
    .addColumn('role', 'varchar(20)', (col) => col.notNull().defaultTo('primary')) // primary | co_teacher | grader | assistant
    .addColumn('assigned_at', 'timestamptz', (col) => col.notNull().defaultTo(db.fn.now()))
    .addColumn('revoked_at', 'timestamptz')
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(db.fn.now()))
    .addUniqueConstraint('uq_teacher_assignment', ['course_offering_id', 'user_id', 'role'])
    .execute();

  // ── Indexes for performance ──
  await db.schema
    .createIndex('idx_course_offerings_term')
    .on('course_offerings')
    .columns(['tenant_id', 'term_id', 'status'])
    .execute();

  await db.schema
    .createIndex('idx_course_offerings_teacher')
    .on('course_offerings')
    .columns(['course_id'])
    .execute();

  await db.schema
    .createIndex('idx_enrollments_user')
    .on('enrollments')
    .columns(['user_id', 'status'])
    .execute();

  await db.schema
    .createIndex('idx_enrollments_offering')
    .on('enrollments')
    .columns(['course_offering_id', 'status'])
    .execute();

  await db.schema
    .createIndex('idx_groups_offering')
    .on('groups')
    .columns(['course_offering_id', 'is_active'])
    .execute();

  await db.schema
    .createIndex('idx_teacher_assignments_offering')
    .on('teacher_assignments')
    .columns(['course_offering_id', 'role'])
    .execute();

  // ── Grant permissions to runtime role ──
  const academicTables = [
    'academic_terms', 'faculties', 'programs', 'course_offerings',
    'groups', 'group_memberships', 'enrollments', 'teacher_assignments',
  ];

  for (const table of academicTables) {
    await sql`GRANT SELECT, INSERT, UPDATE ON ${sql.table(table)} TO deborah_runtime`.execute(db);
    await sql`GRANT USAGE ON ${sql.table(table)}_id_seq TO deborah_runtime`.execute(db);
  }

  // Grant schema usage (required for roles to access tables)
  await sql`GRANT USAGE ON SCHEMA public TO deborah_runtime`.execute(db);
  await sql`GRANT USAGE ON SCHEMA public TO deborah_migration`.execute(db);
  await sql`GRANT USAGE ON SCHEMA public TO deborah_scoring`.execute(db);

  console.log('Academic structure created: 8 tables');
}

/**
 * @param {import('kysely').Kysely<any>} db
 */
export async function down(db) {
  await db.schema.dropTable('teacher_assignments').ifExists().execute();
  await db.schema.dropTable('enrollments').ifExists().execute();
  await db.schema.dropTable('group_memberships').ifExists().execute();
  await db.schema.dropTable('groups').ifExists().execute();
  await db.schema.dropTable('course_offerings').ifExists().execute();
  await db.schema.dropTable('programs').ifExists().execute();
  await db.schema.dropTable('faculties').ifExists().execute();
  await db.schema.dropTable('academic_terms').ifExists().execute();
}
