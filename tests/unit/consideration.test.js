/**
 * Deborah — Special Consideration, Deferral, Resit, Appeal & Scoring
 * Incident unit tests (Prompt 48)
 *
 * Pure-schema coverage:
 *   - Case state machine (§72.3 lifecycle, invalid transitions rejected)
 *   - Sensitive evidence ACL (§72.2 — marker/proctor NEVER see evidence)
 *   - Cap/policy pin (§72.4) — cap_rule + policy version required
 *   - SLA deadline (working days) + overdue detection
 *   - Appeal grounds (§15 — AI/proctor signals as conclusive facts rejected)
 *   - Rescore no-detriment (§71.7 — student never loses)
 *   - Equivalent assessment (§72.5)
 */

import { describe, it, expect } from 'vitest';
import {
  checkCaseTransition,
  canViewSensitiveEvidence,
  validateCapPolicy,
  computeSlaDeadline,
  isCaseOverdue,
  validateAppealGrounds,
  computeRescoreImpact,
  validateEquivalentAssessment,
  buildCaseReference,
  CASE_STATUS,
  CASE_TYPES,
  REMEDY_TYPES,
  INCIDENT_STATUS,
  CONSIDERATION_DEFAULTS,
} from '../../src/modules/consideration/index.js';

// ═══════════════════════════════════════════════════════════════════
// CASE STATE MACHINE (§72.3)
// ═══════════════════════════════════════════════════════════════════

describe('checkCaseTransition', () => {
  it('allows the §72.3 lifecycle path', () => {
    const path = [
      [CASE_STATUS.DRAFT, CASE_STATUS.SUBMITTED],
      [CASE_STATUS.SUBMITTED, CASE_STATUS.EVIDENCE_CHECK],
      [CASE_STATUS.EVIDENCE_CHECK, CASE_STATUS.ELIGIBILITY_REVIEW],
      [CASE_STATUS.ELIGIBILITY_REVIEW, CASE_STATUS.DECISION_PENDING],
      [CASE_STATUS.DECISION_PENDING, CASE_STATUS.APPROVED],
      [CASE_STATUS.APPROVED, CASE_STATUS.REMEDY_SCHEDULED],
      [CASE_STATUS.REMEDY_SCHEDULED, CASE_STATUS.REMEDY_COMPLETED],
      [CASE_STATUS.REMEDY_COMPLETED, CASE_STATUS.CLOSED],
    ];
    for (const [from, to] of path) {
      expect(checkCaseTransition({ from, to }).ok).toBe(true);
    }
  });

  it('rejects invalid transitions', () => {
    expect(checkCaseTransition({ from: CASE_STATUS.DRAFT, to: CASE_STATUS.CLOSED }).ok).toBe(false);
    expect(checkCaseTransition({ from: CASE_STATUS.CLOSED, to: CASE_STATUS.APPROVED }).ok).toBe(false);
    expect(checkCaseTransition({ from: CASE_STATUS.APPROVED, to: CASE_STATUS.DRAFT }).ok).toBe(false);
  });

  it('requires from and to', () => {
    expect(checkCaseTransition({}).ok).toBe(false);
    expect(checkCaseTransition({ from: CASE_STATUS.DRAFT }).ok).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════
// SENSITIVE EVIDENCE ACL (§72.2)
// ═══════════════════════════════════════════════════════════════════

describe('canViewSensitiveEvidence', () => {
  it('lets institution admins and teachers view evidence', () => {
    expect(canViewSensitiveEvidence({ role: 'institution_admin' })).toBe(true);
    expect(canViewSensitiveEvidence({ role: 'teacher' })).toBe(true);
  });

  it('NEVER lets markers/proctors/external examiners view evidence', () => {
    expect(canViewSensitiveEvidence({ role: 'marker' })).toBe(false);
    expect(canViewSensitiveEvidence({ role: 'proctor' })).toBe(false);
    expect(canViewSensitiveEvidence({ role: 'external_examiner' })).toBe(false);
  });

  it('respects a required role', () => {
    expect(canViewSensitiveEvidence({ role: 'teacher', requiredRole: 'institution_admin' })).toBe(true);
    expect(canViewSensitiveEvidence({ role: 'marker', requiredRole: 'institution_admin' })).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════
// CAP / POLICY PIN (§72.4)
// ═══════════════════════════════════════════════════════════════════

describe('validateCapPolicy', () => {
  it('accepts valid cap rules with a pinned policy version', () => {
    expect(validateCapPolicy({ capRule: 'capped', capPolicyVersion: 'v2' }).ok).toBe(true);
    expect(validateCapPolicy({ capRule: 'best_of', capPolicyVersion: 'v1' }).ok).toBe(true);
  });

  it('rejects unknown cap rules', () => {
    expect(validateCapPolicy({ capRule: 'curve', capPolicyVersion: 'v1' }).ok).toBe(false);
  });

  it('requires a policy version when a cap rule is set', () => {
    expect(validateCapPolicy({ capRule: 'capped', capPolicyVersion: '' }).ok).toBe(false);
  });

  it('enforces max_attempts', () => {
    const r = validateCapPolicy({ capRule: 'max_attempts', capPolicyVersion: 'v1', attemptCount: 4, maxAttempts: 3 });
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('max attempts');
  });
});

// ═══════════════════════════════════════════════════════════════════
// SLA & OVERDUE
// ═══════════════════════════════════════════════════════════════════

describe('computeSlaDeadline / isCaseOverdue', () => {
  it('adds working days (skips weekends)', () => {
    // Friday 2026-07-31 + 1 working day = Monday 2026-08-03
    const friday = new Date('2026-07-31T12:00:00Z').getTime();
    const deadline = computeSlaDeadline({ submittedAt: friday, slaDays: 1 });
    expect(new Date(deadline).getUTCDay()).toBe(1); // Monday
  });

  it('marks open cases past the SLA as overdue', () => {
    const past = new Date(Date.now() - 86400000).getTime();
    expect(isCaseOverdue({ slaDeadline: past, status: CASE_STATUS.DECISION_PENDING })).toBe(true);
  });

  it('never marks closed/appealed cases overdue', () => {
    const past = new Date(Date.now() - 86400000).getTime();
    expect(isCaseOverdue({ slaDeadline: past, status: CASE_STATUS.CLOSED })).toBe(false);
    expect(isCaseOverdue({ slaDeadline: past, status: CASE_STATUS.APPEALED })).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════
// APPEAL GROUNDS (§15 — AI hukmi chiqarmaydi)
// ═══════════════════════════════════════════════════════════════════

describe('validateAppealGrounds', () => {
  it('accepts a meaningful human-drafted grounds', () => {
    expect(validateAppealGrounds({ grounds: 'Baholashda arifmetik xatolik bo\'lgan deb hisoblayman.' }).ok).toBe(true);
  });

  it('rejects AI/proctor signals as conclusive facts', () => {
    const r = validateAppealGrounds({ grounds: 'The AI score said I should get a higher mark.' });
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('AI/proctor signals');
  });

  it('rejects camera/proctor flag citations', () => {
    const r = validateAppealGrounds({ grounds: 'Proctor camera flag proves I did nothing wrong.' });
    expect(r.ok).toBe(false);
  });

  it('requires at least 10 characters', () => {
    expect(validateAppealGrounds({ grounds: 'short' }).ok).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════
// RESCORE / NO-DETRIMENT (§71.7)
// ═══════════════════════════════════════════════════════════════════

describe('computeRescoreImpact', () => {
  it('applies no-detriment: effective = max(before, after)', () => {
    const up = computeRescoreImpact({ before: 70, after: 85, noDetriment: true });
    expect(up.effective).toBe(85);
    expect(up.improved).toBe(true);

    const down = computeRescoreImpact({ before: 85, after: 70, noDetriment: true });
    expect(down.effective).toBe(85); // student keeps the higher score
    expect(down.delta).toBe(-15);
  });

  it('without no-detriment the raw after score applies', () => {
    const r = computeRescoreImpact({ before: 85, after: 70, noDetriment: false });
    expect(r.effective).toBe(70);
  });
});

// ═══════════════════════════════════════════════════════════════════
// EQUIVALENT ASSESSMENT (§72.5)
// ═══════════════════════════════════════════════════════════════════

describe('validateEquivalentAssessment', () => {
  const base = {
    outcomeKeys: ['LO1', 'LO2'],
    timeMinutes: 60,
    blueprintId: 1,
    leakChecked: true,
  };

  it('accepts a fully equivalent replacement', () => {
    const r = validateEquivalentAssessment({
      original: base,
      replacement: { ...base, comparableBlueprint: true },
    });
    expect(r.ok).toBe(true);
  });

  it('rejects when items were not leak-checked', () => {
    const r = validateEquivalentAssessment({
      original: base,
      replacement: { ...base, comparableBlueprint: true, leakChecked: false },
    });
    expect(r.ok).toBe(false);
    expect(r.missing).toContain('no_leaked_items');
  });

  it('rejects when outcomes differ', () => {
    const r = validateEquivalentAssessment({
      original: base,
      replacement: { ...base, comparableBlueprint: true, outcomeKeys: ['LO1'] },
    });
    expect(r.ok).toBe(false);
    expect(r.missing).toContain('same_outcomes');
  });
});

// ═══════════════════════════════════════════════════════════════════
// CONSTANTS & REFERENCE
// ═══════════════════════════════════════════════════════════════════

describe('constants and case reference', () => {
  it('exposes the expected case vocabulary', () => {
    expect(CASE_TYPES).toContain('special_consideration');
    expect(CASE_TYPES).toContain('deferral');
    expect(CASE_TYPES).toContain('appeal');
    expect(REMEDY_TYPES).toContain('equivalent_assessment');
    expect(INCIDENT_STATUS.FROZEN).toBe('frozen');
  });

  it('builds a deterministic, scoped case reference', () => {
    const ref = buildCaseReference({ tenantId: 1, attemptId: 5, userId: 9 });
    expect(ref).toMatch(/^SC-1-[0-9A-F]{8}$/);
  });
});
