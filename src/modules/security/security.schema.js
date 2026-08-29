/**
 * Deborah — Security Profile & Safe Exam Browser Boundary (pure logic)
 *
 * Prompt 36 (Phase D): connects S0–S4 security profiles to typed policy and
 * client/server enforcement. Pure, DB-free logic:
 *
 *   - SECURITY_PROFILES: typed S0–S4 definitions with their required controls
 *     (identity level, camera, SEB, managed device, LAN mode, strike cap).
 *   - Institution bounds: [min_profile, max_profile] declared by the tenant;
 *     an assessment's requested profile is clamped into the band, and a
 *     profile ABOVE the institution maximum is rejected (never silently
 *     downgraded below the requested floor).
 *   - Profile → control mapping + preflight requirement mapping: given an
 *     effective profile, derive the exact device/SEB/identity requirements a
 *     student's preflight must satisfy.
 *   - SEB config/key verification boundary: Safe Exam Browser config files
 *     carry a signing key; the client presents its config key hash and the
 *     server verifies it against the institution-registered
 *     seb_config_key_hash. Without a registered key, SEB claims FAIL CLOSED.
 *   - Data guards (Prompt 36 §15):
 *       • A normal browser can NEVER present as lockdown — SEB requires a
 *         supported OS (Windows/macOS/iPadOS) + a verified config key.
 *       • Unsupported OS (Linux/Android) claims are rejected — no bypass.
 *
 * Purity: no I/O, no globals — fully unit-testable without PostgreSQL.
 */

import crypto from 'crypto';

// ═══════════════════════════════════════════════════════════════════
// PROFILE LEVELS & RANK
// ═══════════════════════════════════════════════════════════════════

export const SECURITY_PROFILE_LEVELS = ['S0', 'S1', 'S2', 'S3', 'S4'];

/** Ordered weakest → strongest (S0 open → S4 maximum security). */
export const SECURITY_PROFILE_RANK = { S0: 0, S1: 1, S2: 2, S3: 3, S4: 4 };

/** Safe Exam Browser supported platforms (SEB official: Windows/macOS/iPadOS). */
export const SEB_SUPPORTED_OS = ['windows', 'macos', 'ipados'];

/** Browser user-agent markers that indicate a genuine SEB client. */
// NOTE: 'SafeExamBrowser' → lowercase 'safeexambrowser' (safe+e+xam+browser).
export const SEB_UA_MARKERS = ['seb', 'safeexambrowser'];

/** Device/OS family detection keywords (user-agent based, server-side). */
export const OS_DETECT_RULES = [
  { os: 'windows', pattern: /windows|win32/i },
  { os: 'macos', pattern: /macintosh|mac os x/i },
  { os: 'ipados', pattern: /ipad/i },
  { os: 'ios', pattern: /iphone|ipod/i },
  { os: 'android', pattern: /android/i },
  { os: 'linux', pattern: /linux|x11/i },
];

// ═══════════════════════════════════════════════════════════════════
// TYPED PROFILES → REQUIRED CONTROLS
// ═══════════════════════════════════════════════════════════════════

/**
 * Control template per profile. Semantics:
 *   - identityLevel   — weakest acceptable identity (attempt step-up gate)
 *   - cameraRequired  — camera monitoring MUST be present
 *   - sebRequired     — Safe Exam Browser MUST be present (verified config)
 *   - managedDevice   — managed-device/LAN capability required
 *   - lanAllowed      — LAN/offline edge mode permitted for this profile
 *   - maxStrikes      — proctor incident strike cap (Prompt 34 lifecycle)
 *   - label           — human readable name (UI badge)
 *   - description     — student-facing instruction summary (no secrets)
 */
export const SECURITY_PROFILES = {
  S0: {
    identityLevel: 'none',
    cameraRequired: false,
    sebRequired: false,
    managedDevice: false,
    lanAllowed: true,
    maxStrikes: 99,
    label: 'Ochiq',
    description: 'Ochiq rejim — maxsus qurilma yoki SEB talab qilinmaydi.',
  },
  S1: {
    identityLevel: 'password',
    cameraRequired: false,
    sebRequired: false,
    managedDevice: false,
    lanAllowed: true,
    maxStrikes: 5,
    label: 'Kuzatilgan',
    description: 'Identifikatsiya talab qilinadi; qo‘shimcha qurilma sharti yo‘q.',
  },
  S2: {
    identityLevel: 'password',
    cameraRequired: true,
    sebRequired: false,
    managedDevice: false,
    lanAllowed: true,
    maxStrikes: 3,
    label: 'Cheklangan',
    description: 'Kamera monitoring majburiy; identifikatsiya talab qilinadi.',
  },
  S3: {
    identityLevel: 'passkey',
    cameraRequired: true,
    sebRequired: true,
    managedDevice: true,
    lanAllowed: false,
    maxStrikes: 2,
    label: 'Lockdown',
    description: 'Safe Exam Browser + kamera + boshqariladigan qurilma talab qilinadi.',
  },
  S4: {
    identityLevel: 'passkey',
    cameraRequired: true,
    sebRequired: true,
    managedDevice: true,
    lanAllowed: false,
    maxStrikes: 1,
    label: 'Maksimal',
    description: 'Eng yuqori himoya — SEB kaliti tekshiriladi, bitta og‘ish tugatadi.',
  },
};

/** Default institution policy when no row exists (never locks a tenant out). */
export const DEFAULT_INSTITUTION_SECURITY_POLICY = {
  minProfile: 'S0',
  maxProfile: 'S4',
  sebConfigKeyHash: null,
  requireManagedDevice: false,
  allowLanMode: true,
};

// ═══════════════════════════════════════════════════════════════════
// PROFILE HELPERS
// ═══════════════════════════════════════════════════════════════════

/** True when `profile` is a known S0–S4 level. */
export function isValidSecurityProfile(profile) {
  return typeof profile === 'string' && Object.prototype.hasOwnProperty.call(SECURITY_PROFILE_RANK, profile);
}

/**
 * Validate an institution-declared profile band.
 * min must be <= max by rank; both must be valid S0–S4 levels.
 *
 * @param {Object} bounds - { minProfile, maxProfile }
 * @returns {{ ok: boolean, errors: string[] }}
 */
export function validateInstitutionBounds({ minProfile = 'S0', maxProfile = 'S4' } = {}) {
  const errors = [];
  if (!isValidSecurityProfile(minProfile)) errors.push(`min_profile must be one of ${SECURITY_PROFILE_LEVELS.join(', ')}`);
  if (!isValidSecurityProfile(maxProfile)) errors.push(`max_profile must be one of ${SECURITY_PROFILE_LEVELS.join(', ')}`);
  if (errors.length === 0) {
    if (SECURITY_PROFILE_RANK[minProfile] > SECURITY_PROFILE_RANK[maxProfile]) {
      errors.push(`min_profile (${minProfile}) cannot be stronger than max_profile (${maxProfile})`);
    }
  }
  return { ok: errors.length === 0, errors };
}

/**
 * Resolve the EFFECTIVE profile for an assessment inside the institution band.
 *
 * Policy:
 *   - requested below the institution minimum → clamped UP to the minimum
 *     (the institution floor always wins — no weaker-than-allowed attempt).
 *   - requested above the institution maximum → REJECTED with an explicit
 *     reason (the requested security cannot be honoured inside the band).
 *   - unknown requested profile → rejected (fail closed).
 *
 * @param {Object} params
 * @param {string} [params.requested] - profile declared by the assessment policy
 * @param {string} [params.minProfile] - institution minimum
 * @param {string} [params.maxProfile] - institution maximum
 * @returns {{ ok: boolean, profile?: string, reason?: string, clampedUp?: boolean }}
 */
export function resolveEffectiveProfile({
  requested = 'S0',
  minProfile = 'S0',
  maxProfile = 'S4',
} = {}) {
  if (!isValidSecurityProfile(requested)) {
    return { ok: false, reason: `Unknown security profile: ${requested}` };
  }
  const bounds = validateInstitutionBounds({ minProfile, maxProfile });
  if (!bounds.ok) {
    return { ok: false, reason: `Invalid institution bounds: ${bounds.errors.join('; ')}` };
  }

  const reqRank = SECURITY_PROFILE_RANK[requested];
  const minRank = SECURITY_PROFILE_RANK[minProfile];
  const maxRank = SECURITY_PROFILE_RANK[maxProfile];

  if (reqRank > maxRank) {
    return {
      ok: false,
      reason: `Security profile ${requested} exceeds the institution maximum (${maxProfile})`,
    };
  }
  if (reqRank < minRank) {
    return { ok: true, profile: minProfile, clampedUp: true, reason: `Clamped up to institution minimum (${minProfile})` };
  }
  return { ok: true, profile: requested, clampedUp: false };
}

/** Return the typed control set for a profile (or null when unknown). */
export function profileControls(profile) {
  return SECURITY_PROFILES[profile] || null;
}

/**
 * Map an effective profile to PREFLIGHT requirements (Prompt 36 §10).
 * The returned contract is what the student preflight must satisfy:
 * identity level, camera, SEB, managed device, LAN mode, strike cap.
 *
 * @param {string} profile - resolved effective profile (S0–S4)
 * @returns {Object|null} requirement contract
 */
export function mapProfileToPreflightRequirements(profile) {
  const controls = profileControls(profile);
  if (!controls) return null;
  return {
    profile,
    identity_level: controls.identityLevel,
    camera_required: controls.cameraRequired,
    seb_required: controls.sebRequired,
    managed_device_required: controls.managedDevice,
    lan_allowed: controls.lanAllowed,
    max_strikes: controls.maxStrikes,
  };
}

// ═══════════════════════════════════════════════════════════════════
// SEB CONFIG / KEY VERIFICATION BOUNDARY
// ═══════════════════════════════════════════════════════════════════

/**
 * Detect the OS family from a user-agent string (server-side, never client
 * supplied). Returns one of SEB_SUPPORTED_OS, 'ios'|'android'|'linux' or null.
 *
 * @param {string} userAgent
 * @returns {string|null}
 */
export function detectOs(userAgent = '') {
  const ua = String(userAgent || '');
  for (const rule of OS_DETECT_RULES) {
    if (rule.pattern.test(ua)) return rule.os;
  }
  return null;
}

/**
 * True when the user-agent contains a genuine Safe Exam Browser marker.
 * A plain Chrome/Firefox/Safari UA is never accepted as SEB.
 *
 * @param {string} userAgent
 * @returns {boolean}
 */
export function hasSebUserAgentMarker(userAgent = '') {
  const ua = String(userAgent || '').toLowerCase();
  return SEB_UA_MARKERS.some((m) => ua.includes(m));
}

/**
 * Verify the SEB config/key boundary for an attempt (Prompt 36 §11).
 *
 * Rules:
 *   - SEB not required → ok (skipped).
 *   - SEB required but client claims no SEB → fail (seb_missing).
 *   - SEB required, client claims SEB, but the OS is NOT a supported SEB
 *     platform (Windows/macOS/iPadOS) → fail (seb_unsupported_os). Linux or
 *     Android can never run SEB — a claim there is always a bypass attempt.
 *   - No institution-registered seb_config_key_hash → fail closed
 *     (seb_key_unregistered). S3/S4 must not open without a verifiable key.
 *   - Client presents a config key hash that does not match the registered
 *     hash → fail (seb_key_mismatch). Timing-safe compare.
 *   - A supported OS + matching key hash → ok (seb_boundary_verified).
 *
 * @param {Object} params
 * @param {boolean} [params.sebRequired]
 * @param {boolean|null} [params.sebPresent] - client attestation (deviceAttestation.sebPresent)
 * @param {string|null} [params.configKeyHash] - client-presented SEB config key hash
 * @param {string|null} [params.expectedKeyHash] - institution seb_config_key_hash
 * @param {string} [params.userAgent]
 * @returns {{ ok: boolean, code: string, reason: string, os: string|null,
 *             uaMarker: boolean, skipped?: boolean }}
 */
export function verifySebConfigBoundary({
  sebRequired = false,
  sebPresent = null,
  configKeyHash = null,
  expectedKeyHash = null,
  userAgent = '',
} = {}) {
  const os = detectOs(userAgent);
  const uaMarker = hasSebUserAgentMarker(userAgent);

  if (!sebRequired) {
    return { ok: true, code: 'seb_not_required', reason: 'SEB talab qilinmaydi', os, uaMarker, skipped: true };
  }

  if (sebPresent !== true) {
    return { ok: false, code: 'seb_missing', reason: 'Safe Exam Browser aniqlanmadi', os, uaMarker };
  }

  // Genuine SEB only runs on Windows/macOS/iPadOS.
  if (!SEB_SUPPORTED_OS.includes(os)) {
    return {
      ok: false,
      code: 'seb_unsupported_os',
      reason: `SEB ${os || 'noma’lum OS'}da ishlamaydi — supported: ${SEB_SUPPORTED_OS.join(', ')}`,
      os,
      uaMarker,
    };
  }

  // Data guard §15: oddiy brauzerni lockdown deb ko'rsatma. Even with a
  // matching key, a genuine SEB client MUST carry the SEB user-agent marker;
  // a plain Chrome/Firefox/Safari UA presenting the key is never verified.
  if (!uaMarker) {
    return {
      ok: false,
      code: 'seb_ua_not_verified',
      reason: 'SEB user-agent belgisi yo‘q — oddiy brauzer lockdown sifatida qabul qilinmaydi',
      os,
      uaMarker,
    };
  }

  // Fail closed when the institution never registered a SEB config key.
  if (!expectedKeyHash) {
    return {
      ok: false,
      code: 'seb_key_unregistered',
      reason: 'Institut SEB kalitini ro‘yxatdan o‘tkazmagan — SEB rejimi tasdiqlanmaydi',
      os,
      uaMarker,
    };
  }

  // Client MUST present a config key hash that matches the registered key.
  if (!configKeyHash || typeof configKeyHash !== 'string') {
    return { ok: false, code: 'seb_key_missing', reason: 'SEB konfiguratsiya kaliti taqdim etilmadi', os, uaMarker };
  }

  const a = Buffer.from(String(configKeyHash).toLowerCase(), 'hex');
  const b = Buffer.from(String(expectedKeyHash).toLowerCase(), 'hex');
  if (a.length !== b.length || a.length === 0 || !cryptoTimingSafeEqual(a, b)) {
    return { ok: false, code: 'seb_key_mismatch', reason: 'SEB konfiguratsiya kaliti mos kelmadi', os, uaMarker };
  }

  return { ok: true, code: 'seb_boundary_verified', reason: 'SEB boundary tasdiqlandi', os, uaMarker };
}

/** Timing-safe buffer compare — lengths are pre-checked by the caller. */
function cryptoTimingSafeEqual(a, b) {
  return crypto.timingSafeEqual(a, b);
}

// ═══════════════════════════════════════════════════════════════════
// UNSUPPORTED CONTROL BLOCKER REPORT (§14)
// ═══════════════════════════════════════════════════════════════════

/**
 * Build the full security control evaluation for a student attempt and the
 * unsupported-control blocker report shown in the preflight UI.
 *
 * Combines profile requirements with the CLIENT attestation actually received
 * (camera availability, SEB presence + config key, managed-device claim) and
 * reports exactly which required controls are unsupported/failed.
 *
 * @param {Object} params
 * @param {string} params.profile - effective profile (S0–S4)
 * @param {Object} [params.deviceAttestation] - { cameraAvailable, sebPresent, managedDevice }
 * @param {Object} [params.clientInfo] - { userAgent, online, connectionType, lanMode }
 * @param {string|null} [params.expectedSebKeyHash] - institution seb_config_key_hash
 * @param {boolean} [params.requireManagedDeviceOverride] - institution flag
 * @param {boolean} [params.allowLanModeOverride] - institution flag
 * @returns {{ ok: boolean, profile: string, controls: Object,
 *             unsupported: Array<{ code: string, message: string }>,
 *             checks: Array<{ name: string, ok: boolean, detail: string }> }}
 */
export function buildSecurityControlReport({
  profile = 'S0',
  deviceAttestation = {},
  clientInfo = {},
  expectedSebKeyHash = null,
  requireManagedDeviceOverride = false,
  allowLanModeOverride = true,
} = {}) {
  const controls = profileControls(profile);
  const requirements = mapProfileToPreflightRequirements(profile);
  if (!controls || !requirements) {
    return {
      ok: false,
      profile,
      controls: null,
      unsupported: [{ code: 'unknown_profile', message: `Noma’lum security profile: ${profile}` }],
      checks: [],
    };
  }

  const checks = [];
  const unsupported = [];

  // Camera
  const cameraOk = !requirements.camera_required || deviceAttestation.cameraAvailable === true;
  checks.push({
    name: 'camera',
    ok: cameraOk,
    detail: requirements.camera_required
      ? (cameraOk ? 'kamera mavjud' : 'kamera mavjud emas')
      : 'talab qilinmaydi',
  });
  if (requirements.camera_required && !cameraOk) {
    unsupported.push({ code: 'camera_required', message: 'Kamera monitoring talab qilinadi' });
  }

  // SEB boundary (config/key verification)
  const seb = verifySebConfigBoundary({
    sebRequired: requirements.seb_required,
    sebPresent: deviceAttestation.sebPresent,
    configKeyHash: deviceAttestation.sebConfigKeyHash || clientInfo.sebConfigKeyHash || null,
    expectedKeyHash: expectedSebKeyHash,
    userAgent: clientInfo.userAgent || '',
  });
  checks.push({
    name: 'seb',
    ok: seb.ok,
    detail: seb.skipped ? 'talab qilinmaydi' : seb.reason,
  });
  if (!seb.ok) unsupported.push({ code: seb.code, message: seb.reason });

  // Managed device — profile OR institution override may require it
  const managedRequired = requirements.managed_device_required || requireManagedDeviceOverride === true;
  const managedOk = !managedRequired || deviceAttestation.managedDevice === true;
  checks.push({
    name: 'managed_device',
    ok: managedOk,
    detail: managedRequired
      ? (managedOk ? 'boshqariladigan qurilma' : 'boshqariladigan qurilma talab qilinadi')
      : 'talab qilinmaydi',
  });
  if (managedRequired && !managedOk) {
    unsupported.push({ code: 'managed_device_required', message: 'Boshqariladigan qurilma talab qilinadi' });
  }

  // LAN mode — allowed only when both profile and institution permit it
  const lanAllowed = requirements.lan_allowed === true && allowLanModeOverride !== false;
  const lanClaimed = clientInfo.lanMode === true;
  checks.push({
    name: 'lan_mode',
    ok: !lanClaimed || lanAllowed,
    detail: lanAllowed ? 'ruxsat etilgan' : 'ruxsat etilmagan',
  });
  if (lanClaimed && !lanAllowed) {
    unsupported.push({ code: 'lan_mode_denied', message: 'LAN rejimi bu profil uchun ruxsat etilmagan' });
  }

  // Identity level (server session gate — enforced at attempt start)
  checks.push({
    name: 'identity',
    ok: true, // enforced server-side at startAttempt; surfaced here for the UI
    detail: `talab: ${requirements.identity_level}`,
  });

  return {
    ok: unsupported.length === 0,
    profile,
    controls: requirements,
    unsupported,
    checks,
  };
}

// ═══════════════════════════════════════════════════════════════════
// PROFILE BADGE / INSTRUCTION (sanitized, §13)
// ═══════════════════════════════════════════════════════════════════

/**
 * Build the sanitized profile badge payload for the student UI.
 * Whitelist only — the badge NEVER exposes institution key material, policy
 * internals or grading data.
 *
 * @param {Object} params
 * @param {string} params.profile - effective profile
 * @param {boolean} [params.clampedUp]
 * @param {string|null} [params.assignmentTitle]
 * @returns {Object|null} badge payload
 */
export function buildProfileBadge({ profile, clampedUp = false, assignmentTitle = null } = {}) {
  const controls = profileControls(profile);
  if (!controls) return null;
  return {
    code: profile,
    label: controls.label,
    description: controls.description,
    clamped_up: clampedUp,
    assignment_title: assignmentTitle,
    requirements: mapProfileToPreflightRequirements(profile),
  };
}
