/**
 * Deborah — Teacher Assignment Service
 *
 * Manages teacher/co-teacher/grader assignments for course offerings.
 * All operations are tenant-scoped.
 *
 * @module academic/teachers
 */

import { getDb } from '../../infrastructure/postgres.js';
import { getCurrentTenant } from '../auth/tenant-context.js';

function getTenantId() {
  return getCurrentTenant()?.tenantId || 1;
}

/**
 * Get all teacher assignments for a tenant (optionally filtered).
 */
export async function getTeacherAssignments({ courseOfferingId, userId, role, includeRevoked } = {}) {
  const db = await getDb();
  if (!db) return [];
  try {
    let query = db.selectFrom('teacher_assignments')
      .innerJoin('users', 'users.id', 'teacher_assignments.user_id')
      .innerJoin('course_offerings', 'course_offerings.id', 'teacher_assignments.course_offering_id')
      .where('course_offerings.tenant_id', '=', getTenantId());
    if (courseOfferingId) query = query.where('teacher_assignments.course_offering_id', '=', courseOfferingId);
    if (userId) query = query.where('teacher_assignments.user_id', '=', userId);
    if (role) query = query.where('teacher_assignments.role', '=', role);
    if (!includeRevoked) query = query.where('teacher_assignments.revoked_at', 'is', null);
    return await query
      .select([
        'teacher_assignments.id', 'teacher_assignments.course_offering_id',
        'teacher_assignments.user_id', 'teacher_assignments.role',
        'teacher_assignments.assigned_at', 'teacher_assignments.revoked_at',
        'users.username', 'users.display_name',
        'course_offerings.name as course_name', 'course_offerings.section',
      ])
      .orderBy('teacher_assignments.assigned_at', 'desc')
      .execute();
  } catch (_) { return []; }
}

/**
 * Assign a teacher role to a course offering.
 */
export async function assignTeacher({ courseOfferingId, userId, role = 'primary' }) {
  const db = await getDb();
  if (!db) throw new Error('PostgreSQL required');
  try {
    await db.insertInto('teacher_assignments')
      .values({ course_offering_id: courseOfferingId, user_id: userId, role, assigned_at: new Date() })
      .execute();
    return true;
  } catch (err) {
    // Already assigned — reactivate
    if (err.message?.includes('unique') || err.message?.includes('duplicate')) {
      await db.updateTable('teacher_assignments')
        .set({ revoked_at: null, assigned_at: new Date() })
        .where('course_offering_id', '=', courseOfferingId)
        .where('user_id', '=', userId)
        .where('role', '=', role)
        .execute();
      return true;
    }
    throw err;
  }
}

/**
 * Revoke a teacher assignment.
 */
export async function revokeTeacherAssignment(courseOfferingId, userId) {
  const db = await getDb();
  if (!db) throw new Error('PostgreSQL required');
  try {
    await db.updateTable('teacher_assignments')
      .set({ revoked_at: new Date() })
      .where('course_offering_id', '=', courseOfferingId)
      .where('user_id', '=', userId)
      .where('revoked_at', 'is', null)
      .execute();
    return true;
  } catch (_) { return false; }
}

/**
 * Get all teachers for a specific course offering.
 */
export async function getTeachersForOffering(courseOfferingId) {
  return getTeacherAssignments({ courseOfferingId, includeRevoked: false });
}

/**
 * Check if a user is a teacher (any role) for a specific offering.
 */
export async function isTeacherOfOffering(userId, courseOfferingId) {
  const db = await getDb();
  if (!db) return false;
  try {
    const result = await db.selectFrom('teacher_assignments')
      .where('course_offering_id', '=', courseOfferingId)
      .where('user_id', '=', userId)
      .where('revoked_at', 'is', null)
      .select('id')
      .executeTakeFirst();
    return !!result;
  } catch (_) { return false; }
}

/**
 * Get all course offerings for a teacher (across all roles).
 */
export async function getTeacherOfferings(userId) {
  const db = await getDb();
  if (!db) return [];
  try {
    return await db.selectFrom('teacher_assignments')
      .innerJoin('course_offerings', 'course_offerings.id', 'teacher_assignments.course_offering_id')
      .innerJoin('courses', 'courses.id', 'course_offerings.course_id')
      .where('teacher_assignments.user_id', '=', userId)
      .where('teacher_assignments.revoked_at', 'is', null)
      .where('course_offerings.status', 'in', ['draft', 'active'])
      .select([
        'course_offerings.id', 'course_offerings.name', 'course_offerings.section',
        'course_offerings.status', 'course_offerings.created_at',
        'courses.code', 'courses.name as course_name',
        'teacher_assignments.role',
      ])
      .orderBy('course_offerings.created_at', 'desc')
      .execute();
  } catch (_) { return []; }
}
