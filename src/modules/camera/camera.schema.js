/**
 * Edikit — Privacy-first Camera Evidence Pilot (pure logic)
 *
 * Prompt 37 — local inference, LIMITED evidence, human review (research.md
 * §27 — evidence portfolio, surveillance emas). Pure, DB-free logic:
 *
 *   - Camera pilot policy: per-tenant flag, 2–5 FPS pipeline bounds,
 *     consecutive-window threshold, per-attempt snapshot limit, retention.
 *   - Consent contract: informed consent versioned against the policy;
 *     revocable; camera monitoring NEVER runs without consent (alternative
 *     path when not consented — §25 done condition).
 *   - Evidence flags whitelist: faqat { face_present, face_count,
 *     phone_detected, freeze_detected }. Boshqa hech narsa saqlanmaydi.
 *   - DATA GUARD (Prompt 37 §15): emotion, gaze, honesty score va automatic
 *     misconduct — umuman TAQIQLANGAN. Har qanday bunday maydonli payload
 *     REJECT qilinadi (validateEvidenceFlags). Bundan tashqari raw frame/
 *     video YO'Q — faqat policy ruxsat berganda cheklangan snapshot hash'i.
 *   - Consecutive-window threshold: bir xil og'ish flag'i window_ms ichida
 *     consecutive kuzatilsa → flag'd (human review uchun signal), avtomatik
 *     hukm EMAS.
 *   - Disposition lifecycle: pending → cleared | reviewed | discarded —
 *     faqat inson (teacher) qarori, avtomatik misconduct yo'q.
 *   - Retention: retention_days dan keyin evidence expire (deleted).
 *
 * Purity: no I/O, no globals — fully unit-testable without PostgreSQL.
 */

// ═══════════════════════════════════════════════════════════════════
// PILOT POLICY DEFAULTS
// ═══════════════════════════════════════════════════════════════════

export const CAMERA_PILOT_DEFAULTS = {
  pilotEnabled: false,
  fpsMin: 2,
  fpsMax: 5,
  windowMs: 3000,
  snapshotLimit: 10,
  retentionDays: 30,
  consentVersion: 1,
};

/** Pilot allowed FPS bounds (2–5 FPS pipeline, Prompt 37 §08). */
export const CAMERA_FPS_BOUNDS = { min: 2, max: 5 };

// ═══════════════════════════════════════════════════════════════════
// EVIDENCE FLAG WHITELIST & FORBIDDEN FIELDS
// ═══════════════════════════════════════════════════════════════════

/**
 * ALLOWED evidence flags — local inference chiqaradigan yagona maydonlar.
 * face_present: kamera oldida yuz bormi; face_count: nechta yuz;
 * phone_detected: telefon tutib turish; freeze_detected: muzlatilgan frame.
 */
export const CAMERA_EVIDENCE_FLAGS = [
  'face_present',
  'face_count',
  'phone_detected',
  'freeze_detected',
];

/**
 * FORBIDDEN fields — Prompt 37 §15 data guard. Emotion, gaze, honesty score
 * va automatic misconduct — hech qachon saqlanmaydi va reject qilinadi.
 */
export const CAMERA_FORBIDDEN_FIELDS = [
  'emotion',
  'gaze',
  'honesty',
  'honesty_score',
  'misconduct',
  'automatic_misconduct',
  'cheat_probability',
  'attention_score',
];

/**
 * Validate an evidence flags payload against the strict whitelist.
 *   - unknown flag keys → reject
 *   - any FORBIDDEN field (emotion/gaze/honesty/misconduct…) → reject
 *   - face_count must be a non-negative integer when present
 *   - booleans must be real booleans
 *
 * @param {Object} flags
 * @returns {{ ok: boolean, flags?: Object, errors?: string[] }}
 */
export function validateEvidenceFlags(flags = {}) {
  const errors = [];
  if (!flags || typeof flags !== 'object' || Array.isArray(flags)) {
    return { ok: false, errors: ['flags must be an object'] };
  }

  for (const key of Object.keys(flags)) {
    if (CAMERA_FORBIDDEN_FIELDS.includes(key)) {
      errors.push(`forbidden field: ${key} (emotion/gaze/honesty/misconduct are never stored)`);
    } else if (!CAMERA_EVIDENCE_FLAGS.includes(key)) {
      errors.push(`unknown flag: ${key}`);
    }
  }

  if (Object.prototype.hasOwnProperty.call(flags, 'face_count')) {
    const c = flags.face_count;
    if (!Number.isInteger(c) || c < 0) {
      errors.push('face_count must be a non-negative integer');
    }
  }
  for (const boolKey of ['face_present', 'phone_detected', 'freeze_detected']) {
    if (Object.prototype.hasOwnProperty.call(flags, boolKey) && typeof flags[boolKey] !== 'boolean') {
      errors.push(`${boolKey} must be a boolean`);
    }
  }

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, flags };
}

// ═══════════════════════════════════════════════════════════════════
// CONSECUTIVE-WINDOW THRESHOLD (§10)
// ═══════════════════════════════════════════════════════════════════

/**
 * Evaluate a consecutive-window flag signal.
 *
 * Bir xil og'ish flag'i (masalan phone_detected) `windowMs` ichida ketma-ket
 * kuzatilsa → true (flag'd — HUMAN REVIEW uchun signal). Avtomatik misconduct
 * hukmi yo'q — faqat review timeline'ga signal qo'shiladi.
 *
 * @param {Object} params
 * @param {Array<{ captured_at: number, flags: Object }>} params.samples
 *   - ascending-time samples; captured_at epoch ms
 * @param {string} params.flag - whitelisted flag key (e.g. 'phone_detected')
 * @param {number} [params.windowMs] - consecutive window (default 3000)
 * @param {number} [params.minCount] - minimum consecutive hits (default 2)
 * @returns {{ triggered: boolean, count: number, spanMs: number|null }}
 */
export function evaluateConsecutiveWindow({
  samples = [],
  flag,
  windowMs = CAMERA_PILOT_DEFAULTS.windowMs,
  minCount = 2,
} = {}) {
  if (!flag || !CAMERA_EVIDENCE_FLAGS.includes(flag)) {
    return { triggered: false, count: 0, spanMs: null, error: `unknown flag: ${flag}` };
  }

  let best = { count: 0, spanMs: null };
  let run = { count: 0, start: null };

  for (const s of samples) {
    const hit = s && typeof s.flags === 'object' && s.flags[flag] === true;
    if (!hit) {
      run = { count: 0, start: null };
      continue;
    }
    const t = Number(s.captured_at) || 0;
    if (run.count === 0) run = { count: 1, start: t };
    else {
      run.count += 1;
      run.spanMs = t - run.start;
    }
    if (run.count > best.count) best = { count: run.count, spanMs: run.spanMs };
  }

  const triggered = best.count >= minCount && best.spanMs !== null && best.spanMs <= windowMs;
  return { triggered, count: best.count, spanMs: best.spanMs };
}

// ═══════════════════════════════════════════════════════════════════
// NORMAL FRAME DISCARD (§11)
// ═══════════════════════════════════════════════════════════════════

/**
 * Decide whether a sample should be PERSISTED as evidence or DISCARDED.
 *
 * Privacy-first: normal frames (hech qanday og'ish flag'i yo'q) hech qachon
 * saqlanmaydi. Faqat og'ish flag'langan sample'lar saqlanadi (limited
 * evidence). `forceKeep` — threshold signali qo'shilganda saqlash uchun.
 *
 * @param {Object} flags - validated flags
 * @param {boolean} [forceKeep]
 * @returns {{ discard: boolean, reason: string }}
 */
export function shouldDiscardSample(flags = {}, forceKeep = false) {
  const deviates =
    flags.phone_detected === true ||
    flags.freeze_detected === true ||
    flags.face_present === false ||
    (Number.isInteger(flags.face_count) && flags.face_count > 1);
  if (deviates || forceKeep) return { discard: false, reason: 'deviation signal' };
  return { discard: true, reason: 'normal frame (not retained)' };
}

// ═══════════════════════════════════════════════════════════════════
// CONSENT CONTRACT (§07, §27.5)
// ═══════════════════════════════════════════════════════════════════

export const CONSENT_STATES = {
  NONE: 'none', // no consent row
  GRANTED: 'granted',
  REVOKED: 'revoked',
};

/**
 * Derive the effective consent state for (user, assignment).
 * Consent version mismatch (policy update) → requires re-consent.
 *
 * @param {Object} row - { consent_version, granted_at, revoked_at } or null
 * @param {number} policyConsentVersion
 * @returns {{ state: string, requires_consent: boolean, version_match: boolean }}
 */
export function deriveConsentState(row = null, policyConsentVersion = CAMERA_PILOT_DEFAULTS.consentVersion) {
  if (!row) {
    return { state: CONSENT_STATES.NONE, requires_consent: true, version_match: false };
  }
  if (row.revoked_at) {
    return { state: CONSENT_STATES.REVOKED, requires_consent: true, version_match: false };
  }
  const versionMatch = Number(row.consent_version) === Number(policyConsentVersion);
  return {
    state: CONSENT_STATES.GRANTED,
    requires_consent: !versionMatch,
    version_match: versionMatch,
  };
}

// ═══════════════════════════════════════════════════════════════════
// RETENTION (§13)
// ═══════════════════════════════════════════════════════════════════

/**
 * Compute the retention expiry timestamp for evidence.
 *
 * @param {number} days - retention days (default 30)
 * @param {number|null} [fromMs] - base time (default now)
 * @returns {number|null} epoch ms retention_until, or null when 0 days
 */
export function computeRetentionUntil(days = CAMERA_PILOT_DEFAULTS.retentionDays, fromMs = null) {
  if (!Number.isInteger(days) || days <= 0) return null;
  const base = fromMs ?? Date.now();
  return base + days * 24 * 60 * 60 * 1000;
}

/**
 * True when an evidence row's retention has expired (must be deleted).
 *
 * @param {number|null} retentionUntilMs
 * @param {number} [nowMs]
 * @returns {boolean}
 */
export function isRetentionExpired(retentionUntilMs, nowMs = Date.now()) {
  if (!retentionUntilMs) return false;
  return retentionUntilMs < nowMs;
}

// ═══════════════════════════════════════════════════════════════════
// DISPOSITION LIFECYCLE (§14 — human review only)
// ═══════════════════════════════════════════════════════════════════

export const DISPOSITION_STATES = {
  PENDING: 'pending',
  CLEARED: 'cleared',
  REVIEWED: 'reviewed', // flagged — human confirmed an anomaly (review signal)
  DISCARDED: 'discarded',
};

const DISPOSITION_TRANSITIONS = {
  [DISPOSITION_STATES.PENDING]: [DISPOSITION_STATES.CLEARED, DISPOSITION_STATES.REVIEWED, DISPOSITION_STATES.DISCARDED],
  [DISPOSITION_STATES.CLEARED]: [DISPOSITION_STATES.REVIEWED],
  [DISPOSITION_STATES.REVIEWED]: [DISPOSITION_STATES.CLEARED],
  [DISPOSITION_STATES.DISCARDED]: [],
};

/**
 * Validate a disposition transition (human review only — §14).
 *
 * @param {string} from
 * @param {string} to
 * @returns {{ ok: boolean, errors?: string[] }}
 */
export function validateDispositionTransition(from, to) {
  const allowed = DISPOSITION_TRANSITIONS[from];
  if (!allowed) return { ok: false, errors: [`unknown source disposition: ${from}`] };
  if (!allowed.includes(to)) {
    return { ok: false, errors: [`disposition ${from} → ${to} not allowed`] };
  }
  return { ok: true };
}

// ═══════════════════════════════════════════════════════════════════
// SANITIZED UI PAYLOADS (§13)
// ═══════════════════════════════════════════════════════════════════

/**
 * Build the sanitized pilot status payload for the student UI.
 * Hech qachon storage_key yoki content_hash ko'rinmaydi.
 *
 * @param {Object} params
 * @param {Object} params.policy - pilot policy (raw row shape)
 * @param {Object|null} params.consentRow
 * @param {Object|null} [params.assignment]
 * @returns {Object} status contract
 */
export function buildPilotStatus({ policy = {}, consentRow = null, assignment = null } = {}) {
  const consent = deriveConsentState(consentRow, policy.consent_version ?? CAMERA_PILOT_DEFAULTS.consentVersion);
  return {
    pilot_enabled: policy.pilot_enabled === true,
    fps_bounds: {
      min: policy.fps_min ?? CAMERA_PILOT_DEFAULTS.fpsMin,
      max: policy.fps_max ?? CAMERA_PILOT_DEFAULTS.fpsMax,
    },
    window_ms: policy.window_ms ?? CAMERA_PILOT_DEFAULTS.windowMs,
    snapshot_limit: policy.snapshot_limit ?? CAMERA_PILOT_DEFAULTS.snapshotLimit,
    retention_days: policy.retention_days ?? CAMERA_PILOT_DEFAULTS.retentionDays,
    consent: {
      state: consent.state,
      version: policy.consent_version ?? CAMERA_PILOT_DEFAULTS.consentVersion,
      version_match: consent.version_match,
      requires_consent: consent.requires_consent,
    },
    collected: ['face_present', 'face_count', 'phone_detected', 'freeze_detected'],
    never_collected: ['emotion', 'gaze', 'honesty_score', 'raw_frames', 'audio'],
    assignment_title: assignment?.title ?? null,
  };
}

/**
 * Sanitize a single evidence row for the REVIEW UI.
 * storage_key faqat privilege'd (teacher) kontekstda ochiladi — default
 * closed. content_hash ochiladi (tamper-evident tekshiruv uchun).
 *
 * @param {Object} row - raw DB row
 * @param {boolean} [includeStorageKey]
 * @returns {Object} sanitized evidence view
 */
export function sanitizeEvidenceRow(row = {}, includeStorageKey = false) {
  return {
    id: row.id,
    event_type: row.event_type,
    flags: row.flags || {},
    captured_at: row.captured_at,
    client_seq: row.client_seq,
    disposition: row.disposition,
    retention_until: row.retention_until,
    content_hash: row.content_hash ?? null,
    storage_key: includeStorageKey ? (row.storage_key ?? null) : null,
  };
}
