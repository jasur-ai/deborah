/**
 * Deborah — Cast Data Policy (C4-07)
 * -----------------------------------
 * Har Cast data class uchun purpose, retention days, expiry action.
 *
 * - Data class enum (item 1).
 * - Default proposal values (item 3).
 * - Policy resolve + policy version pin (item 4).
 * - Legal hold record (item 12).
 * - Tiny aggregate cohort suppress (item 13).
 * - De-identification re-identification review flag (item 14).
 * - O'zbekiston legal approval checklist (item 18).
 *
 * PURE logic — I/O yo'q. Retency job / deletion service shu modul orqali
 * qaror qiladi.
 */

// ── Data class enum (item 1) ──
export const DATA_CLASSES = {
  JOIN_TOKEN: 'join_token',
  RECOVERY_STATE: 'recovery_state',
  NAMED_ANSWER: 'named_answer',
  OPEN_TEXT: 'open_text',
  ACTION_PACK: 'action_pack',
  AGGREGATE: 'aggregate',
  AUDIT_LOG: 'audit_log',
  SUPPORT_BUNDLE: 'support_bundle',
  BACKUP: 'backup',
  // C4-07 (item 17): camera/microphone — Cast Core'da disabled data class
  CAMERA_MIC: 'camera_mic',
};

export const DATA_CLASS_LIST = Object.values(DATA_CLASSES);

// ── Expiry actions ──
export const EXPIRY_ACTIONS = {
  DELETE: 'DELETE',
  ANONYMIZE: 'ANONYMIZE',
  REVIEW_OR_DELETE: 'REVIEW_OR_DELETE',
  ROLLING: 'ROLLING', // backup — rolling policy
};

// ── Default retention policy (item 3) ──
// days: null → session bilan bog'liq (session end + offset) yoki maxsus qoida
export const DEFAULT_RETENTION_POLICY = Object.freeze({
  policyId: 'institution_default_v1',
  version: 1,
  classes: Object.freeze({
    [DATA_CLASSES.JOIN_TOKEN]: { purpose: 'Lobbida join identifikatsiyasi', days: 0.011, expiryAction: EXPIRY_ACTIONS.DELETE }, // session + 15 min → session end'dan hisoblanadi (days = ~15min)
    [DATA_CLASSES.RECOVERY_STATE]: { purpose: 'Tiklash holati (rejoin token)', days: 1, expiryAction: EXPIRY_ACTIONS.DELETE }, // 24 soat
    [DATA_CLASSES.NAMED_ANSWER]: { purpose: 'Ismli javoblar (identifikatsiya)', days: 90, expiryAction: EXPIRY_ACTIONS.DELETE },
    [DATA_CLASSES.OPEN_TEXT]: { purpose: 'Raw ochiq matn (devor/savollar)', days: 30, expiryAction: EXPIRY_ACTIONS.DELETE },
    [DATA_CLASSES.ACTION_PACK]: { purpose: 'Action pack / post-cast material', days: 180, expiryAction: EXPIRY_ACTIONS.REVIEW_OR_DELETE }, // 1 term
    [DATA_CLASSES.AGGREGATE]: { purpose: "Aggregate metrika (identity'siz) — C5-04 analytics eventlar ham shu class", days: 395, expiryAction: EXPIRY_ACTIONS.REVIEW_OR_DELETE }, // 13 oy
    [DATA_CLASSES.AUDIT_LOG]: { purpose: 'Audit / security log', days: 180, expiryAction: EXPIRY_ACTIONS.ROLLING }, // security log — rolling, not hard-delete by default
    [DATA_CLASSES.SUPPORT_BUNDLE]: { purpose: 'Support bundle (diagnostika)', days: 14, expiryAction: EXPIRY_ACTIONS.DELETE },
    [DATA_CLASSES.BACKUP]: { purpose: 'Zaxira nusxalari', days: null, expiryAction: EXPIRY_ACTIONS.ROLLING },
    [DATA_CLASSES.CAMERA_MIC]: { purpose: "Kamera/mikrofon ma'lumotlari — Cast Core'da DISABLED", days: 0, expiryAction: EXPIRY_ACTIONS.DELETE },
  }),
});

// ── Retention class multiplier (retentionClass: standard/extended/minimal) ──
export const RETENTION_CLASS_FACTOR = Object.freeze({
  standard: 1,
  extended: 2,
  minimal: 0.5,
});

/**
 * Policy resolve — policyId → policy.
 * @param {string} [policyId]
 * @param {object} [overrides] — institution custom classes (config.dataLifecycle.classes)
 * @returns {{policyId:string, version:number, classes:object}}
 */
export function resolveRetentionPolicy(policyId = 'institution_default_v1', overrides = null) {
  const base = {
    policyId,
    version: DEFAULT_RETENTION_POLICY.version,
    classes: { ...DEFAULT_RETENTION_POLICY.classes },
  };
  // Institution override: faqat ma'lum class'lar uchun
  if (overrides && typeof overrides === 'object') {
    for (const [cls, cfg] of Object.entries(overrides)) {
      if (!DATA_CLASS_LIST.includes(cls)) continue;
      base.classes[cls] = { ...base.classes[cls], ...cfg };
      base.version = 2; // customize → version bump
    }
  }
  return base;
}

/**
 * Policy snapshot hash — policy versionni pin qilish uchun (item 4).
 */
export function policyFingerprint(policy) {
  return `${policy.policyId}@v${policy.version}`;
}

/**
 * Class uchun retention days (retentionClass multiplier bilan).
 * @returns {number|null} days (null = rolling/session-based)
 */
export function retentionDaysFor(classPolicy, retentionClass = 'standard') {
  if (classPolicy == null || classPolicy.days == null) return null;
  const factor = RETENTION_CLASS_FACTOR[retentionClass] ?? 1;
  return Math.round(classPolicy.days * factor * 100) / 100;
}

/**
 * Expiry timestamp hisoblash.
 * @param {object} classPolicy — { days, expiryAction }
 * @param {number} createdAt — record yaratilgan vaqt
 * @param {object} [opts] — { retentionClass, sessionEndedAt }
 * @returns {number|null} expiry timestamp (null = rolling/cheksiz)
 */
export function expiryAtFor(classPolicy, createdAt, { retentionClass = 'standard', sessionEndedAt = null } = {}) {
  if (classPolicy == null || classPolicy.days == null) return null;
  const days = retentionDaysFor(classPolicy, retentionClass);
  // join_token — session end + offset (session tugagandan keyin hisoblanadi)
  const base = classPolicy.basis === 'session_end' ? sessionEndedAt || createdAt : createdAt;
  return base + Math.round(days * 24 * 60 * 60 * 1000);
}

/**
 * Expiry boundary — record expired?
 * ROLLING / REVIEW_OR_DELETE job tomonidan avtomatik o'chirilmaydi
 * (rolling = saqlanadi; review = inson qarori). Faqat DELETE/ANONYMIZE
 * ekspired hisoblanadi.
 * @returns {boolean}
 */
export function isExpired(classPolicy, createdAt, now, opts = {}) {
  // Rolling/backup — expiry bu job uchun emas
  if (!classPolicy || classPolicy.expiryAction === EXPIRY_ACTIONS.ROLLING) return false;
  if (classPolicy.expiryAction === EXPIRY_ACTIONS.REVIEW_OR_DELETE) return false;
  const at = expiryAtFor(classPolicy, createdAt, opts);
  if (at == null) return false;
  return now >= at;
}

// ── Legal hold (item 12) ──
/**
 * Legal hold record yaratish (pure).
 * @returns {{holdId:string, actor:string, scope:string, reason:string, createdAt:number, expiresAt:number|null}}
 */
export function buildLegalHold({ actor, scope, reason, expiresInDays = null, now = Date.now() }) {
  return {
    holdId: 'hold_' + Math.random().toString(36).slice(2, 10),
    actor: actor || 'unknown',
    scope: scope || 'session',
    reason: String(reason || '').slice(0, 300),
    createdAt: now,
    expiresAt: expiresInDays ? now + expiresInDays * 24 * 60 * 60 * 1000 : null, // null = doimiy
  };
}

/**
 * Hold faolmi? (expiry o'tmagan / doimiy)
 */
export function isHoldActive(hold, now = Date.now()) {
  if (!hold) return false;
  return !hold.expiresAt || now < hold.expiresAt;
}

/**
 * Class legal hold ostidami? — hold mavjud bo'lsa barcha class'lar qoplanadi.
 */
export function anyActiveHold(holds, now = Date.now()) {
  if (!holds || !Array.isArray(holds)) return false;
  return holds.some((h) => isHoldActive(h, now));
}

// ── Tiny aggregate cohort suppress (item 13) ──
/**
 * Kichik kogortni suppress qilish — individualni identifikatsiya qilib
 * bo'lmasligi uchun. MIN_COHORT_SIZE dan kichik → null.
 */
export function suppressTinyCohort(count, { minCohortSize = 5 } = {}) {
  if (count == null || count < minCohortSize) return null;
  return count;
}

// ── De-identification review flag (item 14) ──
/**
 * De-identified aggregate re-identification xavfi review flag.
 * Haddan tashqari kichik kogort yoki yuqori o'ziga xos javob → review.
 */
export function reIdentificationReviewFlag({ cohortSize, distinctAnswers = 0, uniqueNameRatio = 0 }) {
  const reasons = [];
  if (cohortSize != null && cohortSize < 5) reasons.push('tiny_cohort');
  if (distinctAnswers != null && distinctAnswers === cohortSize && cohortSize != null && cohortSize > 0 && cohortSize < 10) {
    reasons.push('fully_distinct_answers');
  }
  if (uniqueNameRatio > 0.8) reasons.push('unique_named_responses');
  return { needsReview: reasons.length > 0, reasons };
}

// ── O'zbekiston legal approval checklist (item 18) ──
export const UZ_LEGAL_CHECKLIST = Object.freeze([
  {
    id: 'uz_law_pdpl',
    label: "O'zbekiston shaxsiy ma'lumotlar to'g'risidagi qonun talablari",
    required: true,
  },
  {
    id: 'uz_camera_consent',
    label: 'Kamera/mikrofon yozuvi uchun ongli rozilik (item 17 bilan mos)',
    required: true,
  },
  {
    id: 'uz_minor_consent',
    label: 'Voyaga yetmaganlar uchun ota-ona roziligi',
    required: true,
  },
  {
    id: 'uz_retention_disclosure',
    label: 'Saqlash muddati to‘g‘risida foydalanuvchiga oshkor qilish',
    required: true,
  },
  {
    id: 'uz_cross_border',
    label: 'Transchegaraviy uzatish (tashqi provider bo‘lsa)',
    required: false,
  },
]);

/**
 * Checklist completion — barcha required itemlar approved bo'lsa ready.
 */
export function uzLegalChecklistStatus(approvals = {}) {
  const items = UZ_LEGAL_CHECKLIST.map((item) => ({
    ...item,
    approved: approvals[item.id] === true,
  }));
  const missingRequired = items.filter((i) => i.required && !i.approved);
  return {
    items,
    ready: missingRequired.length === 0,
    missingRequired: missingRequired.map((i) => i.id),
  };
}

// ── Anonymize transform (deletion-service uchun) ──
/**
 * Named record → anonymized variant: displayAlias o'chiriladi, aggregate
 * qiymat saqlanadi. Identity'ni tiklab bo'lmaydi.
 */
export function anonymizeRecord(record) {
  if (!record || typeof record !== 'object') return record;
  const out = { ...record };
  delete out.displayAlias;
  delete out.normalized;
  delete out.email;
  delete out.phone;
  if ('text' in out) {
    out.textHash = String(out.text).length; // faqat uzunlik (identity emas)
    delete out.text;
  }
  out.anonymizedAt = Date.now();
  return out;
}

export default {
  DATA_CLASSES,
  DATA_CLASS_LIST,
  EXPIRY_ACTIONS,
  DEFAULT_RETENTION_POLICY,
  RETENTION_CLASS_FACTOR,
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
};
