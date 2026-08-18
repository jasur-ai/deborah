/**
 * Edikit — Cast Question Wall Moderation Service (C3-10)
 * --------------------------------------------------------
 * Free-text question faqat moderationdan keyin public bo'ladi.
 *
 * Key principles:
 * - RECEIVED content HECH QACHON public chiqmaydi.
 * - PII/profanity rule flaglari queue priority sifatida ishlatiladi.
 * - Approve/redact/hide/project/withdraw — 5 xil action.
 * - Public projection identity'ni olib tashlaydi, faqat APPROVED/REDACTED(with text)/PROJECTED.
 * - Host/moderator disconnect → public queue projection freeze.
 */

import crypto from 'crypto';
import { fb } from '../../firebase/admin.js';
import { CAST_ERROR_CODES, CastError } from './errors.js';
import { hasInvisibleAbuse } from './nickname.js';
// C4-06 (item 12): state machine governance-service'da — applyWallAction ham shuni ishlatadi
import { canTransition } from './governance-service.js';

// ── Constants (C4-06: kengaytirilgan state machine) ──
export const WALL_CHAR_LIMIT = 280;
export const WALL_CHAR_MIN = 3;

export const WALL_MODERATION_STATE = {
  RECEIVED: 'RECEIVED',
  AUTO_FLAGGED: 'AUTO_FLAGGED',
  REVIEW_READY: 'REVIEW_READY',
  APPROVED: 'APPROVED',
  REDACTED: 'REDACTED',
  HIDDEN: 'HIDDEN',
  PROJECTED: 'PROJECTED',
  WITHDRAWN: 'WITHDRAWN',
};

/** Pending (review kutayotgan) state'lar — director queue'da ko'rinadi. */
export const WALL_PENDING_STATES = [WALL_MODERATION_STATE.RECEIVED, WALL_MODERATION_STATE.AUTO_FLAGGED, WALL_MODERATION_STATE.REVIEW_READY];

export const WALL_ACTIONS = ['approve', 'redact', 'hide', 'project', 'withdraw'];

// ── PII / profanity rules ──
const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/;
const PHONE_RE = /(?:\+?\d[\d\s().-]{7,}\d)/;
const URL_RE = /(?:https?:\/\/|www\.)[^\s]+/;

// Profanity — locale bo'yicha versionlangan (item 10).
// Flag faqat — hech qachon avtomatik blok emas (item 11).
const PROFANITY_BY_LOCALE = {
  'uz-Latn': ['axmoq', 'ahmoq', 'sikil', 'sikilgan', 'onang', 'kalla', 'eshak', 'kal', 'xonim', 'fohisha'],
  'uz-Cyrl': ['аҳмоқ', 'сикил', 'онанг', 'калла', 'эшак', 'фоҳиша'],
  ru: ['дурак', 'идиот', 'тупица', 'сволочь', 'мудак', 'блядь'],
  en: ['fuck', 'shit', 'bitch', 'asshole', 'damn', 'crap', 'dick', 'pussy'],
};

/**
 * Locale profanity tekshiruvi (item 10) — default barcha locale'lar.
 * @param {string} text
 * @param {string} [locale]
 */
export function profanityHit(text = '', locale = 'uz-Latn') {
  const t = String(text).toLowerCase().normalize('NFKC');
  // Prioritet: asosiy locale, keyin default uz-Latn + en (fallback)
  const lists = [PROFANITY_BY_LOCALE[locale], PROFANITY_BY_LOCALE['uz-Latn'], PROFANITY_BY_LOCALE.en].filter(Boolean);
  for (const list of lists) {
    for (const w of list) {
      if (t.includes(w)) return true;
    }
  }
  return false;
}

/**
 * Text'ni flagla — queue priority.
 * @param {string} text
 * @param {string} [locale]
 * @returns {{flags:Object<string,boolean>, priority:'HIGH'|'MEDIUM'|'LOW'}}
 */
export function flagSensitive(text = '', locale = 'uz-Latn') {
  const t = String(text).toLowerCase();
  const flags = {
    email: EMAIL_RE.test(text),
    phone: PHONE_RE.test(text),
    url: URL_RE.test(text),
    profanity: profanityHit(text, locale),
    // PII heuristic: ketma-ket 8+ raqam (ID/guvohnoma kabi)
    pii: /\d{8,}/.test(text),
    // C4-06 (item 9): invisible bidi control / zero-width abuse
    invisible: hasInvisibleAbuse(text),
  };
  let priority = 'LOW';
  if (flags.email || flags.phone || flags.profanity || flags.invisible) priority = 'HIGH';
  else if (flags.url || flags.pii) priority = 'MEDIUM';
  return { flags, priority };
}

// ── Pure validation ──
/**
 * Wall text'ni tekshirish.
 * @returns {{ok:boolean, clean?:string, error?:string}}
 */
export function validateWallText(raw) {
  const clean = String(raw || '').trim().slice(0, WALL_CHAR_LIMIT);
  if (!clean) return { ok: false, error: 'EMPTY' };
  if (clean.length < WALL_CHAR_MIN) return { ok: false, error: 'TOO_SHORT' };
  return { ok: true, clean };
}

/**
 * Pure: item yaratish (DB'ga yozmaydi).
 * C4-06 (item 12): HIGH priority (auto-flag) → AUTO_FLAGGED state —
 * lekin bu hech qachon final emas (item 11): har doim inson review'iga o'tadi.
 * C4-06 (item 8): original matn safe-escaped shaklda saqlanadi.
 */
export function buildWallItem({ sessionId, participantId, text, commandId, locale = 'uz-Latn' }) {
  const { ok, clean, error } = validateWallText(text);
  if (!ok) return { item: null, error };
  const { flags, priority } = flagSensitive(clean, locale);
  return {
    item: {
      contentId: 'wall_' + crypto.randomBytes(6).toString('hex'),
      type: 'question_wall',
      sessionId,
      participantId,
      commandId,
      text: clean,
      // Safe-escaped nusxa (item 8) — HTML kontekstida ko'rsatish uchun xavfsiz
      storedText: escapeHtml(clean),
      charCount: clean.length,
      flags,
      priority,
      moderationState: priority === 'HIGH' ? WALL_MODERATION_STATE.AUTO_FLAGGED : WALL_MODERATION_STATE.RECEIVED,
      submittedAt: Date.now(),
      moderatedAt: null,
      moderatedBy: null,
      redactedText: null,
      projectedAt: null,
    },
    error: null,
  };
}

/** HTML-escape (item 8 — safe storage). */
export function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Pure: moderation action qo'llash — state transition.
 * @param {Object} item
 * @param {string} action  approve|redact|hide|project|withdraw
 * @param {Object} opts { redactedText, moderatorId, locale }
 * @returns {{ok:boolean, next?:Object, error?:string}}
 */
export function applyWallAction(item, action, { redactedText = '', moderatorId = null, locale = 'uz-Latn' } = {}) {
  if (!WALL_ACTIONS.includes(action)) {
    return { ok: false, error: 'INVALID_ACTION' };
  }
  if (!item || !item.contentId) return { ok: false, error: 'NOT_FOUND' };
  if (item.moderationState === WALL_MODERATION_STATE.WITHDRAWN) {
    return { ok: false, error: 'ALREADY_WITHDRAWN' };
  }
  // Final state'lar qayta moderatsiya qilinmaydi (RECEIVED→…, APPROVED→project ruxsat).
  // C4-06: AUTO_FLAGGED/REVIEW_READY ham review kutayotgan state'lar — hammasi o'zgaradi.
  const finalStates = [WALL_MODERATION_STATE.HIDDEN, WALL_MODERATION_STATE.WITHDRAWN];
  if (finalStates.includes(item.moderationState) && action !== 'project') {
    return { ok: false, error: 'FINAL_STATE' };
  }

  // C4-06 (item 12): legal transition — project faqat APPROVED/REDACTED'dan,
  // unmoderated (RECEIVED/AUTO_FLAGGED) content proyeksiyaga chiqmaydi.
  const target = {
    approve: WALL_MODERATION_STATE.APPROVED,
    redact: WALL_MODERATION_STATE.REDACTED,
    hide: WALL_MODERATION_STATE.HIDDEN,
    project: WALL_MODERATION_STATE.PROJECTED,
    withdraw: WALL_MODERATION_STATE.WITHDRAWN,
  }[action];
  if (!canTransition(item.moderationState, target)) {
    return { ok: false, error: 'ILLEGAL_TRANSITION', from: item.moderationState, to: target };
  }

  const next = {
    ...item,
    moderationState: item.moderationState,
    moderatedAt: Date.now(),
    moderatedBy: moderatorId,
  };

  switch (action) {
    case 'approve':
      next.moderationState = WALL_MODERATION_STATE.APPROVED;
      break;
    case 'redact': {
      const red = String(redactedText || '').trim().slice(0, WALL_CHAR_LIMIT);
      if (!red) return { ok: false, error: 'REDACT_TEXT_REQUIRED' };
      next.moderationState = WALL_MODERATION_STATE.REDACTED;
      next.redactedText = red;
      next.storedText = escapeHtml(red);
      break;
    }
    case 'hide':
      next.moderationState = WALL_MODERATION_STATE.HIDDEN;
      break;
    case 'project':
      next.moderationState = WALL_MODERATION_STATE.PROJECTED;
      next.projectedAt = Date.now();
      break;
    case 'withdraw':
      next.moderationState = WALL_MODERATION_STATE.WITHDRAWN;
      break;
  }
  return { ok: true, next };
}

/**
 * Pure: public-safe projection (identity yashirin).
 * @param {Array<Object>} items
 * @returns {Array<{contentId:string, text:string, priority:string, projectedAt:number|null}>}
 */
export function projectPublicWall(items) {
  const out = [];
  for (const item of Object.values(items || {})) {
    let publicText = null;
    if (item.moderationState === WALL_MODERATION_STATE.APPROVED) publicText = item.text;
    else if (item.moderationState === WALL_MODERATION_STATE.PROJECTED) publicText = item.text;
    else if (item.moderationState === WALL_MODERATION_STATE.REDACTED && item.redactedText) {
      publicText = item.redactedText;
    }
    if (publicText === null) continue;
    out.push({
      contentId: item.contentId,
      text: publicText,
      priority: item.priority || 'LOW',
      projectedAt: item.projectedAt || null,
    });
  }
  // Eng oxirgi birinchi (proyeksiya tartibi)
  return out.reverse();
}

/**
 * Pure: host/moderator outage — public projection freeze.
 * @param {number|null} lastDirectorSeenAt  so'nggi moderator heartbeat
 * @param {number} now
 * @param {number} thresholdMs
 * @returns {{frozen:boolean, moderatorOnline:boolean}}
 */
export function hostOutageState(lastDirectorSeenAt, now = Date.now(), thresholdMs = 60000) {
  const moderatorOnline = !!lastDirectorSeenAt && now - lastDirectorSeenAt < thresholdMs;
  return { frozen: !moderatorOnline, moderatorOnline };
}

// ── DB ops ──
const WALL_ROOT = (sessionId) => `cast_private/${sessionId}/wall_queue`;
const WALL_STATE = (sessionId) => `cast_private/${sessionId}/wall_state`;

/**
 * Submit wall item → private moderation queue (RECEIVED).
 * @returns {Promise<{contentId:string, priority:string}|{error:string}>}
 */
export async function submitWallItem({ sessionId, participantId, text, commandId }) {
  const { item, error } = buildWallItem({ sessionId, participantId, text, commandId });
  if (!item) return { error };
  await fb.set(`${WALL_ROOT(sessionId)}/${item.contentId}`, item);
  return { contentId: item.contentId, priority: item.priority };
}

/**
 * List moderation queue (director private).
 * @returns {Promise<Object>}
 */
export async function listWallQueue(sessionId) {
  const snap = await fb.get(WALL_ROOT(sessionId));
  return snap.exists() ? snap.val() : {};
}

/**
 * Moderate a wall item.
 * @returns {Promise<Object>} yangilangan item
 */
export async function moderateWallItem({ sessionId, contentId, action, moderatorId, redactedText }) {
  const path = `${WALL_ROOT(sessionId)}/${contentId}`;
  const snap = await fb.get(path);
  if (!snap.exists()) {
    throw new CastError(CAST_ERROR_CODES.SESSION_NOT_FOUND, 'Wall item topilmadi');
  }
  const current = snap.val();
  const { ok, next, error } = applyWallAction(current, action, { redactedText, moderatorId });
  if (!ok) {
    throw new CastError(CAST_ERROR_CODES.INVALID_OPTION, `Moderatsiya rad etildi: ${error}`);
  }
  await fb.set(path, next);
  return next;
}

/**
 * Public wall (projector + participants) — identity yashirin, faqat tasdiqlangan.
 * @returns {Promise<{items:Array, frozen:boolean, moderatorOnline:boolean}>}
 */
export async function getPublicWall(sessionId, now = Date.now()) {
  const queue = await listWallQueue(sessionId);
  const stateSnap = await fb.get(WALL_STATE(sessionId));
  const state = stateSnap.exists() ? stateSnap.val() : {};
  const outage = hostOutageState(state.lastDirectorSeenAt, now);
  return {
    items: projectPublicWall(queue),
    frozen: outage.frozen,
    moderatorOnline: outage.moderatorOnline,
  };
}

/**
 * Director presence'ni belgilash (join/activity).
 */
export async function markDirectorSeen(sessionId, at = Date.now()) {
  await fb.update(WALL_STATE(sessionId), { lastDirectorSeenAt: at });
}

/**
 * Director disconnect → freeze.
 */
export async function freezeWall(sessionId, at = Date.now()) {
  await fb.update(WALL_STATE(sessionId), { lastDirectorSeenAt: 0, frozenAt: at });
}

export default {
  WALL_CHAR_LIMIT,
  WALL_CHAR_MIN,
  WALL_MODERATION_STATE,
  WALL_PENDING_STATES,
  WALL_ACTIONS,
  flagSensitive,
  profanityHit,
  validateWallText,
  buildWallItem,
  applyWallAction,
  projectPublicWall,
  hostOutageState,
  escapeHtml,
  submitWallItem,
  listWallQueue,
  moderateWallItem,
  getPublicWall,
  markDirectorSeen,
  freezeWall,
};
