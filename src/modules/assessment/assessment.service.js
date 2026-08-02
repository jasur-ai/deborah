/**
 * Edikit — Assessment Builder Service
 *
 * Course/outcome/section/item/scoring based assessment draft builder.
 *   - Templates: reusable assessment templates
 *   - Drafts: mutable assessments with blueprint + randomization config
 *   - Versions: immutable snapshots (draft mutable, published immutable)
 *   - Sections: ordered, weighted sections
 *   - Items: item pool links with per-item points/time
 *
 * SECURITY: draft mutable, published immutable; student preview (public render)
 * never contains private scoring keys — author preview is gated by caller
 * authorization (routes enforce requireAuth + ownership).
 */

import { getDb } from '../../infrastructure/postgres.js';
import { getCurrentTenant } from '../auth/tenant-context.js';
import { audit, AUDIT_ACTIONS } from '../auth/audit.js';
import {
  ASSESSMENT_TYPES,
  ASSESSMENT_STATUS,
  ASSESSMENT_STATUS_TRANSITIONS,
  validateBlueprint,
  validateScoreTimeArithmetic,
  renderStudentPreview,
} from './blueprint.js';

// Constants (ASSESSMENT_TYPES, ASSESSMENT_STATUS, ...) live in blueprint.js
// — single source of truth; re-exported via the module barrel.

export { ASSESSMENT_TYPES, ASSESSMENT_STATUS, ASSESSMENT_STATUS_TRANSITIONS };

function getTenantId() {
  return getCurrentTenant()?.tenantId || 1;
}

function assertType(type) {
  if (!ASSESSMENT_TYPES.includes(type)) {
    throw new Error(`Invalid assessment type: ${type}. Must be one of: ${ASSESSMENT_TYPES.join(', ')}`);
  }
}

// ═══════════════════════════════════════════════════════════════════
// TEMPLATES
// ═══════════════════════════════════════════════════════════════════

export async function createAssessmentTemplate(data) {
  const db = await getDb();
  if (!db) throw new Error('PostgreSQL required');
  if (!data.name) throw new Error('Template name is required');
  if (data.assessment_type) assertType(data.assessment_type);

  const result = await db.insertInto('assessment_templates')
    .values({
      tenant_id: getTenantId(),
      name: data.name,
      description: data.description || null,
      assessment_type: data.assessment_type || 'formative',
      default_total_points: data.default_total_points || 0,
      default_time_seconds: data.default_time_seconds || 0,
      default_blueprint: data.default_blueprint || {},
      default_randomization: data.default_randomization || {},
      is_public: data.is_public || false,
      created_by: data.created_by || null,
    })
    .returning('id')
    .executeTakeFirst();

  if (result) {
    await audit({
      action: AUDIT_ACTIONS.ASSESSMENT_TEMPLATE_CREATE,
      userId: data.created_by,
      resourceType: 'assessment_template',
      resourceId: result.id,
      details: { name: data.name },
    });
  }
  return result ? { id: result.id } : null;
}

export async function getAssessmentTemplate(id) {
  const db = await getDb();
  if (!db) return null;
  try {
    return await db.selectFrom('assessment_templates')
      .where('id', '=', id)
      .where('tenant_id', '=', getTenantId())
      .selectAll()
      .executeTakeFirst();
  } catch (_) { return null; }
}

export async function listAssessmentTemplates({ assessment_type, is_public, limit = 50, offset = 0 } = {}) {
  const db = await getDb();
  if (!db) return [];
  try {
    let query = db.selectFrom('assessment_templates')
      .where('tenant_id', '=', getTenantId());
    if (assessment_type) query = query.where('assessment_type', '=', assessment_type);
    if (is_public !== undefined) query = query.where('is_public', '=', is_public);
    return await query
      .orderBy('name', 'asc')
      .limit(limit).offset(offset)
      .selectAll()
      .execute();
  } catch (_) { return []; }
}

export async function updateAssessmentTemplate(id, data) {
  const db = await getDb();
  if (!db) throw new Error('PostgreSQL required');
  if (data.assessment_type) assertType(data.assessment_type);

  const updates = { updated_at: new Date() };
  for (const f of ['name', 'description', 'assessment_type', 'default_total_points',
    'default_time_seconds', 'default_blueprint', 'default_randomization', 'is_public']) {
    if (data[f] !== undefined) updates[f] = data[f];
  }

  await db.updateTable('assessment_templates')
    .set(updates)
    .where('id', '=', id)
    .where('tenant_id', '=', getTenantId())
    .execute();

  await audit({
    action: AUDIT_ACTIONS.ASSESSMENT_TEMPLATE_UPDATE,
    userId: data.updated_by,
    resourceType: 'assessment_template',
    resourceId: id,
  });
  return { ok: true };
}

export async function deleteAssessmentTemplate(id, userId) {
  const db = await getDb();
  if (!db) throw new Error('PostgreSQL required');
  await db.deleteFrom('assessment_templates')
    .where('id', '=', id)
    .where('tenant_id', '=', getTenantId())
    .execute();
  await audit({
    action: AUDIT_ACTIONS.ASSESSMENT_TEMPLATE_DELETE,
    userId,
    resourceType: 'assessment_template',
    resourceId: id,
  });
  return { ok: true };
}

// ═══════════════════════════════════════════════════════════════════
// ASSESSMENTS (draft builder root)
// ═══════════════════════════════════════════════════════════════════

export async function createAssessment(data) {
  const db = await getDb();
  if (!db) throw new Error('PostgreSQL required');
  if (!data.title) throw new Error('Assessment title is required');
  if (data.assessment_type) assertType(data.assessment_type);

  // Validate blueprint arithmetic at creation time (fast-fail)
  const bpResult = validateBlueprint(data.blueprint || {});
  if (!bpResult.ok) {
    throw new Error(`Invalid blueprint: ${bpResult.errors.join('; ')}`);
  }

  const result = await db.insertInto('assessments')
    .values({
      tenant_id: getTenantId(),
      template_id: data.template_id || null,
      course_id: data.course_id || null,
      title: data.title,
      description: data.description || null,
      assessment_type: data.assessment_type || 'formative',
      status: 'draft',
      blueprint: data.blueprint || {},
      randomization_config: data.randomization_config || {},
      total_points: data.total_points || 0,
      total_time_seconds: data.total_time_seconds || 0,
      item_count: data.item_count || 0,
      created_by: data.created_by || null,
    })
    .returning('id')
    .executeTakeFirst();

  if (result) {
    await audit({
      action: AUDIT_ACTIONS.ASSESSMENT_CREATE,
      userId: data.created_by,
      resourceType: 'assessment',
      resourceId: result.id,
      details: { title: data.title, type: data.assessment_type },
    });
  }
  return result ? { id: result.id } : null;
}

export async function getAssessment(id) {
  const db = await getDb();
  if (!db) return null;
  try {
    return await db.selectFrom('assessments')
      .where('id', '=', id)
      .where('tenant_id', '=', getTenantId())
      .selectAll()
      .executeTakeFirst();
  } catch (_) { return null; }
}

export async function listAssessments({ status, assessment_type, course_id, limit = 50, offset = 0 } = {}) {
  const db = await getDb();
  if (!db) return [];
  try {
    let query = db.selectFrom('assessments')
      .where('tenant_id', '=', getTenantId());
    if (status) query = query.where('status', '=', status);
    if (assessment_type) query = query.where('assessment_type', '=', assessment_type);
    if (course_id) query = query.where('course_id', '=', course_id);
    return await query
      .orderBy('updated_at', 'desc')
      .limit(limit).offset(offset)
      .selectAll()
      .execute();
  } catch (_) { return []; }
}

/**
 * Update a DRAFT assessment only.
 * Published/archived assessments are IMMUTABLE — silent edits are rejected.
 */
export async function updateAssessment(id, data) {
  const db = await getDb();
  if (!db) throw new Error('PostgreSQL required');

  const existing = await getAssessment(id);
  if (!existing) throw new Error('Assessment not found');
  if (existing.status !== 'draft') {
    throw new Error(`Assessment is ${existing.status} — drafts are mutable, published assessments are immutable`);
  }
  if (data.assessment_type) assertType(data.assessment_type);

  const updates = { updated_at: new Date() };
  for (const f of ['template_id', 'course_id', 'title', 'description', 'assessment_type',
    'blueprint', 'randomization_config', 'total_points', 'total_time_seconds', 'item_count']) {
    if (data[f] !== undefined) updates[f] = data[f];
  }

  if (data.blueprint) {
    const bpResult = validateBlueprint(data.blueprint, { expectedTotalItems: data.item_count });
    if (!bpResult.ok) {
      throw new Error(`Invalid blueprint: ${bpResult.errors.join('; ')}`);
    }
  }

  await db.updateTable('assessments')
    .set(updates)
    .where('id', '=', id)
    .where('tenant_id', '=', getTenantId())
    .execute();

  await audit({
    action: AUDIT_ACTIONS.ASSESSMENT_UPDATE,
    userId: data.updated_by,
    resourceType: 'assessment',
    resourceId: id,
  });
  return { ok: true };
}

export async function deleteAssessment(id, userId) {
  const db = await getDb();
  if (!db) throw new Error('PostgreSQL required');

  const existing = await getAssessment(id);
  if (existing && existing.status === 'published') {
    throw new Error('Cannot delete a published assessment — archive it instead');
  }

  await db.deleteFrom('assessments')
    .where('id', '=', id)
    .where('tenant_id', '=', getTenantId())
    .execute();
  await audit({
    action: AUDIT_ACTIONS.ASSESSMENT_DELETE,
    userId,
    resourceType: 'assessment',
    resourceId: id,
  });
  return { ok: true };
}

// ═══════════════════════════════════════════════════════════════════
// STATUS TRANSITION & VERSIONING
// ═══════════════════════════════════════════════════════════════════

/** Create an immutable version snapshot of the current assessment content. */
export async function createAssessmentVersion(id, { userId, changeSummary } = {}) {
  const db = await getDb();
  if (!db) throw new Error('PostgreSQL required');

  const assessment = await getAssessment(id);
  if (!assessment) throw new Error('Assessment not found');

  const [sections, items] = await Promise.all([
    listSections(id),
    listItems(id),
  ]);

  // Snapshot items with PUBLIC data only — strip private_data (defense in depth)
  const publicItems = items.map((it) => ({
    id: it.id,
    item_id: it.item_id,
    section_id: it.section_id,
    points: it.points,
    time_seconds: it.time_seconds,
    sort_order: it.sort_order,
    is_pinned: it.is_pinned,
    public_data: it.public_data || {},
    question_type: it.question_type || null,
    difficulty: it.difficulty || null,
    // NO private_data here
  }));

  const last = await db.selectFrom('assessment_versions')
    .where('assessment_id', '=', id)
    .where('tenant_id', '=', getTenantId())
    .orderBy('version', 'desc')
    .limit(1)
    .select('version')
    .executeTakeFirst();

  const version = (last?.version || 0) + 1;

  const result = await db.insertInto('assessment_versions')
    .values({
      assessment_id: id,
      tenant_id: getTenantId(),
      version,
      status_snapshot: assessment.status,
      blueprint_snapshot: assessment.blueprint || {},
      randomization_snapshot: assessment.randomization_config || {},
      sections_snapshot: sections.map((s) => ({ ...s })),
      items_snapshot: publicItems,
      total_points: assessment.total_points,
      total_time_seconds: assessment.total_time_seconds,
      change_summary: changeSummary || `Version ${version} created`,
      created_by: userId || null,
    })
    .returning('id')
    .executeTakeFirst();

  await audit({
    action: AUDIT_ACTIONS.ASSESSMENT_VERSION_CREATE,
    userId,
    resourceType: 'assessment',
    resourceId: id,
    details: { version },
  });

  return result ? { id: result.id, version } : null;
}

/** Publish a draft: validates arithmetic, snapshots version, marks immutable. */
export async function publishAssessment(id, { userId } = {}) {
  const db = await getDb();
  if (!db) throw new Error('PostgreSQL required');

  const assessment = await getAssessment(id);
  if (!assessment) throw new Error('Assessment not found');
  if (assessment.status !== 'draft') {
    throw new Error(`Assessment is already ${assessment.status}`);
  }

  const sections = await listSections(id);
  const items = await listItems(id);

  // Publish gate: score/time arithmetic must be valid
  const arith = validateScoreTimeArithmetic({
    totalPoints: assessment.total_points,
    totalTimeSeconds: assessment.total_time_seconds,
    sections,
    items,
  });
  if (!arith.ok) {
    throw new Error(`Cannot publish: ${arith.errors.join('; ')}`);
  }
  const bpResult = validateBlueprint(assessment.blueprint || {}, {
    expectedTotalItems: assessment.item_count,
  });
  if (!bpResult.ok) {
    throw new Error(`Cannot publish: ${bpResult.errors.join('; ')}`);
  }

  const versionRec = await createAssessmentVersion(id, {
    userId,
    changeSummary: 'Published',
  });

  await db.updateTable('assessments')
    .set({
      status: 'published',
      published_version_id: versionRec?.id || null,
      updated_at: new Date(),
    })
    .where('id', '=', id)
    .where('tenant_id', '=', getTenantId())
    .execute();

  await audit({
    action: AUDIT_ACTIONS.ASSESSMENT_PUBLISH,
    userId,
    resourceType: 'assessment',
    resourceId: id,
    details: { version: versionRec?.version },
  });

  return { ok: true, version: versionRec?.version };
}

export async function getAssessmentVersions(id) {
  const db = await getDb();
  if (!db) return [];
  try {
    return await db.selectFrom('assessment_versions')
      .where('assessment_id', '=', id)
      .where('tenant_id', '=', getTenantId())
      .orderBy('version', 'desc')
      .selectAll()
      .execute();
  } catch (_) { return []; }
}

export async function diffAssessmentVersions(id, versionA, versionB) {
  const db = await getDb();
  if (!db) return null;
  try {
    const [vA, vB] = await Promise.all([
      db.selectFrom('assessment_versions')
        .where('assessment_id', '=', id)
        .where('version', '=', versionA)
        .where('tenant_id', '=', getTenantId())
        .selectAll()
        .executeTakeFirst(),
      db.selectFrom('assessment_versions')
        .where('assessment_id', '=', id)
        .where('version', '=', versionB)
        .where('tenant_id', '=', getTenantId())
        .selectAll()
        .executeTakeFirst(),
    ]);
    if (!vA || !vB) throw new Error('Version not found');

    const diff = { blueprint_changed: false, items_changed: false, meta_changed: false, details: [] };

    if (JSON.stringify(vA.blueprint_snapshot) !== JSON.stringify(vB.blueprint_snapshot)) {
      diff.blueprint_changed = true;
      diff.details.push({ field: 'blueprint', from: vA.blueprint_snapshot, to: vB.blueprint_snapshot });
    }
    if (vA.items_snapshot?.length !== vB.items_snapshot?.length) {
      diff.items_changed = true;
    } else if (JSON.stringify(vA.items_snapshot) !== JSON.stringify(vB.items_snapshot)) {
      diff.items_changed = true;
    }
    if (String(vA.total_points) !== String(vB.total_points) ||
        vA.total_time_seconds !== vB.total_time_seconds) {
      diff.meta_changed = true;
      diff.details.push({
        field: 'totals',
        from: { points: vA.total_points, time: vA.total_time_seconds },
        to: { points: vB.total_points, time: vB.total_time_seconds },
      });
    }
    return diff;
  } catch (err) { throw err; }
}

// ═══════════════════════════════════════════════════════════════════
// SECTIONS
// ═══════════════════════════════════════════════════════════════════

export async function addSection(assessmentId, data) {
  const db = await getDb();
  if (!db) throw new Error('PostgreSQL required');

  const assessment = await getAssessment(assessmentId);
  if (!assessment) throw new Error('Assessment not found');
  if (assessment.status !== 'draft') throw new Error('Published assessments are immutable');

  const maxOrder = await db.selectFrom('assessment_sections')
    .where('assessment_id', '=', assessmentId)
    .where('tenant_id', '=', getTenantId())
    .select(db.fn.max('sort_order').as('max_order'))
    .executeTakeFirst();

  const result = await db.insertInto('assessment_sections')
    .values({
      assessment_id: assessmentId,
      tenant_id: getTenantId(),
      title: data.title,
      description: data.description || null,
      sort_order: data.sort_order ?? ((maxOrder?.max_order ?? -1) + 1),
      item_type_filter: data.item_type_filter || null,
      difficulty_filter: data.difficulty_filter || null,
      outcome_weights: data.outcome_weights || [],
      max_points: data.max_points || null,
      max_time_seconds: data.max_time_seconds || null,
    })
    .returning('id')
    .executeTakeFirst();

  return result ? { id: result.id } : null;
}

export async function updateSection(sectionId, data) {
  const db = await getDb();
  if (!db) throw new Error('PostgreSQL required');

  const section = await db.selectFrom('assessment_sections')
    .where('id', '=', sectionId)
    .where('tenant_id', '=', getTenantId())
    .selectAll()
    .executeTakeFirst();
  if (!section) throw new Error('Section not found');

  const assessment = await getAssessment(section.assessment_id);
  if (!assessment) throw new Error('Assessment not found');
  if (assessment.status !== 'draft') throw new Error('Published assessments are immutable');

  const updates = { updated_at: new Date() };
  for (const f of ['title', 'description', 'sort_order', 'item_type_filter',
    'difficulty_filter', 'outcome_weights', 'max_points', 'max_time_seconds']) {
    if (data[f] !== undefined) updates[f] = data[f];
  }

  await db.updateTable('assessment_sections')
    .set(updates)
    .where('id', '=', sectionId)
    .where('tenant_id', '=', getTenantId())
    .execute();

  return { ok: true };
}

export async function removeSection(sectionId) {
  const db = await getDb();
  if (!db) throw new Error('PostgreSQL required');

  const section = await db.selectFrom('assessment_sections')
    .where('id', '=', sectionId)
    .where('tenant_id', '=', getTenantId())
    .selectAll()
    .executeTakeFirst();
  if (!section) throw new Error('Section not found');

  const assessment = await getAssessment(section.assessment_id);
  if (assessment && assessment.status !== 'draft') {
    throw new Error('Published assessments are immutable');
  }

  await db.deleteFrom('assessment_sections')
    .where('id', '=', sectionId)
    .where('tenant_id', '=', getTenantId())
    .execute();
  return { ok: true };
}

export async function listSections(assessmentId) {
  const db = await getDb();
  if (!db) return [];
  try {
    return await db.selectFrom('assessment_sections')
      .where('assessment_id', '=', assessmentId)
      .where('tenant_id', '=', getTenantId())
      .orderBy('sort_order', 'asc')
      .selectAll()
      .execute();
  } catch (_) { return []; }
}

// ═══════════════════════════════════════════════════════════════════
// ITEMS (item pool links)
// ═══════════════════════════════════════════════════════════════════

export async function addAssessmentItem(assessmentId, data) {
  const db = await getDb();
  if (!db) throw new Error('PostgreSQL required');

  const assessment = await getAssessment(assessmentId);
  if (!assessment) throw new Error('Assessment not found');
  if (assessment.status !== 'draft') throw new Error('Published assessments are immutable');

  // Idempotency: same item in same assessment → no duplicate
  if (data.item_id) {
    const existing = await db.selectFrom('assessment_items')
      .where('assessment_id', '=', assessmentId)
      .where('item_id', '=', data.item_id)
      .where('tenant_id', '=', getTenantId())
      .select('id')
      .executeTakeFirst();
    if (existing) return { id: existing.id, alreadyPresent: true };
  }

  const maxOrder = await db.selectFrom('assessment_items')
    .where('assessment_id', '=', assessmentId)
    .where('tenant_id', '=', getTenantId())
    .select(db.fn.max('sort_order').as('max_order'))
    .executeTakeFirst();

  const result = await db.insertInto('assessment_items')
    .values({
      assessment_id: assessmentId,
      section_id: data.section_id || null,
      tenant_id: getTenantId(),
      item_id: data.item_id,
      points: data.points ?? 1,
      time_seconds: data.time_seconds || null,
      sort_order: data.sort_order ?? ((maxOrder?.max_order ?? -1) + 1),
      is_pinned: data.is_pinned || false,
    })
    .returning('id')
    .executeTakeFirst();

  if (result) {
    await audit({
      action: AUDIT_ACTIONS.ASSESSMENT_ITEM_ADD,
      userId: data.added_by,
      resourceType: 'assessment',
      resourceId: assessmentId,
      details: { item_id: data.item_id },
    });
  }
  return result ? { id: result.id } : null;
}

export async function updateAssessmentItem(itemId, data) {
  const db = await getDb();
  if (!db) throw new Error('PostgreSQL required');

  const row = await db.selectFrom('assessment_items')
    .where('id', '=', itemId)
    .where('tenant_id', '=', getTenantId())
    .selectAll()
    .executeTakeFirst();
  if (!row) throw new Error('Assessment item not found');

  const assessment = await getAssessment(row.assessment_id);
  if (assessment && assessment.status !== 'draft') {
    throw new Error('Published assessments are immutable');
  }

  const updates = {};
  for (const f of ['section_id', 'points', 'time_seconds', 'sort_order', 'is_pinned']) {
    if (data[f] !== undefined) updates[f] = data[f];
  }

  await db.updateTable('assessment_items')
    .set(updates)
    .where('id', '=', itemId)
    .where('tenant_id', '=', getTenantId())
    .execute();
  return { ok: true };
}

export async function removeAssessmentItem(itemId) {
  const db = await getDb();
  if (!db) throw new Error('PostgreSQL required');

  const row = await db.selectFrom('assessment_items')
    .where('id', '=', itemId)
    .where('tenant_id', '=', getTenantId())
    .selectAll()
    .executeTakeFirst();
  if (!row) throw new Error('Assessment item not found');

  const assessment = await getAssessment(row.assessment_id);
  if (assessment && assessment.status !== 'draft') {
    throw new Error('Published assessments are immutable');
  }

  await db.deleteFrom('assessment_items')
    .where('id', '=', itemId)
    .where('tenant_id', '=', getTenantId())
    .execute();
  return { ok: true };
}

/** List items with joined public data — NEVER includes item.private_data. */
export async function listItems(assessmentId) {
  const db = await getDb();
  if (!db) return [];
  try {
    return await db.selectFrom('assessment_items as ai')
      .leftJoin('items', 'items.id', 'ai.item_id')
      .where('ai.assessment_id', '=', assessmentId)
      .where('ai.tenant_id', '=', getTenantId())
      .orderBy('ai.sort_order', 'asc')
      .select([
        'ai.id', 'ai.assessment_id', 'ai.section_id', 'ai.item_id',
        'ai.points', 'ai.time_seconds', 'ai.sort_order', 'ai.is_pinned',
        'items.question_type', 'items.difficulty', 'items.cognitive_level',
        'items.public_data', // Public only — private_data excluded
        'items.status as item_status',
      ])
      .execute();
  } catch (_) { return []; }
}

// ═══════════════════════════════════════════════════════════════════
// BLUEPRINT / RANDOMIZATION CONFIG
// ═══════════════════════════════════════════════════════════════════

export async function setBlueprint(id, blueprint, { userId, itemCount } = {}) {
  const db = await getDb();
  if (!db) throw new Error('PostgreSQL required');

  const assessment = await getAssessment(id);
  if (!assessment) throw new Error('Assessment not found');
  if (assessment.status !== 'draft') throw new Error('Published assessments are immutable');

  const result = validateBlueprint(blueprint, {
    expectedTotalItems: itemCount ?? assessment.item_count,
  });
  if (!result.ok) {
    throw new Error(`Invalid blueprint: ${result.errors.join('; ')}`);
  }

  await db.updateTable('assessments')
    .set({ blueprint, updated_at: new Date() })
    .where('id', '=', id)
    .where('tenant_id', '=', getTenantId())
    .execute();

  await audit({
    action: AUDIT_ACTIONS.ASSESSMENT_UPDATE,
    userId,
    resourceType: 'assessment',
    resourceId: id,
    details: { blueprint_set: true },
  });
  return { ok: true };
}

export async function setRandomizationConfig(id, config, { userId } = {}) {
  const db = await getDb();
  if (!db) throw new Error('PostgreSQL required');

  const assessment = await getAssessment(id);
  if (!assessment) throw new Error('Assessment not found');
  if (assessment.status !== 'draft') throw new Error('Published assessments are immutable');

  if (config.seed !== undefined && config.seed !== null && !Number.isInteger(config.seed)) {
    throw new Error('randomization.seed must be an integer');
  }

  await db.updateTable('assessments')
    .set({ randomization_config: config, updated_at: new Date() })
    .where('id', '=', id)
    .where('tenant_id', '=', getTenantId())
    .execute();

  await audit({
    action: AUDIT_ACTIONS.ASSESSMENT_UPDATE,
    userId,
    resourceType: 'assessment',
    resourceId: id,
    details: { randomization_set: true },
  });
  return { ok: true };
}

// ═══════════════════════════════════════════════════════════════════
// PREVIEW
// ═══════════════════════════════════════════════════════════════════

/**
 * Build preview sections (with public items) and render HTML.
 * includePrivateKey is honored ONLY when authorized === true.
 */
export async function renderPreview(id, { includePrivateKey = false, authorized = false } = {}) {
  const db = await getDb();
  if (!db) {
    // Graceful: render a minimal preview from the pure module
    return renderStudentPreview({ title: 'Preview unavailable' }, [], {
      includePrivateKey,
      authorized,
    });
  }

  const assessment = await getAssessment(id);
  if (!assessment) return null;

  const [sections, items] = await Promise.all([listSections(id), listItems(id)]);

  // Group items by section (public only)
  const previewSections = sections.map((s) => ({
    id: s.id,
    title: s.title,
    description: s.description,
    max_points: s.max_points,
    max_time_seconds: s.max_time_seconds,
    items: items.filter((it) => it.section_id === s.id),
  }));

  // Unsectioned items go to a default section
  const unsectioned = items.filter((it) => !it.section_id);
  if (unsectioned.length > 0) {
    previewSections.push({ id: null, title: 'General', items: unsectioned });
  }

  return renderStudentPreview(assessment, previewSections, {
    includePrivateKey,
    authorized,
  });
}
