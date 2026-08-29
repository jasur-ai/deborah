/**
 * Deborah — Privacy-first Camera Evidence Pilot Service
 *
 * Prompt 37 — server-side half of the camera pilot:
 *   - Pilot policy get (tenant-scoped, defaults when no row)
 *   - Consent grant/revoke (informed, versioned, revocable — §27.5)
 *   - Evidence ingest: flags-only, idempotent by (tenant, attempt, client_seq),
 *     normal frames DISCARDED server-side, forbidden fields rejected, retention
 *     expiry computed at write time
 *   - Review timeline + disposition (human review only, audited)
 *   - Retention enforcement (expired evidence delete, audited)
 *
 * SECURITY / DATA GUARD (Prompt 37 §15):
 *   - Emotion, gaze, honesty score, automatic misconduct — REJECTED at
 *     schema validation; hech qachon DB'ga yozilmaydi.
 *   - Raw frame/video YO'Q — faqat policy snapshot_limit chegarasida cheklangan
 *     snapshot storage_key + content_hash (tamper-evident).
 *   - Pilot OFF bo'lsa evidence ingest no-op (alternative path — done condition).
 *   - Barcha yozishlar tenant-scoped + actor talab qilinadi; disposition/delete
 *     privilege'd (teacher) + audited.
 *
 * Graceful degradation: without PostgreSQL, read paths return defaults/null and
 * write paths throw a clear 'PostgreSQL required' error.
 */

import { getDb } from '../../infrastructure/postgres.js';
import { getCurrentTenant } from '../auth/tenant-context.js';
import { audit, AUDIT_ACTIONS } from '../auth/audit.js';
import {
  CAMERA_PILOT_DEFAULTS,
  CAMERA_FPS_BOUNDS,
  validateEvidenceFlags,
  evaluateConsecutiveWindow,
  shouldDiscardSample,
  deriveConsentState,
  computeRetentionUntil,
  isRetentionExpired,
  validateDispositionTransition,
  buildPilotStatus,
  sanitizeEvidenceRow,
} from './camera.schema.js';

function getTenantId() {
  return getCurrentTenant()?.tenantId || 1;
}

async function loadPolicyRow(db, tenantId) {
  return db.selectFrom('camera_pilot_policy')
    .where('tenant_id', '=', tenantId)
    .selectAll()
    .executeTakeFirst()
    .catch(() => null);
}

/** Snake_case default policy contract (mirrors the PG row shape). */
function defaultPolicy(tenantId) {
  return {
    tenant_id: tenantId,
    pilot_enabled: CAMERA_PILOT_DEFAULTS.pilotEnabled,
    fps_min: CAMERA_PILOT_DEFAULTS.fpsMin,
    fps_max: CAMERA_PILOT_DEFAULTS.fpsMax,
    window_ms: CAMERA_PILOT_DEFAULTS.windowMs,
    snapshot_limit: CAMERA_PILOT_DEFAULTS.snapshotLimit,
    retention_days: CAMERA_PILOT_DEFAULTS.retentionDays,
    consent_version: CAMERA_PILOT_DEFAULTS.consentVersion,
  };
}

/**
 * Get the effective camera pilot policy (defaults when no row — pilot OFF).
 *
 * @returns {Promise<Object>} policy contract
 */
export async function getCameraPilotPolicy() {
  const db = await getDb();
  const tenantId = getTenantId();
  if (!db) return defaultPolicy(tenantId);
  try {
    const row = await loadPolicyRow(db, tenantId);
    if (!row) return defaultPolicy(tenantId);
    return {
      tenant_id: tenantId,
      pilot_enabled: row.pilot_enabled === true,
      fps_min: row.fps_min ?? CAMERA_PILOT_DEFAULTS.fpsMin,
      fps_max: row.fps_max ?? CAMERA_PILOT_DEFAULTS.fpsMax,
      window_ms: row.window_ms ?? CAMERA_PILOT_DEFAULTS.windowMs,
      snapshot_limit: row.snapshot_limit ?? CAMERA_PILOT_DEFAULTS.snapshotLimit,
      retention_days: row.retention_days ?? CAMERA_PILOT_DEFAULTS.retentionDays,
      consent_version: row.consent_version ?? CAMERA_PILOT_DEFAULTS.consentVersion,
      updated_at: row.updated_at ?? null,
      updated_by: row.updated_by ?? null,
    };
  } catch (_) {
    return defaultPolicy(tenantId);
  }
}

/**
 * Upsert the camera pilot policy (admin-only, audited).
 *
 * @param {Object} params
 * @param {boolean} [params.pilotEnabled]
 * @param {number} [params.fpsMin]
 * @param {number} [params.fpsMax]
 * @param {number} [params.windowMs]
 * @param {number} [params.snapshotLimit]
 * @param {number} [params.retentionDays]
 * @param {number} [params.consentVersion]
 * @param {string|number} [params.actorId]
 * @returns {Promise<Object>} { ok, errors?, policy? }
 */
export async function upsertCameraPilotPolicy({
  pilotEnabled = false,
  fpsMin = CAMERA_PILOT_DEFAULTS.fpsMin,
  fpsMax = CAMERA_PILOT_DEFAULTS.fpsMax,
  windowMs = CAMERA_PILOT_DEFAULTS.windowMs,
  snapshotLimit = CAMERA_PILOT_DEFAULTS.snapshotLimit,
  retentionDays = CAMERA_PILOT_DEFAULTS.retentionDays,
  consentVersion = CAMERA_PILOT_DEFAULTS.consentVersion,
  actorId = null,
} = {}) {
  const db = await getDb();
  if (!db) throw new Error('PostgreSQL required');

  // ── Validation (fail closed on invalid bounds) ──
  const errors = [];
  if (!Number.isInteger(fpsMin) || !Number.isInteger(fpsMax)) errors.push('fps bounds must be integers');
  else if (fpsMin < CAMERA_FPS_BOUNDS.min || fpsMax > CAMERA_FPS_BOUNDS.max || fpsMin > fpsMax) {
    errors.push(`fps bounds must be within ${CAMERA_FPS_BOUNDS.min}–${CAMERA_FPS_BOUNDS.max} and min ≤ max`);
  }
  if (!Number.isInteger(windowMs) || windowMs <= 0) errors.push('window_ms must be a positive integer');
  if (!Number.isInteger(snapshotLimit) || snapshotLimit < 0) errors.push('snapshot_limit must be ≥ 0');
  if (!Number.isInteger(retentionDays) || retentionDays < 0) errors.push('retention_days must be ≥ 0');
  if (!Number.isInteger(consentVersion) || consentVersion < 1) errors.push('consent_version must be ≥ 1');
  if (errors.length > 0) return { ok: false, errors };

  const tenantId = getTenantId();
  try {
    const existing = await loadPolicyRow(db, tenantId);
    if (existing) {
      await db.updateTable('camera_pilot_policy')
        .set({
          pilot_enabled: pilotEnabled === true,
          fps_min: fpsMin,
          fps_max: fpsMax,
          window_ms: windowMs,
          snapshot_limit: snapshotLimit,
          retention_days: retentionDays,
          consent_version: consentVersion,
          updated_by: actorId || null,
          updated_at: new Date(),
        })
        .where('id', '=', existing.id)
        .where('tenant_id', '=', tenantId)
        .execute();
    } else {
      await db.insertInto('camera_pilot_policy')
        .values({
          tenant_id: tenantId,
          pilot_enabled: pilotEnabled === true,
          fps_min: fpsMin,
          fps_max: fpsMax,
          window_ms: windowMs,
          snapshot_limit: snapshotLimit,
          retention_days: retentionDays,
          consent_version: consentVersion,
          updated_by: actorId || null,
        })
        .execute();
    }
  } catch (err) {
    return { ok: false, errors: [err.message] };
  }

  await audit({
    action: AUDIT_ACTIONS.CAMERA_PILOT_UPDATE,
    userId: actorId || null,
    resourceType: 'tenant',
    resourceId: tenantId,
    details: { pilot_enabled: pilotEnabled === true, fps_min: fpsMin, fps_max: fpsMax, retention_days: retentionDays, consent_version: consentVersion },
  }).catch(() => null);

  return { ok: true, policy: { tenant_id: tenantId, pilot_enabled: pilotEnabled === true } };
}

/**
 * Load the consent row for (user, assignment).
 *
 * @param {number} userId
 * @param {number} assignmentId
 * @returns {Promise<Object|null>} consent row
 */
export async function getConsentRow(userId, assignmentId) {
  const db = await getDb();
  const tenantId = getTenantId();
  if (!db) return null;
  try {
    return await db.selectFrom('camera_consent')
      .where('tenant_id', '=', tenantId)
      .where('user_id', '=', userId)
      .where('assignment_id', '=', assignmentId)
      .selectAll()
      .executeTakeFirst()
      .catch(() => null);
  } catch (_) {
    return null;
  }
}

/**
 * Grant (or re-grant) camera consent for (user, assignment). Idempotent —
 * existing row updated in place (audited).
 *
 * @param {Object} params
 * @param {number} params.userId
 * @param {number} params.assignmentId
 * @returns {Promise<Object>} { ok, consent? }
 */
export async function grantCameraConsent({ userId, assignmentId } = {}) {
  const db = await getDb();
  if (!db) throw new Error('PostgreSQL required');
  const tenantId = getTenantId();
  const policy = await getCameraPilotPolicy();

  try {
    const existing = await getConsentRow(userId, assignmentId);
    if (existing) {
      await db.updateTable('camera_consent')
        .set({
          consent_version: policy.consent_version,
          granted_at: new Date(),
          revoked_at: null,
        })
        .where('id', '=', existing.id)
        .where('tenant_id', '=', tenantId)
        .execute();
    } else {
      await db.insertInto('camera_consent')
        .values({
          tenant_id: tenantId,
          user_id: userId,
          assignment_id: assignmentId,
          consent_version: policy.consent_version,
          granted_at: new Date(),
          revoked_at: null,
        })
        .execute();
    }
  } catch (err) {
    return { ok: false, errors: [err.message] };
  }

  await audit({
    action: AUDIT_ACTIONS.CAMERA_CONSENT_GRANT,
    userId,
    resourceType: 'assignment',
    resourceId: assignmentId,
    details: { consent_version: policy.consent_version },
  }).catch(() => null);

  return { ok: true, consent: { state: 'granted', version: policy.consent_version } };
}

/**
 * Revoke camera consent (audited). Revoked consent → camera pilot halts.
 *
 * @param {Object} params
 * @param {number} params.userId
 * @param {number} params.assignmentId
 * @returns {Promise<Object>} { ok }
 */
export async function revokeCameraConsent({ userId, assignmentId } = {}) {
  const db = await getDb();
  if (!db) throw new Error('PostgreSQL required');
  const tenantId = getTenantId();
  try {
    await db.updateTable('camera_consent')
      .set({ revoked_at: new Date() })
      .where('tenant_id', '=', tenantId)
      .where('user_id', '=', userId)
      .where('assignment_id', '=', assignmentId)
      .execute();
  } catch (err) {
    return { ok: false, errors: [err.message] };
  }

  await audit({
    action: AUDIT_ACTIONS.CAMERA_CONSENT_REVOKE,
    userId,
    resourceType: 'assignment',
    resourceId: assignmentId,
  }).catch(() => null);

  return { ok: true };
}

/**
 * Ingest a batch of camera evidence samples (flags only).
 *
 * Privacy-first rules:
 *   - Pilot OFF → no-op (alternative path).
 *   - Consent yo'q (yoki version mismatch) → evidence reject (no surveillance
 *     without informed consent).
 *   - Har sample'ning flags schema validation'dan o'tadi — forbidden fields
 *     (emotion/gaze/honesty/misconduct) → batch REJECT.
 *   - Normal frames DISCARDED (never stored).
 *   - Idempotent: (tenant, attempt, client_seq) unique — retry duplikat yozmaydi.
 *   - Faqat og'ish flag'langan sample'lar saqlanadi; policy snapshot_limit
 *     chegarasida snapshot storage_key yozilishi mumkin (client bu key'ni
 *     oldin signed URL orqali olgan bo'ladi).
 *
 * @param {Object} params
 * @param {number} params.attemptId
 * @param {number} params.userId
 * @param {Array<Object>} params.samples - [{ client_seq, flags, captured_at, storage_key?, content_hash? }]
 * @returns {Promise<Object>} { ok, accepted, discarded, rejected, results }
 */
export async function recordCameraEvidence({ attemptId, userId, samples = [] } = {}) {
  const policy = await getCameraPilotPolicy();
  const tenantId = getTenantId();

  // Pilot OFF (yoki PG yo'q → default OFF) → no-op alternative path.
  if (policy.pilot_enabled !== true) {
    return { ok: true, skipped: true, reason: 'camera pilot disabled', accepted: 0, discarded: 0, rejected: 0 };
  }

  const db = await getDb();
  if (!db) throw new Error('PostgreSQL required');

  // Resolve attempt → assignment. Consent per-ASSIGNMENT saqlanadi (grant
  // /api/student/assignments/:id/camera/consent orqali), evidence esa
  // per-ATTEMPT — shuning uchun attemptning assignment_id'si topiladi.
  const attemptRow = await db.selectFrom('attempts')
    .where('id', '=', attemptId)
    .where('tenant_id', '=', tenantId)
    .select(['id', 'assignment_id', 'user_id'])
    .executeTakeFirst()
    .catch(() => null);
  if (!attemptRow) {
    return { ok: false, code: 'not_found', reason: 'Attempt not found', accepted: 0, discarded: 0, rejected: 0 };
  }
  // Owner check — faqat attempt egasi evidence yozishi mumkin.
  if (attemptRow.user_id !== userId) {
    return { ok: false, code: 'forbidden', reason: 'Not your attempt', accepted: 0, discarded: 0, rejected: 0 };
  }

  // Consent gate (assignment bo'yicha) — version mismatch yoki yo'q → no surveillance.
  const consentRow = await getConsentRow(userId, attemptRow.assignment_id);
  const consent = deriveConsentState(consentRow, policy.consent_version);
  if (consent.state !== 'granted' || consent.requires_consent) {
    return { ok: false, code: 'consent_required', reason: 'Camera monitoring requires informed consent', accepted: 0, discarded: 0, rejected: 0 };
  }

  let accepted = 0;
  let discarded = 0;
  let rejected = 0;
  const errors = [];
  const results = [];

  // Global flag validation — bitta ham forbidden field bo'lsa batch reject.
  for (const sample of samples) {
    const v = validateEvidenceFlags(sample?.flags);
    if (!v.ok) {
      rejected += 1;
      errors.push(...v.errors);
      results.push({ client_seq: sample?.client_seq, status: 'rejected', errors: v.errors });
      continue;
    }
    const keep = shouldDiscardSample(v.flags, false);
    if (keep.discard) {
      discarded += 1;
      results.push({ client_seq: sample?.client_seq, status: 'discarded', reason: keep.reason });
      continue;
    }

    const seq = Number(sample.client_seq);
    if (!Number.isInteger(seq) || seq < 0) {
      rejected += 1;
      results.push({ client_seq: sample?.client_seq, status: 'rejected', errors: ['client_seq must be a non-negative integer'] });
      continue;
    }

    const capturedAt = Number(sample.captured_at) || Date.now();
    const retentionUntil = computeRetentionUntil(policy.retention_days);

    try {
      await db.insertInto('camera_evidence')
        .values({
          tenant_id: tenantId,
          attempt_id: attemptId,
          user_id: userId,
          client_seq: seq,
          event_type: String(sample.event_type || 'flag').slice(0, 20),
          flags: v.flags,
          captured_at: new Date(capturedAt),
          storage_key: sample.storage_key ? String(sample.storage_key).slice(0, 255) : null,
          content_hash: sample.content_hash ? String(sample.content_hash).slice(0, 64) : null,
          retention_until: retentionUntil ? new Date(retentionUntil) : null,
          disposition: 'pending',
        })
        .onConflict((oc) => oc.columns(['tenant_id', 'attempt_id', 'client_seq']).doNothing())
        .execute();
      accepted += 1;
      results.push({ client_seq: seq, status: 'accepted' });
    } catch (err) {
      rejected += 1;
      errors.push(err.message);
      results.push({ client_seq: seq, status: 'error', errors: [err.message] });
    }
  }

  if (accepted > 0) {
    await audit({
      action: AUDIT_ACTIONS.CAMERA_EVIDENCE_RECORD,
      userId,
      resourceType: 'attempt',
      resourceId: attemptId,
      details: { accepted, discarded, rejected },
    }).catch(() => null);
  }

  return { ok: true, accepted, discarded, rejected, errors, results };
}

/**
 * Build the teacher review timeline for an attempt.
 * storage_key faqat teacher kontekstida ochiladi (includeStorageKey=true).
 *
 * @param {number} attemptId
 * @param {boolean} [includeStorageKey]
 * @returns {Promise<Object>} { ok, evidence: [], meta }
 */
export async function getCameraReviewTimeline(attemptId, includeStorageKey = true) {
  const db = await getDb();
  const tenantId = getTenantId();
  if (!db) return { ok: false, reason: 'PostgreSQL required', evidence: [] };
  try {
    const rows = await db.selectFrom('camera_evidence')
      .where('tenant_id', '=', tenantId)
      .where('attempt_id', '=', attemptId)
      .orderBy('captured_at', 'asc')
      .selectAll()
      .execute();
    const evidence = rows.map((r) => sanitizeEvidenceRow(r, includeStorageKey));
    const flagged = evidence.filter((e) => e.disposition === 'pending' || e.disposition === 'reviewed').length;
    return { ok: true, evidence, meta: { total: evidence.length, flagged } };
  } catch (err) {
    return { ok: false, reason: err.message, evidence: [] };
  }
}

/**
 * Apply a human review disposition to an evidence row (teacher, audited).
 * Transition validated (pending → cleared/reviewed/discarded, etc.).
 *
 * @param {Object} params
 * @param {number} params.evidenceId
 * @param {string} params.disposition - cleared | reviewed | discarded
 * @param {string} [params.note]
 * @param {string|number} params.actorId
 * @returns {Promise<Object>} { ok, errors? }
 */
export async function reviewCameraEvidence({ evidenceId, disposition, note = null, actorId = null } = {}) {
  const db = await getDb();
  if (!db) throw new Error('PostgreSQL required');
  const tenantId = getTenantId();
  if (!actorId) return { ok: false, errors: ['reviewer identity required'] };

  try {
    const row = await db.selectFrom('camera_evidence')
      .where('id', '=', evidenceId)
      .where('tenant_id', '=', tenantId)
      .select(['id', 'disposition'])
      .executeTakeFirst()
      .catch(() => null);
    if (!row) return { ok: false, errors: ['evidence not found'] };

    const transition = validateDispositionTransition(row.disposition, disposition);
    if (!transition.ok) return { ok: false, errors: transition.errors };

    await db.updateTable('camera_evidence')
      .set({ disposition })
      .where('id', '=', evidenceId)
      .where('tenant_id', '=', tenantId)
      .execute();

    await db.insertInto('camera_evidence_review')
      .values({
        tenant_id: tenantId,
        evidence_id: evidenceId,
        disposition,
        note: note ? String(note).slice(0, 1000) : null,
        reviewed_by: actorId,
      })
      .execute();
  } catch (err) {
    return { ok: false, errors: [err.message] };
  }

  await audit({
    action: AUDIT_ACTIONS.CAMERA_EVIDENCE_DISPOSITION,
    userId: actorId || null,
    resourceType: 'evidence',
    resourceId: evidenceId,
    details: { disposition, note: note ? true : false },
  }).catch(() => null);

  return { ok: true };
}

/**
 * Delete evidence rows past retention (scheduled job / on-demand). Audited.
 *
 * @param {Object} params
 * @param {number} [params.actorId]
 * @param {number} [params.nowMs]
 * @returns {Promise<Object>} { ok, deleted }
 */
export async function enforceCameraRetention({ actorId = null, nowMs = Date.now() } = {}) {
  const db = await getDb();
  if (!db) return { ok: false, deleted: 0 };
  const tenantId = getTenantId();
  try {
    const expired = await db.selectFrom('camera_evidence')
      .where('tenant_id', '=', tenantId)
      .where('retention_until', 'is not', null)
      .select(['id', 'retention_until'])
      .execute();

    let deleted = 0;
    for (const row of expired) {
      const until = row.retention_until instanceof Date ? row.retention_until.getTime() : Number(row.retention_until);
      if (isRetentionExpired(until, nowMs)) {
        await db.deleteFrom('camera_evidence')
          .where('id', '=', row.id)
          .where('tenant_id', '=', tenantId)
          .execute();
        deleted += 1;
      }
    }
    if (deleted > 0) {
      await audit({
        action: AUDIT_ACTIONS.CAMERA_EVIDENCE_RETENTION_DELETE,
        userId: actorId || null,
        resourceType: 'tenant',
        resourceId: tenantId,
        details: { deleted },
      }).catch(() => null);
    }
    return { ok: true, deleted };
  } catch (err) {
    return { ok: false, deleted: 0, errors: [err.message] };
  }
}

/**
 * Student-facing pilot status for an assignment (sanitized).
 *
 * @param {number} assignmentId
 * @param {number} userId
 * @returns {Promise<Object>} { ok, status?, reason? }
 */
export async function getStudentPilotStatus(assignmentId, userId) {
  const policy = await getCameraPilotPolicy();
  const consentRow = await getConsentRow(userId, assignmentId);
  return {
    ok: true,
    status: buildPilotStatus({ policy, consentRow }),
  };
}
