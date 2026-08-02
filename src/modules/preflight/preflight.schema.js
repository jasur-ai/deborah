/**
 * Edikit — Student Preflight Schema (pure logic)
 *
 * Pure, DB-free logic for Prompt 28 (Student assignment list, brief va preflight):
 *   - Availability window computation (not_started | open | closed | unscheduled)
 *   - Roster authorization against the PUBLISHED assignment snapshot (never
 *     silently re-synced with the live roster — Prompt 28 §24 stop condition)
 *   - Whitelist sanitizers for student-facing brief & policy render
 *     (answer keys / private data structurally impossible — §15 data guard)
 *   - Browser/device/network capability check
 *   - Camera / Safe-Exam-Browser requirement hook (from policy.security)
 *   - Practice requirement & status
 *   - Start-eligibility / preflight result contract (blockers + warnings)
 *   - Idempotency key derivation (assignment + user + day)
 *
 * Purity: no I/O, no globals — fully unit-testable without PostgreSQL.
 */

import crypto from 'crypto';

// ═══════════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════════

export const AVAILABILITY_STATUS = {
  NOT_STARTED: 'not_started',
  OPEN: 'open',
  CLOSED: 'closed',
  UNSCHEDULED: 'unscheduled',
};

export const PREFLIGHT_STATUS = {
  PENDING: 'pending',
  PASSED: 'passed',
  BLOCKED: 'blocked',
};

/** Blocker codes — the machine-readable part of the eligibility contract. */
export const BLOCKER_CODES = {
  NOT_ASSIGNED: 'not_assigned',           // user not in the published roster snapshot
  NOT_STARTED: 'window_not_started',      // before availability window start
  CLOSED: 'window_closed',                // after availability window end
  UNSCHEDULED: 'unscheduled',             // no availability window configured
  BRIEF_UNAVAILABLE: 'brief_unavailable', // approved brief version missing
  POLICY_UNAVAILABLE: 'policy_unavailable',
  PRACTICE_REQUIRED: 'practice_required',
  DEVICE_UNSUPPORTED: 'device_unsupported',
  CAMERA_REQUIRED: 'camera_required',
  SEB_REQUIRED: 'seb_required',
  ACCOMMODATION_UNCONFIRMED: 'accommodation_unconfirmed',
};

export const BLOCKER_MESSAGES = {
  [BLOCKER_CODES.NOT_ASSIGNED]: 'Siz bu assessmentga tayinlanmagansiz',
  [BLOCKER_CODES.NOT_STARTED]: 'Assessment hali boshlanmagan',
  [BLOCKER_CODES.CLOSED]: 'Assessment vaqti tugagan',
  [BLOCKER_CODES.UNSCHEDULED]: 'Assessment vaqti belgilanmagan',
  [BLOCKER_CODES.BRIEF_UNAVAILABLE]: 'Assessment briefi tayyor emas',
  [BLOCKER_CODES.POLICY_UNAVAILABLE]: 'Assessment siyosati tayyor emas',
  [BLOCKER_CODES.PRACTICE_REQUIRED]: 'Amaliyot (practice) bajarilmagan',
  [BLOCKER_CODES.DEVICE_UNSUPPORTED]: 'Qurilma/brauzer talablarga mos emas',
  [BLOCKER_CODES.CAMERA_REQUIRED]: 'Kamera talab qilinadi',
  [BLOCKER_CODES.SEB_REQUIRED]: 'Safe Exam Browser talab qilinadi',
  [BLOCKER_CODES.ACCOMMODATION_UNCONFIRMED]: 'Accommodation tasdiqlanmagan',
};

/** Allowed device check names (the client capability contract). */
export const DEVICE_CHECKS = {
  BROWSER: 'browser_supported',
  SCREEN: 'screen_size',
  ONLINE: 'online',
  NETWORK: 'network',
};

/** Minimum supported screen size (CSS px) for the student surface. */
export const MIN_SCREEN = { width: 360, height: 480 };

/** Browsers considered supported (User-Agent substring match, lowercase). */
export const SUPPORTED_BROWSERS = ['chrome', 'firefox', 'safari', 'edg/', 'opera'];

/** Default AI-use level when a brief has none (research.md §27.2). */
export const DEFAULT_AI_USE_LEVEL = 'A0';

// ═══════════════════════════════════════════════════════════════════
// AVAILABILITY WINDOW
// ═══════════════════════════════════════════════════════════════════

/**
 * Compute the availability status for an assignment at a given time.
 *
 * @param {Object} params
 * @param {string|number|Date|null} params.startAt - Window open time (e.g. calendar event start)
 * @param {string|number|Date|null} params.endAt - Window close time
 * @param {string|number|Date} [params.now] - Reference time (defaults to Date.now())
 * @returns {{ status: string, window: { start: string|null, end: string|null }, now: string }}
 */
export function computeAvailabilityWindow({ startAt = null, endAt = null, now = Date.now() } = {}) {
  const nowMs = new Date(now).getTime();
  const iso = (d) => (d == null || d === '' ? null : new Date(d).toISOString());
  const start = startAt == null || startAt === '' ? null : new Date(startAt).getTime();
  const end = endAt == null || endAt === '' ? null : new Date(endAt).getTime();

  let status;
  if (start == null && end == null) {
    status = AVAILABILITY_STATUS.UNSCHEDULED;
  } else if (start != null && nowMs < start) {
    status = AVAILABILITY_STATUS.NOT_STARTED;
  } else if (end != null && nowMs > end) {
    status = AVAILABILITY_STATUS.CLOSED;
  } else {
    status = AVAILABILITY_STATUS.OPEN;
  }

  return {
    status,
    window: { start: iso(startAt), end: iso(endAt) },
    now: new Date(nowMs).toISOString(),
  };
}

// ═══════════════════════════════════════════════════════════════════
// ROSTER AUTHORIZATION (snapshot-based, no silent re-sync)
// ═══════════════════════════════════════════════════════════════════

/**
 * Check whether a user is a member of the PUBLISHED roster snapshot.
 * Membership is derived ONLY from the snapshot — never from the live
 * enrollments table. If the live roster contradicts the snapshot, the
 * snapshot wins (Prompt 28 §24: assignment snapshot bilan current roster
 * qarama-qarshi bo'lsa silent sync qilma).
 *
 * @param {Array<Object>} rosterSnapshot - assignment_roster_members rows
 * @param {number} userId
 * @returns {{ in_snapshot: boolean, snapshot_count: number }}
 */
export function checkRosterMembership(rosterSnapshot = [], userId) {
  const rows = Array.isArray(rosterSnapshot) ? rosterSnapshot : [];
  const inSnapshot = rows.some((r) => Number(r?.user_id) === Number(userId));
  return { in_snapshot: inSnapshot, snapshot_count: rows.length };
}

// ═══════════════════════════════════════════════════════════════════
// STUDENT-FACING SANITIZERS (whitelist — answer keys structurally impossible)
// ═══════════════════════════════════════════════════════════════════

/** Keys that must NEVER appear in any student-facing render. */
export const FORBIDDEN_STUDENT_KEYS = [
  'answer', 'answer_key', 'answerKey', 'correct', 'correctKey', 'private',
  'private_data', 'privateData', 'scoring', 'rubric', 'solution', 'explanation',
  'distractor', 'key', 'secret',
];

/**
 * Recursively check a value for forbidden key names (case-insensitive).
 * Used as a belt-and-braces guard on top of the whitelist sanitizers.
 *
 * @param {any} value
 * @param {string} [path]
 * @returns {Array<{ path: string, key: string }>}
 */
export function scanForForbiddenStudentKeys(value, path = '$') {
  const hits = [];
  if (value === null || typeof value !== 'object') return hits;
  if (Array.isArray(value)) {
    value.forEach((item, i) => hits.push(...scanForForbiddenStudentKeys(item, `${path}[${i}]`)));
    return hits;
  }
  for (const [key, val] of Object.entries(value)) {
    const lower = key.toLowerCase();
    if (FORBIDDEN_STUDENT_KEYS.some((f) => lower === f || lower.includes(f.toLowerCase()))) {
      hits.push({ path: `${path}.${key}`, key });
    }
    hits.push(...scanForForbiddenStudentKeys(val, `${path}.${key}`));
  }
  return hits;
}

/**
 * Whitelist-sanitize a brief for the student surface.
 * Only pedagogically relevant, non-secret fields survive; everything else is
 * dropped. The result is additionally scanned for forbidden keys.
 *
 * @param {Object} brief - assessment_briefs row (content, ai_use_level, version...)
 * @returns {{ available: boolean, version: number|null, ai_use_level: string,
 *             sanitized_content: Object, leaks: Array }|null}
 */
export function sanitizeBriefForStudent(brief = null) {
  if (!brief) return { available: false, version: null, ai_use_level: null, sanitized_content: {}, leaks: [] };

  const c = brief.content || {};
  const sanitized = {
    learning_outcomes: Array.isArray(c.learning_outcomes)
      ? c.learning_outcomes.map((lo) => (typeof lo === 'string' ? lo : lo?.text || lo?.code || '')).filter(Boolean)
      : [],
    duration_minutes: typeof c.duration_minutes === 'number' ? c.duration_minutes : null,
    submission_format: typeof c.submission_format === 'string' ? c.submission_format : null,
    materials: Array.isArray(c.materials)
      ? c.materials.map((m) => (typeof m === 'string' ? m : m?.title || m?.name || '')).filter(Boolean)
      : [],
    late_policy: c.late_policy && typeof c.late_policy === 'object'
      ? { allowed: !!c.late_policy.allowed, max_days: c.late_policy.max_days ?? null }
      : null,
    resit_policy: c.resit_policy && typeof c.resit_policy === 'object'
      ? { allowed: !!c.resit_policy.allowed, max_attempts: c.resit_policy.max_attempts ?? null }
      : null,
  };

  return {
    available: true,
    version: brief.version ?? null,
    ai_use_level: brief.ai_use_level || DEFAULT_AI_USE_LEVEL,
    sanitized_content: sanitized,
    leaks: scanForForbiddenStudentKeys(sanitized),
  };
}

/**
 * Whitelist-sanitize a policy pack for the student surface.
 * Only the requirements the student needs to satisfy are exposed (security
 * profile, camera/SEB flags, strikes, late/resit, AI-use level) — retention,
 * marking internals, metadata and anything sensitive are dropped.
 *
 * @param {Object} policy - policy_packs row (policy JSONB, version...)
 * @returns {{ available: boolean, version: number|null, security: Object,
 *             late: Object|null, resit: Object|null, ai_use: Object|null,
 *             leaks: Array }|null}
 */
export function sanitizePolicyForStudent(policy = null) {
  if (!policy) return { available: false, version: null, security: {}, late: null, resit: null, ai_use: null, leaks: [] };

  const p = policy.policy || {};
  const security = p.security && typeof p.security === 'object' ? {
    profile: typeof p.security.profile === 'string' ? p.security.profile : null,
    max_strikes: p.security.max_strikes ?? null,
    allow_camera: p.security.allow_camera ?? null,
    require_seb: p.security.require_seb ?? null,
  } : {};

  const late = p.late && typeof p.late === 'object' ? { allowed: !!p.late.allowed, max_days: p.late.max_days ?? null } : null;
  const resit = p.resit && typeof p.resit === 'object' ? { allowed: !!p.resit.allowed, max_attempts: p.resit.max_attempts ?? null } : null;
  const aiUse = p.ai_use && typeof p.ai_use === 'object' ? { level: p.ai_use.level ?? null } : null;

  const sanitized = { security, late, resit, ai_use: aiUse };
  return {
    available: true,
    version: policy.version ?? null,
    security,
    late,
    resit,
    ai_use: aiUse,
    leaks: scanForForbiddenStudentKeys(sanitized),
  };
}

// ═══════════════════════════════════════════════════════════════════
// DEVICE / BROWSER / NETWORK CAPABILITY CHECK
// ═══════════════════════════════════════════════════════════════════

/**
 * Detect a supported browser from a User-Agent string.
 *
 * @param {string} userAgent
 * @returns {string|null}
 */
export function detectBrowser(userAgent = '') {
  const ua = (userAgent || '').toLowerCase();
  for (const b of SUPPORTED_BROWSERS) {
    if (ua.includes(b)) {
      if (b === 'edg/') return 'edge';
      if (b === 'safari') {
        // Safari also appears in Chrome UA strings — exclude Chrome/Chromium
        if (ua.includes('chrome') || ua.includes('chromium')) continue;
        return 'safari';
      }
      return b.replace('/', '');
    }
  }
  return null;
}

/**
 * Build the browser/device/network capability check.
 *
 * @param {Object} client - client hints { userAgent, screenWidth, screenHeight,
 *   online, connectionType, connectionDownlink, deviceType }
 * @returns {{ ok: boolean, checks: Array<{ name: string, ok: boolean, detail: string|null }> }}
 */
export function buildDeviceCheck(client = {}) {
  const checks = [];

  const browser = detectBrowser(client.userAgent || '');
  checks.push({
    name: DEVICE_CHECKS.BROWSER,
    ok: browser !== null,
    detail: browser ? `supported: ${browser}` : 'unsupported or unknown browser',
  });

  const w = Number(client.screenWidth) || 0;
  const h = Number(client.screenHeight) || 0;
  const hasScreen = w > 0 && h > 0;
  const screenOk = !hasScreen || (w >= MIN_SCREEN.width && h >= MIN_SCREEN.height);
  checks.push({
    name: DEVICE_CHECKS.SCREEN,
    ok: screenOk,
    detail: hasScreen ? `${w}x${h}` : 'screen size unknown (allowed)',
  });

  const online = client.online !== false;
  checks.push({
    name: DEVICE_CHECKS.ONLINE,
    ok: online,
    detail: online ? 'online' : 'offline',
  });

  const net = client.connectionType || null;
  const downlink = Number(client.connectionDownlink) || 0;
  const netOk = net !== 'none' && net !== 'slow-2g';
  checks.push({
    name: DEVICE_CHECKS.NETWORK,
    ok: net == null || netOk,
    detail: net
      ? `${net}${downlink ? ` / ${downlink} Mbps` : ''}`
      : 'connection type unknown (allowed)',
  });

  return { ok: checks.every((c) => c.ok), checks };
}

// ═══════════════════════════════════════════════════════════════════
// CAMERA / SEB REQUIREMENT HOOK
// ═══════════════════════════════════════════════════════════════════

/**
 * Derive camera/SEB requirements from the sanitized policy security block and
 * evaluate them against device attestation.
 *
 * Semantics (policy.security):
 *   - allow_camera === false → camera monitoring is REQUIRED
 *   - require_seb === true → Safe Exam Browser is REQUIRED
 *
 * @param {Object} security - sanitized policy.security
 * @param {Object} deviceAttestation - { cameraAvailable, sebPresent }
 * @returns {{ camera_required: boolean, seb_required: boolean, camera_ok: boolean,
 *             seb_ok: boolean, checks: Array<{name:string,ok:boolean,detail:string}> }}
 */
export function buildSecurityCheck(security = {}, deviceAttestation = {}) {
  const cameraRequired = security.allow_camera === false;
  const sebRequired = security.require_seb === true;

  const cameraOk = !cameraRequired || deviceAttestation.cameraAvailable === true;
  const sebOk = !sebRequired || deviceAttestation.sebPresent === true;

  return {
    camera_required: cameraRequired,
    seb_required: sebRequired,
    camera_ok: cameraOk,
    seb_ok: sebOk,
    checks: [
      { name: 'camera', ok: cameraOk, detail: cameraRequired ? (cameraOk ? 'camera present' : 'camera missing') : 'not required' },
      { name: 'seb', ok: sebOk, detail: sebRequired ? (sebOk ? 'SEB present' : 'SEB missing') : 'not required' },
    ],
  };
}

// ═══════════════════════════════════════════════════════════════════
// PRACTICE REQUIREMENT & STATUS
// ═══════════════════════════════════════════════════════════════════

/**
 * Build the practice requirement from the brief/policy.
 * practice_required may be declared on brief.content (teacher-set) or in the
 * policy (institution-set). Defaults to not required for low-stakes.
 *
 * @param {Object} brief - raw brief row
 * @param {Object} policy - raw policy row
 * @returns {{ required: boolean, description: string|null }}
 */
export function buildPracticeRequirement(brief = null, policy = null) {
  const briefReq = brief?.content?.practice_required;
  const policyReq = policy?.policy?.practice?.required;
  if (briefReq === true || policyReq === true) {
    return {
      required: true,
      description: brief?.content?.practice_description
        || policy?.policy?.practice?.description
        || 'Amaliyot testi bajarilishi shart',
    };
  }
  return { required: false, description: null };
}

/**
 * Compute practice progress against a requirement.
 *
 * @param {{ required: boolean, description: string|null }} requirement
 * @param {Object} practiceData - { completed_runs, required_runs }
 * @returns {{ required: boolean, completed: boolean, progress: number,
 *             description: string|null, completed_runs: number, required_runs: number }}
 */
export function buildPracticeStatus(requirement = { required: false }, practiceData = {}) {
  const required = !!requirement.required;
  if (!required) {
    return { required: false, completed: true, progress: 1, description: null, completed_runs: 0, required_runs: 0 };
  }
  const requiredRuns = Math.max(1, Number(practiceData.required_runs) || 1);
  const completedRuns = Math.max(0, Number(practiceData.completed_runs) || 0);
  return {
    required: true,
    completed: completedRuns >= requiredRuns,
    progress: Math.min(1, completedRuns / requiredRuns),
    description: requirement.description || null,
    completed_runs: completedRuns,
    required_runs: requiredRuns,
  };
}

// ═══════════════════════════════════════════════════════════════════
// START ELIGIBILITY — PREFLIGHT RESULT CONTRACT
// ═══════════════════════════════════════════════════════════════════

/**
 * Compute start eligibility from every preflight component.
 * Returns the machine-readable contract: eligible + blockers + warnings.
 * The student sees every blocker before start (done condition §25).
 *
 * @param {Object} parts
 * @param {Object} parts.availability - computeAvailabilityWindow result
 * @param {{ in_snapshot: boolean }} parts.roster - checkRosterMembership result
 * @param {{ available: boolean }} parts.brief - sanitizeBriefForStudent result
 * @param {{ available: boolean }} parts.policy - sanitizePolicyForStudent result
 * @param {{ required: boolean, completed: boolean }} parts.practice - buildPracticeStatus result
 * @param {{ ok: boolean }} parts.device - buildDeviceCheck result
 * @param {{ camera_required: boolean, camera_ok: boolean, seb_required: boolean, seb_ok: boolean }} parts.security - buildSecurityCheck result
 * @param {{ required: boolean, confirmed: boolean }} [parts.accommodation]
 * @returns {{ eligible: boolean, blockers: Array<{code:string,message:string}>, warnings: Array<string> }}
 */
export function computeStartEligibility({
  availability = {},
  roster = {},
  brief = {},
  policy = {},
  practice = {},
  device = {},
  security = {},
  accommodation = { required: false, confirmed: false },
} = {}) {
  const blockers = [];
  const warnings = [];
  const addBlocker = (code) => blockers.push({ code, message: BLOCKER_MESSAGES[code] || code });

  if (roster.in_snapshot !== true) addBlocker(BLOCKER_CODES.NOT_ASSIGNED);
  if (availability.status === AVAILABILITY_STATUS.NOT_STARTED) addBlocker(BLOCKER_CODES.NOT_STARTED);
  if (availability.status === AVAILABILITY_STATUS.CLOSED) addBlocker(BLOCKER_CODES.CLOSED);
  if (availability.status === AVAILABILITY_STATUS.UNSCHEDULED) {
    // Unscheduled is a blocker for high-stakes but only a warning for others —
    // we treat it as a blocker so the student is never surprised.
    addBlocker(BLOCKER_CODES.UNSCHEDULED);
  }
  if (brief.available !== true) addBlocker(BLOCKER_CODES.BRIEF_UNAVAILABLE);
  if (policy.available !== true) addBlocker(BLOCKER_CODES.POLICY_UNAVAILABLE);
  if (practice.required === true && practice.completed !== true) addBlocker(BLOCKER_CODES.PRACTICE_REQUIRED);
  if (device.ok !== true) addBlocker(BLOCKER_CODES.DEVICE_UNSUPPORTED);
  if (security.camera_required === true && security.camera_ok !== true) addBlocker(BLOCKER_CODES.CAMERA_REQUIRED);
  if (security.seb_required === true && security.seb_ok !== true) addBlocker(BLOCKER_CODES.SEB_REQUIRED);
  if (accommodation.required === true && accommodation.confirmed !== true) addBlocker(BLOCKER_CODES.ACCOMMODATION_UNCONFIRMED);

  // Warnings are non-blocking but surfaced to the student
  if (device.checks?.some((c) => c.name === DEVICE_CHECKS.SCREEN && c.ok && c.detail?.includes('unknown'))) {
    warnings.push('Screen size could not be verified — continue only on a trusted device');
  }
  if (device.checks?.some((c) => c.name === DEVICE_CHECKS.NETWORK && c.ok && c.detail?.includes('unknown'))) {
    warnings.push('Network type could not be verified — a stable connection is required');
  }

  return { eligible: blockers.length === 0, blockers, warnings };
}

// ═══════════════════════════════════════════════════════════════════
// IDEMPOTENCY KEY
// ═══════════════════════════════════════════════════════════════════

/**
 * Derive the idempotency key for a preflight run: assignment + user + day
 * (UTC date). Re-running the same day returns the existing row.
 *
 * @param {number} assignmentId
 * @param {number} userId
 * @param {string|number|Date} [now]
 * @returns {string}
 */
export function derivePreflightKey(assignmentId, userId, now = Date.now()) {
  const day = new Date(now).toISOString().slice(0, 10);
  return crypto.createHash('sha256')
    .update(`preflight:${assignmentId}:${userId}:${day}`)
    .digest('hex')
    .slice(0, 32);
}
