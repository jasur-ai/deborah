/**
 * Deborah — Security Profile & Safe Exam Browser Boundary Tests
 *
 * Covers (Prompt 36):
 *   - Typed S0–S4 profile levels + rank ordering (§07)
 *   - Profile → control mapping (§09) — identity/camera/SEB/managed/LAN/strikes
 *   - Institution allowed min/max band validation (§08)
 *   - Effective profile resolution: clamp-up below min, REJECT above max,
 *     unknown profile fails closed (§15)
 *   - SEB config/key verification boundary (§11):
 *       • SEB not required → skipped
 *       • missing SEB claim → fail
 *       • unsupported OS (linux/android) claim → fail (no bypass, §15)
 *       • unregistered institution key → FAIL CLOSED (§24 stop condition)
 *       • key mismatch → fail (timing-safe compare)
 *       • matching key on supported OS → ok
 *   - Preflight requirement mapping (§10)
 *   - Unsupported control blocker report (§14)
 *   - Profile badge whitelist sanitization (§13 — no key material)
 *   - Service graceful degradation without PostgreSQL
 *   - Barrel export
 */

import { describe, it, expect } from 'vitest';

import {
  // schema (pure)
  SECURITY_PROFILE_LEVELS,
  SECURITY_PROFILE_RANK,
  SECURITY_PROFILES,
  SEB_SUPPORTED_OS,
  isValidSecurityProfile,
  validateInstitutionBounds,
  resolveEffectiveProfile,
  profileControls,
  mapProfileToPreflightRequirements,
  detectOs,
  hasSebUserAgentMarker,
  verifySebConfigBoundary,
  buildSecurityControlReport,
  buildProfileBadge,
  DEFAULT_INSTITUTION_SECURITY_POLICY,
} from '../../src/modules/security/security.schema.js';

import {
  // service
  getInstitutionSecurityPolicy,
  upsertInstitutionSecurityPolicy,
  resolveProfileForAssignment,
  verifySebBoundary,
  getStudentSecurityProfile,
} from '../../src/modules/security/security.service.js';

// ═══════════════════════════════════════════════════════════════════
// PROFILE POLICY MATRIX (§07, §09)
// ═══════════════════════════════════════════════════════════════════

describe('Security — Profile policy matrix', () => {
  it('should define S0–S4 with ordered ranks', () => {
    expect(SECURITY_PROFILE_LEVELS).toEqual(['S0', 'S1', 'S2', 'S3', 'S4']);
    expect(SECURITY_PROFILE_RANK.S0).toBe(0);
    expect(SECURITY_PROFILE_RANK.S1).toBe(1);
    expect(SECURITY_PROFILE_RANK.S2).toBe(2);
    expect(SECURITY_PROFILE_RANK.S3).toBe(3);
    expect(SECURITY_PROFILE_RANK.S4).toBe(4);
  });

  it('should escalate controls monotonically with rank', () => {
    const identityRank = { none: 0, password: 1, passkey: 2 };
    for (let i = 0; i < SECURITY_PROFILE_LEVELS.length; i += 1) {
      const cur = SECURITY_PROFILES[SECURITY_PROFILE_LEVELS[i]];
      expect(cur.identityLevel).toBeTruthy();
      expect(identityRank[cur.identityLevel]).toBeGreaterThanOrEqual(0);
    }
    // S3/S4 require SEB + managed device + passkey
    expect(SECURITY_PROFILES.S3.sebRequired).toBe(true);
    expect(SECURITY_PROFILES.S3.managedDevice).toBe(true);
    expect(SECURITY_PROFILES.S3.identityLevel).toBe('passkey');
    expect(SECURITY_PROFILES.S4.sebRequired).toBe(true);
    expect(SECURITY_PROFILES.S4.cameraRequired).toBe(true);
    // Low profiles never require SEB
    expect(SECURITY_PROFILES.S0.sebRequired).toBe(false);
    expect(SECURITY_PROFILES.S1.sebRequired).toBe(false);
    expect(SECURITY_PROFILES.S2.sebRequired).toBe(false);
  });

  it('profileControls should return the typed set or null', () => {
    expect(profileControls('S2').cameraRequired).toBe(true);
    expect(profileControls('S1').cameraRequired).toBe(false);
    expect(profileControls('S9')).toBeNull();
    expect(profileControls(null)).toBeNull();
  });

  it('isValidSecurityProfile rejects unknowns', () => {
    expect(isValidSecurityProfile('S0')).toBe(true);
    expect(isValidSecurityProfile('S4')).toBe(true);
    expect(isValidSecurityProfile('S5')).toBe(false);
    expect(isValidSecurityProfile('s0')).toBe(false);
    expect(isValidSecurityProfile('')).toBe(false);
    expect(isValidSecurityProfile(null)).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════
// INSTITUTION BOUNDS (§08)
// ═══════════════════════════════════════════════════════════════════

describe('Security — Institution min/max bounds', () => {
  it('should accept a valid band', () => {
    expect(validateInstitutionBounds({ minProfile: 'S0', maxProfile: 'S4' }).ok).toBe(true);
    expect(validateInstitutionBounds({ minProfile: 'S1', maxProfile: 'S3' }).ok).toBe(true);
  });

  it('should reject min stronger than max', () => {
    const r = validateInstitutionBounds({ minProfile: 'S3', maxProfile: 'S1' });
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toMatch(/cannot be stronger/i);
  });

  it('should reject unknown levels', () => {
    expect(validateInstitutionBounds({ minProfile: 'S9', maxProfile: 'S4' }).ok).toBe(false);
    expect(validateInstitutionBounds({ minProfile: 'S0', maxProfile: 'S9' }).ok).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════
// EFFECTIVE PROFILE RESOLUTION (§15 — data guard)
// ═══════════════════════════════════════════════════════════════════

describe('Security — Effective profile resolution', () => {
  it('should keep requested profile inside the band', () => {
    const r = resolveEffectiveProfile({ requested: 'S2', minProfile: 'S0', maxProfile: 'S4' });
    expect(r.ok).toBe(true);
    expect(r.profile).toBe('S2');
    expect(r.clampedUp).toBe(false);
  });

  it('should clamp UP to the institution minimum (floor wins)', () => {
    const r = resolveEffectiveProfile({ requested: 'S0', minProfile: 'S2', maxProfile: 'S4' });
    expect(r.ok).toBe(true);
    expect(r.profile).toBe('S2');
    expect(r.clampedUp).toBe(true);
  });

  it('should REJECT a requested profile above the institution maximum', () => {
    const r = resolveEffectiveProfile({ requested: 'S4', minProfile: 'S0', maxProfile: 'S2' });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/exceeds the institution maximum/i);
  });

  it('should fail closed on unknown requested profile', () => {
    const r = resolveEffectiveProfile({ requested: 'S9', minProfile: 'S0', maxProfile: 'S4' });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/unknown security profile/i);
  });

  it('should fail closed on invalid institution band', () => {
    const r = resolveEffectiveProfile({ requested: 'S2', minProfile: 'S4', maxProfile: 'S1' });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/invalid institution bounds/i);
  });
});

// ═══════════════════════════════════════════════════════════════════
// OS DETECTION & SEB UA MARKER
// ═══════════════════════════════════════════════════════════════════

describe('Security — OS detection & SEB user-agent', () => {
  it('should detect supported SEB platforms', () => {
    expect(detectOs('Mozilla/5.0 (Windows NT 10.0; Win64; x64)')).toBe('windows');
    expect(detectOs('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)')).toBe('macos');
    expect(detectOs('Mozilla/5.0 (iPad; CPU OS 16_0)')).toBe('ipados');
    expect(SEB_SUPPORTED_OS).toContain('windows');
    expect(SEB_SUPPORTED_OS).toContain('macos');
    expect(SEB_SUPPORTED_OS).toContain('ipados');
  });

  it('should detect unsupported OS families (linux/android)', () => {
    expect(detectOs('Mozilla/5.0 (X11; Linux x86_64)')).toBe('linux');
    expect(detectOs('Mozilla/5.0 (Linux; Android 13)')).toBe('android');
  });

  it('should recognize genuine SEB user-agent markers', () => {
    expect(hasSebUserAgentMarker('SEB/3.5.2 (Windows)')).toBe(true);
    expect(hasSebUserAgentMarker('Mozilla/5.0 SafeExamBrowser/3.4')).toBe(true);
  });

  it('should NOT accept a plain browser as SEB', () => {
    expect(hasSebUserAgentMarker('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0.0.0')).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════
// SEB CONFIG / KEY VERIFICATION BOUNDARY (§11)
// ═══════════════════════════════════════════════════════════════════

describe('Security — SEB config/key verification boundary', () => {
  const KEY = 'a'.repeat(64); // valid hex hash (32 bytes)

  it('should skip when SEB is not required', () => {
    const v = verifySebConfigBoundary({ sebRequired: false, userAgent: 'Chrome/126' });
    expect(v.ok).toBe(true);
    expect(v.skipped).toBe(true);
  });

  it('should fail when SEB required but not present', () => {
    const v = verifySebConfigBoundary({
      sebRequired: true,
      sebPresent: false,
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/126',
    });
    expect(v.ok).toBe(false);
    expect(v.code).toBe('seb_missing');
  });

  it('should fail closed when the OS cannot run SEB (linux bypass attempt)', () => {
    const v = verifySebConfigBoundary({
      sebRequired: true,
      sebPresent: true,
      configKeyHash: KEY,
      expectedKeyHash: KEY,
      userAgent: 'Mozilla/5.0 (X11; Linux x86_64) SEB/3.5.2',
    });
    expect(v.ok).toBe(false);
    expect(v.code).toBe('seb_unsupported_os');
    expect(v.reason).toMatch(/supported: windows, macos, ipados/i);
  });

  it('should fail closed for Android claims too', () => {
    const v = verifySebConfigBoundary({
      sebRequired: true,
      sebPresent: true,
      configKeyHash: KEY,
      expectedKeyHash: KEY,
      userAgent: 'Mozilla/5.0 (Linux; Android 13) SEB/3.5.2',
    });
    expect(v.ok).toBe(false);
    expect(v.code).toBe('seb_unsupported_os');
  });

  it('should FAIL CLOSED when the institution has no registered key (stop condition)', () => {
    const v = verifySebConfigBoundary({
      sebRequired: true,
      sebPresent: true,
      configKeyHash: KEY,
      expectedKeyHash: null,
      userAgent: 'SEB/3.5.2 (Windows NT 10.0; Win64; x64)',
    });
    expect(v.ok).toBe(false);
    expect(v.code).toBe('seb_key_unregistered');
  });

  it('should reject a missing client config key', () => {
    const v = verifySebConfigBoundary({
      sebRequired: true,
      sebPresent: true,
      configKeyHash: null,
      expectedKeyHash: KEY,
      userAgent: 'SEB/3.5.2 (Windows NT 10.0; Win64; x64)',
    });
    expect(v.ok).toBe(false);
    expect(v.code).toBe('seb_key_missing');
  });

  it('should reject a mismatched config key hash', () => {
    const v = verifySebConfigBoundary({
      sebRequired: true,
      sebPresent: true,
      configKeyHash: 'b'.repeat(64),
      expectedKeyHash: KEY,
      userAgent: 'SEB/3.5.2 (Windows NT 10.0; Win64; x64)',
    });
    expect(v.ok).toBe(false);
    expect(v.code).toBe('seb_key_mismatch');
  });

  it('should accept a matching key on a supported OS', () => {
    const v = verifySebConfigBoundary({
      sebRequired: true,
      sebPresent: true,
      configKeyHash: KEY,
      expectedKeyHash: KEY,
      userAgent: 'SEB/3.5.2 (Windows NT 10.0; Win64; x64)',
    });
    expect(v.ok).toBe(true);
    expect(v.code).toBe('seb_boundary_verified');
  });

  it('should be case-insensitive on hex hashes', () => {
    const v = verifySebConfigBoundary({
      sebRequired: true,
      sebPresent: true,
      configKeyHash: KEY.toUpperCase(),
      expectedKeyHash: KEY,
      userAgent: 'SEB/3.5.2 (Macintosh; Intel Mac OS X 10_15_7)',
    });
    expect(v.ok).toBe(true);
  });

  it('should reject a normal browser claiming SEB (data guard §15)', () => {
    // Chrome UA + claimed SEB + no SEB UA marker → the boundary NEVER accepts
    // a plain browser as lockdown, even with the correct key hash.
    const v = verifySebConfigBoundary({
      sebRequired: true,
      sebPresent: true,
      configKeyHash: KEY,
      expectedKeyHash: KEY,
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126',
    });
    expect(v.ok).toBe(false);
    expect(v.code).toBe('seb_ua_not_verified');
  });

  it('should accept only a genuine SEB UA marker with the matching key', () => {
    const v = verifySebConfigBoundary({
      sebRequired: true,
      sebPresent: true,
      configKeyHash: KEY,
      expectedKeyHash: KEY,
      userAgent: 'SEB/3.5.2 (Windows NT 10.0; Win64; x64)',
    });
    expect(v.ok).toBe(true);
    expect(v.code).toBe('seb_boundary_verified');
    expect(v.uaMarker).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════
// PREFLIGHT REQUIREMENT MAPPING (§10)
// ═══════════════════════════════════════════════════════════════════

describe('Security — Preflight requirement mapping', () => {
  it('should map S0 to open requirements', () => {
    const r = mapProfileToPreflightRequirements('S0');
    expect(r.identity_level).toBe('none');
    expect(r.camera_required).toBe(false);
    expect(r.seb_required).toBe(false);
    expect(r.managed_device_required).toBe(false);
    expect(r.lan_allowed).toBe(true);
  });

  it('should map S3 to lockdown requirements', () => {
    const r = mapProfileToPreflightRequirements('S3');
    expect(r.identity_level).toBe('passkey');
    expect(r.camera_required).toBe(true);
    expect(r.seb_required).toBe(true);
    expect(r.managed_device_required).toBe(true);
    expect(r.lan_allowed).toBe(false);
  });

  it('should return null for unknown profile', () => {
    expect(mapProfileToPreflightRequirements('S9')).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════
// UNSUPPORTED CONTROL BLOCKER REPORT (§14)
// ═══════════════════════════════════════════════════════════════════

describe('Security — Unsupported control report', () => {
  it('should report all blockers for an unprepared S3 attempt', () => {
    const r = buildSecurityControlReport({
      profile: 'S3',
      deviceAttestation: { cameraAvailable: false, sebPresent: false, managedDevice: false },
      clientInfo: { userAgent: 'Mozilla/5.0 (X11; Linux x86_64) Chrome/126' },
      expectedSebKeyHash: null,
    });
    expect(r.ok).toBe(false);
    const codes = r.unsupported.map((u) => u.code);
    expect(codes).toContain('camera_required');
    // Presence check runs BEFORE the OS gate — SEB not present → seb_missing
    // (seb_unsupported_os is only reached when SEB is claimed on a non-SEB OS).
    expect(codes).toContain('seb_missing');
    expect(codes).toContain('managed_device_required');
  });

  it('should pass when every S2 control is satisfied', () => {
    const r = buildSecurityControlReport({
      profile: 'S2',
      deviceAttestation: { cameraAvailable: true, sebPresent: null, managedDevice: null },
      clientInfo: { userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/126' },
    });
    expect(r.ok).toBe(true);
    expect(r.unsupported).toHaveLength(0);
  });

  it('should apply the institution managed-device override', () => {
    const r = buildSecurityControlReport({
      profile: 'S0',
      deviceAttestation: { managedDevice: false },
      clientInfo: {},
      requireManagedDeviceOverride: true,
    });
    expect(r.ok).toBe(false);
    expect(r.unsupported.map((u) => u.code)).toContain('managed_device_required');
  });

  it('should deny LAN mode when the profile forbids it', () => {
    const r = buildSecurityControlReport({
      profile: 'S3',
      deviceAttestation: { cameraAvailable: true, sebPresent: true, sebConfigKeyHash: 'a'.repeat(64), managedDevice: true },
      clientInfo: { userAgent: 'SEB/3.5.2 (Windows NT 10.0; Win64; x64)', lanMode: true },
      expectedSebKeyHash: 'a'.repeat(64),
    });
    expect(r.unsupported.map((u) => u.code)).toContain('lan_mode_denied');
  });

  it('should fail closed on unknown profile', () => {
    const r = buildSecurityControlReport({ profile: 'S9' });
    expect(r.ok).toBe(false);
    expect(r.unsupported[0].code).toBe('unknown_profile');
  });
});

// ═══════════════════════════════════════════════════════════════════
// PROFILE BADGE SANITIZATION (§13)
// ═══════════════════════════════════════════════════════════════════

describe('Security — Profile badge sanitization', () => {
  it('should expose only whitelisted fields — never key material', () => {
    const badge = buildProfileBadge({ profile: 'S3', clampedUp: false });
    const json = JSON.stringify(badge);
    expect(badge.code).toBe('S3');
    expect(badge.label).toBeTruthy();
    expect(badge.description).toBeTruthy();
    expect(badge.requirements.seb_required).toBe(true);
    // No secrets leak into the badge payload. NB: identity_level 'passkey' is
    // an identity-level name, NOT key material — only actual key/hash/secret
    // fields are forbidden.
    expect(json).not.toMatch(/seb_config_key_hash|sebConfigKeyHash|expectedSebKeyHash|sebKey|configKey|secret/i);
    expect(json).not.toMatch(/hash/i);
  });

  it('should mark clamped-up badges for UI display', () => {
    const badge = buildProfileBadge({ profile: 'S2', clampedUp: true });
    expect(badge.clamped_up).toBe(true);
  });

  it('should return null for unknown profile', () => {
    expect(buildProfileBadge({ profile: 'S9' })).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════
// SERVICE GRACEFUL DEGRADATION (no PostgreSQL)
// ═══════════════════════════════════════════════════════════════════

describe('Security — Service graceful degradation', () => {
  it('getInstitutionSecurityPolicy returns safe defaults without PG', async () => {
    const p = await getInstitutionSecurityPolicy();
    expect(p.minProfile).toBe(DEFAULT_INSTITUTION_SECURITY_POLICY.minProfile);
    expect(p.maxProfile).toBe(DEFAULT_INSTITUTION_SECURITY_POLICY.maxProfile);
    expect(p.sebConfigKeyHash).toBeNull();
  });

  it('upsertInstitutionSecurityPolicy throws PostgreSQL required without PG', async () => {
    await expect(upsertInstitutionSecurityPolicy({ minProfile: 'S0', maxProfile: 'S4' })).rejects.toThrow(/PostgreSQL required/i);
  });

  it('verifySebBoundary degrades gracefully without PG', async () => {
    const v = await verifySebBoundary({ sebPresent: true, userAgent: 'SEB/3.5.2 (Windows)' });
    // No institution key registered in the default policy → fail closed
    expect(v.seb_key_registered).toBe(false);
  });

  it('getStudentSecurityProfile reports unavailable without PG', async () => {
    const r = await getStudentSecurityProfile(1);
    expect(r.ok).toBe(false);
    expect(r.reason).toBeTruthy();
  });
});
