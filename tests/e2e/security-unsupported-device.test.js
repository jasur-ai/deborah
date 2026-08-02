/**
 * Edikit — Security Profile & Unsupported Device E2E Walk (Prompt 36)
 *
 * E2E/security test at the pure-logic layer (PostgreSQL absent in CI — same
 * convention as teacher-core.checkpoint.test.js): walks the full Prompt 36
 * journey end-to-end:
 *
 *   1. Institution declares a band [S1, S3]
 *   2. An assessment requests S4 → REJECTED (above institution max)
 *   3. An assessment requests S0 → clamped up to S1 (floor wins)
 *   4. An S3 (lockdown) assignment runs preflight on an unsupported Linux
 *      device claiming SEB → SEB boundary rejects (no bypass)
 *   5. The same S3 assignment with a supported Windows + matching key passes
 *      every control → eligible
 *   6. Profile badge payload contains zero key/hash/secret material
 *
 * DATA GUARDS (§15) verified:
 *   - A normal browser is never presented as lockdown
 *   - Unsupported OS claims cannot bypass the SEB boundary
 *   - No profile resolution silently downgrades below the institution floor
 *   - S3 is not opened without a registered SEB key (stop condition §24)
 */

import { describe, it, expect } from 'vitest';

import {
  SECURITY_PROFILE_LEVELS,
  SECURITY_PROFILE_RANK,
  validateInstitutionBounds,
  resolveEffectiveProfile,
  mapProfileToPreflightRequirements,
  detectOs,
  verifySebConfigBoundary,
  buildSecurityControlReport,
  buildProfileBadge,
} from '../../src/modules/security/security.schema.js';

// Helper: build a realistic preflight eligibility from a control report,
// mirroring preflight.schema's computeStartEligibility security section.
function preflightEligible(report) {
  return report.ok && report.unsupported.length === 0;
}

describe('Prompt 36 E2E — institution band enforcement', () => {
  it('valid institution band [S1,S3] is accepted', () => {
    expect(validateInstitutionBounds({ minProfile: 'S1', maxProfile: 'S3' }).ok).toBe(true);
  });

  it('assessment requesting S4 inside [S1,S3] is rejected (never downgraded)', () => {
    const r = resolveEffectiveProfile({ requested: 'S4', minProfile: 'S1', maxProfile: 'S3' });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/exceeds the institution maximum/i);
  });

  it('assessment requesting S0 inside [S1,S3] is clamped up to S1', () => {
    const r = resolveEffectiveProfile({ requested: 'S0', minProfile: 'S1', maxProfile: 'S3' });
    expect(r.ok).toBe(true);
    expect(r.profile).toBe('S1');
    expect(r.clampedUp).toBe(true);
  });
});

describe('Prompt 36 E2E — unsupported device preflight walk', () => {
  it('S3 lockdown on Linux device claiming SEB is blocked (no bypass)', () => {
    const report = buildSecurityControlReport({
      profile: 'S3',
      deviceAttestation: { cameraAvailable: true, sebPresent: true, managedDevice: true },
      clientInfo: { userAgent: 'Mozilla/5.0 (X11; Linux x86_64) SEB/3.5.2' },
      expectedSebKeyHash: 'a'.repeat(64),
    });
    expect(detectOs('Mozilla/5.0 (X11; Linux x86_64) SEB/3.5.2')).toBe('linux');
    expect(preflightEligible(report)).toBe(false);
    const codes = report.unsupported.map((u) => u.code);
    expect(codes).toContain('seb_unsupported_os');
    // The student can NEVER be told "lockdown ok" on Linux
    expect(codes).not.toContain('seb_boundary_verified');
  });

  it('S3 lockdown on Windows with missing camera is blocked', () => {
    const report = buildSecurityControlReport({
      profile: 'S3',
      deviceAttestation: { cameraAvailable: false, sebPresent: true, managedDevice: true },
      clientInfo: { userAgent: 'SEB/3.5.2 (Windows NT 10.0; Win64; x64)' },
      expectedSebKeyHash: 'a'.repeat(64),
    });
    expect(preflightEligible(report)).toBe(false);
    expect(report.unsupported.map((u) => u.code)).toContain('camera_required');
  });

  it('S3 lockdown on Windows + key mismatch is blocked (tampered config)', () => {
    const report = buildSecurityControlReport({
      profile: 'S3',
      deviceAttestation: { cameraAvailable: true, sebPresent: true, sebConfigKeyHash: 'b'.repeat(64), managedDevice: true },
      clientInfo: { userAgent: 'SEB/3.5.2 (Windows NT 10.0; Win64; x64)' },
      expectedSebKeyHash: 'a'.repeat(64),
    });
    expect(preflightEligible(report)).toBe(false);
    expect(report.unsupported.map((u) => u.code)).toContain('seb_key_mismatch');
  });

  it('S3 lockdown fully satisfied → eligible', () => {
    const report = buildSecurityControlReport({
      profile: 'S3',
      deviceAttestation: { cameraAvailable: true, sebPresent: true, sebConfigKeyHash: 'a'.repeat(64), managedDevice: true },
      clientInfo: { userAgent: 'SEB/3.5.2 (Windows NT 10.0; Win64; x64)', lanMode: false },
      expectedSebKeyHash: 'a'.repeat(64),
    });
    expect(preflightEligible(report)).toBe(true);
    expect(report.checks.find((c) => c.name === 'seb').detail).toContain('tasdiqlandi');
  });

  it('S3 is never opened without a registered institution key (stop condition)', () => {
    const report = buildSecurityControlReport({
      profile: 'S3',
      deviceAttestation: { cameraAvailable: true, sebPresent: true, sebConfigKeyHash: 'a'.repeat(64), managedDevice: true },
      clientInfo: { userAgent: 'SEB/3.5.2 (Windows NT 10.0; Win64; x64)' },
      expectedSebKeyHash: null, // institution never registered a key
    });
    expect(preflightEligible(report)).toBe(false);
    expect(report.unsupported.map((u) => u.code)).toContain('seb_key_unregistered');
  });

  it('a plain browser cannot present as lockdown (data guard §15)', () => {
    // Chrome UA claiming SEB — even with the correct key hash — is REJECTED
    // because a genuine SEB client always carries the SEB UA marker.
    const v = verifySebConfigBoundary({
      sebRequired: true,
      sebPresent: true,
      configKeyHash: 'a'.repeat(64),
      expectedKeyHash: 'a'.repeat(64),
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126',
    });
    expect(v.os).toBe('windows');
    expect(v.uaMarker).toBe(false);
    expect(v.ok).toBe(false);
    expect(v.code).toBe('seb_ua_not_verified');
  });
});

describe('Prompt 36 E2E — profile badge & UI data', () => {
  it('badge carries only whitelisted fields (no secrets, no keys)', () => {
    const badge = buildProfileBadge({ profile: 'S4', clampedUp: false });
    const json = JSON.stringify(badge);
    expect(badge.code).toBe('S4');
    expect(json).not.toMatch(/sebConfigKeyHash|expectedKey|secret|password_hash/i);
  });

  it('requirement contract drives the UI checklist', () => {
    const req = mapProfileToPreflightRequirements('S3');
    const uiKeys = ['identity_level', 'camera_required', 'seb_required', 'managed_device_required', 'lan_allowed', 'max_strikes'];
    for (const k of uiKeys) expect(req).toHaveProperty(k);
    // Profile ordering sanity for the UI legend
    expect(SECURITY_PROFILE_LEVELS.length).toBe(5);
    expect(SECURITY_PROFILE_RANK.S4).toBeGreaterThan(SECURITY_PROFILE_RANK.S0);
  });
});
