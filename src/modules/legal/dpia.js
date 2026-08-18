/**
 * Edikit — DPIA (Data Protection Impact Assessment) — AUTH D-25 §06
 * ---------------------------------------------------------------------------
 * Auth PII inventarizatsiyasi, processing maqsadi, risk + mitigation,
 * retention, DSAR, review jadvali (§27 — har yili yoki PII o'zgarishida).
 *
 * Bu modul hujjatni strukturani taqdim etadi — operator legal review'ni
 * `reviewed_at` + `reviewer` bilan tasdiqlaydi (D-25 §25/§29).
 */

export const DPIA_VERSION = '1.0.0';
export const DPIA_CREATED = '2026-08-17';
export const DPIA_REVIEW_PERIOD_DAYS = 365; // §27: har yili

/** PII inventarizatsiya (D-25 §06) — auth'ga oid. */
export const DPIA_PII = [
  { field: 'username', purpose: 'account', retention: 'account_active', sensitive: false },
  { field: 'email', purpose: 'account/verify/reset', retention: 'account_active', sensitive: false },
  { field: 'name', purpose: 'account/display', retention: 'account_active', sensitive: false },
  { field: 'password_hash (argon2id)', purpose: 'auth', retention: 'account_active', sensitive: true },
  { field: 'telegram_id', purpose: 'notifications (opt-in)', retention: 'until_revoke', sensitive: false },
  { field: 'hemis_id', purpose: 'roster/login', retention: 'account_active', sensitive: false },
  { field: 'device_fingerprint_hash', purpose: 'security/risk', retention: '90d', sensitive: true },
  { field: 'ip_hash', purpose: 'security/audit', retention: '90d', sensitive: true },
  { field: 'audit_log (events)', purpose: 'security/compliance', retention: 'limited', sensitive: false },
  { field: 'consent_log', purpose: 'legal', retention: 'legal_required', sensitive: false },
];

/** Processing maqsadlari. */
export const DPIA_PURPOSES = [
  'auth (login/register/session)',
  'account management',
  'email verify + password reset',
  'security (fraud, brute-force, abuse detection)',
  'notifications (telegram — opt-in)',
  'compliance (UZ personal data law, audit)',
];

/** Risk × mitigation (D-25 §06). */
export const DPIA_RISKS = [
  {
    risk: 'Credential breach / brute-force',
    likelihood: 'medium',
    impact: 'high',
    mitigation: ['argon2id (memory-hard)', 'lockout + jitter', 'rate limiting', 'HIBP breach check (k-anonymity)'],
  },
  {
    risk: 'Session hijacking',
    likelihood: 'medium',
    impact: 'high',
    mitigation: ['httpOnly + SameSite=Lax cookies', 'absolute + idle timeout', 'mid-session ID rotation', 'device fingerprint risk tiers'],
  },
  {
    risk: 'Data misuse / insider access',
    likelihood: 'low',
    impact: 'high',
    mitigation: ['PII minimal (hash\'lar)', 'audit log', 'least-privilege (admin MFA)', 'DSAR export/delete'],
  },
  {
    risk: 'Data breach (DB exposure)',
    likelihood: 'low',
    impact: 'high',
    mitigation: ['encryption at rest (provider)', 'no raw passwords/IP', 'retention limits', 'incident response (D-26)'],
  },
  {
    risk: 'Legal non-compliance (UZ)',
    likelihood: 'low',
    impact: 'medium',
    mitigation: ['consent log + version', 'DSAR rights', 'privacy policy 4 til', 'annual DPIA review'],
  },
];

/** Retention (D-25 §06). */
export const DPIA_RETENTION = [
  { data: 'account PII', period: 'account active; 30-day grace after DSAR delete' },
  { data: 'session', period: '30 min idle / 12 h absolute' },
  { data: 'audit log', period: 'limited (legal/security), then anonymized/deleted' },
  { data: 'consent log', period: 'as long as legally required' },
];

/** DSAR qo'llab-quvvatlash (D-25 §06 — D-23 bilan bog'langan). */
export const DPIA_DSAR = ['export (collectUserPii)', 'correct (reauth)', 'delete (30-day grace + purge worker)', 'restrict (processing halt)'];

/** Hujjatni oladi — review holati bilan (operator to'ldiradi). */
export function getDpia() {
  return {
    version: DPIA_VERSION,
    created: DPIA_CREATED,
    reviewPeriodDays: DPIA_REVIEW_PERIOD_DAYS,
    // §27: har yili yoki PII o'zgarishida qayta ko'rib chiqiladi
    nextReviewDue: DPIA_CREATED, // operator review sanasini kiritadi
    reviewedAt: null,
    reviewer: null,
    pii: DPIA_PII,
    purposes: DPIA_PURPOSES,
    risks: DPIA_RISKS,
    retention: DPIA_RETENTION,
    dsar: DPIA_DSAR,
  };
}

/** Review o'tkazilgan deb belgilaydi (operator — D-25 §29). */
export function markDpiaReviewed({ reviewer = null, date = DPIA_CREATED } = {}) {
  return {
    ...getDpia(),
    reviewedAt: date,
    reviewer: reviewer || null,
    nextReviewDue: date, // +365 kun operator tomonidan rejalashtiriladi
  };
}
