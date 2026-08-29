/**
 * Deborah — Assessment Brief Service
 *
 * Versioned summative assessment briefs:
 *   - Brief CRUD (draft mutable, approved immutable)
 *   - Material-change diff + notification tracking
 *   - DRAFT→APPROVED lifecycle (done-condition: approved before summative publish)
 *   - Institution locked fields enforced on every update
 *
 * SECURITY: brief content is schema-validated JSON (never JavaScript);
 * approved briefs are immutable; locked institution fields are denylist-enforced.
 */

import { getDb } from '../../infrastructure/postgres.js';
import { getCurrentTenant } from '../auth/tenant-context.js';
import { audit, AUDIT_ACTIONS } from '../auth/audit.js';
import {
  AI_USE_LEVELS,
  validateBriefSchema,
  checkLockedFieldChanges,
  diffBriefContent,
  mergeSectional,
} from './brief.schema.js';

function getTenantId() {
  return getCurrentTenant()?.tenantId || 1;
}

// ═══════════════════════════════════════════════════════════════════
// BRIEF CRUD
// ═══════════════════════════════════════════════════════════════════

export async function createBrief(data) {
  const db = await getDb();
  if (!db) throw new Error('PostgreSQL required');
  if (!data.title) throw new Error('Brief title is required');

  if (data.ai_use_level && !AI_USE_LEVELS.includes(data.ai_use_level)) {
    throw new Error(`Invalid ai_use_level: must be one of ${AI_USE_LEVELS.join(', ')}`);
  }

  const content = { ...(data.content || {}) };
  const schemaResult = validateBriefSchema(content);
  if (!schemaResult.ok) {
    throw new Error(`Invalid brief: ${schemaResult.errors.join('; ')}`);
  }

  const result = await db.insertInto('assessment_briefs')
    .values({
      tenant_id: getTenantId(),
      assessment_id: data.assessment_id || null,
      title: data.title,
      status: 'draft',
      version: 1,
      ai_use_level: data.ai_use_level || content.ai_use_level || 'A0',
      content,
      locked_fields: data.locked_fields || [],
      created_by: data.created_by || null,
    })
    .returning('id')
    .executeTakeFirst();

  if (result) {
    // Initial version snapshot
    await db.insertInto('assessment_brief_versions').values({
      brief_id: result.id,
      tenant_id: getTenantId(),
      version: 1,
      content_snapshot: content,
      ai_use_level_snapshot: data.ai_use_level || content.ai_use_level || 'A0',
      locked_fields_snapshot: data.locked_fields || [],
      change_summary: 'Brief created',
      is_material_change: false,
      changed_by: data.created_by || null,
    }).execute();

    await audit({
      action: AUDIT_ACTIONS.BRIEF_CREATE,
      userId: data.created_by,
      resourceType: 'assessment_brief',
      resourceId: result.id,
      details: { title: data.title, ai_use_level: data.ai_use_level || 'A0' },
    });
  }
  return result ? { id: result.id } : null;
}

export async function getBrief(id) {
  const db = await getDb();
  if (!db) return null;
  try {
    return await db.selectFrom('assessment_briefs')
      .where('id', '=', id)
      .where('tenant_id', '=', getTenantId())
      .selectAll()
      .executeTakeFirst();
  } catch (_) { return null; }
}

export async function listBriefs({ status, assessment_id, limit = 50, offset = 0 } = {}) {
  const db = await getDb();
  if (!db) return [];
  try {
    let query = db.selectFrom('assessment_briefs')
      .where('tenant_id', '=', getTenantId());
    if (status) query = query.where('status', '=', status);
    if (assessment_id) query = query.where('assessment_id', '=', assessment_id);
    return await query
      .orderBy('updated_at', 'desc')
      .limit(limit).offset(offset)
      .selectAll()
      .execute();
  } catch (_) { return []; }
}

/**
 * Update a DRAFT brief. Approved briefs are immutable.
 * Institution locked fields are denylist-enforced.
 */
export async function updateBrief(id, data) {
  const db = await getDb();
  if (!db) throw new Error('PostgreSQL required');

  const existing = await getBrief(id);
  if (!existing) throw new Error('Brief not found');
  if (existing.status !== 'draft') {
    throw new Error(`Brief is ${existing.status} — drafts are mutable, approved briefs are immutable`);
  }

  if (data.ai_use_level && !AI_USE_LEVELS.includes(data.ai_use_level)) {
    throw new Error(`Invalid ai_use_level: must be one of ${AI_USE_LEVELS.join(', ')}`);
  }

  // Section-level deep merge: partial nested sections keep untouched siblings.
  const proposedContent = mergeSectional(existing.content || {}, data.content || {});

  // Locked-field enforcement: teacher cannot change institution-locked values
  const locked = data.locked_fields || existing.locked_fields || [];
  const lockCheck = checkLockedFieldChanges(existing.content || {}, proposedContent, locked);
  if (!lockCheck.ok) {
    const paths = lockCheck.lockedChanges.map((c) => c.path).join(', ');
    throw new Error(`Institution-locked field(s) cannot be changed: ${paths}`);
  }

  const schemaResult = validateBriefSchema(proposedContent);
  if (!schemaResult.ok) {
    throw new Error(`Invalid brief: ${schemaResult.errors.join('; ')}`);
  }

  // Material-change detection for notification.
  // AI-use level changes (A0→A3) are ALWAYS material (research.md §27.2).
  const diff = diffBriefContent(existing.content || {}, proposedContent);
  const aiUseChanged = data.ai_use_level !== undefined &&
    data.ai_use_level !== existing.ai_use_level;
  const materialChange = diff.isMaterial || aiUseChanged;
  if (aiUseChanged) {
    diff.materialChanges.unshift({
      field: 'ai_use_level',
      from: existing.ai_use_level,
      to: data.ai_use_level,
    });
  }

  const newVersion = existing.version + 1;
  const updates = { updated_at: new Date(), version: newVersion, content: proposedContent };
  for (const f of ['title', 'assessment_id', 'ai_use_level', 'locked_fields']) {
    if (data[f] !== undefined) updates[f] = data[f];
  }

  await db.updateTable('assessment_briefs')
    .set(updates)
    .where('id', '=', id)
    .where('tenant_id', '=', getTenantId())
    .execute();

  // Version snapshot with material-change flag
  await db.insertInto('assessment_brief_versions').values({
    brief_id: id,
    tenant_id: getTenantId(),
    version: newVersion,
    content_snapshot: proposedContent,
    ai_use_level_snapshot: data.ai_use_level || existing.ai_use_level,
    locked_fields_snapshot: locked,
    change_summary: data.change_summary || (materialChange ? 'Material change' : 'Minor update'),
    is_material_change: materialChange,
    changed_by: data.updated_by || null,
  }).execute();

  await audit({
    action: AUDIT_ACTIONS.BRIEF_UPDATE,
    userId: data.updated_by,
    resourceType: 'assessment_brief',
    resourceId: id,
    details: {
      version: newVersion,
      material_change: diff.isMaterial,
      material_fields: diff.materialChanges.map((c) => c.field),
    },
  });

  return {
    ok: true,
    version: newVersion,
    materialChange,
    materialFields: diff.materialChanges.map((c) => c.field),
  };
}

export async function deleteBrief(id, userId) {
  const db = await getDb();
  if (!db) throw new Error('PostgreSQL required');

  const existing = await getBrief(id);
  if (existing && existing.status === 'approved') {
    throw new Error('Cannot delete an approved brief — archive it instead');
  }

  await db.deleteFrom('assessment_briefs')
    .where('id', '=', id)
    .where('tenant_id', '=', getTenantId())
    .execute();
  await audit({
    action: AUDIT_ACTIONS.BRIEF_DELETE,
    userId,
    resourceType: 'assessment_brief',
    resourceId: id,
  });
  return { ok: true };
}

// ═══════════════════════════════════════════════════════════════════
// LIFECYCLE & VERSIONS
// ═══════════════════════════════════════════════════════════════════

/** Approve a draft brief (immutable afterwards). */
export async function approveBrief(id, { userId } = {}) {
  const db = await getDb();
  if (!db) throw new Error('PostgreSQL required');

  const existing = await getBrief(id);
  if (!existing) throw new Error('Brief not found');
  if (existing.status !== 'draft') throw new Error(`Brief is already ${existing.status}`);

  // Approval gate: schema must be valid
  const schemaResult = validateBriefSchema(existing.content || {});
  if (!schemaResult.ok) {
    throw new Error(`Cannot approve: ${schemaResult.errors.join('; ')}`);
  }

  await db.updateTable('assessment_briefs')
    .set({
      status: 'approved',
      approved_at: new Date(),
      approved_by: userId || null,
      updated_at: new Date(),
    })
    .where('id', '=', id)
    .where('tenant_id', '=', getTenantId())
    .execute();

  await audit({
    action: AUDIT_ACTIONS.BRIEF_APPROVE,
    userId,
    resourceType: 'assessment_brief',
    resourceId: id,
  });
  return { ok: true };
}

export async function getBriefVersions(id) {
  const db = await getDb();
  if (!db) return [];
  try {
    return await db.selectFrom('assessment_brief_versions')
      .where('brief_id', '=', id)
      .where('tenant_id', '=', getTenantId())
      .orderBy('version', 'desc')
      .selectAll()
      .execute();
  } catch (_) { return []; }
}

export async function diffBriefVersions(id, versionA, versionB) {
  const db = await getDb();
  if (!db) return null;
  try {
    const [vA, vB] = await Promise.all([
      db.selectFrom('assessment_brief_versions')
        .where('brief_id', '=', id)
        .where('version', '=', versionA)
        .where('tenant_id', '=', getTenantId())
        .selectAll()
        .executeTakeFirst(),
      db.selectFrom('assessment_brief_versions')
        .where('brief_id', '=', id)
        .where('version', '=', versionB)
        .where('tenant_id', '=', getTenantId())
        .selectAll()
        .executeTakeFirst(),
    ]);
    if (!vA || !vB) throw new Error('Version not found');

    const diff = diffBriefContent(vA.content_snapshot || {}, vB.content_snapshot || {});
    const aiUseChanged = vA.ai_use_level_snapshot !== vB.ai_use_level_snapshot;
    if (aiUseChanged) {
      diff.materialChanges.unshift({
        field: 'ai_use_level',
        from: vA.ai_use_level_snapshot,
        to: vB.ai_use_level_snapshot,
      });
      diff.isMaterial = true;
    }
    return {
      from: versionA,
      to: versionB,
      ...diff,
      ai_use_changed: aiUseChanged,
    };
  } catch (err) { throw err; }
}
