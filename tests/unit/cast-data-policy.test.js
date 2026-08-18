/**
 * Edikit — Cast C4-07 Data Policy Tests
 * ---------------------------------------
 * coverage: data class enum, default retention proposal (item 3),
 *           expiry boundary, legal hold (item 12), tiny cohort suppress
 *           (item 13), de-identification review flag (item 14),
 *           UZ legal checklist (item 18).
 */

import { describe, it, expect } from 'vitest';
import {
  DATA_CLASSES,
  DATA_CLASS_LIST,
  EXPIRY_ACTIONS,
  DEFAULT_RETENTION_POLICY,
  resolveRetentionPolicy,
  policyFingerprint,
  retentionDaysFor,
  expiryAtFor,
  isExpired,
  buildLegalHold,
  isHoldActive,
  anyActiveHold,
  suppressTinyCohort,
  reIdentificationReviewFlag,
  UZ_LEGAL_CHECKLIST,
  uzLegalChecklistStatus,
  anonymizeRecord,
} from '../../services/cast/data-policy.js';

const DAY = 24 * 60 * 60 * 1000;

describe('C4-07: data class enum (item 1)', () => {
  it('10 ta data class mavjud (camera_mic disabled ichida)', () => {
    expect(DATA_CLASS_LIST).toHaveLength(10);
    expect(DATA_CLASSES.NAMED_ANSWER).toBe('named_answer');
    expect(DATA_CLASSES.OPEN_TEXT).toBe('open_text');
    expect(DATA_CLASSES.CAMERA_MIC).toBe('camera_mic');
  });
});

describe('C4-07: default retention proposal (item 3)', () => {
  it('named_answer 90 kun DELETE', () => {
    const cp = DEFAULT_RETENTION_POLICY.classes[DATA_CLASSES.NAMED_ANSWER];
    expect(cp.days).toBe(90);
    expect(cp.expiryAction).toBe(EXPIRY_ACTIONS.DELETE);
  });

  it('open_text 30 kun DELETE', () => {
    const cp = DEFAULT_RETENTION_POLICY.classes[DATA_CLASSES.OPEN_TEXT];
    expect(cp.days).toBe(30);
  });

  it('aggregate 395 kun (13 oy) REVIEW_OR_DELETE', () => {
    const cp = DEFAULT_RETENTION_POLICY.classes[DATA_CLASSES.AGGREGATE];
    expect(cp.days).toBe(395);
    expect(cp.expiryAction).toBe(EXPIRY_ACTIONS.REVIEW_OR_DELETE);
  });

  it('audit_log 180 kun ROLLING, backup null ROLLING', () => {
    const a = DEFAULT_RETENTION_POLICY.classes[DATA_CLASSES.AUDIT_LOG];
    expect(a.days).toBe(180);
    expect(a.expiryAction).toBe(EXPIRY_ACTIONS.ROLLING);
    const b = DEFAULT_RETENTION_POLICY.classes[DATA_CLASSES.BACKUP];
    expect(b.days).toBeNull();
  });

  it('recovery_state 1 kun (24 soat), support_bundle 14 kun', () => {
    expect(DEFAULT_RETENTION_POLICY.classes[DATA_CLASSES.RECOVERY_STATE].days).toBe(1);
    expect(DEFAULT_RETENTION_POLICY.classes[DATA_CLASSES.SUPPORT_BUNDLE].days).toBe(14);
  });

  it('camera_mic DISABLED (0 kun DELETE)', () => {
    const cp = DEFAULT_RETENTION_POLICY.classes[DATA_CLASSES.CAMERA_MIC];
    expect(cp.days).toBe(0);
    expect(cp.expiryAction).toBe(EXPIRY_ACTIONS.DELETE);
  });

  it('join_token session + ~15 min (0.011 kun)', () => {
    expect(DEFAULT_RETENTION_POLICY.classes[DATA_CLASSES.JOIN_TOKEN].days).toBeCloseTo(0.011, 2);
  });
});

describe('C4-07: policy resolve + version pin (item 4)', () => {
  it('default resolve returns full classes', () => {
    const policy = resolveRetentionPolicy('institution_default_v1');
    expect(policy.policyId).toBe('institution_default_v1');
    expect(Object.keys(policy.classes).length).toBe(10);
    expect(policy.version).toBe(1);
  });

  it('class override → version 2, fingerprint o\'zgaradi', () => {
    const base = resolveRetentionPolicy('x');
    const custom = resolveRetentionPolicy('x', { named_answer: { days: 30 } });
    expect(custom.classes[DATA_CLASSES.NAMED_ANSWER].days).toBe(30);
    expect(custom.version).toBe(2);
    expect(policyFingerprint(base)).not.toBe(policyFingerprint(custom));
  });

  it('retentionClass multiplier (extended ×2, minimal ×0.5)', () => {
    const cp = DEFAULT_RETENTION_POLICY.classes[DATA_CLASSES.NAMED_ANSWER];
    expect(retentionDaysFor(cp, 'extended')).toBe(180);
    expect(retentionDaysFor(cp, 'minimal')).toBe(45);
  });
});

describe('C4-07: expiry boundary', () => {
  it('named_answer 90 kundan keyin expired', () => {
    const cp = DEFAULT_RETENTION_POLICY.classes[DATA_CLASSES.NAMED_ANSWER];
    const createdAt = 1000000;
    expect(isExpired(cp, createdAt, createdAt + 89 * DAY)).toBe(false);
    expect(isExpired(cp, createdAt, createdAt + 91 * DAY)).toBe(true);
    // boundary — roppa-rosa 90 kun
    expect(isExpired(cp, createdAt, createdAt + 90 * DAY)).toBe(true);
  });

  it('rolling (audit_log) — isExpired false (job o\'zi saqlaydi)', () => {
    const cp = DEFAULT_RETENTION_POLICY.classes[DATA_CLASSES.AUDIT_LOG];
    expect(isExpired(cp, 1000, Date.now() + 500 * DAY)).toBe(false);
  });

  it('expiryAtFor custom days', () => {
    const cp = { days: 30, expiryAction: EXPIRY_ACTIONS.DELETE };
    const at = expiryAtFor(cp, 1000000);
    expect(at).toBe(1000000 + 30 * DAY);
  });
});

describe('C4-07: legal hold (item 12)', () => {
  it('hold record actor/scope/reason/expiry', () => {
    const hold = buildLegalHold({ actor: 't1', scope: 'session', reason: 'sud talabi', expiresInDays: 30 });
    expect(hold.actor).toBe('t1');
    expect(hold.scope).toBe('session');
    expect(hold.reason).toBe('sud talabi');
    expect(hold.expiresAt).toBeGreaterThan(hold.createdAt);
    expect(hold.holdId).toMatch(/^hold_/);
  });

  it('doimiy hold (expiresAt null) active', () => {
    const hold = buildLegalHold({ actor: 't', reason: 'doimiy' });
    expect(isHoldActive(hold)).toBe(true);
  });

  it('muddati o\'tgan hold faol emas', () => {
    const hold = buildLegalHold({ actor: 't', reason: 'x', expiresInDays: 1, now: 1000 });
    expect(isHoldActive(hold, 1000 + 2 * DAY)).toBe(false);
  });

  it('anyActiveHold — hold bor bo\'lsa retention to\'xtaydi', () => {
    const holds = [buildLegalHold({ actor: 't', reason: 'x' })];
    expect(anyActiveHold(holds)).toBe(true);
    expect(anyActiveHold([])).toBe(false);
  });
});

describe('C4-07: tiny cohort suppress (item 13)', () => {
  it('5 dan kichik kogort suppress', () => {
    expect(suppressTinyCohort(4)).toBeNull();
    expect(suppressTinyCohort(5)).toBe(5);
    expect(suppressTinyCohort(null)).toBeNull();
  });
});

describe('C4-07: de-identification review flag (item 14)', () => {
  it('tiny cohort → needsReview', () => {
    const f = reIdentificationReviewFlag({ cohortSize: 3 });
    expect(f.needsReview).toBe(true);
    expect(f.reasons).toContain('tiny_cohort');
  });

  it('fully distinct answers → needsReview', () => {
    const f = reIdentificationReviewFlag({ cohortSize: 6, distinctAnswers: 6 });
    expect(f.needsReview).toBe(true);
    expect(f.reasons).toContain('fully_distinct_answers');
  });

  it('normal cohort → no review', () => {
    const f = reIdentificationReviewFlag({ cohortSize: 20, distinctAnswers: 4 });
    expect(f.needsReview).toBe(false);
  });
});

describe('C4-07: UZ legal checklist (item 18)', () => {
  it("required itemlar bor, approval'siz ready emas", () => {
    const st = uzLegalChecklistStatus({});
    expect(st.ready).toBe(false);
    expect(st.missingRequired).toContain('uz_law_pdpl');
  });

  it('barcha required approved → ready', () => {
    const st = uzLegalChecklistStatus({
      uz_law_pdpl: true,
      uz_camera_consent: true,
      uz_minor_consent: true,
      uz_retention_disclosure: true,
    });
    expect(st.ready).toBe(true);
    expect(st.missingRequired).toEqual([]);
  });

  it('checklist 5 item', () => {
    expect(UZ_LEGAL_CHECKLIST).toHaveLength(5);
  });
});

describe('C4-07: anonymizeRecord', () => {
  it('displayAlias/normalized/text o\'chiriladi, faqat uzunlik saqlanadi', () => {
    const out = anonymizeRecord({ displayAlias: 'Jasur', normalized: 'jasur', text: 'salom dunyo', score: 100 });
    expect(out.displayAlias).toBeUndefined();
    expect(out.normalized).toBeUndefined();
    expect(out.text).toBeUndefined();
    expect(out.textHash).toBe(String('salom dunyo').length);
    expect(out.score).toBe(100);
    expect(out.anonymizedAt).toBeTruthy();
  });
});
