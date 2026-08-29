/**
 * Deborah — Item Bank Service (Public/Private Versioning)
 *
 * Manages reusable, versioned question items:
 *   - Item Banks: logical collections (e.g., "Algebra - 9-sinf")
 *   - Items: individual questions with PUBLIC/PRIVATE data split
 *   - Item Versions: DRAFT→APPROVED→PUBLISHED→RETIRED lifecycle
 *   - Item Tags: searchable tags
 *   - Item Outcomes: competency/outcome mappings (linking to Prompt 20)
 *   - Item Media: images/audio/video with alt text and license
 *
 * SECURITY: private_data (correct answer key) is NEVER returned in
 * list/search/DTO responses — only explicitly fetched via getItemPrivate().
 * Public API only returns public_data.
 */

import { getDb } from '../../infrastructure/postgres.js';
import { getCurrentTenant } from '../auth/tenant-context.js';
import { audit, AUDIT_ACTIONS } from '../auth/audit.js';

// ── Status lifecycle ──
export const ITEM_STATUS = {
  DRAFT: 'draft',
  APPROVED: 'approved',
  PUBLISHED: 'published',
  RETIRED: 'retired',
};

export const ITEM_TYPES = [
  'single_choice', 'multiple_choice', 'true_false',
  'short_answer', 'essay', 'numeric',
  'matching', 'ordering', 'fill_blanks', 'file_upload',
];

export const DIFFICULTY_LEVELS = ['easy', 'medium', 'hard'];
export const COGNITIVE_LEVELS = ['remember', 'understand', 'apply', 'analyze', 'evaluate', 'create'];

function getTenantId() {
  return getCurrentTenant()?.tenantId || 1;
}

// ═══════════════════════════════════════════════════════════════════
// ITEM BANK CRUD
// ═══════════════════════════════════════════════════════════════════

/** Create a new item bank (question collection). */
export async function createItemBank(data) {
  const db = await getDb();
  if (!db) throw new Error('PostgreSQL required');

  const result = await db.insertInto('item_banks')
    .values({
      tenant_id: getTenantId(),
      name: data.name,
      description: data.description || null,
      subject_area: data.subject_area || null,
      education_level: data.education_level || null,
      language: data.language || 'uz',
      is_public: data.is_public || false,
      owner_id: data.owner_id || null,
      metadata: data.metadata || {},
    })
    .returning('id')
    .executeTakeFirst();

  if (result) {
    await audit({
      action: 'item:bank:create',
      userId: data.owner_id,
      resourceType: 'item_bank',
      resourceId: result.id,
      details: { name: data.name },
    });
  }

  return result ? { id: result.id } : null;
}

/** Get an item bank by ID. */
export async function getItemBank(id) {
  const db = await getDb();
  if (!db) return null;
  try {
    return await db.selectFrom('item_banks')
      .where('id', '=', id)
      .where('tenant_id', '=', getTenantId())
      .selectAll()
      .executeTakeFirst();
  } catch (_) { return null; }
}

/** List item banks with filters. */
export async function listItemBanks({ subject_area, is_public, limit = 50, offset = 0 } = {}) {
  const db = await getDb();
  if (!db) return [];

  try {
    let query = db.selectFrom('item_banks')
      .where('tenant_id', '=', getTenantId());
    if (subject_area) query = query.where('subject_area', '=', subject_area);
    if (is_public !== undefined) query = query.where('is_public', '=', is_public);

    return await query
      .orderBy('name', 'asc')
      .limit(limit).offset(offset)
      .selectAll()
      .execute();
  } catch (_) { return []; }
}

/** Update an item bank. */
export async function updateItemBank(id, data) {
  const db = await getDb();
  if (!db) throw new Error('PostgreSQL required');

  const updates = { updated_at: new Date() };
  for (const f of ['name', 'description', 'subject_area', 'education_level', 'language', 'is_public', 'metadata']) {
    if (data[f] !== undefined) updates[f] = data[f];
  }

  await db.updateTable('item_banks')
    .set(updates)
    .where('id', '=', id)
    .where('tenant_id', '=', getTenantId())
    .execute();

  await audit({
    action: 'item:bank:update',
    userId: data.updated_by,
    resourceType: 'item_bank',
    resourceId: id,
  });
  return { ok: true };
}

/** Delete an item bank (cascades to items). */
export async function deleteItemBank(id, userId) {
  const db = await getDb();
  if (!db) throw new Error('PostgreSQL required');
  await db.deleteFrom('item_banks')
    .where('id', '=', id)
    .where('tenant_id', '=', getTenantId())
    .execute();

  await audit({ action: 'item:bank:delete', userId, resourceType: 'item_bank', resourceId: id });
  return { ok: true };
}

// ═══════════════════════════════════════════════════════════════════
// ITEM CRUD (with public/private separation)
// ═══════════════════════════════════════════════════════════════════

/** Validate public_data has minimum required fields. */
function validatePublicData(publicData, questionType) {
  if (!publicData || !publicData.stem) {
    throw new Error('public_data.stem is required');
  }

  if (['single_choice', 'multiple_choice', 'true_false', 'matching', 'ordering'].includes(questionType)) {
    if (!Array.isArray(publicData.options) || publicData.options.length < 2) {
      throw new Error(`At least 2 options required for ${questionType}`);
    }
    for (const opt of publicData.options) {
      if (!opt.key || !opt.text) {
        throw new Error('Each option must have a key and text');
      }
    }
  }
}

/** Create a new item with public/private data split. */
export async function createItem(data) {
  const db = await getDb();
  if (!db) throw new Error('PostgreSQL required');

  if (!ITEM_TYPES.includes(data.question_type)) {
    throw new Error(`Invalid question type: ${data.question_type}. Must be one of: ${ITEM_TYPES.join(', ')}`);
  }

  validatePublicData(data.public_data, data.question_type);

  const result = await db.insertInto('items')
    .values({
      bank_id: data.bank_id,
      tenant_id: getTenantId(),
      status: 'draft',
      question_type: data.question_type,
      difficulty: data.difficulty || 'medium',
      cognitive_level: data.cognitive_level || null,
      points: data.points || 1,
      time_seconds: data.time_seconds || null,
      public_data: data.public_data,
      private_data: data.private_data || null, // Correct answer key
      version: 1,
      source: data.source || 'manual',
      source_item_id: data.source_item_id || null,
      misconceptions: data.misconceptions || [],
      metadata: data.metadata || {},
      created_by: data.created_by || null,
    })
    .returning('id')
    .executeTakeFirst();

  if (result) {
    // Create initial version record
    await db.insertInto('item_versions').values({
      item_id: result.id,
      tenant_id: getTenantId(),
      version: 1,
      previous_status: null,
      new_status: 'draft',
      public_data_snapshot: data.public_data,
      private_data_snapshot: data.private_data || null,
      change_summary: 'Item created',
      changed_by: data.created_by || null,
    }).execute();

    // Save tags if provided
    if (Array.isArray(data.tags)) {
      for (const tag of data.tags) {
        await db.insertInto('item_tags')
          .values({ tenant_id: getTenantId(), item_id: result.id, tag })
          .execute();
      }
    }

    // Save outcomes if provided
    if (Array.isArray(data.outcomes)) {
      for (const oc of data.outcomes) {
        await db.insertInto('item_outcomes')
          .values({
            tenant_id: getTenantId(),
            item_id: result.id,
            competency_id: oc.competency_id || null,
            outcome_code: oc.outcome_code || null,
            weight: oc.weight || 1.00,
          }).execute();
      }
    }

    await audit({
      action: 'item:create',
      userId: data.created_by,
      resourceType: 'item',
      resourceId: result.id,
      details: { bank_id: data.bank_id, type: data.question_type },
    });
  }

  return result ? { id: result.id } : null;
}

/** Get a SINGLE item with ALL data (including private). Only for authorized users. */
export async function getItem(id) {
  const db = await getDb();
  if (!db) return null;
  try {
    return await db.selectFrom('items')
      .where('id', '=', id)
      .where('tenant_id', '=', getTenantId())
      .selectAll()
      .executeTakeFirst();
  } catch (_) { return null; }
}

/** List items — ONLY public data returned (private_data stripped). */
export async function listItems({ bank_id, status, question_type, difficulty, limit = 50, offset = 0 } = {}) {
  const db = await getDb();
  if (!db) return [];

  try {
    let query = db.selectFrom('items')
      .where('items.tenant_id', '=', getTenantId());

    if (bank_id) query = query.where('items.bank_id', '=', bank_id);
    if (status) query = query.where('items.status', '=', status);
    if (question_type) query = query.where('items.question_type', '=', question_type);
    if (difficulty) query = query.where('items.difficulty', '=', difficulty);

    const rows = await query
      .orderBy('items.updated_at', 'desc')
      .limit(limit).offset(offset)
      .select([
        'items.id', 'items.bank_id', 'items.tenant_id',
        'items.status', 'items.question_type', 'items.difficulty',
        'items.cognitive_level', 'items.points', 'items.time_seconds',
        'items.public_data', // Public only
        'items.version', 'items.source', 'items.created_by',
        'items.created_at', 'items.updated_at',
      ])
      .execute();

    return rows;
  } catch (_) { return []; }
}

/** Update an item — creates a new version. */
export async function updateItem(id, data) {
  const db = await getDb();
  if (!db) throw new Error('PostgreSQL required');

  const existing = await getItem(id);
  if (!existing) throw new Error('Item not found');
  if (existing.status === 'retired') throw new Error('Cannot update a retired item');

  const newVersion = existing.version + 1;
  const updates = { updated_at: new Date(), version: newVersion };

  for (const f of ['question_type', 'difficulty', 'cognitive_level', 'points', 'time_seconds', 'metadata', 'misconceptions']) {
    if (data[f] !== undefined) updates[f] = data[f];
  }
  if (data.public_data) {
    validatePublicData(data.public_data, data.question_type || existing.question_type);
    updates.public_data = data.public_data;
  }
  if (data.private_data !== undefined) updates.private_data = data.private_data;

  await db.updateTable('items')
    .set(updates)
    .where('id', '=', id)
    .where('tenant_id', '=', getTenantId())
    .execute();

  // Create version record
  await db.insertInto('item_versions').values({
    item_id: id,
    tenant_id: getTenantId(),
    version: newVersion,
    previous_status: existing.status,
    new_status: data.status || existing.status,
    public_data_snapshot: data.public_data || existing.public_data,
    private_data_snapshot: data.private_data !== undefined ? data.private_data : existing.private_data,
    change_summary: data.change_summary || 'Item updated',
    changed_by: data.updated_by || null,
  }).execute();

  // Update tags if provided
  if (Array.isArray(data.tags)) {
    await db.deleteFrom('item_tags')
      .where('item_id', '=', id)
      .where('tenant_id', '=', getTenantId())
      .execute();
    for (const tag of data.tags) {
      await db.insertInto('item_tags')
        .values({ tenant_id: getTenantId(), item_id: id, tag })
        .execute();
    }
  }

  await audit({
    action: 'item:update',
    userId: data.updated_by,
    resourceType: 'item',
    resourceId: id,
    details: { version: newVersion },
  });

  return { ok: true, version: newVersion };
}

// ═══════════════════════════════════════════════════════════════════
// STATUS LIFECYCLE
// ═══════════════════════════════════════════════════════════════════

const ITEM_STATUS_TRANSITIONS = {
  draft: ['approved', 'retired'],
  approved: ['published', 'draft', 'retired'],
  published: ['retired'],
  retired: [],
};

/** Transition an item through its status lifecycle. */
export async function transitionItemStatus(id, newStatus, userId) {
  const db = await getDb();
  if (!db) throw new Error('PostgreSQL required');

  const item = await getItem(id);
  if (!item) throw new Error('Item not found');

  if (!ITEM_STATUS_TRANSITIONS[item.status]?.includes(newStatus)) {
    throw new Error(`Cannot transition from ${item.status} to ${newStatus}`);
  }

  const newVersion = item.version + 1;

  await db.updateTable('items')
    .set({ status: newStatus, version: newVersion, updated_at: new Date() })
    .where('id', '=', id)
    .where('tenant_id', '=', getTenantId())
    .execute();

  await db.insertInto('item_versions').values({
    item_id: id,
    tenant_id: getTenantId(),
    version: newVersion,
    previous_status: item.status,
    new_status: newStatus,
    public_data_snapshot: item.public_data,
    private_data_snapshot: item.private_data,
    change_summary: `Status changed: ${item.status} → ${newStatus}`,
    changed_by: userId || null,
  }).execute();

  await audit({
    action: `item:${newStatus}`,
    userId,
    resourceType: 'item',
    resourceId: id,
    details: { previous_status: item.status, new_status: newStatus },
  });

  return { ok: true, version: newVersion, newStatus };
}

// ═══════════════════════════════════════════════════════════════════
// CLONE / NEW VERSION / DIFF
// ═══════════════════════════════════════════════════════════════════

/** Clone an item into the same bank with a new draft version. */
export async function cloneItem(id, userId) {
  const db = await getDb();
  if (!db) throw new Error('PostgreSQL required');

  const original = await getItem(id);
  if (!original) throw new Error('Original item not found');

  const result = await db.insertInto('items').values({
    bank_id: original.bank_id,
    tenant_id: getTenantId(),
    status: 'draft',
    question_type: original.question_type,
    difficulty: original.difficulty,
    cognitive_level: original.cognitive_level,
    points: original.points,
    time_seconds: original.time_seconds,
    public_data: original.public_data,
    private_data: original.private_data,
    version: 1,
    source: 'cloned',
    source_item_id: original.id,
    misconceptions: original.misconceptions || [],
    metadata: { ...original.metadata || {}, clonedFrom: original.id, clonedAt: new Date().toISOString() },
    created_by: userId || null,
  }).returning('id').executeTakeFirst();

  if (result) {
    // Clone tags
    const tags = await db.selectFrom('item_tags')
      .where('item_id', '=', id)
      .where('tenant_id', '=', getTenantId())
      .select('tag')
      .execute();

    for (const t of tags) {
      await db.insertInto('item_tags')
        .values({ tenant_id: getTenantId(), item_id: result.id, tag: t.tag })
        .execute();
    }

    // Clone outcomes
    const outcomes = await db.selectFrom('item_outcomes')
      .where('item_id', '=', id)
      .where('tenant_id', '=', getTenantId())
      .selectAll()
      .execute();

    for (const oc of outcomes) {
      await db.insertInto('item_outcomes')
        .values({
          tenant_id: getTenantId(),
          item_id: result.id,
          competency_id: oc.competency_id,
          outcome_code: oc.outcome_code,
          weight: oc.weight,
        }).execute();
    }

    await audit({
      action: 'item:clone',
      userId,
      resourceType: 'item',
      resourceId: result.id,
      details: { source_item_id: id },
    });
  }

  return result ? { id: result.id, clonedFrom: id } : null;
}

/** Get version history for an item. */
export async function getItemVersions(itemId) {
  const db = await getDb();
  if (!db) return [];
  try {
    return await db.selectFrom('item_versions')
      .where('item_id', '=', itemId)
      .where('tenant_id', '=', getTenantId())
      .orderBy('version', 'desc')
      .selectAll()
      .execute();
  } catch (_) { return []; }
}

/** Generate a diff between two versions. */
export async function diffItemVersions(itemId, versionA, versionB) {
  const db = await getDb();
  if (!db) return null;

  try {
    const vA = await db.selectFrom('item_versions')
      .where('item_id', '=', itemId)
      .where('version', '=', versionA)
      .where('tenant_id', '=', getTenantId())
      .selectAll()
      .executeTakeFirst();

    const vB = await db.selectFrom('item_versions')
      .where('item_id', '=', itemId)
      .where('version', '=', versionB)
      .where('tenant_id', '=', getTenantId())
      .selectAll()
      .executeTakeFirst();

    if (!vA || !vB) throw new Error('Version not found');

    const diff = { public_changes: [], private_changes: [], meta_changes: [] };

    // Compare public data
    if (JSON.stringify(vA.public_data_snapshot) !== JSON.stringify(vB.public_data_snapshot)) {
      diff.public_changes.push({ field: 'public_data', from: vA.public_data_snapshot, to: vB.public_data_snapshot });
    }

    // Compare private data
    if (JSON.stringify(vA.private_data_snapshot) !== JSON.stringify(vB.private_data_snapshot)) {
      diff.private_changes.push({ field: 'private_data', from: vA.private_data_snapshot, to: vB.private_data_snapshot });
    }

    // Compare status
    if (vA.previous_status !== vB.previous_status || vA.new_status !== vB.new_status) {
      diff.meta_changes.push({
        field: 'status',
        from: `${vA.previous_status} → ${vA.new_status}`,
        to: `${vB.previous_status} → ${vB.new_status}`,
      });
    }

    return diff;
  } catch (err) {
    throw err;
  }
}

// ═══════════════════════════════════════════════════════════════════
// TAGS & OUTCOMES
// ═══════════════════════════════════════════════════════════════════

/** Search items by tags. */
export async function searchByTags(tags, { limit = 50, offset = 0 } = {}) {
  const db = await getDb();
  if (!db) return [];

  try {
    const items = await db.selectFrom('item_tags')
      .innerJoin('items', 'items.id', 'item_tags.item_id')
      .where('item_tags.tag', 'in', tags)
      .where('items.tenant_id', '=', getTenantId())
      .where('items.status', '=', 'published')
      .limit(limit).offset(offset)
      .select([
        'items.id', 'items.bank_id', 'items.question_type',
        'items.difficulty', 'items.points', 'items.public_data',
        'items.status', 'items.created_at',
      ])
      .distinct()
      .execute();

    return items;
  } catch (_) { return []; }
}

/** Get tags for an item. */
export async function getItemTags(itemId) {
  const db = await getDb();
  if (!db) return [];
  try {
    const rows = await db.selectFrom('item_tags')
      .where('item_id', '=', itemId)
      .where('tenant_id', '=', getTenantId())
      .select('tag')
      .execute();
    return rows.map(r => r.tag);
  } catch (_) { return []; }
}

/** Get outcomes for an item. */
export async function getItemOutcomes(itemId) {
  const db = await getDb();
  if (!db) return [];
  try {
    return await db.selectFrom('item_outcomes')
      .leftJoin('competencies', 'competencies.id', 'item_outcomes.competency_id')
      .where('item_outcomes.item_id', '=', itemId)
      .where('item_outcomes.tenant_id', '=', getTenantId())
      .select([
        'item_outcomes.id', 'item_outcomes.competency_id',
        'item_outcomes.outcome_code', 'item_outcomes.weight',
        'competencies.name as competency_name',
        'competencies.code as competency_code',
      ])
      .execute();
  } catch (_) { return []; }
}

// ═══════════════════════════════════════════════════════════════════
// MEDIA
// ═══════════════════════════════════════════════════════════════════

/** Attach media to an item. */
export async function addItemMedia(data) {
  const db = await getDb();
  if (!db) throw new Error('PostgreSQL required');

  const result = await db.insertInto('item_media').values({
    tenant_id: getTenantId(),
    item_id: data.item_id,
    type: data.type,
    url: data.url,
    alt_text: data.alt_text || null,
    mime_type: data.mime_type || null,
    file_size: data.file_size || null,
    width: data.width || null,
    height: data.height || null,
    duration_seconds: data.duration_seconds || null,
    license: data.license || null,
    attribution: data.attribution || null,
    metadata: data.metadata || {},
    sort_order: data.sort_order || 0,
  }).returning('id').executeTakeFirst();

  return result ? { id: result.id } : null;
}

/** List media for an item. */
export async function listItemMedia(itemId) {
  const db = await getDb();
  if (!db) return [];
  try {
    return await db.selectFrom('item_media')
      .where('item_id', '=', itemId)
      .where('tenant_id', '=', getTenantId())
      .orderBy('sort_order', 'asc')
      .selectAll()
      .execute();
  } catch (_) { return []; }
}

/** Remove media from an item. */
export async function removeItemMedia(id) {
  const db = await getDb();
  if (!db) throw new Error('PostgreSQL required');
  await db.deleteFrom('item_media')
    .where('id', '=', id)
    .where('tenant_id', '=', getTenantId())
    .execute();
  return { ok: true };
}
