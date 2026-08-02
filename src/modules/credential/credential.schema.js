/**
 * Edikit — Student Evidence Portfolio & Verifiable Credentials (pure logic)
 *
 * Prompt 61 — evidence portfolio + Open Badges 2.0 / CLR / W3C VC-compatible
 * credential lifecycle (research.md §25 AI governance — human sign-off on
 * summative/certification; §27 academic integrity — evidence portfolio, not
 * AI detector verdicts). This module is PURE (no I/O, no DB):
 *
 *   - assertNoLlmCredential: LLM hech qachon credential bermaydi — faqat
 *     ratified grade/evidence + teacher/admin sign-off.
 *   - assertNoRawSensitiveInPublic: raw sensitive submission public
 *     credential payloadga chiqmaydi — faqat select share maydonlari.
 *   - checkCredentialEligibility: deterministic eligibility (competency +
 *     ratified evidence + min grade).
 *   - assertIssuerAuthorized: issuer authority + definition status guard.
 *   - evaluateCredentialStatus: issued/active/revoked/expired resolution.
 *   - serializeOpenBadges / serializeClr / serializeVc: standard formats.
 *   - buildShareGrantToken / evaluateShareGrant: selective share.
 *   - buildSelectivePayload: public view (never raw submission).
 *   - computeEvidenceHash / computeVcDigest: idempotency + verifier lookup.
 *
 * SECURITY / DATA GUARD (Prompt 61 §15):
 *   - LLM credential bermaydi; raw sensitive submission public credentialga
 *     chiqmaydi — har serialization'da guard ko'rinadi.
 */

import crypto from 'crypto';

// ═══════════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════════

export const CREDENTIAL_STATUS = {
  ISSUED: 'issued',
  ACTIVE: 'active',
  REVOKED: 'revoked',
  EXPIRED: 'expired',
};

export const CREDENTIAL_STATUS_TRANSITIONS = {
  issued: ['active', 'revoked', 'expired'],
  active: ['revoked', 'expired'],
  revoked: [],
  expired: ['revoked'],
};

export const DEFINITION_STATUS = { DRAFT: 'draft', PUBLISHED: 'published', RETIRED: 'retired' };

export const ITEM_VISIBILITY = { PRIVATE: 'private', SHARED: 'shared', PUBLIC: 'public' };

export const ITEM_KINDS = [
  'proposal',
  'outline',
  'source_shortlist',
  'draft',
  'teacher_feedback',
  'reflection',
  'oral_defense',
  'credential',
];

export const AI_USE_LEVELS = ['A0', 'A1', 'A2', 'A3', 'A4'];

// Open Badges context — 2.0
export const OPEN_BADGES_CONTEXT = 'https://w3id.org/openbadges/v2';

// ═══════════════════════════════════════════════════════════════════
// HASHING (deterministic, for idempotency + verifier digest)
// ═══════════════════════════════════════════════════════════════════

/** Deterministic evidence hash — same evidence => same credential (idempotent). */
export function computeEvidenceHash({ userId = 0, definitionId = 0, evidence = {} } = {}) {
  const canonical = JSON.stringify({ userId, definitionId, evidence });
  return crypto.createHash('sha256').update(canonical).digest('hex');
}

/** Deterministic verifiable-credential digest — public verifier lookup key. */
export function computeVcDigest({ credential = {}, issuedAt = 0, issuer = '' } = {}) {
  const canonical = JSON.stringify({ id: credential.id, name: credential.name, recipient: credential.recipient, issuedAt, issuer });
  return crypto.createHash('sha256').update(canonical).digest('hex');
}

/**
 * TEST-ONLY grant token — deterministic per (itemId, viewer, exp).
 * ⚠️ NEVER use for production share grants: hardcoded secret is forgeable.
 * Production uses crypto.randomBytes(24) — see credential.service.js
 * createShareGrant(). This function exists only for deterministic unit tests.
 */
export function buildShareGrantToken({ itemId = 0, viewerEmail = '', expiresAt = 0, secret = 'edikit' } = {}) {
  const canonical = JSON.stringify({ itemId, viewerEmail, expiresAt, secret });
  return crypto.createHash('sha256').update(canonical).digest('hex').slice(0, 32);
}

// ═══════════════════════════════════════════════════════════════════
// GUARDS (§15 — LLM credential / raw sensitive in public)
// ═══════════════════════════════════════════════════════════════════

/**
 * Guard: LLM hech qachon credential bermaydi. Credential faqat ratified
 * grade/evidence + teacher/admin (issuer authority) sign-off bilan chiqadi.
 */
export function assertNoLlmCredential({ issuedByRole = 'ai', evidenceRatified = false, teacherApproved = false } = {}) {
  if (issuedByRole !== 'teacher' && issuedByRole !== 'admin') {
    return { ok: false, reason: 'credential issuer must be teacher or admin — AI cannot issue credentials', detail: { issuedByRole } };
  }
  if (!evidenceRatified || !teacherApproved) {
    return { ok: false, reason: 'credential requires ratified evidence + teacher approval', detail: { evidenceRatified, teacherApproved } };
  }
  return { ok: true, detail: { issuedByRole, evidenceRatified, teacherApproved } };
}

/**
 * Guard: raw sensitive submission public credentialga chiqmaydi. Public
 * payload faqat allowlist maydonlarni o'z ichiga oladi — submission body,
 * answer text, AI prompt log'lar HECH QACHON chiqmaydi.
 */
export function assertNoRawSensitiveInPublic({ payload = {}, includeSubmission = false, submissionKeys = ['submission', 'answer', 'promptLog', 'rawText'] } = {}) {
  const leaked = submissionKeys.filter((k) => payload[k] !== undefined || (payload.evidence && payload.evidence[k] !== undefined));
  if (includeSubmission || leaked.length > 0) {
    return { ok: false, reason: `raw sensitive submission blocked from public credential (${leaked.join(', ') || 'includeSubmission'})`, detail: { includeSubmission, leaked } };
  }
  return { ok: true };
}

// ═══════════════════════════════════════════════════════════════════
// ELIGIBILITY (deterministic)
// ═══════════════════════════════════════════════════════════════════

/**
 * Deterministic eligibility: competency evidence ratifikatsiya qilingan,
 * required evidence mavjud, min grade scaled qiymatga yetadi.
 * @param {Object} opts - { criteria, evidence }
 *   criteria: { competencyIds, requiredEvidenceKinds, minGradeScaled, expiresInDays }
 *   evidence: { competencyIds, ratifiedKinds, gradeScaled }
 */
export function checkCredentialEligibility({ criteria = {}, evidence = {} } = {}) {
  const competencyIds = criteria.competencyIds || [];
  const requiredKinds = criteria.requiredEvidenceKinds || [];
  const minGradeScaled = Number(criteria.minGradeScaled ?? 0);

  const hasCompetency = competencyIds.length === 0 || competencyIds.every((id) => (evidence.competencyIds || []).includes(id));
  const hasRatified = requiredKinds.every((k) => (evidence.ratifiedKinds || []).includes(k));
  const meetsGrade = Number(evidence.gradeScaled ?? 0) >= minGradeScaled;

  const checks = [
    { id: 'competency', ok: hasCompetency, detail: hasCompetency ? 'competency evidence present' : 'missing competency evidence' },
    { id: 'ratified_evidence', ok: hasRatified, detail: hasRatified ? 'evidence ratified' : 'missing ratified evidence' },
    { id: 'min_grade', ok: meetsGrade, detail: `grade ${Number(evidence.gradeScaled ?? 0)} >= ${minGradeScaled}` },
  ];
  return {
    ok: checks.every((c) => c.ok),
    checks,
    summary: { passed: checks.filter((c) => c.ok).length, failed: checks.filter((c) => !c.ok).length },
  };
}

// ═══════════════════════════════════════════════════════════════════
// ISSUER AUTHORIZATION
// ═══════════════════════════════════════════════════════════════════

/**
 * Issuer authority guard: definition PUBLISHED bo'lishi + issuer
 * authority'ga mos kelishi kerak.
 */
export function assertIssuerAuthorized({ definition = null, issuer = null } = {}) {
  if (!definition || !issuer) return { ok: false, reason: 'definition and issuer are required' };
  if (definition.status !== DEFINITION_STATUS.PUBLISHED) {
    return { ok: false, reason: `credential definition must be published (current: ${definition.status})`, detail: { status: definition.status } };
  }
  const authority = definition.issuer_authority || definition.issuerAuthority;
  if (authority && issuer !== authority && issuer !== 'admin') {
    return { ok: false, reason: `issuer ${issuer} is not authorized for ${authority}` };
  }
  return { ok: true, definition, issuer };
}

// ═══════════════════════════════════════════════════════════════════
// STATUS LIFECYCLE
// ═══════════════════════════════════════════════════════════════════

/** Resolve effective credential status from timestamps. */
export function evaluateCredentialStatus({ status = CREDENTIAL_STATUS.ACTIVE, revokedAt = null, expiresAt = null, now = Date.now() } = {}) {
  if (status === CREDENTIAL_STATUS.REVOKED) return { status: CREDENTIAL_STATUS.REVOKED, revoked: true };
  if (expiresAt && Number(now) > Number(expiresAt)) {
    return { status: CREDENTIAL_STATUS.EXPIRED, expired: true, expiredAt: expiresAt };
  }
  if (revokedAt) return { status: CREDENTIAL_STATUS.REVOKED, revoked: true, revokedAt };
  return { status: CREDENTIAL_STATUS.ACTIVE, revoked: false, expired: false };
}

/** Validate a status transition (FSM). */
export function assertStatusTransition({ from = '', to = '', detail = null } = {}) {
  const allowed = CREDENTIAL_STATUS_TRANSITIONS[from] || [];
  if (!allowed.includes(to)) {
    return { ok: false, reason: `invalid transition ${from} -> ${to}`, from, to };
  }
  return { ok: true, from, to, detail };
}

// ═══════════════════════════════════════════════════════════════════
// SERIALIZATION — Open Badges 2.0 / CLR / W3C VC
// ═══════════════════════════════════════════════════════════════════

const PUBLIC_FIELDS = ['id', 'name', 'description', 'recipient', 'issuedAt', 'issuer', 'criteria', 'competencyIds', 'evidenceHash', 'vcDigest', 'status'];

/** Public credential payload — raw submission maydonlarisiz. */
export function buildSelectivePayload(credential = {}, allowedFields = PUBLIC_FIELDS) {
  const payload = {};
  for (const k of allowedFields) {
    if (credential[k] !== undefined) payload[k] = credential[k];
  }
  const guard = assertNoRawSensitiveInPublic({ payload });
  return { ok: guard.ok, payload, guard: guard.reason || 'clean' };
}

/** Open Badges 2.0 assertion (Evidence with id, not raw content). */
export function serializeOpenBadges({ credential = {}, issuer = {}, now = Date.now() } = {}) {
  const selective = buildSelectivePayload(credential);
  if (!selective.ok) return { ok: false, error: selective.guard };
  const status = evaluateCredentialStatus({ status: credential.status, revokedAt: credential.revokedAt, expiresAt: credential.expiresAt, now });
  return {
    ok: true,
    format: 'open_badges_2.0',
    assertion: {
      '@context': OPEN_BADGES_CONTEXT,
      id: credential.vcDigest || credential.id,
      type: 'Assertion',
      recipient: { type: 'email', identity: credential.recipient || '' },
      badge: {
        type: 'BadgeClass',
        id: credential.definitionId || '',
        name: credential.name || '',
        description: credential.description || '',
        criteria: { narrative: credential.criteria?.narrative || '' },
        issuer: {
          type: 'Profile',
          id: issuer.id || '',
          name: issuer.name || 'Edikit',
        },
      },
      issuedOn: credential.issuedAt || new Date(now).toISOString(),
      evidence: [{ id: credential.evidenceHash, narrative: 'Ratified evidence — raw content excluded' }],
      verification: { type: 'HostedBadge', url: `/verify/${credential.vcDigest || ''}` },
    },
    effectiveStatus: status.status,
  };
}

/** Comprehensive Learner Record (CLR) summary. */
export function serializeClr({ credential = {}, achievements = [], now = Date.now() } = {}) {
  const selective = buildSelectivePayload(credential);
  if (!selective.ok) return { ok: false, error: selective.guard };
  const status = evaluateCredentialStatus({ status: credential.status, revokedAt: credential.revokedAt, expiresAt: credential.expiresAt, now });
  return {
    ok: true,
    format: 'clr',
    clr: {
      '@context': 'https://purl.imsglobal.org/spec/clr/v1p0/context.json',
      type: 'Clr',
      learner: { id: credential.recipient || '' },
      achievements: achievements.map((a) => ({
        id: a.vcDigest || a.id,
        type: 'Achievement',
        name: a.name || credential.name || '',
        criteria: { narrative: credential.criteria?.narrative || '' },
        evidence: [{ id: a.evidenceHash, narrative: 'Ratified evidence — raw content excluded' }],
      })),
    },
    effectiveStatus: status.status,
  };
}

/** W3C Verifiable Credential (data model 1.1). */
export function serializeVc({ credential = {}, issuer = {}, now = Date.now() } = {}) {
  const selective = buildSelectivePayload(credential);
  if (!selective.ok) return { ok: false, error: selective.guard };
  const status = evaluateCredentialStatus({ status: credential.status, revokedAt: credential.revokedAt, expiresAt: credential.expiresAt, now });
  return {
    ok: true,
    format: 'vc_1.1',
    vc: {
      '@context': ['https://www.w3.org/2018/credentials/v1'],
      id: `urn:uuid:${credential.vcDigest || credential.id}`,
      type: ['VerifiableCredential', 'EdikitCredential'],
      issuer: issuer.id || 'edikit',
      issuanceDate: credential.issuedAt || new Date(now).toISOString(),
      credentialSubject: {
        id: credential.recipient || '',
        name: credential.name || '',
        competency: (credential.competencyIds || []).map((c) => ({ id: c })),
        evidence: { id: credential.evidenceHash, type: 'RatifiedEvidence', narrative: 'Ratified evidence — raw content excluded' },
      },
    },
    effectiveStatus: status.status,
  };
}

// ═══════════════════════════════════════════════════════════════════
// SHARE GRANT (selective share)
// ═══════════════════════════════════════════════════════════════════

/**
 * Evaluate share grant: active (not expired, not revoked) + viewer match
 * (null viewer = any link holder).
 */
export function evaluateShareGrant({ grant = {}, viewerEmail = '', now = Date.now() } = {}) {
  if (!grant) return { ok: false, reason: 'grant not found' };
  if (grant.revoked_at) return { ok: false, reason: 'grant revoked', detail: { revokedAt: grant.revoked_at } };
  if (grant.expires_at && Number(now) > Number(new Date(grant.expires_at).getTime())) {
    return { ok: false, reason: 'grant expired', detail: { expiresAt: grant.expires_at } };
  }
  if (grant.viewer_email && grant.viewer_email !== viewerEmail) {
    return { ok: false, reason: 'grant is bound to another viewer' };
  }
  return { ok: true, grant };
}

// ═══════════════════════════════════════════════════════════════════
// APPEAL / RENEW
// ═══════════════════════════════════════════════════════════════════

/** Appeal guard: revoked credential appeal — student may appeal once. */
export function assertAppealAllowed({ status = '', existingAppeals = 0, maxAppeals = 1 } = {}) {
  if (status !== CREDENTIAL_STATUS.REVOKED) return { ok: false, reason: 'only revoked credentials can be appealed' };
  if (existingAppeals >= maxAppeals) return { ok: false, reason: 'appeal limit reached' };
  return { ok: true };
}

/** Renew: expired/revoked credential renew — only if eligibility still holds. */
export function assertRenewAllowed({ status = '', eligibility = null } = {}) {
  if (!['expired', 'revoked'].includes(status)) return { ok: false, reason: `cannot renew credential in ${status} state` };
  if (!eligibility || eligibility.ok !== true) return { ok: false, reason: 'renew requires current eligibility' };
  return { ok: true };
}
