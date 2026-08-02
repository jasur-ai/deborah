/**
 * Edikit — Privacy-first Camera Evidence Pilot Tests
 *
 * Covers (Prompt 37):
 *   - Evidence flag whitelist + forbidden fields (emotion/gaze/honesty/
 *     misconduct — §15 data guard)
 *   - Normal frame discard (§11 — raw frame non-retention)
 *   - Consecutive-window threshold (§10)
 *   - Consent contract: none/granted/revoked/version-mismatch (§07, §27.5)
 *   - Retention computation + expiry (§13)
 *   - Disposition lifecycle — human review only (§14)
 *   - Pilot status sanitization (storage key never exposed)
 *   - Service graceful degradation without PostgreSQL
 */

import { describe, it, expect } from 'vitest';

import {
  // schema (pure)
  CAMERA_PILOT_DEFAULTS,
  CAMERA_EVIDENCE_FLAGS,
  CAMERA_FORBIDDEN_FIELDS,
  validateEvidenceFlags,
  evaluateConsecutiveWindow,
  shouldDiscardSample,
  deriveConsentState,
  computeRetentionUntil,
  isRetentionExpired,
  validateDispositionTransition,
  buildPilotStatus,
  sanitizeEvidenceRow,
} from '../../src/modules/camera/camera.schema.js';

import {
  // service
  getCameraPilotPolicy,
  upsertCameraPilotPolicy,
  grantCameraConsent,
  revokeCameraConsent,
  recordCameraEvidence,
  getCameraReviewTimeline,
  reviewCameraEvidence,
  enforceCameraRetention,
  getStudentPilotStatus,
} from '../../src/modules/camera/camera.service.js';

// ═══════════════════════════════════════════════════════════════════
// EVIDENCE FLAG WHITELIST & FORBIDDEN FIELDS (§15)
// ═══════════════════════════════════════════════════════════════════

describe('Camera — evidence flag validation', () => {
  it('should accept whitelisted flags only', () => {
    const v = validateEvidenceFlags({ face_present: true, face_count: 1, phone_detected: false, freeze_detected: false });
    expect(v.ok).toBe(true);
    expect(CAMERA_EVIDENCE_FLAGS).toContain('face_present');
  });

  it('should reject unknown flags', () => {
    const v = validateEvidenceFlags({ face_present: true, location: 'x' });
    expect(v.ok).toBe(false);
    expect(v.errors.join(' ')).toMatch(/unknown flag: location/);
  });

  it('should REJECT emotion/gaze/honesty/misconduct fields (data guard §15)', () => {
    for (const field of CAMERA_FORBIDDEN_FIELDS) {
      const v = validateEvidenceFlags({ [field]: true });
      expect(v.ok).toBe(false);
      expect(v.errors.join(' ')).toMatch(/forbidden field/);
    }
  });

  it('should reject automatic misconduct scoring fields', () => {
    const v = validateEvidenceFlags({ face_present: true, automatic_misconduct: true, cheat_probability: 0.9 });
    expect(v.ok).toBe(false);
    expect(v.errors.join(' ')).toMatch(/automatic_misconduct/);
    expect(v.errors.join(' ')).toMatch(/cheat_probability/);
  });

  it('should reject a mixed payload with a forbidden field even among valid flags', () => {
    const v = validateEvidenceFlags({ face_present: true, honesty_score: 0.9, phone_detected: false });
    expect(v.ok).toBe(false);
  });

  it('should validate face_count and boolean types', () => {
    expect(validateEvidenceFlags({ face_count: -1 }).ok).toBe(false);
    expect(validateEvidenceFlags({ face_count: 1.5 }).ok).toBe(false);
    expect(validateEvidenceFlags({ face_present: 'yes' }).ok).toBe(false);
    expect(validateEvidenceFlags({ face_count: 2 }).ok).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════
// NORMAL FRAME DISCARD — RAW-FRAME NON-RETENTION (§11)
// ═══════════════════════════════════════════════════════════════════

describe('Camera — normal frame discard / non-retention', () => {
  it('should discard a normal frame (no deviation)', () => {
    const d = shouldDiscardSample({ face_present: true, face_count: 1, phone_detected: false, freeze_detected: false });
    expect(d.discard).toBe(true);
    expect(d.reason).toMatch(/normal frame/);
  });

  it('should KEEP a phone-detected frame', () => {
    expect(shouldDiscardSample({ face_present: true, phone_detected: true }).discard).toBe(false);
  });

  it('should KEEP a freeze-detected frame', () => {
    expect(shouldDiscardSample({ face_present: true, freeze_detected: true }).discard).toBe(false);
  });

  it('should KEEP a no-face frame', () => {
    expect(shouldDiscardSample({ face_present: false, face_count: 0 }).discard).toBe(false);
  });

  it('should KEEP a multi-face frame', () => {
    expect(shouldDiscardSample({ face_present: true, face_count: 2 }).discard).toBe(false);
  });

  it('should force-keep when forceKeep is true (threshold signal)', () => {
    expect(shouldDiscardSample({ face_present: true, face_count: 1 }, true).discard).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════
// CONSECUTIVE-WINDOW THRESHOLD (§10)
// ═══════════════════════════════════════════════════════════════════

describe('Camera — consecutive-window threshold', () => {
  const t0 = 1_700_000_000_000;

  it('should trigger when a flag repeats within the window', () => {
    const samples = [
      { captured_at: t0, flags: { phone_detected: true } },
      { captured_at: t0 + 1500, flags: { phone_detected: true } },
    ];
    const r = evaluateConsecutiveWindow({ samples, flag: 'phone_detected', windowMs: 3000, minCount: 2 });
    expect(r.triggered).toBe(true);
    expect(r.count).toBe(2);
  });

  it('should NOT trigger when hits are outside the window', () => {
    const samples = [
      { captured_at: t0, flags: { phone_detected: true } },
      { captured_at: t0 + 5000, flags: { phone_detected: true } },
    ];
    const r = evaluateConsecutiveWindow({ samples, flag: 'phone_detected', windowMs: 3000, minCount: 2 });
    expect(r.triggered).toBe(false);
  });

  it('should NOT trigger below minCount', () => {
    const samples = [
      { captured_at: t0, flags: { phone_detected: true } },
      { captured_at: t0 + 2000, flags: { face_present: true } },
    ];
    const r = evaluateConsecutiveWindow({ samples, flag: 'phone_detected', windowMs: 3000, minCount: 2 });
    expect(r.triggered).toBe(false);
  });

  it('should reset the run on a non-hit sample', () => {
    const samples = [
      { captured_at: t0, flags: { phone_detected: true } },
      { captured_at: t0 + 500, flags: { face_present: true } },
      { captured_at: t0 + 1000, flags: { phone_detected: true } },
      { captured_at: t0 + 1500, flags: { phone_detected: true } },
    ];
    // The last run is count 2 within 500ms → triggered
    const r = evaluateConsecutiveWindow({ samples, flag: 'phone_detected', windowMs: 3000, minCount: 2 });
    expect(r.triggered).toBe(true);
  });

  it('should reject an unknown flag', () => {
    const r = evaluateConsecutiveWindow({ samples: [], flag: 'gaze' });
    expect(r.triggered).toBe(false);
    expect(r.error).toBeTruthy();
  });
});

// ═══════════════════════════════════════════════════════════════════
// CONSENT CONTRACT (§07, §27.5)
// ═══════════════════════════════════════════════════════════════════

describe('Camera — consent contract', () => {
  it('no row → none, requires consent', () => {
    const c = deriveConsentState(null, 1);
    expect(c.state).toBe('none');
    expect(c.requires_consent).toBe(true);
  });

  it('granted with matching version → ok', () => {
    const c = deriveConsentState({ consent_version: 1, granted_at: '2026-01-01', revoked_at: null }, 1);
    expect(c.state).toBe('granted');
    expect(c.requires_consent).toBe(false);
    expect(c.version_match).toBe(true);
  });

  it('granted with stale version → re-consent required', () => {
    const c = deriveConsentState({ consent_version: 1, granted_at: '2026-01-01', revoked_at: null }, 2);
    expect(c.state).toBe('granted');
    expect(c.requires_consent).toBe(true);
    expect(c.version_match).toBe(false);
  });

  it('revoked → requires consent', () => {
    const c = deriveConsentState({ consent_version: 1, granted_at: '2026-01-01', revoked_at: '2026-01-02' }, 1);
    expect(c.state).toBe('revoked');
    expect(c.requires_consent).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════
// RETENTION (§13)
// ═══════════════════════════════════════════════════════════════════

describe('Camera — retention', () => {
  it('should compute a 30-day retention expiry', () => {
    const from = 1_700_000_000_000;
    const until = computeRetentionUntil(30, from);
    expect(until).toBe(from + 30 * 24 * 60 * 60 * 1000);
  });

  it('should return null for 0/negative days (no expiry)', () => {
    expect(computeRetentionUntil(0)).toBeNull();
    expect(computeRetentionUntil(-5)).toBeNull();
  });

  it('should detect expired retention', () => {
    const until = Date.now() - 1000;
    expect(isRetentionExpired(until)).toBe(true);
    expect(isRetentionExpired(Date.now() + 1000)).toBe(false);
    expect(isRetentionExpired(null)).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════
// DISPOSITION LIFECYCLE (§14 — human review only)
// ═══════════════════════════════════════════════════════════════════

describe('Camera — disposition lifecycle', () => {
  it('should allow pending → cleared/reviewed/discarded', () => {
    expect(validateDispositionTransition('pending', 'cleared').ok).toBe(true);
    expect(validateDispositionTransition('pending', 'reviewed').ok).toBe(true);
    expect(validateDispositionTransition('pending', 'discarded').ok).toBe(true);
  });

  it('should forbid discarded → anything', () => {
    expect(validateDispositionTransition('discarded', 'cleared').ok).toBe(false);
    expect(validateDispositionTransition('discarded', 'reviewed').ok).toBe(false);
  });

  it('should forbid cleared → discarded (need review first)', () => {
    expect(validateDispositionTransition('cleared', 'discarded').ok).toBe(false);
  });

  it('should allow reviewed → cleared and cleared → reviewed (correction)', () => {
    expect(validateDispositionTransition('reviewed', 'cleared').ok).toBe(true);
    expect(validateDispositionTransition('cleared', 'reviewed').ok).toBe(true);
  });

  it('should reject unknown source', () => {
    expect(validateDispositionTransition('nope', 'cleared').ok).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════
// SANITIZED UI PAYLOADS (§13)
// ═══════════════════════════════════════════════════════════════════

describe('Camera — sanitized payloads', () => {
  it('should not expose storage_key to students by default', () => {
    const s = sanitizeEvidenceRow({ id: 1, storage_key: 'secret/key.png', content_hash: 'abc123' }, false);
    expect(s.storage_key).toBeNull();
    expect(s.content_hash).toBe('abc123');
  });

  it('should expose storage_key only with includeStorageKey (teacher)', () => {
    const s = sanitizeEvidenceRow({ id: 1, storage_key: 'secret/key.png', content_hash: 'abc123' }, true);
    expect(s.storage_key).toBe('secret/key.png');
  });

  it('should build a pilot status with never_collected list (privacy transparency)', () => {
    const s = buildPilotStatus({ policy: { pilot_enabled: true, consent_version: 1 } });
    expect(s.pilot_enabled).toBe(true);
    expect(s.never_collected).toEqual(expect.arrayContaining(['emotion', 'gaze', 'honesty_score', 'raw_frames', 'audio']));
    expect(JSON.stringify(s)).not.toMatch(/storage_key/);
  });
});

// ═══════════════════════════════════════════════════════════════════
// SERVICE GRACEFUL DEGRADATION (no PostgreSQL)
// ═══════════════════════════════════════════════════════════════════

describe('Camera — service graceful degradation', () => {
  it('getCameraPilotPolicy returns safe defaults without PG (pilot OFF)', async () => {
    const p = await getCameraPilotPolicy();
    expect(p.pilot_enabled).toBe(false);
    expect(p.retention_days).toBe(CAMERA_PILOT_DEFAULTS.retentionDays);
    expect(p.fps_min).toBeGreaterThanOrEqual(2);
    expect(p.fps_max).toBeLessThanOrEqual(5);
  });

  it('upsertCameraPilotPolicy throws PostgreSQL required without PG', async () => {
    await expect(upsertCameraPilotPolicy({ pilotEnabled: true })).rejects.toThrow(/PostgreSQL required/i);
  });

  it('grantCameraConsent throws PostgreSQL required without PG', async () => {
    await expect(grantCameraConsent({ userId: 1, assignmentId: 1 })).rejects.toThrow(/PostgreSQL required/i);
  });

  it('recordCameraEvidence skips gracefully without PG (pilot default OFF → no-op)', async () => {
    const r = await recordCameraEvidence({ attemptId: 1, userId: 1, samples: [{ client_seq: 1, flags: { phone_detected: true } }] });
    expect(r.ok).toBe(true);
    expect(r.skipped).toBe(true);
    expect(r.reason).toMatch(/disabled/);
  });

  it('getCameraReviewTimeline reports unavailable without PG', async () => {
    const r = await getCameraReviewTimeline(1);
    expect(r.ok).toBe(false);
    expect(r.reason).toBeTruthy();
  });

  it('enforceCameraRetention no-ops without PG', async () => {
    const r = await enforceCameraRetention();
    expect(r.ok).toBe(false);
  });
});
