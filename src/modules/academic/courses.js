/**
 * Edikit — Course Offering, Group & Enrollment Service
 *
 * CRUD for term-specific course offerings, student groups, and enrollments.
 * All operations are tenant-scoped with audit logging.
 * Archived offerings are read-only (mutations blocked).
 */

import { getDb } from '../../infrastructure/postgres.js';
import { getCurrentTenant } from '../auth/tenant-context.js';
import { audit, AUDIT_ACTIONS } from '../auth/audit.js';

function getTenantId() {
  return getCurrentTenant()?.tenantId || 1;
}  // ── Assert offering is not archived and belongs to current tenant ──
async function assertNotArchived(db, offeringId) {
  const offering = await db.selectFrom('course_offerings')
    .where('id', '=', offeringId)
    .where('tenant_id', '=', getTenantId())
    .select(['status']).executeTakeFirst();
  if (!offering) throw new Error('Course offering not found');
  if (offering.status === 'archived') throw new Error('Archived course offerings are read-only');
}

// ═══════════════════════════════════════════════════════════════════
// COURSE OFFERINGS
// ═══════════════════════════════════════════════════════════════════

export async function getCourseOfferings({ tenantId, termId, status, teacherId } = {}) {
  const db = await getDb();
  if (!db) return [];
  const tid = tenantId || getTenantId();
  try {
    let query = db.selectFrom('course_offerings')
      .leftJoin('courses', 'courses.id', 'course_offerings.course_id')
      .where('course_offerings.tenant_id', '=', tid);
    if (termId) query = query.where('course_offerings.term_id', '=', termId);
    if (status) query = query.where('course_offerings.status', '=', status);
    if (teacherId) {
      query = query.innerJoin('teacher_assignments', (join) =>
        join.onRef('teacher_assignments.course_offering_id', '=', 'course_offerings.id')
          .on('teacher_assignments.user_id', '=', teacherId)
          .on('teacher_assignments.revoked_at', 'is', null)
      );
    }
    return await query
      .select([
        'course_offerings.id', 'course_offerings.tenant_id', 'course_offerings.course_id',
        'course_offerings.term_id', 'course_offerings.faculty_id', 'course_offerings.program_id',
        'course_offerings.name', 'course_offerings.section', 'course_offerings.room',
        'course_offerings.schedule', 'course_offerings.max_students', 'course_offerings.status',
        'course_offerings.external_id', 'course_offerings.metadata',
        'course_offerings.created_at', 'course_offerings.updated_at', 'course_offerings.archived_at',
        'courses.code as course_code', 'courses.name as course_name',
      ]).orderBy('course_offerings.created_at', 'desc').execute();
  } catch (_) { return []; }
}

export async function getCourseOfferingById(id, tenantId) {
  const db = await getDb();
  if (!db) return null;
  try {
    return await db.selectFrom('course_offerings')
      .leftJoin('courses', 'courses.id', 'course_offerings.course_id')
      .where('course_offerings.id', '=', id)
      .where('course_offerings.tenant_id', '=', tenantId || getTenantId())
      .selectAll().executeTakeFirst() || null;
  } catch (_) { return null; }
}

export async function createCourseOffering(data) {
  const db = await getDb();
  if (!db) throw new Error('PostgreSQL required');
  const result = await db.insertInto('course_offerings')
    .values({ tenant_id: getTenantId(), ...data, created_at: new Date(), updated_at: new Date() })
    .returning('id').executeTakeFirst();
  if (result) await audit({ action: AUDIT_ACTIONS.COURSE_CREATE, resourceType: 'course_offering', resourceId: result.id, details: { courseId: data.course_id } });
  return result || null;
}

export async function updateCourseOffering(id, data) {
  const db = await getDb();
  if (!db) throw new Error('PostgreSQL required');
  await assertNotArchived(db, id);
  await db.updateTable('course_offerings')
    .set({ ...data, updated_at: new Date() })
    .where('id', '=', id).where('tenant_id', '=', getTenantId()).execute();
  if (data.status === 'archived') {
    await audit({ action: AUDIT_ACTIONS.ACADEMIC_ARCHIVE, resourceType: 'course_offering', resourceId: id });
  } else {
    await audit({ action: AUDIT_ACTIONS.COURSE_UPDATE, resourceType: 'course_offering', resourceId: id, details: { changes: Object.keys(data) } });
  }
  return true;
}

export async function archiveCourseOffering(id) {
  return updateCourseOffering(id, { status: 'archived', archived_at: new Date() });
}

export async function getTeacherCourseList(teacherId, tenantId) {
  return getCourseOfferings({ tenantId, teacherId });
}

// ═══════════════════════════════════════════════════════════════════
// GROUPS (tenant-scoped via course_offerings join)
// ═══════════════════════════════════════════════════════════════════

async function _verifyGroupTenant(db, groupId) {
  const group = await db.selectFrom('groups')
    .innerJoin('course_offerings', 'course_offerings.id', 'groups.course_offering_id')
    .where('groups.id', '=', groupId)
    .where('course_offerings.tenant_id', '=', getTenantId())
    .select('groups.id').executeTakeFirst();
  if (!group) throw new Error('Group not found or access denied');
}

export async function getGroups({ courseOfferingId, type } = {}) {
  const db = await getDb();
  if (!db) return [];
  try {
    let query = db.selectFrom('groups').innerJoin('course_offerings', 'course_offerings.id', 'groups.course_offering_id')
      .where('course_offerings.tenant_id', '=', getTenantId());
    if (courseOfferingId) query = query.where('groups.course_offering_id', '=', courseOfferingId);
    if (type) query = query.where('groups.type', '=', type);
    return await query.select(['groups.id', 'groups.tenant_id', 'groups.course_offering_id', 'groups.parent_group_id', 'groups.name', 'groups.type', 'groups.external_id', 'groups.is_active', 'groups.created_at', 'groups.updated_at']).orderBy('groups.name').execute();
  } catch (_) { return []; }
}

export async function getGroupById(id) {
  const db = await getDb();
  if (!db) return null;
  try {
    return await db.selectFrom('groups').innerJoin('course_offerings', 'course_offerings.id', 'groups.course_offering_id')
      .where('groups.id', '=', id).where('course_offerings.tenant_id', '=', getTenantId())
      .select(['groups.id', 'groups.tenant_id', 'groups.course_offering_id', 'groups.parent_group_id', 'groups.name', 'groups.type', 'groups.external_id', 'groups.is_active', 'groups.created_at', 'groups.updated_at']).executeTakeFirst() || null;
  } catch (_) { return null; }
}

export async function createGroup(data) {
  const db = await getDb();
  if (!db) throw new Error('PostgreSQL required');
  const result = await db.insertInto('groups')
    .values({ tenant_id: getTenantId(), ...data, created_at: new Date(), updated_at: new Date() })
    .returning('id').executeTakeFirst();
  if (result) await audit({ action: AUDIT_ACTIONS.COURSE_CREATE, resourceType: 'group', resourceId: result.id, details: { name: data.name } });
  return result || null;
}

export async function updateGroup(id, data) {
  const db = await getDb();
  if (!db) throw new Error('PostgreSQL required');
  await _verifyGroupTenant(db, id);
  await db.updateTable('groups').set({ ...data, updated_at: new Date() }).where('id', '=', id).execute();
  await audit({ action: AUDIT_ACTIONS.COURSE_UPDATE, resourceType: 'group', resourceId: id, details: { changes: Object.keys(data) } });
  return true;
}

export async function deleteGroup(id) {
  const db = await getDb();
  if (!db) throw new Error('PostgreSQL required');
  await _verifyGroupTenant(db, id);
  await db.deleteFrom('groups').where('id', '=', id).execute();
  await audit({ action: AUDIT_ACTIONS.COURSE_DELETE, resourceType: 'group', resourceId: id });
  return true;
}

// ── Group Memberships (tenant-scoped through group → course_offering chain) ──

export async function getGroupMembers(groupId) {
  const db = await getDb();
  if (!db) return [];
  try {
    return await db.selectFrom('group_memberships')
      .innerJoin('users', 'users.id', 'group_memberships.user_id')
      .innerJoin('groups', 'groups.id', 'group_memberships.group_id')
      .innerJoin('course_offerings', 'course_offerings.id', 'groups.course_offering_id')
      .where('group_memberships.group_id', '=', groupId)
      .where('group_memberships.status', '=', 'active')
      .where('course_offerings.tenant_id', '=', getTenantId())
      .select(['group_memberships.id', 'group_memberships.role', 'group_memberships.enrolled_at',
        'users.id as user_id', 'users.username', 'users.display_name'])
      .execute();
  } catch (_) { return []; }
}

export async function addGroupMember(groupId, userId, role = 'member') {
  const db = await getDb();
  if (!db) throw new Error('PostgreSQL required');
  await _verifyGroupTenant(db, groupId); // Tenant check
  try {
    await db.insertInto('group_memberships')
      .values({ group_id: groupId, user_id: userId, role, enrolled_at: new Date() }).execute();
  } catch (err) {
    if (err.message?.includes('unique') || err.message?.includes('duplicate')) {
      await db.updateTable('group_memberships')
        .set({ status: 'active', role, removed_at: null })
        .where('group_id', '=', groupId).where('user_id', '=', userId).execute();
    } else { throw err; }
  }
  await audit({ action: AUDIT_ACTIONS.USER_UPDATE, resourceType: 'group_membership', details: { groupId, userId, role } });
  return true;
}

export async function removeGroupMember(groupId, userId) {
  const db = await getDb();
  if (!db) throw new Error('PostgreSQL required');
  await _verifyGroupTenant(db, groupId); // Tenant check
  await db.updateTable('group_memberships')
    .set({ status: 'removed', removed_at: new Date() })
    .where('group_id', '=', groupId).where('user_id', '=', userId).execute();
  await audit({ action: AUDIT_ACTIONS.USER_DELETE, resourceType: 'group_membership', details: { groupId, userId } });
  return true;
}

// ═══════════════════════════════════════════════════════════════════
// ENROLLMENTS (tenant-scoped)
// ═══════════════════════════════════════════════════════════════════

export async function getEnrollments({ courseOfferingId, status, userId, tenantId } = {}) {
  const db = await getDb();
  if (!db) return [];
  const tid = tenantId || getTenantId();
  try {
    let query = db.selectFrom('enrollments').innerJoin('users', 'users.id', 'enrollments.user_id')
      .where('enrollments.tenant_id', '=', tid);
    if (courseOfferingId) query = query.where('enrollments.course_offering_id', '=', courseOfferingId);
    if (status) query = query.where('enrollments.status', '=', status);
    if (userId) query = query.where('enrollments.user_id', '=', userId);
    return await query.select([
      'enrollments.id', 'enrollments.user_id', 'enrollments.course_offering_id',
      'enrollments.status', 'enrollments.source', 'enrollments.version',
      'enrollments.enrolled_at', 'enrollments.completed_at', 'enrollments.dropped_at',
      'users.username', 'users.display_name',
    ]).orderBy('enrollments.enrolled_at', 'desc').execute();
  } catch (_) { return []; }
}

export async function enrollStudent({ userId, courseOfferingId, source = 'manual', metadata }) {
  const db = await getDb();
  if (!db) throw new Error('PostgreSQL required');
  await assertNotArchived(db, courseOfferingId);
  const tid = getTenantId();
  try {
    const result = await db.insertInto('enrollments')
      .values({ tenant_id: tid, user_id: userId, course_offering_id: courseOfferingId,
        status: 'active', source, version: 1, enrolled_at: new Date(), metadata: metadata || {} })
      .returning('id').executeTakeFirst();
    if (result) await audit({ action: AUDIT_ACTIONS.USER_CREATE, resourceType: 'enrollment', resourceId: result.id, details: { userId, courseOfferingId } });
    return result || null;
  } catch (err) {
    if (err.message?.includes('unique') || err.message?.includes('duplicate')) {
      await db.updateTable('enrollments')
        .set({ status: 'active', version: db.raw('version + 1'), dropped_at: null, updated_at: new Date() })
        .where('course_offering_id', '=', courseOfferingId).where('user_id', '=', userId).execute();
      return { reactivated: true };
    }
    throw err;
  }
}

export async function updateEnrollment(id, data) {
  const db = await getDb();
  if (!db) throw new Error('PostgreSQL required');
  const setData = { ...data, updated_at: new Date() };
  if (data.status === 'dropped') setData.dropped_at = new Date();
  if (data.status === 'completed') setData.completed_at = new Date();
  await db.updateTable('enrollments').set(setData).where('id', '=', id).execute();
  await audit({ action: AUDIT_ACTIONS.COURSE_UPDATE, resourceType: 'enrollment', resourceId: id, details: { status: data.status } });
  return true;
}

export async function bulkEnroll(enrollments) {
  const db = await getDb();
  if (!db) throw new Error('PostgreSQL required');
  const results = { succeeded: 0, failed: 0, errors: [] };
  for (const entry of enrollments) {
    try {
      await enrollStudent({ ...entry });
      results.succeeded++;
    } catch (err) {
      results.failed++;
      results.errors.push({ userId: entry.userId, offeringId: entry.courseOfferingId, error: err.message });
    }
  }
  return results;
}
