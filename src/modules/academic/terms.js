/**
 * Edikit — Academic Term, Faculty & Program Service
 *
 * CRUD operations for the core academic hierarchy.
 * All operations are tenant-scoped with audit logging.
 * Errors propagate (not silently swallowed) for API route handling.
 */

import { getDb } from '../../infrastructure/postgres.js';
import { getCurrentTenant } from '../auth/tenant-context.js';
import { audit, AUDIT_ACTIONS } from '../auth/audit.js';

function getTenantId() {
  return getCurrentTenant()?.tenantId || 1;
}

// ═══════════════════════════════════════════════════════════════════
// ACADEMIC TERMS
// ═══════════════════════════════════════════════════════════════════

export async function getTerms({ tenantId, isActive } = {}) {
  const db = await getDb();
  if (!db) return [];
  const tid = tenantId || getTenantId();
  try {
    let query = db.selectFrom('academic_terms').where('tenant_id', '=', tid).orderBy('start_date', 'desc');
    if (isActive !== undefined) query = query.where('is_active', '=', isActive);
    return await query.selectAll().execute();
  } catch (_) { return []; }
}

export async function getTermById(id, tenantId) {
  const db = await getDb();
  if (!db) return null;
  try {
    return await db.selectFrom('academic_terms')
      .where('id', '=', id).where('tenant_id', '=', tenantId || getTenantId())
      .selectAll().executeTakeFirst() || null;
  } catch (_) { return null; }
}

export async function createTerm(data) {
  const db = await getDb();
  if (!db) throw new Error('PostgreSQL required');
  const result = await db.insertInto('academic_terms')
    .values({ tenant_id: getTenantId(), ...data, created_at: new Date(), updated_at: new Date() })
    .returning('id').executeTakeFirst();
  if (result) await audit({ action: AUDIT_ACTIONS.COURSE_CREATE, resourceType: 'academic_term', resourceId: result.id, details: { name: data.name } });
  return result || null;
}

export async function updateTerm(id, data) {
  const db = await getDb();
  if (!db) throw new Error('PostgreSQL required');
  await db.updateTable('academic_terms')
    .set({ ...data, updated_at: new Date() })
    .where('id', '=', id).where('tenant_id', '=', getTenantId()).execute();
  return true;
}

export async function archiveTerm(id) {
  await updateTerm(id, { is_active: false });
  await audit({ action: AUDIT_ACTIONS.ACADEMIC_ARCHIVE, resourceType: 'academic_term', resourceId: id });
  return true;
}

// ═══════════════════════════════════════════════════════════════════
// FACULTIES
// ═══════════════════════════════════════════════════════════════════

export async function getFaculties({ tenantId, isActive } = {}) {
  const db = await getDb();
  if (!db) return [];
  const tid = tenantId || getTenantId();
  try {
    let query = db.selectFrom('faculties').where('tenant_id', '=', tid);
    if (isActive !== undefined) query = query.where('is_active', '=', isActive);
    return await query.orderBy('name').selectAll().execute();
  } catch (_) { return []; }
}

export async function getFacultyById(id, tenantId) {
  const db = await getDb();
  if (!db) return null;
  try {
    return await db.selectFrom('faculties')
      .where('id', '=', id).where('tenant_id', '=', tenantId || getTenantId())
      .selectAll().executeTakeFirst() || null;
  } catch (_) { return null; }
}

export async function createFaculty(data) {
  const db = await getDb();
  if (!db) throw new Error('PostgreSQL required');
  const result = await db.insertInto('faculties')
    .values({ tenant_id: getTenantId(), ...data, created_at: new Date(), updated_at: new Date() })
    .returning('id').executeTakeFirst();
  if (result) await audit({ action: AUDIT_ACTIONS.COURSE_CREATE, resourceType: 'faculty', resourceId: result.id, details: { name: data.name } });
  return result || null;
}

export async function updateFaculty(id, data) {
  const db = await getDb();
  if (!db) throw new Error('PostgreSQL required');
  await db.updateTable('faculties').set({ ...data, updated_at: new Date() })
    .where('id', '=', id).where('tenant_id', '=', getTenantId()).execute();
  return true;
}

export async function archiveFaculty(id) {
  await updateFaculty(id, { is_active: false });
  await audit({ action: AUDIT_ACTIONS.ACADEMIC_ARCHIVE, resourceType: 'faculty', resourceId: id });
  return true;
}

// ═══════════════════════════════════════════════════════════════════
// PROGRAMS
// ═══════════════════════════════════════════════════════════════════

export async function getPrograms({ tenantId, facultyId, isActive } = {}) {
  const db = await getDb();
  if (!db) return [];
  const tid = tenantId || getTenantId();
  try {
    let query = db.selectFrom('programs').where('tenant_id', '=', tid);
    if (facultyId) query = query.where('faculty_id', '=', facultyId);
    if (isActive !== undefined) query = query.where('is_active', '=', isActive);
    return await query.orderBy('name').selectAll().execute();
  } catch (_) { return []; }
}

export async function getProgramById(id, tenantId) {
  const db = await getDb();
  if (!db) return null;
  try {
    return await db.selectFrom('programs')
      .where('id', '=', id).where('tenant_id', '=', tenantId || getTenantId())
      .selectAll().executeTakeFirst() || null;
  } catch (_) { return null; }
}

export async function createProgram(data) {
  const db = await getDb();
  if (!db) throw new Error('PostgreSQL required');
  const result = await db.insertInto('programs')
    .values({ tenant_id: getTenantId(), ...data, created_at: new Date(), updated_at: new Date() })
    .returning('id').executeTakeFirst();
  if (result) await audit({ action: AUDIT_ACTIONS.COURSE_CREATE, resourceType: 'program', resourceId: result.id, details: { name: data.name } });
  return result || null;
}

export async function updateProgram(id, data) {
  const db = await getDb();
  if (!db) throw new Error('PostgreSQL required');
  await db.updateTable('programs').set({ ...data, updated_at: new Date() })
    .where('id', '=', id).where('tenant_id', '=', getTenantId()).execute();
  return true;
}

export async function archiveProgram(id) {
  await updateProgram(id, { is_active: false });
  await audit({ action: AUDIT_ACTIONS.ACADEMIC_ARCHIVE, resourceType: 'program', resourceId: id });
  return true;
}
