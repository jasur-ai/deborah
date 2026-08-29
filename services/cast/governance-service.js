/**
 * Deborah — Cast Governance Service (C4-06)
 * -----------------------------------------
 * Child-safe governance:
 *  - Minor-safe policy preset — server-side majburiy, overrides bilan
 *    chetlab o'tib bo'lmaydi (item 1; tugallanish sharti).
 *  - Moderation state machine — RECEIVED → AUTO_FLAGGED → REVIEW_READY →
 *    APPROVED/REDACTED/HIDDEN → PROJECTED; WITHDRAWN terminal (item 12).
 *  - Approve/redact/hide/project/withdraw permission matritsasi (item 13).
 *  - Auto-flag hech qachon final punishment emas (item 11).
 *  - Participant remove (vaqtinchalik) vs block (a'zolik blok) alohida (item 15).
 *  - Lobby raid → join code rotation (item 16).
 *  - Moderator unavailable → content private hold (item 17).
 *
 * DB ops faqat session-store / moderation-service orqali; bu modulda
 * fb path'lari yo'q (adapter orqali inject qilinadi).
 */

import { CAST_ROLES } from '../../utils/cast-constants.js';
// C4-08: institution governance policy (locked fields + limits)
import { applyInstitutionPolicy, assertInstitutionPolicyNotBypassed } from './institution-policy.js';

// ── Moderation state machine (item 12) ──
export const GOVERNANCE_MODERATION_STATE = Object.freeze({
  RECEIVED: 'RECEIVED',
  AUTO_FLAGGED: 'AUTO_FLAGGED',
  REVIEW_READY: 'REVIEW_READY',
  APPROVED: 'APPROVED',
  REDACTED: 'REDACTED',
  HIDDEN: 'HIDDEN',
  PROJECTED: 'PROJECTED',
  WITHDRAWN: 'WITHDRAWN',
});

// Legal transitions: from → allowed to[]
export const MODERATION_TRANSITIONS = Object.freeze({
  RECEIVED: ['AUTO_FLAGGED', 'REVIEW_READY', 'APPROVED', 'REDACTED', 'HIDDEN', 'WITHDRAWN'],
  AUTO_FLAGGED: ['REVIEW_READY', 'APPROVED', 'REDACTED', 'HIDDEN', 'WITHDRAWN'],
  REVIEW_READY: ['APPROVED', 'REDACTED', 'HIDDEN', 'WITHDRAWN'],
  APPROVED: ['PROJECTED', 'HIDDEN', 'WITHDRAWN'],
  REDACTED: ['PROJECTED', 'HIDDEN', 'WITHDRAWN'],
  HIDDEN: ['PROJECTED', 'WITHDRAWN'],
  PROJECTED: ['HIDDEN', 'WITHDRAWN'],
  WITHDRAWN: [], // terminal — qayta moderatsiya qilib bo'lmaydi
});

/**
 * State transition valid? (item 12)
 * Auto-flag (AUTO_FLAGGED) hech qachon terminal emas — har doim inson
 * review'iga o'tadi (item 11).
 */
export function canTransition(from, to) {
  const allowed = MODERATION_TRANSITIONS[from];
  return !!allowed && allowed.includes(to);
}

/** State REVIEW_READY'ga ko'tarilishi kerakmi? (AUTO_FLAGGED yoki RECEIVED → review) */
export function needsReview(state) {
  return state === GOVERNANCE_MODERATION_STATE.RECEIVED || state === GOVERNANCE_MODERATION_STATE.AUTO_FLAGGED;
}

// ── Permission matritsasi (item 13) ──
// approve/redact/hide/project/withdraw — qaysi role'lar qila oladi.
export const MODERATION_PERMISSIONS = Object.freeze({
  approve: [CAST_ROLES.OWNER, CAST_ROLES.CO_HOST, CAST_ROLES.MODERATOR],
  redact: [CAST_ROLES.OWNER, CAST_ROLES.CO_HOST, CAST_ROLES.MODERATOR],
  hide: [CAST_ROLES.OWNER, CAST_ROLES.CO_HOST, CAST_ROLES.MODERATOR],
  project: [CAST_ROLES.OWNER, CAST_ROLES.CO_HOST, CAST_ROLES.MODERATOR],
  withdraw: [CAST_ROLES.OWNER, CAST_ROLES.CO_HOST, CAST_ROLES.MODERATOR],
});

export function canModerate(action, role) {
  const allowed = MODERATION_PERMISSIONS[action];
  return !!allowed && allowed.includes(role);
}

// ── Minor-safe policy (item 1) ──
// Server-authoritative — resolvePreset'dan keyin qo'llanadi; overrides
// bu fieldlarni o'zgartira olmaydi (tugallanish sharti).
export const MINOR_SAFE_POLICY = Object.freeze({
  id: 'minor_safe_v1',
  moderation: {
    publicChat: false,
    directMessages: false,
    openTextVisibility: 'host_review_first',
    questionWall: 'moderated',
    publicIdentity: 'safe_alias',
  },
  join: {
    identity: 'safe_alias',
  },
  personalProgress: {
    visibility: 'private',
  },
  leaderboard: {
    // Minor sinfda shaxsiy reyting ochiq emas
    visibility: 'off_during_learning',
    finalVisibility: 'top_n',
    anonymizeLowRanks: true,
  },
});

/**
 * Governance policy'ni resolved config'ga qo'llash.
 * @param {object} config — resolved full config
 * @param {string} [policyId] — qo'llanadigan policy (default: minor_safe_v1)
 * @returns {{config:object, applied:string[]}} — applied = majburiy qilingan fieldlar
 */
export function applyGovernance(config, policyId = 'minor_safe_v1') {
  if (!config || typeof config !== 'object') {
    return { config: config || {}, applied: [] };
  }
  const policy = policyId === 'minor_safe_v1' ? MINOR_SAFE_POLICY : null;
  if (!policy) return { config, applied: [] };

  const applied = [];
  const applyPath = (path, value) => {
    const parts = path.split('.');
    let node = config;
    for (let i = 0; i < parts.length - 1; i++) {
      const key = parts[i];
      if (!node[key] || typeof node[key] !== 'object') node[key] = {};
      node = node[key];
    }
    const last = parts[parts.length - 1];
    if (node[last] !== value) {
      node[last] = value;
      applied.push(path);
    }
  };

  for (const [section, fields] of Object.entries(policy)) {
    if (section === 'id') continue;
    for (const [key, value] of Object.entries(fields)) {
      applyPath(`${section}.${key}`, value);
    }
  }
  return { config, applied };
}

/**
 * Client overrides minor-safe fieldlarni o'zgartirishga urindimi? (bypass test)
 * @returns {string[]} — urinib bo'lmagan fieldlar (bo'sh = hammasi OK)
 */
export function assertPolicyNotBypassed(overrides = {}, policyId = 'minor_safe_v1') {
  if (policyId !== 'minor_safe_v1' || !overrides || typeof overrides !== 'object') return [];
  const violations = [];
  for (const [section, fields] of Object.entries(MINOR_SAFE_POLICY)) {
    if (section === 'id') continue;
    const over = overrides[section];
    if (!over || typeof over !== 'object') continue;
    for (const key of Object.keys(fields)) {
      if (over[key] !== undefined && over[key] !== fields[key]) {
        violations.push(`${section}.${key}`);
      }
    }
  }
  return violations;
}

// ── Block list (item 15) ──
// A'zolik blok — remove'dan farqli: ishtirokchi qayta qo'shila olmaydi.
// Adapter inject qilinadi (test'da in-memory, prod'da session-store/fb).
export const BLOCK_ROOT = (sessionId) => `cast_private/${sessionId}/governance/blocks`;

/**
 * Block participant — normalized alias'ni session block list'iga qo'shadi.
 * @param {Function} dbGet  (path) => { exists(), val() }
 * @param {Function} dbSet  (path, value) => Promise
 */
export async function blockParticipant({ dbGet, dbSet }, sessionId, { participantId, normalized, reason = '', blockedBy = null }) {
  const root = BLOCK_ROOT(sessionId);
  const snap = await dbGet(root);
  const blocks = snap.exists() ? snap.val() : {};
  const key = normalized || participantId;
  if (!blocks[key]) {
    blocks[key] = {
      participantId: participantId || null,
      normalized: normalized || null,
      reason: String(reason || '').slice(0, 200),
      blockedBy,
      blockedAt: Date.now(),
    };
    await dbSet(root, blocks);
    return { blocked: true, key };
  }
  return { blocked: false, key, already: true };
}

/** Participant block qilinganmi? (normalized tekshiruv) */
export async function isBlocked({ dbGet }, sessionId, normalized) {
  if (!normalized) return false;
  const root = BLOCK_ROOT(sessionId);
  const snap = await dbGet(root);
  if (!snap.exists()) return false;
  const blocks = snap.val() || {};
  return !!blocks[normalized];
}

export async function listBlocked({ dbGet }, sessionId) {
  const root = BLOCK_ROOT(sessionId);
  const snap = await dbGet(root);
  return snap.exists() ? snap.val() : {};
}

export async function unblockParticipant({ dbGet, dbSet }, sessionId, key) {
  const root = BLOCK_ROOT(sessionId);
  const snap = await dbGet(root);
  const blocks = snap.exists() ? snap.val() : {};
  if (blocks[key]) {
    delete blocks[key];
    await dbSet(root, blocks);
    return { unblocked: true, key };
  }
  return { unblocked: false, key };
}

// ── Join code rotation (item 16) ──
// Lobby raid paytida eski kod o'chiriladi, yangi kod yaratiladi.
// @param {Function} generateCode — () => string (session-store.generateJoinCode)
// @param {Function} dbGet/dbSet/dbRemove
export async function rotateJoinCode({ dbGet, dbSet, dbRemove, dbUpdate }, sessionId, { generateCode, meta } = {}) {
  if (typeof generateCode !== 'function') {
    throw new Error('rotateJoinCode requires generateCode');
  }
  // 1. Eski kodni o'chir
  const currentMeta = meta || {};
  const oldCode = currentMeta.joinCode;
  if (oldCode && oldCode !== 'ROTATED') {
    await dbRemove(`cast_codes/${oldCode}`);
  }
  // 2. Yangi kod — collision tekshiruv bilan (5 urinish; bari band bo'lsa throw —
  // boshqa sessiya mapping'ini overwrite qilmaslik uchun)
  let newCode = generateCode();
  let used = false;
  for (let i = 0; i < 5; i++) {
    const snap = await dbGet(`cast_codes/${newCode}`);
    if (!snap.exists()) {
      used = true;
      break;
    }
    newCode = generateCode();
  }
  if (!used) {
    throw new Error('Join code rotation failed: 5 attempts collided');
  }
  await dbSet(`cast_codes/${newCode}`, { sessionId, created_at: Date.now() });
  await dbUpdate(`cast_sessions/${sessionId}/meta`, {
    joinCode: newCode,
    joinCodeRotatedAt: Date.now(),
  });
  return { newCode, rotatedAt: Date.now() };
}

// ── Moderator unavailable hold (item 17) ──
/**
 * Moderator offline bo'lsa va openText host_review_first bo'lsa —
 * content private hold qilinadi (proyeksiyaga chiqmaydi).
 * @param {object} outage — { frozen, moderatorOnline } (moderation hostOutageState)
 * @param {object} config — resolved config
 * @returns {boolean} — hold kerakmi?
 */
export function holdWhenModeratorUnavailable(outage, config) {
  if (!outage || outage.moderatorOnline) return false;
  const visibility = config?.moderation?.openTextVisibility;
  // host_review_first + moderator offline → xavfsiz hold
  if (visibility === 'host_review_first') return true;
  // public_after_approval ham moderator yo'q bo'lsa xavfsiz emas
  return visibility === 'public_after_approval';
}

// ── Raw text logs/analytics guard (item 14) ──
/**
 * Audit/log record'dan harmful raw textni chiqarib tashlash.
 * Harmful = PII/profanity flaglangan yoki moderator tomonidan
 * WITHDRAWN/REDACTED qilingan.
 */
// ── C4-08: Institution policy integratsiyasi ──
// Minor-safe (platform) + institution policy birgalikda qo'llanadi.
// Har ikkisi ham server-authoritative — client bypass qila olmaydi.

export function combinedGovernance({ config, overrides = {}, policy = null }) {
  // 1) Minor-safe platform policy (agar minor_safe bo'lsa)
  const isMinorSafe = config?.preset?.id === 'minor_safe' || (overrides.presetId === 'minor_safe');
  const gov = applyGovernance(config, isMinorSafe ? 'minor_safe_v1' : null);
  // 2) Institution policy (locked fields + limits)
  const inst = applyInstitutionPolicy(config, policy);
  // Bypass tekshiruvi: client locked field'ni override qilmoqchi bo'lsa
  const bypass = assertInstitutionPolicyNotBypassed(overrides, policy);
  return {
    config,
    applied: [...(gov.applied || []), ...(inst.applied || [])],
    clamped: inst.clamped || [],
    bypass,
  };
}

export function sanitizeForLog(record) {
  if (!record || typeof record !== 'object') return record;
  const out = { ...record };
  // Hech qachon raw text log'ga kirmaydi — faqat uzunlik va contentId
  if ('text' in out) {
    out.textLength = String(out.text || '').length;
    delete out.text;
  }
  if ('redactedText' in out) {
    out.redactedLength = String(out.redactedText || '').length;
    delete out.redactedText;
  }
  return out;
}

export default {
  GOVERNANCE_MODERATION_STATE,
  MODERATION_TRANSITIONS,
  MODERATION_PERMISSIONS,
  MINOR_SAFE_POLICY,
  canTransition,
  needsReview,
  canModerate,
  applyGovernance,
  assertPolicyNotBypassed,
  combinedGovernance,
  blockParticipant,
  isBlocked,
  listBlocked,
  unblockParticipant,
  rotateJoinCode,
  holdWhenModeratorUnavailable,
  sanitizeForLog,
};
