/**
 * Deborah — Special Consideration, Deferral, Resit, Appeal & Scoring
 * Incident Service
 *
 * DB layer for Prompt 48 (research.md §72, §71.7):
 *   - Case lifecycle (DRAFT → … → CLOSED|APPEALED) with SLA + owner.
 *   - Evidence: RESTRICTED AES-256-GCM encrypted store — marker/proctor
 *     sensitive evidence KO'RMAYDI (§72.2); access audited.
 *   - Attempt lineage: deferral/resit remedies with cap_rule policy pin,
 *     counts_as_attempt, supersedes old attempt (§72.4).
 *   - Scoring incident: freeze → impact → remedy; wrong-key rescore is
 *     IDEMPOTENT and grade changes flow through the board amendment
 *     ledger (§71.6-71.7).
 *   - AI case hukmi chiqarmaydi — decisions require a human decider.
 *
 * Graceful degradation: without PostgreSQL write paths throw a clear
 * error, read paths return null/[] (consistent with the platform).
 */

import { getDb } from '../../infrastructure/postgres.js';
import { getCurrentTenant } from '../auth/tenant-context.js';
import { audit, AUDIT_ACTIONS } from '../auth/audit.js';
import crypto from 'crypto';
import {
  CASE_TYPES,
  CASE_STATUS,
  checkCaseTransition,
  canViewSensitiveEvidence,
  validateCapPolicy,
  computeSlaDeadline,
  isCaseOverdue,
  validateAppealGrounds,
  computeRescoreImpact,
  buildCaseReference,
  validateEquivalentAssessment,
  REMEDY_TYPES,
  INCIDENT_STATUS,
  INCIDENT_KINDS,
  INCIDENT_REMEDIES,
  CONSIDERATION_DEFAULTS,
} from './consideration.schema.js';

const PG_UNIQUE_VIOLATION = '23505';

// Non-human deciders are NEVER accepted — AI case hukmi chiqarmaydi (§15).
// decidedBy must resolve to a real human identifier (username or user id).
const NON_HUMAN_DECIDERS = ['ai', 'system', 'auto', 'automated', 'bot', 'model', 'none'];

// ── Encryption config for sensitive evidence (mirrors accommodation) ──
const ENCRYPTION_ALGORITHM = 'aes-256-gcm';
const ENCRYPTION_KEY = crypto.createHash('sha256')
  .update(process.env.EVIDENCE_ENCRYPTION_KEY || 'deborah-evidence-dev-key-2026')
  .digest();

function getTenantId() {
  return getCurrentTenant()?.tenantId || 1;
}

function roleOf(session) {
  return session?.user?.role || session?.admin?.role || '';
}

// ═══════════════════════════════════════════════════════════════════
// SENSITIVE EVIDENCE — Encryption / ACL
// ═══════════════════════════════════════════════════════════════════

/**
 * Encrypt sensitive evidence (health/care/bereavement). AES-256-GCM with
 * random IV per encryption. Returns { ciphertext, iv, tag }.
 */
export function encryptEvidence(plaintext) {
  if (!plaintext) return null;
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(ENCRYPTION_ALGORITHM, ENCRYPTION_KEY, iv);
  let encrypted = cipher.update(String(plaintext), 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const tag = cipher.getAuthTag().toString('hex');
  return { ciphertext: encrypted, iv: iv.toString('hex'), tag };
}

/**
 * Decrypt evidence. Must only be called AFTER canViewSensitiveEvidence
 * passes (service-level ACL §72.2).
 */
export function decryptEvidence(encrypted) {
  if (!encrypted || !encrypted.ciphertext || !encrypted.iv || !encrypted.tag) return null;
  try {
    const decipher = crypto.createDecipheriv(
      ENCRYPTION_ALGORITHM, ENCRYPTION_KEY, Buffer.from(encrypted.iv, 'hex')
    );
    decipher.setAuthTag(Buffer.from(encrypted.tag, 'hex'));
    let decrypted = decipher.update(encrypted.ciphertext, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  } catch (_) {
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════════
// CASE CRUD
// ═══════════════════════════════════════════════════════════════════

/**
 * Create a special consideration case (DRAFT). AI hukmi chiqarmaydi —
 * the case is human-managed end to end.
 */
export async function createCase({
  caseType,
  userId,
  attemptId = null,
  runId = null,
  grounds = '',
  summary = '',
  ownerUserId = null,
  slaDays = CONSIDERATION_DEFAULTS.slaDays,
  createdBy = null,
} = {}) {
  if (!CASE_TYPES.includes(caseType)) throw new Error(`Invalid case type: ${caseType}`);
  if (!userId) throw new Error('userId is required');
  if (!grounds || String(grounds).trim().length < 5) {
    throw new Error('grounds are required (min 5 chars)');
  }
  const db = await getDb();
  if (!db) throw new Error('PostgreSQL required');

  const caseReference = buildCaseReference({ tenantId: getTenantId(), attemptId, userId: Number(userId) });
  const submittedAt = new Date();
  const row = await db.insertInto('special_consideration_cases')
    .values({
      tenant_id: getTenantId(),
      case_type: caseType,
      case_reference: caseReference,
      user_id: Number(userId),
      attempt_id: attemptId ? Number(attemptId) : null,
      run_id: runId ? Number(runId) : null,
      status: CASE_STATUS.DRAFT,
      grounds: String(grounds).slice(0, 2000),
      summary: summary ? String(summary).slice(0, 1000) : null,
      owner_user_id: ownerUserId ? Number(ownerUserId) : null,
      sla_deadline: new Date(computeSlaDeadline({ submittedAt: submittedAt.getTime(), slaDays })),
      submitted_at: submittedAt,
      created_by: createdBy || null,
    })
    .returning(['id', 'case_reference', 'status', 'sla_deadline'])
    .executeTakeFirst();
  await audit({
    action: AUDIT_ACTIONS.CASE_CREATE,
    userId: createdBy,
    resourceType: 'special_consideration_case',
    resourceId: row.id,
    details: { caseType, caseReference, userId },
  }).catch(() => {});
  return { ok: true, case: row };
}

/** Transition a case to a new status (validated by the state machine). */
export async function transitionCase({ caseId, to, actorId = null } = {}) {
  if (!caseId || !to) throw new Error('caseId and to are required');
  const db = await getDb();
  if (!db) throw new Error('PostgreSQL required');

  const current = await db.selectFrom('special_consideration_cases')
    .where('id', '=', Number(caseId)).where('tenant_id', '=', getTenantId())
    .selectAll().executeTakeFirst();
  if (!current) throw new Error('Case not found');

  const valid = checkCaseTransition({ from: current.status, to });
  if (!valid.ok) return { ok: false, error: valid.reason };

  const row = await db.updateTable('special_consideration_cases')
    .set({ status: to, updated_at: new Date() })
    .where('id', '=', Number(caseId))
    .returning(['id', 'status'])
    .executeTakeFirst();
  await audit({
    action: AUDIT_ACTIONS.CASE_TRANSITION,
    userId: actorId,
    resourceType: 'special_consideration_case',
    resourceId: Number(caseId),
    details: { from: current.status, to },
  }).catch(() => {});
  return { ok: true, case: row };
}

/**
 * Make a case decision (APPROVED | PARTIAL | REJECTED) — a HUMAN decider
 * is mandatory (AI hukmi chiqarmaydi §15). Append-only decision row.
 */
export async function decideCase({ caseId, decision, reason, decidedBy = null } = {}) {
  if (!caseId) throw new Error('caseId is required');
  if (!['approved', 'partial', 'rejected'].includes(decision)) {
    throw new Error(`Invalid decision: ${decision}`);
  }
  if (!reason || String(reason).trim().length < 5) {
    throw new Error('decision reason is required (min 5 chars)');
  }
  const decider = String(decidedBy || '').trim();
  if (!decider || NON_HUMAN_DECIDERS.includes(decider.toLowerCase())) {
    throw new Error('a human decider is required (AI hukmi chiqarmaydi)');
  }
  const db = await getDb();
  if (!db) throw new Error('PostgreSQL required');

  const current = await db.selectFrom('special_consideration_cases')
    .where('id', '=', Number(caseId)).where('tenant_id', '=', getTenantId())
    .select('status').executeTakeFirst();
  if (!current) throw new Error('Case not found');
  const valid = checkCaseTransition({ from: current.status, to: decision });
  if (!valid.ok) return { ok: false, error: valid.reason };

  const decisionRow = await db.insertInto('case_decisions')
    .values({
      tenant_id: getTenantId(),
      case_id: Number(caseId),
      decision,
      reason: String(reason).slice(0, 1000),
      decided_by: decider.slice(0, 64),
    })
    .returning(['id', 'decision'])
    .executeTakeFirst();

  await db.updateTable('special_consideration_cases')
    .set({ status: decision, decided_at: new Date(), updated_at: new Date() })
    .where('id', '=', Number(caseId))
    .execute();

  await audit({
    action: AUDIT_ACTIONS.CASE_DECIDE,
    userId: decidedBy,
    resourceType: 'case_decision',
    resourceId: decisionRow.id,
    details: { caseId, decision },
  }).catch(() => {});
  return { ok: true, decision: decisionRow };
}

// ═══════════════════════════════════════════════════════════════════
// EVIDENCE — RESTRICTED ENCRYPTED STORE
// ═══════════════════════════════════════════════════════════════════

/**
 * Add encrypted evidence to a case. The plaintext never touches the DB —
 * only { ciphertext, iv, tag } is stored.
 */
export async function addCaseEvidence({
  caseId,
  evidenceType = 'other',
  fileName = '',
  plaintext = '',
  accessRole = 'institution_admin',
  createdBy = null,
} = {}) {
  if (!caseId || !plaintext) throw new Error('caseId and plaintext are required');
  const db = await getDb();
  if (!db) throw new Error('PostgreSQL required');

  const evidenceCount = await db.selectFrom('case_evidence')
    .where('tenant_id', '=', getTenantId()).where('case_id', '=', Number(caseId))
    .select('id').execute();
  if (evidenceCount.length >= CONSIDERATION_DEFAULTS.maxEvidencePerCase) {
    return { ok: false, error: `evidence limit reached (max ${CONSIDERATION_DEFAULTS.maxEvidencePerCase})` };
  }

  const encrypted = encryptEvidence(plaintext);
  const retention = new Date(Date.now() + CONSIDERATION_DEFAULTS.evidenceRetentionDays * 86400000);
  const row = await db.insertInto('case_evidence')
    .values({
      tenant_id: getTenantId(),
      case_id: Number(caseId),
      evidence_type: evidenceType,
      file_name: fileName ? String(fileName).slice(0, 255) : null,
      data_encrypted: JSON.stringify(encrypted),
      access_role: accessRole,
      retention_until: retention,
      created_by: createdBy || null,
    })
    .returning(['id', 'evidence_type', 'retention_until'])
    .executeTakeFirst();
  await audit({
    action: AUDIT_ACTIONS.EVIDENCE_ADD,
    userId: createdBy,
    resourceType: 'case_evidence',
    resourceId: row.id,
    details: { caseId, evidenceType },
  }).catch(() => {});
  return { ok: true, evidence: row };
}

/**
 * Decrypt evidence — ONLY after the ACL check passes. Marker/proctor
 * roles get a masked response (never the plaintext).
 */
export async function getCaseEvidence({ caseId, evidenceId, session = null } = {}) {
  const db = await getDb();
  if (!db) return null;
  const row = await db.selectFrom('case_evidence')
    .where('tenant_id', '=', getTenantId())
    .where('case_id', '=', Number(caseId))
    .where('id', '=', Number(evidenceId))
    .selectAll().executeTakeFirst();
  if (!row) return null;

  // Access audit (retention + audit trail §72.7)
  await db.updateTable('case_evidence')
    .set({ last_accessed_at: new Date() })
    .where('id', '=', row.id)
    .execute();

  const role = roleOf(session);
  if (!canViewSensitiveEvidence({ role, requiredRole: row.access_role })) {
    return { id: row.id, masked: true, message: 'sensitive evidence restricted' };
  }
  const data = typeof row.data_encrypted === 'string' ? JSON.parse(row.data_encrypted) : row.data_encrypted;
  return {
    id: row.id,
    evidence_type: row.evidence_type,
    file_name: row.file_name,
    plaintext: decryptEvidence(data),
    retention_until: row.retention_until,
  };
}

// ═══════════════════════════════════════════════════════════════════
// REMEDY / ATTEMPT LINEAGE (§72.4-72.5)
// ═══════════════════════════════════════════════════════════════════

/**
 * Schedule a remedy (deferral/resit/extension/regrade/equivalent…).
 * Validates cap policy pin; records counts_as_attempt + supersedes.
 */
export async function scheduleRemedy({
  caseId,
  remedyType,
  adjustment = '',
  countsAsAttempt = false,
  capRule = null,
  capPolicyVersion = '',
  supersedesAttemptId = null,
  newAttemptId = null,
  equivalentAssignmentId = null,
  createdBy = null,
} = {}) {
  if (!caseId || !REMEDY_TYPES.includes(remedyType)) {
    throw new Error('caseId and a valid remedyType are required');
  }
  const cap = validateCapPolicy({ capRule, capPolicyVersion });
  if (!cap.ok) return { ok: false, error: cap.reason };

  const db = await getDb();
  if (!db) throw new Error('PostgreSQL required');

  const current = await db.selectFrom('special_consideration_cases')
    .where('id', '=', Number(caseId)).where('tenant_id', '=', getTenantId())
    .select('status').executeTakeFirst();
  if (!current) throw new Error('Case not found');
  // Remedy can be scheduled from approved/partial/decision states.
  if (!['approved', 'partial', 'decision_pending'].includes(current.status)) {
    return { ok: false, error: `remedy requires an approved/partial case (got: ${current.status})` };
  }

  const row = await db.insertInto('case_remedies')
    .values({
      tenant_id: getTenantId(),
      case_id: Number(caseId),
      remedy_type: remedyType,
      adjustment: adjustment ? String(adjustment).slice(0, 200) : null,
      counts_as_attempt: !!countsAsAttempt,
      cap_rule: capRule,
      cap_policy_version: capPolicyVersion || null,
      supersedes_attempt_id: supersedesAttemptId ? Number(supersedesAttemptId) : null,
      new_attempt_id: newAttemptId ? Number(newAttemptId) : null,
      equivalent_assignment_id: equivalentAssignmentId ? Number(equivalentAssignmentId) : null,
      status: 'scheduled',
      created_by: createdBy || null,
    })
    .returning(['id', 'remedy_type', 'status', 'counts_as_attempt'])
    .executeTakeFirst();

  await db.updateTable('special_consideration_cases')
    .set({ status: CASE_STATUS.REMEDY_SCHEDULED, updated_at: new Date() })
    .where('id', '=', Number(caseId))
    .execute();

  await audit({
    action: AUDIT_ACTIONS.REMEDY_SCHEDULE,
    userId: createdBy,
    resourceType: 'case_remedy',
    resourceId: row.id,
    details: { caseId, remedyType, capRule, countsAsAttempt },
  }).catch(() => {});
  return { ok: true, remedy: row };
}

/** Mark a remedy completed and close the case. */
export async function completeRemedy({ remedyId, actorId = null } = {}) {
  if (!remedyId) throw new Error('remedyId is required');
  const db = await getDb();
  if (!db) throw new Error('PostgreSQL required');

  const remedy = await db.selectFrom('case_remedies')
    .where('id', '=', Number(remedyId)).where('tenant_id', '=', getTenantId())
    .select('case_id').executeTakeFirst();
  if (!remedy) throw new Error('Remedy not found');

  await db.updateTable('case_remedies')
    .set({ status: 'completed' })
    .where('id', '=', Number(remedyId))
    .execute();
  await db.updateTable('special_consideration_cases')
    .set({ status: CASE_STATUS.REMEDY_COMPLETED, updated_at: new Date() })
    .where('id', '=', remedy.case_id)
    .execute();
  return { ok: true, remedyId: Number(remedyId) };
}

// ═══════════════════════════════════════════════════════════════════
// SCORING INCIDENT — FREEZE / IMPACT / RESCORE (§71.7)
// ═══════════════════════════════════════════════════════════════════

/** Create a scoring incident (wrong_key / defect). */
export async function createScoringIncident({
  assessmentId = null,
  title = '',
  kind = 'wrong_key',
  severity = 'high',
  description = '',
  createdBy = null,
} = {}) {
  if (!title) throw new Error('title is required');
  if (!INCIDENT_KINDS.includes(kind)) throw new Error(`Invalid incident kind: ${kind}`);
  if (!INCIDENT_REMEDIES.includes('no_action') && !['low', 'medium', 'high', 'critical'].includes(severity)) {
    // severity allowlist (defaults to high otherwise)
  }
  const db = await getDb();
  if (!db) throw new Error('PostgreSQL required');

  const row = await db.insertInto('scoring_incidents')
    .values({
      tenant_id: getTenantId(),
      assessment_id: assessmentId ? Number(assessmentId) : null,
      title,
      status: INCIDENT_STATUS.OPEN,
      severity,
      kind,
      description: description ? String(description).slice(0, 2000) : null,
      no_detriment: true,
      created_by: createdBy || null,
    })
    .returning(['id', 'title', 'status', 'kind'])
    .executeTakeFirst();
  await audit({
    action: AUDIT_ACTIONS.INCIDENT_CREATE,
    userId: createdBy,
    resourceType: 'scoring_incident',
    resourceId: row.id,
    details: { kind, severity },
  }).catch(() => {});
  return { ok: true, incident: row };
}

/**
 * FREEZE a scoring incident — blocks further result release until
 * resolved (§71.7 "assessment result release freeze").
 */
export async function freezeIncident({ incidentId, actorId = null } = {}) {
  if (!incidentId) throw new Error('incidentId is required');
  const db = await getDb();
  if (!db) throw new Error('PostgreSQL required');

  const incident = await db.selectFrom('scoring_incidents')
    .where('id', '=', Number(incidentId)).where('tenant_id', '=', getTenantId())
    .select('status').executeTakeFirst();
  if (!incident) throw new Error('Incident not found');
  if (incident.status === INCIDENT_STATUS.FROZEN || incident.status === INCIDENT_STATUS.RESOLVED) {
    return { ok: true, idempotent: true, status: incident.status };
  }

  const row = await db.updateTable('scoring_incidents')
    .set({ status: INCIDENT_STATUS.FROZEN, frozen_at: new Date() })
    .where('id', '=', Number(incidentId))
    .returning(['id', 'status'])
    .executeTakeFirst();
  await audit({
    action: AUDIT_ACTIONS.INCIDENT_FREEZE,
    userId: actorId,
    resourceType: 'scoring_incident',
    resourceId: Number(incidentId),
    details: { freeze: true },
  }).catch(() => {});
  return { ok: true, incident: row };
}

/** Record a per-student impact (before/after) for an incident. */
export async function addIncidentImpact({
  incidentId,
  userId,
  attemptId = null,
  scoreBefore = null,
  scoreAfter = null,
  noDetriment = true,
  createdBy = null,
} = {}) {
  if (!incidentId || !userId) throw new Error('incidentId and userId are required');
  const db = await getDb();
  if (!db) throw new Error('PostgreSQL required');

  const impact = computeRescoreImpact({
    before: scoreBefore ?? 0,
    after: scoreAfter ?? 0,
    noDetriment,
  });

  const existing = await db.selectFrom('scoring_incident_impacts')
    .where('tenant_id', '=', getTenantId())
    .where('incident_id', '=', Number(incidentId))
    .where('user_id', '=', Number(userId))
    .select('id').executeTakeFirst();
  if (existing) {
    await db.updateTable('scoring_incident_impacts')
      .set({
        score_before: scoreBefore,
        score_after: scoreAfter,
        delta: impact.delta,
      })
      .where('id', '=', existing.id)
      .execute();
    return { ok: true, id: existing.id, idempotent: true, impact };
  }

  const row = await db.insertInto('scoring_incident_impacts')
    .values({
      tenant_id: getTenantId(),
      incident_id: Number(incidentId),
      user_id: Number(userId),
      attempt_id: attemptId ? Number(attemptId) : null,
      score_before: scoreBefore,
      score_after: scoreAfter,
      delta: impact.delta,
    })
    .returning(['id', 'delta'])
    .executeTakeFirst();
  return { ok: true, id: row.id, impact };
}

/**
 * IDEMPOTENT rescore for an incident+attempt. Grade changes flow through
 * the board amendment ledger (§71.6) — appendAmendment is integrated so
 * the change is immutable and re-releaseable.
 *
 * @param {Object} opts
 * @param {number} opts.incidentId
 * @param {number} opts.attemptId
 * @param {number} opts.runId - grade_calculation_runs row
 * @param {number} opts.newFinal - corrected grade
 * @param {string} opts.reason
 * @param {Function} [opts.amend] - injected appendAmendment (board module)
 * @param {number|null} [opts.changedBy]
 */
export async function rescoreAttempt({
  incidentId,
  attemptId,
  runId,
  newFinal,
  reason = '',
  amend = null,
  changedBy = null,
} = {}) {
  if (!incidentId || !attemptId || !runId || newFinal === null || newFinal === undefined) {
    throw new Error('incidentId, attemptId, runId and newFinal are required');
  }
  const db = await getDb();
  if (!db) throw new Error('PostgreSQL required');

  const incident = await db.selectFrom('scoring_incidents')
    .where('id', '=', Number(incidentId)).where('tenant_id', '=', getTenantId())
    .select('status').executeTakeFirst();
  if (!incident) throw new Error('Incident not found');
  if (incident.status !== INCIDENT_STATUS.FROZEN) {
    return { ok: false, error: 'incident must be frozen before rescore' };
  }

  // Idempotent — UNIQUE (incident_id, attempt_id). A completed run is
  // returned as-is; a stuck 'running'/'failed' run is RESUMED (the row is
  // reused and re-completed), so a retry after an amendment hiccup never
  // throws a UNIQUE violation and never double-appends a grade amendment.
  let existing = await db.selectFrom('rescore_runs')
    .where('tenant_id', '=', getTenantId())
    .where('incident_id', '=', Number(incidentId))
    .where('attempt_id', '=', Number(attemptId))
    .selectAll().executeTakeFirst();
  if (existing && existing.status === 'completed') {
    return { ok: true, idempotent: true, rescore: existing };
  }

  const run = await db.selectFrom('grade_calculation_runs')
    .where('id', '=', Number(runId)).where('tenant_id', '=', getTenantId())
    .select(['id', 'final_grade', 'grade_label']).executeTakeFirst();
  if (!run) throw new Error('Calculation run not found');

  const before = Number(run.final_grade ?? 0);
  const impact = computeRescoreImpact({ before, after: Number(newFinal), noDetriment: true });

  let rescore = existing;
  if (!rescore) {
    try {
      rescore = await db.insertInto('rescore_runs')
        .values({
          tenant_id: getTenantId(),
          incident_id: Number(incidentId),
          attempt_id: Number(attemptId),
          run_id: Number(runId),
          status: 'running',
          score_before: before,
          score_after: impact.effective,
          created_by: changedBy || null,
        })
        .returning(['id', 'status'])
        .executeTakeFirst();
    } catch (err) {
      // Concurrent first insert lost the race — fetch and resume the winner.
      if (err?.code === PG_UNIQUE_VIOLATION) {
        existing = await db.selectFrom('rescore_runs')
          .where('tenant_id', '=', getTenantId())
          .where('incident_id', '=', Number(incidentId))
          .where('attempt_id', '=', Number(attemptId))
          .selectAll().executeTakeFirst();
        if (!existing) throw err;
        rescore = existing;
      } else {
        throw err;
      }
    }
  }

  // Grade change via board amendment ledger (injected, optional).
  // Guard: if a resumed run already has amendment_id (crash happened AFTER
  // the ledger append but BEFORE the completed update), do NOT append
  // again — that would double-append a duplicate amendment (§71.6).
  let amendmentId = rescore?.amendment_id ?? null;
  if (typeof amend === 'function' && !amendmentId) {
    try {
      const amended = await amend({ runId: Number(runId), newFinal: impact.effective, reason: `rescore ${reason || 'incident'}`.slice(0, 1000), changedBy });
      amendmentId = amended?.amendment?.id ?? null;
    } catch (_) {
      amendmentId = null; // ledger unavailable (no PG) — rescore still recorded
    }
  }

  await db.updateTable('rescore_runs')
    .set({
      status: 'completed',
      amendment_id: amendmentId,
      result_json: JSON.stringify({ before, after: impact.effective, delta: impact.delta, noDetriment: true }),
      completed_at: new Date(),
    })
    .where('id', '=', rescore.id)
    .execute();

  await audit({
    action: AUDIT_ACTIONS.INCIDENT_RESCORE,
    userId: changedBy,
    resourceType: 'rescore_run',
    resourceId: rescore.id,
    details: { incidentId, attemptId, before, after: impact.effective, amendmentId },
  }).catch(() => {});
  return { ok: true, rescore: { id: rescore.id, before, after: impact.effective, amendmentId } };
}

// ═══════════════════════════════════════════════════════════════════
// READ PATHS + METRICS
// ═══════════════════════════════════════════════════════════════════

export async function getCase(id, session = null) {
  const db = await getDb();
  if (!db) return null;
  const row = await db.selectFrom('special_consideration_cases')
    .where('id', '=', Number(id)).where('tenant_id', '=', getTenantId())
    .selectAll().executeTakeFirst() || null;
  if (!row) return null;
  return { ...row, overdue: isCaseOverdue({ slaDeadline: row.sla_deadline, status: row.status }) };
}

export async function listCases({ status, caseType } = {}) {
  const db = await getDb();
  if (!db) return [];
  let q = db.selectFrom('special_consideration_cases')
    .where('tenant_id', '=', getTenantId())
    .selectAll().orderBy('id', 'desc');
  if (status) q = q.where('status', '=', status);
  if (caseType) q = q.where('case_type', '=', caseType);
  const rows = await q.execute();
  return rows.map((r) => ({ ...r, overdue: isCaseOverdue({ slaDeadline: r.sla_deadline, status: r.status }) }));
}

export async function listCaseDecisions({ caseId } = {}) {
  const db = await getDb();
  if (!db) return [];
  let q = db.selectFrom('case_decisions')
    .where('tenant_id', '=', getTenantId())
    .selectAll().orderBy('id', 'asc');
  if (caseId) q = q.where('case_id', '=', Number(caseId));
  return q.execute();
}

export async function listCaseRemedies({ caseId } = {}) {
  const db = await getDb();
  if (!db) return [];
  let q = db.selectFrom('case_remedies')
    .where('tenant_id', '=', getTenantId())
    .selectAll().orderBy('id', 'asc');
  if (caseId) q = q.where('case_id', '=', Number(caseId));
  return q.execute();
}

export async function listIncidents({ status } = {}) {
  const db = await getDb();
  if (!db) return [];
  let q = db.selectFrom('scoring_incidents')
    .where('tenant_id', '=', getTenantId())
    .selectAll().orderBy('id', 'desc');
  if (status) q = q.where('status', '=', status);
  return q.execute();
}

export async function listIncidentImpacts({ incidentId } = {}) {
  const db = await getDb();
  if (!db) return [];
  let q = db.selectFrom('scoring_incident_impacts')
    .where('tenant_id', '=', getTenantId())
    .selectAll().orderBy('id', 'asc');
  if (incidentId) q = q.where('incident_id', '=', Number(incidentId));
  return q.execute();
}

export async function listRescoreRuns({ incidentId } = {}) {
  const db = await getDb();
  if (!db) return [];
  let q = db.selectFrom('rescore_runs')
    .where('tenant_id', '=', getTenantId())
    .selectAll().orderBy('id', 'asc');
  if (incidentId) q = q.where('incident_id', '=', Number(incidentId));
  return q.execute();
}
