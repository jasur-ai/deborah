/**
 * Deborah — Attempt Lease, Identity Step & Server Timer Tests
 *
 * Covers (Prompt 30):
 *   - Identity level model: profile → required level, step-up satisfaction
 *   - Server-authoritative timing: started_at/ends_at computed on server only
 *   - Accommodation extra time: base + extra → total window
 *   - Public content package: allowlist rebuild, no private keys
 *   - Parallel-session policy: single active lease per (assignment, user)
 *   - Status lifecycle transitions (ready → in_progress → submitted|terminated)
 *   - Idempotency key derivation (assignment + user + day)
 *   - Attempt start eligibility contract (identity + preflight + parallel)
 *   - Service graceful degradation without PostgreSQL
 *   - Barrel export
 */

import { describe, it, expect } from 'vitest';

import {
  // schema (pure)
  ATTEMPT_STATUS,
  ATTEMPT_STATUS_TRANSITIONS,
  IDENTITY_LEVELS,
  IDENTITY_LEVEL_RANK,
  DEFAULT_IDENTITY_LEVEL,
  requiredIdentityLevelForProfile,
  identityLevelSatisfied,
  requiredIdentityLevelForPolicy,
  resolveIdentityLevelFromSession,
  computeAttemptTiming,
  computeRemainingSeconds,
  extractExtraTimeMinutes,
  buildPublicContentPackage,
  verifyContentPackageClean,
  evaluateParallelSessionPolicy,
  deriveAttemptKey,
  computeAttemptStartEligibility,
} from '../../src/modules/attempt/attempt.schema.js';

import {
  // service
  startAttempt,
  transitionAttempt,
  getAttempt,
  getAttemptPublicContent,
  listAttempts,
} from '../../src/modules/attempt/attempt.service.js';

// ═══════════════════════════════════════════════════════════════════
// CONSTANTS & IDENTITY LEVEL MODEL
// ═══════════════════════════════════════════════════════════════════

describe('Attempt — Constants & Identity Levels', () => {
  it('should have attempt status lifecycle (ready → in_progress → terminal)', () => {
    expect(ATTEMPT_STATUS.READY).toBe('ready');
    expect(ATTEMPT_STATUS.IN_PROGRESS).toBe('in_progress');
    expect(ATTEMPT_STATUS.SUBMITTED).toBe('submitted');
    expect(ATTEMPT_STATUS.TERMINATED).toBe('terminated');
    expect(ATTEMPT_STATUS_TRANSITIONS.ready).toContain('in_progress');
    expect(ATTEMPT_STATUS_TRANSITIONS.in_progress).toContain('submitted');
    expect(ATTEMPT_STATUS_TRANSITIONS.submitted).toEqual([]);
    expect(ATTEMPT_STATUS_TRANSITIONS.terminated).toEqual([]);
  });

  it('should order identity levels weakest → strongest', () => {
    expect(IDENTITY_LEVELS).toEqual(['none', 'password', 'google', 'passkey']);
    expect(IDENTITY_LEVEL_RANK.password).toBeGreaterThan(IDENTITY_LEVEL_RANK.none);
    expect(IDENTITY_LEVEL_RANK.passkey).toBeGreaterThan(IDENTITY_LEVEL_RANK.google);
    expect(DEFAULT_IDENTITY_LEVEL).toBe('none');
  });

  it('should map security profile to required identity level', () => {
    expect(requiredIdentityLevelForProfile('S0')).toBe('none');
    expect(requiredIdentityLevelForProfile('S1')).toBe('password');
    expect(requiredIdentityLevelForProfile('S2')).toBe('password');
    expect(requiredIdentityLevelForProfile('S3')).toBe('passkey');
    expect(requiredIdentityLevelForProfile('S4')).toBe('passkey');
    expect(requiredIdentityLevelForProfile()).toBe('none');
  });

  it('should satisfy identity requirements by achieved level', () => {
    expect(identityLevelSatisfied('none', null)).toBe(true);
    expect(identityLevelSatisfied('password', 'password')).toBe(true);
    expect(identityLevelSatisfied('password', 'google')).toBe(true); // stronger
    expect(identityLevelSatisfied('passkey', 'google')).toBe(false);
    expect(identityLevelSatisfied('passkey', 'passkey')).toBe(true);
    expect(identityLevelSatisfied('passkey', null)).toBe(false);
    expect(identityLevelSatisfied('password', 'none')).toBe(false);
  });

  it('should resolve identity requirement from a policy row', () => {
    expect(requiredIdentityLevelForPolicy({ security: { profile: 'S3' } })).toBe('passkey');
    expect(requiredIdentityLevelForPolicy({ policy: { security: { profile: 'S1' } } })).toBe('password');
    expect(requiredIdentityLevelForPolicy(null)).toBe('none');
    expect(requiredIdentityLevelForPolicy({})).toBe('none');
  });

  it('should resolve identity level from the SERVER session (never client body)', () => {
    expect(resolveIdentityLevelFromSession({ authProvider: 'google' })).toBe('google');
    expect(resolveIdentityLevelFromSession({ authMethod: 'passkey' })).toBe('passkey');
    expect(resolveIdentityLevelFromSession({ id: 1, username: 'student' })).toBe('password');
    expect(resolveIdentityLevelFromSession({ safeKey: 'student' })).toBe('password');
    expect(resolveIdentityLevelFromSession(null)).toBeNull();
    expect(resolveIdentityLevelFromSession({})).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════
// SERVER-AUTHORITATIVE TIMER + EXTRA TIME
// ═══════════════════════════════════════════════════════════════════

describe('Attempt — Server Timer & Extra Time', () => {
  const NOW = Date.UTC(2026, 8, 1, 9, 0, 0); // 2026-09-01T09:00:00Z

  it('should compute server-authoritative start/end from base duration', () => {
    const t = computeAttemptTiming({ baseMinutes: 60, extraMinutes: 0, now: NOW });
    expect(t.startedAt.toISOString()).toBe('2026-09-01T09:00:00.000Z');
    expect(t.endsAt.toISOString()).toBe('2026-09-01T10:00:00.000Z');
    expect(t.totalMinutes).toBe(60);
  });

  it('should add accommodation extra time to the total window', () => {
    const t = computeAttemptTiming({ baseMinutes: 60, extraMinutes: 25, now: NOW });
    expect(t.totalMinutes).toBe(85);
    expect(t.endsAt.toISOString()).toBe('2026-09-01T10:25:00.000Z');
  });

  it('should return null endsAt when there is no duration (unbounded)', () => {
    const t = computeAttemptTiming({ baseMinutes: 0, extraMinutes: 0, now: NOW });
    expect(t.endsAt).toBeNull();
    expect(t.totalMinutes).toBe(0);
  });

  it('should never allow negative durations (clamped)', () => {
    const t = computeAttemptTiming({ baseMinutes: -10, extraMinutes: -5, now: NOW });
    expect(t.totalMinutes).toBe(0);
    expect(t.baseMinutes).toBe(0);
    expect(t.extraMinutes).toBe(0);
  });

  it('should compute remaining seconds from server end time', () => {
    const endsAt = '2026-09-01T10:00:00.000Z';
    expect(computeRemainingSeconds(endsAt, NOW)).toBe(3600);
    expect(computeRemainingSeconds(endsAt, '2026-09-01T10:05:00.000Z')).toBe(0); // expired
    expect(computeRemainingSeconds(null, NOW)).toBeNull();
  });

  it('should extract extra time minutes from an operational config', () => {
    expect(extractExtraTimeMinutes({ extraTimeMinutes: 25 })).toBe(25);
    expect(extractExtraTimeMinutes({})).toBe(0);
    expect(extractExtraTimeMinutes(null)).toBe(0);
    expect(extractExtraTimeMinutes({ extraTimeMinutes: -3 })).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════
// PUBLIC CONTENT PACKAGE (no private keys)
// ═══════════════════════════════════════════════════════════════════

describe('Attempt — Public Content Package', () => {
  it('should rebuild a public package from public item snapshots', () => {
    const assignment = { id: 5, title: 'Midterm', version_hash: 'abc123' };
    const publicItems = [
      { item_id: 1, section_id: 2, section_title: 'S1', question_type: 'single_choice', difficulty: 'easy', points: 2, time_seconds: 60, sort_order: 0, item_hash: 'h1', public_data: { stem: 'Q1' } },
      { item_id: 2, section_id: 2, section_title: 'S1', question_type: 'single_choice', difficulty: 'medium', points: 3, time_seconds: 90, sort_order: 1, item_hash: 'h2', public_data: { stem: 'Q2' } },
    ];
    const pkg = buildPublicContentPackage(assignment, publicItems);
    expect(pkg.assignment_id).toBe(5);
    expect(pkg.version_hash).toBe('abc123');
    expect(pkg.item_count).toBe(2);
    expect(pkg.items[0].public_data).toEqual({ stem: 'Q1' });
    expect(pkg.items[0].points).toBe(2);
  });

  it('should be structurally clean — private keys cannot appear', () => {
    const pkg = buildPublicContentPackage({ id: 1, title: 'T', version_hash: 'v' }, [
      { item_id: 1, section_id: 1, question_type: 'single_choice', points: 1, sort_order: 0, item_hash: 'h', public_data: { stem: 'Q', options: [{ key: 'A', text: 'x' }] } },
    ]);
    const clean = verifyContentPackageClean(pkg);
    expect(clean.ok).toBe(true);
    expect(clean.leaks).toEqual([]);
  });

  it('should flag any nested private key if present (defense in depth)', () => {
    const pkg = buildPublicContentPackage({ id: 1, title: 'T', version_hash: 'v' }, [
      { item_id: 1, question_type: 'single_choice', points: 1, sort_order: 0, item_hash: 'h', public_data: { stem: 'Q', correctKey: 'A' } },
    ]);
    const clean = verifyContentPackageClean(pkg);
    expect(clean.ok).toBe(false);
    expect(clean.leaks.length).toBeGreaterThan(0);
  });
});

// ═══════════════════════════════════════════════════════════════════
// PARALLEL SESSION POLICY + IDEMPOTENCY
// ═══════════════════════════════════════════════════════════════════

describe('Attempt — Parallel Session & Idempotency', () => {
  it('should allow start when no active lease exists', () => {
    const r = evaluateParallelSessionPolicy([]);
    expect(r.allowed).toBe(true);
    expect(r.reason).toBeNull();
  });

  it('should deny a second active lease (parallel session stop condition)', () => {
    const r = evaluateParallelSessionPolicy([{ id: 7, status: 'active' }]);
    expect(r.allowed).toBe(false);
    expect(r.existingLeaseId).toBe(7);
    // Released leases do not block a new start
    const released = evaluateParallelSessionPolicy([{ id: 7, status: 'released' }]);
    expect(released.allowed).toBe(true);
  });

  it('should derive a deterministic per-day idempotency key', () => {
    const now = Date.UTC(2026, 8, 1, 9, 0, 0);
    expect(deriveAttemptKey(5, 10, now)).toBe(deriveAttemptKey(5, 10, now));
    expect(deriveAttemptKey(5, 10, now)).not.toBe(deriveAttemptKey(5, 10, Date.UTC(2026, 8, 2)));
    expect(deriveAttemptKey(5, 10, now)).not.toBe(deriveAttemptKey(6, 10, now));
    expect(deriveAttemptKey(5, 10, now)).toMatch(/^[a-f0-9]{40}$/);
  });
});

// ═══════════════════════════════════════════════════════════════════
// ATTEMPT START ELIGIBILITY CONTRACT
// ═══════════════════════════════════════════════════════════════════

describe('Attempt — Start Eligibility Contract', () => {
  it('should allow start when all gates pass', () => {
    const r = computeAttemptStartEligibility({
      identityRequired: 'password',
      identityAchieved: 'google',
      preflightExists: true,
      preflightEligible: true,
      parallelAllowed: true,
    });
    expect(r.canStart).toBe(true);
    expect(r.blockers).toEqual([]);
  });

  it('should block when identity step-up is not satisfied', () => {
    const r = computeAttemptStartEligibility({
      identityRequired: 'passkey',
      identityAchieved: 'password',
      preflightExists: true,
      preflightEligible: true,
      parallelAllowed: true,
    });
    expect(r.canStart).toBe(false);
    expect(r.blockers.some((b) => b.code === 'identity_step_up_required')).toBe(true);
  });

  it('should block when preflight is missing or not eligible', () => {
    const missing = computeAttemptStartEligibility({ preflightExists: false });
    expect(missing.blockers.some((b) => b.code === 'preflight_required')).toBe(true);
    const ineligible = computeAttemptStartEligibility({ preflightExists: true, preflightEligible: false });
    expect(ineligible.blockers.some((b) => b.code === 'preflight_not_eligible')).toBe(true);
  });

  it('should block when a parallel session already exists', () => {
    const r = computeAttemptStartEligibility({ parallelAllowed: false });
    expect(r.blockers.some((b) => b.code === 'parallel_session_denied')).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════
// SERVICE — GRACEFUL DEGRADATION & BARREL
// ═══════════════════════════════════════════════════════════════════

describe('Attempt — Service Graceful Degradation & Barrel', () => {
  it('should expose all service functions', async () => {
    const mod = await import('../../src/modules/attempt/index.js');
    for (const exp of ['startAttempt', 'transitionAttempt', 'getAttempt', 'getAttemptPublicContent', 'listAttempts']) {
      expect(typeof mod[exp], exp).toBe('function');
    }
  });

  it('should throw PostgreSQL required for write paths without PG', async () => {
    await expect(startAttempt({ assignmentId: 1, userId: 1 })).rejects.toThrow('PostgreSQL required');
    await expect(transitionAttempt(1, 'in_progress', 1)).rejects.toThrow('PostgreSQL required');
  });

  it('should degrade gracefully for read paths without PG', async () => {
    const attempt = await getAttempt(1, 1);
    expect(attempt).toBeNull();
    const content = await getAttemptPublicContent(1, 1);
    expect(content).toBeNull();
    const list = await listAttempts(1, 1);
    expect(Array.isArray(list)).toBe(true);
  });
});
