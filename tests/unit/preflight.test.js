/**
 * Deborah — Student Preflight Tests
 *
 * Covers (Prompt 28):
 *   - Constants: availability statuses, preflight statuses, blocker codes/messages, device checks
 *   - Availability window (4 states + boundaries)
 *   - Roster authorization: UNASSIGNED access testi (§18) — snapshot-based,
 *     no silent re-sync with live roster (§24)
 *   - Student-facing sanitizers: whitelist brief/policy render — answer keys
 *     structurally impossible (§15); brief/version authorization contract (§19)
 *   - Browser/device/network capability check
 *   - Camera/SEB requirement hook
 *   - Practice requirement & status
 *   - Start eligibility: full preflight contract — all blocker scenarios +
 *     all-pass eligible (§25); device/preflight E2E-style scenario (§20)
 *   - Idempotency key derivation
 *   - Service graceful degradation without PostgreSQL
 *   - Barrel export
 */

import { describe, it, expect } from 'vitest';

import {
  // schema (pure)
  AVAILABILITY_STATUS,
  PREFLIGHT_STATUS,
  BLOCKER_CODES,
  BLOCKER_MESSAGES,
  DEVICE_CHECKS,
  MIN_SCREEN,
  SUPPORTED_BROWSERS,
  computeAvailabilityWindow,
  checkRosterMembership,
  scanForForbiddenStudentKeys,
  sanitizeBriefForStudent,
  sanitizePolicyForStudent,
  detectBrowser,
  buildDeviceCheck,
  buildSecurityCheck,
  buildPracticeRequirement,
  buildPracticeStatus,
  computeStartEligibility,
  derivePreflightKey,
} from '../../src/modules/preflight/preflight.schema.js';

import {
  // service
  getStudentAssignments,
  getStudentAssignmentBrief,
  runPreflight,
  getPreflightStatus,
  listStudentPreflights,
  buildPreflightContext,
} from '../../src/modules/preflight/preflight.service.js';

// ═══════════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════════

describe('Preflight — Constants', () => {
  it('should define the 4 availability statuses', () => {
    expect(AVAILABILITY_STATUS.NOT_STARTED).toBe('not_started');
    expect(AVAILABILITY_STATUS.OPEN).toBe('open');
    expect(AVAILABILITY_STATUS.CLOSED).toBe('closed');
    expect(AVAILABILITY_STATUS.UNSCHEDULED).toBe('unscheduled');
  });

  it('should define preflight statuses (passed/blocked/pending)', () => {
    expect(PREFLIGHT_STATUS.PASSED).toBe('passed');
    expect(PREFLIGHT_STATUS.BLOCKED).toBe('blocked');
    expect(PREFLIGHT_STATUS.PENDING).toBe('pending');
  });

  it('should define blocker codes with messages for every code', () => {
    expect(BLOCKER_CODES.NOT_ASSIGNED).toBe('not_assigned');
    expect(BLOCKER_CODES.DEVICE_UNSUPPORTED).toBe('device_unsupported');
    expect(BLOCKER_CODES.CAMERA_REQUIRED).toBe('camera_required');
    expect(BLOCKER_CODES.SEB_REQUIRED).toBe('seb_required');
    for (const code of Object.values(BLOCKER_CODES)) {
      expect(typeof BLOCKER_MESSAGES[code], `message for ${code}`).toBe('string');
    }
  });

  it('should define device check names + min screen + supported browsers', () => {
    expect(DEVICE_CHECKS.BROWSER).toBe('browser_supported');
    expect(DEVICE_CHECKS.ONLINE).toBe('online');
    expect(MIN_SCREEN.width).toBeGreaterThan(0);
    expect(SUPPORTED_BROWSERS.length).toBeGreaterThan(0);
  });
});

// ═══════════════════════════════════════════════════════════════════
// AVAILABILITY WINDOW
// ═══════════════════════════════════════════════════════════════════

describe('Preflight — availability window', () => {
  const START = '2026-09-01T09:00:00Z';
  const END = '2026-09-01T11:00:00Z';

  it('should be not_started before the window', () => {
    const r = computeAvailabilityWindow({ startAt: START, endAt: END, now: '2026-09-01T08:00:00Z' });
    expect(r.status).toBe(AVAILABILITY_STATUS.NOT_STARTED);
  });

  it('should be open inside the window (inclusive boundaries)', () => {
    expect(computeAvailabilityWindow({ startAt: START, endAt: END, now: START }).status).toBe(AVAILABILITY_STATUS.OPEN);
    expect(computeAvailabilityWindow({ startAt: START, endAt: END, now: '2026-09-01T10:00:00Z' }).status).toBe(AVAILABILITY_STATUS.OPEN);
    expect(computeAvailabilityWindow({ startAt: START, endAt: END, now: END }).status).toBe(AVAILABILITY_STATUS.OPEN);
  });

  it('should be closed after the window', () => {
    const r = computeAvailabilityWindow({ startAt: START, endAt: END, now: '2026-09-01T12:00:00Z' });
    expect(r.status).toBe(AVAILABILITY_STATUS.CLOSED);
  });

  it('should be unscheduled when no window is set', () => {
    const r = computeAvailabilityWindow({ startAt: null, endAt: null, now: Date.now() });
    expect(r.status).toBe(AVAILABILITY_STATUS.UNSCHEDULED);
    expect(r.window.start).toBeNull();
  });

  it('should return ISO window + now timestamps (toISOString → ms precision)', () => {
    const r = computeAvailabilityWindow({ startAt: START, endAt: END, now: '2026-09-01T10:00:00Z' });
    expect(r.window.start).toBe('2026-09-01T09:00:00.000Z');
    expect(r.window.end).toBe('2026-09-01T11:00:00.000Z');
    expect(r.now).toBe('2026-09-01T10:00:00.000Z');
  });
});

// ═══════════════════════════════════════════════════════════════════
// ROSTER AUTHORIZATION — UNASSIGNED ACCESS TEST (§18)
// ═══════════════════════════════════════════════════════════════════

describe('Preflight — roster authorization (unassigned access test)', () => {
  const roster = [
    { user_id: 1, group_id: 10 },
    { user_id: 2, group_id: 10 },
    { user_id: 3, group_id: 11 },
  ];

  it('should authorize a user present in the PUBLISHED roster snapshot', () => {
    const r = checkRosterMembership(roster, 2);
    expect(r.in_snapshot).toBe(true);
    expect(r.snapshot_count).toBe(3);
  });

  it('should DENY a user not in the snapshot (unassigned access test)', () => {
    const r = checkRosterMembership(roster, 99);
    expect(r.in_snapshot).toBe(false);
  });

  it('should deny everyone on an empty snapshot', () => {
    expect(checkRosterMembership([], 1).in_snapshot).toBe(false);
  });

  it('should not be affected by the live roster (snapshot wins — §24 no silent re-sync)', () => {
    // Even though userId 4 exists "live", the snapshot is authoritative:
    const r = checkRosterMembership(roster, 4);
    expect(r.in_snapshot).toBe(false);
  });

  it('unassigned user gets not_assigned blocker in the eligibility contract', () => {
    const result = computeStartEligibility({
      availability: { status: 'open' },
      roster: { in_snapshot: false },
      brief: { available: true },
      policy: { available: true },
      practice: { required: false, completed: true },
      device: { ok: true, checks: [] },
      security: { camera_required: false, camera_ok: true, seb_required: false, seb_ok: true },
    });
    expect(result.eligible).toBe(false);
    expect(result.blockers.map((b) => b.code)).toContain(BLOCKER_CODES.NOT_ASSIGNED);
  });
});

// ═══════════════════════════════════════════════════════════════════
// STUDENT-FACING SANITIZERS — BRIEF/VERSION AUTHORIZATION (§19, §15)
// ═══════════════════════════════════════════════════════════════════

describe('Preflight — brief/policy sanitizers (answer-key guard)', () => {
  const rawBrief = {
    version: 3,
    ai_use_level: 'A2',
    content: {
      learning_outcomes: [{ code: 'LO1', text: 'Algebra tenglamalarni yechish' }, 'LO2 matn'],
      duration_minutes: 120,
      submission_format: 'electron',
      materials: [{ title: 'Darslik 1' }, 'Slaydlar'],
      late_policy: { allowed: true, max_days: 2 },
      resit_policy: { allowed: true, max_attempts: 2 },
      answer_key: { q1: 'A' }, // attempt to smuggle — must be stripped
      scoring_rubric: { q1: 'rubric' }, // must be stripped
    },
  };

  it('should whitelist only pedagogic fields — answer keys structurally impossible', () => {
    const r = sanitizeBriefForStudent(rawBrief);
    expect(r.available).toBe(true);
    expect(r.version).toBe(3);
    expect(r.ai_use_level).toBe('A2');
    expect(r.sanitized_content.learning_outcomes).toEqual(['Algebra tenglamalarni yechish', 'LO2 matn']);
    expect(r.sanitized_content.duration_minutes).toBe(120);
    expect(r.sanitized_content.materials).toEqual(['Darslik 1', 'Slaydlar']);
    expect(r.sanitized_content.answer_key).toBeUndefined();
    expect(r.sanitized_content.scoring_rubric).toBeUndefined();
    expect(r.leaks).toEqual([]); // sanitized surface is clean
  });

  it('should report unavailable for a missing brief (authorization contract)', () => {
    const r = sanitizeBriefForStudent(null);
    expect(r.available).toBe(false);
    expect(r.version).toBeNull();
  });

  it('should scan for forbidden keys recursively', () => {
    const hits = scanForForbiddenStudentKeys({ public: { private_data: { correctKey: 'B' } }, answer_key: 'x' });
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.some((h) => h.key === 'private_data')).toBe(true);
  });

  const rawPolicy = {
    version: 2,
    policy: {
      security: { profile: 'S2', max_strikes: 3, allow_camera: false, require_seb: true },
      late: { allowed: true, max_days: 2 },
      resit: { allowed: true, max_attempts: 1 },
      ai_use: { level: 'A0' },
      retention_days: 3650, // institution-internal — must be dropped
      marking: { mode: 'auto', internal_rubric: 'x' }, // must be dropped
      metadata: { internal_note: 'secret' }, // must be dropped
    },
  };

  it('should expose only security requirements — retention/marking/metadata dropped', () => {
    const r = sanitizePolicyForStudent(rawPolicy);
    expect(r.available).toBe(true);
    expect(r.version).toBe(2);
    expect(r.security).toEqual({ profile: 'S2', max_strikes: 3, allow_camera: false, require_seb: true });
    expect(r.late).toEqual({ allowed: true, max_days: 2 });
    expect(r.resit).toEqual({ allowed: true, max_attempts: 1 });
    expect(r.ai_use).toEqual({ level: 'A0' });
    expect(r.leaks).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════
// DEVICE / BROWSER / NETWORK CAPABILITY
// ═══════════════════════════════════════════════════════════════════

describe('Preflight — device/browser/network capability check', () => {
  it('should detect supported browsers', () => {
    expect(detectBrowser('Mozilla/5.0 (Windows NT 10.0) Chrome/120.0')).toBe('chrome');
    expect(detectBrowser('Mozilla/5.0 (X11) Firefox/121.0')).toBe('firefox');
    expect(detectBrowser('Mozilla/5.0 (Macintosh) Safari/605.1')).toBe('safari');
    expect(detectBrowser('Mozilla/5.0 (Windows NT 10.0) Edg/120.0')).toBe('edge');
  });

  it('should not confuse Safari UA that embeds Chrome', () => {
    expect(detectBrowser('Mozilla/5.0 (Macintosh) AppleWebKit/605.1.15 (KHTML, like Gecko) Chrome/120.0 Safari/605.1.15')).toBe('chrome');
  });

  it('should reject unknown browsers', () => {
    expect(detectBrowser('Lynx/2.8.9')).toBeNull();
    expect(detectBrowser('')).toBeNull();
  });

  it('should pass a fully capable client', () => {
    const r = buildDeviceCheck({
      userAgent: 'Chrome/120.0',
      screenWidth: 1440,
      screenHeight: 900,
      online: true,
      connectionType: 'wifi',
      connectionDownlink: 10,
    });
    expect(r.ok).toBe(true);
    expect(r.checks.every((c) => c.ok)).toBe(true);
  });

  it('should fail on offline client', () => {
    const r = buildDeviceCheck({ userAgent: 'Chrome/120.0', screenWidth: 1440, screenHeight: 900, online: false });
    expect(r.ok).toBe(false);
    expect(r.checks.find((c) => c.name === DEVICE_CHECKS.ONLINE).ok).toBe(false);
  });

  it('should fail on too-small screen when screen size is known', () => {
    const r = buildDeviceCheck({ userAgent: 'Chrome/120.0', screenWidth: 300, screenHeight: 200, online: true });
    expect(r.ok).toBe(false);
    expect(r.checks.find((c) => c.name === DEVICE_CHECKS.SCREEN).ok).toBe(false);
  });

  it('should allow unknown screen/network (not fail-closed on missing info)', () => {
    const r = buildDeviceCheck({ userAgent: 'Chrome/120.0', online: true });
    expect(r.ok).toBe(true);
    expect(r.checks.find((c) => c.name === DEVICE_CHECKS.SCREEN).detail).toContain('unknown');
  });

  it('should fail on slow-2g network', () => {
    const r = buildDeviceCheck({ userAgent: 'Chrome/120.0', online: true, connectionType: 'slow-2g' });
    expect(r.ok).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════
// CAMERA / SEB REQUIREMENT HOOK
// ═══════════════════════════════════════════════════════════════════

describe('Preflight — camera/SEB requirement hook', () => {
  it('should not require camera/SEB when policy allows (default)', () => {
    const r = buildSecurityCheck({ allow_camera: true, require_seb: false }, {});
    expect(r.camera_required).toBe(false);
    expect(r.seb_required).toBe(false);
    expect(r.camera_ok).toBe(true);
    expect(r.seb_ok).toBe(true);
  });

  it('should require camera when allow_camera is false and pass when camera present', () => {
    const r = buildSecurityCheck({ allow_camera: false }, { cameraAvailable: true });
    expect(r.camera_required).toBe(true);
    expect(r.camera_ok).toBe(true);
  });

  it('should BLOCK when camera is required but missing (camera_required blocker)', () => {
    const sec = buildSecurityCheck({ allow_camera: false }, { cameraAvailable: false });
    expect(sec.camera_ok).toBe(false);
    const result = computeStartEligibility({
      availability: { status: 'open' },
      roster: { in_snapshot: true },
      brief: { available: true },
      policy: { available: true },
      practice: { required: false, completed: true },
      device: { ok: true, checks: [] },
      security: sec,
    });
    expect(result.blockers.map((b) => b.code)).toContain(BLOCKER_CODES.CAMERA_REQUIRED);
  });

  it('should require SEB when require_seb is true', () => {
    const ok = buildSecurityCheck({ require_seb: true }, { sebPresent: true });
    expect(ok.seb_required).toBe(true);
    expect(ok.seb_ok).toBe(true);
    const blocked = buildSecurityCheck({ require_seb: true }, { sebPresent: false });
    expect(blocked.seb_ok).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════
// PRACTICE REQUIREMENT & STATUS
// ═══════════════════════════════════════════════════════════════════

describe('Preflight — practice requirement & status', () => {
  it('should default to not required', () => {
    expect(buildPracticeRequirement({}, {}).required).toBe(false);
  });

  it('should read practice_required from brief content', () => {
    const req = buildPracticeRequirement({ content: { practice_required: true, practice_description: 'Kamida 1 marta mashq' } }, {});
    expect(req.required).toBe(true);
    expect(req.description).toBe('Kamida 1 marta mashq');
  });

  it('should read practice requirement from policy', () => {
    const req = buildPracticeRequirement({}, { policy: { practice: { required: true } } });
    expect(req.required).toBe(true);
  });

  it('should be complete when not required', () => {
    const s = buildPracticeStatus({ required: false }, {});
    expect(s.completed).toBe(true);
    expect(s.progress).toBe(1);
  });

  it('should be blocked when required but not completed (practice_required blocker)', () => {
    const req = buildPracticeRequirement({ content: { practice_required: true } }, {});
    const s = buildPracticeStatus(req, { completed_runs: 0, required_runs: 1 });
    expect(s.completed).toBe(false);
    const result = computeStartEligibility({
      availability: { status: 'open' },
      roster: { in_snapshot: true },
      brief: { available: true },
      policy: { available: true },
      practice: s,
      device: { ok: true, checks: [] },
      security: { camera_required: false, camera_ok: true, seb_required: false, seb_ok: true },
    });
    expect(result.blockers.map((b) => b.code)).toContain(BLOCKER_CODES.PRACTICE_REQUIRED);
  });

  it('should pass when required runs completed', () => {
    const req = buildPracticeRequirement({ content: { practice_required: true } }, {});
    const s = buildPracticeStatus(req, { completed_runs: 2, required_runs: 1 });
    expect(s.completed).toBe(true);
    expect(s.progress).toBe(1);
  });
});

// ═══════════════════════════════════════════════════════════════════
// START ELIGIBILITY — FULL PREFLIGHT CONTRACT (§25)
// ═══════════════════════════════════════════════════════════════════

describe('Preflight — start eligibility contract (device/preflight E2E scenarios)', () => {
  const basePass = {
    availability: { status: 'open' },
    roster: { in_snapshot: true },
    brief: { available: true },
    policy: { available: true },
    practice: { required: false, completed: true },
    device: { ok: true, checks: [] },
    security: { camera_required: false, camera_ok: true, seb_required: false, seb_ok: true },
    accommodation: { required: false, confirmed: false },
  };

  it('should be eligible when every requirement passes', () => {
    const r = computeStartEligibility(basePass);
    expect(r.eligible).toBe(true);
    expect(r.blockers).toEqual([]);
  });

  it('should list EVERY blocker at once — student sees all before start (done condition)', () => {
    const r = computeStartEligibility({
      availability: { status: 'closed' },
      roster: { in_snapshot: false },
      brief: { available: false },
      policy: { available: false },
      practice: { required: true, completed: false },
      device: { ok: false, checks: [{ name: DEVICE_CHECKS.BROWSER, ok: false, detail: 'unsupported' }] },
      security: { camera_required: true, camera_ok: false, seb_required: true, seb_ok: false },
      accommodation: { required: true, confirmed: false },
    });
    expect(r.eligible).toBe(false);
    const codes = r.blockers.map((b) => b.code);
    expect(codes).toContain(BLOCKER_CODES.NOT_ASSIGNED);
    expect(codes).toContain(BLOCKER_CODES.CLOSED);
    expect(codes).toContain(BLOCKER_CODES.BRIEF_UNAVAILABLE);
    expect(codes).toContain(BLOCKER_CODES.POLICY_UNAVAILABLE);
    expect(codes).toContain(BLOCKER_CODES.PRACTICE_REQUIRED);
    expect(codes).toContain(BLOCKER_CODES.DEVICE_UNSUPPORTED);
    expect(codes).toContain(BLOCKER_CODES.CAMERA_REQUIRED);
    expect(codes).toContain(BLOCKER_CODES.SEB_REQUIRED);
    expect(codes).toContain(BLOCKER_CODES.ACCOMMODATION_UNCONFIRMED);
  });

  it('should block before the window opens', () => {
    const r = computeStartEligibility({ ...basePass, availability: { status: 'not_started' } });
    expect(r.blockers.map((b) => b.code)).toContain(BLOCKER_CODES.NOT_STARTED);
  });

  it('should block on unscheduled assignments', () => {
    const r = computeStartEligibility({ ...basePass, availability: { status: 'unscheduled' } });
    expect(r.blockers.map((b) => b.code)).toContain(BLOCKER_CODES.UNSCHEDULED);
  });

  it('should require accommodation confirmation when snapshots exist', () => {
    const r = computeStartEligibility({ ...basePass, accommodation: { required: true, confirmed: false } });
    expect(r.blockers.map((b) => b.code)).toContain(BLOCKER_CODES.ACCOMMODATION_UNCONFIRMED);
    const ok = computeStartEligibility({ ...basePass, accommodation: { required: true, confirmed: true } });
    expect(ok.eligible).toBe(true);
  });

  it('should surface non-blocking warnings', () => {
    const r = computeStartEligibility({
      ...basePass,
      device: { ok: true, checks: [{ name: DEVICE_CHECKS.SCREEN, ok: true, detail: 'screen size unknown (allowed)' }] },
    });
    expect(r.eligible).toBe(true);
    expect(r.warnings.length).toBeGreaterThan(0);
  });
});

// ═══════════════════════════════════════════════════════════════════
// IDEMPOTENCY KEY
// ═══════════════════════════════════════════════════════════════════

describe('Preflight — idempotency key', () => {
  it('should be deterministic for the same assignment+user+day', () => {
    const k1 = derivePreflightKey(5, 7, '2026-09-01T10:00:00Z');
    const k2 = derivePreflightKey(5, 7, '2026-09-01T23:59:00Z');
    expect(k1).toBe(k2);
    expect(k1).toHaveLength(32);
  });

  it('should change across days and inputs', () => {
    expect(derivePreflightKey(5, 7, '2026-09-01T10:00:00Z')).not.toBe(derivePreflightKey(5, 7, '2026-09-02T10:00:00Z'));
    expect(derivePreflightKey(5, 7, '2026-09-01T10:00:00Z')).not.toBe(derivePreflightKey(6, 7, '2026-09-01T10:00:00Z'));
  });
});

// ═══════════════════════════════════════════════════════════════════
// PURE CONTEXT BUILDER (integration-style)
// ═══════════════════════════════════════════════════════════════════

describe('Preflight — buildPreflightContext (contract assembly)', () => {
  const assignment = { id: 42, title: 'Math Final', status: 'scheduled', version_hash: 'abc123' };
  const roster = [{ user_id: 7 }, { user_id: 8 }];
  const briefVersion = {
    version: 3,
    ai_use_level_snapshot: 'A0',
    content_snapshot: { learning_outcomes: ['LO'], duration_minutes: 60, submission_format: 'electron' },
  };
  const policyVersion = {
    version: 2,
    policy_snapshot: { security: { allow_camera: false, require_seb: true } },
  };

  it('should assemble availability + roster + sanitized brief/policy + accommodation', () => {
    const ctx = buildPreflightContext({
      assignment,
      roster,
      calendarEvent: { start_at: '2026-09-01T09:00:00Z', end_at: '2026-09-01T11:00:00Z' },
      briefRow: null,
      briefVersion,
      policyRow: null,
      policyVersion,
      accommodationSnapshots: [{ snapshot_config: { extraMinutes: 30 } }],
      opts: { userId: 7, now: '2026-09-01T10:00:00Z' },
    });
    expect(ctx.assignment_id).toBe(42);
    expect(ctx.availability.status).toBe('open');
    expect(ctx.roster.in_snapshot).toBe(true);
    expect(ctx.brief.available).toBe(true);
    expect(ctx.brief.version).toBe(3);
    expect(ctx.policy.security.require_seb).toBe(true);
    expect(ctx.accommodation.required).toBe(true);
    expect(ctx.accommodation.snapshot_count).toBe(1);
  });

  it('should mark a non-snapshot user as not assigned', () => {
    const ctx = buildPreflightContext({
      assignment,
      roster,
      calendarEvent: null,
      briefVersion,
      policyVersion,
      accommodationSnapshots: [],
      opts: { userId: 99 },
    });
    expect(ctx.roster.in_snapshot).toBe(false);
    expect(ctx.availability.status).toBe('unscheduled');
  });
});

// ═══════════════════════════════════════════════════════════════════
// SERVICE — GRACEFUL DEGRADATION WITHOUT POSTGRESQL
// ═══════════════════════════════════════════════════════════════════

describe('Preflight — service graceful degradation (no PostgreSQL)', () => {
  it('getStudentAssignments should return [] without PostgreSQL', async () => {
    expect(await getStudentAssignments(1)).toEqual([]);
  });

  it('getStudentAssignmentBrief should return null without PostgreSQL', async () => {
    expect(await getStudentAssignmentBrief(1, 1)).toBeNull();
  });

  it('runPreflight should reject without PostgreSQL', async () => {
    await expect(runPreflight({ assignmentId: 1, userId: 1 })).rejects.toThrow('PostgreSQL required');
  });

  it('getPreflightStatus should return null without PostgreSQL', async () => {
    expect(await getPreflightStatus(1, 1)).toBeNull();
  });

  it('listStudentPreflights should return [] without PostgreSQL', async () => {
    expect(await listStudentPreflights(1)).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════
// BARREL EXPORT
// ═══════════════════════════════════════════════════════════════════

describe('Preflight — Barrel Export', () => {
  it('should export all expected functions and constants', async () => {
    const mod = await import('../../src/modules/preflight/index.js');
    const expected = [
      // schema
      'AVAILABILITY_STATUS', 'PREFLIGHT_STATUS', 'BLOCKER_CODES', 'BLOCKER_MESSAGES',
      'DEVICE_CHECKS', 'MIN_SCREEN', 'SUPPORTED_BROWSERS', 'FORBIDDEN_STUDENT_KEYS',
      'DEFAULT_AI_USE_LEVEL', 'computeAvailabilityWindow', 'checkRosterMembership',
      'scanForForbiddenStudentKeys', 'sanitizeBriefForStudent', 'sanitizePolicyForStudent',
      'detectBrowser', 'buildDeviceCheck', 'buildSecurityCheck',
      'buildPracticeRequirement', 'buildPracticeStatus', 'computeStartEligibility',
      'derivePreflightKey',
      // service
      'getStudentAssignments', 'getStudentAssignmentBrief', 'runPreflight',
      'getPreflightStatus', 'listStudentPreflights', 'buildPreflightContext',
      'confirmStudentAccommodation',
    ];
    for (const exp of expected) {
      expect(mod[exp], `Missing export: ${exp}`).toBeDefined();
    }
  });
});
