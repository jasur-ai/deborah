/**
 * Edikit — Portfolio & Verifiable Credential (unit tests, Prompt 61)
 *
 * Pure schema: eligibility (deterministic), issuer authorization, status
 * lifecycle FSM, Open Badges/CLR/VC serialization (no raw submission),
 * share grant evaluation, guards (LLM never issues; raw sensitive never
 * in public payload), appeal/renew guards.
 */

import { describe, it, expect } from 'vitest';
import {
  assertNoLlmCredential,
  assertNoRawSensitiveInPublic,
  checkCredentialEligibility,
  assertIssuerAuthorized,
  evaluateCredentialStatus,
  assertStatusTransition,
  assertAppealAllowed,
  assertRenewAllowed,
  buildSelectivePayload,
  serializeOpenBadges,
  serializeClr,
  serializeVc,
  evaluateShareGrant,
  computeEvidenceHash,
  computeVcDigest,
  buildShareGrantToken,
  CREDENTIAL_STATUS,
  DEFINITION_STATUS,
} from '../../src/modules/credential/index.js';

describe('credential — guards (§15)', () => {
  it('LLM never issues credentials', () => {
    const r = assertNoLlmCredential({ issuedByRole: 'ai', evidenceRatified: true, teacherApproved: true });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/AI cannot issue/i);
  });

  it('teacher/admin with ratified + approved evidence may issue', () => {
    expect(assertNoLlmCredential({ issuedByRole: 'teacher', evidenceRatified: true, teacherApproved: true }).ok).toBe(true);
    expect(assertNoLlmCredential({ issuedByRole: 'admin', evidenceRatified: true, teacherApproved: true }).ok).toBe(true);
  });

  it('blocks issuance without ratified evidence or teacher approval', () => {
    expect(assertNoLlmCredential({ issuedByRole: 'teacher', evidenceRatified: false, teacherApproved: true }).ok).toBe(false);
    expect(assertNoLlmCredential({ issuedByRole: 'teacher', evidenceRatified: true, teacherApproved: false }).ok).toBe(false);
  });

  it('raw sensitive submission never in public payload', () => {
    const r = assertNoRawSensitiveInPublic({ payload: { name: 'x', submission: 'full answer text' } });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/raw sensitive/i);
    expect(assertNoRawSensitiveInPublic({ payload: { name: 'x', vcDigest: 'abc' } }).ok).toBe(true);
    expect(assertNoRawSensitiveInPublic({ payload: { evidence: { promptLog: 'log' } } }).ok).toBe(false);
  });
});

describe('credential — deterministic eligibility', () => {
  it('passes when competency + ratified evidence + min grade met', () => {
    const r = checkCredentialEligibility({
      criteria: { competencyIds: [1, 2], requiredEvidenceKinds: ['final', 'reflection'], minGradeScaled: 7000 },
      evidence: { competencyIds: [1, 2], ratifiedKinds: ['final', 'reflection'], gradeScaled: 8000 },
    });
    expect(r.ok).toBe(true);
    expect(r.checks.length).toBe(3);
  });

  it('fails when evidence missing', () => {
    const r = checkCredentialEligibility({
      criteria: { competencyIds: [1], requiredEvidenceKinds: ['final'], minGradeScaled: 7000 },
      evidence: { competencyIds: [1], ratifiedKinds: [], gradeScaled: 8000 },
    });
    expect(r.ok).toBe(false);
    expect(r.checks.find((c) => c.id === 'ratified_evidence').ok).toBe(false);
  });

  it('fails when grade below minimum', () => {
    const r = checkCredentialEligibility({
      criteria: { competencyIds: [], requiredEvidenceKinds: [], minGradeScaled: 7000 },
      evidence: { gradeScaled: 5000 },
    });
    expect(r.ok).toBe(false);
  });

  it('deterministic — same evidence => same result', () => {
    const c = { competencyIds: [1], requiredEvidenceKinds: ['final'], minGradeScaled: 7000 };
    const e = { competencyIds: [1], ratifiedKinds: ['final'], gradeScaled: 8000 };
    expect(checkCredentialEligibility({ criteria: c, evidence: e })).toEqual(checkCredentialEligibility({ criteria: c, evidence: e }));
  });
});

describe('credential — issuer authorization', () => {
  it('requires published definition', () => {
    const r = assertIssuerAuthorized({ definition: { status: DEFINITION_STATUS.DRAFT, issuer_authority: 'admin' }, issuer: 'admin' });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/published/i);
  });

  it('accepts admin or matching authority', () => {
    const def = { status: DEFINITION_STATUS.PUBLISHED, issuer_authority: 'math-dept' };
    expect(assertIssuerAuthorized({ definition: def, issuer: 'admin' }).ok).toBe(true);
    expect(assertIssuerAuthorized({ definition: def, issuer: 'math-dept' }).ok).toBe(true);
    expect(assertIssuerAuthorized({ definition: def, issuer: 'someone-else' }).ok).toBe(false);
  });
});

describe('credential — status lifecycle', () => {
  it('resolves active / revoked / expired', () => {
    expect(evaluateCredentialStatus({ status: CREDENTIAL_STATUS.ACTIVE }).status).toBe(CREDENTIAL_STATUS.ACTIVE);
    expect(evaluateCredentialStatus({ status: CREDENTIAL_STATUS.REVOKED }).status).toBe(CREDENTIAL_STATUS.REVOKED);
    expect(evaluateCredentialStatus({ status: CREDENTIAL_STATUS.ACTIVE, expiresAt: Date.now() - 1000 }).status).toBe(CREDENTIAL_STATUS.EXPIRED);
    expect(evaluateCredentialStatus({ status: CREDENTIAL_STATUS.REVOKED, expiresAt: Date.now() - 1000 }).status).toBe(CREDENTIAL_STATUS.REVOKED);
  });

  it('enforces FSM transitions', () => {
    expect(assertStatusTransition({ from: 'active', to: 'revoked' }).ok).toBe(true);
    expect(assertStatusTransition({ from: 'revoked', to: 'active' }).ok).toBe(false);
    expect(assertStatusTransition({ from: 'issued', to: 'active' }).ok).toBe(true);
  });
});

describe('credential — serialization (Open Badges / CLR / VC)', () => {
  const credential = {
    id: 1,
    name: 'Matematika sertifikati',
    description: 'DTM Matematika',
    recipient: 'student@example.com',
    definitionId: 3,
    competencyIds: [1, 2],
    criteria: { narrative: 'Evidence-based' },
    evidenceHash: 'hash123',
    vcDigest: 'digest123',
    issuedAt: '2026-07-01T00:00:00.000Z',
    status: CREDENTIAL_STATUS.ACTIVE,
  };

  it('Open Badges 2.0 assertion — no raw submission', () => {
    const r = serializeOpenBadges({ credential, issuer: { id: 'edikit', name: 'Edikit' } });
    expect(r.ok).toBe(true);
    expect(r.format).toBe('open_badges_2.0');
    expect(r.assertion['@context']).toBe('https://w3id.org/openbadges/v2');
    expect(JSON.stringify(r.assertion)).not.toContain('promptLog');
    expect(JSON.stringify(r.assertion)).not.toContain('submission');
  });

  it('CLR serialization', () => {
    const r = serializeClr({ credential, achievements: [{ id: 1, name: 'x', evidenceHash: 'h1' }] });
    expect(r.ok).toBe(true);
    expect(r.format).toBe('clr');
    expect(r.clr.achievements.length).toBe(1);
  });

  it('W3C VC serialization with competency evidence', () => {
    const r = serializeVc({ credential, issuer: { id: 'edikit' } });
    expect(r.ok).toBe(true);
    expect(r.format).toBe('vc_1.1');
    expect(r.vc.credentialSubject.competency).toHaveLength(2);
    expect(JSON.stringify(r.vc)).not.toContain('rawText');
  });

  it('selective payload drops raw fields', () => {
    const r = buildSelectivePayload({ id: 1, name: 'x', submission: 'secret', vcDigest: 'd' });
    expect(r.ok).toBe(true);
    expect(r.payload.submission).toBeUndefined();
    expect(r.payload.name).toBe('x');
  });
});

describe('credential — share grants', () => {
  it('accepts active grant; rejects revoked/expired/bound-to-other', () => {
    expect(evaluateShareGrant({ grant: { grant_token: 't' } }).ok).toBe(true);
    expect(evaluateShareGrant({ grant: { grant_token: 't', revoked_at: new Date() } }).ok).toBe(false);
    expect(evaluateShareGrant({ grant: { grant_token: 't', expires_at: '2000-01-01' } }).ok).toBe(false);
    expect(evaluateShareGrant({ grant: { grant_token: 't', viewer_email: 'a@x.com' }, viewerEmail: 'b@x.com' }).ok).toBe(false);
    expect(evaluateShareGrant({ grant: { grant_token: 't', viewer_email: 'a@x.com' }, viewerEmail: 'a@x.com' }).ok).toBe(true);
  });

  it('share token deterministic per (item, viewer, expiry)', () => {
    const t1 = buildShareGrantToken({ itemId: 1, viewerEmail: 'a@x.com', expiresAt: 123 });
    expect(t1).toBe(buildShareGrantToken({ itemId: 1, viewerEmail: 'a@x.com', expiresAt: 123 }));
    expect(t1).not.toBe(buildShareGrantToken({ itemId: 2, viewerEmail: 'a@x.com', expiresAt: 123 }));
  });
});

describe('credential — appeal & renew guards', () => {
  it('appeal only revoked, once', () => {
    expect(assertAppealAllowed({ status: 'revoked', existingAppeals: 0 }).ok).toBe(true);
    expect(assertAppealAllowed({ status: 'active', existingAppeals: 0 }).ok).toBe(false);
    expect(assertAppealAllowed({ status: 'revoked', existingAppeals: 1 }).ok).toBe(false);
  });

  it('renew only expired/revoked with current eligibility', () => {
    expect(assertRenewAllowed({ status: 'expired', eligibility: { ok: true } }).ok).toBe(true);
    expect(assertRenewAllowed({ status: 'active', eligibility: { ok: true } }).ok).toBe(false);
    expect(assertRenewAllowed({ status: 'expired', eligibility: { ok: false } }).ok).toBe(false);
  });
});

it('hashes are deterministic', () => {
  const e = { a: 1, b: 'x' };
  expect(computeEvidenceHash({ userId: 1, definitionId: 2, evidence: e })).toBe(computeEvidenceHash({ userId: 1, definitionId: 2, evidence: e }));
  expect(computeEvidenceHash({ userId: 1, definitionId: 2, evidence: e })).not.toBe(computeEvidenceHash({ userId: 1, definitionId: 3, evidence: e }));
  expect(computeVcDigest({ credential: { id: 1, name: 'n', recipient: 'r' }, issuedAt: 5, issuer: 'i' })).toBe(computeVcDigest({ credential: { id: 1, name: 'n', recipient: 'r' }, issuedAt: 5, issuer: 'i' }));
});
