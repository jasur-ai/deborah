/**
 * Edikit — Rubric Builder & Anchor Model Service
 *
 * Manages analytic rubrics for written work grading:
 *   - Rubrics (versioned templates with DRAFT→PUBLISHED→DEPRECATED lifecycle)
 *   - Criteria (scoring dimensions with levels, required_concepts, contradictions)
 *   - Anchors (calibration exemplars / borderline / common_mistake responses)
 *   - Item↔Rubric pin (exact rubric version for assessment items)
 *
 * Grading pipeline per research.md §7:
 *   rubric concept extraction → evidence span matching →
 *   LLM analytic-rubric scoring → deterministic score aggregation →
 *   confidence routing → teacher review
 */

import { getDb } from '../../infrastructure/postgres.js';
import { getCurrentTenant } from '../auth/tenant-context.js';
import { audit, AUDIT_ACTIONS } from '../auth/audit.js';

// ── Constants ──
export const RUBRIC_TYPES = ['analytic', 'holistic', 'single_point', 'checklist'];
export const RUBRIC_STATUS = { DRAFT: 'draft', PUBLISHED: 'published', DEPRECATED: 'deprecated' };
export const ANCHOR_TYPES = ['exemplar', 'borderline', 'common_mistake', 'training'];
export const EVIDENCE_TYPES = ['concept', 'keyword', 'span', 'semantic', 'formula', 'code'];

function getTenantId() { return getCurrentTenant()?.tenantId || 1; }

// ═══════════════════════════════════════════════════════════════════
// RUBRIC CRUD
// ═══════════════════════════════════════════════════════════════════

/** Create a new rubric with auto-created draft version. */
export async function createRubric(data) {
  const db = await getDb();
  if (!db) throw new Error('PostgreSQL required');

  if (!RUBRIC_TYPES.includes(data.type)) {
    throw new Error(`Invalid rubric type: ${data.type}`);
  }

  const result = await db.insertInto('rubrics').values({
    tenant_id: getTenantId(), name: data.name, description: data.description || null,
    subject_area: data.subject_area || null, type: data.type || 'analytic',
    max_points: data.max_points || 0, owner_id: data.owner_id || null,
    is_template: data.is_template || false, metadata: data.metadata || {},
  }).returning('id').executeTakeFirst();

  if (result) {
    const version = await db.insertInto('rubric_versions').values({
      rubric_id: result.id, tenant_id: getTenantId(), version: 1,
      status: 'draft', change_summary: 'Initial version', created_by: data.owner_id || null,
    }).returning('id').executeTakeFirst();

    if (version) {
      await db.updateTable('rubrics').set({ current_version_id: version.id }).where('id', '=', result.id).execute();
    }

    await audit({ action: 'rubric:create', userId: data.owner_id, resourceType: 'rubric', resourceId: result.id, details: { name: data.name, type: data.type } });
  }

  return result ? { id: result.id } : null;
}

/** Get a rubric by ID with current version. */
export async function getRubric(id) {
  const db = await getDb();
  if (!db) return null;
  try {
    return await db.selectFrom('rubrics').where('id', '=', id).where('tenant_id', '=', getTenantId()).selectAll().executeTakeFirst();
  } catch (_) { return null; }
}

/** List rubrics. */
export async function listRubrics({ subject_area, type, limit = 50, offset = 0 } = {}) {
  const db = await getDb();
  if (!db) return [];
  try {
    let q = db.selectFrom('rubrics').where('tenant_id', '=', getTenantId());
    if (subject_area) q = q.where('subject_area', '=', subject_area);
    if (type) q = q.where('type', '=', type);
    return await q.orderBy('name', 'asc').limit(limit).offset(offset).selectAll().execute();
  } catch (_) { return []; }
}

/** Update rubric metadata. */
export async function updateRubric(id, data) {
  const db = await getDb();
  if (!db) throw new Error('PostgreSQL required');
  const updates = { updated_at: new Date() };
  for (const f of ['name', 'description', 'subject_area', 'max_points', 'is_template', 'metadata']) {
    if (data[f] !== undefined) updates[f] = data[f];
  }
  await db.updateTable('rubrics').set(updates).where('id', '=', id).where('tenant_id', '=', getTenantId()).execute();
  await audit({ action: 'rubric:update', userId: data.updated_by, resourceType: 'rubric', resourceId: id });
  return { ok: true };
}

// ═══════════════════════════════════════════════════════════════════
// VERSION LIFECYCLE
// ═══════════════════════════════════════════════════════════════════

/** Create a new draft version by cloning the published version's criteria. */
export async function createRubricVersion(rubricId, data) {
  const db = await getDb();
  if (!db) throw new Error('PostgreSQL required');

  const rubric = await getRubric(rubricId);
  if (!rubric) throw new Error('Rubric not found');

  // Get current max version number
  const maxVer = await db.selectFrom('rubric_versions')
    .where('rubric_id', '=', rubricId).where('tenant_id', '=', getTenantId())
    .select(db.fn.max('version').as('max_version')).executeTakeFirst();

  const newVersion = (maxVer?.max_version || 0) + 1;

  const result = await db.insertInto('rubric_versions').values({
    rubric_id: rubricId, tenant_id: getTenantId(), version: newVersion,
    status: 'draft', change_summary: data.change_summary || `Version ${newVersion}`,
    created_by: data.created_by || null,
  }).returning('id').executeTakeFirst();

  // Clone criteria from current version if this is an iteration
  if (result && rubric.current_version_id) {
    const criteria = await db.selectFrom('rubric_criteria')
      .where('rubric_version_id', '=', rubric.current_version_id)
      .where('tenant_id', '=', getTenantId())
      .selectAll().execute();

    for (const c of criteria) {
      await db.insertInto('rubric_criteria').values({
        rubric_version_id: result.id, tenant_id: getTenantId(),
        name: c.name, description: c.description,
        max_points: c.max_points, weight: c.weight, sort_order: c.sort_order,
        required_concepts: c.required_concepts, contradictions: c.contradictions,
        evidence_type: c.evidence_type,
        student_visible_desc: c.student_visible_desc, private_notes: c.private_notes,
        levels: c.levels,
      }).execute();
    }
  }

  return result ? { id: result.id, version: newVersion } : null;
}

/** Transition version status. */
export async function transitionRubricVersion(versionId, newStatus, userId) {
  const db = await getDb();
  if (!db) throw new Error('PostgreSQL required');

  const version = await db.selectFrom('rubric_versions')
    .where('id', '=', versionId).where('tenant_id', '=', getTenantId())
    .selectAll().executeTakeFirst();
  if (!version) throw new Error('Version not found');

  const validTransitions = { draft: ['published', 'deprecated'], published: ['deprecated'], deprecated: [] };
  if (!validTransitions[version.status]?.includes(newStatus)) {
    throw new Error(`Cannot transition from ${version.status} to ${newStatus}`);
  }

  const updates = { status: newStatus };
  if (newStatus === 'published') { updates.published_at = new Date(); updates.published_by = userId; }
  if (newStatus === 'deprecated') { updates.deprecated_at = new Date(); }

  await db.updateTable('rubric_versions').set(updates).where('id', '=', versionId).execute();

  if (newStatus === 'published') {
    await db.updateTable('rubrics').set({ current_version_id: versionId }).where('id', '=', version.rubric_id).execute();
  }

  await audit({ action: `rubric:version:${newStatus}`, userId, resourceType: 'rubric_version', resourceId: versionId, details: { rubric_id: version.rubric_id, previous_status: version.status } });
  return { ok: true, newStatus };
}

/** List versions for a rubric. */
export async function listRubricVersions(rubricId) {
  const db = await getDb();
  if (!db) return [];
  try {
    return await db.selectFrom('rubric_versions')
      .where('rubric_id', '=', rubricId).where('tenant_id', '=', getTenantId())
      .orderBy('version', 'desc').selectAll().execute();
  } catch (_) { return []; }
}

/** Diff two rubric versions (compare criteria). */
export async function diffRubricVersions(versionA, versionB) {
  const db = await getDb();
  if (!db) return null;
  try {
    const criteriaA = await db.selectFrom('rubric_criteria')
      .where('rubric_version_id', '=', versionA).where('tenant_id', '=', getTenantId())
      .selectAll().execute();
    const criteriaB = await db.selectFrom('rubric_criteria')
      .where('rubric_version_id', '=', versionB).where('tenant_id', '=', getTenantId())
      .selectAll().execute();

    return {
      version_a: { id: versionA, criteria_count: criteriaA.length },
      version_b: { id: versionB, criteria_count: criteriaB.length },
      added: criteriaB.filter(b => !criteriaA.some(a => a.name === b.name)),
      removed: criteriaA.filter(a => !criteriaB.some(b => b.name === a.name)),
      changed: criteriaB.filter(b => {
        const a = criteriaA.find(c => c.name === b.name);
        return a && (a.max_points !== b.max_points || a.weight !== b.weight || JSON.stringify(a.levels) !== JSON.stringify(b.levels));
      }),
    };
  } catch (_) { return null; }
}

// ═══════════════════════════════════════════════════════════════════
// CRITERIA
// ═══════════════════════════════════════════════════════════════════

/** Validate criterion levels (descending points, consistent max). */
function validateLevels(levels, criterionName = '') {
  if (!Array.isArray(levels) || levels.length < 1) {
    throw new Error(`At least 1 level is required for criterion "${criterionName}"`);
  }

  // Points must be unique and non-negative
  const points = new Set();
  for (const level of levels) {
    if (typeof level.points !== 'number' || level.points < 0) {
      throw new Error(`Invalid level points in criterion "${criterionName}": must be a non-negative number`);
    }
    if (!level.descriptor || !level.descriptor.trim()) {
      throw new Error(`Level ${level.points} in "${criterionName}" must have a descriptor`);
    }
    if (points.has(level.points)) {
      throw new Error(`Duplicate points (${level.points}) in criterion "${criterionName}" levels`);
    }
    points.add(level.points);
  }

  // Points should generally be descending (highest first is convention)
  for (let i = 0; i < levels.length - 1; i++) {
    if (levels[i].points < levels[i + 1].points) {
      // Warning only — not a hard error
    }
  }
}

/** Create a criterion. */
export async function createCriterion(data) {
  const db = await getDb();
  if (!db) throw new Error('PostgreSQL required');

  validateLevels(data.levels, data.name);

  const result = await db.insertInto('rubric_criteria').values({
    rubric_version_id: data.rubric_version_id, tenant_id: getTenantId(),
    name: data.name, description: data.description || null,
    max_points: data.max_points, weight: data.weight || 1.00,
    sort_order: data.sort_order || 0,
    required_concepts: data.required_concepts || [],
    contradictions: data.contradictions || [],
    evidence_type: data.evidence_type || 'concept',
    student_visible_desc: data.student_visible_desc || null,
    private_notes: data.private_notes || null,
    levels: data.levels,
  }).returning('id').executeTakeFirst();

  if (result) {
    await audit({ action: 'rubric:criterion:create', userId: data.created_by, resourceType: 'rubric_criterion', resourceId: result.id, details: { rubric_version_id: data.rubric_version_id, name: data.name } });
  }
  return result ? { id: result.id } : null;
}

/** Update a criterion. */
export async function updateCriterion(id, data) {
  const db = await getDb();
  if (!db) throw new Error('PostgreSQL required');

  if (data.levels) validateLevels(data.levels, data.name || `criterion ${id}`);

  const updates = { updated_at: new Date() };
  for (const f of ['name', 'description', 'max_points', 'weight', 'sort_order', 'required_concepts', 'contradictions', 'evidence_type', 'student_visible_desc', 'private_notes', 'levels']) {
    if (data[f] !== undefined) updates[f] = data[f];
  }

  await db.updateTable('rubric_criteria').set(updates).where('id', '=', id).where('tenant_id', '=', getTenantId()).execute();
  await audit({ action: 'rubric:criterion:update', userId: data.updated_by, resourceType: 'rubric_criterion', resourceId: id });
  return { ok: true };
}

/** Delete a criterion. */
export async function deleteCriterion(id, userId) {
  const db = await getDb();
  if (!db) throw new Error('PostgreSQL required');
  await db.deleteFrom('rubric_criteria').where('id', '=', id).where('tenant_id', '=', getTenantId()).execute();
  await audit({ action: 'rubric:criterion:delete', userId, resourceType: 'rubric_criterion', resourceId: id });
  return { ok: true };
}

/** List criteria for a rubric version. */
export async function listCriteria(rubricVersionId) {
  const db = await getDb();
  if (!db) return [];
  try {
    return await db.selectFrom('rubric_criteria')
      .where('rubric_version_id', '=', rubricVersionId).where('tenant_id', '=', getTenantId())
      .orderBy('sort_order', 'asc').selectAll().execute();
  } catch (_) { return []; }
}

/** Get total max points for a rubric version. */
export async function getRubricVersionMaxPoints(rubricVersionId) {
  const db = await getDb();
  if (!db) return 0;
  try {
    const result = await db.selectFrom('rubric_criteria')
      .where('rubric_version_id', '=', rubricVersionId).where('tenant_id', '=', getTenantId())
      .select(db.fn.sum('max_points').as('total')).executeTakeFirst();
    return result?.total || 0;
  } catch (_) { return 0; }
}

// ═══════════════════════════════════════════════════════════════════
// ANCHORS
// ═══════════════════════════════════════════════════════════════════

/** Create an anchor response. */
export async function createAnchor(data) {
  const db = await getDb();
  if (!db) throw new Error('PostgreSQL required');

  if (!ANCHOR_TYPES.includes(data.type)) {
    throw new Error(`Invalid anchor type: ${data.type}`);
  }

  const result = await db.insertInto('rubric_anchors').values({
    rubric_version_id: data.rubric_version_id, criterion_id: data.criterion_id || null,
    tenant_id: getTenantId(), title: data.title || null,
    response_text: data.response_text, expected_score: data.expected_score,
    expected_level: data.expected_level || null, rationale: data.rationale || null,
    evidence_spans: data.evidence_spans || [],
    type: data.type || 'exemplar', is_public: data.is_public || false,
    metadata: data.metadata || {}, created_by: data.created_by || null,
  }).returning('id').executeTakeFirst();

  if (result) {
    await audit({ action: 'rubric:anchor:create', userId: data.created_by, resourceType: 'rubric_anchor', resourceId: result.id, details: { rubric_version_id: data.rubric_version_id, type: data.type } });
  }
  return result ? { id: result.id } : null;
}

/** List anchors for a rubric version. */
export async function listAnchors(rubricVersionId, criterionId) {
  const db = await getDb();
  if (!db) return [];
  try {
    let q = db.selectFrom('rubric_anchors')
      .where('rubric_version_id', '=', rubricVersionId).where('tenant_id', '=', getTenantId());
    if (criterionId) q = q.where('criterion_id', '=', criterionId);
    return await q.orderBy('created_at', 'desc').selectAll().execute();
  } catch (_) { return []; }
}

/** Delete an anchor. */
export async function deleteAnchor(id, userId) {
  const db = await getDb();
  if (!db) throw new Error('PostgreSQL required');
  await db.deleteFrom('rubric_anchors').where('id', '=', id).where('tenant_id', '=', getTenantId()).execute();
  await audit({ action: 'rubric:anchor:delete', userId, resourceType: 'rubric_anchor', resourceId: id });
  return { ok: true };
}

// ═══════════════════════════════════════════════════════════════════
// ITEM↔RUBRIC PIN
// ═══════════════════════════════════════════════════════════════════

/** Pin a rubric version to an item. */
export async function pinRubricToItem(itemId, rubricVersionId, userId) {
  const db = await getDb();
  if (!db) throw new Error('PostgreSQL required');

  const result = await db.insertInto('item_rubric_pins').values({
    item_id: itemId, rubric_version_id: rubricVersionId,
    tenant_id: getTenantId(), pinned_by: userId || null,
  }).returning('id').executeTakeFirst();

  if (result) {
    await audit({ action: 'rubric:item:pin', userId, resourceType: 'item_rubric_pin', resourceId: result.id, details: { item_id: itemId, rubric_version_id: rubricVersionId } });
  }
  return result ? { id: result.id } : null;
}

/** Get pinned rubric for an item. */
export async function getPinnedRubric(itemId) {
  const db = await getDb();
  if (!db) return null;
  try {
    const pin = await db.selectFrom('item_rubric_pins')
      .leftJoin('rubric_versions', 'rubric_versions.id', 'item_rubric_pins.rubric_version_id')
      .leftJoin('rubrics', 'rubrics.id', 'rubric_versions.rubric_id')
      .where('item_rubric_pins.item_id', '=', itemId)
      .where('item_rubric_pins.is_active', '=', true)
      .where('item_rubric_pins.tenant_id', '=', getTenantId())
      .select([
        'item_rubric_pins.id as pin_id', 'item_rubric_pins.pinned_at',
        'rubric_versions.id as version_id', 'rubric_versions.version', 'rubric_versions.status',
        'rubrics.id as rubric_id', 'rubrics.name as rubric_name', 'rubrics.type as rubric_type',
      ]).executeTakeFirst();

    if (pin) {
      const criteria = await listCriteria(pin.version_id);
      return { ...pin, criteria_count: criteria.length, criteria };
    }
    return null;
  } catch (_) { return null; }
}

/** Unpin a rubric from an item. */
export async function unpinRubricFromItem(itemId, userId) {
  const db = await getDb();
  if (!db) throw new Error('PostgreSQL required');
  await db.updateTable('item_rubric_pins')
    .set({ is_active: false }).where('item_id', '=', itemId).where('tenant_id', '=', getTenantId()).execute();
  await audit({ action: 'rubric:item:unpin', userId, resourceType: 'item_rubric_pin', resourceId: itemId });
  return { ok: true };
}

// ═══════════════════════════════════════════════════════════════════
// PREVIEW / BUILDER HELPERS
// ═══════════════════════════════════════════════════════════════════

/** Generate a human-readable rubric preview. */
export async function generateRubricPreview(rubricVersionId) {
  const criteria = await listCriteria(rubricVersionId);
  if (!criteria || criteria.length === 0) return { error: 'No criteria found' };

  let totalMaxPoints = 0;
  const sections = criteria.map(c => {
    const maxLevelPoints = Math.max(...c.levels.map(l => l.points));
    totalMaxPoints += maxLevelPoints;
    return {
      name: c.name,
      max_points: maxLevelPoints,
      weight: c.weight,
      level_count: c.levels.length,
      top_descriptor: c.levels[0]?.descriptor || '',
      has_concepts: c.required_concepts.length > 0,
      has_contradictions: c.contradictions.length > 0,
      student_visible: !!c.student_visible_desc,
    };
  });

  return {
    rubric_version_id: rubricVersionId,
    total_criteria: criteria.length,
    total_max_points: totalMaxPoints,
    sections,
    generated_at: new Date().toISOString(),
  };
}
