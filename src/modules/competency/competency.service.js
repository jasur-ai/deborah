/**
 * Edikit — Competency & Curriculum Graph Service
 *
 * Manages versioned competency/outcome frameworks:
 *   - Competency Frameworks (top-level, e.g., "National Curriculum")
 *   - Competency Versions (DRAFT→REVIEW→PUBLISHED lifecycle)
 *   - Competencies (hierarchical outcomes with relations)
 *   - Competency Relations (prerequisite, cross-reference, etc.)
 *   - Course→Competency Mapping (with AI_SUGGESTED status)
 *
 * All operations are tenant-scoped with audit logging.
 * AI-suggested mappings require teacher approval before becoming active.
 *
 * The model follows CASE (Competency and Academic Standards Exchange) patterns
 * for future interoperability.
 */

import { getDb } from '../../infrastructure/postgres.js';
import { getCurrentTenant } from '../auth/tenant-context.js';
import { audit, AUDIT_ACTIONS } from '../auth/audit.js';

// ── Status lifecycle constants ──
export const FRAMEWORK_STATUS = {
  DRAFT: 'draft',
  REVIEW: 'review',
  PUBLISHED: 'published',
  DEPRECATED: 'deprecated',
};

export const MAPPING_STATUS = {
  MANUAL: 'manual',
  AI_SUGGESTED: 'ai_suggested',
  REVIEWED: 'reviewed',
  APPROVED: 'approved',
};

export const COMPETENCY_TYPES = [
  'domain', 'competency', 'sub_competency', 'learning_outcome',
  'skill', 'knowledge', 'attitude',
];

export const RELATION_TYPES = [
  'prerequisite', 'corequisite', 'cross_reference', 'replaces',
  'similar_to', 'extends', 'assesses', 'requires', 'teaches', 'reinforces',
];

export const COGNITIVE_LEVELS = [
  'remember', 'understand', 'apply', 'analyze', 'evaluate', 'create',
];

function getTenantId() {
  return getCurrentTenant()?.tenantId || 1;
}

// ═══════════════════════════════════════════════════════════════════
// FRAMEWORK CRUD
// ═══════════════════════════════════════════════════════════════════

/**
 * Create a new competency framework.
 * Auto-creates the first draft version.
 */
export async function createFramework(data) {
  const db = await getDb();
  if (!db) throw new Error('PostgreSQL required');

  const result = await db.insertInto('competency_frameworks')
    .values({
      tenant_id: getTenantId(),
      name: data.name,
      description: data.description || null,
      source: data.source || 'manual',
      external_id: data.external_id || null,
      subject_area: data.subject_area || null,
      education_level: data.education_level || null,
      language: data.language || 'uz',
      metadata: data.metadata || {},
      created_by: data.created_by || null,
    })
    .returning('id')
    .executeTakeFirst();

  if (result) {
    // Create initial draft version
    const version = await db.insertInto('competency_versions')
      .values({
        framework_id: result.id,
        tenant_id: getTenantId(),
        version: '1.0',
        status: 'draft',
        created_by: data.created_by || null,
      })
      .returning('id')
      .executeTakeFirst();

    if (version) {
      // Set as current version
      await db.updateTable('competency_frameworks')
        .set({ current_version_id: version.id })
        .where('id', '=', result.id)
        .execute();
    }

    await audit({
      action: 'competency:framework:create',
      userId: data.created_by,
      resourceType: 'competency_framework',
      resourceId: result.id,
      details: { name: data.name, subject_area: data.subject_area },
    });
  }

  return result ? { id: result.id } : null;
}

/**
 * Get a framework by ID.
 */
export async function getFramework(id) {
  const db = await getDb();
  if (!db) return null;

  try {
    return await db.selectFrom('competency_frameworks')
      .where('id', '=', id)
      .where('tenant_id', '=', getTenantId())
      .selectAll()
      .executeTakeFirst();
  } catch (_) {
    return null;
  }
}

/**
 * List frameworks with optional filters.
 */
export async function listFrameworks({ subject_area, education_level, is_active, limit = 50, offset = 0 } = {}) {
  const db = await getDb();
  if (!db) return [];

  try {
    let query = db.selectFrom('competency_frameworks')
      .where('tenant_id', '=', getTenantId());

    if (subject_area) query = query.where('subject_area', '=', subject_area);
    if (education_level) query = query.where('education_level', '=', education_level);
    if (is_active !== undefined) query = query.where('is_active', '=', is_active);

    return await query
      .orderBy('name', 'asc')
      .limit(limit)
      .offset(offset)
      .selectAll()
      .execute();
  } catch (_) {
    return [];
  }
}

/**
 * Update a framework.
 */
export async function updateFramework(id, data) {
  const db = await getDb();
  if (!db) throw new Error('PostgreSQL required');

  const existing = await getFramework(id);
  if (!existing) throw new Error('Framework not found');

  const updates = { updated_at: new Date() };
  for (const field of ['name', 'description', 'subject_area', 'education_level', 'language', 'metadata', 'external_id', 'is_active']) {
    if (data[field] !== undefined) updates[field] = data[field];
  }

  await db.updateTable('competency_frameworks')
    .set(updates)
    .where('id', '=', id)
    .where('tenant_id', '=', getTenantId())
    .execute();

  await audit({
    action: 'competency:framework:update',
    userId: data.updated_by,
    resourceType: 'competency_framework',
    resourceId: id,
    details: { changes: Object.keys(updates).filter(k => k !== 'updated_at') },
  });

  return { ok: true };
}

// ═══════════════════════════════════════════════════════════════════
// VERSION LIFECYCLE
// ═══════════════════════════════════════════════════════════════════

/**
 * Create a new version for a framework.
 */
export async function createVersion(frameworkId, data) {
  const db = await getDb();
  if (!db) throw new Error('PostgreSQL required');

  const framework = await getFramework(frameworkId);
  if (!framework) throw new Error('Framework not found');

  const result = await db.insertInto('competency_versions')
    .values({
      framework_id: frameworkId,
      tenant_id: getTenantId(),
      version: data.version,
      status: 'draft',
      changelog: data.changelog || null,
      created_by: data.created_by || null,
    })
    .returning('id')
    .executeTakeFirst();

  return result ? { id: result.id } : null;
}

/**
 * Transition version status: draft → review → published → deprecated
 */
export async function transitionVersion(versionId, newStatus, userId) {
  const db = await getDb();
  if (!db) throw new Error('PostgreSQL required');

  const version = await db.selectFrom('competency_versions')
    .where('id', '=', versionId)
    .where('tenant_id', '=', getTenantId())
    .selectAll()
    .executeTakeFirst();

  if (!version) throw new Error('Version not found');

  // Validate transitions
  const validTransitions = {
    draft: ['review', 'deprecated'],
    review: ['published', 'draft', 'deprecated'],
    published: ['deprecated'],
    deprecated: [],
  };

  if (!validTransitions[version.status]?.includes(newStatus)) {
    throw new Error(`Cannot transition from ${version.status} to ${newStatus}`);
  }

  const updates = { status: newStatus };
  if (newStatus === 'published') {
    updates.published_at = new Date();
    updates.published_by = userId;
  }
  if (newStatus === 'deprecated') {
    updates.deprecated_at = new Date();
  }

  await db.updateTable('competency_versions')
    .set(updates)
    .where('id', '=', versionId)
    .execute();

  // If published, set as framework's current version
  if (newStatus === 'published') {
    await db.updateTable('competency_frameworks')
      .set({ current_version_id: versionId })
      .where('id', '=', version.framework_id)
      .execute();
  }

  await audit({
    action: `competency:version:${newStatus}`,
    userId,
    resourceType: 'competency_version',
    resourceId: versionId,
    details: { framework_id: version.framework_id, previous_status: version.status, new_status: newStatus },
  });

  return { ok: true, newStatus };
}

/**
 * List versions for a framework.
 */
export async function listVersions(frameworkId) {
  const db = await getDb();
  if (!db) return [];

  try {
    return await db.selectFrom('competency_versions')
      .where('framework_id', '=', frameworkId)
      .where('tenant_id', '=', getTenantId())
      .orderBy('created_at', 'desc')
      .selectAll()
      .execute();
  } catch (_) {
    return [];
  }
}

// ═══════════════════════════════════════════════════════════════════
// COMPETENCY CRUD
// ═══════════════════════════════════════════════════════════════════

/**
 * Create a competency within a framework/version.
 */
export async function createCompetency(data) {
  const db = await getDb();
  if (!db) throw new Error('PostgreSQL required');

  // Validate parent exists if specified
  if (data.parent_id) {
    const parent = await getCompetency(data.parent_id);
    if (!parent) throw new Error('Parent competency not found');
  }

  if (!COMPETENCY_TYPES.includes(data.type)) {
    throw new Error(`Invalid competency type: ${data.type}. Must be one of: ${COMPETENCY_TYPES.join(', ')}`);
  }

  const result = await db.insertInto('competencies')
    .values({
      framework_id: data.framework_id,
      version_id: data.version_id,
      tenant_id: getTenantId(),
      parent_id: data.parent_id || null,
      code: data.code || null,
      human_coding_scheme: data.human_coding_scheme || null,
      name: data.name,
      description: data.description || null,
      type: data.type || 'competency',
      cognitive_level: data.cognitive_level || null,
      difficulty: data.difficulty || null,
      keywords: data.keywords || [],
      translations: data.translations || {},
      alias: data.alias || [],
      terminology: data.terminology || {},
      sort_order: data.sort_order || 0,
      external_id: data.external_id || null,
      metadata: data.metadata || {},
      created_by: data.created_by || null,
    })
    .returning('id')
    .executeTakeFirst();

  if (result) {
    await audit({
      action: 'competency:create',
      userId: data.created_by,
      resourceType: 'competency',
      resourceId: result.id,
      details: { framework_id: data.framework_id, code: data.code, type: data.type },
    });
  }

  return result ? { id: result.id } : null;
}

/**
 * Get a competency by ID.
 */
export async function getCompetency(id) {
  const db = await getDb();
  if (!db) return null;

  try {
    return await db.selectFrom('competencies')
      .where('id', '=', id)
      .where('tenant_id', '=', getTenantId())
      .selectAll()
      .executeTakeFirst();
  } catch (_) {
    return null;
  }
}

/**
 * List competencies with filters.
 */
export async function listCompetencies({ framework_id, version_id, parent_id, type, cognitive_level, limit = 100, offset = 0 } = {}) {
  const db = await getDb();
  if (!db) return [];

  try {
    let query = db.selectFrom('competencies')
      .where('competencies.tenant_id', '=', getTenantId());

    if (framework_id) query = query.where('competencies.framework_id', '=', framework_id);
    if (version_id) query = query.where('competencies.version_id', '=', version_id);
    if (parent_id !== undefined) query = query.where('competencies.parent_id', '=', parent_id);
    if (type) query = query.where('competencies.type', '=', type);
    if (cognitive_level) query = query.where('competencies.cognitive_level', '=', cognitive_level);

    return await query
      .orderBy('competencies.sort_order', 'asc')
      .limit(limit)
      .offset(offset)
      .selectAll()
      .execute();
  } catch (_) {
    return [];
  }
}

/**
 * Update a competency.
 */
export async function updateCompetency(id, data) {
  const db = await getDb();
  if (!db) throw new Error('PostgreSQL required');

  const existing = await getCompetency(id);
  if (!existing) throw new Error('Competency not found');

  const updates = { updated_at: new Date() };
  for (const field of ['name', 'description', 'code', 'human_coding_scheme', 'type', 'cognitive_level', 'difficulty', 'keywords', 'translations', 'alias', 'terminology', 'sort_order', 'parent_id', 'external_id', 'metadata', 'is_active']) {
    if (data[field] !== undefined) updates[field] = data[field];
  }

  // If changing type, validate
  if (updates.type && !COMPETENCY_TYPES.includes(updates.type)) {
    throw new Error(`Invalid competency type: ${updates.type}`);
  }

  await db.updateTable('competencies')
    .set(updates)
    .where('id', '=', id)
    .where('tenant_id', '=', getTenantId())
    .execute();

  await audit({
    action: 'competency:update',
    userId: data.updated_by,
    resourceType: 'competency',
    resourceId: id,
    details: { changes: Object.keys(updates).filter(k => k !== 'updated_at') },
  });

  return { ok: true };
}

/**
 * Delete a competency (soft-deactivate).
 */
export async function deleteCompetency(id, userId) {
  const db = await getDb();
  if (!db) throw new Error('PostgreSQL required');

  const existing = await getCompetency(id);
  if (!existing) throw new Error('Competency not found');

  await db.updateTable('competencies')
    .set({ is_active: false, updated_at: new Date() })
    .where('id', '=', id)
    .where('tenant_id', '=', getTenantId())
    .execute();

  await audit({
    action: 'competency:delete',
    userId,
    resourceType: 'competency',
    resourceId: id,
    details: { code: existing.code, name: existing.name },
  });

  return { ok: true };
}

// ═══════════════════════════════════════════════════════════════════
// COMPETENCY RELATIONS
// ═══════════════════════════════════════════════════════════════════

/**
 * Create a relation between two competencies.
 */
export async function createRelation(data) {
  const db = await getDb();
  if (!db) throw new Error('PostgreSQL required');

  // Prevent self-reference
  if (data.source_competency_id === data.target_competency_id) {
    throw new Error('Cannot create a relation from a competency to itself');
  }

  if (!RELATION_TYPES.includes(data.relation_type)) {
    throw new Error(`Invalid relation type: ${data.relation_type}`);
  }

  // Prevent cycles for prerequisite relations
  if (data.relation_type === 'prerequisite') {
    const hasCycle = await detectCycle(data.source_competency_id, data.target_competency_id);
    if (hasCycle) {
      throw new Error('This relation would create a circular dependency');
    }
  }

  const result = await db.insertInto('competency_relations')
    .values({
      tenant_id: getTenantId(),
      source_competency_id: data.source_competency_id,
      target_competency_id: data.target_competency_id,
      relation_type: data.relation_type,
      strength: data.strength || null,
      metadata: data.metadata || {},
      created_by: data.created_by || null,
    })
    .returning('id')
    .executeTakeFirst();

  if (result) {
    await audit({
      action: 'competency:relation:create',
      userId: data.created_by,
      resourceType: 'competency_relation',
      resourceId: result.id,
      details: { source: data.source_competency_id, target: data.target_competency_id, type: data.relation_type },
    });
  }

  return result ? { id: result.id } : null;
}

/**
 * Detect cycles in the competency graph (BFS).
 */
async function detectCycle(sourceId, targetId) {
  const db = await getDb();
  if (!db) return false;

  try {
    // BFS from targetId following prerequisite relations
    const visited = new Set();
    const queue = [targetId];

    while (queue.length > 0) {
      const current = queue.shift();
      if (current === sourceId) return true; // Cycle found

      if (visited.has(current)) continue;
      visited.add(current);

      // Find all prerequisites of current
      const relations = await db.selectFrom('competency_relations')
        .where('source_competency_id', '=', current)
        .where('relation_type', '=', 'prerequisite')
        .select('target_competency_id')
        .execute();

      for (const rel of relations) {
        if (!visited.has(rel.target_competency_id)) {
          queue.push(rel.target_competency_id);
        }
      }
    }

    return false;
  } catch (_) {
    return false; // Fail open on error
  }
}

/**
 * List relations for a competency.
 */
export async function listRelations(competencyId) {
  const db = await getDb();
  if (!db) return [];

  try {
    const outgoing = await db.selectFrom('competency_relations')
      .where('source_competency_id', '=', competencyId)
      .where('tenant_id', '=', getTenantId())
      .selectAll()
      .execute();

    const incoming = await db.selectFrom('competency_relations')
      .where('target_competency_id', '=', competencyId)
      .where('tenant_id', '=', getTenantId())
      .selectAll()
      .execute();

    return { outgoing, incoming };
  } catch (_) {
    return { outgoing: [], incoming: [] };
  }
}

/**
 * Delete a relation.
 */
export async function deleteRelation(id, userId) {
  const db = await getDb();
  if (!db) throw new Error('PostgreSQL required');

  const existing = await db.selectFrom('competency_relations')
    .where('id', '=', id)
    .where('tenant_id', '=', getTenantId())
    .selectAll()
    .executeTakeFirst();

  if (!existing) throw new Error('Relation not found');

  await db.deleteFrom('competency_relations')
    .where('id', '=', id)
    .where('tenant_id', '=', getTenantId())
    .execute();

  await audit({
    action: 'competency:relation:delete',
    userId,
    resourceType: 'competency_relation',
    resourceId: id,
    details: { source: existing.source_competency_id, target: existing.target_competency_id },
  });

  return { ok: true };
}

// ═══════════════════════════════════════════════════════════════════
// COURSE→COMPETENCY MAPPING
// ═══════════════════════════════════════════════════════════════════

/**
 * Map a competency to a course offering.
 */
export async function mapCompetencyToCourse(data) {
  const db = await getDb();
  if (!db) throw new Error('PostgreSQL required');

  const result = await db.insertInto('course_competencies')
    .values({
      tenant_id: getTenantId(),
      course_offering_id: data.course_offering_id,
      competency_id: data.competency_id,
      mapping_status: data.mapping_status || 'manual',
      coverage_weight: data.coverage_weight || 0,
      assessment_count: data.assessment_count || 0,
      mapped_by: data.mapped_by || null,
      ai_suggested_at: data.mapping_status === 'ai_suggested' ? new Date() : null,
      ai_confidence: data.ai_confidence || null,
      notes: data.notes || null,
    })
    .returning('id')
    .executeTakeFirst();

  if (result) {
    await audit({
      action: 'competency:map:create',
      userId: data.mapped_by,
      resourceType: 'course_competency',
      resourceId: result.id,
      details: { course_offering_id: data.course_offering_id, competency_id: data.competency_id, status: data.mapping_status },
    });
  }

  return result ? { id: result.id } : null;
}

/**
 * Approve or update a course→competency mapping status.
 * AI_SUGGESTED mappings must be approved by a teacher before becoming active.
 */
export async function approveMapping(id, newStatus, userId) {
  const db = await getDb();
  if (!db) throw new Error('PostgreSQL required');

  const validTransitions = {
    ai_suggested: ['reviewed', 'approved'],
    manual: ['approved'],
    reviewed: ['approved'],
    approved: ['reviewed'],
  };

  const existing = await db.selectFrom('course_competencies')
    .where('id', '=', id)
    .where('tenant_id', '=', getTenantId())
    .selectAll()
    .executeTakeFirst();

  if (!existing) throw new Error('Mapping not found');

  if (!validTransitions[existing.mapping_status]?.includes(newStatus)) {
    throw new Error(`Cannot transition mapping from ${existing.mapping_status} to ${newStatus}`);
  }

  const updates = {
    mapping_status: newStatus,
    reviewed_at: new Date(),
    reviewed_by: userId,
    updated_at: new Date(),
  };

  if (newStatus === 'approved') {
    updates.assessment_count = db.sql`COALESCE(assessment_count, 0) + 1`;
  }

  await db.updateTable('course_competencies')
    .set(updates)
    .where('id', '=', id)
    .where('tenant_id', '=', getTenantId())
    .execute();

  await audit({
    action: 'competency:map:approve',
    userId,
    resourceType: 'course_competency',
    resourceId: id,
    details: { previous_status: existing.mapping_status, new_status: newStatus },
  });

  return { ok: true };
}

/**
 * List course→competency mappings.
 */
export async function listCourseMappings({ course_offering_id, competency_id, mapping_status, limit = 50, offset = 0 } = {}) {
  const db = await getDb();
  if (!db) return [];

  try {
    let query = db.selectFrom('course_competencies')
      .leftJoin('competencies', 'competencies.id', 'course_competencies.competency_id')
      .leftJoin('course_offerings', 'course_offerings.id', 'course_competencies.course_offering_id')
      .where('course_competencies.tenant_id', '=', getTenantId());

    if (course_offering_id) query = query.where('course_competencies.course_offering_id', '=', course_offering_id);
    if (competency_id) query = query.where('course_competencies.competency_id', '=', competency_id);
    if (mapping_status) query = query.where('course_competencies.mapping_status', '=', mapping_status);

    return await query
      .select([
        'course_competencies.id',
        'course_competencies.course_offering_id',
        'course_competencies.competency_id',
        'course_competencies.mapping_status',
        'course_competencies.coverage_weight',
        'course_competencies.assessment_count',
        'course_competencies.ai_confidence',
        'course_competencies.reviewed_at',
        'course_competencies.notes',
        'competencies.name as competency_name',
        'competencies.code as competency_code',
        'competencies.type as competency_type',
        'course_offerings.name as course_name',
        'course_offerings.code as course_code',
      ])
      .orderBy('course_competencies.updated_at', 'desc')
      .limit(limit)
      .offset(offset)
      .execute();
  } catch (_) {
    return [];
  }
}

// ═══════════════════════════════════════════════════════════════════
// IMPACT / ORPHAN / COVERAGE QUERIES
// ═══════════════════════════════════════════════════════════════════

/**
 * Get impact analysis for a competency — which courses use it and how.
 */
export async function getCompetencyImpact(competencyId) {
  const db = await getDb();
  if (!db) return null;

  try {
    const mappings = await db.selectFrom('course_competencies')
      .leftJoin('course_offerings', 'course_offerings.id', 'course_competencies.course_offering_id')
      .where('course_competencies.competency_id', '=', competencyId)
      .where('course_competencies.tenant_id', '=', getTenantId())
      .select([
        'course_competencies.mapping_status',
        'course_competencies.coverage_weight',
        'course_competencies.assessment_count',
        'course_competencies.ai_confidence',
        'course_offerings.name as course_name',
        'course_offerings.code as course_code',
      ])
      .execute();

    return {
      competency_id: competencyId,
      total_courses: mappings.length,
      approved_courses: mappings.filter(m => m.mapping_status === 'approved').length,
      ai_suggested: mappings.filter(m => m.mapping_status === 'ai_suggested').length,
      total_assessment_count: mappings.reduce((s, m) => s + (m.assessment_count || 0), 0),
      average_coverage: mappings.length > 0
        ? Math.round(mappings.reduce((s, m) => s + (m.coverage_weight || 0), 0) / mappings.length * 100) / 100
        : 0,
      courses: mappings,
    };
  } catch (_) {
    return null;
  }
}

/**
 * Find orphan competencies — those not mapped to any course.
 */
export async function findOrphanCompetencies(frameworkId) {
  const db = await getDb();
  if (!db) return [];

  try {
    return await db.selectFrom('competencies')
      .leftJoin('course_competencies', (join) =>
        join.onRef('course_competencies.competency_id', '=', 'competencies.id')
          .on('course_competencies.tenant_id', '=', getTenantId())
      )
      .where('competencies.framework_id', '=', frameworkId)
      .where('competencies.tenant_id', '=', getTenantId())
      .where('competencies.is_active', '=', true)
      .where('course_competencies.id', 'is', null)
      .select([
        'competencies.id',
        'competencies.code',
        'competencies.name',
        'competencies.type',
        'competencies.cognitive_level',
      ])
      .execute();
  } catch (_) {
    return [];
  }
}

/**
 * Get coverage report for a course — which competencies it covers.
 */
export async function getCourseCoverage(courseOfferingId) {
  const db = await getDb();
  if (!db) return null;

  try {
    const mappings = await db.selectFrom('course_competencies')
      .leftJoin('competencies', 'competencies.id', 'course_competencies.competency_id')
      .where('course_competencies.course_offering_id', '=', courseOfferingId)
      .where('course_competencies.tenant_id', '=', getTenantId())
      .select([
        'course_competencies.mapping_status',
        'course_competencies.coverage_weight',
        'course_competencies.assessment_count',
        'course_competencies.ai_confidence',
        'competencies.id as comp_id',
        'competencies.code as comp_code',
        'competencies.name as comp_name',
        'competencies.type as comp_type',
        'competencies.cognitive_level',
      ])
      .execute();

    return {
      course_offering_id: courseOfferingId,
      total_mappings: mappings.length,
      approved: mappings.filter(m => m.mapping_status === 'approved').length,
      ai_suggested: mappings.filter(m => m.mapping_status === 'ai_suggested').length,
      by_cognitive_level: mappings.reduce((acc, m) => {
        const level = m.cognitive_level || 'unspecified';
        acc[level] = (acc[level] || 0) + 1;
        return acc;
      }, {}),
      competencies: mappings,
    };
  } catch (_) {
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════════
// CASE IMPORT/EXPORT ADAPTER (SKELETON)
// ═══════════════════════════════════════════════════════════════════

/**
 * Import competencies from CASE JSON format.
 * CASE: Competency and Academic Standards Exchange (1EdTech)
 *
 * This is a skeleton — full import logic will be built in a later prompt.
 * For now, it validates the structure and returns a preview.
 */
export async function importCaseFormat(jsonData, frameworkId, userId) {
  if (!jsonData || !jsonData.competencies) {
    throw new Error('Invalid CASE format: missing "competencies" array');
  }

  // Basic validation
  const validation = {
    total: jsonData.competencies.length,
    valid: 0,
    invalid: 0,
    errors: [],
    preview: [],
  };

  for (const item of jsonData.competencies) {
    if (!item.name || !item.identifier) {
      validation.invalid++;
      validation.errors.push(`Missing name or identifier in competency item`);
      continue;
    }

    validation.valid++;
    validation.preview.push({
      code: item.jurisdiction_identifier || item.identifier,
      name: item.name,
      type: item.competency_category || 'competency',
      description: item.description || '',
      external_id: item.identifier,
    });
  }

  return validation;
}

/**
 * Export competencies in CASE-compatible JSON format.
 */
export async function exportCaseFormat(frameworkId) {
  const competencies = await listCompetencies({ framework_id: frameworkId });
  if (!competencies || competencies.length === 0) return null;

  return {
    '@context': 'https://purl.imsglobal.org/spec/case/v1p0/context.json',
    type: 'CompetencyFramework',
    identifier: frameworkId,
    title: (await getFramework(frameworkId))?.name || 'Edikit Framework',
    competencies: competencies.map(c => ({
      identifier: c.external_id || `edikit:${c.id}`,
      competency_category: c.type,
      jurisdiction_identifier: c.human_coding_scheme || c.code,
      name: c.name,
      description: c.description,
      competency_level: c.cognitive_level,
      status: c.is_active ? 'Active' : 'Inactive',
    })),
  };
}
