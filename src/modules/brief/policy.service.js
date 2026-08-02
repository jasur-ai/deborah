/**
 * Edikit — Institutional Policy Pack Service
 *
 * Typed institutional policy packs for summative assessments:
 *   - Policy CRUD (DRAFT→APPROVED lifecycle, approved immutable)
 *   - Typed JSON schema validation (late/resit/security/retention/ai_use/marking)
 *   - Institution locked fields (denylist, enforced on every update)
 *   - Recipe library (seeded templates, apply-recipe flow)
 *   - Version snapshots (active attempts pin exact version)
 *
 * SECURITY: policy is DATA, never arbitrary JavaScript — every policy object
 * passes validatePolicySchema() which rejects unknown sections and types.
 */

import { getDb } from '../../infrastructure/postgres.js';
import { getCurrentTenant } from '../auth/tenant-context.js';
import { audit, AUDIT_ACTIONS } from '../auth/audit.js';
import {
  validatePolicySchema,
  checkLockedFieldChanges,
  SEED_RECIPES,
  DEFAULT_LOCKED_POLICY_FIELDS,
  mergeSectional,
} from './brief.schema.js';

function getTenantId() {
  return getCurrentTenant()?.tenantId || 1;
}

// ═══════════════════════════════════════════════════════════════════
// POLICY CRUD
// ═══════════════════════════════════════════════════════════════════

export async function createPolicyPack(data) {
  const db = await getDb();
  if (!db) throw new Error('PostgreSQL required');
  if (!data.name) throw new Error('Policy pack name is required');

  const policy = { ...(data.policy || {}) };
  const schemaResult = validatePolicySchema(policy);
  if (!schemaResult.ok) {
    throw new Error(`Invalid policy schema: ${schemaResult.errors.join('; ')}`);
  }

  const locked = data.locked_fields || DEFAULT_LOCKED_POLICY_FIELDS;

  const result = await db.insertInto('policy_packs')
    .values({
      tenant_id: getTenantId(),
      name: data.name,
      description: data.description || null,
      status: 'draft',
      version: 1,
      policy,
      locked_fields: locked,
      created_by: data.created_by || null,
    })
    .returning('id')
    .executeTakeFirst();

  if (result) {
    await db.insertInto('policy_pack_versions').values({
      pack_id: result.id,
      tenant_id: getTenantId(),
      version: 1,
      policy_snapshot: policy,
      locked_fields_snapshot: locked,
      change_summary: 'Policy pack created',
      changed_by: data.created_by || null,
    }).execute();

    await audit({
      action: AUDIT_ACTIONS.POLICY_CREATE,
      userId: data.created_by,
      resourceType: 'policy_pack',
      resourceId: result.id,
      details: { name: data.name },
    });
  }
  return result ? { id: result.id } : null;
}

export async function getPolicyPack(id) {
  const db = await getDb();
  if (!db) return null;
  try {
    return await db.selectFrom('policy_packs')
      .where('id', '=', id)
      .where('tenant_id', '=', getTenantId())
      .selectAll()
      .executeTakeFirst();
  } catch (_) { return null; }
}

export async function listPolicyPacks({ status, limit = 50, offset = 0 } = {}) {
  const db = await getDb();
  if (!db) return [];
  try {
    let query = db.selectFrom('policy_packs')
      .where('tenant_id', '=', getTenantId());
    if (status) query = query.where('status', '=', status);
    return await query
      .orderBy('updated_at', 'desc')
      .limit(limit).offset(offset)
      .selectAll()
      .execute();
  } catch (_) { return []; }
}

/**
 * Update a DRAFT policy pack. Approved packs are immutable.
 * Institution locked fields are denylist-enforced.
 */
export async function updatePolicyPack(id, data) {
  const db = await getDb();
  if (!db) throw new Error('PostgreSQL required');

  const existing = await getPolicyPack(id);
  if (!existing) throw new Error('Policy pack not found');
  if (existing.status !== 'draft') {
    throw new Error(`Policy pack is ${existing.status} — drafts are mutable, approved packs are immutable`);
  }

  // Section-level deep merge: partial sections (e.g. security: { max_strikes: 99 })
  // keep their untouched sibling fields instead of dropping them.
  const proposedPolicy = mergeSectional(existing.policy || {}, data.policy || {});

  const locked = data.locked_fields || existing.locked_fields || DEFAULT_LOCKED_POLICY_FIELDS;

  // Locked-field enforcement (institution-owned keys cannot be changed)
  const lockCheck = checkLockedFieldChanges(existing.policy || {}, proposedPolicy, locked);
  if (!lockCheck.ok) {
    const paths = lockCheck.lockedChanges.map((c) => c.path).join(', ');
    throw new Error(`Institution-locked policy field(s) cannot be changed: ${paths}`);
  }

  const schemaResult = validatePolicySchema(proposedPolicy);
  if (!schemaResult.ok) {
    throw new Error(`Invalid policy schema: ${schemaResult.errors.join('; ')}`);
  }

  const newVersion = existing.version + 1;
  const updates = { updated_at: new Date(), version: newVersion, policy: proposedPolicy };
  for (const f of ['name', 'description', 'locked_fields']) {
    if (data[f] !== undefined) updates[f] = data[f];
  }

  await db.updateTable('policy_packs')
    .set(updates)
    .where('id', '=', id)
    .where('tenant_id', '=', getTenantId())
    .execute();

  await db.insertInto('policy_pack_versions').values({
    pack_id: id,
    tenant_id: getTenantId(),
    version: newVersion,
    policy_snapshot: proposedPolicy,
    locked_fields_snapshot: locked,
    change_summary: data.change_summary || 'Policy updated',
    changed_by: data.updated_by || null,
  }).execute();

  await audit({
    action: AUDIT_ACTIONS.POLICY_UPDATE,
    userId: data.updated_by,
    resourceType: 'policy_pack',
    resourceId: id,
    details: { version: newVersion },
  });

  return { ok: true, version: newVersion };
}

export async function deletePolicyPack(id, userId) {
  const db = await getDb();
  if (!db) throw new Error('PostgreSQL required');

  const existing = await getPolicyPack(id);
  if (existing && existing.status === 'approved') {
    throw new Error('Cannot delete an approved policy pack — archive it instead');
  }

  await db.deleteFrom('policy_packs')
    .where('id', '=', id)
    .where('tenant_id', '=', getTenantId())
    .execute();
  await audit({
    action: AUDIT_ACTIONS.POLICY_DELETE,
    userId,
    resourceType: 'policy_pack',
    resourceId: id,
  });
  return { ok: true };
}

// ═══════════════════════════════════════════════════════════════════
// LIFECYCLE & VERSIONS
// ═══════════════════════════════════════════════════════════════════

/** Approve a draft policy pack (immutable afterwards). */
export async function approvePolicyPack(id, { userId } = {}) {
  const db = await getDb();
  if (!db) throw new Error('PostgreSQL required');

  const existing = await getPolicyPack(id);
  if (!existing) throw new Error('Policy pack not found');
  if (existing.status !== 'draft') throw new Error(`Policy pack is already ${existing.status}`);

  const schemaResult = validatePolicySchema(existing.policy || {});
  if (!schemaResult.ok) {
    throw new Error(`Cannot approve: ${schemaResult.errors.join('; ')}`);
  }

  await db.updateTable('policy_packs')
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
    action: AUDIT_ACTIONS.POLICY_APPROVE,
    userId,
    resourceType: 'policy_pack',
    resourceId: id,
  });
  return { ok: true };
}

export async function getPolicyPackVersions(id) {
  const db = await getDb();
  if (!db) return [];
  try {
    return await db.selectFrom('policy_pack_versions')
      .where('pack_id', '=', id)
      .where('tenant_id', '=', getTenantId())
      .orderBy('version', 'desc')
      .selectAll()
      .execute();
  } catch (_) { return []; }
}

// ═══════════════════════════════════════════════════════════════════
// RECIPE LIBRARY
// ═══════════════════════════════════════════════════════════════════

/**
 * Seed the recipe library (idempotent — system recipes inserted by name).
 * Called on server startup after migration (see server.js bootstrap) and
 * exposed as POST /api/policy-recipes/seed for re-seeding.
 */
export async function seedRecipeLibrary({ tenantId = 1 } = {}) {
  const db = await getDb();
  if (!db) return { ok: false, error: 'PostgreSQL required' };

  let inserted = 0;
  for (const recipe of SEED_RECIPES) {
    const existing = await db.selectFrom('recipe_library')
      .where('name', '=', recipe.name)
      .where('tenant_id', '=', tenantId)
      .select('id')
      .executeTakeFirst();
    if (existing) continue;
    await db.insertInto('recipe_library').values({
      tenant_id: tenantId,
      name: recipe.name,
      description: recipe.description,
      category: recipe.category,
      policy_template: recipe.policy_template,
      is_system: true,
    }).execute();
    inserted += 1;
  }
  return { ok: true, inserted };
}

export async function listRecipes({ category, limit = 50, offset = 0 } = {}) {
  const db = await getDb();
  if (!db) return [];
  try {
    let query = db.selectFrom('recipe_library')
      .where('tenant_id', '=', getTenantId());
    if (category) query = query.where('category', '=', category);
    return await query
      .orderBy('name', 'asc')
      .limit(limit).offset(offset)
      .selectAll()
      .execute();
  } catch (_) { return []; }
}

/**
 * Create a new policy pack from a recipe template.
 */
export async function createPolicyFromRecipe(recipeId, data = {}) {
  const db = await getDb();
  if (!db) throw new Error('PostgreSQL required');

  const recipe = await db.selectFrom('recipe_library')
    .where('id', '=', recipeId)
    .where('tenant_id', '=', getTenantId())
    .selectAll()
    .executeTakeFirst();
  if (!recipe) throw new Error('Recipe not found');

  return createPolicyPack({
    name: data.name || recipe.name,
    description: data.description || recipe.description,
    policy: recipe.policy_template,
    locked_fields: data.locked_fields,
    created_by: data.created_by,
  });
}
