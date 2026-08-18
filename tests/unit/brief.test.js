/**
 * Deborah — Assessment Brief, Policy Pack & Simulator Tests
 *
 * Covers: typed policy schema, brief schema, A0–A4 AI-use levels,
 * locked-field denylist, material-change diff, publish blockers,
 * recipe library, roster/accommodation simulator, service graceful
 * degradation, barrel export.
 */

import { describe, it, expect } from 'vitest';

import {
  // schema (pure)
  AI_USE_LEVELS,
  AI_USE_LEVEL_INFO,
  validatePolicySchema,
  validateBriefSchema,
  checkLockedFieldChanges,
  diffBriefContent,
  checkPublishBlockers,
  generatePublishReport,
  SEED_RECIPES,
  DEFAULT_LOCKED_POLICY_FIELDS,
  RECIPE_CATEGORIES,
  BRIEF_STATUS_TRANSITIONS,
  POLICY_STATUS_TRANSITIONS,
} from '../../src/modules/brief/brief.schema.js';

import {
  // brief service
  createBrief,
  getBrief,
  listBriefs,
  updateBrief,
  deleteBrief,
  approveBrief,
  getBriefVersions,
  diffBriefVersions,
} from '../../src/modules/brief/brief.service.js';

import {
  // policy service
  createPolicyPack,
  getPolicyPack,
  listPolicyPacks,
  updatePolicyPack,
  deletePolicyPack,
  approvePolicyPack,
  getPolicyPackVersions,
  seedRecipeLibrary,
  listRecipes,
  createPolicyFromRecipe,
} from '../../src/modules/brief/policy.service.js';

import {
  simulateStudent,
  simulateRoster,
  generateHumanReadableReport,
  createSimulatorRun,
  listSimulatorRuns,
  getSimulatorRun,
  SIM_ACCOMMODATION_TYPES,
} from '../../src/modules/brief/simulator.js';

// ═══════════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════════

describe('Brief — Constants', () => {
  it('should have AI-use levels A0–A4', () => {
    expect(AI_USE_LEVELS).toEqual(['A0', 'A1', 'A2', 'A3', 'A4']);
    expect(AI_USE_LEVEL_INFO.A0.label).toContain('taqiqlangan');
    expect(AI_USE_LEVEL_INFO.A4.label).toContain('AI-native');
  });

  it('should have recipe categories', () => {
    expect(RECIPE_CATEGORIES).toContain('standard');
    expect(RECIPE_CATEGORIES).toContain('high_stakes');
    expect(RECIPE_CATEGORIES).toContain('accessible');
  });

  it('should have default locked policy fields', () => {
    expect(DEFAULT_LOCKED_POLICY_FIELDS).toContain('retention_days');
    expect(DEFAULT_LOCKED_POLICY_FIELDS).toContain('security.max_strikes');
  });

  it('should have lifecycle transitions (draft→approved, approved immutable)', () => {
    expect(BRIEF_STATUS_TRANSITIONS.draft).toContain('approved');
    expect(BRIEF_STATUS_TRANSITIONS.approved).not.toContain('draft');
    expect(POLICY_STATUS_TRANSITIONS.draft).toContain('approved');
  });

  it('should have 4 seed recipes', () => {
    expect(SEED_RECIPES).toHaveLength(4);
    expect(SEED_RECIPES.map((r) => r.category)).toContain('high_stakes');
  });
});

// ═══════════════════════════════════════════════════════════════════
// TYPED POLICY SCHEMA
// ═══════════════════════════════════════════════════════════════════

describe('Brief — validatePolicySchema', () => {
  const validPolicy = {
    late: { allowed: false, max_days: 0, penalty_per_day: 0 },
    resit: { allowed: true, max_attempts: 1, wait_days: 7 },
    security: { profile: 'S1', max_strikes: 3, allow_camera: false, require_seb: false },
    retention_days: 180,
    ai_use: { level: 'A0', tools_allowed: [] },
    marking: { mode: 'auto' },
  };

  it('should accept a valid typed policy', () => {
    const result = validatePolicySchema(validPolicy);
    expect(result.ok).toBe(true);
  });

  it('should reject unknown top-level sections', () => {
    const result = validatePolicySchema({ ...validPolicy, arbitrary_js: 'alert(1)' });
    expect(result.ok).toBe(false);
    expect(result.errors[0]).toContain('Unknown policy section');
  });

  it('should reject non-boolean late.allowed', () => {
    const result = validatePolicySchema({ late: { allowed: 'yes' } });
    expect(result.ok).toBe(false);
    expect(result.errors[0]).toContain('late.allowed');
  });

  it('should reject invalid security profile', () => {
    const result = validatePolicySchema({ security: { profile: 'S9' } });
    expect(result.ok).toBe(false);
    expect(result.errors[0]).toContain('S0');
  });

  it('should reject invalid AI-use level', () => {
    const result = validatePolicySchema({ ai_use: { level: 'A7' } });
    expect(result.ok).toBe(false);
  });

  it('should reject non-integer retention_days', () => {
    const result = validatePolicySchema({ retention_days: 90.5 });
    expect(result.ok).toBe(false);
  });

  it('should reject non-string tools_allowed entries', () => {
    const result = validatePolicySchema({ ai_use: { level: 'A1', tools_allowed: [123] } });
    expect(result.ok).toBe(false);
  });

  it('should accept empty policy (all optional)', () => {
    expect(validatePolicySchema({}).ok).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════
// BRIEF SCHEMA
// ═══════════════════════════════════════════════════════════════════

describe('Brief — validateBriefSchema', () => {
  const validContent = {
    learning_outcomes: ['LO1'],
    duration_minutes: 60,
    materials: ['formula sheet'],
    submission_format: 'online',
  };

  it('should accept valid brief content', () => {
    expect(validateBriefSchema(validContent).ok).toBe(true);
  });

  it('should reject empty learning_outcomes', () => {
    const result = validateBriefSchema({ ...validContent, learning_outcomes: [] });
    expect(result.ok).toBe(false);
    expect(result.errors[0]).toContain('learning_outcomes');
  });

  it('should reject missing/negative duration', () => {
    expect(validateBriefSchema({ learning_outcomes: ['LO1'] }).ok).toBe(false);
    expect(validateBriefSchema({ ...validContent, duration_minutes: -5 }).ok).toBe(false);
  });

  it('should reject invalid ai_use_level', () => {
    const result = validateBriefSchema({ ...validContent, ai_use_level: 'B9' });
    expect(result.ok).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════
// LOCKED FIELDS (institution denylist)
// ═══════════════════════════════════════════════════════════════════

describe('Brief — locked field enforcement', () => {
  const current = {
    retention_days: 180,
    security: { max_strikes: 3, allow_camera: false },
    late: { allowed: false },
  };

  it('should pass when locked values unchanged', () => {
    const result = checkLockedFieldChanges(current, {
      ...current,
      late: { allowed: true }, // not locked
    }, ['retention_days', 'security.max_strikes']);
    expect(result.ok).toBe(true);
    expect(result.lockedChanges).toEqual([]);
  });

  it('should flag a changed locked field (bypass attempt)', () => {
    const result = checkLockedFieldChanges(current, {
      ...current,
      retention_days: 30, // locked — institution owned
    }, ['retention_days']);
    expect(result.ok).toBe(false);
    expect(result.lockedChanges[0].path).toBe('retention_days');
    expect(result.lockedChanges[0].from).toBe(180);
    expect(result.lockedChanges[0].to).toBe(30);
  });

  it('should flag nested locked field changes', () => {
    const result = checkLockedFieldChanges(current, {
      ...current,
      security: { max_strikes: 99 },
    }, ['security.max_strikes']);
    expect(result.ok).toBe(false);
    expect(result.lockedChanges[0].path).toBe('security.max_strikes');
  });

  it('should not flag when only non-locked fields change', () => {
    const result = checkLockedFieldChanges(current, {
      ...current,
      late: { allowed: true },
    }, ['retention_days']);
    expect(result.ok).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════
// MATERIAL-CHANGE DIFF
// ═══════════════════════════════════════════════════════════════════

describe('Brief — material-change diff', () => {
  it('should classify duration change as material', () => {
    const diff = diffBriefContent(
      { duration_minutes: 60, title_note: 'x' },
      { duration_minutes: 90, title_note: 'x' }
    );
    expect(diff.isMaterial).toBe(true);
    expect(diff.materialChanges[0].field).toBe('duration_minutes');
  });

  it('should classify submission_format change as material', () => {
    const diff = diffBriefContent(
      { submission_format: 'online' },
      { submission_format: 'paper' }
    );
    expect(diff.isMaterial).toBe(true);
  });

  it('should classify non-material fields as minor', () => {
    const diff = diffBriefContent(
      { description: 'old' },
      { description: 'new' }
    );
    expect(diff.isMaterial).toBe(false);
    expect(diff.minorChanges[0].field).toBe('description');
  });

  it('should detect no change', () => {
    const diff = diffBriefContent({ a: 1 }, { a: 1 });
    expect(diff.isMaterial).toBe(false);
    expect(diff.materialChanges).toEqual([]);
    expect(diff.minorChanges).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════
// PUBLISH BLOCKERS
// ═══════════════════════════════════════════════════════════════════

describe('Brief — publish blockers', () => {
  it('should block when brief missing', () => {
    const result = checkPublishBlockers({ brief: null, policy: { status: 'approved' } });
    expect(result.ok).toBe(false);
    expect(result.blockers[0]).toContain('brief');
  });

  it('should block when brief not approved', () => {
    const result = checkPublishBlockers({ brief: { status: 'draft' }, policy: { status: 'approved' } });
    expect(result.ok).toBe(false);
    expect(result.blockers[0]).toContain('approved');
  });

  it('should block when policy missing/not approved', () => {
    expect(checkPublishBlockers({ brief: { status: 'approved' }, policy: null }).ok).toBe(false);
    expect(checkPublishBlockers({ brief: { status: 'approved' }, policy: { status: 'draft' } }).ok).toBe(false);
  });

  it('should allow publish when brief+policy approved', () => {
    const result = checkPublishBlockers({
      brief: { status: 'approved' },
      policy: { status: 'approved' },
    });
    expect(result.ok).toBe(true);
    expect(result.blockers).toEqual([]);
  });

  it('should not gate non-summative assessments', () => {
    const result = checkPublishBlockers({ brief: null, policy: null, isSummative: false });
    expect(result.ok).toBe(true);
  });

  it('generatePublishReport should be human-readable', () => {
    const report = generatePublishReport({ brief: { status: 'draft' }, policy: null });
    expect(report).toContain('BLOCKED');
    expect(report).toContain('Brief status: draft');
    expect(report).toContain('Policy status: MISSING');
  });
});

// ═══════════════════════════════════════════════════════════════════
// SIMULATOR
// ═══════════════════════════════════════════════════════════════════

describe('Brief — simulator', () => {
  const brief = { content: { duration_minutes: 60 } };
  const policy = {
    policy: {
      security: { profile: 'S1', max_strikes: 3, allow_camera: false },
      late: { allowed: false },
      resit: { allowed: true },
    },
  };

  it('should have accommodation types', () => {
    expect(SIM_ACCOMMODATION_TYPES).toContain('extra_time');
    expect(SIM_ACCOMMODATION_TYPES).toContain('break_timer');
  });

  it('should simulate base student without accommodations', () => {
    const result = simulateStudent({ external_id: 's1', accommodations: [] }, brief, policy);
    expect(result.effectiveMinutes).toBe(60);
    expect(result.extraTimeMinutes).toBe(0);
    expect(result.breakCount).toBe(0);
    expect(result.maxStrikes).toBe(3);
  });

  it('should apply +50% extra time', () => {
    const result = simulateStudent({
      external_id: 's2',
      accommodations: [{ type: 'extra_time', operational_config: { extraPercent: 50 } }],
    }, brief, policy);
    expect(result.extraTimeMinutes).toBe(30);
    expect(result.effectiveMinutes).toBe(90);
  });

  it('should apply fixed extra minutes', () => {
    const result = simulateStudent({
      external_id: 's3',
      accommodations: [{ type: 'extra_time', operational_config: { extraMinutes: 15 } }],
    }, brief, policy);
    expect(result.effectiveMinutes).toBe(75);
  });

  it('should apply scheduled breaks', () => {
    const result = simulateStudent({
      external_id: 's4',
      accommodations: [
        { type: 'extra_time', operational_config: { extraPercent: 50 } },
        { type: 'break_timer', operational_config: { breakDuration: 10, breakFrequency: 30 } },
      ],
    }, brief, policy);
    // 60 → 90 with extra time; breaks: floor(90/30)=3 → 30 min breaks → 120
    expect(result.breakCount).toBe(3);
    expect(result.breakMinutes).toBe(30);
    expect(result.effectiveMinutes).toBe(120);
  });

  it('should honor strike_policy_override', () => {
    const result = simulateStudent({
      external_id: 's5',
      accommodations: [{ type: 'strike_policy_override', operational_config: { maxStrikes: 5 } }],
    }, brief, policy);
    expect(result.maxStrikes).toBe(5);
  });

  it('should warn when camera required but student exempt', () => {
    const result = simulateStudent({
      external_id: 's6',
      accommodations: [{ type: 'camera_off', operational_config: {} }],
    }, brief, policy);
    expect(result.cameraExempt).toBe(true);
    expect(result.cameraRequired).toBe(true);
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it('simulateRoster should produce summary stats', () => {
    const result = simulateRoster({
      roster: [
        { external_id: 'a', accommodations: [] },
        { external_id: 'b', accommodations: [{ type: 'extra_time', operational_config: { extraPercent: 100 } }] },
        { external_id: 'c', accommodations: [{ type: 'separate_room' }] },
      ],
      brief,
      policy,
    });
    expect(result.ok).toBe(true);
    expect(result.summary.studentCount).toBe(3);
    expect(result.summary.maxEffectiveMinutes).toBe(120);
    expect(result.summary.minEffectiveMinutes).toBe(60);
    expect(result.summary.separateRoomCount).toBe(1);
  });

  it('simulateRoster should block on empty roster', () => {
    const result = simulateRoster({ roster: [], brief, policy });
    expect(result.ok).toBe(false);
    expect(result.blockers.some((b) => b.includes('Roster'))).toBe(true);
  });

  it('simulateRoster should block on missing brief/policy', () => {
    const result = simulateRoster({ roster: [{ external_id: 'a' }], brief: null, policy: null });
    expect(result.ok).toBe(false);
    expect(result.blockers.length).toBeGreaterThanOrEqual(2);
  });

  it('createSimulatorRun should reject without PostgreSQL', async () => {
    await expect(createSimulatorRun({})).rejects.toThrow('PostgreSQL required');
  });

  it('listSimulatorRuns should return [] without PostgreSQL', async () => {
    expect(await listSimulatorRuns()).toEqual([]);
  });

  it('getSimulatorRun should return null without PostgreSQL', async () => {
    expect(await getSimulatorRun(1)).toBeNull();
  });

  it('generateHumanReadableReport should produce a report', () => {
    const report = generateHumanReadableReport({
      brief: { title: 'Math Final', status: 'approved', version: 2, ai_use_level: 'A0' },
      policy: { name: 'Final policy', status: 'approved', version: 1 },
      simulation: null,
    });
    expect(report).toContain('READY TO PUBLISH');
    expect(report).toContain('Math Final');
  });
});

// ═══════════════════════════════════════════════════════════════════
// SERVICE (graceful degradation without PostgreSQL)
// ═══════════════════════════════════════════════════════════════════

describe('Brief — Service (graceful degradation)', () => {
  it('createBrief should reject without PostgreSQL', async () => {
    await expect(createBrief({ title: 'B' })).rejects.toThrow('PostgreSQL required');
  });

  it('updateBrief should reject without PostgreSQL', async () => {
    await expect(updateBrief(1, { content: {} })).rejects.toThrow('PostgreSQL required');
  });

  it('deleteBrief should reject without PostgreSQL', async () => {
    await expect(deleteBrief(1, 1)).rejects.toThrow('PostgreSQL required');
  });

  it('approveBrief should reject without PostgreSQL', async () => {
    await expect(approveBrief(1, {})).rejects.toThrow('PostgreSQL required');
  });

  it('getBrief should return null without PostgreSQL', async () => {
    expect(await getBrief(1)).toBeNull();
  });

  it('listBriefs should return [] without PostgreSQL', async () => {
    expect(await listBriefs()).toEqual([]);
  });

  it('getBriefVersions should return [] without PostgreSQL', async () => {
    expect(await getBriefVersions(1)).toEqual([]);
  });

  it('diffBriefVersions should return null without PostgreSQL', async () => {
    expect(await diffBriefVersions(1, 1, 2)).toBeNull();
  });

  it('createPolicyPack should reject without PostgreSQL', async () => {
    await expect(createPolicyPack({ name: 'P' })).rejects.toThrow('PostgreSQL required');
  });

  it('updatePolicyPack should reject without PostgreSQL', async () => {
    await expect(updatePolicyPack(1, { policy: {} })).rejects.toThrow('PostgreSQL required');
  });

  it('deletePolicyPack should reject without PostgreSQL', async () => {
    await expect(deletePolicyPack(1, 1)).rejects.toThrow('PostgreSQL required');
  });

  it('approvePolicyPack should reject without PostgreSQL', async () => {
    await expect(approvePolicyPack(1, {})).rejects.toThrow('PostgreSQL required');
  });

  it('getPolicyPack should return null without PostgreSQL', async () => {
    expect(await getPolicyPack(1)).toBeNull();
  });

  it('listPolicyPacks should return [] without PostgreSQL', async () => {
    expect(await listPolicyPacks()).toEqual([]);
  });

  it('getPolicyPackVersions should return [] without PostgreSQL', async () => {
    expect(await getPolicyPackVersions(1)).toEqual([]);
  });

  it('seedRecipeLibrary should return error without PostgreSQL', async () => {
    const result = await seedRecipeLibrary();
    expect(result.ok).toBe(false);
  });

  it('listRecipes should return [] without PostgreSQL', async () => {
    expect(await listRecipes()).toEqual([]);
  });

  it('createPolicyFromRecipe should reject without PostgreSQL', async () => {
    await expect(createPolicyFromRecipe(1, {})).rejects.toThrow('PostgreSQL required');
  });
});

// ═══════════════════════════════════════════════════════════════════
// BARREL EXPORT
// ═══════════════════════════════════════════════════════════════════

describe('Brief — Barrel Export', () => {
  it('should export all expected functions and constants', async () => {
    const mod = await import('../../src/modules/brief/index.js');
    const expected = [
      // schema
      'AI_USE_LEVELS', 'AI_USE_LEVEL_INFO', 'BRIEF_STATUS', 'BRIEF_STATUS_TRANSITIONS',
      'POLICY_STATUS', 'POLICY_STATUS_TRANSITIONS', 'RECIPE_CATEGORIES',
      'DEFAULT_LOCKED_POLICY_FIELDS', 'DEFAULT_LOCKED_BRIEF_FIELDS',
      'validatePolicySchema', 'validateBriefSchema', 'checkLockedFieldChanges',
      'diffBriefContent', 'checkPublishBlockers', 'generatePublishReport', 'SEED_RECIPES',
      // brief service
      'createBrief', 'getBrief', 'listBriefs', 'updateBrief', 'deleteBrief',
      'approveBrief', 'getBriefVersions', 'diffBriefVersions',
      // policy service
      'createPolicyPack', 'getPolicyPack', 'listPolicyPacks', 'updatePolicyPack',
      'deletePolicyPack', 'approvePolicyPack', 'getPolicyPackVersions',
      'seedRecipeLibrary', 'listRecipes', 'createPolicyFromRecipe',
      // simulator
      'simulateStudent', 'simulateRoster', 'generateHumanReadableReport',
      'createSimulatorRun', 'listSimulatorRuns', 'getSimulatorRun',
      'SIM_ACCOMMODATION_TYPES',
    ];
    for (const exp of expected) {
      expect(mod[exp], `Missing export: ${exp}`).toBeDefined();
    }
  });
});
