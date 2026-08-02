/**
 * Edikit — Immutable Publish Transaction & Assignment Snapshot Tests
 *
 * Covers (Prompt 27):
 *   - Canonical hashing (reproducible version_hash — done condition)
 *   - Secret scan: private keys can NEVER leak into public snapshots
 *   - Public/private snapshot builders (allowlist-based)
 *   - planPublish: deterministic plan, approval gates, empty roster warning
 *   - Publish idempotency key derivation (race protection)
 *   - Service graceful degradation without PostgreSQL
 *   - Barrel export
 */

import { describe, it, expect } from 'vitest';

import {
  // schema (pure)
  ASSIGNMENT_STATUS,
  ASSIGNMENT_STATUS_TRANSITIONS,
  NOTIFICATION_TYPES,
  NOTIFICATION_SCOPES,
  PUBLIC_ITEM_FIELDS,
  PRIVATE_KEY_FIELDS,
  canonicalStringify,
  canonicalHash,
  scanForSecrets,
  verifyPublicSnapshotClean,
  buildPublicItemSnapshot,
  buildPrivateScoreSnapshot,
  buildRosterSnapshot,
  planPublish,
  derivePublishKey,
  rosterHash,
  assignmentContentForHash,
} from '../../src/modules/publish/publish.schema.js';

import {
  // service
  publishAssignment,
  getAssignment,
  listAssignments,
  getAssignmentPublicItems,
  getAssignmentPrivateScores,
  getAssignmentRoster,
  getAssignmentNotifications,
  verifyAssignmentIntegrity,
} from '../../src/modules/publish/publish.service.js';

// ═══════════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════════

describe('Publish — Constants', () => {
  it('should have assignment status lifecycle (scheduled = publish target)', () => {
    expect(ASSIGNMENT_STATUS.SCHEDULED).toBe('scheduled');
    expect(ASSIGNMENT_STATUS_TRANSITIONS.draft).toContain('scheduled');
    expect(ASSIGNMENT_STATUS_TRANSITIONS.scheduled).toContain('published');
    expect(ASSIGNMENT_STATUS_TRANSITIONS.cancelled).toEqual([]);
  });

  it('should have notification types + scopes', () => {
    expect(NOTIFICATION_TYPES).toContain('scheduled');
    expect(NOTIFICATION_TYPES).toContain('published');
    expect(NOTIFICATION_SCOPES).toContain('roster');
  });

  it('should define public allowlist and private-key denylist', () => {
    expect(PUBLIC_ITEM_FIELDS).toContain('public_data');
    expect(PUBLIC_ITEM_FIELDS).not.toContain('private_data');
    expect(PRIVATE_KEY_FIELDS).toContain('private_data');
    expect(PRIVATE_KEY_FIELDS).toContain('correctKey');
    expect(PRIVATE_KEY_FIELDS).toContain('scoringRubric');
  });
});

// ═══════════════════════════════════════════════════════════════════
// CANONICAL HASHING (reproducible version)
// ═══════════════════════════════════════════════════════════════════

describe('Publish — canonical hashing', () => {
  it('should produce stable output regardless of key order', () => {
    expect(canonicalStringify({ a: 1, b: 2 })).toBe(canonicalStringify({ b: 2, a: 1 }));
  });

  it('should handle nested objects and arrays', () => {
    const a = { list: [{ x: 1, y: 2 }], z: { w: 'v' } };
    const b = { z: { w: 'v' }, list: [{ y: 2, x: 1 }] };
    expect(canonicalStringify(a)).toBe(canonicalStringify(b));
  });

  it('should preserve array element order (canonical JSON is order-sensitive for arrays)', () => {
    const a = { list: [{ x: 1 }, { y: 2 }] };
    const b = { list: [{ y: 2 }, { x: 1 }] };
    expect(canonicalStringify(a)).not.toBe(canonicalStringify(b));
  });

  it('should be deterministic — same input, same hash (reproducible publish)', () => {
    const content = { assessment_id: 1, items: [{ id: 5, hash: 'abc' }], roster: [1, 2] };
    expect(canonicalHash(content)).toBe(canonicalHash(content));
    expect(canonicalHash(content)).toHaveLength(64); // SHA-256 hex
  });

  it('should produce different hashes for different content', () => {
    expect(canonicalHash({ a: 1 })).not.toBe(canonicalHash({ a: 2 }));
  });
});

// ═══════════════════════════════════════════════════════════════════
// SECRET SCAN
// ═══════════════════════════════════════════════════════════════════

describe('Publish — secret scan', () => {
  it('should find private_data nested anywhere', () => {
    const hits = scanForSecrets({ public_data: { stem: 'x', inner: { private_data: { correctKey: 'B' } } } });
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].key).toBe('private_data');
  });

  it('should find correctKey / scoringRubric keys', () => {
    const hits = scanForSecrets({ public_data: { stem: 'x' }, correctKey: 'A', scoringRubric: 'r' });
    const keys = hits.map((h) => h.key);
    expect(keys).toContain('correctKey');
    expect(keys).toContain('scoringRubric');
  });

  it('should find case-insensitive variants', () => {
    const hits = scanForSecrets({ AnswerKey: 'B', PRIVATE_DATA: {} });
    expect(hits.length).toBe(2);
  });

  it('should return empty for a clean public surface', () => {
    const hits = scanForSecrets({ stem: 'q', options: [{ key: 'A', text: 'one' }] });
    expect(hits).toEqual([]);
  });

  it('verifyPublicSnapshotClean should flag a leak in a public item', () => {
    const result = verifyPublicSnapshotClean([
      { item_id: 1, public_data: { stem: 'q' }, correctKey: 'B' },
    ]);
    expect(result.ok).toBe(false);
    expect(result.leaks[0].path).toContain('correctKey');
  });

  it('verifyPublicSnapshotClean should pass a clean surface', () => {
    const result = verifyPublicSnapshotClean([
      { item_id: 1, public_data: { stem: 'q' }, points: 1 },
    ]);
    expect(result.ok).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════
// SNAPSHOT BUILDERS
// ═══════════════════════════════════════════════════════════════════

describe('Publish — snapshot builders', () => {
  const rawItem = {
    id: 9,
    item_id: 9,
    question_type: 'single_choice',
    difficulty: 'medium',
    points: 2,
    time_seconds: 60,
    sort_order: 1,
    section_id: 3,
    section_title: 'Algebra',
    public_data: { stem: '2+2=?', options: [{ key: 'A', text: '3' }, { key: 'B', text: '4' }] },
    private_data: { correctKey: 'B', scoringRubric: 'rubric', explanation: '2+2=4' },
  };

  it('buildPublicItemSnapshot should strip ALL private fields (allowlist)', () => {
    const snap = buildPublicItemSnapshot(rawItem);
    expect(snap.private_data).toBeUndefined();
    expect(snap.correctKey).toBeUndefined();
    expect(snap.explanation).toBeUndefined();
    expect(snap.public_data.stem).toBe('2+2=?');
    expect(snap.item_hash).toHaveLength(64);
  });

  it('buildPublicItemSnapshot should produce a hash over public_data only', () => {
    const a = buildPublicItemSnapshot(rawItem);
    const b = buildPublicItemSnapshot({ ...rawItem, private_data: { correctKey: 'Z' } });
    // Different private keys → same public hash (public surface unaffected)
    expect(a.item_hash).toBe(b.item_hash);
  });

  it('buildPublicItemSnapshot should preserve public_data so the secret-scan gate can catch nested leaks', () => {
    const dirty = { ...rawItem, public_data: { stem: 'q', correctKey: 'B' } };
    const snap = buildPublicItemSnapshot(dirty);
    // Preserved as-is (NOT silently blanked) — a real leak must be surfaced,
    // and planPublish's verifyPublicSnapshotClean gate will fail the plan.
    expect(snap.public_data).toEqual({ stem: 'q', correctKey: 'B' });
    expect(scanForSecrets(snap.public_data).length).toBeGreaterThan(0);
  });

  it('buildPrivateScoreSnapshot should keep only scoring data', () => {
    const snap = buildPrivateScoreSnapshot(rawItem);
    expect(snap.item_id).toBe(9);
    expect(snap.private_data.correctKey).toBe('B');
    expect(snap.item_hash).toHaveLength(64);
  });

  it('buildRosterSnapshot should normalize + de-duplicate', () => {
    const rows = buildRosterSnapshot([
      { user_id: 1, group_id: 10 },
      { user_id: 1, group_id: 11 }, // duplicate user
      { user_id: 2, external_id: 'ext-2' },
      { user_id: null }, // invalid
      {},
    ]);
    expect(rows).toHaveLength(2);
    expect(rows[0].group_id).toBe(10);
    expect(rows[1].external_id).toBe('ext-2');
  });
});

// ═══════════════════════════════════════════════════════════════════
// PLAN (deterministic publish plan)
// ═══════════════════════════════════════════════════════════════════

describe('Publish — planPublish', () => {
  const assessment = {
    id: 1,
    title: 'Math Final',
    blueprint: { weights: [] },
    randomization_config: {},
    total_points: 10,
    total_time_seconds: 600,
    item_count: 2,
    status: 'draft',
  };
  const items = [
    { item_id: 1, question_type: 'single_choice', difficulty: 'easy', points: 1, sort_order: 0, public_data: { stem: 'q1' }, private_data: { correctKey: 'A' } },
    { item_id: 2, question_type: 'essay', difficulty: 'hard', points: 2, sort_order: 1, public_data: { stem: 'q2' }, private_data: { scoringRubric: 'r' } },
  ];
  const sections = [{ id: 1, title: 'S1', sort_order: 0 }];
  const approvedBrief = { id: 5, version: 3, status: 'approved' };
  const approvedPolicy = { id: 7, version: 2, status: 'approved' };
  const roster = [{ user_id: 1, group_id: 10 }, { user_id: 2, group_id: 10 }];

  it('should produce a reproducible plan (same inputs → same hash)', () => {
    const p1 = planPublish({ assessment, sections, items, brief: approvedBrief, policy: approvedPolicy, rosterMembers: roster });
    const p2 = planPublish({ assessment, sections, items, brief: approvedBrief, policy: approvedPolicy, rosterMembers: roster });
    expect(p1.ok).toBe(true);
    expect(p1.plan.version_hash).toBe(p2.plan.version_hash);
    expect(p1.plan.summary.itemCount).toBe(2);
    expect(p1.plan.summary.rosterCount).toBe(2);
  });

  it('should pin EXACT brief/policy versions', () => {
    const { plan } = planPublish({ assessment, items, brief: approvedBrief, policy: approvedPolicy, rosterMembers: roster });
    expect(plan.brief_id).toBe(5);
    expect(plan.brief_version_id).toBe(3);
    expect(plan.policy_pack_id).toBe(7);
    expect(plan.policy_version_id).toBe(2);
  });

  it('should reject unapproved brief', () => {
    const result = planPublish({ assessment, items, brief: { id: 5, version: 1, status: 'draft' }, policy: approvedPolicy, rosterMembers: roster });
    expect(result.ok).toBe(false);
    expect(result.errors[0]).toContain('approved');
  });

  it('should reject unapproved policy', () => {
    const result = planPublish({ assessment, items, brief: approvedBrief, policy: { id: 7, version: 1, status: 'draft' }, rosterMembers: roster });
    expect(result.ok).toBe(false);
  });

  it('should reject when items missing', () => {
    const result = planPublish({ assessment, items: [], brief: approvedBrief, policy: approvedPolicy, rosterMembers: roster });
    expect(result.ok).toBe(false);
    expect(result.errors[0]).toContain('items');
  });

  it('should warn (not fail) on empty roster', () => {
    const result = planPublish({ assessment, items, brief: approvedBrief, policy: approvedPolicy, rosterMembers: [] });
    expect(result.ok).toBe(true);
    expect(result.warnings[0]).toContain('roster');
    expect(result.plan.summary.rosterCount).toBe(0);
  });

  it('should fail when a private key leaks into public surface (impossible normally)', () => {
    const dirtyItems = [{ item_id: 1, question_type: 'mc', points: 1, sort_order: 0, public_data: { stem: 'q', correctKey: 'A' } }];
    const result = planPublish({ assessment, items: dirtyItems, brief: approvedBrief, policy: approvedPolicy, rosterMembers: roster });
    expect(result.ok).toBe(false);
    expect(result.errors[0]).toContain('Secret scan');
  });

  it('should produce a plan with secret-clean public items', () => {
    const { plan } = planPublish({ assessment, items, brief: approvedBrief, policy: approvedPolicy, rosterMembers: roster });
    const check = verifyPublicSnapshotClean(plan.public_items);
    expect(check.ok).toBe(true);
  });

  it('should default to SCHEDULED status (done condition)', () => {
    const { plan } = planPublish({ assessment, items, brief: approvedBrief, policy: approvedPolicy, rosterMembers: roster });
    expect(plan.status).toBe('scheduled');
  });

  it('verify-path DB-round-trip recomputation should match plan version_hash', () => {
    // Regression: verifyAssignmentIntegrity reads rows back from PostgreSQL —
    // numeric points return as strings ('1.00'), rows arrive in DB ORDER BY
    // (roster by user_id, public by sort_order, private by item_id) rather
    // than plan input order, and every row carries extra columns (id,
    // tenant_id, created_at...). The hash must normalize ALL of that away or
    // the immutability check would never agree with the plan-time hash.
    // Rows here are deliberately REVERSED + decorated to simulate the
    // round-trip — this test fails without the in-hash sorting.
    const result = planPublish({ assessment, sections, items, brief: approvedBrief, policy: approvedPolicy, rosterMembers: roster });
    expect(result.ok).toBe(true);
    const { plan } = result;

    const created = '2026-09-01T00:00:00.000Z'; // fixed — fully deterministic
    const dbPublicItems = [...plan.public_items].reverse().map((p, i) => ({
      id: 100 + i,
      tenant_id: 1,
      assignment_id: 7,
      created_at: created,
      ...p,
      points: String(p.points), // numeric(8,2) round-trip
    }));
    const dbPrivateScores = [...plan.private_scores].reverse().map((p, i) => ({
      id: 200 + i,
      tenant_id: 1,
      assignment_id: 7,
      created_at: created,
      ...p,
    }));
    const dbRoster = [...plan.roster_members].reverse().map((r, i) => ({
      id: 300 + i,
      tenant_id: 1,
      assignment_id: 7,
      created_at: created,
      ...r,
    }));

    const recomputed = assignmentContentForHash({
      assessment: { id: plan.assessment_id, title: plan.title },
      publicItems: dbPublicItems,
      privateScores: dbPrivateScores,
      brief: { id: plan.brief_id, version: plan.brief_version_id },
      policy: { id: plan.policy_pack_id, version: plan.policy_version_id },
      roster: dbRoster,
    });
    expect(recomputed).toBe(plan.version_hash);
  });

  it('version_hash should change when public item content changes (immutability signal)', () => {
    const base = planPublish({ assessment, sections, items, brief: approvedBrief, policy: approvedPolicy, rosterMembers: roster });
    const mutated = planPublish({
      assessment,
      sections,
      items: [{ ...items[0], public_data: { stem: 'q1-CHANGED' } }, items[1]],
      brief: approvedBrief,
      policy: approvedPolicy,
      rosterMembers: roster,
    });
    expect(mutated.ok).toBe(true);
    expect(mutated.plan.version_hash).not.toBe(base.plan.version_hash);
  });
});

// ═══════════════════════════════════════════════════════════════════
// IDEMPOTENCY KEYS (race protection)
// ═══════════════════════════════════════════════════════════════════

describe('Publish — idempotency keys', () => {
  it('should derive deterministic keys', () => {
    const k1 = derivePublishKey({ assessmentId: 1, briefVersionId: 3, policyVersionId: 2, rosterHash: 'abc' });
    const k2 = derivePublishKey({ assessmentId: 1, briefVersionId: 3, policyVersionId: 2, rosterHash: 'abc' });
    expect(k1).toBe(k2);
    expect(k1).toHaveLength(40);
  });

  it('should change when roster changes (race dedupe)', () => {
    const k1 = derivePublishKey({ assessmentId: 1, briefVersionId: 3, policyVersionId: 2, rosterHash: rosterHash([{ user_id: 1 }, { user_id: 2 }]) });
    const k2 = derivePublishKey({ assessmentId: 1, briefVersionId: 3, policyVersionId: 2, rosterHash: rosterHash([{ user_id: 1 }]) });
    expect(k1).not.toBe(k2);
  });

  it('rosterHash should be order-independent', () => {
    expect(rosterHash([{ user_id: 1 }, { user_id: 2 }])).toBe(rosterHash([{ user_id: 2 }, { user_id: 1 }]));
  });
});

// ═══════════════════════════════════════════════════════════════════
// SERVICE (graceful degradation without PostgreSQL)
// ═══════════════════════════════════════════════════════════════════

describe('Publish — Service (graceful degradation)', () => {
  it('publishAssignment should reject without PostgreSQL', async () => {
    await expect(publishAssignment({ assessmentId: 1, items: [] })).rejects.toThrow('PostgreSQL required');
  });

  it('getAssignment should return null without PostgreSQL', async () => {
    expect(await getAssignment(1)).toBeNull();
  });

  it('listAssignments should return [] without PostgreSQL', async () => {
    expect(await listAssignments()).toEqual([]);
  });

  it('getAssignmentPublicItems should return [] without PostgreSQL', async () => {
    expect(await getAssignmentPublicItems(1)).toEqual([]);
  });

  it('getAssignmentPrivateScores should return [] without PostgreSQL', async () => {
    expect(await getAssignmentPrivateScores(1)).toEqual([]);
  });

  it('getAssignmentRoster should return [] without PostgreSQL', async () => {
    expect(await getAssignmentRoster(1)).toEqual([]);
  });

  it('getAssignmentNotifications should return [] without PostgreSQL', async () => {
    expect(await getAssignmentNotifications(1)).toEqual([]);
  });

  it('verifyAssignmentIntegrity should fail gracefully without PostgreSQL', async () => {
    const result = await verifyAssignmentIntegrity(1);
    expect(result.ok).toBe(false);
    expect(result.checks[0].check).toBe('postgres');
  });
});

// ═══════════════════════════════════════════════════════════════════
// BARREL EXPORT
// ═══════════════════════════════════════════════════════════════════

describe('Publish — Barrel Export', () => {
  it('should export all expected functions and constants', async () => {
    const mod = await import('../../src/modules/publish/index.js');
    const expected = [
      // schema
      'ASSIGNMENT_STATUS', 'ASSIGNMENT_STATUS_TRANSITIONS',
      'NOTIFICATION_TYPES', 'NOTIFICATION_SCOPES',
      'PUBLIC_ITEM_FIELDS', 'PRIVATE_KEY_FIELDS',
      'canonicalStringify', 'canonicalHash', 'scanForSecrets',
      'verifyPublicSnapshotClean', 'buildPublicItemSnapshot',
      'buildPrivateScoreSnapshot', 'buildRosterSnapshot',
      'planPublish', 'derivePublishKey', 'rosterHash',
      // service
      'publishAssignment', 'getAssignment', 'listAssignments',
      'getAssignmentPublicItems', 'getAssignmentPrivateScores',
      'getAssignmentRoster', 'getAssignmentNotifications',
      'verifyAssignmentIntegrity',
    ];
    for (const exp of expected) {
      expect(mod[exp], `Missing export: ${exp}`).toBeDefined();
    }
  });
});
